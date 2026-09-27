import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { searchRequests } from '../api/endpoints';
import type { Category, DeliveryRequest } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { RequestCard } from '../components/Cards';
import { CountrySelect } from '../components/CountrySelect';
import { EmptyState, ErrorState, Loading } from '../components/Loading';
import { OfferToCarryModal } from '../components/MatchModals';
import { Pager } from '../components/Pager';
import { ALL_CATEGORIES, categoryLabel, useCategories } from '../lib/meta';
import { useAsync } from '../lib/useAsync';

const PAGE_SIZE = 12;

export function RequestsSearchPage() {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const categories = useCategories();

  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const dateTo = params.get('dateTo') ?? '';
  const category = (params.get('category') ?? '') as Category | '';
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);

  const [draft, setDraft] = useState({ from, to, dateTo, category });
  const [offering, setOffering] = useState<DeliveryRequest | null>(null);

  const results = useAsync(
    () =>
      searchRequests({
        from: from || undefined,
        to: to || undefined,
        dateTo: dateTo || undefined,
        category: category || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    [from, to, dateTo, category, page],
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
    setDraft({ from: '', to: '', dateTo: '', category: '' });
    setParams(new URLSearchParams());
  };

  const setPage = (p: number) => {
    const next = new URLSearchParams(params);
    next.set('page', String(p));
    setParams(next);
  };

  const onOffer = (r: DeliveryRequest) => {
    if (!user) {
      navigate(`/login?next=${encodeURIComponent('/requests/' + r.id)}`);
      return;
    }
    setOffering(r);
  };

  const catList = categories.data?.map((c) => c.key) ?? ALL_CATEGORIES;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Find requests to carry</h1>
          <p className="muted">Open requests from verified senders. Earn a reward on a trip you're already taking.</p>
        </div>
      </div>

      <form className="card filters" onSubmit={onSubmit}>
        <div className="filter-grid">
          <div className="field">
            <label htmlFor="r-from">From</label>
            <CountrySelect id="r-from" value={draft.from} placeholder="Any country" onChange={(v) => setDraft({ ...draft, from: v })} />
          </div>
          <div className="field">
            <label htmlFor="r-to">To</label>
            <CountrySelect id="r-to" value={draft.to} placeholder="Any country" onChange={(v) => setDraft({ ...draft, to: v })} />
          </div>
          <div className="field">
            <label htmlFor="r-dt">Needed by (on or before)</label>
            <input id="r-dt" type="date" value={draft.dateTo} onChange={(e) => setDraft({ ...draft, dateTo: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="r-cat">Category</label>
            <select
              id="r-cat"
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

      {results.loading && <Loading label="Searching requests…" />}
      {!!results.error && <ErrorState error={results.error} onRetry={results.reload} />}
      {results.data && results.data.requests.length === 0 && (
        <EmptyState title="No open requests match your search">Try another route or category.</EmptyState>
      )}
      {results.data && results.data.requests.length > 0 && (
        <>
          <p className="muted small">{results.data.total} request(s) found</p>
          <div className="grid grid-3">
            {results.data.requests.map((r) => (
              <RequestCard
                key={r.id}
                request={r}
                categories={categories.data}
                action={
                  user?.id !== r.sender.id ? (
                    <button type="button" className="btn btn-sm" onClick={() => onOffer(r)}>
                      Offer to carry this
                    </button>
                  ) : (
                    <span className="small muted">Your request</span>
                  )
                }
              />
            ))}
          </div>
          <Pager page={results.data.page} pageSize={results.data.pageSize} total={results.data.total} onPage={setPage} />
        </>
      )}
      {offering && <OfferToCarryModal request={offering} onClose={() => setOffering(null)} />}
    </div>
  );
}
