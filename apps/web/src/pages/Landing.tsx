import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ErrorState, Loading } from '../components/Loading';
import { formatMoney } from '../lib/format';
import { useCategories, useProhibited } from '../lib/meta';

const VALUE_PROPS = [
  {
    title: 'Verified travellers',
    body: 'Every traveller passes identity checks (KYC) and trips are backed by a verified booking before they can carry anything.',
  },
  {
    title: 'Inspected items only',
    body: 'Items are handed over unsealed. The traveller inspects, photographs and records notes before accepting — no mystery parcels.',
  },
  {
    title: 'Escrow with codes',
    body: 'Your payment is held in escrow. A handover code confirms pickup and a delivery code releases payment only when the recipient has the item.',
  },
  {
    title: 'In-app chat',
    body: 'Coordinate safely inside CarryLink. Contact details are hidden in chat so every step stays protected and on record.',
  },
];

const SENDER_STEPS = [
  { title: 'Post a request', body: 'Describe the item, declare its contents and value, set a reward and sign the safety attestations.' },
  { title: 'Match & pay into escrow', body: 'Ask a verified traveller on your route. Once they accept, pay — funds are held, not released.' },
  { title: 'Share the codes', body: 'Give the handover code at pickup and the delivery code to your recipient. Payment releases on delivery.' },
];

const TRAVELLER_STEPS = [
  { title: 'Verify & post your trip', body: 'Complete ID verification, add your route and dates, and verify your booking reference.' },
  { title: 'Accept requests you are comfortable with', body: 'Choose the categories you carry and the requests you want. You can decline anything.' },
  { title: 'Inspect, carry, deliver', body: 'Inspect and photograph at handover, enter the codes, and get paid when the item is delivered.' },
];

export function LandingPage() {
  const { user } = useAuth();
  const categories = useCategories();
  const prohibited = useProhibited();

  return (
    <div className="landing">
      <section className="hero">
        <div className="hero-inner">
          <p className="eyebrow">Traveller-to-traveller delivery, done safely</p>
          <h1>Send things with people already making the trip.</h1>
          <p className="lead">
            CarryLink connects senders with identity-verified travellers. Items are inspected at handover, payment is
            held in escrow, and release happens only with the recipient's delivery code.
          </p>
          <div className="hero-actions">
            {user ? (
              <Link className="btn btn-lg" to="/dashboard">
                Go to your dashboard
              </Link>
            ) : (
              <Link className="btn btn-lg" to="/register">
                Create a free account
              </Link>
            )}
            <Link className="btn btn-lg btn-secondary" to="/trips">
              Browse trips
            </Link>
          </div>
        </div>
      </section>

      <section className="page">
        <div className="grid grid-4">
          {VALUE_PROPS.map((v) => (
            <div key={v.title} className="card value-card">
              <h3>{v.title}</h3>
              <p className="muted">{v.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="page">
        <h2 className="section-title">How it works</h2>
        <div className="grid grid-2">
          <div className="card">
            <h3>For senders</h3>
            <ol className="steps">
              {SENDER_STEPS.map((s, i) => (
                <li key={s.title}>
                  <span className="step-num" aria-hidden="true">
                    {i + 1}
                  </span>
                  <div>
                    <strong>{s.title}</strong>
                    <p className="muted">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div className="card">
            <h3>For travellers</h3>
            <ol className="steps">
              {TRAVELLER_STEPS.map((s, i) => (
                <li key={s.title}>
                  <span className="step-num" aria-hidden="true">
                    {i + 1}
                  </span>
                  <div>
                    <strong>{s.title}</strong>
                    <p className="muted">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="page">
        <h2 className="section-title">What you can send</h2>
        {categories.loading && <Loading label="Loading categories…" />}
        {!!categories.error && <ErrorState error={categories.error} onRetry={categories.reload} />}
        <div className="grid grid-3">
          {categories.data?.map((c) => (
            <div key={c.key} className="card category-card">
              <h3>{c.label}</h3>
              <p className="muted">{c.description}</p>
              <div className="tags">
                <span className="tag">Up to {c.maxWeightKg} kg</span>
                <span className="tag">Max value {formatMoney(c.maxValueMinor)}</span>
                {c.requiresInspection && <span className="tag tag-accent">Inspection required</span>}
                {c.requiresPrescription && <span className="tag tag-warn">Prescription required</span>}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="page">
        <div className="card prohibited-card">
          <h2>Never allowed on CarryLink</h2>
          <p className="muted">
            Requests mentioning any of these are rejected automatically, and travellers may refuse anything they are not
            comfortable carrying. Customs and airline rules always apply.
          </p>
          {prohibited.loading && <Loading label="Loading prohibited items…" />}
          {!!prohibited.error && <ErrorState error={prohibited.error} onRetry={prohibited.reload} />}
          {prohibited.data && (
            <ul className="prohibited-list">
              {prohibited.data.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {!user && (
        <section className="page">
          <div className="card cta-card">
            <div>
              <h2>Ready to send or carry?</h2>
              <p className="muted">Sign up, verify your identity once, and start matching on your route.</p>
            </div>
            <Link className="btn btn-lg" to="/register">
              Register now
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
