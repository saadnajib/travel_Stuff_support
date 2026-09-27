import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export type Row = Record<string, unknown>;
export type Params = Array<string | number | bigint | null | Uint8Array>;

export class Db {
  private readonly sql: DatabaseSync;

  constructor(file: string = config.databasePath) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.sql = new DatabaseSync(file);
    this.sql.exec('PRAGMA journal_mode = WAL;');
    this.sql.exec('PRAGMA foreign_keys = ON;');
    this.sql.exec('PRAGMA busy_timeout = 5000;');
  }

  exec(s: string): void {
    this.sql.exec(s);
  }

  run(s: string, params: Params = []): { changes: number } {
    const r = this.sql.prepare(s).run(...params);
    return { changes: Number(r.changes) };
  }

  get<T extends Row = Row>(s: string, params: Params = []): T | undefined {
    return this.sql.prepare(s).get(...params) as T | undefined;
  }

  all<T extends Row = Row>(s: string, params: Params = []): T[] {
    return this.sql.prepare(s).all(...params) as T[];
  }

  transaction<T>(fn: () => T): T {
    this.sql.exec('BEGIN');
    try {
      const out = fn();
      this.sql.exec('COMMIT');
      return out;
    } catch (e) {
      this.sql.exec('ROLLBACK');
      throw e;
    }
  }

  close(): void {
    this.sql.close();
  }
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin','ops')),
  email_verified INTEGER NOT NULL DEFAULT 0,
  kyc_status TEXT NOT NULL DEFAULT 'none' CHECK (kyc_status IN ('none','pending','verified','rejected')),
  phone_enc TEXT,
  phone_last4 TEXT,
  trust_score INTEGER NOT NULL DEFAULT 50,
  suspended INTEGER NOT NULL DEFAULT 0,
  suspended_reason TEXT,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  replaced_by TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_family ON refresh_tokens(family_id);

CREATE TABLE IF NOT EXISTS email_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kyc_submissions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,
  doc_number_enc TEXT NOT NULL,
  doc_number_last4 TEXT NOT NULL,
  doc_number_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  date_of_birth TEXT NOT NULL,
  country TEXT NOT NULL,
  file_ref TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','verified','rejected')),
  rejection_reason TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  submitted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kyc_user ON kyc_submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_status ON kyc_submissions(status);

CREATE TABLE IF NOT EXISTS uploads (
  ref TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  traveler_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  origin_country TEXT NOT NULL,
  origin_city TEXT NOT NULL,
  dest_country TEXT NOT NULL,
  dest_city TEXT NOT NULL,
  depart_date TEXT NOT NULL,
  arrive_date TEXT NOT NULL,
  capacity_kg REAL NOT NULL,
  allowed_categories TEXT NOT NULL,
  booking_ref_hash TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','completed','cancelled')),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trips_route ON trips(origin_country, dest_country, depart_date);
CREATE INDEX IF NOT EXISTS idx_trips_traveler ON trips(traveler_id);

CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  origin_country TEXT NOT NULL,
  origin_city TEXT NOT NULL,
  dest_country TEXT NOT NULL,
  dest_city TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  items TEXT NOT NULL,
  weight_kg REAL NOT NULL,
  declared_value_minor INTEGER NOT NULL,
  reward_minor INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  needed_by_date TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  recipient_phone_enc TEXT NOT NULL,
  attestations TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','matched','in_transit','delivered','completed','cancelled','disputed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_requests_route ON requests(origin_country, dest_country, status);
CREATE INDEX IF NOT EXISTS idx_requests_sender ON requests(sender_id);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES requests(id),
  trip_id TEXT NOT NULL REFERENCES trips(id),
  sender_id TEXT NOT NULL REFERENCES users(id),
  traveler_id TEXT NOT NULL REFERENCES users(id),
  proposed_by TEXT NOT NULL CHECK (proposed_by IN ('sender','traveler')),
  status TEXT NOT NULL CHECK (status IN ('proposed','accepted','funded','in_transit','delivered','completed','declined','cancelled','disputed','resolved')),
  agreed_reward_minor INTEGER NOT NULL,
  platform_fee_minor INTEGER NOT NULL,
  protection_fee_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  handover_code_hash TEXT,
  delivery_code_hash TEXT,
  handover_code_enc TEXT,
  delivery_code_enc TEXT,
  code_attempts INTEGER NOT NULL DEFAULT 0,
  inspection_notes TEXT,
  inspection_photo_refs TEXT NOT NULL DEFAULT '[]',
  status_before_dispute TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_matches_request ON matches(request_id);
CREATE INDEX IF NOT EXISTS idx_matches_trip ON matches(trip_id);
CREATE INDEX IF NOT EXISTS idx_matches_parties ON matches(sender_id, traveler_id);

CREATE TABLE IF NOT EXISTS match_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  by_user_id TEXT,
  at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS escrows (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL UNIQUE REFERENCES matches(id),
  payer_id TEXT NOT NULL REFERENCES users(id),
  amount_minor INTEGER NOT NULL,
  fee_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('held','released','refunded','split')),
  provider TEXT NOT NULL,
  provider_ref TEXT NOT NULL,
  held_at TEXT NOT NULL,
  released_at TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  redacted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_match ON messages(match_id, created_at);

CREATE TABLE IF NOT EXISTS disputes (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(id),
  opened_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  details TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','resolved')),
  resolution TEXT,
  admin_notes TEXT,
  resolved_by TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(id),
  reviewer_id TEXT NOT NULL REFERENCES users(id),
  reviewee_id TEXT NOT NULL REFERENCES users(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (match_id, reviewer_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  meta TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

CREATE TABLE IF NOT EXISTS ops_proposals (
  id TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('kyc_decision','dispute_resolution','user_suspension','outreach_draft','report')),
  target_id TEXT,
  title TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  confidence REAL NOT NULL,
  risk TEXT NOT NULL CHECK (risk IN ('low','medium','high')),
  payload TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','auto_executed','failed')),
  auto_policy TEXT,
  proposed_by TEXT REFERENCES users(id),
  decided_by TEXT,
  decided_at TEXT,
  decision_note TEXT,
  execution_result TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ops_status ON ops_proposals(status, created_at);
CREATE INDEX IF NOT EXISTS idx_ops_target ON ops_proposals(kind, target_id);
`;

/** Bump when SCHEMA changes in a way existing databases must be migrated to. */
export const SCHEMA_VERSION = 2;

const MIGRATIONS: Record<number, (db: Db) => void> = {
  // v1 -> v2: users.role gains 'ops'. SQLite cannot alter a CHECK constraint, so rebuild the table.
  2: (db) => {
    db.exec(`
      CREATE TABLE users_v2 (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin','ops')),
        email_verified INTEGER NOT NULL DEFAULT 0,
        kyc_status TEXT NOT NULL DEFAULT 'none' CHECK (kyc_status IN ('none','pending','verified','rejected')),
        phone_enc TEXT,
        phone_last4 TEXT,
        trust_score INTEGER NOT NULL DEFAULT 50,
        suspended INTEGER NOT NULL DEFAULT 0,
        suspended_reason TEXT,
        failed_logins INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO users_v2 SELECT id, email, password_hash, name, role, email_verified, kyc_status, phone_enc, phone_last4,
        trust_score, suspended, suspended_reason, failed_logins, locked_until, created_at, updated_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_v2 RENAME TO users;
    `);
  },
};

export function migrate(db: Db): void {
  const hadUsers = !!db.get(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'`);
  const current = Number(db.get<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0);
  if (!hadUsers) {
    db.exec(SCHEMA);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    return;
  }
  const from = current === 0 ? 1 : current;
  db.exec('PRAGMA foreign_keys = OFF;');
  for (let v = from + 1; v <= SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (step) db.transaction(() => step(db));
  }
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA); // creates any new tables/indexes
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

export function nowIso(): string {
  return new Date().toISOString();
}
