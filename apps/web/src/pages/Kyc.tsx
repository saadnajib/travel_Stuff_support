import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { isApiError } from '../api/client';
import { getKycStatus, submitKyc } from '../api/endpoints';
import type { DocType } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { CountrySelect } from '../components/CountrySelect';
import { Field } from '../components/Field';
import { FileUpload, type UploadedFile } from '../components/FileUpload';
import { KycBadge } from '../components/KycBadge';
import { ErrorState, Loading } from '../components/Loading';
import { useToast } from '../components/Toast';
import { formatDateTime, todayIso } from '../lib/format';
import { useAsync } from '../lib/useAsync';

const DOC_TYPES: { value: DocType; label: string }[] = [
  { value: 'passport', label: 'Passport' },
  { value: 'national_id', label: 'National ID card' },
  { value: 'driving_licence', label: "Driving licence" },
];

function isAdult(dob: string): boolean {
  const d = new Date(`${dob}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  const cutoff = new Date(now.getFullYear() - 18, now.getMonth(), now.getDate());
  return d <= cutoff;
}

export function KycPage() {
  const { refreshUser } = useAuth();
  const toast = useToast();
  const status = useAsync(getKycStatus, []);

  const [docType, setDocType] = useState<DocType>('passport');
  const [docNumber, setDocNumber] = useState('');
  const [fullName, setFullName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [country, setCountry] = useState('');
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!/^[A-Za-z0-9-]{5,30}$/.test(docNumber.trim())) e.docNumber = 'Enter the document number (5–30 letters, digits or dashes).';
    if (fullName.trim().length < 2) e.fullName = 'Enter your full name exactly as on the document.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) e.dateOfBirth = 'Enter your date of birth.';
    else if (!isAdult(dateOfBirth)) e.dateOfBirth = 'You must be at least 18 years old.';
    if (!/^[A-Z]{2}$/.test(country)) e.country = 'Select the issuing country.';
    if (files.length === 0) e.file = 'Upload a photo or scan of your document.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const onSubmit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setPending(true);
    try {
      await submitKyc({
        docType,
        docNumber: docNumber.trim(),
        fullName: fullName.trim(),
        dateOfBirth,
        country,
        fileRef: files[0].ref,
      });
      toast.success('Documents submitted for review.');
      await Promise.all([status.reload(), refreshUser()]);
    } catch (e) {
      if (isApiError(e) && e.code === 'CONFLICT') {
        toast.error('A submission is already pending or you are already verified.');
        await status.reload();
      } else {
        toast.error(e);
      }
    } finally {
      setPending(false);
    }
  };

  const s = status.data;
  const canSubmit = s && (s.kycStatus === 'none' || s.kycStatus === 'rejected');

  return (
    <div className="page narrow">
      <h1>Identity verification</h1>
      <p className="muted">
        CarryLink requires every sender and traveller to verify their identity before posting or matching. Your document
        number is stored encrypted and never shown to other users.
      </p>

      {status.loading && <Loading />}
      {!!status.error && <ErrorState error={status.error} onRetry={status.reload} />}

      {s && (
        <div className="card">
          <div className="row between wrap">
            <h2>Current status</h2>
            <KycBadge status={s.kycStatus} />
          </div>
          <dl className="facts">
            <div>
              <dt>Submitted</dt>
              <dd>{formatDateTime(s.submittedAt)}</dd>
            </div>
            <div>
              <dt>Reviewed</dt>
              <dd>{formatDateTime(s.reviewedAt)}</dd>
            </div>
          </dl>
          {s.kycStatus === 'pending' && (
            <p className="muted">Your documents are being reviewed. We'll update your status as soon as it's done.</p>
          )}
          {s.kycStatus === 'verified' && (
            <p>
              You're verified. <Link to="/dashboard">Back to dashboard</Link>
            </p>
          )}
          {s.kycStatus === 'rejected' && (
            <div className="alert alert-error">
              <span>
                <strong>Rejected:</strong> {s.rejectionReason ?? 'No reason given.'} Please correct and resubmit below.
              </span>
            </div>
          )}
        </div>
      )}

      {canSubmit && (
        <form className="card" onSubmit={onSubmit} noValidate>
          <h2>Submit your document</h2>
          <div className="form-grid">
            <Field label="Document type" htmlFor="docType">
              <select id="docType" value={docType} onChange={(e) => setDocType(e.target.value as DocType)}>
                {DOC_TYPES.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Document number" htmlFor="docNumber" error={errors.docNumber}>
              <input
                id="docNumber"
                value={docNumber}
                onChange={(e) => setDocNumber(e.target.value)}
                autoComplete="off"
                maxLength={30}
              />
            </Field>
            <Field label="Full name (as on document)" htmlFor="fullName" error={errors.fullName}>
              <input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
            </Field>
            <Field label="Date of birth" htmlFor="dob" error={errors.dateOfBirth}>
              <input
                id="dob"
                type="date"
                value={dateOfBirth}
                max={todayIso()}
                onChange={(e) => setDateOfBirth(e.target.value)}
                autoComplete="bday"
              />
            </Field>
            <Field label="Issuing country" htmlFor="country" error={errors.country}>
              <CountrySelect id="country" value={country} onChange={setCountry} required />
            </Field>
          </div>
          <FileUpload
            label="Document photo or scan"
            hint="Image or PDF, max 10 MB. A SHA-256 checksum is computed in your browser."
            value={files}
            onChange={setFiles}
            disabled={pending}
          />
          {errors.file && <p className="field-error">{errors.file}</p>}
          <button type="submit" className="btn" disabled={pending}>
            {pending ? 'Submitting…' : 'Submit for review'}
          </button>
        </form>
      )}
    </div>
  );
}
