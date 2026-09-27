# CarryLink API Contract (v1)

Base URL: `http://localhost:4000/api/v1`. All bodies are JSON. Auth is a Bearer access token
(15 min) in the `Authorization` header plus an httpOnly refresh cookie (`cl_refresh`, 30 days, rotated on every refresh).

Error shape: `{ "error": { "code": "STRING_CODE", "message": "human text", "details"?: any } }`.
Common codes: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404),
`CONFLICT` (409), `KYC_REQUIRED` (403), `EMAIL_NOT_VERIFIED` (403), `ACCOUNT_SUSPENDED` (403), `PROHIBITED_ITEM` (422), `INVALID_STATE` (409),
`INVALID_CODE` (400, `details.attemptsLeft`), `MATCH_LOCKED` (423), `PAYMENT_DECLINED` (402), `RATE_LIMITED` (429).

Money is integer minor units (cents) with a 3-letter `currency` (default `USD`). Dates are ISO-8601 strings.

## Enums

- `Role`: `user | admin`
- `KycStatus`: `none | pending | verified | rejected`
- `DocType`: `passport | national_id | driving_licence`
- `Category`: `documents | purchase_for_me | gifts_inspected | electronics_inspected | medicine_rx | companion_assist`
- `TripStatus`: `published | completed | cancelled`
- `RequestStatus`: `open | matched | in_transit | delivered | completed | cancelled | disputed`
- `MatchStatus`: `proposed | accepted | funded | in_transit | delivered | completed | declined | cancelled | disputed | resolved`
- `EscrowStatus`: `held | released | refunded | split`
- `DisputeStatus`: `open | resolved`
- `DisputeResolution`: `refund_sender | pay_traveler | split`

## Objects

```ts
User { id, email, name, role, emailVerified: boolean, kycStatus, trustScore: number, ratingAvg: number|null, ratingCount: number, phoneMasked: string|null, suspended: boolean, createdAt }
PublicUser { id, name, kycStatus, trustScore, ratingAvg, ratingCount, memberSince }
Trip { id, traveler: PublicUser, originCountry, originCity, destCountry, destCity, departDate, arriveDate, capacityKg: number, allowedCategories: Category[], verified: boolean, status, notes: string|null, createdAt }
DeclaredItem { name: string, qty: number, valueMinor: number }
DeliveryRequest { id, sender: PublicUser, originCountry, originCity, destCountry, destCity, category, title, description, items: DeclaredItem[], weightKg, declaredValueMinor, rewardMinor, currency, neededByDate, recipientName, status, attestations: string[], createdAt }
Match { id, request: DeliveryRequest, trip: Trip, proposedBy: 'sender'|'traveler', status, agreedRewardMinor, platformFeeMinor, protectionFeeMinor, totalChargeMinor, currency, escrow: Escrow|null, inspectionNotes: string|null, inspectionPhotoRefs: string[], timeline: {status, at, byUserId}[], createdAt }
Escrow { id, status, amountMinor, feeMinor, currency, provider, providerRef, heldAt, releasedAt|null }
Message { id, matchId, senderId, body, redacted: boolean, createdAt }
Dispute { id, matchId, openedBy, reason, details, status, resolution|null, adminNotes|null, createdAt, resolvedAt|null }
Review { id, matchId, reviewerId, revieweeId, rating: 1..5, comment, createdAt }
```

## Endpoints

### Meta
- `GET /health` -> `{ ok: true, version }`
- `GET /meta/categories` -> `{ categories: {key, label, description, requiresInspection, requiresPrescription, maxValueMinor, maxWeightKg}[] }`
- `GET /meta/prohibited` -> `{ items: string[] }`
- `GET /meta/fees` -> `{ platformFeePct: 15, protectionFeeMinor: 100, minRewardMinor: 500 }`

### Auth
- `POST /auth/register` `{ email, password (>=10 chars), name }` -> 201 `{ user, devVerificationToken? }`
- `POST /auth/verify-email` `{ token }` -> `{ ok }`
- `POST /auth/resend-verification` (auth) -> `{ ok, devVerificationToken? }`
- `POST /auth/login` `{ email, password }` -> `{ accessToken, user }` + sets refresh cookie. 401 `INVALID_CREDENTIALS` on failure (same message for unknown email).
- `POST /auth/refresh` (cookie) -> `{ accessToken, user }` + rotated cookie. 401 if reused/revoked token (whole family revoked).
- `POST /auth/logout` (cookie) -> `{ ok }`
- `GET /me` (auth) -> `{ user }`
- `PATCH /me` `{ name?, phone? }` -> `{ user }` (phone stored encrypted, only masked form returned)
- `GET /me/sessions` -> `{ sessions: {id, createdAt, lastUsedAt, ip, userAgent, current}[] }`
- `DELETE /me/sessions/:id` -> `{ ok }`

### KYC
- `POST /kyc/submit` `{ docType, docNumber, fullName, dateOfBirth (YYYY-MM-DD), country (ISO2), fileRef }` -> `{ kycStatus: 'pending' }` (409 if already pending/verified)
- `GET /kyc/status` -> `{ kycStatus, submittedAt|null, reviewedAt|null, rejectionReason|null }`

### Uploads (dev/mock: stores metadata, returns a ref)
- `POST /uploads` `{ filename, contentType, sizeBytes, sha256 }` -> `{ ref, uploadUrl }` (max 10 MB, image/pdf only)

### Trips
- `POST /trips` (auth, email verified, KYC verified) `{ originCountry, originCity, destCountry, destCity, departDate, arriveDate, capacityKg (0.1..30), allowedCategories: Category[], bookingRef?, notes? }` -> 201 `{ trip }`
- `GET /trips?from=ISO2&to=ISO2&dateFrom&dateTo&category&page&pageSize` -> `{ trips, page, pageSize, total }` (only `published`, future trips, from verified travelers)
- `GET /trips/mine` -> `{ trips }`
- `GET /trips/:id` -> `{ trip }`
- `PATCH /trips/:id` (owner) partial -> `{ trip }`
- `POST /trips/:id/verify` `{ bookingRef, airline }` -> `{ trip }` (mock verification; marks `verified: true` when ref matches `^[A-Z0-9]{6}$`)
- `POST /trips/:id/cancel` -> `{ trip }` (409 if any match is funded or later)

### Requests
- `POST /requests` (auth, email verified, KYC verified) `{ originCountry, originCity, destCountry, destCity, category, title, description, items: DeclaredItem[], weightKg, rewardMinor, currency?, neededByDate, recipientName, recipientPhone, attestations: string[] }` -> 201 `{ request }`
  - Server checks: prohibited keywords in title/description/items -> 422 `PROHIBITED_ITEM` with `details.matched`; category caps on weight/value; required attestation keys `["items_unsealed","no_prohibited","truthful_declaration","accept_inspection"]` (+ `"has_prescription"` for `medicine_rx`).
- `GET /requests?from&to&category&dateTo&page&pageSize` -> `{ requests, page, pageSize, total }` (only `open`)
- `GET /requests/mine` -> `{ requests }`
- `GET /requests/:id` -> `{ request }`
- `PATCH /requests/:id` (owner, only while `open`) -> `{ request }`
- `POST /requests/:id/cancel` -> `{ request }` (409 if a match is funded or later)

### Matches
- `POST /matches` `{ requestId, tripId }` -> 201 `{ match }`. Caller must own the request (proposes to traveler) or the trip (offers to sender). Both parties must be KYC verified. Route countries must match, the trip must depart on or before `neededByDate`, the category must be allowed on the trip, the trip must be verified, and the request weight must fit the remaining capacity (every match not proposed/declined/cancelled consumes capacity).
- `GET /matches` -> `{ matches }` (mine, both sides)
- `GET /matches/:id` (party or admin) -> `{ match }`
- `POST /matches/:id/accept` (the party who did not propose) -> `{ match }` status `accepted`
- `POST /matches/:id/decline` -> `{ match }`
- `POST /matches/:id/cancel` (either party, only before `funded`) -> `{ match }`
- `POST /matches/:id/pay` (sender, status `accepted`) `{ paymentMethodToken }` -> `{ match, codes: { handoverCode, deliveryCode } }`. Creates escrow (mock provider; `tok_test_visa` succeeds, `tok_test_declined` -> 402 `PAYMENT_DECLINED`). Codes are 6 digits, stored only as keyed hashes plus an encrypted copy readable by the sender via `/codes`.
- `GET /matches/:id/codes` (sender only, status funded/in_transit) -> `{ handoverCode, deliveryCode }`
- `POST /matches/:id/handover` (traveler, status `funded`) `{ code, inspectionNotes, photoRefs: string[] (>=1, must be the traveler's own uploads) }` -> `{ match }` status `in_transit`. A wrong code returns `INVALID_CODE`; 5 wrong attempts (handover or delivery) lock the match (`MATCH_LOCKED`, 423) and open a dispute automatically.
- `POST /matches/:id/deliver` (traveler, status `in_transit`) `{ code }` -> `{ match }` status `delivered`; request `delivered`. **Escrow stays `held`** so a dispute raised after delivery still has funds.
- `POST /matches/:id/complete` (sender, status `delivered`) -> `{ match }` status `completed`; escrow `released` to the traveler; trust scores updated. Delivered matches not completed or disputed within 48h are auto-completed by the server sweep (timeline entry has `byUserId: null`).
- `POST /matches/:id/dispute` (either party, status funded/in_transit/delivered) `{ reason, details }` -> 201 `{ dispute, match }` status `disputed`
- `POST /matches/:id/review` (either party, status delivered/completed/resolved) `{ rating 1..5, comment }` -> 201 `{ review }` (one per reviewer per match)
- `GET /matches/:id/messages?after=cursor` -> `{ messages }`
- `POST /matches/:id/messages` `{ body (1..2000) }` -> 201 `{ message }`. Phone numbers, emails, external links and messenger handles are replaced with `[hidden: keep contact on CarryLink]` and `redacted: true`. Allowed while status is `accepted`, `funded`, `in_transit`, `delivered` or `disputed` (parties need to exchange evidence during a dispute).

### Admin (role admin)
- `GET /admin/kyc/pending` -> `{ submissions: {id, user: PublicUser, docType, docNumberLast4, fullName, dateOfBirth, country, fileRef, submittedAt}[] }` (full document number is never returned)
- `POST /admin/kyc/:id/decision` `{ decision: 'approve'|'reject', reason? }` -> `{ ok }`
- `GET /admin/disputes?status=open` -> `{ disputes: (Dispute & { match: Match })[] }`
- `POST /admin/disputes/:id/resolve` `{ resolution, notes }` -> `{ dispute, match }` (escrow refunded / released / split 50-50)
- `GET /admin/users?q=` -> `{ users: User[] }`
- `POST /admin/users/:id/suspend` `{ suspended: boolean, reason }` -> `{ user }`
- `GET /admin/audit?limit=100&before=` -> `{ entries: {id, actorId, action, entity, entityId, meta, ip, createdAt}[] }`

## Match lifecycle

```
proposed -> accepted -> funded -> in_transit -> delivered -> completed (sender confirms, or 48h sweep)
   |          |            |          |             |
 declined  cancelled     disputed  disputed      disputed -> resolved (admin: refund_sender | pay_traveler | split)

Escrow: held at `funded`, stays held through `delivered`, released at `completed`; refunded/released/split at `resolved`.
```

## Dev seed

`npm run seed -w apps/api` creates: admin `admin@carrylink.dev` / `Admin-Passw0rd!`, traveler `traveler@carrylink.dev` / `Traveler-Passw0rd!` (KYC verified, one verified trip LHR->ISB), sender `sender@carrylink.dev` / `Sender-Passw0rd!` (KYC verified, one open documents request LHR->ISB).
