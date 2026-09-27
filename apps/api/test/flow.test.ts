import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { api, createCtx, login, plusDays, registerVerified, upload, verifyKyc, type Session, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let admin: Session;
let sender: Session;
let traveler: Session;
before(async () => {
  ctx = await createCtx();
  admin = await login(ctx.app, ctx.seeded.admin.email, ctx.seeded.admin.password);
  sender = await login(ctx.app, ctx.seeded.sender.email, ctx.seeded.sender.password);
  traveler = await login(ctx.app, ctx.seeded.traveler.email, ctx.seeded.traveler.password);
});
after(async () => { await ctx.close(); });

const baseRequest = () => ({
  originCountry: 'GB', originCity: 'London', destCountry: 'PK', destCity: 'Islamabad', category: 'gifts_inspected',
  title: 'Two kids jumpers and a toy car', description: 'Unwrapped clothing and a small toy, happy to show every item at handover.',
  items: [{ name: 'Kids jumper', qty: 2, valueMinor: 1500 }, { name: 'Toy car', qty: 1, valueMinor: 800 }],
  weightKg: 1.2, rewardMinor: 2500, neededByDate: plusDays(10), recipientName: 'Sara Khan', recipientPhone: '+92 300 7654321',
  attestations: ['items_unsealed', 'no_prohibited', 'truthful_declaration', 'accept_inspection'],
});

test('prohibited items, caps and attestations are enforced on requests', async () => {
  const bad = await api(ctx.app, sender, 'POST', '/requests', { ...baseRequest(), description: 'A sealed parcel, please do not open it, no questions asked.' });
  assert.equal(bad.status, 422);
  assert.equal(bad.body.error.code, 'PROHIBITED_ITEM');
  assert.ok(bad.body.error.details.matched.includes('do not open'));

  const heavy = await api(ctx.app, sender, 'POST', '/requests', { ...baseRequest(), weightKg: 9 });
  assert.equal(heavy.status, 400);
  assert.match(JSON.stringify(heavy.body.error.details), /Maximum for Gifts/);

  const noAttest = await api(ctx.app, sender, 'POST', '/requests', { ...baseRequest(), attestations: ['items_unsealed'] });
  assert.equal(noAttest.status, 400);
  assert.match(JSON.stringify(noAttest.body.error.details), /Missing attestation: no_prohibited/);

  const rx = await api(ctx.app, sender, 'POST', '/requests', { ...baseRequest(), category: 'medicine_rx', title: 'Amlodipine tablets for my father', description: 'Original pharmacy box with prescription in the recipient name.', items: [{ name: 'Amlodipine 5mg box', qty: 2, valueMinor: 1200 }], weightKg: 0.3 });
  assert.equal(rx.status, 400);
  assert.match(JSON.stringify(rx.body.error.details), /has_prescription/);

  const companionWithGoods = await api(ctx.app, sender, 'POST', '/requests', { ...baseRequest(), category: 'companion_assist' });
  assert.equal(companionWithGoods.status, 400);
});

test('recipient phone is never exposed, recipient name only to the sender or a matched traveller', async () => {
  const r = await api(ctx.app, sender, 'GET', `/requests/${ctx.seeded.sender.requestId}`);
  assert.equal(r.status, 200);
  assert.equal(JSON.stringify(r.body).includes('1234567'), false);
  assert.equal(r.body.request.sender.kycStatus, 'verified');
  assert.equal(r.body.request.recipientName, 'Hamza Khan');
  const pub = await api(ctx.app, null, 'GET', `/requests/${ctx.seeded.sender.requestId}`);
  assert.equal(pub.body.request.recipientName, null);
  const asTraveler = await api(ctx.app, traveler, 'GET', `/requests/${ctx.seeded.sender.requestId}`);
  assert.equal(asTraveler.body.request.recipientName, null, 'not matched yet');
});

test('public search only lists verified trips from verified travellers', async () => {
  const r = await api(ctx.app, null, 'GET', '/trips?from=GB&to=PK');
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 1);
  assert.equal(r.body.trips[0].verified, true);
  // unverified trip is hidden
  const t = await api(ctx.app, traveler, 'POST', '/trips', { originCountry: 'GB', originCity: 'Manchester', destCountry: 'PK', destCity: 'Lahore', departDate: plusDays(3), arriveDate: plusDays(4), capacityKg: 5, allowedCategories: ['documents'] });
  assert.equal(t.status, 201);
  assert.equal(t.body.trip.verified, false);
  const again = await api(ctx.app, null, 'GET', '/trips?from=GB&to=PK');
  assert.equal(again.body.total, 1);
  const badVerify = await api(ctx.app, traveler, 'POST', `/trips/${t.body.trip.id}/verify`, { bookingRef: 'NOPE!!', airline: 'PIA' });
  assert.equal(badVerify.status, 400);
  const verify = await api(ctx.app, traveler, 'POST', `/trips/${t.body.trip.id}/verify`, { bookingRef: 'XYZ789', airline: 'PIA' });
  assert.equal(verify.status, 200);
  assert.equal(verify.body.trip.verified, true);
});

test('full happy path: propose -> accept -> pay -> handover -> deliver -> complete -> review', async () => {
  const { requestId } = ctx.seeded.sender;
  const { tripId } = ctx.seeded.traveler;

  const stranger = await registerVerified(ctx.app, 'stranger@example.com');
  const notOwner = await api(ctx.app, await verifyKyc(ctx.app, stranger, admin), 'POST', '/matches', { requestId, tripId });
  assert.equal(notOwner.status, 403);

  const proposed = await api(ctx.app, sender, 'POST', '/matches', { requestId, tripId });
  assert.equal(proposed.status, 201, proposed.res.body);
  const matchId = proposed.body.match.id as string;
  assert.equal(proposed.body.match.status, 'proposed');
  assert.equal(proposed.body.match.totalChargeMinor, 3000 + 450 + 100);

  const dup = await api(ctx.app, sender, 'POST', '/matches', { requestId, tripId });
  assert.equal(dup.status, 409);

  // non-party cannot even see it
  const hidden = await api(ctx.app, stranger, 'GET', `/matches/${matchId}`);
  assert.equal(hidden.status, 404);

  // proposer cannot accept their own proposal
  const selfAccept = await api(ctx.app, sender, 'POST', `/matches/${matchId}/accept`);
  assert.equal(selfAccept.status, 403);

  // chat is closed before acceptance
  const early = await api(ctx.app, traveler, 'POST', `/matches/${matchId}/messages`, { body: 'hello' });
  assert.equal(early.status, 409);

  const accepted = await api(ctx.app, traveler, 'POST', `/matches/${matchId}/accept`);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.match.status, 'accepted');
  assert.equal(accepted.body.match.request.recipientName, 'Hamza Khan', 'matched traveller sees recipient name');
  assert.equal((await api(ctx.app, traveler, 'GET', `/requests/${requestId}`)).body.request.recipientName, 'Hamza Khan');
  assert.equal((await api(ctx.app, sender, 'GET', `/requests/${requestId}`)).body.request.status, 'matched');

  // traveller cannot pay, sender pays; codes only to sender
  assert.equal((await api(ctx.app, traveler, 'POST', `/matches/${matchId}/pay`, { paymentMethodToken: 'tok_test_visa' })).status, 403);
  assert.equal((await api(ctx.app, sender, 'POST', `/matches/${matchId}/pay`, { paymentMethodToken: 'tok_test_declined' })).status, 402);
  const paid = await api(ctx.app, sender, 'POST', `/matches/${matchId}/pay`, { paymentMethodToken: 'tok_test_visa' });
  assert.equal(paid.status, 200, paid.res.body);
  assert.equal(paid.body.match.status, 'funded');
  assert.equal(paid.body.match.escrow.status, 'held');
  assert.match(paid.body.codes.handoverCode, /^\d{6}$/);
  assert.match(paid.body.codes.deliveryCode, /^\d{6}$/);
  assert.equal((await api(ctx.app, traveler, 'GET', `/matches/${matchId}/codes`)).status, 403);
  const codes = await api(ctx.app, sender, 'GET', `/matches/${matchId}/codes`);
  assert.deepEqual(codes.body, paid.body.codes);
  // codes are not stored in plain text
  const row = ctx.app.db.get(`SELECT * FROM matches WHERE id = ?`, [matchId])!;
  assert.equal(JSON.stringify(row).includes(paid.body.codes.handoverCode), false);

  // chat with redaction
  const msg = await api(ctx.app, traveler, 'POST', `/matches/${matchId}/messages`, { body: 'Meet at T3 at 6pm, or WhatsApp me on +44 7700 900555' });
  assert.equal(msg.status, 201);
  assert.equal(msg.body.message.redacted, true);
  assert.equal(msg.body.message.body.includes('900555'), false);
  assert.ok(msg.body.message.body.startsWith('Meet at T3 at 6pm'));
  const list = await api(ctx.app, sender, 'GET', `/matches/${matchId}/messages`);
  assert.equal(list.body.messages.length, 1);

  // handover: photos must be traveller's own uploads; wrong code counts an attempt
  const senderPhoto = await upload(ctx.app, sender);
  const travelerPhoto = await upload(ctx.app, traveler);
  const wrongOwner = await api(ctx.app, traveler, 'POST', `/matches/${matchId}/handover`, { code: paid.body.codes.handoverCode, inspectionNotes: 'Inspected two jumpers', photoRefs: [senderPhoto] });
  assert.equal(wrongOwner.status, 400);
  const wrongCode = await api(ctx.app, traveler, 'POST', `/matches/${matchId}/handover`, { code: '000000', inspectionNotes: 'Inspected two jumpers', photoRefs: [travelerPhoto] });
  assert.equal(wrongCode.status, 400);
  assert.equal(wrongCode.body.error.code, 'INVALID_CODE');
  assert.equal(wrongCode.body.error.details.attemptsLeft, 4);
  // delivery code cannot be used as handover code
  const crossCode = await api(ctx.app, traveler, 'POST', `/matches/${matchId}/handover`, { code: paid.body.codes.deliveryCode, inspectionNotes: 'Inspected two jumpers', photoRefs: [travelerPhoto] });
  assert.equal(crossCode.status, 400);
  const handed = await api(ctx.app, traveler, 'POST', `/matches/${matchId}/handover`, { code: paid.body.codes.handoverCode, inspectionNotes: 'Open envelope, 1 certificate + 3 transcripts, photographed each page', photoRefs: [travelerPhoto] });
  assert.equal(handed.status, 200, handed.res.body);
  assert.equal(handed.body.match.status, 'in_transit');
  assert.deepEqual(handed.body.match.inspectionPhotoRefs, [travelerPhoto]);

  // sender cannot cancel a funded delivery
  assert.equal((await api(ctx.app, sender, 'POST', `/requests/${requestId}/cancel`)).status, 409);
  assert.equal((await api(ctx.app, traveler, 'POST', `/trips/${tripId}/cancel`)).status, 409);

  const delivered = await api(ctx.app, traveler, 'POST', `/matches/${matchId}/deliver`, { code: paid.body.codes.deliveryCode });
  assert.equal(delivered.status, 200, delivered.res.body);
  assert.equal(delivered.body.match.status, 'delivered');
  assert.equal(delivered.body.match.escrow.status, 'held', 'escrow must stay held through the dispute window');
  assert.equal(delivered.body.match.timeline.map((e: any) => e.status).join(','), 'proposed,accepted,funded,in_transit,delivered');

  assert.equal((await api(ctx.app, traveler, 'POST', `/matches/${matchId}/complete`)).status, 403);
  const completed = await api(ctx.app, sender, 'POST', `/matches/${matchId}/complete`);
  assert.equal(completed.body.match.status, 'completed');
  assert.equal(completed.body.match.escrow.status, 'released');

  const review = await api(ctx.app, sender, 'POST', `/matches/${matchId}/review`, { rating: 5, comment: 'Brilliant, call me on 07700900123 next time' });
  assert.equal(review.status, 201);
  assert.equal(review.body.review.comment.includes('07700900123'), false);
  assert.equal((await api(ctx.app, sender, 'POST', `/matches/${matchId}/review`, { rating: 4, comment: '' })).status, 409);
  const trav = await api(ctx.app, null, 'GET', `/trips/${tripId}`);
  assert.equal(trav.body.trip.traveler.ratingAvg, 5);
  assert.equal(trav.body.trip.traveler.ratingCount, 1);
  assert.equal(trav.body.trip.traveler.trustScore, 73);
});

test('five wrong codes lock the match and auto-open a dispute; admin refund resolves it', async () => {
  // fresh sender on the same corridor
  const s2 = await verifyKyc(ctx.app, await registerVerified(ctx.app, 'sender2@example.com', 'Second Sender'), admin);
  const req = await api(ctx.app, s2, 'POST', '/requests', baseRequest());
  assert.equal(req.status, 201, req.res.body);
  const m = await api(ctx.app, traveler, 'POST', '/matches', { requestId: req.body.request.id, tripId: ctx.seeded.traveler.tripId });
  assert.equal(m.status, 201, m.res.body);
  assert.equal(m.body.match.proposedBy, 'traveler');
  assert.equal((await api(ctx.app, s2, 'POST', `/matches/${m.body.match.id}/accept`)).status, 200);
  const paid = await api(ctx.app, s2, 'POST', `/matches/${m.body.match.id}/pay`, { paymentMethodToken: 'tok_test_visa' });
  assert.equal(paid.status, 200);
  const photo = await upload(ctx.app, traveler);
  let last: any;
  for (let i = 0; i < 5; i++) {
    last = await api(ctx.app, traveler, 'POST', `/matches/${m.body.match.id}/handover`, { code: '111111', inspectionNotes: 'trying codes', photoRefs: [photo] });
  }
  assert.equal(last.status, 423);
  assert.equal(last.body.error.code, 'MATCH_LOCKED');
  const locked = await api(ctx.app, s2, 'GET', `/matches/${m.body.match.id}`);
  assert.equal(locked.body.match.status, 'disputed');
  // even the right code is refused now
  const retry = await api(ctx.app, traveler, 'POST', `/matches/${m.body.match.id}/handover`, { code: paid.body.codes.handoverCode, inspectionNotes: 'trying codes', photoRefs: [photo] });
  assert.equal(retry.status, 409);

  const disputes = await api(ctx.app, admin, 'GET', '/admin/disputes?status=open');
  const d = disputes.body.disputes.find((x: any) => x.matchId === m.body.match.id);
  assert.ok(d);
  assert.equal(d.openedBy, 'system');
  const resolved = await api(ctx.app, admin, 'POST', `/admin/disputes/${d.id}/resolve`, { resolution: 'refund_sender', notes: 'Traveller could not produce code; refunding sender.' });
  assert.equal(resolved.status, 200, resolved.res.body);
  assert.equal(resolved.body.match.status, 'resolved');
  assert.equal(resolved.body.match.escrow.status, 'refunded');
  const audit = await api(ctx.app, admin, 'GET', '/admin/audit?limit=50');
  assert.ok(audit.body.entries.some((e: any) => e.action === 'dispute.resolve'));
  assert.ok(audit.body.entries.some((e: any) => e.action === 'match.code_failed'));
});

test('capacity is enforced across a trip and route mismatch is rejected', async () => {
  const s3 = await verifyKyc(ctx.app, await registerVerified(ctx.app, 'sender3@example.com', 'Third Sender'), admin);
  const big = await api(ctx.app, s3, 'POST', '/requests', { ...baseRequest(), weightKg: 8, items: [{ name: 'Blanket', qty: 4, valueMinor: 2000 }] });
  assert.equal(big.status, 201, big.res.body);
  // seeded trip capacity 8kg, already carrying 0.4 (delivered) + 1.2 (disputed) -> 8 does not fit
  const noCap = await api(ctx.app, s3, 'POST', '/matches', { requestId: big.body.request.id, tripId: ctx.seeded.traveler.tripId });
  assert.equal(noCap.status, 409);
  assert.match(noCap.body.error.message, /capacity/);

  const other = await api(ctx.app, s3, 'POST', '/requests', { ...baseRequest(), originCountry: 'AE', originCity: 'Dubai', destCountry: 'IN', destCity: 'Mumbai' });
  assert.equal(other.status, 201);
  const mismatch = await api(ctx.app, s3, 'POST', '/matches', { requestId: other.body.request.id, tripId: ctx.seeded.traveler.tripId });
  assert.equal(mismatch.status, 409);
  assert.match(mismatch.body.error.message, /route/);
});

test('suspended users lose their sessions and cannot act', async () => {
  const s4 = await registerVerified(ctx.app, 'suspended@example.com');
  const sus = await api(ctx.app, admin, 'POST', `/admin/users/${s4.user.id}/suspend`, { suspended: true, reason: 'Fraud report' });
  assert.equal(sus.status, 200);
  assert.equal(sus.body.user.suspended, true);
  assert.equal((await api(ctx.app, s4, 'GET', '/me')).status, 403);
  const refresh = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { cookie: s4.cookie } });
  assert.equal(refresh.statusCode, 401);
  const relogin = await api(ctx.app, null, 'POST', '/auth/login', { email: 'suspended@example.com', password: 'Str0ng-Passw0rd!' });
  assert.equal(relogin.status, 403);
  assert.equal(relogin.body.error.code, 'ACCOUNT_SUSPENDED');
});

test('a dispute raised after delivery still has held escrow, and the window sweep auto-completes', async () => {
  const { sweepAutoComplete } = await import('../src/routes/matches.js');
  const { MockPaymentProvider } = await import('../src/domain/payments.js');
  const payments = new MockPaymentProvider();

  const t2 = await verifyKyc(ctx.app, await registerVerified(ctx.app, 'traveler2@example.com', 'Second Traveller'), admin);
  const trip = await api(ctx.app, t2, 'POST', '/trips', { originCountry: 'GB', originCity: 'Birmingham', destCountry: 'PK', destCity: 'Lahore', departDate: plusDays(5), arriveDate: plusDays(6), capacityKg: 10, allowedCategories: ['gifts_inspected'], bookingRef: 'QWE456' });
  assert.equal(trip.status, 201, trip.res.body);
  assert.equal((await api(ctx.app, t2, 'POST', `/trips/${trip.body.trip.id}/verify`, { bookingRef: 'QWE456', airline: 'PIA' })).status, 200);

  const run = async (email: string) => {
    const s = await verifyKyc(ctx.app, await registerVerified(ctx.app, email, 'Sender X'), admin);
    const r = await api(ctx.app, s, 'POST', '/requests', baseRequest());
    const m = await api(ctx.app, s, 'POST', '/matches', { requestId: r.body.request.id, tripId: trip.body.trip.id });
    assert.equal(m.status, 201, m.res.body);
    assert.equal((await api(ctx.app, t2, 'POST', `/matches/${m.body.match.id}/accept`)).status, 200);
    const paid = await api(ctx.app, s, 'POST', `/matches/${m.body.match.id}/pay`, { paymentMethodToken: 'tok_test_visa' });
    const photo = await upload(ctx.app, t2);
    assert.equal((await api(ctx.app, t2, 'POST', `/matches/${m.body.match.id}/handover`, { code: paid.body.codes.handoverCode, inspectionNotes: 'Inspected all items', photoRefs: [photo] })).status, 200);
    const d = await api(ctx.app, t2, 'POST', `/matches/${m.body.match.id}/deliver`, { code: paid.body.codes.deliveryCode });
    assert.equal(d.status, 200, d.res.body);
    return { s, matchId: m.body.match.id as string };
  };

  // Case A: sender disputes after delivery -> admin can still refund because escrow is held
  const a = await run('sender-a@example.com');
  const disp = await api(ctx.app, a.s, 'POST', `/matches/${a.matchId}/dispute`, { reason: 'item_not_as_declared', details: 'Recipient says one jumper is missing from the delivery.' });
  assert.equal(disp.status, 201, disp.res.body);
  const open = await api(ctx.app, admin, 'GET', '/admin/disputes?status=open');
  const d = open.body.disputes.find((x: any) => x.matchId === a.matchId);
  const res = await api(ctx.app, admin, 'POST', `/admin/disputes/${d.id}/resolve`, { resolution: 'split', notes: 'Partial delivery confirmed by photos; splitting.' });
  assert.equal(res.status, 200, res.res.body);
  assert.equal(res.body.match.escrow.status, 'split');

  // Case B: nobody acts; backdate the delivered event past the window and sweep
  const b = await run('sender-b@example.com');
  assert.equal(await sweepAutoComplete(ctx.app.db, payments), 0);
  ctx.app.db.run(`UPDATE match_events SET at = ? WHERE match_id = ? AND status = 'delivered'`, [new Date(Date.now() - 49 * 3_600_000).toISOString(), b.matchId]);
  assert.equal(await sweepAutoComplete(ctx.app.db, payments), 1);
  const after = await api(ctx.app, b.s, 'GET', `/matches/${b.matchId}`);
  assert.equal(after.body.match.status, 'completed');
  assert.equal(after.body.match.escrow.status, 'released');
  assert.equal(after.body.match.timeline.at(-1).byUserId, null, 'auto-completion has no actor');
});
