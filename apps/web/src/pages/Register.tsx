import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { isApiError } from '../api/client';
import { register } from '../api/endpoints';
import { Field } from '../components/Field';
import { useToast } from '../components/Toast';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function RegisterPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const validate = () => {
    const e: Record<string, string> = {};
    if (name.trim().length < 2 || name.trim().length > 80) e.name = 'Please enter your name (2–80 characters).';
    if (!EMAIL_RE.test(email.trim())) e.email = 'Please enter a valid email address.';
    if (password.length < 10) e.password = 'Password must be at least 10 characters.';
    if (confirm !== password) e.confirm = 'Passwords do not match.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const onSubmit = async (ev: FormEvent) => {
    ev.preventDefault();
    setFormError(null);
    if (!validate()) return;
    setPending(true);
    try {
      const res = await register({ name: name.trim(), email: email.trim(), password });
      toast.success('Account created. Check your email to verify your address.');
      navigate('/verify-email', { state: { devToken: res.devVerificationToken, email: res.user.email } });
    } catch (e) {
      if (isApiError(e) && e.code === 'CONFLICT') setErrors({ email: 'An account with this email already exists.' });
      else setFormError(isApiError(e) ? e.message : 'Registration failed.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="page narrow">
      <div className="card auth-card">
        <h1>Create your account</h1>
        <p className="muted">Join CarryLink to send or carry items with verified travellers.</p>
        {formError && <div className="alert alert-error">{formError}</div>}
        <form onSubmit={onSubmit} noValidate>
          <Field label="Full name" htmlFor="name" error={errors.name}>
            <input id="name" autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Email" htmlFor="email" error={errors.email}>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label="Password" htmlFor="password" error={errors.password} hint="At least 10 characters.">
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              minLength={10}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </Field>
          <Field label="Confirm password" htmlFor="confirm" error={errors.confirm}>
            <input
              id="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </Field>
          <button type="submit" className="btn btn-block" disabled={pending}>
            {pending ? 'Creating account…' : 'Create account'}
          </button>
        </form>
        <p className="small muted center">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
