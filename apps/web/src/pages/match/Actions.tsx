import { useState, type FormEvent, type ReactNode } from 'react';
import { isApiError } from '../../api/client';
import * as ep from '../../api/endpoints';
import type { Match, MatchCodes } from '../../api/types';
import { CopyButton } from '../../components/CopyButton';
import { Field } from '../../components/Field';
import { FileUpload, type UploadedFile } from '../../components/FileUpload';
import { StarInput } from '../../components/StarInput';
import { useToast } from '../../components/Toast';
import { formatMoney } from '../../lib/format';

interface Ctx {
  match: Match;
  onMatch: (m: Match) => void;
}

const CODE_RE = /^\d{6}$/;

function Panel({ title, children, tone }: { title: string; children: ReactNode; tone?: 'danger' }) {
  return (
    <section className={`card action-card${tone === 'danger' ? ' action-danger' : ''}`}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function useRun() {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const run = async (fn: () => Promise<void>, success?: string) => {
    setPending(true);
    try {
      await fn();
      if (success) toast.success(success);
    } catch (e) {
      toast.error(e);
    } finally {
      setPending(false);
    }
  };
  return { pending, run };
}

export function RespondPanel({ match, onMatch }: Ctx) {
  const { pending, run } = useRun();
  const proposer = match.proposedBy === 'sender' ? match.request.sender.name : match.trip.traveler.name;
  return (
    <Panel title="Respond to this proposal">
      <p className="muted">
        {proposer} proposed this match. Review the request and trip details, then accept or decline.
      </p>
      <div className="row gap-1 wrap">
        <button type="button" className="btn" disabled={pending} onClick={() => void run(async () => onMatch(await ep.acceptMatch(match.id)), 'Match accepted.')}>
          Accept
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={pending}
          onClick={() => {
            if (window.confirm('Decline this proposal?')) void run(async () => onMatch(await ep.declineMatch(match.id)), 'Proposal declined.');
          }}
        >
          Decline
        </button>
      </div>
    </Panel>
  );
}

export function CancelPanel({ match, onMatch, waiting }: Ctx & { waiting?: string }) {
  const { pending, run } = useRun();
  return (
    <Panel title={waiting ? 'Waiting for response' : 'Cancel match'}>
      {waiting && <p className="muted">{waiting}</p>}
      <p className="small muted">Either party can cancel before payment is made.</p>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={pending}
        onClick={() => {
          if (window.confirm('Cancel this match?')) void run(async () => onMatch(await ep.cancelMatch(match.id)), 'Match cancelled.');
        }}
      >
        Cancel match
      </button>
    </Panel>
  );
}

export function CodesDisplay({ codes, recipientName }: { codes: MatchCodes; recipientName: string }) {
  return (
    <div className="codes">
      <div className="code-box">
        <span className="code-label">Handover code</span>
        <span className="code-value">{codes.handoverCode}</span>
        <CopyButton value={codes.handoverCode} />
        <p className="small">
          Give this to the <strong>traveller in person</strong>, only after they have inspected the items and you have
          handed them over. It moves the delivery to “in transit”.
        </p>
      </div>
      <div className="code-box">
        <span className="code-label">Delivery code</span>
        <span className="code-value">{codes.deliveryCode}</span>
        <CopyButton value={codes.deliveryCode} />
        <p className="small">
          Send this to <strong>{recipientName}</strong>. They should give it to the traveller only once the items are in
          their hands — it releases your payment from escrow.
        </p>
      </div>
      <p className="small muted codes-warning">
        Never share either code in chat or before the step it belongs to. CarryLink staff will never ask for them.
      </p>
    </div>
  );
}

export function PayPanel({ match, onMatch, onCodes }: Ctx & { onCodes: (c: MatchCodes) => void }) {
  const { pending, run } = useRun();
  const [token, setToken] = useState('tok_test_visa');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^tok_[A-Za-z0-9_]+$/.test(token.trim())) {
      setError('Enter a payment token such as tok_test_visa.');
      return;
    }
    void run(async () => {
      const res = await ep.payMatch(match.id, token.trim());
      onMatch(res.match);
      onCodes(res.codes);
    }, 'Payment held in escrow.');
  };

  return (
    <Panel title="Pay into escrow">
      <p className="muted">
        The traveller accepted. Pay now — funds are held in escrow and only released when your recipient provides the
        delivery code.
      </p>
      <dl className="fee-table">
        <div>
          <dt>Total charge</dt>
          <dd>
            <strong>{formatMoney(match.totalChargeMinor, match.currency)}</strong>
          </dd>
        </div>
      </dl>
      <form onSubmit={onSubmit} noValidate>
        <Field label="Payment method token (test mode)" htmlFor="pay-token" error={error} hint="Use tok_test_visa in development.">
          <input id="pay-token" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
        </Field>
        <button type="submit" className="btn" disabled={pending}>
          {pending ? 'Processing…' : `Pay ${formatMoney(match.totalChargeMinor, match.currency)}`}
        </button>
      </form>
    </Panel>
  );
}

export function ShowCodesPanel({ match, codes, onCodes }: { match: Match; codes: MatchCodes | null; onCodes: (c: MatchCodes | null) => void }) {
  const { pending, run } = useRun();
  if (codes) {
    return (
      <Panel title="Your codes">
        <CodesDisplay codes={codes} recipientName={match.request.recipientName} />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onCodes(null)}>
          Hide codes
        </button>
      </Panel>
    );
  }
  return (
    <Panel title="Handover & delivery codes">
      <p className="muted">
        {match.status === 'funded'
          ? 'Give the handover code to the traveller at pickup, after inspection.'
          : 'Your items are in transit. Make sure your recipient has the delivery code.'}
      </p>
      <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => void run(async () => onCodes(await ep.getMatchCodes(match.id)))}>
        Show codes
      </button>
    </Panel>
  );
}

export function HandoverPanel({ match, onMatch }: Ctx) {
  const { pending, run } = useRun();
  const [code, setCode] = useState('');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<UploadedFile[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!CODE_RE.test(code)) errs.code = 'The handover code is 6 digits.';
    if (notes.trim().length < 5) errs.notes = 'Describe what you inspected (at least 5 characters).';
    if (photos.length === 0) errs.photos = 'Add at least one photo of the inspected items.';
    else if (photos.length > 10) errs.photos = 'Add at most 10 photos.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    void run(async () => {
      onMatch(await ep.handoverMatch(match.id, { code, inspectionNotes: notes.trim(), photoRefs: photos.map((p) => p.ref) }));
    }, 'Handover confirmed. Safe travels!');
  };

  return (
    <Panel title="Confirm handover">
      <p className="muted">
        Inspect every item against the declaration, photograph them, then ask the sender for the handover code. Do not
        accept anything sealed or not declared. Five wrong codes lock the match and open a dispute.
      </p>
      <form onSubmit={onSubmit} noValidate>
        <fieldset disabled={pending}>
          <Field label="Handover code" htmlFor="ho-code" error={errors.code}>
            <input
              id="ho-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
          </Field>
          <Field label="Inspection notes" htmlFor="ho-notes" error={errors.notes}>
            <textarea id="ho-notes" rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <FileUpload label="Inspection photos" hint="At least one photo. Images only, max 10 MB each." multiple imagesOnly value={photos} onChange={setPhotos} />
          {errors.photos && <p className="field-error">{errors.photos}</p>}
          <button type="submit" className="btn" disabled={pending}>
            {pending ? 'Confirming…' : 'Confirm handover'}
          </button>
        </fieldset>
      </form>
    </Panel>
  );
}

export function DeliverPanel({ match, onMatch }: Ctx) {
  const { pending, run } = useRun();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!CODE_RE.test(code)) {
      setError('The delivery code is 6 digits.');
      return;
    }
    setError(null);
    void run(async () => onMatch(await ep.deliverMatch(match.id, code)), 'Delivered! Payment released from escrow.');
  };
  return (
    <Panel title="Confirm delivery">
      <p className="muted">
        Hand the items to <strong>{match.request.recipientName}</strong> and ask them for the delivery code.
      </p>
      <form onSubmit={onSubmit} noValidate>
        <Field label="Delivery code" htmlFor="dl-code" error={error}>
          <input
            id="dl-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
        </Field>
        <button type="submit" className="btn" disabled={pending}>
          {pending ? 'Confirming…' : 'Confirm delivery'}
        </button>
      </form>
    </Panel>
  );
}

export function CompletePanel({ match, onMatch }: Ctx) {
  const { pending, run } = useRun();
  return (
    <Panel title="Confirm completion">
      <p className="muted">
        Your recipient has the items. Confirm to complete the match. If something is wrong, open a dispute instead —
        the match completes automatically after the 48-hour dispute window.
      </p>
      <button type="button" className="btn" disabled={pending} onClick={() => void run(async () => onMatch(await ep.completeMatch(match.id)), 'Match completed. Thanks!')}>
        Confirm completion
      </button>
    </Panel>
  );
}

const DISPUTE_REASONS = [
  'Items not as declared',
  'Items damaged or missing',
  'Handover or delivery problem',
  'Traveller or sender unresponsive',
  'Safety concern',
  'Other',
];

export function DisputePanel({ match, onMatch }: Ctx) {
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(DISPUTE_REASONS[0]);
  const [details, setDetails] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (details.trim().length < 10) {
      setError('Please explain what happened (at least 10 characters).');
      return;
    }
    setError(null);
    void run(async () => {
      const res = await ep.disputeMatch(match.id, { reason, details: details.trim() });
      onMatch(res.match);
      setOpen(false);
    }, 'Dispute opened. Escrow is frozen until an admin reviews it.');
  };

  return (
    <Panel title="Problem with this delivery?" tone="danger">
      {!open ? (
        <>
          <p className="small muted">Opening a dispute freezes the escrow until our team reviews the case.</p>
          <button type="button" className="btn btn-danger btn-sm" onClick={() => setOpen(true)}>
            Open dispute
          </button>
        </>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <fieldset disabled={pending}>
            <Field label="Reason" htmlFor="dp-reason">
              <select id="dp-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
                {DISPUTE_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Details" htmlFor="dp-details" error={error}>
              <textarea id="dp-details" rows={4} maxLength={3000} value={details} onChange={(e) => setDetails(e.target.value)} />
            </Field>
            <div className="row gap-1">
              <button type="submit" className="btn btn-danger" disabled={pending}>
                {pending ? 'Submitting…' : 'Submit dispute'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </Panel>
  );
}

export function ReviewPanel({ match, counterpartName }: { match: Match; counterpartName: string }) {
  const toast = useToast();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (rating < 1 || rating > 5) {
      setError('Choose a rating from 1 to 5 stars.');
      return;
    }
    if (comment.length > 1000) {
      setError('Comment must be under 1000 characters.');
      return;
    }
    setError(null);
    setPending(true);
    try {
      await ep.reviewMatch(match.id, { rating, comment: comment.trim() });
      setDone(true);
      toast.success('Thanks for your review.');
    } catch (err) {
      if (isApiError(err) && err.code === 'CONFLICT') setDone(true);
      else toast.error(err);
    } finally {
      setPending(false);
    }
  };

  if (done) {
    return (
      <Panel title="Review">
        <p className="muted">You've reviewed {counterpartName} for this match. Thank you!</p>
      </Panel>
    );
  }

  return (
    <Panel title={`Review ${counterpartName}`}>
      <form onSubmit={onSubmit} noValidate>
        <fieldset disabled={pending}>
          <div className="field">
            <span className="label">Rating</span>
            <StarInput value={rating} onChange={setRating} />
          </div>
          <Field label="Comment" htmlFor="rv-comment" error={error}>
            <textarea id="rv-comment" rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
          <button type="submit" className="btn" disabled={pending}>
            {pending ? 'Submitting…' : 'Submit review'}
          </button>
        </fieldset>
      </form>
    </Panel>
  );
}
