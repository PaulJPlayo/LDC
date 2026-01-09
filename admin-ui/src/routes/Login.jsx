import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../state/auth.jsx';

const Login = () => {
  const { login, status, error } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  if (status === 'authenticated') {
    return <Navigate to="/dashboard" replace />;
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    setMessage('');
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setMessage(err?.message || 'Unable to sign in.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen px-6 py-12">
      <div className="mx-auto flex max-w-5xl flex-col gap-10">
        <header className="text-center">
          <span className="ldc-badge">Lovetts LDC</span>
          <h1 className="mt-4 font-heading text-4xl text-ldc-ink text-shadow-soft">Admin Studio</h1>
          <p className="mt-3 text-sm text-ldc-ink/70">
            Sign in to manage the storefront, inventory, and customer experience.
          </p>
        </header>

        <div className="ldc-panel mx-auto w-full max-w-2xl p-8">
          <div className="grid gap-6 md:grid-cols-[1.2fr_1fr]">
            <div>
              <h2 className="font-heading text-2xl text-ldc-ink">Welcome back</h2>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Use your admin email and password to access the LDC control room.
              </p>
              <div className="mt-6 space-y-4 text-sm text-ldc-ink/70">
                <div className="ldc-card p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.3em]">Focus</div>
                  <p className="mt-2">Orders, fulfillment, customer care, and merchandising.</p>
                </div>
                <div className="ldc-card p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.3em]">Support</div>
                  <p className="mt-2">Need access? Reach out to LDC support for an invite.</p>
                </div>
              </div>
            </div>

            <form className="space-y-4" onSubmit={handleSubmit}>
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                Email
                <input
                  className="ldc-input mt-2"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                Password
                <input
                  className="ldc-input mt-2"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </label>
              {(message || error) && (
                <div className="text-sm text-rose-600">{message || error}</div>
              )}
              <button
                className="ldc-button-primary w-full"
                type="submit"
                disabled={loading}
              >
                {loading ? 'Signing in...' : 'Enter Admin Studio'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
