# CarryLink — Security, Threat Model and Data Protection

> Status: **MVP. Several integrations are mocked. Not production ready.** Section 6 lists exactly what must
> be replaced before real users, real money or real goods are involved.

CarryLink's security problem is unusual: the most serious harms are not data breaches but **physical and
legal harms to users** — a traveller arrested with someone else's contraband, a vulnerable relative left at
an airport, money laundered through small "rewards". The threat model therefore covers the product rules
(what can be carried, who can act, when money moves) as well as the application security of the codebase.

## 1. Assets

| Asset | Why it matters |
|---|---|
| Traveller's liberty and legal standing | The traveller is the customs declarant. Carrying prohibited goods is their liability. |
| Physical safety of accompanied persons (`companion_assist`) | Often elderly or first-time travellers. |
| Escrowed funds | Target for fraud, chargebacks, laundering. |
| Identity data: legal name, date of birth, ID document number and image | High-value PII; identity theft if leaked. |
| Contact data: phone numbers (user and recipient), email | Enables off-platform scams and harassment. |
| Accounts and sessions | Takeover gives access to funds, codes and PII. |
| Handover and delivery codes | Control state transitions and release of funds. |
| Evidence trail: inspection notes/photos, timeline, messages, audit log | Needed for disputes and to protect travellers with authorities. |

## 2. Actors and trust boundaries

- **Anonymous internet** → public API (`/health`, `/meta/*`, `/auth/register`, `/auth/login`).
- **Authenticated user** (`role: user`) → own resources; acts as sender, traveller, or both.
- **Match party** → a user who owns the request or the trip in a given match; only parties (and admins) can read a match, its messages and its codes (sender only).
- **Admin** (`role: admin`) → KYC decisions, dispute resolution, suspension, audit log.
- **Recipient** → not a platform user; only ever holds the delivery code.
- **Third-party providers** (payments, IDV, flight data, storage, email/SMS) → all mocked in the MVP.

## 3. Controls implemented in the codebase

| Area | Control | Where / config |
|---|---|---|
| Password storage | `scrypt` (Node `crypto`, N=16384, r=8, p=1) with a per-password 16-byte random salt; verification uses constant-time comparison. Password 10–128 chars | `apps/api/src/lib/crypto.ts` |
| Access tokens | HS256 JWT implemented with Node `crypto` (no third-party JWT library), **15-minute** lifetime, sent as `Authorization: Bearer`; signed with `JWT_SECRET` (startup fails if shorter than 32 chars) | `.env` → `JWT_SECRET` |
| Refresh tokens | **30-day** refresh token in the `cl_refresh` cookie: `httpOnly`, `SameSite=Strict`, `Secure` when `COOKIE_SECURE=true`. Cookie path scoped to `/api/v1/auth`. **Rotated on every refresh.** Stored server-side only as an HMAC-SHA256 hash. Tokens belong to a family; **reuse of an already-rotated (or expired) token revokes the entire family** and is audited as `auth.refresh_reuse_detected` | `POST /auth/refresh` |
| Session visibility | Users can list and revoke sessions | `GET /me/sessions`, `DELETE /me/sessions/:id` |
| Brute-force / abuse | `@fastify/rate-limit` (429 responses use the standard error shape `{ error: { code: 'RATE_LIMITED', message } }`): 10 requests / 15 min on register and login-class auth routes, 60 / 15 min on refresh, 5 / hour on KYC submission, plus per-route limits on pay, codes, handover, deliver, messages and trip verification. Per-account lockout for 15 minutes after 8 consecutive failed logins | route config |
| Enumeration | Login returns the same `401 INVALID_CREDENTIALS` and message for unknown email and wrong password | `POST /auth/login` |
| HTTP hardening | `@fastify/helmet` security headers (CSP, HSTS, `X-Content-Type-Options`, frame-ancestors etc.) | server bootstrap |
| CORS | Strict allow-list: a single origin from `CORS_ORIGIN`, credentials enabled only for it | `.env` → `CORS_ORIGIN` |
| Input validation | **Zod schema on every route input** (body, params, query); unknown or malformed input → `400 VALIDATION_ERROR` | every route |
| Field encryption | **AES-256-GCM** field-level encryption for user phone numbers, recipient phone numbers and ID document numbers; only the **last 4 digits** are ever returned (`phoneMasked`, admin KYC view) | `.env` → `FIELD_ENCRYPTION_KEY` (32 bytes, base64) |
| Authorization | RBAC (`user` / `admin`) plus per-resource ownership / match-party checks on every route; `403 FORBIDDEN` | route guards |
| Verification gating | Posting trips/requests and creating matches require verified email (`EMAIL_NOT_VERIFIED`) and **KYC `verified`** (`KYC_REQUIRED`); both match parties must be verified; only `verified` trips can be matched | `POST /trips`, `POST /requests`, `POST /matches` |
| Goods screening | Prohibited-keyword screening of title, description and item names at posting (`422 PROHIBITED_ITEM` with `details.matched`); per-category **weight and declared-value caps**; mandatory sender attestations `items_unsealed`, `no_prohibited`, `truthful_declaration`, `accept_inspection` (+ `has_prescription` for `medicine_rx`) | `POST /requests`, `GET /meta/prohibited`, `GET /meta/categories` |
| Inspection evidence | Handover requires inspection notes and ≥ 1 photo reference; stored on the match | `POST /matches/:id/handover` |
| Codes | Two 6-digit codes per match (handover, delivery) from a CSPRNG, returned only to the sender (`/pay`, `/codes`; each view audited). Stored as a keyed HMAC for verification plus an AES-256-GCM copy so the sender can re-display them. **Constant-time comparison**; a wrong code returns `400 INVALID_CODE` with `details.attemptsLeft`; every failure audited; **after 5 failed attempts on either code the match is locked (`423 MATCH_LOCKED`) and a dispute is opened automatically** | `/pay`, `/codes`, `/handover`, `/deliver` |
| Escrow | Funds held from `funded` (a declined payment returns `402 PAYMENT_DECLINED` and nothing is held). Entering the delivery code moves the match to `delivered` but **escrow stays `held`**. Escrow is released to the traveller only at completion: the sender calls `POST /matches/:id/complete`, or the **48 h dispute window lapses** and the auto-completion sweep (`sweepAutoComplete`, run every 10 minutes by the server and also lazily on match reads) completes the match with no actor (audited with `auto: true`). The only other path is **admin-only dispute resolution** (`refund_sender`, `pay_traveler`, `split`), so a dispute opened after delivery still has the full amount to refund or split | `apps/api/src/routes/matches.ts`, `POST /admin/disputes/:id/resolve` |
| Messaging | In-app only; open while the match is `accepted`, `funded`, `in_transit`, `delivered` or `disputed` (open during a dispute on purpose, so both parties can talk and provide evidence); phone numbers (incl. spaced/dotted formats), emails (incl. `(at)`/`(dot)` obfuscation), links and messenger handles (WhatsApp, Telegram, etc.) replaced with `[hidden: keep contact on CarryLink]`, `redacted: true`, and the redaction is audited | `/matches/:id/messages`, `apps/api/src/lib/redact.ts` |
| Audit | **Append-only audit log** (application-level: the code only ever inserts) of sensitive actions (for example: login, refresh-token reuse, KYC submission/decision, payment, code failures and lockouts, handover, delivery, disputes and resolutions, suspensions); no API mutates or deletes entries; admin read-only view | `GET /admin/audit` |
| Account control | Admin suspension (`suspended: true`) blocks further actions | `POST /admin/users/:id/suspend` |
| Uploads | Only `image/*` and `application/pdf`, max 10 MB, client-declared SHA-256 recorded (metadata only in MVP) | `POST /uploads` |

## 4. Threat model

Likelihood and impact are rated **L / M / H** for the MVP operating on one corridor. STRIDE column:
**S**poofing, **T**ampering, **R**epudiation, **I**nformation disclosure, **D**enial of service,
**E**levation of privilege, plus **Abuse** for product-level misuse that is not a classic STRIDE category.

| # | Threat | STRIDE | Likelihood | Impact | Controls in place | Residual risk / next step |
|---|---|---|---|---|---|---|
| T1 | **Drug / contraband muling via an unwitting traveller** — a sender hides prohibited goods inside an innocuous-looking item | Abuse, T | M | **H** | Restricted categories only; **nothing sealed**; traveller must physically inspect, photograph (≥ 1 photo) and write inspection notes before entering the handover code; sender attests `items_unsealed`, `no_prohibited`, `truthful_declaration`, `accept_inspection`; prohibited-keyword screening; weight and value caps; KYC on the sender (deterrence, traceability); `purchase_for_me` avoids sender-supplied goods entirely; traveller can decline or dispute at handover | Inspection by a layperson cannot detect well-concealed contraband (e.g. inside electronics or lined packaging). Travellers are told explicitly: **if in doubt, refuse**. v2: inspection checklist per category, guidance on what can hide what, report-to-authorities flow. The traveller remains the declarant and is responsible for what they carry. |
| T2 | **Sender fraud** — fake or misdescribed item, later claims it was not delivered, or charges back the card | S, R | M | M | Sender KYC; itemised `DeclaredItem` list with values; traveller's inspection notes and photos at handover; delivery requires a code only the sender/recipient had; timeline with actor IDs; audit log; dispute process | Card chargebacks can bypass the platform's dispute outcome. v2: payment provider with 3-D Secure (liability shift) and evidence submission from the match timeline. |
| T3 | **Traveller theft / non-delivery** — traveller takes the item or the reward and does not deliver | S, R | M | M | Traveller KYC and verified trip; escrow — traveller is not paid until the **delivery code** is entered *and* the match completes (sender confirmation or 48 h window with no dispute); the delivery code is held by the sender/recipient, not the traveller; sender can dispute from `funded`, `in_transit` or `delivered`; reviews and trust score; admin suspension | Loss of the item itself is not covered in the MVP beyond refunding the reward. v2: insurance partner for declared value; recovery via KYC identity. |
| T4 | **Fake identities** — synthetic or stolen ID documents | S | M | H | Email verification; KYC with document type, number, name, DOB, country and image; manual admin review; posting and matching blocked until `verified`; one active KYC submission per user (409); rate limit on submissions; **duplicate detection**: a keyed hash of the document number is compared against already-verified accounts and matches are audited (`kyc.duplicate_document`) | MVP review is manual with no liveness, document forensics or sanctions screening. **Must be replaced by a real IDV vendor** (document authenticity + liveness + sanctions/PEP) before launch. |
| T5 | **Account takeover** — credential stuffing, phishing, stolen refresh token | S, E | M | H | scrypt hashing; password ≥ 10 chars; rate limiting on auth routes; per-account lockout after 8 failed logins; short 15-min access tokens; refresh-token rotation with **reuse detection revoking the whole family**; `httpOnly` + `SameSite=Strict` cookie (not readable by JS); session list + revoke; audit of sensitive auth events such as refresh-token reuse | No MFA in MVP. v2: TOTP/passkeys, mandatory for admins; breached-password check; step-up auth before payout-detail changes; login alerts by email. |
| T6 | **Off-platform migration and scams** — parties swap numbers, then the "traveller" asks for a deposit via bank transfer, or the transaction completes off-platform with no protection | Abuse | **H** | M | All messaging in-app; phone numbers, emails and links redacted automatically; phone numbers never shown to the counterparty (masked only); no free-form messaging outside a match; terms and UI state that CarryLink protection only applies on-platform | Redaction is pattern-based and can be evaded (numbers spelled out, images). v2: evasion heuristics, repeated-redaction flags to admin, in-app voice call via relay for meet-ups. Accept that some leakage is inevitable; make on-platform strictly better (escrow, insurance). |
| T7 | **PII leakage** — phone numbers, passport/ID numbers exposed via API, logs or DB theft | I | M | H | AES-256-GCM field encryption for phones, recipient phones and ID doc numbers; only last 4 ever returned, including to admins; `PublicUser` exposes only name, KYC status, trust score, ratings, member-since; serializers return only the documented fields; error bodies never echo secrets | Key is an env var in the MVP. v2: KMS-managed key with rotation and envelope encryption; encrypt DOB and full legal name; log-scrubbing tests; ID images in a separate, access-logged bucket. |
| T8 | **Insider / admin abuse** — admin approves fraudulent KYC, resolves disputes in favour of an accomplice, browses PII | E, R | L | H | RBAC; admin actions go only through dedicated endpoints; **immutable audit log** of KYC decisions, dispute resolutions and suspensions with actor and IP; doc numbers never fully visible even to admins; escrow can only move via defined paths | Single admin role in MVP; no four-eyes. v2: separate roles (KYC reviewer, dispute agent, superadmin), two-person approval for resolutions above a threshold, audit log shipped to write-once external storage, periodic access review. |
| T9 | **Payment fraud / money laundering** — stolen cards funding rewards; structuring value through many small "rewards" between colluding accounts; fake deliveries to move money | Abuse, S | M | H | KYC on both sides; minimum reward (`minRewardMinor: 500`); declared-value cap (500 USD in MVP); trip capacity cap (30 kg); reward released only after the delivery code and the 48 h dispute window (or sender confirmation); audit log of every payment and release; admin can suspend | MVP has **no velocity limits, no transaction monitoring and no real PSP**. v2 before launch: regulated payment provider performing its own KYC/AML on payouts; per-user and per-pair velocity limits (count and value per 30 days); flags for repeated same-pair matches, reward far above corridor norms, and rapid deliver-after-handover; SAR process via the PSP. CarryLink must not hold client funds itself (see BUSINESS_MODEL.md, regulatory risk). |
| T10 | **Brute-forcing handover / delivery codes** | S, T | L | H | Codes are 6 digits (10^6 space) and can only be submitted by the matched traveller on their own match; **constant-time comparison**; **lock after 5 failed attempts, which automatically opens a dispute** for admin review; attempts audited. Probability of guessing within 5 tries ≈ 5 × 10⁻⁶ per match | Social engineering is the realistic route (recipient hands over the code before receiving goods). UI tells recipients: **give the code only when you have the item in your hands.** |
| T11 | **Enumeration of users** — discovering who is registered, scraping profiles | I | M | L | Generic login error for unknown email vs wrong password; rate limiting on auth routes; `PublicUser` omits email and phone; `/admin/users` is admin-only; trip/request listings only show public profile fields | Two residual oracles, both rate-limited: `POST /auth/register` returns `409 CONFLICT` for an existing email, and the per-account login lockout message only appears for existing accounts. v2: always return 201 from registration and send a "you already have an account" email; make lockout indistinguishable. |
| T12 | **Injection, XSS, CSRF** | T, E | M | H | **SQL:** parameterised statements only (Node built-in SQLite prepared statements), no string-built SQL. **Input:** Zod validation everywhere. **XSS:** API returns JSON only; React escapes rendered text by default; helmet CSP. **CSRF:** state-changing calls authenticate with a Bearer header that a cross-site form cannot set; the only cookie (`cl_refresh`) is `SameSite=Strict` and only accepted by `/auth/refresh` and `/auth/logout`; strict CORS allow-list | The web client keeps the access token in memory only, never in `localStorage` (`apps/web/src/api/client.ts`); in development Vite proxies `/api` so the refresh cookie stays same-origin. Rule to keep: never render user content with `dangerouslySetInnerHTML` (add a lint rule). Add a CSP report endpoint in v2. |
| T13 | **Malicious uploads** — malware in ID images or inspection photos | T | M | M | Content-type allow-list (image, PDF), 10 MB limit, SHA-256 recorded | Upload is **metadata-only in the MVP**: no bytes are stored or scanned. v2: pre-signed upload to object storage, server-side type sniffing, AV scan, image re-encoding (strips EXIF GPS). |
| T14 | **Companion-assist safety** — companion does not show up, or behaves inappropriately towards a vulnerable person | Abuse | L | **H** | Both sides KYC-verified; verified trip; meet-up confirmed by the handover code at origin and hand-off by the delivery code at destination; reviews; dispute and suspension | Platform cannot supervise a flight. v2: companion-specific vetting (higher trust score threshold, prior completed matches), in-app check-ins, emergency contact on the match, clear guidance that airline special-assistance services remain the primary option. |
| T15 | **Denial of service / resource abuse** | D | M | M | Per-route rate limits (auth, KYC, payment, code entry, messaging); body size limits; pagination (`page`, `pageSize`) on lists; message length 1..2000 | Global per-IP and per-user limits on every route in v2; CDN/WAF in front of the API. |
| T16 | **Repudiation of handover** — traveller or sender later disputes what was handed over | R | M | M | Handover requires code + inspection notes + photos; match `timeline` records every status change with `byUserId` and timestamp; audit log | Photos are only refs in the MVP (see T13). |

## 5. Design notes on the key controls

**Why two codes.** The handover code proves the sender consented to handing over the goods *after* the
traveller inspected them; entering it moves the match to `in_transit`. The delivery code proves the
recipient has the goods; entering it moves the match to `delivered` and starts the 48 h dispute window.
Escrow is released only when the match completes (sender confirmation or window lapse), so a
problem discovered after delivery can still be refunded. Neither code is
ever shown to the traveller by the system — they must be told it by the other party at the right moment.

**Why lockout opens a dispute rather than just blocking.** Five wrong codes means either a typo-prone
traveller or an attack. Either way a human should look at it, and the escrow must not be released or
refunded automatically.

**Why KYC gates posting, not just paying.** Posting is where prohibited goods are declared and where
scammers advertise. Requiring verified identity before a user can create any listing removes the cheap,
disposable-account attack.

**Why the traveller, not CarryLink, is the declarant.** CarryLink never takes possession of goods. The
terms require the traveller to declare items at customs where required, and the inspection record exists
precisely so that the traveller can show what they accepted and from whom.

## 6. What is mocked in the MVP and must be replaced before launch

| Component | MVP behaviour | Required before launch |
|---|---|---|
| **Payments / escrow** | Mock provider; `POST /matches/:id/pay` accepts any `paymentMethodToken` and creates an `Escrow` record with `provider`/`providerRef` placeholders. Escrow stays `held` through `delivered` and is released at `completed` (sender confirmation or auto-completion sweep); the mock `release`/`refund` calls do nothing. | Regulated PSP with marketplace support (e.g. Stripe Connect): funds authorised or collected and held by the PSP, transfer to the traveller's connected account triggered by the existing completion path; 3-D Secure; payout KYC; webhooks with signature verification; idempotency keys. |
| **ID verification** | User uploads a file ref; admin approves or rejects by hand. | IDV vendor: document authenticity, liveness/selfie match, sanctions and PEP screening, duplicate-identity detection. Admin review only for escalations. |
| **Trip verification** | `POST /trips/:id/verify` marks `verified: true` if the booking reference matches `^[A-Z0-9]{6}$`. It proves nothing. | Flight/booking verification (airline or GDS data, or boarding-pass/e-ticket parsing with name match against KYC). |
| **File storage and virus scanning** | `POST /uploads` stores metadata and returns a ref; no bytes stored. | Object storage with pre-signed uploads, AV scanning, image re-encoding/EXIF stripping, private buckets, signed short-lived read URLs, access logging. |
| **Email** | `DEV_RETURN_TOKENS=true` returns verification tokens in API responses (ignored when `NODE_ENV=production`). | Transactional email provider (SPF/DKIM/DMARC); remove the dev token path from production builds entirely. |
| **SMS** | None. Recipient phone is stored (encrypted) but not used. | SMS/WhatsApp Business notifications to the recipient (e.g. "your delivery code will be needed"), phone verification for users. |
| **Automatic completion** | Implemented: an in-process timer runs `sweepAutoComplete` every 10 minutes, and match reads run it lazily; `delivered` matches older than 48 h are completed and escrow released. | Move the sweep to a durable job scheduler with a single runner (multi-instance safe), alerting on failures, and idempotent PSP payout calls. |
| **Secrets and keys** | `JWT_SECRET`, `FIELD_ENCRYPTION_KEY` in `.env`. In development an unset `FIELD_ENCRYPTION_KEY` is derived deterministically from `JWT_SECRET` (encrypted fields survive restarts, but rotating `JWT_SECRET` then also changes the field key); with `NODE_ENV=production` an explicit `FIELD_ENCRYPTION_KEY` is mandatory and the API refuses to start without it. | Secret manager / KMS, key rotation procedure, separate keys per environment. |
| **Database** | Node built-in SQLite file. | Managed database with encryption at rest, backups, point-in-time recovery, restricted network access. |
| **Transport** | HTTP on localhost; `COOKIE_SECURE=false`. | TLS everywhere, `COOKIE_SECURE=true`, HSTS preload. |

Other known gaps to close before launch: no MFA (mandatory for admins), no transaction velocity limits,
single admin role, account-enumeration oracles (registration 409, lockout only on real accounts — a deliberate MVP trade-off), no automated evasion detection for message
redaction.

## 7. Data retention and GDPR / UK GDPR

CarryLink would be the data controller for account, KYC, transaction and messaging data. Lawful bases:
contract (running the marketplace), legal obligation (record-keeping, lawful requests from authorities),
and legitimate interests (fraud prevention, platform safety). Special-category data arises in
`medicine_rx` (health data about the patient) and must be minimised: only the item description and the
`has_prescription` attestation are collected; prescriptions themselves are not uploaded in the MVP.

**Proposed retention schedule (assumption — to be confirmed with counsel):**

| Data | Retention | Rationale |
|---|---|---|
| Account profile | Life of account + 30 days | Contract |
| KYC images | Deleted once verification decision is made (vendor retains per its own obligations) | Minimisation |
| KYC decision record (status, doc type, last 4, country, reviewer, date) | 5 years after account closure | Fraud prevention; typical AML record-keeping period |
| Matches, escrow, disputes, inspection records, audit log | 5–6 years after the transaction | Tax, payment-provider and AML record-keeping; defence of legal claims |
| Messages | 12 months after match closes, longer if the match was disputed | Dispute evidence |
| Sessions / refresh tokens | Until expiry or revocation + 30 days | Security |

**Right to erasure vs. legal hold.** On an erasure request we delete or anonymise everything not under a
retention obligation: the profile is anonymised (name replaced, email hashed, phone deleted), reviews
detached from the identity, messages deleted unless attached to a dispute. **Transaction records, escrow
records, dispute records and the audit log are retained** under legal obligation / legal-claims grounds
(UK GDPR Art. 17(3)(b) and (e)); the user is told which categories were retained and why. A match in an
open dispute places all related data under legal hold until resolution. Requests from law enforcement are
handled through a documented process and logged.

Other obligations: privacy notice at registration; data-processing agreements with every vendor;
international transfer mechanisms (corridors involve non-adequate countries); DPIA before launch (KYC,
health data, vulnerable persons in `companion_assist`); subject-access-request process with 1-month SLA.

## 8. Incident response outline

1. **Detect** — sources: audit-log alerts (refresh-token reuse spikes, code lockouts, KYC rejection
   spikes), PSP fraud alerts, user reports, customs/police contact.
2. **Triage (within 1 hour)** — classify: *safety* (a traveller detained, a companion-assist incident),
   *security* (account takeover, data exposure), *financial* (fraud ring, chargeback wave), *legal*
   (authority request). Assign an incident lead.
3. **Contain** — suspend implicated accounts; freeze affected matches (open disputes to stop escrow
   movement); revoke sessions / rotate `JWT_SECRET` (forces global re-login); rotate
   `FIELD_ENCRYPTION_KEY` via re-encryption if key exposure is suspected; disable a category or corridor
   by configuration if a pattern emerges (e.g. `electronics_inspected` being used for concealment).
4. **Preserve evidence** — export the match timeline, inspection records, messages and audit entries
   under legal hold.
5. **Support the affected user** — for a detained traveller: provide the inspection record, sender
   identity and attestations to the traveller and their lawyer on request; cooperate with authorities
   through the legal process.
6. **Notify** — personal-data breach: assess risk and notify the ICO within **72 hours** where required
   (UK GDPR Art. 33) and affected users without undue delay where high risk (Art. 34); notify the PSP
   and IDV vendor as contractually required.
7. **Recover and review** — blameless post-mortem within 2 weeks; control changes tracked to closure;
   update this threat model.
