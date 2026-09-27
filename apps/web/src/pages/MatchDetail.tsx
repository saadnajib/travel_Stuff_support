import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getMatch } from '../api/endpoints';
import type { Match, MatchCodes, MatchStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Route } from '../components/Cards';
import { ErrorState, Loading } from '../components/Loading';
import { StatusPill } from '../components/StatusPill';
import { UserBadge } from '../components/UserBadge';
import { formatDate, formatDateTime, formatKg, formatMoney } from '../lib/format';
import { categoryLabel, useCategories } from '../lib/meta';
import { useAsync } from '../lib/useAsync';
import {
  CancelPanel,
  CodesDisplay,
  CompletePanel,
  DeliverPanel,
  DisputePanel,
  HandoverPanel,
  PayPanel,
  RespondPanel,
  ReviewPanel,
  ShowCodesPanel,
} from './match/Actions';
import { Chat } from './match/Chat';
import { Stepper } from './match/Stepper';

const TERMINAL: MatchStatus[] = ['completed', 'declined', 'cancelled', 'resolved'];
const DISPUTABLE: MatchStatus[] = ['funded', 'in_transit', 'delivered'];
const REVIEWABLE: MatchStatus[] = ['delivered', 'completed', 'resolved'];
const REFRESH_MS = 15000;

export function MatchDetailPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const categories = useCategories();
  const match = useAsync(() => getMatch(id), [id]);
  const [codes, setCodes] = useState<MatchCodes | null>(null);
  const [freshCodes, setFreshCodes] = useState(false);

  const status = match.data?.status;
  const setMatchData = match.setData;

  // Background refresh so the counterparty's actions show up without a reload.
  useEffect(() => {
    if (!status || TERMINAL.includes(status)) return undefined;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      getMatch(id)
        .then((m) => setMatchData(m))
        .catch(() => undefined);
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [id, status, setMatchData]);

  if (match.loading && !match.data) return <Loading />;
  if (match.error || !match.data || !user)
    return (
      <div className="page narrow">
        <ErrorState error={match.error ?? new Error('Match not found')} onRetry={match.reload} />
      </div>
    );

  const m: Match = match.data;
  const onMatch = (next: Match) => match.setData(next);
  const isSender = m.request.sender.id === user.id;
  const isTraveler = m.trip.traveler.id === user.id;
  const isParty = isSender || isTraveler;
  const proposerIsMe = (m.proposedBy === 'sender' && isSender) || (m.proposedBy === 'traveler' && isTraveler);
  const counterpart = isSender ? m.trip.traveler : m.request.sender;

  const names: Record<string, string> = {
    [m.request.sender.id]: m.request.sender.name,
    [m.trip.traveler.id]: m.trip.traveler.name,
  };

  const panels: JSX.Element[] = [];
  if (isParty) {
    if (m.status === 'proposed') {
      if (!proposerIsMe) panels.push(<RespondPanel key="respond" match={m} onMatch={onMatch} />);
      else
        panels.push(
          <CancelPanel key="cancel" match={m} onMatch={onMatch} waiting={`Waiting for ${counterpart.name} to accept or decline.`} />,
        );
    }
    if (m.status === 'accepted') {
      if (isSender)
        panels.push(
          <PayPanel
            key="pay"
            match={m}
            onMatch={onMatch}
            onCodes={(c) => {
              setCodes(c);
              setFreshCodes(true);
            }}
          />,
        );
      else
        panels.push(
          <div key="waitpay" className="card action-card">
            <h3>Waiting for payment</h3>
            <p className="muted">{counterpart.name} needs to pay into escrow before handover. You'll be able to confirm the handover once it's funded.</p>
          </div>,
        );
      panels.push(<CancelPanel key="cancel" match={m} onMatch={onMatch} />);
    }
    if (isSender && (m.status === 'funded' || m.status === 'in_transit') && !freshCodes)
      panels.push(<ShowCodesPanel key="codes" match={m} codes={codes} onCodes={setCodes} />);
    if (isTraveler && m.status === 'funded') panels.push(<HandoverPanel key="handover" match={m} onMatch={onMatch} />);
    if (isTraveler && m.status === 'in_transit') panels.push(<DeliverPanel key="deliver" match={m} onMatch={onMatch} />);
    if (isSender && m.status === 'delivered') panels.push(<CompletePanel key="complete" match={m} onMatch={onMatch} />);
    if (DISPUTABLE.includes(m.status)) panels.push(<DisputePanel key="dispute" match={m} onMatch={onMatch} />);
    if (REVIEWABLE.includes(m.status))
      panels.push(<ReviewPanel key="review" match={m} counterpartName={counterpart.name} />);
    if (m.status === 'disputed')
      panels.push(
        <div key="disputed" className="card action-card action-danger">
          <h3>Under dispute</h3>
          <p className="muted">Escrow is frozen while our team reviews this case. We'll update the match once it's resolved.</p>
        </div>,
      );
  }

  return (
    <div className="page">
      <p className="small">
        <Link to="/matches">← All matches</Link>
      </p>
      <div className="page-head">
        <div>
          <h1>{m.request.title}</h1>
          <Route from={m.trip.originCountry} fromCity={m.trip.originCity} to={m.trip.destCountry} toCity={m.trip.destCity} />
        </div>
        <StatusPill status={m.status} />
      </div>

      <div className="card">
        <Stepper match={m} />
      </div>

      {freshCodes && codes && (
        <section className="card codes-card" aria-live="assertive">
          <h2>Payment held — here are your codes</h2>
          <p className="muted">
            Save these now. You can view them again with “Show codes” until the delivery is complete.
          </p>
          <CodesDisplay codes={codes} recipientName={m.request.recipientName} />
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setFreshCodes(false);
              setCodes(null);
            }}
          >
            I've saved them
          </button>
        </section>
      )}

      <div className="match-layout">
        <div className="match-main">
          {panels.length > 0 && <div className="action-stack">{panels}</div>}
          {!isParty && <div className="alert alert-info">You're viewing this match as an administrator.</div>}

          <section className="card">
            <h2>Parties</h2>
            <div className="grid grid-2">
              <UserBadge user={m.request.sender} role={isSender ? 'Sender (you)' : 'Sender'} />
              <UserBadge user={m.trip.traveler} role={isTraveler ? 'Traveller (you)' : 'Traveller'} />
            </div>
            <p className="small muted">
              Proposed by the {m.proposedBy === 'sender' ? 'sender' : 'traveller'} on {formatDateTime(m.createdAt)}.
            </p>
          </section>

          <section className="card">
            <h2>Fees</h2>
            <dl className="fee-table">
              <div>
                <dt>Traveller reward</dt>
                <dd>{formatMoney(m.agreedRewardMinor, m.currency)}</dd>
              </div>
              <div>
                <dt>Platform fee</dt>
                <dd>{formatMoney(m.platformFeeMinor, m.currency)}</dd>
              </div>
              <div>
                <dt>Protection fee</dt>
                <dd>{formatMoney(m.protectionFeeMinor, m.currency)}</dd>
              </div>
              <div className="fee-total">
                <dt>Total charged to sender</dt>
                <dd>{formatMoney(m.totalChargeMinor, m.currency)}</dd>
              </div>
            </dl>
            {m.escrow ? (
              <p className="small">
                Escrow: <StatusPill status={m.escrow.status} /> {formatMoney(m.escrow.amountMinor, m.escrow.currency)} held{' '}
                {formatDateTime(m.escrow.heldAt)}
                {m.escrow.releasedAt && <> · settled {formatDateTime(m.escrow.releasedAt)}</>}
              </p>
            ) : (
              <p className="small muted">No payment yet.</p>
            )}
          </section>

          <section className="card">
            <h2>Delivery details</h2>
            <dl className="facts">
              <div>
                <dt>Category</dt>
                <dd>{categoryLabel(m.request.category, categories.data)}</dd>
              </div>
              <div>
                <dt>Weight</dt>
                <dd>{formatKg(m.request.weightKg)}</dd>
              </div>
              <div>
                <dt>Declared value</dt>
                <dd>{formatMoney(m.request.declaredValueMinor, m.request.currency)}</dd>
              </div>
              <div>
                <dt>Departs</dt>
                <dd>{formatDate(m.trip.departDate)}</dd>
              </div>
              <div>
                <dt>Needed by</dt>
                <dd>{formatDate(m.request.neededByDate)}</dd>
              </div>
              <div>
                <dt>Recipient</dt>
                <dd>{m.request.recipientName}</dd>
              </div>
            </dl>
            <h3>Declared items</h3>
            <ul className="plain-list">
              {m.request.items.map((it, i) => (
                <li key={`${it.name}-${i}`}>
                  {it.qty} × {it.name} <span className="muted">({formatMoney(it.valueMinor, m.request.currency)} each)</span>
                </li>
              ))}
            </ul>
            {(m.inspectionNotes || m.inspectionPhotoRefs.length > 0) && (
              <>
                <h3>Inspection at handover</h3>
                {m.inspectionNotes && <p className="prewrap">{m.inspectionNotes}</p>}
                {m.inspectionPhotoRefs.length > 0 && (
                  <p className="small muted">
                    {m.inspectionPhotoRefs.length} photo(s) on file: {m.inspectionPhotoRefs.join(', ')}
                  </p>
                )}
              </>
            )}
            <p className="small">
              <Link to={`/requests/${m.request.id}`}>View request</Link> · <Link to={`/trips/${m.trip.id}`}>View trip</Link>
            </p>
          </section>
        </div>
        <aside className="match-side">
          <Chat key={m.id} matchId={m.id} status={m.status} meId={user.id} names={names} />
        </aside>
      </div>
    </div>
  );
}
