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

test('schema migration upgrades a v1 database in place and keeps its data', async () => {
  const { Db, migrate, SCHEMA_VERSION } = await import('../src/db.js');
  const db = new Db(':memory:');
  // A v1 database: users table with the old role CHECK and no ops_proposals table.
  db.exec(`CREATE TABLE users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')), email_verified INTEGER NOT NULL DEFAULT 0,
    kyc_status TEXT NOT NULL DEFAULT 'none', phone_enc TEXT, phone_last4 TEXT, trust_score INTEGER NOT NULL DEFAULT 50,
    suspended INTEGER NOT NULL DEFAULT 0, suspended_reason TEXT, failed_logins INTEGER NOT NULL DEFAULT 0, locked_until TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  db.run(`INSERT INTO users (id, email, password_hash, name, role, created_at, updated_at) VALUES ('u1','a@b.c','x','A','admin','t','t')`);
  assert.throws(() => db.run(`INSERT INTO users (id, email, password_hash, name, role, created_at, updated_at) VALUES ('u2','o@b.c','x','O','ops','t','t')`));
  migrate(db);
  assert.equal(db.get<{ user_version: number }>('PRAGMA user_version')!.user_version, SCHEMA_VERSION);
  assert.equal(db.get(`SELECT role FROM users WHERE id = 'u1'`)!.role, 'admin');
  db.run(`INSERT INTO users (id, email, password_hash, name, role, created_at, updated_at) VALUES ('u2','o@b.c','x','O','ops','t','t')`);
  assert.ok(db.get(`SELECT name FROM sqlite_master WHERE name = 'ops_proposals'`));
  migrate(db); // idempotent
  assert.equal(db.get<{ c: number }>(`SELECT COUNT(*) c FROM users`)!.c, 2);
  db.close();
});
