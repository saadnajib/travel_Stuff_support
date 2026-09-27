# CarryLink — Product

> Status: MVP specification. The API contract in [API.md](./API.md) is the source of truth for entity
> names, statuses and the match lifecycle. Where this document and API.md disagree, API.md wins and
> this document is wrong.

## 1. The problem

In diaspora WhatsApp groups the same posts appear every week:

- "Is anyone travelling from the UK to Pakistan next week? I need to send documents / medicine / a gift."
- "Is anyone coming back from Dubai? Can you bring me X?"
- "My mother is flying alone to Lahore on the 14th. Is anyone on the same flight who could help her?"

Three things are true about this behaviour:

1. **Demand is real and recurring.** It is driven by family ties, life events (weddings, Eid, funerals,
   university admissions, property and legal paperwork) and by price or availability gaps between
   countries. It does not go away when one request is fulfilled.
2. **Supply is ad hoc.** Plenty of people travel on these routes with spare luggage allowance and are
   willing to help, but there is no way to find them other than broadcasting to a group and hoping.
3. **Trust is zero.** The sender does not know the traveller. The traveller does not know what is in
   the package. Nobody has recourse when something goes wrong. People get scammed (deposits taken, items
   never delivered), and — worse — travellers can unknowingly carry prohibited or controlled items,
   for which the traveller, not the sender, is legally responsible at the border.

The existing channel works just well enough that people keep using it, and just badly enough that the
failures are serious.

## 2. What CarryLink is (and is not)

CarryLink is a **verified peer-to-peer marketplace** that connects travellers who have spare luggage
capacity or spare time with people who need something **carried, bought, or someone accompanied** along
the same route.

It is **not** a "carry my sealed parcel" app. That model has a well-understood failure mode: the
traveller cannot know what they are carrying, and the platform becomes an ideal channel for smuggling.
Every design decision below exists to avoid that failure mode.

| Principle | What it means in the product |
|---|---|
| Restricted categories only | Six categories, each with its own rules and caps. Anything else cannot be posted. |
| Nothing sealed | The traveller physically inspects and photographs every item at handover and attests to it in-app. "Sealed" means wrapped, taped or packed by the sender; unopened manufacturer retail packaging whose contents match the declaration is acceptable, and the traveller may still ask for it to be opened. |
| Everyone verified | Email + government-ID KYC for both sides before posting or matching. Trips verified against a booking reference. |
| Money in escrow | The sender pays when a match is accepted; the traveller is paid only after the recipient confirms delivery with a code. |
| Evidence stays on-platform | In-app messaging with contact-detail redaction; inspection notes, photos, timeline and audit log form the evidence trail. |
| Clear legal posture | The traveller is the declarant to customs. CarryLink provides tooling and an evidence trail and never handles goods. |

### The six categories

Category keys are exactly those in the API (`Category` enum). The authoritative caps and flags are served
by `GET /meta/categories` (defined in `apps/api/src/domain/categories.ts`); the values below are the MVP
configuration at the time of writing.

| Key | What it covers | Inspection | Max weight | Max declared value | Notes |
|---|---|---|---:|---:|---|
| `documents` | Paper documents: certificates, legal papers, university transcripts | Required | 2 kg | 200 USD | Envelopes must be open for inspection at handover. |
| `purchase_for_me` | The traveller buys the item themselves from a retailer and brings it | Required | 10 kg | 500 USD | The Grabr-style model. The traveller knows exactly what the item is because they bought it. |
| `gifts_inspected` | Clothing, toys, non-perishable sweets supplied by the sender | Required | 8 kg | 300 USD | Unwrapped and inspected item by item. |
| `electronics_inspected` | Phones, laptops, accessories supplied by the sender | Required | 5 kg | 500 USD | Powered on and checked against the declaration; batteries in hand luggage. |
| `medicine_rx` | Prescription medicine for a named patient | Required | 2 kg | 300 USD | Sender must attest `has_prescription`; original pharmacy packaging. OTC-only and controlled substances are blocked. Destination rules vary; see SECURITY.md. |
| `companion_assist` | Accompanying an elderly or first-time traveller; airport help | Not applicable | 0 | 0 | No goods: the API rejects items or weight on this category. The code mechanism confirms the meet-up and the arrival hand-off. |

Global MVP limits: declared value never above **500 USD** per request; trip capacity at most **30 kg**
(`capacityKg` 0.1..30); reward between **5 USD** (`minRewardMinor: 500`) and 1,000 USD.

## 3. Who the users are

Initial users are diaspora communities on high-frequency family corridors. Illustrative examples:

| Corridor | Typical demand |
|---|---|
| UK ↔ Pakistan | Documents (NADRA, property, legal), prescription medicine, gifts for weddings/Eid, electronics |
| UAE ↔ India | Documents, gifts, electronics bought in the Gulf, parents flying alone |
| US ↔ Nigeria | Documents, electronics and branded goods purchased in the US, medicine |
| Germany ↔ Turkey | Documents, gifts, elderly relatives travelling |

We launch on **one** corridor (UK ↔ Pakistan) — see [GO_TO_MARKET.md](./GO_TO_MARKET.md) for why.

### Personas

**1. Sender — "Ayesha", 34, Birmingham.**
Needs her attested degree certificate delivered to her brother in Islamabad within two weeks, and
periodically sends her father his prescription medication. Currently posts in three WhatsApp groups and
pays a courier 40–60 GBP when nobody replies (price range is an assumption). Wants: speed, certainty
that it arrives, and not being scammed. Fears: handing things to a stranger, losing a deposit.

**2. Traveller — "Bilal", 27, Manchester.**
Flies home two or three times a year with 10–20 kg of unused allowance. Happy to help and to earn
something towards the ticket, but has heard stories of people being stopped at customs with things that
were not theirs. Wants: to know exactly what he is carrying, to be paid reliably, and to not waste time.
Fears: carrying something illegal; being blamed for a missing item; being hassled on arrival.

**3. Companion-seeker — "Rehana" (on behalf of her mother, 71).**
Her mother is flying alone from London to Lahore and speaks limited English. Rehana wants someone on the
same route to meet her mother at check-in, help her through transfers and hand her over to family at
arrivals. No goods involved. Wants: a verified, well-reviewed person and confirmation at each step.
Fears: the stranger not turning up; safety of a vulnerable relative.

The **recipient** (the person receiving goods, or the family meeting the accompanied traveller) is not a
platform user in the MVP. They are recorded as `recipientName` / `recipientPhone` on the request and their
only interaction is giving the traveller the delivery code.

## 4. Value proposition

| For | Today (WhatsApp) | With CarryLink |
|---|---|---|
| Sender | Broadcast and hope; pay a stranger in cash or up front; no recourse | Search verified trips on the route; pay into escrow; money released only after the recipient hands over the delivery code; dispute process |
| Traveller | Carry an unknown sealed parcel on trust; chase payment | Only restricted categories; inspect and photograph everything before accepting it; payment secured before handover; attestation trail if questioned |
| Companion-seeker | Ask strangers in a group; no vetting | ID-verified companion with reviews; codes confirm the meet-up and the arrival hand-off |

The honest summary: CarryLink is slower and more structured than a WhatsApp post, and it deliberately
refuses a large share of what people currently send. The trade is that what remains is verifiable, paid
and defensible.

## 5. Deliberately out of scope

| Out of scope | Why |
|---|---|
| Sealed or wrapped parcels of unknown content | The core smuggling/muling risk. Non-negotiable. |
| Cash, currency, gold, jewellery above cap | Money-laundering and theft risk; customs reporting thresholds. |
| Food other than retail-packaged sweets/snacks, plants, animals | Biosecurity rules differ by country; high refusal risk. |
| Controlled drugs, OTC medicine "for a friend", supplements of unknown provenance | Legal exposure for the traveller; screened by keyword and category rules. |
| Weapons, vapes/e-cigarettes, lithium batteries beyond device use, chemicals | Aviation and customs restrictions. |
| Commercial quantities / reselling | Traveller personal allowances do not cover commercial import; duty evasion. |
| CarryLink physically handling items (warehouses, lockers) | Different regulatory and liability regime; not our business. |
| Guaranteed delivery dates | Flights change. We verify trips, we do not underwrite them. |
| Unaccompanied minors | Airlines run regulated services for this; peer companions are adults assisting adults. |
| Real-time chat outside the match | Messaging only exists inside a match (`accepted` through `delivered`, and during a dispute), which keeps it on-topic and auditable. |

## 6. MVP feature list mapped to the API

All paths are relative to `/api/v1`.

| Feature | Endpoints | Notes |
|---|---|---|
| Registration, email verification | `POST /auth/register`, `POST /auth/verify-email`, `POST /auth/resend-verification` | Password ≥ 10 chars. Dev mode returns the verification token instead of emailing it. |
| Login, sessions | `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /me/sessions`, `DELETE /me/sessions/:id` | 15-min access token + rotating 30-day refresh cookie `cl_refresh`. |
| Profile | `GET /me`, `PATCH /me` | Phone stored encrypted; only `phoneMasked` returned. |
| KYC | `POST /uploads`, `POST /kyc/submit`, `GET /kyc/status` | ID image uploaded as a ref; admin approves. Mocked vendor in MVP. |
| Category rules, prohibited list, fees | `GET /meta/categories`, `GET /meta/prohibited`, `GET /meta/fees` | Displayed in the posting forms so rules are visible before submission. |
| Post and manage a trip | `POST /trips`, `GET /trips/mine`, `PATCH /trips/:id`, `POST /trips/:id/cancel` | Requires verified email + KYC. Capacity 0.1–30 kg. |
| Verify a trip | `POST /trips/:id/verify` | Mock: accepts a 6-char alphanumeric booking reference. Only verified trips can be matched. |
| Search trips | `GET /trips` | Published, future, verified travellers only. Filters: route, dates, category. |
| Post and manage a request | `POST /requests`, `GET /requests/mine`, `PATCH /requests/:id`, `POST /requests/:id/cancel` | Server-side prohibited-keyword screening, category caps, mandatory attestations. |
| Search requests | `GET /requests` | Open requests only. Travellers browse and offer. |
| Propose / accept / decline / cancel a match | `POST /matches`, `POST /matches/:id/accept`, `.../decline`, `.../cancel` | Either side can propose; the other side accepts. Every match that is not `proposed`, `declined` or `cancelled` counts against the trip's capacity (including completed and resolved ones). |
| Pay into escrow | `POST /matches/:id/pay`, `GET /matches/:id/codes` | Returns the handover and delivery codes to the sender. Mock payment provider; a decline returns `402 PAYMENT_DECLINED`. |
| Handover with inspection | `POST /matches/:id/handover` | Traveller enters handover code + inspection notes + ≥ 1 photo ref. |
| Delivery | `POST /matches/:id/deliver` | Traveller enters the delivery code from the recipient. Match `delivered`; escrow stays held while the 48 h dispute window runs. Wrong code: `400 INVALID_CODE` with `attemptsLeft`; 5 failures: `423 MATCH_LOCKED` + automatic dispute. |
| Completion | `POST /matches/:id/complete` | Sender confirms, or the auto-completion sweep completes the match when the 48 h window lapses. Escrow released to the traveller here. |
| Disputes | `POST /matches/:id/dispute`, `GET /admin/disputes`, `POST /admin/disputes/:id/resolve` | Admin resolves: `refund_sender`, `pay_traveler`, `split` (50/50). |
| Messaging | `GET/POST /matches/:id/messages` | Open from `accepted` to `delivered` and during a dispute (so both parties can provide evidence). Phones, emails, links and messenger handles replaced with `[hidden: keep contact on CarryLink]`. |
| Reviews and trust | `POST /matches/:id/review` | One review per party per match; feeds `ratingAvg`, `ratingCount`. `trustScore` (0–100, starts at 50) rises at completion (+3 traveller, +2 sender) and falls by 10 for the losing party of a `refund_sender` / `pay_traveler` resolution. |
| Admin console | `GET /admin/kyc/pending`, `POST /admin/kyc/:id/decision`, `GET /admin/users`, `POST /admin/users/:id/suspend`, `GET /admin/audit` | Document numbers never shown in full (last 4 only). |

## 7. Roadmap

| Version | Scope |
|---|---|
| **v1 — MVP** (this repo) | Everything in section 6. Mock payment provider, mock ID verification (admin review), mock trip verification, mock file storage, dev-mode email tokens. One corridor. Web app only. |
| **v2 — Launchable** | Real payments and payouts via a regulated provider (Stripe Connect or equivalent) so CarryLink never holds client funds; real IDV vendor (document + liveness + sanctions/PEP screening); flight/booking verification API; object storage with virus scanning; transactional email and SMS; push notifications; insurance partner for declared-value cover; automatic completion job for the 48 h window; velocity limits and fraud scoring. |
| **v3 — Expansion** | Additional corridors (UAE ↔ India, US ↔ Nigeria, Germany ↔ Turkey); business/SME corridor accounts (documents and samples for small firms, with invoicing); pharmacy partners for `medicine_rx` (pharmacy dispenses and packs against a verified prescription, traveller collects); mobile apps. |

## 8. Competitive landscape

| Player | Model | Where it is strong | Where CarryLink differs |
|---|---|---|---|
| **WhatsApp / Facebook groups** (status quo) | Free broadcast to a community | Zero cost, huge reach, instant, culturally native | No identity, no escrow, no rules on what is carried, no recourse. CarryLink must beat it on trust, not on convenience — and must recruit from it (see GO_TO_MARKET.md). |
| **Grabr** | Buy-for-me marketplace: shoppers request items, travellers buy and bring them | Proven that travellers will carry items they purchased themselves; clean customs story | Grabr centred its model on buying from retailers rather than carrying items from strangers. CarryLink includes `purchase_for_me` as one category but is built around diaspora family needs (documents, medicine, companions) on specific corridors. |
| **PiggyBee** | Peer-to-peer crowdshipping between senders and travellers, largely Europe-originated | Simple sender↔traveller matching | Generalist and lighter on verification as we understand it. CarryLink restricts categories, mandates inspection, and gates on KYC and escrow. |
| **Airmule** (defunct) | Peer-to-peer delivery via travellers | Showed the demand exists | Shut down. We treat it as a cautionary case: open-ended "send anything" models carry concentrated legal and trust risk and struggle to build liquidity. We do not claim to know its internal reasons beyond that. |
| **Roadie** (domestic US, acquired by UPS) | Crowdsourced same-day/local delivery by drivers already on the road | Scale and logistics integration | Domestic only, no customs dimension. Illustrates that "people already going that way" is a viable supply model when it is structured. |

Honest differentiation: none of CarryLink's individual controls is novel. The bet is that a
corridor-focused product that combines **restricted categories, mandatory inspection, two-code escrow
and verified identities** fits diaspora family needs better than either a generalist crowdshipping app
or an unstructured WhatsApp group — and that this combination makes the traveller side safe enough to
recruit at scale.
