import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createMatch, getMyRequests, getMyTrips } from '../api/endpoints';
import type { DeliveryRequest, Trip } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { formatDate, formatKg, formatMoney } from '../lib/format';
import { categoryLabel, useCategories } from '../lib/meta';
import { useAsync } from '../lib/useAsync';
import { EmptyState, ErrorState, Loading } from './Loading';
import { Modal } from './Modal';
import { useToast } from './Toast';

function KycNote() {
  const { user } = useAuth();
  if (!user || user.kycStatus === 'verified') return null;
  return (
    <div className="alert alert-warn">
      Both parties must be identity-verified to match. <Link to="/kyc">Complete verification</Link>.
    </div>
  );
}

/** Sender picks one of their open requests on the trip's route to propose to the traveller. */
export function AskTravellerModal({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { data: categories } = useCategories();
  const mine = useAsync(getMyRequests, []);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const onRoute = (mine.data ?? []).filter(
    (r) => r.status === 'open' && r.originCountry === trip.originCountry && r.destCountry === trip.destCountry,
  );

  const reasonIneligible = (r: DeliveryRequest): string | null => {
    if (!trip.allowedCategories.includes(r.category)) return 'Category not accepted on this trip';
    if (r.weightKg > trip.capacityKg) return 'Heavier than trip capacity';
    if (trip.departDate.slice(0, 10) > r.neededByDate.slice(0, 10)) return 'Trip departs after this request is needed';
    return null;
  };

  const propose = async (r: DeliveryRequest) => {
    setPendingId(r.id);
    try {
      const match = await createMatch({ requestId: r.id, tripId: trip.id });
      toast.success('Request sent to the traveller.');
      onClose();
      navigate(`/matches/${match.id}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setPendingId(null);
    }
  };

  return (
    <Modal title="Ask this traveller to carry my request" onClose={onClose}>
      <p className="muted">
        Showing your open requests from {trip.originCity} to {trip.destCity}.
      </p>
      <KycNote />
      {mine.loading && <Loading />}
      {!!mine.error && <ErrorState error={mine.error} onRetry={mine.reload} />}
      {!mine.loading && !mine.error && onRoute.length === 0 && (
        <EmptyState
          title="No open requests on this route"
          action={
            <Link className="btn btn-sm" to="/requests/new" onClick={onClose}>
              Post a request
            </Link>
          }
        >
          Post a request with the same origin and destination countries first.
        </EmptyState>
      )}
      <ul className="pick-list">
        {onRoute.map((r) => {
          const reason = reasonIneligible(r);
          return (
            <li key={r.id} className="pick-item">
              <div>
                <strong>{r.title}</strong>
                <div className="small muted">
                  {categoryLabel(r.category, categories)} · {formatKg(r.weightKg)} ·{' '}
                  {formatMoney(r.rewardMinor, r.currency)} · by {formatDate(r.neededByDate)}
                </div>
                {reason && <div className="small text-danger">{reason}</div>}
              </div>
              <button
                type="button"
                className="btn btn-sm"
                disabled={!!reason || pendingId !== null}
                onClick={() => void propose(r)}
              >
                {pendingId === r.id ? 'Sending…' : 'Ask'}
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}

/** Traveller picks one of their verified trips on the request's route to offer carrying it. */
export function OfferToCarryModal({ request, onClose }: { request: DeliveryRequest; onClose: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const mine = useAsync(getMyTrips, []);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const onRoute = (mine.data ?? []).filter(
    (t) =>
      t.status === 'published' &&
      t.originCountry === request.originCountry &&
      t.destCountry === request.destCountry,
  );

  const reasonIneligible = (t: Trip): string | null => {
    if (!t.verified) return 'Trip booking not verified yet';
    if (!t.allowedCategories.includes(request.category)) return 'You do not accept this category on this trip';
    if (request.weightKg > t.capacityKg) return 'Not enough capacity';
    if (t.departDate.slice(0, 10) > request.neededByDate.slice(0, 10)) return 'Trip departs after the needed-by date';
    return null;
  };

  const offer = async (t: Trip) => {
    setPendingId(t.id);
    try {
      const match = await createMatch({ requestId: request.id, tripId: t.id });
      toast.success('Offer sent to the sender.');
      onClose();
      navigate(`/matches/${match.id}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setPendingId(null);
    }
  };

  return (
    <Modal title="Offer to carry this" onClose={onClose}>
      <p className="muted">
        Showing your trips from {request.originCity} to {request.destCity}. Only verified trips can be matched.
      </p>
      <KycNote />
      {mine.loading && <Loading />}
      {!!mine.error && <ErrorState error={mine.error} onRetry={mine.reload} />}
      {!mine.loading && !mine.error && onRoute.length === 0 && (
        <EmptyState
          title="No trips on this route"
          action={
            <Link className="btn btn-sm" to="/trips/new" onClick={onClose}>
              Post a trip
            </Link>
          }
        >
          Post a trip with the same origin and destination countries first.
        </EmptyState>
      )}
      <ul className="pick-list">
        {onRoute.map((t) => {
          const reason = reasonIneligible(t);
          return (
            <li key={t.id} className="pick-item">
              <div>
                <strong>
                  {t.originCity} → {t.destCity}
                </strong>
                <div className="small muted">
                  {formatDate(t.departDate)} · {formatKg(t.capacityKg)} capacity
                </div>
                {reason && <div className="small text-danger">{reason}</div>}
              </div>
              <button
                type="button"
                className="btn btn-sm"
                disabled={!!reason || pendingId !== null}
                onClick={() => void offer(t)}
              >
                {pendingId === t.id ? 'Sending…' : 'Offer'}
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
