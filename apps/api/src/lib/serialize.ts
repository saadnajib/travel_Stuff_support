import type { Db, Row } from '../db.js';
import { maskPhone } from './crypto.js';
import { computeFees } from '../domain/categories.js';

function bool(v: unknown): boolean {
  return v === 1 || v === true;
}

export function serializeUser(row: Row, ratings?: { avg: number | null; count: number }) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    emailVerified: bool(row.email_verified),
    kycStatus: row.kyc_status,
    trustScore: row.trust_score,
    ratingAvg: ratings?.avg ?? null,
    ratingCount: ratings?.count ?? 0,
    phoneMasked: maskPhone((row.phone_last4 as string | null) ?? null),
    suspended: bool(row.suspended),
    createdAt: row.created_at,
  };
}

export function userRatings(db: Db, userId: string): { avg: number | null; count: number } {
  const r = db.get<{ avg: number | null; count: number }>(
    `SELECT AVG(rating) AS avg, COUNT(*) AS count FROM reviews WHERE reviewee_id = ?`,
    [userId],
  );
  return { avg: r?.avg == null ? null : Math.round(r.avg * 10) / 10, count: r?.count ?? 0 };
}

export function publicUser(db: Db, userId: string) {
  const row = db.get(`SELECT id, name, kyc_status, trust_score, created_at FROM users WHERE id = ?`, [userId]);
  if (!row) return null;
  const ratings = userRatings(db, userId);
  return {
    id: row.id,
    name: row.name,
    kycStatus: row.kyc_status,
    trustScore: row.trust_score,
    ratingAvg: ratings.avg,
    ratingCount: ratings.count,
    memberSince: row.created_at,
  };
}

export function serializeTrip(db: Db, row: Row) {
  return {
    id: row.id,
    traveler: publicUser(db, row.traveler_id as string),
    originCountry: row.origin_country,
    originCity: row.origin_city,
    destCountry: row.dest_country,
    destCity: row.dest_city,
    departDate: row.depart_date,
    arriveDate: row.arrive_date,
    capacityKg: row.capacity_kg,
    allowedCategories: JSON.parse(row.allowed_categories as string),
    verified: bool(row.verified),
    status: row.status,
    notes: row.notes ?? null,
    createdAt: row.created_at,
  };
}

/** Recipient details are third-party PII: only the sender, an admin, or a traveller matched on the request may see them. */
export function canSeeRecipient(db: Db, row: Row, viewer: { id: string; role: string } | null | undefined): boolean {
  if (!viewer) return false;
  if (viewer.role === 'admin' || viewer.id === row.sender_id) return true;
  const m = db.get(
    `SELECT id FROM matches WHERE request_id = ? AND traveler_id = ? AND status NOT IN ('proposed','declined','cancelled') LIMIT 1`,
    [row.id as string, viewer.id],
  );
  return !!m;
}

export function serializeRequest(db: Db, row: Row, viewer?: { id: string; role: string } | null) {
  return {
    id: row.id,
    sender: publicUser(db, row.sender_id as string),
    originCountry: row.origin_country,
    originCity: row.origin_city,
    destCountry: row.dest_country,
    destCity: row.dest_city,
    category: row.category,
    title: row.title,
    description: row.description,
    items: JSON.parse(row.items as string),
    weightKg: row.weight_kg,
    declaredValueMinor: row.declared_value_minor,
    rewardMinor: row.reward_minor,
    currency: row.currency,
    neededByDate: row.needed_by_date,
    recipientName: canSeeRecipient(db, row, viewer) ? row.recipient_name : null,
    status: row.status,
    attestations: JSON.parse(row.attestations as string),
    createdAt: row.created_at,
  };
}

export function serializeEscrow(row: Row | undefined) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    amountMinor: row.amount_minor,
    feeMinor: row.fee_minor,
    currency: row.currency,
    provider: row.provider,
    providerRef: row.provider_ref,
    heldAt: row.held_at,
    releasedAt: row.released_at ?? null,
  };
}

export function serializeMatch(db: Db, row: Row) {
  const request = db.get(`SELECT * FROM requests WHERE id = ?`, [row.request_id as string]);
  const trip = db.get(`SELECT * FROM trips WHERE id = ?`, [row.trip_id as string]);
  const escrow = db.get(`SELECT * FROM escrows WHERE match_id = ?`, [row.id as string]);
  const timeline = db.all(`SELECT status, at, by_user_id FROM match_events WHERE match_id = ? ORDER BY id ASC`, [row.id as string]);
  const fees = computeFees(row.agreed_reward_minor as number);
  // Inside a match both parties are entitled to the recipient details.
  const partyViewer = request ? { id: request.sender_id as string, role: 'user' } : null;
  return {
    id: row.id,
    request: request ? serializeRequest(db, request, partyViewer) : null,
    trip: trip ? serializeTrip(db, trip) : null,
    proposedBy: row.proposed_by,
    status: row.status,
    agreedRewardMinor: row.agreed_reward_minor,
    platformFeeMinor: row.platform_fee_minor,
    protectionFeeMinor: row.protection_fee_minor,
    totalChargeMinor: fees.totalChargeMinor,
    currency: row.currency,
    escrow: serializeEscrow(escrow),
    inspectionNotes: row.inspection_notes ?? null,
    inspectionPhotoRefs: JSON.parse((row.inspection_photo_refs as string) ?? '[]'),
    timeline: timeline.map((e) => ({ status: e.status, at: e.at, byUserId: e.by_user_id })),
    createdAt: row.created_at,
  };
}

export function serializeDispute(row: Row) {
  return {
    id: row.id,
    matchId: row.match_id,
    openedBy: row.opened_by,
    reason: row.reason,
    details: row.details,
    status: row.status,
    resolution: row.resolution ?? null,
    adminNotes: row.admin_notes ?? null,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? null,
  };
}
