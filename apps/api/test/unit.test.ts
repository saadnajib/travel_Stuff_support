process.env.NODE_ENV = 'test';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeFees, findProhibited } from '../src/domain/categories.js';
import { decryptField, encryptField, hashPassword, last4, signJwt, verifyJwt, verifyPassword } from '../src/lib/crypto.js';
import { redactPii } from '../src/lib/redact.js';

test('password hashing round-trips and rejects wrong password', async () => {
  const h = await hashPassword('correct horse battery staple');
  assert.ok(h.startsWith('scrypt$'));
  assert.equal(await verifyPassword('correct horse battery staple', h), true);
  assert.equal(await verifyPassword('correct horse battery stapl', h), false);
  assert.equal(await verifyPassword('x', 'garbage'), false);
});

test('field encryption round-trips and detects tampering', () => {
  const enc = encryptField('+44 7700 900123');
  assert.notEqual(enc, '+44 7700 900123');
  assert.equal(decryptField(enc), '+44 7700 900123');
  const parts = enc.split('.');
  parts[3] = Buffer.from('tampered!!').toString('base64');
  assert.throws(() => decryptField(parts.join('.')));
  assert.equal(last4('+44 7700 900123'), '0123');
});

test('JWT verifies, rejects tampering and expiry', () => {
  const t = signJwt({ sub: 'u1', role: 'user' }, 60);
  assert.equal(verifyJwt(t)?.sub, 'u1');
  const [h, b, s] = t.split('.');
  const payload = JSON.parse(Buffer.from(b, 'base64url').toString());
  payload.role = 'admin';
  const forged = `${h}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${s}`;
  assert.equal(verifyJwt(forged), null);
  assert.equal(verifyJwt(signJwt({ sub: 'u1', role: 'user' }, -1)), null);
  assert.equal(verifyJwt('a.b'), null);
});

test('PII redaction hides phones, emails, links and messenger handles', () => {
  const cases: [string, boolean][] = [
    ['call me on +44 7700 900123 tonight', true],
    ['my number is 0300-1234567', true],
    ['email me john.doe@example.com', true],
    ['john (at) example (dot) com', true],
    ['see https://example.com/x', true],
    ['add me on whatsapp: @johnny', true],
    ['I will bring 3 items weighing 2 kg, meet at 10:30', false],
    ['flight PK785 at gate 12', false],
  ];
  for (const [input, expected] of cases) {
    const r = redactPii(input);
    assert.equal(r.redacted, expected, `redacted mismatch for "${input}" -> "${r.text}"`);
    if (expected) assert.ok(r.text.includes('[hidden: keep contact on CarryLink]'));
  }
});

test('prohibited keyword screening matches whole words only', () => {
  assert.deepEqual(findProhibited(['A box of chocolates']), []);
  assert.deepEqual(findProhibited(['carpet for my mother']), []);
  assert.ok(findProhibited(['Small SEALED parcel, do not open please']).includes('do not open'));
  assert.ok(findProhibited(['some cash for my brother']).includes('cash'));
  assert.ok(findProhibited(['Tramadol tablets']).includes('tramadol'));
});

test('fee computation', () => {
  assert.deepEqual(computeFees(4000), { platformFeeMinor: 600, protectionFeeMinor: 100, totalChargeMinor: 4700 });
});
