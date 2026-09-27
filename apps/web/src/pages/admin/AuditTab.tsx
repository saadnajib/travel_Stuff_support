import { useState } from 'react';
import { errorMessage } from '../../api/client';
import { adminGetAudit } from '../../api/endpoints';
import type { AuditEntry } from '../../api/types';
import { EmptyState, ErrorState, Loading } from '../../components/Loading';
import { formatDateTime } from '../../lib/format';
import { useAsync } from '../../lib/useAsync';

const LIMIT = 100;

function metaText(meta: unknown): string {
  if (meta === null || meta === undefined) return '';
  if (typeof meta === 'string') return meta;
  try {
    return JSON.stringify(meta);
  } catch {
    return '';
  }
}

export function AuditTab() {
  const first = useAsync(() => adminGetAudit({ limit: LIMIT }), []);
  const [older, setOlder] = useState<AuditEntry[]>([]);
  const [more, setMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  const entries = [...(first.data ?? []), ...older];

  const loadMore = async () => {
    const last = entries[entries.length - 1];
    if (!last) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const next = await adminGetAudit({ limit: LIMIT, before: last.createdAt });
      setOlder((prev) => [...prev, ...next.filter((n) => !entries.some((e) => e.id === n.id))]);
      if (next.length < LIMIT) setMore(false);
    } catch (e) {
      setMoreError(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  };

  if (first.loading) return <Loading />;
  if (first.error) return <ErrorState error={first.error} onRetry={first.reload} />;
  if (entries.length === 0) return <EmptyState title="No audit entries yet" />;

  return (
    <div>
      <div className="table-wrap card">
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Actor</th>
              <th>IP</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="nowrap">{formatDateTime(e.createdAt)}</td>
                <td>
                  <code>{e.action}</code>
                </td>
                <td className="small">
                  {e.entity}
                  {e.entityId && <span className="muted mono"> {e.entityId}</span>}
                </td>
                <td className="small mono">{e.actorId ?? 'system'}</td>
                <td className="small mono">{e.ip ?? ''}</td>
                <td className="small mono audit-meta">{metaText(e.meta)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {moreError && <p className="field-error">{moreError}</p>}
      {more && (first.data?.length ?? 0) >= LIMIT && (
        <button type="button" className="btn btn-secondary btn-sm" disabled={loadingMore} onClick={() => void loadMore()}>
          {loadingMore ? 'Loading…' : 'Load older entries'}
        </button>
      )}
    </div>
  );
}
