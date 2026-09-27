import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { cancelTrip, getTrip, verifyTrip } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { Route } from '../components/Cards';
import { Field } from '../components/Field';
import { ErrorState, Loading } from '../components/Loading';
import { AskTravellerModal } from '../components/MatchModals';
import { StatusPill } from '../components/StatusPill';
import { useToast } from '../components/Toast';
import { UserBadge } from '../components/UserBadge';
import { formatDate, formatDateTime, formatKg } from '../lib/format';
import { categoryLabel, useCategories } from '../lib/meta';
import { useAsync } from '../lib/useAsync';
import { BOOKING_REF_RE } from './TripNew';

export function TripDetailPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const categories = useCategories();
  const trip = useAsync(() => getTrip(id), [id]);
  const [asking, setAsking] = useState(false);
  const [bookingRef, setBookingRef] = useState('');
  const [airline, setAirline] = useState('');
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (trip.loading) return <Loading />;
  if (trip.error || !trip.data)
    return (
      <div className="page narrow">
        <ErrorState error={trip.error ?? new Error('Trip not found')} onRetry={trip.reload} />
      </div>
    );

  const t = trip.data;
  const isOwner = user?.id === t.traveler.id;

  const onVerify = async (e: FormEvent) => {
    e.preventDefault();
    setVerifyError(null);
    if (!BOOKING_REF_RE.test(bookingRef)) {
      setVerifyError('Booking references are 6 letters/digits (e.g. ABC123).');
      return;
    }
    if (airline.trim().length < 2) {
      setVerifyError('Enter the airline.');
      return;
    }
    setPending(true);
    try {
      const updated = await verifyTrip(t.id, { bookingRef, airline: airline.trim() });
      trip.setData(updated);
      if (updated.verified) toast.success('Booking verified.');
      else toast.info('Booking could not be verified. Check the reference and try again.');
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(false);
    }
  };

  const onCancel = async () => {
    if (!window.confirm('Cancel this trip? Pending proposals will be withdrawn.')) return;
    setPending(true);
    try {
      trip.setData(await cancelTrip(t.id));
      toast.success('Trip cancelled.');
    } catch (err) {
      toast.error(err);
    } finally {
      setPending(false);
    }
  };

  const onAsk = () => {
    if (!user) navigate(`/login?next=${encodeURIComponent(`/trips/${t.id}`)}`);
    else setAsking(true);
  };

  return (
    <div className="page narrow">
      <p className="small">
        <Link to="/trips">← All trips</Link>
      </p>
      <div className="card">
        <div className="row between wrap">
          <Route from={t.originCountry} fromCity={t.originCity} to={t.destCountry} toCity={t.destCity} />
          <div className="row gap-1">
            {t.verified ? (
              <span className="badge kyc-verified">Booking verified</span>
            ) : (
              <span className="badge badge-neutral">Booking unverified</span>
            )}
            <StatusPill status={t.status} />
          </div>
        </div>
        <dl className="facts">
          <div>
            <dt>Departs</dt>
            <dd>{formatDate(t.departDate)}</dd>
          </div>
          <div>
            <dt>Arrives</dt>
            <dd>{formatDate(t.arriveDate)}</dd>
          </div>
          <div>
            <dt>Capacity</dt>
            <dd>{formatKg(t.capacityKg)}</dd>
          </div>
          <div>
            <dt>Posted</dt>
            <dd>{formatDateTime(t.createdAt)}</dd>
          </div>
        </dl>
        <h3>Will carry</h3>
        <div className="tags">
          {t.allowedCategories.map((c) => (
            <span key={c} className="tag">
              {categoryLabel(c, categories.data)}
            </span>
          ))}
        </div>
        {t.notes && (
          <>
            <h3>Notes</h3>
            <p className="prewrap">{t.notes}</p>
          </>
        )}
        <h3>Traveller</h3>
        <UserBadge user={t.traveler} role="Traveller" />
        <div className="card-actions">
          {!isOwner && t.status === 'published' && (
            <button type="button" className="btn" onClick={onAsk}>
              Ask this traveller to carry my request
            </button>
          )}
          {isOwner && t.status === 'published' && (
            <button type="button" className="btn btn-danger" onClick={() => void onCancel()} disabled={pending}>
              Cancel trip
            </button>
          )}
        </div>
      </div>

      {isOwner && !t.verified && t.status === 'published' && (
        <form className="card" onSubmit={onVerify} noValidate>
          <h2>Verify your booking</h2>
          <p className="muted">Senders can only match with trips that have a verified booking reference.</p>
          {verifyError && <div className="alert alert-error">{verifyError}</div>}
          <div className="form-grid">
            <Field label="Booking reference" htmlFor="v-ref">
              <input
                id="v-ref"
                maxLength={6}
                value={bookingRef}
                onChange={(e) => setBookingRef(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              />
            </Field>
            <Field label="Airline" htmlFor="v-air">
              <input id="v-air" value={airline} onChange={(e) => setAirline(e.target.value)} />
            </Field>
          </div>
          <button type="submit" className="btn" disabled={pending}>
            {pending ? 'Verifying…' : 'Verify booking'}
          </button>
        </form>
      )}
      {asking && <AskTravellerModal trip={t} onClose={() => setAsking(false)} />}
    </div>
  );
}
