# CarryLink — Go-to-Market

> Targets and thresholds in this document are **assumptions** to be replaced with data from the
> validation survey and the first corridor.

## 1. Launch one corridor first

A marketplace is judged by whether a request finds a traveller. That depends on density on a specific
route in a specific week, not on total users. Spreading a small user base across four corridors produces
four empty marketplaces. We therefore launch on **one corridor** and, within it, a small set of city pairs.

**Launch corridor: UK ↔ Pakistan**, initially London / Birmingham / Manchester ↔ Islamabad / Lahore
(the seed data already models LHR → ISB).

| Criterion | UK ↔ Pakistan | Reasoning |
|---|---|---|
| Founder access | Strong | The idea came from these WhatsApp groups; the founder is a member of the community. First users come from warm networks. |
| Demand visibility | High | "Anyone travelling to Pakistan?" posts are frequent and public inside groups, so demand can be harvested rather than created. |
| Travel frequency | High, seasonal | Family visits, weddings, Eid, summer holidays. Supply clusters predictably. |
| Category fit | Good | Documents (identity, property and legal paperwork), prescription medicine, gifts, electronics; elderly parents travelling. |
| Legal/operational base | Good | UK company, UK GDPR, mature payment providers, GBP payouts. |
| Known complications | Real | Electronics: Pakistan requires mobile phones brought from abroad to be registered (with applicable taxes) — current rules must be checked and explained before enabling phones in `electronics_inspected`. Medicine: destination import rules must be reviewed before enabling `medicine_rx` in each direction. |

Why not the other illustrative corridors first (our reasoning, not measured data):
- **UAE ↔ India**: very large, but short, cheap flights and abundant informal supply push rewards down,
  and the UAE's controlled-medicine rules make `medicine_rx` harder. Good second or third corridor.
- **US ↔ Nigeria**: strong demand for US-bought goods (`purchase_for_me`), but higher fraud exposure and
  more complex payouts. Needs mature fraud controls first.
- **Germany ↔ Turkey**: many trips are by road or cheap short-haul and parcel services are competitive;
  the companion use case may be the stronger wedge there.

Expansion rule: open a second corridor only when the first meets the day-90 gates (section 5) for two
consecutive months.

## 2. Supply-first or demand-first?

**Supply-first, with demand harvested from existing groups.**

- Demand already exists, is posted publicly in groups, and costs nothing to find. The constraint is not
  "people who need things sent" but "verified travellers with verified trips in the right week".
- Supply has more friction: KYC, trip verification, willingness to inspect and carry. It takes longer to
  build, so it must start first.
- A sender who posts and gets no traveller is a lost user and a negative story in the group. A traveller
  who lists a trip and gets no request loses little — the trip happens anyway.
- Mitigating traveller idleness: `purchase_for_me` requests are date-flexible and can fill spare capacity;
  ambassadors direct live WhatsApp demand to listed trips.

Practical rule: before opening sender sign-ups in a city pair, have **verified trips covering each week of
the next four weeks** on that pair (target ≥ 3 per week — assumption).

## 3. WhatsApp group seeding playbook

WhatsApp is both the competitor and the channel. The approach is to be useful inside groups, with admin
consent, and to never spam.

1. **Map the groups.** 30–50 groups: city community groups, mosque and community-centre groups,
   university and alumni groups, regional/hometown groups, "UK–Pakistan travel" groups. Record admin,
   approximate size, language, posting rules, how often "anyone travelling?" posts appear.
2. **Start with admins.** Ask permission. Offer something useful regardless of CarryLink: a short
   "sending things safely with travellers" guide (never carry sealed parcels, know the prohibited list,
   declare at customs, never pay deposits by bank transfer). Admins protect their groups; a safety message
   aligns with that.
3. **Answer posts, don't broadcast.** When someone posts "anyone travelling to Islamabad next week?", an
   ambassador replies with a trip-search link for that route and date, and offers to help them sign up.
4. **Recruit travellers explicitly.** "Flying to Pakistan in the next two months? List your trip, carry
   only what you have inspected, get paid through escrow." Target people who already offer to help in
   groups.
5. **Weekly digest (with admin consent).** One post per week: verified trips on the route in the next
   fortnight, with links. No personal details.
6. **Scam-awareness content.** Share anonymised patterns of scams seen in groups and how the two-code
   escrow prevents them. This builds the trust argument without overclaiming.
7. **Measure per group.** Distinct tracked links per group; weekly: clicks → registrations → KYC verified
   → first match.
8. **Never:** add people to groups, scrape phone numbers, auto-post, or message group members privately
   without their consent. It is against platform rules and data-protection law, and it destroys the
   trust the product depends on.

## 4. Community ambassadors

| Aspect | Plan |
|---|---|
| Who | Trusted, active members of the target groups: people others already ask for help; frequent travellers; students; community organisers. Fluent in English and Urdu/Punjabi. |
| How many | 10–15 for the launch corridor (assumption), spread across the origin and destination cities. |
| Role | Answer posts with links; help people through sign-up and KYC; collect feedback; be the first travellers where they can. |
| Compensation | Per **activated** user (KYC verified + first completed match), 3–10 USD (assumption), plus a small monthly retainer for the most active. Never paid per sign-up. |
| Requirements | KYC verified themselves; trained on categories, the prohibited list and inspection; code of conduct (no pressure, no off-platform deals, no handling of goods or money on anyone's behalf). |
| Tools | Tracked links, a simple dashboard of their referrals, a private group with the team for escalation. |
| Quality control | Referral quality tracked (dispute and fraud rate of referred users). Ambassadors whose referrals show abuse are removed. |

## 5. 90-day plan

Real money and real identity documents require the v2 integrations (payment provider, IDV vendor). Until
those are live, pilots run as a **concierge test** with no money held by CarryLink.

| Phase | Days | Objectives | Key activities | Exit criteria (assumptions) |
|---|---|---|---|---|
| **0. Validate and prepare** | 1–30 | Confirm the core rules are acceptable; set up legal and payments | Run the validation survey (target 200+ responses across senders and travellers); 15–20 interviews; legal review of categories for both directions (priority: `medicine_rx`, phones in `electronics_inspected`); select and integrate PSP and IDV vendor; map 30–50 groups; recruit 10 ambassadors; concierge-match 10 requests manually within founder network | ≥ 50 % of senders accept inspection (Q8); ≥ 50 % accept ID verification (Q9); PSP and IDV in test mode; no legal blocker on at least `documents`, `gifts_inspected`, `purchase_for_me` |
| **1. Closed beta** | 31–60 | Prove a full, paid loop works and is safe | Invite-only, one city-pair cluster; supply-first — 50 verified travellers with trips before opening to ~100 senders; founders review every handover record; weekly retro; categories enabled only where legal review is complete | 30 completed matches; 0 serious safety incidents; dispute rate < 10 %; median support time measured |
| **2. Open corridor** | 61–90 | Prove repeatable liquidity and early retention | Open registration for the corridor; weekly digests in consenting groups; referral credits on; second city pair if the first is saturated with supply | Run-rate ≥ 100 completed matches/month; match rate > 30 %; dispute rate < 5 %; fraud rate < 0.5 %; ≥ 20 % of day-1–60 users transact again |

**Day-90 decision:** meet the gates → continue on the corridor and prepare the second; miss liquidity
but pass trust gates → keep one corridor, adjust supply tactics; fail the trust gates (a serious incident,
or a fraud pattern the controls did not catch) → pause growth and fix the controls first.

## 6. Validation survey (10 questions)

Rewritten from the founder's earlier brainstorming into a sharper instrument. Design principles: ask
about **past behaviour, not hypothetical intent**; one idea per question; test the two rules most likely
to be rejected (inspection and ID verification) directly; get a price anchor from what people actually
paid. Estimated time: 4 minutes.

1. **Where do you live, and which country do you most often send things to or travel to?**
   (Country of residence; destination country; city)
2. **In the last 12 months, how many times did you need something taken between those two countries —
   in either direction — by someone travelling?**
   (0 / 1 / 2–3 / 4–6 / 7+)
3. **The most recent time, what was it?**
   (Documents / Prescription medicine / Gift / Electronics / Something bought from a shop / Help for a
   person travelling / Other: ___)
4. **How did it get there?**
   (Asked in a WhatsApp or Facebook group / Friend or family travelling / Courier company / Post /
   It didn't get sent / Other: ___)
5. **What did it cost in total, including anything you gave the traveller (money, gifts), and how many
   days did it take?**
   (Amount + currency; number of days)
6. **Has any of these ever happened to you or someone you know when sending with a traveller?**
   (Item lost or not delivered / Asked to pay up front and the person disappeared / Item arrived damaged
   or different / Problem at customs / Traveller refused at the last minute / None) — multi-select
7. **In the last 12 months, how many times did you fly this route, and on how many of those trips did you
   carry something for someone who is not close family?**
   (Trips: ___; trips carrying for others: ___)
8. **Would you let the traveller open, inspect and photograph everything before they take it?**
   (Yes, always / Only for some items — which? ___ / No)
9. **Would you verify your identity with a passport or ID card if the other person was verified too?**
   (Yes / Only if the data is deleted after checking / No)
10. **For your most recent item, what is the most you would have paid in total for a verified traveller,
    with your money held until the recipient confirmed delivery?**
    (Amount + currency)

Optional, not counted as a question: *May we contact you for a 20-minute conversation? (email or phone,
with explicit consent; stored separately from answers.)*

How we will read it: Q2 and Q7 size frequency on each side; Q3 validates the category list; Q5 and Q10
give a price anchor and willingness to pay; Q6 tests the pain; **Q8 and Q9 are kill questions** — if most
senders refuse inspection or most people refuse ID, the product as designed does not fit and we must
learn why in interviews before building further.

## 7. Interview questions (5)

For 20-minute conversations with people who answered the survey. Ask about specific past events; do not
pitch CarryLink until the end, if at all.

1. **"Tell me about the last time you needed something taken to or from Pakistan. Walk me through it from
   the moment you realised you needed it to when it arrived."**
   (Listen for: urgency, who they asked, how long it took, workarounds, cost.)
2. **"How did you decide who to trust with it? What would have made you say no?"**
   (Listen for: existing trust signals — mutual contacts, family names, reviews — and deal-breakers.)
3. **For travellers: "Tell me about the last time someone asked you to carry something. What did you do,
   and why? What would have made you comfortable carrying for someone you didn't know?"**
   (Listen for: fear of customs, wanting to see inside, payment expectations, hassle on arrival.)
4. **"Tell me about a time it went wrong — for you or someone you know. What happened afterwards?"**
   (Listen for: losses, scams, customs trouble, what recourse they had, how the group reacted.)
5. **"Last time, what did you pay or give in return, and how did you feel about that? If the item had been
   opened and photographed and the money held until delivery, what would that have been worth to you?"**
   (Listen for: reciprocity norms — some communities see payment as awkward — and a real price anchor.)
