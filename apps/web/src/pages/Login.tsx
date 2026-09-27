import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { isApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { safeNext } from '../auth/guards';
import { Field } from '../components/Field';
import { useToast } from '../components/Toast';

export function LoginPage() {
  const { login, user, loading } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = safeNext(params.get('next'));

  if (!loading && user) return <Navigate to={next} replace />;

  const onSubmit = async (ev: FormEvent) => {
    ev.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setPending(true);
    try {
      const u = await login(email.trim(), password);
      toast.success(`Welcome back, ${u.name.split(' ')[0]}.`);
      navigate(next, { replace: true });
    } catch (e) {
      if (isApiError(e) && (e.code === 'INVALID_CREDENTIALS' || e.status === 401)) {
        setError('Incorrect email or password.');
      } else {
        setError(isApiError(e) ? e.message : 'Sign in failed.');
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="page narrow">
      <div className="card auth-card">
        <h1>Sign in</h1>
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        <form onSubmit={onSubmit} noValidate>
          <Field label="Email" htmlFor="email">
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Password" htmlFor="password">
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          <button type="submit" className="btn btn-block" disabled={pending}>
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="small muted center">
          New to CarryLink? <Link to="/register">Create an account</Link>
        </p>
      </div>
    </div>
  );
}
