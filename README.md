# CarryLink

CarryLink is a verified peer-to-peer marketplace that connects travellers who have spare luggage capacity
or spare time with people who need something **carried, bought, or someone accompanied** on the same
route. It grew out of a pattern in diaspora WhatsApp groups ("is anyone flying to Pakistan next week? I
need to send documents / medicine / a gift"): the demand is real and recurring, the supply is ad hoc, and
trust is zero, so people get scammed or unknowingly carry things they should not.

CarryLink is deliberately **not** a "carry my sealed parcel" app. Only six restricted categories are
allowed (`documents`, `purchase_for_me`, `gifts_inspected`, `electronics_inspected`, `medicine_rx`,
`companion_assist`); nothing is sealed and the traveller inspects and photographs every item before
accepting it; both sides are ID-verified; the sender's payment is held in escrow and released only after
the recipient gives the traveller a delivery code and a 48-hour dispute window passes (or the sender
confirms); all communication stays in-app with contact details
redacted. The traveller remains the customs declarant; CarryLink provides the tooling and the evidence
trail and never handles goods.

## Architecture

npm workspaces monorepo:

| Path | What | Stack |
|---|---|---|
| `apps/api` | REST API, `/api/v1` on port 4000 | Fastify 5 + TypeScript, Node built-in SQLite (`node:sqlite`), Zod validation, `@fastify/helmet`, `@fastify/cors`, `@fastify/rate-limit`, `@fastify/cookie` |
| `apps/web` | Web client on port 5173 | React 18 + Vite + React Router; dev server proxies `/api` to the API |
| `apps/ops` | AI operations team (Claude agents) that files proposals for the admin to approve | TypeScript + Anthropic SDK; talks to the API as the `ops` role |
| `docs/` | Product, security, workflow, business and go-to-market documentation | Markdown + Mermaid |

The API contract is fixed in [docs/API.md](docs/API.md). Payments, ID verification, trip verification,
file storage and email are **mocked** behind interfaces (see [docs/SECURITY.md](docs/SECURITY.md#6-what-is-mocked-in-the-mvp-and-must-be-replaced-before-launch)).

## AI operations team

`apps/ops` runs five Claude-powered agents (`identity-reviewer`, `dispute-officer`, `trust-safety`,
`growth`, `chief-of-staff`) that log into the API as a service account with role `ops`. They read the
KYC queue, disputes, audit log and stats, and file **proposals** that the founder approves or rejects in
the **AI Team** tab of the admin console. The `ops` role can read admin data and propose; it cannot
approve KYC, resolve disputes or suspend users itself. Execution happens inside the API on admin
approval, or under a narrow server-side auto-policy (confident KYC rejections, disputes up to $50) that
can be switched off with `OPS_AUTO_EXECUTE=false`. Seed login: `ops@carrylink.dev` / `Ops-Passw0rd!`.

```bash
OPS_DRY_RUN=true npm run ops -w apps/ops -- run   # print what the team would propose, file nothing
npm run ops -w apps/ops -- daemon                 # run every 30 minutes, daily digest at 08:00
```

Setup, the daily approval routine, autonomy settings, costs and limits:
[docs/OPERATIONS.md](docs/OPERATIONS.md). API contract: [docs/API.md](docs/API.md#ai-operations-team-ops).

## Quick start

Requires **Node.js 22.13+** (for the built-in `node:sqlite` module).

```bash
npm install

# API configuration
cp .env.example apps/api/.env
# Optional in development: if FIELD_ENCRYPTION_KEY is left empty, it is derived from JWT_SECRET,
# so encrypted phone/ID fields survive restarts. Mandatory in production (the API will not start
# without it). To set one explicitly:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# -> paste into FIELD_ENCRYPTION_KEY= in apps/api/.env (and use a real JWT_SECRET outside local dev)

npm run seed -w apps/api     # creates the dev database with demo users, a trip and a request
npm run dev:api              # http://localhost:4000/api/v1/health
npm run dev:web              # in a second terminal
```

Open http://localhost:5173.

### Seed logins (from [docs/API.md](docs/API.md#dev-seed))

| Role | Email | Password | State |
|---|---|---|---|
| Admin | `admin@carrylink.dev` | `Admin-Passw0rd!` | Admin console (KYC queue, disputes, users, audit log) |
| Traveller | `traveler@carrylink.dev` | `Traveler-Passw0rd!` | KYC verified, one verified trip LHR → ISB |
| Sender | `sender@carrylink.dev` | `Sender-Passw0rd!` | KYC verified, one open `documents` request LHR → ISB |

In development, email verification tokens are returned in API responses (`DEV_RETURN_TOKENS=true`)
instead of being emailed. The mock payment provider accepts tokens of the form `tok_...`
(`tok_test_declined` simulates a decline). The mock trip verification accepts any 6-character
alphanumeric booking reference.

## Tests

```bash
npm test          # runs the workspace test suites (API: node:test via tsx)
npm run typecheck
```

## Documentation

| Document | Contents |
|---|---|
| [docs/API.md](docs/API.md) | API contract: entities, enums, endpoints, match lifecycle, dev seed. Source of truth. |
| [docs/PRODUCT.md](docs/PRODUCT.md) | Problem, users and personas, categories and caps, scope, MVP features mapped to endpoints, roadmap, competitors |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, implemented controls, mocked components, data retention and UK GDPR, incident response |
| [docs/WORKFLOW.md](docs/WORKFLOW.md) | Mermaid diagrams: onboarding/KYC, match lifecycle, escrow and codes, disputes, companion assist; step lists per persona |
| [docs/BUSINESS_MODEL.md](docs/BUSINESS_MODEL.md) | Business Model Canvas, revenue, unit economics, CAC, break-even, metrics, risks |
| [docs/GO_TO_MARKET.md](docs/GO_TO_MARKET.md) | Launch corridor, WhatsApp seeding, ambassadors, 90-day plan, validation survey and interview guide |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Founder's guide to the AI operations team: what each agent does, daily approvals, setup, autonomy settings, costs, guardrails |

## Security status

**MVP — not production ready.** The application-level controls are real (scrypt password hashing,
15-minute access tokens with rotating refresh tokens and reuse detection, AES-256-GCM field encryption,
Zod validation, rate limiting, RBAC, PII redaction, audit log, code lockout). The integrations that make
it safe to use with real people, money and goods are **mocked**: payments/escrow, ID verification, flight
verification, file storage and virus scanning, email and SMS. Do not deploy this with real users until
the items in [SECURITY.md section 6](docs/SECURITY.md#6-what-is-mocked-in-the-mvp-and-must-be-replaced-before-launch)
are replaced and a legal review of each category has been completed for the target corridor.
