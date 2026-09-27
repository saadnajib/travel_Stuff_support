# CarryLink — Business Model

> Every number in this document that is not a product parameter from `GET /meta/fees` is an
> **assumption**, labelled as such, to be replaced with measured data from the first corridor.
> Product parameters: platform fee **15 %** of the reward, protection fee **100 minor units** (1.00 USD)
> per transaction, minimum reward **500 minor units** (5.00 USD).

## 1. Business Model Canvas

| Block | CarryLink |
|---|---|
| **Customer segments** | (1) Senders: diaspora households needing documents, prescription medicine, gifts or electronics moved to/from family. (2) Travellers: diaspora members, students and frequent visitors flying the corridor with spare allowance. (3) Companion-seekers: families of elderly or first-time travellers. Later: SMEs sending documents and samples on the same corridors. |
| **Value propositions** | Senders: a verified traveller, money held until delivery, a dispute process. Travellers: know exactly what you carry, inspection evidence, guaranteed payment. Companion-seekers: a vetted, reviewed companion with step confirmations. For all: rules that make the informal practice defensible. |
| **Channels** | Diaspora WhatsApp and Facebook groups (seeded by ambassadors); mosques, community centres, student societies; referrals from completed matches; later: search and airline/travel-agent partnerships. |
| **Customer relationships** | Self-serve web app; in-app messaging within a match; human dispute resolution; community ambassadors per city; reviews and trust score as the relationship memory. |
| **Revenue streams** | 15 % platform fee on the reward; fixed protection fee per transaction. Later: premium verification badge, insurance upsell (commission), B2B corridor accounts. |
| **Key resources** | Verified user base on a corridor (liquidity); trust and review graph; evidence and dispute tooling; category rules and prohibited-item lists per corridor; brand trust within specific communities. |
| **Key activities** | KYC and trip verification; matching; dispute resolution; policy maintenance per corridor (customs, medicine rules); community seeding; fraud monitoring. |
| **Key partners** | Payment provider with marketplace/escrow support (e.g. Stripe Connect); IDV vendor; flight/booking verification provider; insurer; community organisations and ambassadors; later: pharmacies (`medicine_rx`), retailers (`purchase_for_me`). |
| **Cost structure** | Payment processing and payouts; IDV per check; support and dispute handling; engineering; legal/compliance per corridor; insurance; community acquisition (ambassadors, referral credits). |

## 2. Revenue streams

| Stream | Status | Mechanism | Notes |
|---|---|---|---|
| Platform fee | MVP | 15 % of `agreedRewardMinor` → `platformFeeMinor` | Charged to the sender on top of the reward (the traveller receives the full agreed reward). |
| Protection fee | MVP | Fixed 100 minor units per transaction → `protectionFeeMinor` | Funds dispute handling and the loss reserve. Kept flat so it is easy to explain. |
| Premium verification badge | Later | Paid enhanced check (e.g. address verification, longer history) for frequent travellers | Only if it adds real signal; must not become "pay to look trustworthy". |
| Insurance upsell | Later (v2) | Declared-value cover sold at checkout via an insurer; CarryLink earns a commission | Requires an insurer partner and a regulated distribution arrangement. |
| B2B corridor accounts | Later (v3) | Monthly account for SMEs sending documents/samples; invoicing, higher caps within the rules | Different KYB process. |

The sender pays `totalChargeMinor = agreedRewardMinor + platformFeeMinor + protectionFeeMinor`
(this is how we read the `Match` fields in API.md; the implementation is authoritative).

## 3. Unit economics — one transaction

### Worked example: reward 4000 minor units (40.00 USD)

| Line | Minor units | USD | Basis |
|---|---:|---:|---|
| Agreed reward (to traveller) | 4000 | 40.00 | Agreed in the match |
| Platform fee (15 %) | 600 | 6.00 | Product parameter |
| Protection fee | 100 | 1.00 | Product parameter |
| **Total charged to sender** | **4700** | **47.00** | reward + fees |
| **CarryLink gross revenue** | **700** | **7.00** | platform fee + protection fee |
| Payment processing (~3 % of 4700) | −141 | −1.41 | **Assumption.** Card processing on the full charge; a fixed per-transaction fee may apply on top |
| Payout to traveller (bank/FX) | −50 | −0.50 | **Assumption** (range 0.25–1.00 USD) |
| Expected dispute losses | −30 | −0.30 | **Assumption:** 3 % dispute rate × 10 USD average platform-borne cost |
| IDV cost, amortised | −75 | −0.75 | **Assumption:** 1.50 USD per check × 2 parties ÷ 4 lifetime matches each |
| Support time | −125 | −1.25 | **Assumption:** ~5 min of agent time at 15 USD/h |
| **Contribution per transaction** | **≈ 279** | **≈ 2.79** | ≈ 40 % of gross revenue, ≈ 7 % of reward |

### Sensitivity to reward size (same assumptions)

| Reward | Gross revenue | Processing (3 %) | Other variable costs | Contribution |
|---:|---:|---:|---:|---:|
| 20.00 USD | 4.00 | 0.72 | 2.80 | **0.48** |
| 40.00 USD | 7.00 | 1.41 | 2.80 | **2.79** |
| 50.00 USD | 8.50 | 1.76 | 2.80 | **3.94** |
| 80.00 USD | 13.00 | 2.79 | 2.80 | **7.41** |

What this tells us:
- Small-reward transactions barely pay for themselves because IDV, support and payout costs are roughly
  fixed. The minimum reward (5 USD) is a floor for the product, not an economic floor; the effective
  economic floor under these assumptions is around 20 USD. If data confirms this, raise the protection
  fee or the minimum reward before cutting controls.
- The biggest levers are **support minutes per match** (automation, clear rules, good UX) and **repeat
  usage** (amortises IDV and acquisition).

## 4. Cost structure

| Category | Type | Notes |
|---|---|---|
| Payment processing and payouts | Variable | Largest variable cost. Negotiate marketplace pricing once volume exists. |
| IDV checks | Variable per new user | Paid whether or not the user ever transacts; drives activation focus. |
| Support and disputes | Semi-variable | Disputes above the auto-policy threshold (default $50) always get human review; the AI dispute officer drafts every case and settles only small, clear-cut ones (see OPERATIONS.md). Routine questions should be deflected by product. |
| Insurance / loss reserve | Variable | Funded by the protection fee. |
| Engineering and product | Fixed | Founding team. |
| Legal and compliance | Fixed + per corridor | Customs and medicine rules per country; terms; privacy; payments structuring. |
| Infrastructure and tooling | Fixed | Small at MVP scale. |
| Community acquisition | Variable | Ambassador commissions, referral credits. |

## 5. Customer acquisition cost (WhatsApp-community seeding)

Channel: community ambassadors who are already trusted members of diaspora WhatsApp groups; they answer
"is anyone travelling…" posts with a CarryLink link and onboard people personally.

| Assumption | Value | Note |
|---|---|---|
| Ambassador commission per **activated** user (KYC verified + first completed match) | 3–10 USD | Paid only on activation, not sign-up |
| Referral credit (given to referrer and referee on first completed match) | 2–5 USD each | Funded as marketing |
| IDV cost for users who verify but never transact | adds 20–40 % on top | Assumption: 20–40 % of verified users do not transact in 90 days |
| **Blended CAC per activated user** | **8–20 USD** | Assumption |
| Contribution per match (at ~40–50 USD reward) | 2.80–3.90 USD | From section 3 |
| **Matches per user to pay back CAC** | **≈ 2–7** | Repeat rate is therefore the key metric |

Senders on these corridors have recurring needs (paperwork, medicine refills, festivals), which is why
repeat rate is plausible — but it is an assumption until measured.

## 6. Break-even sketch

Formula:

```
Break-even matches per month = Fixed monthly costs / Contribution per match
Contribution per match       = (platform fee + protection fee)
                               − processing − payout − expected dispute losses − amortised IDV − support
```

**Scenario (all inputs are assumptions):**

| Input | Value |
|---|---|
| Fixed monthly costs (two founders on modest salaries, legal/compliance retainer, infrastructure, insurance) | 20,000 USD |
| Average reward | 50 USD |
| Contribution per match (section 3 table, rounded) | 3.94 USD |
| **Break-even matches per month** | **20,000 / 3.94 ≈ 5,080** |
| Of which from repeat users (at 60 % repeat share) | ≈ 3,050 |

Honest reading: one corridor at MVP pricing is unlikely to reach ~5,000 matches a month quickly. The
path to break-even is a combination of (a) more corridors on the same fixed base, (b) a higher average
reward mix (`purchase_for_me`, `electronics_inspected`, `companion_assist`), (c) lower support minutes per
match, and (d) ancillary revenue (insurance commission, B2B accounts). A useful intermediate milestone is
**positive contribution after CAC** on the first corridor, which proves the model before scaling.

### Market size (ranges, not forecasts)

We deliberately do not quote a single market-size figure. The bottom-up formula for one corridor:

```
Addressable matches / year = passenger journeys on corridor / year
                           × share of journeys with a willing, verified traveller
                           × average carries per willing journey
                           (bounded by demand actually posted)
```

For UK ↔ Pakistan, journeys are plausibly in the hundreds of thousands to low millions per year
(**assumption — verify with aviation statistics**), the population of Pakistani ethnicity in England and Wales
is well over one million (2021 Census), and a willing-traveller share of 2–10 % is an **assumption** to be tested
by the validation survey ([GO_TO_MARKET.md](./GO_TO_MARKET.md)). Even the low end of these ranges is
large relative to break-even, so the binding constraint is liquidity and trust, not market size.

## 7. Key metrics

| Metric | Definition | Why it matters | Early target (assumption) |
|---|---|---|---|
| Completed matches / month | Matches reaching `completed` or `resolved` with `pay_traveler` | Core volume | 100 by day 90 on one corridor |
| Match rate | Requests that reach `funded` ÷ requests posted | Liquidity | > 30 % |
| Take rate | (platform fee + protection fee) ÷ total charged | Monetisation | ≈ 15 % at 40 USD reward |
| Dispute rate | Matches reaching `disputed` ÷ matches `funded` | Trust and cost | < 5 % |
| Fraud rate | Disputes resolved with suspension for fraud ÷ matches `funded` | Safety | < 0.5 % |
| Repeat rate | Users with ≥ 2 completed matches in 90 days ÷ users with ≥ 1 | CAC payback | > 20 % by day 90; > 30 % steady state |
| KYC completion | `verified` ÷ registered | Funnel health | > 50 % |
| Time to match | Median time from request `open` to match `funded` | Experience | < 5 days |
| Support minutes / match | Agent time ÷ completed matches | Unit economics | < 5 min |

## 8. Main risks and mitigations

| Risk | Description | Mitigation |
|---|---|---|
| **Regulatory — payments** | Holding and moving customer money for others is generally a regulated payment activity in the UK and in most target countries. | Never hold funds on CarryLink's own balance sheet; use a regulated PSP's marketplace product so funds are held and paid out by the PSP. |
| **Regulatory — customs and goods** | Carrying goods for others can breach customs rules, personal allowances, or medicine import rules; the traveller bears the liability. | Restricted categories, value/weight caps, inspection, attestations, traveller-as-declarant in terms, per-corridor legal review before enabling each category (especially `medicine_rx`), prohibited list per destination. |
| **Regulatory — data** | KYC and health-adjacent data; cross-border transfers. | UK GDPR programme (see SECURITY.md), minimal data, vendor DPAs, DPIA. |
| **Liquidity / chicken-and-egg** | Senders leave if there are no travellers; travellers leave if there are no requests. | One corridor, one city pair first; supply-seeded via ambassadors; harvest existing WhatsApp demand; `purchase_for_me` requests are date-flexible and fill gaps. See GO_TO_MARKET.md. |
| **Trust incident** | A traveller detained with contraband from a CarryLink sender, or harm to an accompanied person. A single incident could end the business in a community where word travels fast. | The product rules are designed around this; incident response plan; category kill-switches; transparent communication; insurance in v2; no growth target that requires loosening controls. |
| **Disintermediation** | After the first match, parties transact directly. | Message redaction, escrow and reviews make on-platform strictly better; protection fee kept low; repeat-user benefits. Accept some leakage. |
| **Seasonality** | Travel peaks around holidays, Eid, wedding season. | Plan cash and marketing around peaks; multiple corridors smooth seasonality over time. |
| **Unit economics** | Contribution per match is thin at small rewards (section 3). | Measure support minutes and repeat rate early; adjust protection fee / minimum reward; add ancillary revenue. |
