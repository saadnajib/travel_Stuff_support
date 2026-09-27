import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { createTrip, verifyTrip } from '../api/endpoints';
import type { Category } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { canPost, VerificationBanners } from '../components/Banners';
import { CountrySelect } from '../components/CountrySelect';
import { Field } from '../components/Field';
import { ErrorState, Loading } from '../components/Loading';
import { useToast } from '../components/Toast';
import { todayIso } from '../lib/format';
import { useCategories } from '../lib/meta';

export const BOOKING_REF_RE = /^[A-Z0-9]{6}$/;

export function TripNewPage() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const categories = useCategories();

  const [originCountry, setOriginCountry] = useState('');
  const [originCity, setOriginCity] = useState('');
  const [destCountry, setDestCountry] = useState('');
  const [destCity, setDestCity] = useState('');
  const [departDate, setDepartDate] = useState('');
  const [arriveDate, setArriveDate] = useState('');
  const [capacityKg, setCapacityKg] = useState('5');
  const [allowed, setAllowed] = useState<Category[]>([]);
  const [bookingRef, setBookingRef] = useState('');
  const [airline, setAirline] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const allowedToPost = canPost(user);

  const toggle = (c: Category) =>
    setAllowed((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  const validate = () => {
    const e: Record<string, string> = {};
    if (!originCountry) e.originCountry = 'Select a country.';
    if (originCity.trim().length < 2) e.originCity = 'Enter a city.';
    if (!destCountry) e.destCountry = 'Select a country.';
    if (destCity.trim().length < 2) e.destCity = 'Enter a city.';
    if (originCountry && destCountry && originCountry === destCountry && originCity.trim().toLowerCase() === destCity.trim().toLowerCase())
      e.destCity = 'Destination must differ from origin.';
    if (!departDate) e.departDate = 'Pick a departure date.';
    else if (departDate < todayIso()) e.departDate = 'Departure must be in the future.';
    if (!arriveDate) e.arriveDate = 'Pick an arrival date.';
    else if (departDate && arriveDate < departDate) e.arriveDate = 'Arrival cannot be before departure.';
    const cap = Number(capacityKg);
    if (!Number.isFinite(cap) || cap < 0.1 || cap > 30) e.capacityKg = 'Capacity must be between 0.1 and 30 kg.';
    if (allowed.length === 0) e.allowed = 'Choose at least one category you are willing to carry.';
    if (bookingRef && !BOOKING_REF_RE.test(bookingRef))
      e.bookingRef = 'Booking references are 6 letters/digits (e.g. ABC123).';
    if (bookingRef && airline.trim().length < 2) e.airline = 'Enter the airline to verify your booking.';
    if (notes.length > 1000) e.notes = 'Notes must be under 1000 characters.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const onSubmit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setPending(true);
    try {
      let trip = await createTrip({
        originCountry,
        originCity: originCity.trim(),
        destCountry,
        destCity: destCity.trim(),
        departDate,
        arriveDate,
        capacityKg: Number(capacityKg),
        allowedCategories: allowed,
        bookingRef: bookingRef || undefined,
        notes: notes.trim() || undefined,
      });
      if (bookingRef) {
        try {
          trip = await verifyTrip(trip.id, { bookingRef, airline: airline.trim() });
          if (trip.verified) toast.success('Trip posted and booking verified.');
          else toast.info('Trip posted, but the booking could not be verified.');
        } catch (e) {
          toast.error(`Trip posted, but booking verification failed: ${errorMessage(e)}`);
        }
      } else {
        toast.success('Trip posted. Verify your booking so senders can match with you.');
      }
      navigate(`/trips/${trip.id}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="page narrow">
      <h1>Post a trip</h1>
      <p className="muted">Tell senders where you're going and what you're willing to carry.</p>
      {user && <VerificationBanners user={user} />}
      <form className="card" onSubmit={onSubmit} noValidate>
        <fieldset disabled={pending}>
          <legend className="sr-only">Route</legend>
          <div className="form-grid">
            <Field label="From country" htmlFor="oc" error={errors.originCountry}>
              <CountrySelect id="oc" value={originCountry} onChange={setOriginCountry} required />
            </Field>
            <Field label="From city" htmlFor="ocity" error={errors.originCity}>
              <input id="ocity" value={originCity} onChange={(e) => setOriginCity(e.target.value)} maxLength={80} />
            </Field>
            <Field label="To country" htmlFor="dc" error={errors.destCountry}>
              <CountrySelect id="dc" value={destCountry} onChange={setDestCountry} required />
            </Field>
            <Field label="To city" htmlFor="dcity" error={errors.destCity}>
              <input id="dcity" value={destCity} onChange={(e) => setDestCity(e.target.value)} maxLength={80} />
            </Field>
            <Field label="Departure date" htmlFor="dep" error={errors.departDate}>
              <input id="dep" type="date" min={todayIso()} value={departDate} onChange={(e) => setDepartDate(e.target.value)} />
            </Field>
            <Field label="Arrival date" htmlFor="arr" error={errors.arriveDate}>
              <input
                id="arr"
                type="date"
                min={departDate || todayIso()}
                value={arriveDate}
                onChange={(e) => setArriveDate(e.target.value)}
              />
            </Field>
            <Field label="Spare capacity (kg)" htmlFor="cap" error={errors.capacityKg} hint="Between 0.1 and 30 kg.">
              <input
                id="cap"
                type="number"
                inputMode="decimal"
                min={0.1}
                max={30}
                step={0.1}
                value={capacityKg}
                onChange={(e) => setCapacityKg(e.target.value)}
              />
            </Field>
          </div>

          <div className={`field${errors.allowed ? ' has-error' : ''}`}>
            <span className="label">Categories you'll carry</span>
            {categories.loading && <Loading label="Loading categories…" />}
            {!!categories.error && <ErrorState error={categories.error} onRetry={categories.reload} />}
            <div className="check-grid">
              {categories.data?.map((c) => (
                <label key={c.key} className={allowed.includes(c.key) ? 'check-card checked' : 'check-card'}>
                  <input type="checkbox" checked={allowed.includes(c.key)} onChange={() => toggle(c.key)} />
                  <span>
                    <strong>{c.label}</strong>
                    <span className="small muted block">{c.description}</span>
                  </span>
                </label>
              ))}
            </div>
            {errors.allowed && <p className="field-error">{errors.allowed}</p>}
          </div>

          <div className="form-grid">
            <Field
              label="Booking reference (optional)"
              htmlFor="ref"
              error={errors.bookingRef}
              hint="6-character PNR. Verified trips can be matched."
            >
              <input
                id="ref"
                value={bookingRef}
                maxLength={6}
                autoComplete="off"
                onChange={(e) => setBookingRef(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              />
            </Field>
            {bookingRef && (
              <Field label="Airline" htmlFor="airline" error={errors.airline}>
                <input id="airline" value={airline} onChange={(e) => setAirline(e.target.value)} maxLength={60} />
              </Field>
            )}
          </div>
          <Field label="Notes (optional)" htmlFor="notes" error={errors.notes}>
            <textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
          </Field>
          <button type="submit" className="btn" disabled={pending || !allowedToPost}>
            {pending ? 'Posting…' : 'Post trip'}
          </button>
          {!allowedToPost && <p className="hint">Verify your email and identity to post trips.</p>}
        </fieldset>
      </form>
    </div>
  );
}
