import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { acceptInvite, formatApiError, registerUser, validateInvite } from '../lib/api.js';

const decodeJwtPayload = (token) => {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const json = atob(padded);
    return JSON.parse(json);
  } catch (error) {
    return null;
  }
};

const InviteAccept = () => {
  const [params] = useSearchParams();
  const token = (params.get('token') || '').trim();
  const invite = useMemo(() => decodeJwtPayload(token), [token]);
  const [inviteStatus, setInviteStatus] = useState({
    checking: Boolean(token),
    valid: null,
    reason: '',
    message: '',
    invite: null
  });
  const inviteEmail = inviteStatus.invite?.email || invite?.email || '';
  const inviteExpiresAt = useMemo(() => {
    if (inviteStatus.invite?.expires_at) {
      const parsed = new Date(inviteStatus.invite.expires_at);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    if (invite?.exp) {
      const parsed = new Date(invite.exp * 1000);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  }, [inviteStatus.invite, invite]);

  const [form, setForm] = useState({
    email: inviteEmail,
    firstName: '',
    lastName: '',
    password: '',
    confirm: ''
  });
  const [state, setState] = useState({
    loading: false,
    error: '',
    success: false
  });

  useEffect(() => {
    if (inviteEmail && !form.email) {
      setForm((prev) => ({ ...prev, email: inviteEmail }));
    }
  }, [inviteEmail, form.email]);

  useEffect(() => {
    let isActive = true;
    if (!token) {
      setInviteStatus({
        checking: false,
        valid: false,
        reason: 'missing',
        message: 'Invite link is missing a token.',
        invite: null
      });
      return () => {
        isActive = false;
      };
    }

    setInviteStatus((prev) => ({
      ...prev,
      checking: true,
      message: '',
      reason: ''
    }));

    validateInvite(token)
      .then((result) => {
        if (!isActive) return;
        const payload = result?.payload || {};
        if (result?.ok && payload?.valid !== false) {
          setInviteStatus({
            checking: false,
            valid: true,
            reason: '',
            message: '',
            invite: payload?.invite || null
          });
          return;
        }
        const status = result?.status;
        const reason =
          payload?.reason ||
          (status === 410 ? 'expired' : status === 409 ? 'accepted' : 'invalid');
        const message =
          payload?.message ||
          (reason === 'expired'
            ? 'This invite has expired. Please request a new one.'
            : reason === 'accepted'
              ? 'This invite was already accepted.'
              : 'This invite link is invalid.');
        setInviteStatus({
          checking: false,
          valid: false,
          reason,
          message,
          invite: payload?.invite || null
        });
      })
      .catch((error) => {
        if (!isActive) return;
        setInviteStatus({
          checking: false,
          valid: false,
          reason: 'invalid',
          message: formatApiError(error, 'Unable to verify invite.'),
          invite: null
        });
      });

    return () => {
      isActive = false;
    };
  }, [token]);

  const handleChange = (field) => (event) => {
    const value = event.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!token) {
      setState({ loading: false, error: 'Invite link is missing or invalid.', success: false });
      return;
    }
    if (inviteStatus.valid === false) {
      setState({
        loading: false,
        error: inviteStatus.message || 'This invite is no longer valid.',
        success: false
      });
      return;
    }
    if (!form.email.trim() || !form.firstName.trim() || !form.lastName.trim()) {
      setState({ loading: false, error: 'Please complete all required fields.', success: false });
      return;
    }
    if (form.password.length < 6) {
      setState({ loading: false, error: 'Password must be at least 6 characters.', success: false });
      return;
    }
    if (form.password !== form.confirm) {
      setState({ loading: false, error: 'Passwords do not match.', success: false });
      return;
    }

    setState({ loading: true, error: '', success: false });
    try {
      const authToken = await registerUser(form.email.trim(), form.password);
      await acceptInvite({
        token,
        authToken,
        email: form.email.trim(),
        first_name: form.firstName.trim(),
        last_name: form.lastName.trim()
      });
      setState({ loading: false, error: '', success: true });
    } catch (error) {
      setState({
        loading: false,
        error: formatApiError(error, 'Unable to accept invite.'),
        success: false
      });
    }
  };

  return (
    <div className="min-h-screen px-6 py-12">
      <div className="mx-auto flex max-w-5xl flex-col gap-10">
        <header className="text-center">
          <span className="ldc-badge">Lovetts LDC</span>
          <h1 className="mt-4 font-heading text-4xl text-ldc-ink text-shadow-soft">
            Accept your invite
          </h1>
          <p className="mt-3 text-sm text-ldc-ink/70">
            Set up your credentials and step into the LDC Admin Studio.
          </p>
        </header>

        <div className="ldc-panel mx-auto w-full max-w-4xl p-8">
          <div className="grid gap-8 md:grid-cols-[1.1fr_1fr]">
            <div className="space-y-4 text-sm text-ldc-ink/70">
              <div className="ldc-card p-5">
                <div className="text-xs font-semibold uppercase tracking-[0.3em] text-ldc-ink/60">
                  Invite details
                </div>
                <div className="mt-3 space-y-2">
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                      Email
                    </span>
                    <div className="text-ldc-ink">{inviteEmail || 'Provided in invite'}</div>
                  </div>
                  {inviteExpiresAt && (
                    <div>
                      <span className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                        Expires
                      </span>
                      <div className="text-ldc-ink">
                        {inviteExpiresAt.toLocaleString()}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="ldc-card p-5">
                <div className="text-xs font-semibold uppercase tracking-[0.3em] text-ldc-ink/60">
                  Next steps
                </div>
                <ul className="mt-3 space-y-2">
                  <li>Create your password.</li>
                  <li>Confirm your profile name.</li>
                  <li>Jump into orders, products, and team tools.</li>
                </ul>
              </div>
            </div>

            <div>
              {state.success ? (
                <div className="ldc-card p-6 text-center">
                  <h2 className="font-heading text-2xl text-ldc-ink">Invite accepted</h2>
                  <p className="mt-2 text-sm text-ldc-ink/70">
                    Your account is ready. Sign in to the Admin Studio.
                  </p>
                  <Link className="ldc-button-primary mt-6 inline-flex w-full" to="/login">
                    Go to login
                  </Link>
                </div>
              ) : (
                <form className="space-y-4" onSubmit={handleSubmit}>
                  {inviteStatus.checking ? (
                    <div className="text-sm text-ldc-ink/60">Checking invite status...</div>
                  ) : null}
                  {!inviteStatus.checking && inviteStatus.message ? (
                    <div className="text-sm text-rose-600">{inviteStatus.message}</div>
                  ) : null}
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Email
                    <input
                      className="ldc-input mt-2"
                      type="email"
                      autoComplete="email"
                      value={form.email}
                      onChange={handleChange('email')}
                      required
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    First name
                    <input
                      className="ldc-input mt-2"
                      type="text"
                      autoComplete="given-name"
                      value={form.firstName}
                      onChange={handleChange('firstName')}
                      required
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Last name
                    <input
                      className="ldc-input mt-2"
                      type="text"
                      autoComplete="family-name"
                      value={form.lastName}
                      onChange={handleChange('lastName')}
                      required
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Password
                    <input
                      className="ldc-input mt-2"
                      type="password"
                      autoComplete="new-password"
                      value={form.password}
                      onChange={handleChange('password')}
                      required
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Confirm password
                    <input
                      className="ldc-input mt-2"
                      type="password"
                      autoComplete="new-password"
                      value={form.confirm}
                      onChange={handleChange('confirm')}
                      required
                    />
                  </label>
                  {state.error && <div className="text-sm text-rose-600">{state.error}</div>}
                  <button
                    className="ldc-button-primary w-full"
                    type="submit"
                    disabled={state.loading || !token || inviteStatus.checking || inviteStatus.valid === false}
                  >
                    {state.loading ? 'Accepting...' : 'Accept invite'}
                  </button>
                  {!token && (
                    <div className="text-xs text-rose-600">
                      This invite link is missing a token. Ask an admin to resend it.
                    </div>
                  )}
                  <Link className="ldc-button-secondary mt-2 inline-flex w-full" to="/login">
                    Back to login
                  </Link>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InviteAccept;
