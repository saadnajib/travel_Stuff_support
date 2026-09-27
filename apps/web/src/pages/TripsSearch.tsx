import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { searchTrips } from '../api/endpoints';
import type { Category, Trip } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { TripCard } from '../components/Cards';
import { CountrySelect } from '../components/CountrySelect';
import { EmptyState, ErrorState, Loading } from '../components/Loading';
import { AskTravellerModal } from '../components/MatchModals';
import { Pager } from '../components/Pager';
import { ALL_CATEGORIES, categoryLabel, useCategories } from '../lib/meta';
import { useAsync } from '../lib/useAsync';

const PAGE_SIZE = 12;

export function TripsSearchPage() {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const categories = useCategories();

  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const dateFrom = params.get('dateFrom') ?? '';
  const dateTo = params.get('dateTo') ?? '';
  const category = (params.get('category') ?? '') as Category | '';
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);

  const [draft, setDraft] = useState({ from, to, dateFrom, dateTo, category });
  const [asking, setAsking] = useState<Trip | null>(null);

  const results = useAsync(
    () =>
      searchTrips({
        from: from || undefined,
        to: to || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        category: category || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    [from, to, dateFrom, dateTo, category, page],
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams();
    Object.entries(draft).forEach(([k, v]) => {
      if (v) next.set(k, v);
    });
    setParams(next);
  };

  const onReset = () => {
    setDraft({ from: '', to: '', dateFrom: '', dateTo: '', category: '' });
    setParams(new URLSearchParams());
  };

  const setPage = (p: number) => {
    const next = new URLSearchParams(params);
    next.set('page', String(p));
    setParams(next);
  };

  const onAsk = (trip: Trip) => {
    if (!user) {
      navigate(`/login?next=${encodeURIComponent('/trips/' + trip.id)}`);
      return;
    }
    setAsking(trip);
  };

  const catList = categories.data?.map((c) => c.key) ?? ALL_CATEGORIES;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Find a traveller</h1>
          <p className="muted">Identity-verified travellers with verified bookings on upcoming trips.</p>
        </div>
      </div>

      <form className="card filters" onSubmit={onSubmit}>
        <div className="filter-grid">
          <div className="field">
            <label htmlFor="f-from">From</label>
            <CountrySelect id="f-from" value={draft.from} placeholder="Any country" onChange={(v) => setDraft({ ...draft, from: v })} />
          </div>
          <div className="field">
            <label htmlFor="f-to">To</label>
            <CountrySelect id="f-to" value={draft.to} placeholder="Any country" onChange={(v) => setDraft({ ...draft, to: v })} />
          </div>
          <div className="field">
            <label htmlFor="f-df">Departing after</label>
            <input id="f-df" type="date" value={draft.dateFrom} onChange={(e) => setDraft({ ...draft, dateFrom: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="f-dt">Departing before</label>
            <input
              id="f-dt"
              type="date"
              min={draft.dateFrom || undefined}
              value={draft.dateTo}
              onChange={(e) => setDraft({ ...draft, dateTo: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="f-cat">Category</label>
            <select
              id="f-cat"
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value as Category | '' })}
            >
              <option value="">Any category</option>
              {catList.map((c) => (
                <option key={c} value={c}>
                  {categoryLabel(c, categories.data)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="row gap-1">
          <button type="submit" className="btn">
            Search
          </button>
          <button type="button" className="btn btn-ghost" onClick={onReset}>
            Reset
          </button>
        </div>
      </form>

      {results.loading && <Loading label="Searching trips…" />}
      {!!results.error && <ErrorState error={results.error} onRetry={results.reload} />}
      {results.data && results.data.trips.length === 0 && (
        <EmptyState title="No trips match your search">Try a wider date range or a different category.</EmptyState>
      )}
      {results.data && results.data.trips.length > 0 && (
        <>
          <p className="muted small">{results.data.total} trip(s) found</p>
          <div className="grid grid-3">
            {results.data.trips.map((t) => (
              <TripCard
                key={t.id}
                trip={t}
                categories={categories.data}
                action={
                  user?.id !== t.traveler.id ? (
                    <button type="button" className="btn btn-sm" onClick={() => onAsk(t)}>
                      Ask this traveller to carry my request
                    </button>
                  ) : (
                    <span className="small muted">Your trip</span>
                  )
                }
              />
            ))}
          </div>
          <Pager page={results.data.page} pageSize={results.data.pageSize} total={results.data.total} onPage={setPage} />
        </>
      )}
      {asking && <AskTravellerModal trip={asking} onClose={() => setAsking(null)} />}
    </div>
  );
}
