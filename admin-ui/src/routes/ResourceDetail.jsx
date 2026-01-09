import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { getDetail } from '../lib/api.js';
import { formatDateTime, formatMoney } from '../lib/formatters.js';

const getObjectFromPayload = (payload, key) => {
  if (!payload) return null;
  if (key && payload[key]) return payload[key];
  const candidate = Object.values(payload).find((value) => value && typeof value === 'object');
  return candidate || null;
};

const ResourceDetail = ({ resource }) => {
  const { id } = useParams();
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const payload = await getDetail(resource.endpoint, id);
        setRecord(getObjectFromPayload(payload, resource.detailKey));
      } catch (err) {
        setError(err?.message || 'Unable to load details.');
        setRecord(null);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [resource, id]);

  const primaryTitle = record?.title || record?.name || record?.email || record?.code || record?.id || '';

  const summaryFields = useMemo(() => {
    if (!record) return [];
    const base = [
      { label: 'ID', value: record.id || '-' },
      record.display_id ? { label: 'Display', value: `#${record.display_id}` } : null,
      record.status ? { label: 'Status', value: record.status, badge: true } : null,
      record.payment_status ? { label: 'Payment', value: record.payment_status, badge: true } : null,
      record.fulfillment_status ? { label: 'Fulfillment', value: record.fulfillment_status, badge: true } : null,
      record.total ? { label: 'Total', value: formatMoney(record.total, record.currency_code) } : null,
      record.email ? { label: 'Email', value: record.email } : null,
      record.created_at ? { label: 'Created', value: formatDateTime(record.created_at) } : null,
      record.updated_at ? { label: 'Updated', value: formatDateTime(record.updated_at) } : null
    ];
    return base.filter(Boolean);
  }, [record]);

  return (
    <div>
      <PageHeader
        eyebrow={resource.label}
        title={primaryTitle || `${resource.label} Details`}
        subtitle="Detailed view from Medusa Admin API."
        actions={
          <Link className="ldc-button-secondary" to={resource.path}>
            Back to {resource.label}
          </Link>
        }
      />

      {error ? <div className="mb-4 text-sm text-rose-600">{error}</div> : null}
      {loading ? (
        <div className="ldc-card p-6 text-sm text-ldc-ink/70">Loading details...</div>
      ) : null}

      {!loading && record ? (
        <div className="space-y-6">
          <div className="ldc-card p-6">
            <h3 className="font-heading text-xl text-ldc-ink">Overview</h3>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {summaryFields.map((field) => (
                <div key={field.label} className="rounded-2xl bg-white/70 px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                    {field.label}
                  </div>
                  <div className="mt-2 text-sm text-ldc-ink">
                    {field.badge ? <StatusBadge value={field.value} /> : field.value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="ldc-card p-6">
            <div className="flex items-center justify-between">
              <h3 className="font-heading text-xl text-ldc-ink">Raw Data</h3>
              <button
                className="ldc-button-secondary"
                type="button"
                onClick={() => setShowRaw((prev) => !prev)}
              >
                {showRaw ? 'Hide JSON' : 'View JSON'}
              </button>
            </div>
            {showRaw ? (
              <pre className="mt-4 max-h-[420px] overflow-auto rounded-2xl bg-ldc-midnight px-4 py-3 text-xs text-white">
                {JSON.stringify(record, null, 2)}
              </pre>
            ) : (
              <p className="mt-3 text-sm text-ldc-ink/70">
                Toggle JSON view for full payload details.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default ResourceDetail;
