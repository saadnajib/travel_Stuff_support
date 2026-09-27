import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { CategoryInfo, DeliveryRequest, Trip } from '../api/types';
import { countryName } from '../lib/countries';
import { formatDate, formatKg, formatMoney } from '../lib/format';
import { categoryLabel } from '../lib/meta';
import { StatusPill } from './StatusPill';
import { UserBadge } from './UserBadge';

export function Route({ from, fromCity, to, toCity }: { from: string; fromCity: string; to: string; toCity: string }) {
  return (
    <div className="route">
      <span>
        <strong>{fromCity}</strong> <span className="muted">{countryName(from)}</span>
      </span>
      <span className="route-arrow" aria-label="to">
        →
      </span>
      <span>
        <strong>{toCity}</strong> <span className="muted">{countryName(to)}</span>
      </span>
    </div>
  );
}

export function TripCard({
  trip,
  categories,
  action,
  showTraveler = true,
}: {
  trip: Trip;
  categories?: CategoryInfo[];
  action?: ReactNode;
  showTraveler?: boolean;
}) {
  return (
    <article className="card item-card">
      <div className="item-card-head">
        <Route from={trip.originCountry} fromCity={trip.originCity} to={trip.destCountry} toCity={trip.destCity} />
        <div className="row gap-1">
          {trip.verified ? (
            <span className="badge kyc-verified" title="Booking verified">
              Booking verified
            </span>
          ) : (
            <span className="badge badge-neutral">Booking unverified</span>
          )}
          {trip.status !== 'published' && <StatusPill status={trip.status} />}
        </div>
      </div>
      <dl className="facts">
        <div>
          <dt>Departs</dt>
          <dd>{formatDate(trip.departDate)}</dd>
        </div>
        <div>
          <dt>Arrives</dt>
          <dd>{formatDate(trip.arriveDate)}</dd>
        </div>
        <div>
          <dt>Capacity</dt>
          <dd>{formatKg(trip.capacityKg)}</dd>
        </div>
      </dl>
      <div className="tags">
        {trip.allowedCategories.map((c) => (
          <span key={c} className="tag">
            {categoryLabel(c, categories)}
          </span>
        ))}
      </div>
      {showTraveler && <UserBadge user={trip.traveler} role="Traveller" />}
      <div className="card-actions">
        <Link className="btn btn-secondary btn-sm" to={`/trips/${trip.id}`}>
          View trip
        </Link>
        {action}
      </div>
    </article>
  );
}

export function RequestCard({
  request,
  categories,
  action,
  showSender = true,
}: {
  request: DeliveryRequest;
  categories?: CategoryInfo[];
  action?: ReactNode;
  showSender?: boolean;
}) {
  return (
    <article className="card item-card">
      <div className="item-card-head">
        <div>
          <h3 className="item-title">{request.title}</h3>
          <Route
            from={request.originCountry}
            fromCity={request.originCity}
            to={request.destCountry}
            toCity={request.destCity}
          />
        </div>
        <div className="reward">
          <span className="reward-amount">{formatMoney(request.rewardMinor, request.currency)}</span>
          <span className="small muted">reward</span>
        </div>
      </div>
      <div className="tags">
        <span className="tag">{categoryLabel(request.category, categories)}</span>
        {request.status !== 'open' && <StatusPill status={request.status} />}
      </div>
      <dl className="facts">
        <div>
          <dt>Weight</dt>
          <dd>{formatKg(request.weightKg)}</dd>
        </div>
        <div>
          <dt>Declared value</dt>
          <dd>{formatMoney(request.declaredValueMinor, request.currency)}</dd>
        </div>
        <div>
          <dt>Needed by</dt>
          <dd>{formatDate(request.neededByDate)}</dd>
        </div>
      </dl>
      {showSender && <UserBadge user={request.sender} role="Sender" />}
      <div className="card-actions">
        <Link className="btn btn-secondary btn-sm" to={`/requests/${request.id}`}>
          View request
        </Link>
        {action}
      </div>
    </article>
  );
}
