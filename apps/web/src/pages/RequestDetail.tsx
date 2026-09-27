import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { cancelRequest, getRequest } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { Route } from '../components/Cards';
import { ErrorState, Loading } from '../components/Loading';
import { OfferToCarryModal } from '../components/MatchModals';
import { StatusPill } from '../components/StatusPill';
import { useToast } from '../components/Toast';
import { UserBadge } from '../components/UserBadge';
import { formatDate, formatDateTime, formatKg, formatMoney, humanize } from '../lib/format';
import { categoryLabel, useCategories } from '../lib/meta';
import { useAsync } from '../lib/useAsync';

export function RequestDetailPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const categories = useCategories();
  const req = useAsync(() => getRequest(id), [id]);
  const [offering, setOffering] = useState(false);
  const [pending, setPending] = useState(false);

  if (req.loading) return <Loading />;
  if (req.error || !req.data)
    return (
      <div className="page narrow">
        <ErrorState error={req.error ?? new Error('Request not found')} onRetry={req.reload} />
      </div>
    );

  const r = req.data;
  const isOwner = user?.id === r.sender.id;
  const cat = categories.data?.find((c) => c.key === r.category);

  const onCancel = async () => {
    if (!window.confirm('Cancel this request?')) return;
    setPending(true);
    try {
      req.setData(await cancelRequest(r.id));
      toast.success('Request cancelled.');
    } catch (e) {
      toast.error(e);
    } finally {
      setPending(false);
    }
  };

  const onOffer = () => {
    if (!user) navigate(`/login?next=${encodeURIComponent(`/requests/${r.id}`)}`);
    else setOffering(true);
  };

  return (
    <div className="page narrow">
      <p className="small">
        <Link to="/requests">← All requests</Link>
      </p>
      <div className="card">
        <div className="row between wrap">
          <div>
            <h1 className="item-title-lg">{r.title}</h1>
            <Route from={r.originCountry} fromCity={r.originCity} to={r.destCountry} toCity={r.destCity} />
          </div>
          <div className="reward">
            <span className="reward-amount">{formatMoney(r.rewardMinor, r.currency)}</span>
            <span className="small muted">reward</span>
          </div>
        </div>
        <div className="tags">
          <span className="tag">{categoryLabel(r.category, categories.data)}</span>
          {cat?.requiresInspection && <span className="tag tag-accent">Inspection at handover</span>}
          {cat?.requiresPrescription && <span className="tag tag-warn">Prescription required</span>}
          <StatusPill status={r.status} />
        </div>
        <p className="prewrap">{r.description}</p>
        <dl className="facts">
          <div>
            <dt>Weight</dt>
            <dd>{formatKg(r.weightKg)}</dd>
          </div>
          <div>
            <dt>Declared value</dt>
            <dd>{formatMoney(r.declaredValueMinor, r.currency)}</dd>
          </div>
          <div>
            <dt>Needed by</dt>
            <dd>{formatDate(r.neededByDate)}</dd>
          </div>
          <div>
            <dt>Posted</dt>
            <dd>{formatDateTime(r.createdAt)}</dd>
          </div>
          {isOwner && (
            <div>
              <dt>Recipient</dt>
              <dd>{r.recipientName}</dd>
            </div>
          )}
        </dl>

        <h3>Declared items</h3>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Qty</th>
                <th className="num">Value each</th>
              </tr>
            </thead>
            <tbody>
              {r.items.map((it, i) => (
                <tr key={`${it.name}-${i}`}>
                  <td>{it.name}</td>
                  <td className="num">{it.qty}</td>
                  <td className="num">{formatMoney(it.valueMinor, r.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3>Sender attestations</h3>
        <ul className="check-list">
          {r.attestations.map((a) => (
            <li key={a}>✓ {humanize(a)}</li>
          ))}
        </ul>

        <h3>Sender</h3>
        <UserBadge user={r.sender} role="Sender" />

        <div className="card-actions">
          {!isOwner && r.status === 'open' && (
            <button type="button" className="btn" onClick={onOffer}>
              Offer to carry this
            </button>
          )}
          {isOwner && r.status === 'open' && (
            <button type="button" className="btn btn-danger" onClick={() => void onCancel()} disabled={pending}>
              Cancel request
            </button>
          )}
        </div>
      </div>
      {offering && <OfferToCarryModal request={r} onClose={() => setOffering(false)} />}
    </div>
  );
}
