import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { isApiError } from '../api/client';
import { createRequest } from '../api/endpoints';
import type { AttestationKey, Category } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { canPost, VerificationBanners } from '../components/Banners';
import { CountrySelect } from '../components/CountrySelect';
import { Field } from '../components/Field';
import { ErrorState, Loading } from '../components/Loading';
import { useToast } from '../components/Toast';
import { formatMoney, toMinor, todayIso } from '../lib/format';
import { findProhibited, useCategories, useFees, useProhibited } from '../lib/meta';

interface ItemDraft {
  key: number;
  name: string;
  qty: string;
  value: string; // major units
}

const BASE_ATTESTATIONS: { key: AttestationKey; label: string }[] = [
  { key: 'items_unsealed', label: 'Items will be handed over unsealed so the traveller can inspect them.' },
  { key: 'no_prohibited', label: 'The items contain nothing prohibited, illegal or restricted.' },
  { key: 'truthful_declaration', label: 'The item list, values and description are complete and truthful.' },
  { key: 'accept_inspection', label: 'I accept that the traveller and customs may inspect the items.' },
];
const RX_ATTESTATION = {
  key: 'has_prescription' as AttestationKey,
  label: 'I hold a valid prescription for this medicine and will provide a copy at handover.',
};

const PHONE_RE = /^\+?[0-9 ()-]{7,20}$/;

function extractMatched(details: unknown): string[] {
  if (details && typeof details === 'object' && 'matched' in details) {
    const m = (details as { matched: unknown }).matched;
    if (Array.isArray(m)) return m.map(String);
    if (typeof m === 'string') return [m];
  }
  return [];
}

export function RequestNewPage() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const categories = useCategories();
  const fees = useFees();
  const prohibited = useProhibited();

  const [originCountry, setOriginCountry] = useState('');
  const [originCity, setOriginCity] = useState('');
  const [destCountry, setDestCountry] = useState('');
  const [destCity, setDestCity] = useState('');
  const [category, setCategory] = useState<Category | ''>('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [items, setItems] = useState<ItemDraft[]>([{ key: 1, name: '', qty: '1', value: '' }]);
  const [nextKey, setNextKey] = useState(2);
  const [weightKg, setWeightKg] = useState('');
  const [reward, setReward] = useState('');
  const [neededByDate, setNeededByDate] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [attest, setAttest] = useState<Set<AttestationKey>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverMatched, setServerMatched] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const cat = categories.data?.find((c) => c.key === category);
  const attestations = cat?.requiresPrescription || category === 'medicine_rx'
    ? [...BASE_ATTESTATIONS, RX_ATTESTATION]
    : BASE_ATTESTATIONS;

  const declaredValueMinor = items.reduce((sum, it) => {
    const q = Number(it.qty);
    const v = toMinor(it.value);
    return Number.isFinite(q) && Number.isFinite(v) ? sum + q * v : sum;
  }, 0);
  const rewardMinor = toMinor(reward);
  const platformFee = fees.data && Number.isFinite(rewardMinor) ? Math.round((rewardMinor * fees.data.platformFeePct) / 100) : 0;
  const totalEstimate =
    fees.data && Number.isFinite(rewardMinor) && rewardMinor > 0
      ? rewardMinor + platformFee + fees.data.protectionFeeMinor
      : null;

  const liveProhibited = useMemo(
    () => findProhibited([title, description, ...items.map((i) => i.name)], prohibited.data),
    [title, description, items, prohibited.data],
  );

  const updateItem = (key: number, patch: Partial<ItemDraft>) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  const addItem = () => {
    setItems((prev) => [...prev, { key: nextKey, name: '', qty: '1', value: '' }]);
    setNextKey((k) => k + 1);
  };
  const removeItem = (key: number) => setItems((prev) => prev.filter((it) => it.key !== key));

  const toggleAttest = (k: AttestationKey) =>
    setAttest((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const validate = () => {
    const e: Record<string, string> = {};
    if (!originCountry) e.originCountry = 'Select a country.';
    if (originCity.trim().length < 2) e.originCity = 'Enter a city.';
    if (!destCountry) e.destCountry = 'Select a country.';
    if (destCity.trim().length < 2) e.destCity = 'Enter a city.';
    if (!category) e.category = 'Choose a category.';
    if (title.trim().length < 5) e.title = 'Title must be at least 5 characters.';
    else if (title.length > 120) e.title = 'Title must be at most 120 characters.';
    if (description.trim().length < 10) e.description = 'Describe the items in at least 10 characters.';
    else if (description.length > 2000) e.description = 'Description must be at most 2000 characters.';
    if (items.length === 0) e.items = 'Declare at least one item.';
    items.forEach((it) => {
      const q = Number(it.qty);
      const v = toMinor(it.value);
      if (it.name.trim().length < 2) e[`item-${it.key}`] = 'Item name must be at least 2 characters.';
      else if (!Number.isInteger(q) || q < 1 || q > 50) e[`item-${it.key}`] = 'Quantity must be a whole number from 1 to 50.';
      else if (!Number.isFinite(v) || v < 0 || v > 1_000_000) e[`item-${it.key}`] = 'Enter a value between 0 and 10,000.';
    });
    if (cat && declaredValueMinor > cat.maxValueMinor)
      e.items = `Total declared value ${formatMoney(declaredValueMinor)} exceeds the ${cat.label} cap of ${formatMoney(cat.maxValueMinor)}.`;
    const w = Number(weightKg);
    if (!weightKg || !Number.isFinite(w) || w <= 0) e.weightKg = 'Enter the total weight.';
    else if (cat && w > cat.maxWeightKg) e.weightKg = `Maximum for ${cat.label} is ${cat.maxWeightKg} kg.`;
    if (!Number.isFinite(rewardMinor) || rewardMinor <= 0) e.reward = 'Enter a reward.';
    else if (fees.data && rewardMinor < fees.data.minRewardMinor)
      e.reward = `Minimum reward is ${formatMoney(fees.data.minRewardMinor)}.`;
    else if (fees.data?.maxRewardMinor && rewardMinor > fees.data.maxRewardMinor)
      e.reward = `Maximum reward is ${formatMoney(fees.data.maxRewardMinor)}.`;
    if (!neededByDate) e.neededByDate = 'Pick a date.';
    else if (neededByDate < todayIso()) e.neededByDate = 'Date must be today or later.';
    if (recipientName.trim().length < 2) e.recipientName = "Enter the recipient's name.";
    if (!PHONE_RE.test(recipientPhone.trim())) e.recipientPhone = 'Enter a valid phone number, e.g. +44 7700 900123.';
    const missing = attestations.filter((a) => !attest.has(a.key));
    if (missing.length) e.attestations = 'You must confirm every statement.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const onSubmit = async (ev: FormEvent) => {
    ev.preventDefault();
    setServerMatched([]);
    setFormError(null);
    if (!validate() || !category) return;
    setPending(true);
    try {
      const request = await createRequest({
        originCountry,
        originCity: originCity.trim(),
        destCountry,
        destCity: destCity.trim(),
        category,
        title: title.trim(),
        description: description.trim(),
        items: items.map((it) => ({ name: it.name.trim(), qty: Number(it.qty), valueMinor: toMinor(it.value) })),
        weightKg: Number(weightKg),
        rewardMinor,
        currency: 'USD',
        neededByDate,
        recipientName: recipientName.trim(),
        recipientPhone: recipientPhone.trim(),
        attestations: attestations.map((a) => a.key).filter((k) => attest.has(k)),
      });
      toast.success('Request posted.');
      navigate(`/requests/${request.id}`);
    } catch (e) {
      if (isApiError(e) && e.code === 'PROHIBITED_ITEM') {
        const matched = extractMatched(e.details);
        setServerMatched(matched.length ? matched : ['(unspecified item)']);
        setFormError(e.message);
      } else if (isApiError(e)) {
        setFormError(e.message);
        toast.error(e);
      } else {
        toast.error(e);
      }
    } finally {
      setPending(false);
    }
  };

  const allowedToPost = canPost(user);

  return (
    <div className="page narrow">
      <h1>Send something</h1>
      <p className="muted">Describe what you need carried. Items must be unsealed and inspectable at handover.</p>
      {user && <VerificationBanners user={user} />}

      <form className="card" onSubmit={onSubmit} noValidate>
        <fieldset disabled={pending}>
          {formError && (
            <div className="alert alert-error" role="alert">
              <div>
                <strong>{formError}</strong>
                {serverMatched.length > 0 && (
                  <p>
                    Prohibited terms found:{' '}
                    {serverMatched.map((m) => (
                      <span key={m} className="tag tag-danger">
                        {m}
                      </span>
                    ))}
                  </p>
                )}
              </div>
            </div>
          )}

          <h2 className="form-section">Route</h2>
          <div className="form-grid">
            <Field label="From country" htmlFor="oc" error={errors.originCountry}>
              <CountrySelect id="oc" value={originCountry} onChange={setOriginCountry} />
            </Field>
            <Field label="From city" htmlFor="ocity" error={errors.originCity}>
              <input id="ocity" value={originCity} onChange={(e) => setOriginCity(e.target.value)} maxLength={80} />
            </Field>
            <Field label="To country" htmlFor="dc" error={errors.destCountry}>
              <CountrySelect id="dc" value={destCountry} onChange={setDestCountry} />
            </Field>
            <Field label="To city" htmlFor="dcity" error={errors.destCity}>
              <input id="dcity" value={destCity} onChange={(e) => setDestCity(e.target.value)} maxLength={80} />
            </Field>
          </div>

          <h2 className="form-section">What are you sending?</h2>
          <Field label="Category" htmlFor="cat" error={errors.category}>
            <select id="cat" value={category} onChange={(e) => setCategory(e.target.value as Category | '')}>
              <option value="">Select a category</option>
              {categories.data?.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          {categories.loading && <Loading label="Loading categories…" />}
          {!!categories.error && <ErrorState error={categories.error} onRetry={categories.reload} />}
          {cat && (
            <div className="info-box" aria-live="polite">
              <strong>{cat.label}</strong>
              <p className="muted">{cat.description}</p>
              <div className="tags">
                <span className="tag">Max weight {cat.maxWeightKg} kg</span>
                <span className="tag">Max declared value {formatMoney(cat.maxValueMinor)}</span>
                {cat.requiresInspection && <span className="tag tag-accent">Traveller inspects at handover</span>}
                {cat.requiresPrescription && <span className="tag tag-warn">Valid prescription required</span>}
              </div>
            </div>
          )}

          <Field label="Title" htmlFor="title" error={errors.title}>
            <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          </Field>
          <Field label="Description" htmlFor="desc" error={errors.description}>
            <textarea id="desc" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
          </Field>

          <div className={`field${errors.items ? ' has-error' : ''}`}>
            <span className="label">Declared items</span>
            <div className="items-editor">
              {items.map((it, idx) => (
                <div key={it.key} className="item-row">
                  <div className="field">
                    <label htmlFor={`in-${it.key}`} className={idx > 0 ? 'sr-only' : undefined}>
                      Item name
                    </label>
                    <input id={`in-${it.key}`} value={it.name} onChange={(e) => updateItem(it.key, { name: e.target.value })} maxLength={120} />
                  </div>
                  <div className="field">
                    <label htmlFor={`iq-${it.key}`} className={idx > 0 ? 'sr-only' : undefined}>
                      Qty
                    </label>
                    <input
                      id={`iq-${it.key}`}
                      type="number"
                      min={1}
                      max={50}
                      step={1}
                      inputMode="numeric"
                      value={it.qty}
                      onChange={(e) => updateItem(it.key, { qty: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`iv-${it.key}`} className={idx > 0 ? 'sr-only' : undefined}>
                      Value each (USD)
                    </label>
                    <input
                      id={`iv-${it.key}`}
                      type="number"
                      min={0}
                      step={0.01}
                      inputMode="decimal"
                      value={it.value}
                      onChange={(e) => updateItem(it.key, { value: e.target.value })}
                    />
                  </div>
                  <button
                    type="button"
                    className="icon-btn item-remove"
                    aria-label={`Remove item ${idx + 1}`}
                    onClick={() => removeItem(it.key)}
                    disabled={items.length === 1}
                  >
                    ×
                  </button>
                  {errors[`item-${it.key}`] && <p className="field-error item-error">{errors[`item-${it.key}`]}</p>}
                </div>
              ))}
            </div>
            <div className="row between wrap">
              <button type="button" className="btn btn-sm btn-secondary" onClick={addItem}>
                + Add item
              </button>
              <span className={cat && declaredValueMinor > cat.maxValueMinor ? 'small text-danger' : 'small muted'}>
                Total declared value: <strong>{formatMoney(declaredValueMinor)}</strong>
                {cat && ` (cap ${formatMoney(cat.maxValueMinor)})`}
              </span>
            </div>
            {errors.items && <p className="field-error">{errors.items}</p>}
          </div>

          {liveProhibited.length > 0 && (
            <div className="alert alert-warn" role="status">
              <span>
                Heads up — these terms are on the prohibited list and the request will be rejected:{' '}
                {liveProhibited.map((p) => (
                  <span key={p} className="tag tag-danger">
                    {p}
                  </span>
                ))}
              </span>
            </div>
          )}

          <div className="form-grid">
            <Field
              label="Total weight (kg)"
              htmlFor="w"
              error={errors.weightKg}
              hint={cat ? `Up to ${cat.maxWeightKg} kg for this category.` : undefined}
            >
              <input
                id="w"
                type="number"
                min={0.1}
                max={cat?.maxWeightKg}
                step={0.1}
                inputMode="decimal"
                value={weightKg}
                onChange={(e) => setWeightKg(e.target.value)}
              />
            </Field>
            <Field
              label="Reward for the traveller (USD)"
              htmlFor="rw"
              error={errors.reward}
              hint={fees.data ? `Minimum ${formatMoney(fees.data.minRewardMinor)}.` : undefined}
            >
              <input
                id="rw"
                type="number"
                min={fees.data ? fees.data.minRewardMinor / 100 : 0}
                step={0.01}
                inputMode="decimal"
                value={reward}
                onChange={(e) => setReward(e.target.value)}
              />
            </Field>
            <Field label="Needed by" htmlFor="nb" error={errors.neededByDate}>
              <input id="nb" type="date" min={todayIso()} value={neededByDate} onChange={(e) => setNeededByDate(e.target.value)} />
            </Field>
          </div>
          {totalEstimate !== null && fees.data && (
            <p className="small muted">
              Estimated charge when a traveller accepts: {formatMoney(rewardMinor)} reward +{' '}
              {formatMoney(platformFee)} platform fee ({fees.data.platformFeePct}%) +{' '}
              {formatMoney(fees.data.protectionFeeMinor)} protection = <strong>{formatMoney(totalEstimate)}</strong>, held
              in escrow.
            </p>
          )}

          <h2 className="form-section">Recipient</h2>
          <div className="form-grid">
            <Field label="Recipient name" htmlFor="rn" error={errors.recipientName}>
              <input id="rn" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} maxLength={120} />
            </Field>
            <Field
              label="Recipient phone"
              htmlFor="rp"
              error={errors.recipientPhone}
              hint="Stored encrypted; never shown publicly."
            >
              <input
                id="rp"
                type="tel"
                autoComplete="off"
                value={recipientPhone}
                onChange={(e) => setRecipientPhone(e.target.value)}
              />
            </Field>
          </div>

          <h2 className="form-section">Declarations</h2>
          <div className={`field${errors.attestations ? ' has-error' : ''}`}>
            <div className="attest-list">
              {attestations.map((a) => (
                <label key={a.key} className="attest">
                  <input type="checkbox" checked={attest.has(a.key)} onChange={() => toggleAttest(a.key)} />
                  <span>{a.label}</span>
                </label>
              ))}
            </div>
            {errors.attestations && <p className="field-error">{errors.attestations}</p>}
          </div>

          <button type="submit" className="btn" disabled={pending || !allowedToPost}>
            {pending ? 'Posting…' : 'Post request'}
          </button>
          {!allowedToPost && <p className="hint">Verify your email and identity to post requests.</p>}
        </fieldset>
      </form>
    </div>
  );
}
