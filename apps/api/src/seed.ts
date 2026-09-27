import { randomUUID } from 'node:crypto';
import { Db, migrate, nowIso } from './db.js';
import { encryptField, hashPassword, hmacHex, last4 } from './lib/crypto.js';

export interface SeedResult {
  admin: { id: string; email: string; password: string };
  traveler: { id: string; email: string; password: string; tripId: string };
  sender: { id: string; email: string; password: string; requestId: string };
}

function plusDays(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
}

export async function seed(db: Db): Promise<SeedResult> {
  const now = nowIso();
  const mk = async (email: string, password: string, name: string, role: 'user' | 'admin', kyc: 'none' | 'verified') => {
    const existing = db.get(`SELECT id FROM users WHERE email = ?`, [email]);
    if (existing) return existing.id as string;
    const id = randomUUID();
    db.run(
      `INSERT INTO users (id, email, password_hash, name, role, email_verified, kyc_status, trust_score, created_at, updated_at) VALUES (?,?,?,?,?,1,?,?,?,?)`,
      [id, email, await hashPassword(password), name, role, kyc, kyc === 'verified' ? 70 : 50, now, now],
    );
    if (kyc === 'verified') {
      const ref = `upl_seed_${id.slice(0, 8)}`;
      db.run(`INSERT INTO uploads (ref, user_id, filename, content_type, size_bytes, sha256, created_at) VALUES (?,?,?,?,?,?,?)`, [ref, id, 'passport.jpg', 'image/jpeg', 120000, 'a'.repeat(64), now]);
      const docNo = `P${id.slice(0, 7).toUpperCase()}`;
      db.run(
        `INSERT INTO kyc_submissions (id, user_id, doc_type, doc_number_enc, doc_number_last4, doc_number_hash, full_name, date_of_birth, country, file_ref, status, reviewed_at, submitted_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,'verified',?,?)`,
        [randomUUID(), id, 'passport', encryptField(docNo), last4(docNo), hmacHex(`passport:GB:${docNo}`), name, '1990-01-01', 'GB', ref, now, now],
      );
    }
    return id;
  };

  const admin = { email: 'admin@carrylink.dev', password: 'Admin-Passw0rd!' };
  const traveler = { email: 'traveler@carrylink.dev', password: 'Traveler-Passw0rd!' };
  const sender = { email: 'sender@carrylink.dev', password: 'Sender-Passw0rd!' };

  const adminId = await mk(admin.email, admin.password, 'CarryLink Admin', 'admin', 'none');
  const travelerId = await mk(traveler.email, traveler.password, 'Ayesha Traveller', 'user', 'verified');
  const senderId = await mk(sender.email, sender.password, 'Bilal Sender', 'user', 'verified');

  let tripId = db.get(`SELECT id FROM trips WHERE traveler_id = ?`, [travelerId])?.id as string | undefined;
  if (!tripId) {
    tripId = randomUUID();
    db.run(
      `INSERT INTO trips (id, traveler_id, origin_country, origin_city, dest_country, dest_city, depart_date, arrive_date, capacity_kg, allowed_categories, booking_ref_hash, verified, status, notes, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,1,'published',?,?,?)`,
      [tripId, travelerId, 'GB', 'London (LHR)', 'PK', 'Islamabad (ISB)', plusDays(7), plusDays(8), 8, JSON.stringify(['documents', 'gifts_inspected', 'medicine_rx']), hmacHex('ABC123'), 'Direct flight, can meet at Heathrow T3 or in Southall the evening before.', now, now],
    );
  }

  let requestId = db.get(`SELECT id FROM requests WHERE sender_id = ?`, [senderId])?.id as string | undefined;
  if (!requestId) {
    requestId = randomUUID();
    db.run(
      `INSERT INTO requests (id, sender_id, origin_country, origin_city, dest_country, dest_city, category, title, description, items, weight_kg, declared_value_minor, reward_minor, currency, needed_by_date, recipient_name, recipient_phone_enc, attestations, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'open',?,?)`,
      [
        requestId, senderId, 'GB', 'London', 'PK', 'Islamabad', 'documents', 'University degree certificate + attested transcripts',
        'Open A4 envelope with my degree certificate and 3 attested transcripts for a job application in Islamabad. Happy for the traveller to inspect every page.',
        JSON.stringify([{ name: 'Degree certificate', qty: 1, valueMinor: 0 }, { name: 'Attested transcripts', qty: 3, valueMinor: 0 }]),
        0.4, 0, 3000, 'USD', plusDays(12), 'Hamza Khan', encryptField('+92 300 1234567'),
        JSON.stringify(['items_unsealed', 'no_prohibited', 'truthful_declaration', 'accept_inspection']), now, now,
      ],
    );
  }

  return {
    admin: { id: adminId, ...admin },
    traveler: { id: travelerId, ...traveler, tripId },
    sender: { id: senderId, ...sender, requestId },
  };
}

const isDirectRun = process.argv[1] && /seed\.(ts|js)$/.test(process.argv[1]);
if (isDirectRun) {
  const db = new Db();
  migrate(db);
  const result = await seed(db);
  db.close();
  console.log('Seeded CarryLink dev data:');
  for (const [k, v] of Object.entries(result)) console.log(`  ${k}: ${v.email} / ${v.password}`);
}
