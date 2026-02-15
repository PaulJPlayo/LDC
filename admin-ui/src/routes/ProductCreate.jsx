import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import { formatApiError, getList, request } from '../lib/api.js';

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

const STYLE_OPTION_TITLE = 'Style';
const STYLE_OPTION_VALUE = 'Default';
const MAX_HANDLE_ATTEMPTS = 5;

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

const isDuplicateHandleError = (error) => {
  const message = String(error?.message || '').toLowerCase();
  if (error?.status === 409) return true;
  if (!message.includes('handle')) return false;
  return (
    message.includes('already') ||
    message.includes('exists') ||
    message.includes('taken') ||
    message.includes('unique')
  );
};

const buildProductMetadata = (productKey) => ({
  product_key: productKey,
  storefront_sections: [],
  storefront_order: {}
});

const buildProductOptions = () => [
  {
    title: STYLE_OPTION_TITLE,
    values: [STYLE_OPTION_VALUE]
  }
];

const buildDefaultVariantPayload = (basePriceAmount) => ({
  title: STYLE_OPTION_VALUE,
  manage_inventory: false,
  allow_backorder: false,
  options: { [STYLE_OPTION_TITLE]: STYLE_OPTION_VALUE },
  prices: [{ currency_code: 'usd', amount: basePriceAmount }]
});

const getArrayFromPayload = (payload, key) => {
  if (!payload || typeof payload !== 'object') return [];
  if (key && Array.isArray(payload[key])) return payload[key];
  const candidate = Object.values(payload).find((value) => Array.isArray(value));
  return candidate || [];
};

const selectDefaultSalesChannel = (channels) => {
  const list = Array.isArray(channels) ? channels : [];
  const byNameEnabled = list.find(
    (channel) =>
      String(channel?.name || '')
        .trim()
        .toLowerCase() === 'default sales channel' && channel?.is_disabled !== true
  );
  if (byNameEnabled?.id) return byNameEnabled;
  const byNameAny = list.find(
    (channel) =>
      String(channel?.name || '')
        .trim()
        .toLowerCase() === 'default sales channel'
  );
  if (byNameAny?.id) return byNameAny;
  const firstEnabled = list.find((channel) => channel?.id && channel?.is_disabled !== true);
  if (firstEnabled?.id) return firstEnabled;
  return list.find((channel) => channel?.id) || null;
};

const assignProductToSalesChannelBestEffort = async (productId) => {
  if (!productId) return '';
  try {
    const payload = await getList('/admin/sales-channels', { limit: 200 });
    const channels = getArrayFromPayload(payload, 'sales_channels');
    const channel = selectDefaultSalesChannel(channels);
    if (!channel?.id) {
      return 'Product created, but no sales channel was available for assignment.';
    }
    await request(`/admin/sales-channels/${channel.id}/products`, {
      method: 'POST',
      body: { add: [productId] }
    });
    return '';
  } catch (error) {
    console.warn('[ProductCreate] Sales channel assignment failed.', {
      productId,
      status: error?.status || null,
      message: error?.message || 'Unknown error'
    });
    return 'Product created, but assigning it to the default sales channel failed.';
  }
};

const createProductWithInlineVariant = async ({
  title,
  handle,
  status,
  productKey,
  basePriceAmount
}) => {
  const payload = await request('/admin/products', {
    method: 'POST',
    body: {
      title,
      handle,
      status,
      metadata: buildProductMetadata(productKey),
      options: buildProductOptions(),
      variants: [buildDefaultVariantPayload(basePriceAmount)]
    }
  });
  const created = getCreatedProduct(payload);
  const productId = created?.id || '';
  if (!productId) {
    throw new Error('Create response did not include a product ID.');
  }
  return { productId };
};

const createProductWithFollowupVariant = async ({
  title,
  handle,
  status,
  productKey,
  basePriceAmount
}) => {
  const createPayload = await request('/admin/products', {
    method: 'POST',
    body: {
      title,
      handle,
      status,
      metadata: buildProductMetadata(productKey),
      options: buildProductOptions()
    }
  });
  const created = getCreatedProduct(createPayload);
  const productId = created?.id || '';
  if (!productId) {
    throw new Error('Create response did not include a product ID.');
  }
  try {
    await request(`/admin/products/${productId}/variants`, {
      method: 'POST',
      body: buildDefaultVariantPayload(basePriceAmount)
    });
  } catch (error) {
    error.createdProductId = productId;
    throw error;
  }
  return { productId };
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

    let createdProductId = '';

    try {
      const status = form.status === 'published' ? 'published' : 'draft';
      let finalError = null;

      for (let attempt = 0; attempt < MAX_HANDLE_ATTEMPTS; attempt += 1) {
        const suffix = attempt === 0 ? '' : `-${attempt + 1}`;
        const handleCandidate = `${derivedHandle}${suffix}`;
        const productKeyCandidate = `${selectedPrefix}-${handleCandidate}`;

        try {
          const inlineResult = await createProductWithInlineVariant({
            title,
            handle: handleCandidate,
            status,
            productKey: productKeyCandidate,
            basePriceAmount
          });
          createdProductId = inlineResult.productId;
          const warning = await assignProductToSalesChannelBestEffort(createdProductId);
          if (warning) {
            navigate(`/products/${createdProductId}`, { state: { warning } });
          } else {
            navigate(`/products/${createdProductId}`);
          }
          return;
        } catch (inlineError) {
          if (isDuplicateHandleError(inlineError)) {
            finalError = inlineError;
            continue;
          }

          try {
            const fallbackResult = await createProductWithFollowupVariant({
              title,
              handle: handleCandidate,
              status,
              productKey: productKeyCandidate,
              basePriceAmount
            });
            createdProductId = fallbackResult.productId;
            const warning = await assignProductToSalesChannelBestEffort(createdProductId);
            if (warning) {
              navigate(`/products/${createdProductId}`, { state: { warning } });
            } else {
              navigate(`/products/${createdProductId}`);
            }
            return;
          } catch (fallbackError) {
            if (fallbackError?.createdProductId) {
              createdProductId = fallbackError.createdProductId;
            }
            if (isDuplicateHandleError(fallbackError)) {
              finalError = fallbackError;
              continue;
            }
            throw fallbackError;
          }
        }
      }

      if (finalError) {
        throw finalError;
      }
    } catch (error) {
      const baseMessage = formatApiError(error, 'Unable to create product.');
      const handleMessage =
        !createdProductId && isDuplicateHandleError(error)
          ? ` Tried ${MAX_HANDLE_ATTEMPTS} unique handle attempts.`
          : '';
      const errorMessage = createdProductId
        ? `${baseMessage} Product ${createdProductId} was created, but the default variant could not be created.`
        : `${baseMessage}${handleMessage}`;
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
