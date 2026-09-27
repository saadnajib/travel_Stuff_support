import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { buildApp } from '../../api/src/app.js';
import { Db, migrate } from '../../api/src/db.js';
import { seed, type SeedResult } from '../../api/src/seed.js';
import type { AgentEnv } from '../src/agent.js';
import { CarryLinkClient } from '../src/carrylink.js';
import { FakeLLM, type RunInput } from '../src/llm.js';
import { runTeam, TEAM } from '../src/team.js';

let app: Awaited<ReturnType<typeof buildApp>>;
let baseUrl: string;
let seeded: SeedResult;

async function call(token: string | null, method: 'GET' | 'POST', path: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as any };
}
async function loginToken(email: string, password: string): Promise<string> {
  const r = await call(null, 'POST', '/api/v1/auth/login', { email, password });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.accessToken;
}
async function newVerifiedUser(email: string, admin: string): Promise<{ token: string; id: string }> {
  const reg = await call(null, 'POST', '/api/v1/auth/register', { email, password: 'Str0ng-Passw0rd!', name: 'Test Person' });
  await call(null, 'POST', '/api/v1/auth/verify-email', { token: reg.body.devVerificationToken });
  const token = await loginToken(email, 'Str0ng-Passw0rd!');
  const up = await call(token, 'POST', '/api/v1/uploads', { filename: 'id.jpg', contentType: 'image/jpeg', sizeBytes: 1000, sha256: 'c'.repeat(64) });
  await call(token, 'POST', '/api/v1/kyc/submit', { docType: 'passport', docNumber: `Q${Math.random().toString(36).slice(2, 10).toUpperCase()}`, fullName: 'Test Person', dateOfBirth: '1992-03-03', country: 'GB', fileRef: up.body.ref });
  const pending = await call(admin, 'GET', '/api/v1/admin/kyc/pending');
  const mine = pending.body.submissions.find((s: any) => s.user.id === reg.body.user.id);
  await call(admin, 'POST', `/api/v1/admin/kyc/${mine.id}/decision`, { decision: 'approve' });
  return { token, id: reg.body.user.id };
}

before(async () => {
  const db = new Db(':memory:');
  app = await buildApp({ db, logger: false });
  migrate(db);
  seeded = await seed(db);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});
after(async () => { await app.close(); });

function makeEnv(llm: FakeLLM): AgentEnv {
  return {
    api: new CarryLinkClient({ baseUrl: `${baseUrl}/api/v1`, email: seeded.ops.email, password: seeded.ops.password }),
    llm, dryRun: false, maxItems: 20, maxIterations: 10, now: () => new Date(),
  };
}

test('with empty queues every operational agent skips without calling the model', async () => {
  let calls = 0;
  const env = makeEnv(new FakeLLM(async () => { calls++; return { calls: [], text: 'noop' }; }));
  const results = await runTeam(env, ['identity-reviewer', 'dispute-officer', 'trust-safety']);
  assert.deepEqual(results.map((r) => r.skipped), [true, true, true]);
  assert.equal(calls, 0);
  assert.equal(TEAM.length, 5);
});

test('the team reviews real queues, files proposals through the API, and respects the approval boundary', async () => {
  const admin = await loginToken(seeded.admin.email, seeded.admin.password);

  // 1. a pending KYC submission
  const reg = await call(null, 'POST', '/api/v1/auth/register', { email: 'applicant@example.com', password: 'Str0ng-Passw0rd!', name: 'Fatima Noor' });
  await call(null, 'POST', '/api/v1/auth/verify-email', { token: reg.body.devVerificationToken });
  const applicant = await loginToken('applicant@example.com', 'Str0ng-Passw0rd!');
  const up = await call(applicant, 'POST', '/api/v1/uploads', { filename: 'passport.jpg', contentType: 'image/jpeg', sizeBytes: 5000, sha256: 'd'.repeat(64) });
  const sub = await call(applicant, 'POST', '/api/v1/kyc/submit', { docType: 'passport', docNumber: 'ZX1234567', fullName: 'Fatima Noor', dateOfBirth: '1995-06-06', country: 'GB', fileRef: up.body.ref });
  assert.equal(sub.status, 201, JSON.stringify(sub.body));

  // 2. a small funded dispute
  const s = await newVerifiedUser('sender-ops@example.com', admin);
  const traveler = await loginToken(seeded.traveler.email, seeded.traveler.password);
  const req = await call(s.token, 'POST', '/api/v1/requests', {
    originCountry: 'GB', originCity: 'London', destCountry: 'PK', destCity: 'Islamabad', category: 'documents', title: 'Attested marriage certificate',
    description: 'Open envelope, single attested certificate, inspection welcome.', items: [{ name: 'Marriage certificate', qty: 1, valueMinor: 0 }],
    weightKg: 0.1, rewardMinor: 1500, neededByDate: new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10), recipientName: 'Zara Noor', recipientPhone: '+92 300 1112222',
    attestations: ['items_unsealed', 'no_prohibited', 'truthful_declaration', 'accept_inspection'],
  });
  assert.equal(req.status, 201, JSON.stringify(req.body));
  const m = await call(s.token, 'POST', '/api/v1/matches', { requestId: req.body.request.id, tripId: seeded.traveler.tripId });
  assert.equal(m.status, 201, JSON.stringify(m.body));
  const acc = await call(traveler, 'POST', `/api/v1/matches/${m.body.match.id}/accept`);
  assert.equal(acc.status, 200, JSON.stringify(acc.body));
  const pay = await call(s.token, 'POST', `/api/v1/matches/${m.body.match.id}/pay`, { paymentMethodToken: 'tok_test_visa' });
  assert.equal(pay.status, 200, JSON.stringify(pay.body));
  // 3. an off-platform solicitation pattern (4 redacted messages) from the traveller
  for (let i = 0; i < 4; i++) await call(traveler, 'POST', `/api/v1/matches/${m.body.match.id}/messages`, { body: `Just WhatsApp me on +44 7700 90012${i} and we skip the app` });
  const d = await call(s.token, 'POST', `/api/v1/matches/${m.body.match.id}/dispute`, { reason: 'traveler_no_show', details: 'Traveller kept pushing me to WhatsApp and never came to the handover.' });
  assert.equal(d.status, 201, JSON.stringify(d.body));

  // A scripted "model" that behaves like a careful employee: it reads the brief and files one proposal per item.
  const briefs: Record<string, string> = {};
  const llm = new FakeLLM(async (input: RunInput) => {
    const role = input.system.match(/Your role: (.+)\./)?.[1] ?? '';
    briefs[role] = input.user;
    if (role.startsWith('Identity')) {
      const subId = input.user.match(/"id": "([^"]+)"/)![1];
      const userId = input.user.match(/"user": \{\s*"id": "([^"]+)"/)![1];
      return { calls: [{ tool: 'file_proposal', input: { title: 'Approve Fatima Noor', reasoning: 'Name and DOB consistent with the account; no duplicate-document or takeover signals in the audit trail. Image not verifiable from metadata.', confidence: 0.8, risk: 'medium', payload: { submissionId: subId, userId, decision: 'approve' } } }], text: 'Reviewed 1 submission, recommended approval.' };
    }
    if (role.startsWith('Dispute')) {
      const disputeId = input.user.match(/"id": "([^"]+)",\s*"matchId": "([^"]+)"/)![1];
      const matchId = input.user.match(/"matchId": "([^"]+)"/)![1];
      return { calls: [{ tool: 'get_match_context', input: { matchId } }, { tool: 'file_proposal', input: { title: 'Refund sender: traveller no-show and off-platform pressure', reasoning: 'No handover event or photos; four redacted messages from the traveller pushing to WhatsApp; escrow still held.', confidence: 0.95, risk: 'low', payload: { disputeId, matchId, resolution: 'refund_sender', notes: 'Traveller did not complete handover and repeatedly tried to move the deal off-platform.' } } }], text: 'Resolved 1 dispute.' };
    }
    if (role.startsWith('Trust')) {
      const userId = input.user.match(/"userId": "([^"]+)"/)![1];
      return { calls: [{ tool: 'file_proposal', input: { title: 'Suspend traveller for off-platform solicitation', reasoning: 'Four redacted messages in one match asking the sender to leave the app, followed by a no-show dispute.', confidence: 0.9, risk: 'high', payload: { userId, suspended: true, reason: 'Repeated off-platform solicitation and no-show' } } }], text: 'Flagged 1 account.' };
    }
    if (role.startsWith('Growth')) {
      return { calls: [{ tool: 'file_proposal', input: { title: 'Recruit GB->PK travellers', reasoning: 'Open document requests on GB->PK exceed verified trip capacity this week.', confidence: 0.7, risk: 'low', payload: { channel: 'whatsapp', audience: 'UK-Pakistan community groups', text: 'Flying London to Islamabad soon? Verified senders need documents carried. Inspected, escrow-protected. {LINK}' } } }], text: 'One draft filed.' };
    }
    return { calls: [{ tool: 'file_proposal', input: { title: 'Daily digest', reasoning: 'Automated digest.', confidence: 1, risk: 'low', payload: { period: 'daily digest test', markdown: '# Daily digest\n## Numbers that matter\n- see stats\n## Waiting for you\n- 3 items' } } }], text: 'Digest filed.' };
  });

  const results = await runTeam(makeEnv(llm));
  assert.deepEqual(results.map((r) => [r.agent, r.skipped, r.filed.length]), [
    ['identity-reviewer', false, 1], ['dispute-officer', false, 1], ['trust-safety', false, 1], ['growth', false, 1], ['chief-of-staff', false, 1],
  ]);
  assert.match(briefs['Identity Reviewer (KYC)'], /Fatima Noor/);
  assert.match(briefs['Dispute Officer'], /traveler_no_show/);
  assert.match(briefs['Trust & Safety Analyst'], /message\.redacted/);

  // Outcomes enforced by the API, not by the agents:
  const byKind = Object.fromEntries(results.flatMap((r) => r.filed).map((f) => [f.kind, f]));
  assert.equal(byKind.kyc_decision.status, 'pending', 'KYC approvals wait for the founder');
  assert.equal(byKind.dispute_resolution.status, 'auto_executed', 'small, confident, low-risk dispute auto-resolves');
  assert.equal(byKind.user_suspension.status, 'pending', 'suspensions wait for the founder');
  assert.equal(byKind.outreach_draft.status, 'pending');
  assert.equal(byKind.report.status, 'pending');
  const match = await call(s.token, 'GET', `/api/v1/matches/${m.body.match.id}`);
  assert.equal(match.body.match.escrow.status, 'refunded');

  // The founder approves the suspension; the traveller loses access.
  const dec = await call(admin, 'POST', `/api/v1/ops/proposals/${byKind.user_suspension.id}/decide`, { decision: 'approve', note: 'Agreed.' });
  assert.equal(dec.body.proposal.status, 'approved');
  assert.equal((await call(traveler, 'GET', '/api/v1/me')).status, 403);

  // A second run finds nothing new: no duplicate proposals, no model calls for the operational agents.
  let calls = 0;
  const again = await runTeam(makeEnv(new FakeLLM(async () => { calls++; return { calls: [], text: '' }; })), ['identity-reviewer', 'dispute-officer', 'trust-safety', 'chief-of-staff']);
  assert.deepEqual(again.map((r) => r.skipped), [true, true, true, true]);
  assert.equal(calls, 0);
});

test('dry run files nothing but reports what it would have filed', async () => {
  const env = makeEnv(new FakeLLM(async () => ({ calls: [{ tool: 'file_proposal', input: { title: 'x', reasoning: 'dry run reasoning', confidence: 0.5, risk: 'low', payload: { channel: 'whatsapp', audience: 'a', text: 'hello world post' } } }], text: 'ok' })));
  env.dryRun = true;
  const [r] = await runTeam(env, ['growth']);
  assert.equal(r.filed.length, 1);
  assert.equal(r.filed[0].status, 'dry_run');
  const list = await call(await loginToken(seeded.admin.email, seeded.admin.password), 'GET', '/api/v1/ops/proposals?status=all&kind=outreach_draft');
  assert.equal(list.body.proposals.length, 1, 'only the earlier real draft exists');
});
