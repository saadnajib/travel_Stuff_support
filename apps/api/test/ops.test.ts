import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { api, createCtx, login, plusDays, registerVerified, upload, verifyKyc, type Session, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let admin: Session;
let ops: Session;
let sender: Session;
let traveler: Session;

before(async () => {
  ctx = await createCtx();
  admin = await login(ctx.app, ctx.seeded.admin.email, ctx.seeded.admin.password);
  ops = await login(ctx.app, ctx.seeded.ops.email, ctx.seeded.ops.password);
  sender = await login(ctx.app, ctx.seeded.sender.email, ctx.seeded.sender.password);
  traveler = await login(ctx.app, ctx.seeded.traveler.email, ctx.seeded.traveler.password);
});
after(async () => { await ctx.close(); });

const proposal = (over: Record<string, unknown>) => ({
  agent: 'identity-reviewer', kind: 'kyc_decision', title: 'Review KYC', reasoning: 'Name and date of birth match the registration details; document number format is valid for GB passports.',
  confidence: 0.95, risk: 'low', ...over,
});

async function submitKyc(s: Session): Promise<string> {
  const ref = await upload(ctx.app, s);
  const r = await api(ctx.app, s, 'POST', '/kyc/submit', { docType: 'passport', docNumber: `PK${Math.random().toString(36).slice(2, 9).toUpperCase()}`, fullName: 'Test User', dateOfBirth: '1991-02-02', country: 'GB', fileRef: ref });
  assert.equal(r.status, 201, r.res.body);
  const pending = await api(ctx.app, ops, 'GET', '/admin/kyc/pending');
  return pending.body.submissions.find((x: any) => x.user.id === s.user.id).id;
}

test('ops role can read admin data but cannot execute admin writes or reach user-only match data', async () => {
  assert.equal((await api(ctx.app, ops, 'GET', '/admin/users')).status, 200);
  assert.equal((await api(ctx.app, ops, 'GET', '/admin/audit')).status, 200);
  const u = await registerVerified(ctx.app, 'kyc-a@example.com');
  const subId = await submitKyc(u);
  const direct = await api(ctx.app, ops, 'POST', `/admin/kyc/${subId}/decision`, { decision: 'approve' });
  assert.equal(direct.status, 403, 'ops must not approve KYC directly');
  assert.equal((await api(ctx.app, ops, 'POST', `/admin/users/${u.user.id}/suspend`, { suspended: true, reason: 'x' })).status, 403);
  assert.equal((await api(ctx.app, sender, 'GET', '/ops/proposals')).status, 403, 'normal users cannot see proposals');
  assert.equal((await api(ctx.app, sender, 'GET', '/ops/stats')).status, 403);
});

test('KYC approval proposals wait for the admin; approving executes the decision', async () => {
  const u = await registerVerified(ctx.app, 'kyc-b@example.com');
  const subId = await submitKyc(u);
  const p = await api(ctx.app, ops, 'POST', '/ops/proposals', proposal({ payload: { submissionId: subId, decision: 'approve' } }));
  assert.equal(p.status, 201, p.res.body);
  assert.equal(p.body.proposal.status, 'pending');
  assert.equal(p.body.proposal.targetId, subId);
  assert.equal((await api(ctx.app, ops, 'POST', '/ops/proposals', proposal({ payload: { submissionId: subId, decision: 'approve' } }))).status, 409, 'no duplicate proposals per target');
  assert.equal((await api(ctx.app, ops, 'POST', `/ops/proposals/${p.body.proposal.id}/decide`, { decision: 'approve' })).status, 403, 'ops cannot approve its own proposals');
  assert.equal((await api(ctx.app, u, 'GET', '/kyc/status')).body.kycStatus, 'pending');
  const d = await api(ctx.app, admin, 'POST', `/ops/proposals/${p.body.proposal.id}/decide`, { decision: 'approve', note: 'Looks fine' });
  assert.equal(d.status, 200, d.res.body);
  assert.equal(d.body.proposal.status, 'approved');
  assert.equal(d.body.proposal.decidedBy, admin.user.id);
  assert.equal(d.body.proposal.executionResult.status, 'verified');
  assert.equal((await api(ctx.app, u, 'GET', '/kyc/status')).body.kycStatus, 'verified');
  assert.equal((await api(ctx.app, admin, 'POST', `/ops/proposals/${p.body.proposal.id}/decide`, { decision: 'reject' })).status, 409, 'already decided');
});

test('confident low-risk KYC rejections auto-execute; low confidence ones wait', async () => {
  const u = await registerVerified(ctx.app, 'kyc-c@example.com');
  const subId = await submitKyc(u);
  const p = await api(ctx.app, ops, 'POST', '/ops/proposals', proposal({ payload: { submissionId: subId, decision: 'reject', reason: 'Name on document does not match account name' } }));
  assert.equal(p.status, 201, p.res.body);
  assert.equal(p.body.proposal.status, 'auto_executed');
  assert.equal(p.body.proposal.autoPolicy, 'auto_reject_kyc');
  const st = await api(ctx.app, u, 'GET', '/kyc/status');
  assert.equal(st.body.kycStatus, 'rejected');
  assert.equal(st.body.rejectionReason, 'Name on document does not match account name');

  const u2 = await registerVerified(ctx.app, 'kyc-d@example.com');
  const sub2 = await submitKyc(u2);
  const p2 = await api(ctx.app, ops, 'POST', '/ops/proposals', proposal({ confidence: 0.6, payload: { submissionId: sub2, decision: 'reject', reason: 'Blurry photo' } }));
  assert.equal(p2.body.proposal.status, 'pending');
  const rej = await api(ctx.app, admin, 'POST', `/ops/proposals/${p2.body.proposal.id}/decide`, { decision: 'reject', note: 'I can read it fine, approve manually' });
  assert.equal(rej.body.proposal.status, 'rejected');
  assert.equal((await api(ctx.app, u2, 'GET', '/kyc/status')).body.kycStatus, 'pending');
});

async function fundedDispute(senderEmail: string, rewardMinor: number): Promise<{ disputeId: string; matchId: string; s: Session }> {
  const s = await verifyKyc(ctx.app, await registerVerified(ctx.app, senderEmail, 'Dispute Sender'), admin);
  const r = await api(ctx.app, s, 'POST', '/requests', {
    originCountry: 'GB', originCity: 'London', destCountry: 'PK', destCity: 'Islamabad', category: 'documents', title: 'Bank statements for visa',
    description: 'Open envelope with printed bank statements, happy for inspection.', items: [{ name: 'Bank statements', qty: 6, valueMinor: 0 }],
    weightKg: 0.2, rewardMinor, neededByDate: plusDays(12), recipientName: 'Ali Raza', recipientPhone: '+92 300 0000000',
    attestations: ['items_unsealed', 'no_prohibited', 'truthful_declaration', 'accept_inspection'],
  });
  assert.equal(r.status, 201, r.res.body);
  const m = await api(ctx.app, s, 'POST', '/matches', { requestId: r.body.request.id, tripId: ctx.seeded.traveler.tripId });
  assert.equal(m.status, 201, m.res.body);
  assert.equal((await api(ctx.app, traveler, 'POST', `/matches/${m.body.match.id}/accept`)).status, 200);
  assert.equal((await api(ctx.app, s, 'POST', `/matches/${m.body.match.id}/pay`, { paymentMethodToken: 'tok_test_visa' })).status, 200);
  const d = await api(ctx.app, s, 'POST', `/matches/${m.body.match.id}/dispute`, { reason: 'traveler_no_show', details: 'Traveller did not show up at the agreed handover place.' });
  assert.equal(d.status, 201, d.res.body);
  return { disputeId: d.body.dispute.id, matchId: m.body.match.id, s };
}

test('small disputes auto-resolve under policy, large ones wait; context bundle is available to ops', async () => {
  const small = await fundedDispute('dsp-small@example.com', 2000);
  const ctxRes = await api(ctx.app, ops, 'GET', `/ops/context/match/${small.matchId}`);
  assert.equal(ctxRes.status, 200);
  assert.equal(ctxRes.body.disputes.length, 1);
  assert.equal(ctxRes.body.sender.counts.disputesOpenedByUser, 1);
  assert.ok(ctxRes.body.match.escrow.status === 'held');

  const p = await api(ctx.app, ops, 'POST', '/ops/proposals', {
    agent: 'dispute-officer', kind: 'dispute_resolution', title: 'Refund sender: traveller no-show', confidence: 0.96, risk: 'low',
    reasoning: 'Chat shows the traveller confirmed the meeting and never replied afterwards; no handover photos; escrow still held.',
    payload: { disputeId: small.disputeId, matchId: small.matchId, resolution: 'refund_sender', notes: 'Traveller no-show confirmed from chat timeline.' },
  });
  assert.equal(p.status, 201, p.res.body);
  assert.equal(p.body.proposal.status, 'auto_executed', JSON.stringify(p.body));
  assert.match(p.body.proposal.autoPolicy, /auto_small_dispute/);
  const m = await api(ctx.app, small.s, 'GET', `/matches/${small.matchId}`);
  assert.equal(m.body.match.status, 'resolved');
  assert.equal(m.body.match.escrow.status, 'refunded');

  const big = await fundedDispute('dsp-big@example.com', 9000);
  const p2 = await api(ctx.app, ops, 'POST', '/ops/proposals', {
    agent: 'dispute-officer', kind: 'dispute_resolution', title: 'Refund sender', confidence: 0.97, risk: 'low',
    reasoning: 'Same pattern as before, but the amount is above the automatic threshold so a human must sign off.',
    payload: { disputeId: big.disputeId, resolution: 'refund_sender', notes: 'No-show.' },
  });
  assert.equal(p2.body.proposal.status, 'pending');
  assert.equal(p2.body.proposal.autoPolicy, null);
  const d = await api(ctx.app, admin, 'POST', `/ops/proposals/${p2.body.proposal.id}/decide`, { decision: 'approve' });
  assert.equal(d.body.proposal.status, 'approved');
  assert.equal(d.body.proposal.executionResult.escrowStatus, 'refunded');
});

test('suspension proposals always wait; approving suspends and revokes sessions; failures are recorded', async () => {
  const u = await registerVerified(ctx.app, 'bad-actor@example.com');
  const p = await api(ctx.app, ops, 'POST', '/ops/proposals', {
    agent: 'trust-safety', kind: 'user_suspension', title: 'Suspend bad-actor', confidence: 0.99, risk: 'low',
    reasoning: 'Seven redacted messages in two days trying to move deals to WhatsApp, plus a duplicate-document attempt.',
    payload: { userId: u.user.id, suspended: true, reason: 'Repeated off-platform solicitation' },
  });
  assert.equal(p.body.proposal.status, 'pending', 'suspensions never auto-execute');
  const d = await api(ctx.app, admin, 'POST', `/ops/proposals/${p.body.proposal.id}/decide`, { decision: 'approve' });
  assert.equal(d.body.proposal.status, 'approved');
  assert.equal((await api(ctx.app, u, 'GET', '/me')).status, 403);
  const uc = await api(ctx.app, ops, 'GET', `/ops/context/user/${u.user.id}`);
  assert.equal(uc.body.user.user.suspended, true);

  // A proposal to suspend the admin must fail at execution and be recorded as failed
  const p2 = await api(ctx.app, ops, 'POST', '/ops/proposals', {
    agent: 'trust-safety', kind: 'user_suspension', title: 'Suspend admin?', confidence: 0.5, risk: 'high',
    reasoning: 'Testing that privileged accounts are protected from automated suspension proposals.',
    payload: { userId: admin.user.id, suspended: true, reason: 'test' },
  });
  const d2 = await api(ctx.app, admin, 'POST', `/ops/proposals/${p2.body.proposal.id}/decide`, { decision: 'approve' });
  assert.equal(d2.body.proposal.status, 'failed');
  assert.match(d2.body.proposal.executionResult.error, /cannot suspend yourself|Admin accounts/);
  assert.equal((await api(ctx.app, admin, 'GET', '/me')).status, 200);
});

test('reports and outreach drafts are informational; stats and history list them', async () => {
  const r = await api(ctx.app, ops, 'POST', '/ops/proposals', {
    agent: 'chief-of-staff', kind: 'report', title: 'Daily digest', confidence: 1, risk: 'low',
    reasoning: 'Automated daily summary of platform activity and the team\'s actions.',
    payload: { period: 'today', markdown: '# Daily digest\n\n- 3 new users\n- 1 dispute auto-resolved' },
  });
  assert.equal(r.body.proposal.status, 'pending');
  const o = await api(ctx.app, ops, 'POST', '/ops/proposals', {
    agent: 'growth', kind: 'outreach_draft', title: 'WhatsApp post: LHR->ISB next week', confidence: 0.8, risk: 'low',
    reasoning: 'Two open document requests on GB->PK have no verified traveller within their needed-by window.',
    payload: { channel: 'whatsapp', audience: 'UK Pakistani community groups', text: 'Flying London to Islamabad next week? Two verified senders need documents carried. Earn a reward, everything inspected and escrow-protected.' },
  });
  assert.equal(o.status, 201, o.res.body);
  const ack = await api(ctx.app, admin, 'POST', `/ops/proposals/${r.body.proposal.id}/decide`, { decision: 'approve' });
  assert.equal(ack.body.proposal.status, 'approved');
  assert.deepEqual(ack.body.proposal.executionResult, { noop: true });

  const stats = await api(ctx.app, ops, 'GET', '/ops/stats');
  assert.equal(stats.status, 200);
  assert.ok(stats.body.users.total >= 5);
  assert.equal(stats.body.disputes.resolved, 2);
  assert.ok(stats.body.proposals.autoExecuted7d >= 2);
  assert.equal(stats.body.policy.autoDisputeMaxMinor, 5000);
  const hist = await api(ctx.app, admin, 'GET', '/ops/proposals?status=all&limit=100');
  assert.ok(hist.body.proposals.length >= 8);
  const audit = await api(ctx.app, admin, 'GET', '/admin/audit?limit=200');
  assert.ok(audit.body.entries.some((e: any) => e.action === 'ops.approve'));
  assert.ok(audit.body.entries.some((e: any) => e.action === 'dispute.resolve' && e.meta?.via?.startsWith('proposal:')));
});
