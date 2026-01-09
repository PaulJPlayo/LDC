import React, { useEffect, useState } from 'react';
import PageHeader from '../components/PageHeader.jsx';
import { getList } from '../lib/api.js';

const Settings = () => {
  const [store, setStore] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const payload = await getList('/admin/stores', { limit: 1 });
        const storeData = payload?.stores?.[0] || null;
        setStore(storeData);
      } catch (error) {
        setStore(null);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  return (
    <div>
      <PageHeader
        eyebrow="Admin"
        title="Settings"
        subtitle="Store configuration and admin preferences."
      />

      <div className="grid gap-6 md:grid-cols-2">
        <div className="ldc-card p-6">
          <h3 className="font-heading text-xl text-ldc-ink">Storefront Profile</h3>
          {loading ? (
            <p className="mt-4 text-sm text-ldc-ink/60">Loading store details...</p>
          ) : store ? (
            <div className="mt-4 space-y-3 text-sm text-ldc-ink/80">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">Name</div>
                <div>{store.name || 'Lovetts LDC'}</div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">Default Currency</div>
                <div>{store.default_currency_code?.toUpperCase() || 'USD'}</div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">Support Email</div>
                <div>{store.support_email || 'lovettsdandc@gmail.com'}</div>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-ldc-ink/60">Store data is unavailable.</p>
          )}
        </div>

        <div className="ldc-card p-6">
          <h3 className="font-heading text-xl text-ldc-ink">Admin Checklist</h3>
          <ul className="mt-4 space-y-3 text-sm text-ldc-ink/70">
            <li>Review payment provider connections.</li>
            <li>Confirm shipping rates and service zones.</li>
            <li>Update catalog pricing and inventory levels.</li>
            <li>Check promotions before launching new drops.</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default Settings;
