'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { saveSession } from '@/lib/session';

export default function AuthForm({ mode }) {
  const router = useRouter();
  const isRegister = mode === 'register';
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await api(isRegister ? '/auth/register' : '/auth/login', {
        method: 'POST',
        body: isRegister ? form : { email: form.email, password: form.password },
      });
      saveSession({ token: data.token, user: data.user });
      router.push('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="narrow">
      <h1>{isRegister ? 'Create your account' : 'Log in'}</h1>
      <form onSubmit={submit} className="form">
        {isRegister && (
          <label>
            Name
            <input value={form.name} onChange={set('name')} required minLength={2} autoComplete="name" />
          </label>
        )}
        <label>
          Email
          <input type="email" value={form.email} onChange={set('email')} required autoComplete="email" />
        </label>
        <label>
          Password
          <input type="password" value={form.password} onChange={set('password')} required minLength={isRegister ? 8 : 1} autoComplete={isRegister ? 'new-password' : 'current-password'} />
          {isRegister && <span className="muted small">At least 8 characters, with a letter and a number.</span>}
        </label>
        {error && <div className="alert bad" role="alert">{error}</div>}
        <button className="btn" disabled={busy}>{busy ? 'Please wait...' : isRegister ? 'Create account' : 'Log in'}</button>
      </form>
      <p className="muted">
        {isRegister ? 'Already have an account? ' : 'New to SmartCart? '}
        <Link href={isRegister ? '/login' : '/register'}>{isRegister ? 'Log in' : 'Create an account'}</Link>
      </p>
    </div>
  );
}
