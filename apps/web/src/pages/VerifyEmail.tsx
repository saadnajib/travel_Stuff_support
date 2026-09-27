import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { resendVerification, verifyEmail } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { Field } from '../components/Field';
import { useToast } from '../components/Toast';

interface LocationState {
  devToken?: string;
  email?: string;
}

export function VerifyEmailPage() {
  const location = useLocation();
  const [params] = useSearchParams();
  const state = (location.state ?? {}) as LocationState;
  const { user, refreshUser } = useAuth();
  const toast = useToast();

  const [devToken, setDevToken] = useState<string | undefined>(state.devToken);
  const [token, setToken] = useState(params.get('token') ?? '');
  const [pending, setPending] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const t = params.get('token');
    if (t) setToken(t);
  }, [params]);

  const doVerify = async (value: string) => {
    setError(null);
    if (!value.trim()) {
      setError('Enter the verification token from your email.');
      return;
    }
    setPending(true);
    try {
      await verifyEmail(value.trim());
      setDone(true);
      toast.success('Email verified.');
      if (user) await refreshUser();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  };

  const onSubmit = (ev: FormEvent) => {
    ev.preventDefault();
    void doVerify(token);
  };

  const onResend = async () => {
    setResending(true);
    try {
      const res = await resendVerification();
      if (res.devVerificationToken) setDevToken(res.devVerificationToken);
      toast.success('Verification email sent.');
    } catch (e) {
      toast.error(e);
    } finally {
      setResending(false);
    }
  };

  if (done || user?.emailVerified) {
    return (
      <div className="page narrow">
        <div className="card auth-card">
          <h1>Email verified</h1>
          <p className="muted">Your email address is confirmed.</p>
          {user ? (
            <Link className="btn" to="/dashboard">
              Continue to dashboard
            </Link>
          ) : (
            <Link className="btn" to="/login">
              Sign in
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="page narrow">
      {devToken && (
        <div className="dev-banner" role="note">
          <div>
            <strong>Dev mode:</strong> the API returned a verification token instead of sending an email.
            <code className="token">{devToken}</code>
          </div>
          <button type="button" className="btn btn-sm" disabled={pending} onClick={() => void doVerify(devToken)}>
            Verify now
          </button>
        </div>
      )}
      <div className="card auth-card">
        <h1>Verify your email</h1>
        <p className="muted">
          {state.email ? (
            <>
              We sent a verification link to <strong>{state.email}</strong>.{' '}
            </>
          ) : null}
          Paste the token from the email below.
        </p>
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        <form onSubmit={onSubmit} noValidate>
          <Field label="Verification token" htmlFor="token">
            <input id="token" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="one-time-code" />
          </Field>
          <button type="submit" className="btn btn-block" disabled={pending}>
            {pending ? 'Verifying…' : 'Verify email'}
          </button>
        </form>
        {user ? (
          <p className="small muted center">
            Didn't get it?{' '}
            <button type="button" className="link-btn" onClick={() => void onResend()} disabled={resending}>
              {resending ? 'Sending…' : 'Resend verification email'}
            </button>
          </p>
        ) : (
          <p className="small muted center">
            Already verified? <Link to="/login">Sign in</Link>
          </p>
        )}
      </div>
    </div>
  );
}
