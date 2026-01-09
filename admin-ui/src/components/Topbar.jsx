import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../state/auth.jsx';

const Topbar = ({ onMenuToggle }) => {
  const { user, logout } = useAuth();

  const displayName = user?.first_name || user?.last_name
    ? `${user?.first_name || ''} ${user?.last_name || ''}`.trim()
    : user?.email || 'Admin';

  return (
    <header className="px-4 pt-6 md:px-8">
      <div className="ldc-panel flex flex-wrap items-center justify-between gap-4 px-6 py-4">
        <div className="flex items-center gap-4">
          <button
            type="button"
            className="ldc-button-secondary md:hidden"
            onClick={onMenuToggle}
            aria-label="Open navigation"
          >
            Menu
          </button>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ldc-ink/60">
              Lovetts LDC
            </p>
            <h1 className="font-heading text-2xl text-ldc-ink">Admin Studio</h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/settings"
            className="ldc-button-secondary"
          >
            Settings
          </Link>
          <div className="flex items-center gap-3 rounded-full bg-white/70 px-4 py-2 text-sm">
            <div className="text-right">
              <div className="font-semibold text-ldc-ink">{displayName}</div>
              <div className="text-xs uppercase tracking-[0.2em] text-ldc-ink/50">Signed in</div>
            </div>
            <button type="button" className="ldc-button-primary" onClick={logout}>
              Sign Out
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Topbar;
