import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import { formatApiError, request } from '../lib/api.js';

const PREFIX_OPTIONS = [
  { value: 'tumbler', label: 'Tumbler' },
  { value: 'cup', label: 'Cup' },
  { value: 'accessory', label: 'Accessory' },
  { value: 'other', label: 'Other' }
];

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' }
];

const DEFAULT_FORM = {
  title: '',
  prefix: 'tumbler',
  customPrefix: '',
  handle: '',
  status: 'draft',
  basePriceUsd: '0.00'
};

const slugify = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

const parseUsdToCents = (value) => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return 0;
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.round(numeric * 100);
};

const getCreatedProduct = (payload) => {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.product && typeof payload.product === 'object') return payload.product;
  if (payload.data?.product && typeof payload.data.product === 'object') return payload.data.product;
  if (Array.isArray(payload.products) && payload.products[0]) return payload.products[0];
  return null;
};

const ProductCreate = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState(DEFAULT_FORM);
  const [state, setState] = useState({
    saving: false,
    error: '',
    createdProductId: ''
  });

  const selectedPrefix = useMemo(() => {
    const raw = form.prefix === 'other' ? form.customPrefix : form.prefix;
    return slugify(raw);
  }, [form.prefix, form.customPrefix]);

  const derivedHandle = useMemo(
    () => slugify(form.handle || form.title),
    [form.handle, form.title]
  );

  const derivedProductKey = useMemo(() => {
    if (!selectedPrefix || !derivedHandle) return '';
    return `${selectedPrefix}-${derivedHandle}`;
  }, [selectedPrefix, derivedHandle]);

  const handleFieldChange = (field) => (event) => {
    const value = event.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setState({ saving: true, error: '', createdProductId: '' });

    const title = String(form.title || '').trim();
    if (!title) {
      setState({ saving: false, error: 'Title is required.', createdProductId: '' });
      return;
    }

    if (!selectedPrefix) {
      setState({
        saving: false,
        error: 'Product type prefix is required.',
        createdProductId: ''
      });
      return;
    }

    if (!derivedHandle) {
      setState({
        saving: false,
        error: 'Handle is required. Add a title or handle.',
        createdProductId: ''
      });
      return;
    }

    const basePriceAmount = parseUsdToCents(form.basePriceUsd);
    if (basePriceAmount === null) {
      setState({
        saving: false,
        error: 'Base price must be a valid non-negative number.',
        createdProductId: ''
      });
      return;
    }

    const status = form.status === 'published' ? 'published' : 'draft';
    const productKey = `${selectedPrefix}-${derivedHandle}`;
    const metadata = {
      product_key: productKey,
      storefront_sections: [],
      storefront_order: {}
    };

    let createdProductId = '';

    try {
      const createPayload = await request('/admin/products', {
        method: 'POST',
        body: {
          title,
          handle: derivedHandle,
          status,
          metadata
        }
      });

      const createdProduct = getCreatedProduct(createPayload);
      createdProductId = createdProduct?.id || '';
      if (!createdProductId) {
        throw new Error('Create response did not include a product ID.');
      }

      await request(`/admin/products/${createdProductId}/variants`, {
        method: 'POST',
        body: {
          title: 'Default',
          manage_inventory: false,
          allow_backorder: false,
          prices: [{ currency_code: 'usd', amount: basePriceAmount }]
        }
      });

      navigate(`/products/${createdProductId}`);
    } catch (error) {
      const baseMessage = formatApiError(error, 'Unable to create product.');
      const errorMessage = createdProductId
        ? `${baseMessage} Product ${createdProductId} was created, but the default variant could not be created.`
        : baseMessage;
      setState({ saving: false, error: errorMessage, createdProductId });
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Catalog"
        title="Create Product"
        subtitle="Create a single product with storefront-ready metadata."
        actions={
          <button className="ldc-button-secondary" type="button" onClick={() => navigate('/products')}>
            Back to Products
          </button>
        }
      />

      <div className="ldc-card max-w-3xl p-6">
        <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
          <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
            Title
            <input
              className="ldc-input mt-2"
              value={form.title}
              onChange={handleFieldChange('title')}
              placeholder="Glass Bow Straws"
              required
            />
          </label>

          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
            Product Type Prefix
            <select className="ldc-input mt-2" value={form.prefix} onChange={handleFieldChange('prefix')}>
              {PREFIX_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
            Status
            <select className="ldc-input mt-2" value={form.status} onChange={handleFieldChange('status')}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {form.prefix === 'other' ? (
            <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Custom Prefix
              <input
                className="ldc-input mt-2"
                value={form.customPrefix}
                onChange={handleFieldChange('customPrefix')}
                placeholder="doormat"
                required
              />
            </label>
          ) : null}

          <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
            Handle (optional)
            <input
              className="ldc-input mt-2"
              value={form.handle}
              onChange={handleFieldChange('handle')}
              placeholder="glass-bow-straws"
            />
            <span className="mt-2 block text-[11px] normal-case tracking-normal text-ldc-ink/55">
              If blank, handle is generated from the title.
            </span>
          </label>

          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
            Base Price (USD)
            <input
              className="ldc-input mt-2"
              value={form.basePriceUsd}
              onChange={handleFieldChange('basePriceUsd')}
              inputMode="decimal"
              placeholder="0.00"
            />
            <span className="mt-2 block text-[11px] normal-case tracking-normal text-ldc-ink/55">
              Used for the default variant.
            </span>
          </label>

          <div className="rounded-2xl bg-white/70 p-4 text-sm text-ldc-ink/75">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
              Computed Metadata
            </div>
            <div className="mt-2">Handle: {derivedHandle || '—'}</div>
            <div>product_key: {derivedProductKey || '—'}</div>
            <div>storefront_sections: []</div>
            <div>storefront_order: {'{}'}</div>
          </div>

          {state.error ? (
            <div className="md:col-span-2 text-sm text-rose-600">{state.error}</div>
          ) : null}

          {state.createdProductId ? (
            <div className="md:col-span-2">
              <button
                className="ldc-button-secondary"
                type="button"
                onClick={() => navigate(`/products/${state.createdProductId}`)}
              >
                Open Created Product
              </button>
            </div>
          ) : null}

          <div className="md:col-span-2 flex flex-wrap items-center gap-2">
            <button className="ldc-button-primary" type="submit" disabled={state.saving}>
              {state.saving ? 'Creating...' : 'Create Product'}
            </button>
            <button
              className="ldc-button-secondary"
              type="button"
              disabled={state.saving}
              onClick={() => navigate('/products')}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ProductCreate;
