import type { Db } from '../db.js';
import { nowIso } from '../db.js';

export function audit(
  db: Db,
  entry: { actorId: string | null; action: string; entity: string; entityId?: string | null; meta?: unknown; ip?: string | null },
): void {
  db.run(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, meta, ip, created_at) VALUES (?,?,?,?,?,?,?)`,
    [
      entry.actorId,
      entry.action,
      entry.entity,
      entry.entityId ?? null,
      entry.meta === undefined ? null : JSON.stringify(entry.meta),
      entry.ip ?? null,
      nowIso(),
    ],
  );
}
