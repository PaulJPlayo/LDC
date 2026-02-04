import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import { getList, request } from '../lib/api.js';
import { formatMoney } from '../lib/formatters.js';

const emptyAddress = {
  first_name: '',
  last_name: '',
  company: '',
  address_1: '',
  address_2: '',
  city: '',
  province: '',
  postal_code: '',
  country_code: '',
  phone: ''
};

const getArrayFromPayload = (payload, key) => {
  if (!payload) return [];
  if (key && Array.isArray(payload[key])) return payload[key];
  const candidate = Object.values(payload).find((value) => Array.isArray(value));
  return candidate || [];
};

const getObjectFromPayload = (payload, key) => {
  if (!payload) return null;
  if (key && payload[key]) return payload[key];
  const candidate = Object.values(payload).find((value) => value && typeof value === 'object');
  return candidate || null;
};

const sortByLabel = (items, getLabel) => {
  if (!Array.isArray(items)) return [];
  return [...items].sort((a, b) =>
    String(getLabel(a) || '').localeCompare(String(getLabel(b) || ''), undefined, {
      sensitivity: 'base'
    })
  );
};

const normalizeString = (value) => {
  const trimmed = String(value ?? '').trim();
  return trimmed ? trimmed : null;
};

const parsePriceInput = (value) => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * 100);
};

const normalizeAmountValue = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object' && value?.value !== undefined) {
    const numeric = Number(value.value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const getPriceRuleValue = (price, attribute) => {
  const rules = Array.isArray(price?.price_rules)
    ? price.price_rules
    : Array.isArray(price?.rules)
      ? price.rules
      : [];
  if (!rules.length) return null;
  const rule = rules.find((entry) => entry?.attribute === attribute);
  if (!rule) return null;
  if (rule?.value !== undefined && rule?.value !== null) return String(rule.value);
  if (Array.isArray(rule?.values) && rule.values.length) {
    const candidate = rule.values[0]?.value ?? rule.values[0];
    if (candidate !== undefined && candidate !== null) return String(candidate);
  }
  return null;
};

const buildShippingPriceCandidates = (option) => {
  const candidates = [];
  if (!option) return candidates;
  const prices = Array.isArray(option.prices) ? option.prices : [];
  prices.forEach((price) => {
    const amount = normalizeAmountValue(
      price?.amount ?? price?.price ?? price?.value ?? price?.money_amount?.amount
    );
    if (!Number.isFinite(amount)) return;
    const currencyCode = String(
      price?.currency_code ||
        price?.currency?.code ||
        getPriceRuleValue(price, 'currency_code') ||
        ''
    )
      .trim()
      .toLowerCase();
    const regionId =
      price?.region_id ||
      price?.region?.id ||
      getPriceRuleValue(price, 'region_id') ||
      '';
    candidates.push({
      amount,
      currency_code: currencyCode || null,
      region_id: regionId || null
    });
  });

  const directAmount = normalizeAmountValue(option?.amount);
  if (Number.isFinite(directAmount)) {
    const currencyCode = String(option?.currency_code || '').trim().toLowerCase();
    const regionId = option?.region_id || option?.region?.id || '';
    candidates.push({
      amount: directAmount,
      currency_code: currencyCode || null,
      region_id: regionId || null
    });
  }

  return candidates;
};

const resolveShippingOptionAmount = (option, regionId, currencyCode) => {
  const candidates = buildShippingPriceCandidates(option);
  if (!candidates.length) return null;
  const normalizedCurrency = String(currencyCode || '')
    .trim()
    .toLowerCase();
  if (regionId) {
    const regionMatch = candidates.find((price) => price.region_id === regionId);
    if (regionMatch) return regionMatch.amount;
  }
  if (normalizedCurrency) {
    const currencyMatch = candidates.find(
      (price) => price.currency_code === normalizedCurrency
    );
    if (currencyMatch) return currencyMatch.amount;
  }
  return candidates[0].amount ?? null;
};

const buildAddressPayload = (address) => {
  if (!address) return null;
  const payload = {
    first_name: normalizeString(address.first_name),
    last_name: normalizeString(address.last_name),
    company: normalizeString(address.company),
    address_1: normalizeString(address.address_1),
    address_2: normalizeString(address.address_2),
    city: normalizeString(address.city),
    province: normalizeString(address.province),
    postal_code: normalizeString(address.postal_code),
    country_code: normalizeString(address.country_code)?.toLowerCase() || null,
    phone: normalizeString(address.phone)
  };
  Object.keys(payload).forEach((key) => {
    if (!payload[key]) delete payload[key];
  });
  return Object.keys(payload).length ? payload : null;
};

const getVariantLabel = (variant) => {
  const productTitle = variant?.product?.title || variant?.product_title;
  const variantTitle = variant?.title || variant?.sku || 'Variant';
  if (productTitle) return `${productTitle} · ${variantTitle}`;
  return variantTitle;
};

const DraftOrderCreate = () => {
  const navigate = useNavigate();
  const [regions, setRegions] = useState([]);
  const [salesChannels, setSalesChannels] = useState([]);
  const [shippingOptions, setShippingOptions] = useState([]);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [metaError, setMetaError] = useState('');

  const [form, setForm] = useState({
    email: '',
    customer_id: '',
    region_id: '',
    sales_channel_id: '',
    currency_code: '',
    promo_codes: '',
    notify_customer: true
  });
  const [currencyTouched, setCurrencyTouched] = useState(false);
  const [shippingOptionId, setShippingOptionId] = useState('');
  const [manualShippingOptionId, setManualShippingOptionId] = useState('');
  const [shippingLookup, setShippingLookup] = useState({
    loading: false,
    error: '',
    option: null
  });

  const [items, setItems] = useState([]);
  const [itemError, setItemError] = useState('');

  const [variantQuery, setVariantQuery] = useState('');
  const [variantResults, setVariantResults] = useState([]);
  const [variantLoading, setVariantLoading] = useState(false);
  const [variantError, setVariantError] = useState('');

  const [customItem, setCustomItem] = useState({ title: '', unit_price: '', quantity: 1 });

  const [shippingAddress, setShippingAddress] = useState(emptyAddress);
  const [billingAddress, setBillingAddress] = useState(emptyAddress);
  const [useShippingAsBilling, setUseShippingAsBilling] = useState(true);

  const [saveState, setSaveState] = useState({ saving: false, error: '' });

  useEffect(() => {
    let isActive = true;

    const loadMeta = async () => {
      setLoadingMeta(true);
      setMetaError('');
      try {
        const results = await Promise.allSettled([
          getList('/admin/regions', { limit: 200 }),
          getList('/admin/sales-channels', { limit: 200 }),
          getList('/admin/shipping-options', { limit: 200 })
        ]);
        if (!isActive) return;

        const [regionsResult, channelsResult, optionsResult] = results;
        const regionsPayload = regionsResult.status === 'fulfilled' ? regionsResult.value : null;
        const channelsPayload = channelsResult.status === 'fulfilled' ? channelsResult.value : null;
        const optionsPayload = optionsResult.status === 'fulfilled' ? optionsResult.value : null;

        setRegions(
          sortByLabel(getArrayFromPayload(regionsPayload, 'regions'), (region) => region?.name)
        );
        setSalesChannels(
          sortByLabel(
            getArrayFromPayload(channelsPayload, 'sales_channels'),
            (channel) => channel?.name
          )
        );
        setShippingOptions(
          sortByLabel(
            getArrayFromPayload(optionsPayload, 'shipping_options'),
            (option) => option?.name
          )
        );

        const failedCount = results.filter((result) => result.status === 'rejected').length;
        if (failedCount) {
          setMetaError('Some draft order settings failed to load.');
        }
      } catch (err) {
        if (!isActive) return;
        setMetaError(err?.message || 'Unable to load draft order metadata.');
      } finally {
        if (isActive) setLoadingMeta(false);
      }
    };

    loadMeta();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!useShippingAsBilling) return;
    setBillingAddress(shippingAddress);
  }, [useShippingAsBilling, shippingAddress]);

  useEffect(() => {
    if (!form.region_id || currencyTouched) return;
    const region = regions.find((entry) => entry.id === form.region_id);
    if (region?.currency_code) {
      setForm((prev) => ({ ...prev, currency_code: region.currency_code }));
    }
  }, [form.region_id, regions, currencyTouched]);

  useEffect(() => {
    setShippingLookup((prev) => {
      if (!prev.option) return prev;
      if (prev.option.id === manualShippingOptionId.trim()) return prev;
      return { loading: false, error: '', option: null };
    });
  }, [manualShippingOptionId]);

  useEffect(() => {
    const term = variantQuery.trim();
    if (!term) {
      setVariantResults([]);
      setVariantError('');
      return;
    }
    let isActive = true;
    const timeout = setTimeout(async () => {
      setVariantLoading(true);
      setVariantError('');
      try {
        const payload = await getList('/admin/product-variants', { limit: 20, q: term });
        if (!isActive) return;
        setVariantResults(getArrayFromPayload(payload, 'variants'));
      } catch (err) {
        if (!isActive) return;
        setVariantResults([]);
        setVariantError(err?.message || 'Unable to search variants.');
      } finally {
        if (isActive) setVariantLoading(false);
      }
    }, 300);

    return () => {
      isActive = false;
      clearTimeout(timeout);
    };
  }, [variantQuery]);

  const selectedRegion = useMemo(
    () => regions.find((entry) => entry.id === form.region_id),
    [regions, form.region_id]
  );

  const currencyCode = form.currency_code || selectedRegion?.currency_code || 'usd';

  const itemsTotal = useMemo(() => {
    return items.reduce((total, item) => {
      const unitPrice = parsePriceInput(item.unit_price);
      if (unitPrice === null) return total;
      return total + unitPrice * item.quantity;
    }, 0);
  }, [items]);

  const hasManualPricing = useMemo(
    () => items.some((item) => parsePriceInput(item.unit_price) !== null),
    [items]
  );

  const handleFormChange = (field) => (event) => {
    const value = event.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleToggleChange = (field) => (event) => {
    const value = event.target.checked;
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleCurrencyChange = (event) => {
    setCurrencyTouched(true);
    setForm((prev) => ({ ...prev, currency_code: event.target.value }));
  };

  const handleAddressChange = (setter, field) => (event) => {
    const value = event.target.value;
    setter((prev) => ({ ...prev, [field]: value }));
  };

  const handleAddVariantItem = (variant) => {
    if (!variant?.id) return;
    setItemError('');
    setItems((prev) => {
      const existingIndex = prev.findIndex(
        (entry) => entry.type === 'variant' && entry.variant_id === variant.id
      );
      if (existingIndex >= 0) {
        const next = [...prev];
        next[existingIndex] = {
          ...next[existingIndex],
          quantity: next[existingIndex].quantity + 1
        };
        return next;
      }
      return [
        ...prev,
        {
          id: `variant-${variant.id}`,
          type: 'variant',
          variant_id: variant.id,
          title: variant?.title || variant?.sku || 'Variant',
          sku: variant?.sku || '',
          product_title: variant?.product?.title || variant?.product_title || '',
          thumbnail:
            variant?.thumbnail ||
            variant?.product?.thumbnail ||
            variant?.product?.images?.[0]?.url ||
            '',
          quantity: 1,
          unit_price: ''
        }
      ];
    });
  };

  const handleAddCustomItem = (event) => {
    event.preventDefault();
    const title = customItem.title.trim();
    const quantity = Number(customItem.quantity);
    if (!title) {
      setItemError('Custom item title is required.');
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setItemError('Custom item quantity must be at least 1.');
      return;
    }
    const price = parsePriceInput(customItem.unit_price);
    if (price === null) {
      setItemError('Custom item unit price is required.');
      return;
    }
    setItems((prev) => [
      ...prev,
      {
        id: `custom-${Date.now()}`,
        type: 'custom',
        title,
        quantity,
        unit_price: customItem.unit_price
      }
    ]);
    setCustomItem({ title: '', unit_price: '', quantity: 1 });
    setItemError('');
  };

  const handleItemQuantityChange = (itemId) => (event) => {
    const value = Number(event.target.value);
    setItems((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? { ...item, quantity: Number.isFinite(value) && value > 0 ? value : 1 }
          : item
      )
    );
  };

  const handleItemPriceChange = (itemId) => (event) => {
    const value = event.target.value;
    setItems((prev) => prev.map((item) => (item.id === itemId ? { ...item, unit_price: value } : item)));
  };

  const handleRemoveItem = (itemId) => {
    setItems((prev) => prev.filter((item) => item.id !== itemId));
  };

  const buildItemsPayload = () => {
    return items.map((item) => {
      const quantity = Number(item.quantity) || 1;
      const unitPrice = parsePriceInput(item.unit_price);
      if (item.type === 'custom') {
        return {
          title: item.title,
          quantity,
          unit_price: unitPrice
        };
      }
      const payload = {
        variant_id: item.variant_id,
        quantity
      };
      if (unitPrice !== null) {
        payload.unit_price = unitPrice;
      }
      return payload;
    });
  };

  const handleLookupShippingOption = async () => {
    const id = manualShippingOptionId.trim();
    if (!id) {
      setShippingLookup({ loading: false, error: 'Enter a shipping option ID.', option: null });
      return;
    }
    setShippingLookup({ loading: true, error: '', option: null });
    try {
      let option = null;
      try {
        const payload = await request(`/admin/shipping-options/${id}`);
        option = getObjectFromPayload(payload, 'shipping_option');
      } catch (err) {
        const payload = await getList('/admin/shipping-options', { id });
        option = getArrayFromPayload(payload, 'shipping_options')[0] || null;
      }
      if (!option) {
        throw new Error('Shipping option not found.');
      }
      setShippingLookup({ loading: false, error: '', option });
    } catch (err) {
      setShippingLookup({
        loading: false,
        error: err?.message || 'Unable to lookup shipping option.',
        option: null
      });
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaveState({ saving: true, error: '' });
    setItemError('');

    if (!form.region_id) {
      setSaveState({ saving: false, error: 'Select a region for the draft order.' });
      return;
    }
    if (!form.sales_channel_id) {
      setSaveState({ saving: false, error: 'Select a sales channel for the draft order.' });
      return;
    }
    if (!form.email.trim() && !form.customer_id.trim()) {
      setSaveState({ saving: false, error: 'Provide a customer email or customer ID.' });
      return;
    }
    if (!items.length) {
      setSaveState({ saving: false, error: 'Add at least one line item.' });
      return;
    }

    const missingVariant = items.find((item) => item.type === 'variant' && !item.variant_id);
    if (missingVariant) {
      setSaveState({ saving: false, error: 'Each variant line item needs a variant ID.' });
      return;
    }

    const invalidCustom = items.find(
      (item) => item.type === 'custom' && (!item.title || parsePriceInput(item.unit_price) === null)
    );
    if (invalidCustom) {
      setSaveState({ saving: false, error: 'Custom items need a title and unit price.' });
      return;
    }

    const shippingPayload = buildAddressPayload(shippingAddress);
    const billingPayload = useShippingAsBilling
      ? shippingPayload
      : buildAddressPayload(billingAddress);

    const promoCodes = form.promo_codes
      .split(',')
      .map((code) => code.trim())
      .filter(Boolean);

    const resolvedShippingOptionId = shippingOptionId || manualShippingOptionId.trim();
    const resolvedShippingOption = resolvedShippingOptionId
      ? shippingOptions.find((option) => option.id === resolvedShippingOptionId) ||
        (shippingLookup.option?.id === resolvedShippingOptionId ? shippingLookup.option : null)
      : null;
    if (resolvedShippingOptionId && !resolvedShippingOption) {
      setSaveState({
        saving: false,
        error: 'Shipping option not found. Please reselect or lookup the option.'
      });
      return;
    }

    const resolvedShippingAmount = resolvedShippingOption
      ? resolveShippingOptionAmount(resolvedShippingOption, form.region_id, currencyCode)
      : null;
    if (resolvedShippingOption && resolvedShippingAmount === null) {
      setSaveState({
        saving: false,
        error: 'Shipping option price missing. Check the shipping option pricing.'
      });
      return;
    }

    const payload = {
      email: form.email.trim() || undefined,
      customer_id: form.customer_id.trim() || undefined,
      region_id: form.region_id,
      sales_channel_id: form.sales_channel_id,
      currency_code: form.currency_code.trim() || undefined,
      promo_codes: promoCodes.length ? promoCodes : undefined,
      no_notification_order: !form.notify_customer,
      items: buildItemsPayload(),
      shipping_address: shippingPayload || undefined,
      billing_address: billingPayload || undefined,
      shipping_methods: resolvedShippingOption
        ? [
            {
              shipping_option_id: resolvedShippingOption.id,
              name: resolvedShippingOption.name || 'Shipping',
              amount: resolvedShippingAmount,
              ...(resolvedShippingOption.data &&
              typeof resolvedShippingOption.data === 'object'
                ? { data: resolvedShippingOption.data }
                : {})
            }
          ]
        : undefined
    };

    try {
      const response = await request('/admin/draft-orders', {
        method: 'POST',
        body: payload
      });
      const draftOrder =
        response?.draft_order ||
        response?.draftOrder ||
        Object.values(response || {}).find((value) => value?.id);
      if (draftOrder?.id) {
        navigate(`/draft-orders/${draftOrder.id}`);
        return;
      }
      setSaveState({ saving: false, error: 'Draft order created, but no ID was returned.' });
    } catch (err) {
      setSaveState({
        saving: false,
        error: err?.message || 'Unable to create draft order.'
      });
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Commerce"
        title="Create Draft Order"
        subtitle="Build a draft order with LDC styling and LDC backend data."
        actions={
          <button className="ldc-button-secondary" type="button" onClick={() => navigate('/draft-orders')}>
            Back to Draft Orders
          </button>
        }
      />

      {metaError ? <div className="mb-4 text-sm text-rose-600">{metaError}</div> : null}
      {saveState.error ? <div className="mb-4 text-sm text-rose-600">{saveState.error}</div> : null}

      <form className="space-y-6" onSubmit={handleSubmit}>
        <div className="ldc-card p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="font-heading text-xl text-ldc-ink">Draft Order Basics</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Choose the region, sales channel, and customer info.
              </p>
            </div>
            <button className="ldc-button-primary" type="submit" disabled={saveState.saving}>
              {saveState.saving ? 'Creating...' : 'Create draft order'}
            </button>
          </div>

          {loadingMeta ? <div className="mt-3 text-sm text-ldc-ink/60">Loading settings...</div> : null}

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Region
              <select
                className="ldc-input mt-2"
                value={form.region_id}
                onChange={handleFormChange('region_id')}
              >
                <option value="">Select a region</option>
                {regions.map((region) => (
                  <option key={region.id} value={region.id}>
                    {region.name || region.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Sales channel
              <select
                className="ldc-input mt-2"
                value={form.sales_channel_id}
                onChange={handleFormChange('sales_channel_id')}
              >
                <option value="">Select a channel</option>
                {salesChannels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.name || channel.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Customer email
              <input
                className="ldc-input mt-2"
                value={form.email}
                onChange={handleFormChange('email')}
                placeholder="customer@example.com"
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Customer ID (optional)
              <input
                className="ldc-input mt-2"
                value={form.customer_id}
                onChange={handleFormChange('customer_id')}
                placeholder="cust_..."
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Currency code
              <input
                className="ldc-input mt-2"
                value={form.currency_code}
                onChange={handleCurrencyChange}
                placeholder={selectedRegion?.currency_code?.toUpperCase() || 'USD'}
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Promo codes
              <input
                className="ldc-input mt-2"
                value={form.promo_codes}
                onChange={handleFormChange('promo_codes')}
                placeholder="CODE10, VIP"
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              <input
                type="checkbox"
                className="h-4 w-4 accent-ldc-plum"
                checked={form.notify_customer}
                onChange={handleToggleChange('notify_customer')}
              />
              Notify customer by email
            </label>
          </div>
        </div>

        <div className="ldc-card p-6">
          <h3 className="font-heading text-xl text-ldc-ink">Line Items</h3>
          <p className="mt-2 text-sm text-ldc-ink/70">
            Add product variants or custom items to this draft order.
          </p>
          {itemError ? <div className="mt-3 text-sm text-rose-600">{itemError}</div> : null}

          <div className="mt-4 space-y-4">
            {items.length ? (
              items.map((item) => {
                const label =
                  item.type === 'variant'
                    ? `${item.product_title ? `${item.product_title} · ` : ''}${item.title}`
                    : item.title;
                const lineTotal = parsePriceInput(item.unit_price);
                const lineTotalText =
                  lineTotal === null
                    ? '-'
                    : formatMoney(lineTotal * item.quantity, currencyCode);
                return (
                  <div key={item.id} className="rounded-2xl bg-white/70 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-ldc-ink">
                          {label || 'Line item'}
                        </div>
                        <div className="text-xs text-ldc-ink/60">
                          {item.type === 'variant' ? item.variant_id : 'Custom item'}
                        </div>
                      </div>
                      <button
                        className="ldc-button-secondary"
                        type="button"
                        onClick={() => handleRemoveItem(item.id)}
                      >
                        Remove
                      </button>
                    </div>
                    <div className="mt-3 grid gap-4 md:grid-cols-3">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                        Quantity
                        <input
                          className="ldc-input mt-2"
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={handleItemQuantityChange(item.id)}
                        />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                        Unit price (major units)
                        <input
                          className="ldc-input mt-2"
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.unit_price}
                          onChange={handleItemPriceChange(item.id)}
                          placeholder={item.type === 'variant' ? 'Use variant price' : '0.00'}
                        />
                      </label>
                      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                        Line total
                        <div className="mt-3 text-sm text-ldc-ink">{lineTotalText}</div>
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="text-sm text-ldc-ink/60">No items added yet.</p>
            )}
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl bg-white/70 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                Add variant item
              </div>
              <input
                className="ldc-input mt-3"
                value={variantQuery}
                onChange={(event) => setVariantQuery(event.target.value)}
                placeholder="Search variants by title or SKU..."
              />
              {variantLoading ? (
                <div className="mt-2 text-xs text-ldc-ink/60">Searching variants...</div>
              ) : null}
              {variantError ? <div className="mt-2 text-xs text-rose-600">{variantError}</div> : null}
              {variantResults.length ? (
                <div className="mt-3 space-y-2">
                  {variantResults.map((variant) => (
                    <div
                      key={variant.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/70 bg-white/70 px-3 py-2 text-sm text-ldc-ink/80"
                    >
                      <div>
                        <div className="text-sm font-semibold text-ldc-ink">
                          {getVariantLabel(variant)}
                        </div>
                        <div className="text-xs text-ldc-ink/60">{variant.sku || variant.id}</div>
                      </div>
                      <button
                        className="ldc-button-secondary"
                        type="button"
                        onClick={() => handleAddVariantItem(variant)}
                      >
                        Add
                      </button>
                    </div>
                  ))}
                </div>
              ) : variantQuery.trim() ? (
                <div className="mt-3 text-xs text-ldc-ink/60">No variants found.</div>
              ) : null}
            </div>

            <div className="rounded-2xl bg-white/70 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                Add custom item
              </div>
              <div className="mt-3 grid gap-3">
                <input
                  className="ldc-input"
                  value={customItem.title}
                  onChange={(event) =>
                    setCustomItem((prev) => ({ ...prev, title: event.target.value }))
                  }
                  placeholder="Custom item title"
                />
                <div className="grid gap-3 md:grid-cols-2">
                  <input
                    className="ldc-input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={customItem.unit_price}
                    onChange={(event) =>
                      setCustomItem((prev) => ({ ...prev, unit_price: event.target.value }))
                    }
                    placeholder="Unit price"
                  />
                  <input
                    className="ldc-input"
                    type="number"
                    min="1"
                    value={customItem.quantity}
                    onChange={(event) =>
                      setCustomItem((prev) => ({ ...prev, quantity: event.target.value }))
                    }
                    placeholder="Qty"
                  />
                </div>
                <button className="ldc-button-secondary" type="button" onClick={handleAddCustomItem}>
                  Add custom item
                </button>
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-ldc-ink/70">
            <div>Line item total (manual prices only)</div>
            <div className="text-sm font-semibold text-ldc-ink">
              {hasManualPricing ? formatMoney(itemsTotal, currencyCode) : '-'}
            </div>
          </div>
        </div>

        <div className="ldc-card p-6">
          <h3 className="font-heading text-xl text-ldc-ink">Shipping</h3>
          <p className="mt-2 text-sm text-ldc-ink/70">
            Attach a shipping option if needed.
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Shipping option
              <select
                className="ldc-input mt-2"
                value={shippingOptionId}
                onChange={(event) => setShippingOptionId(event.target.value)}
              >
                <option value="">No shipping option</option>
                {shippingOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name || option.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Manual shipping option ID
              <input
                className="ldc-input mt-2"
                value={manualShippingOptionId}
                onChange={(event) => setManualShippingOptionId(event.target.value)}
                placeholder="ship_opt_..."
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  className="ldc-button-secondary"
                  type="button"
                  onClick={handleLookupShippingOption}
                  disabled={shippingLookup.loading}
                >
                  {shippingLookup.loading ? 'Looking...' : 'Lookup'}
                </button>
                {shippingLookup.option ? (
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={() => {
                      setManualShippingOptionId(shippingLookup.option.id);
                      setShippingOptionId('');
                    }}
                  >
                    Use this option
                  </button>
                ) : null}
              </div>
              {shippingLookup.error ? (
                <div className="mt-2 text-xs text-rose-600">{shippingLookup.error}</div>
              ) : null}
              {shippingLookup.option ? (
                <div className="mt-2 rounded-2xl border border-white/70 bg-white/70 px-3 py-2 text-xs text-ldc-ink/70">
                  <div className="text-sm font-semibold text-ldc-ink">
                    {shippingLookup.option.name || 'Shipping option'}
                  </div>
                  <div>ID: {shippingLookup.option.id}</div>
                  {shippingLookup.option.price_type ? (
                    <div>Price type: {shippingLookup.option.price_type}</div>
                  ) : null}
                  {shippingLookup.option.provider?.id || shippingLookup.option.provider_id ? (
                    <div>
                      Provider:{' '}
                      {shippingLookup.option.provider?.id ||
                        shippingLookup.option.provider_id}
                    </div>
                  ) : null}
                  {shippingLookup.option.service_zone?.name ||
                  shippingLookup.option.service_zone_id ? (
                    <div>
                      Service zone:{' '}
                      {shippingLookup.option.service_zone?.name ||
                        shippingLookup.option.service_zone_id}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </label>
          </div>
        </div>

        <div className="ldc-card p-6">
          <h3 className="font-heading text-xl text-ldc-ink">Shipping Address</h3>
          <p className="mt-2 text-sm text-ldc-ink/70">
            Provide shipping details for delivery and tax calculation.
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <input
              className="ldc-input"
              placeholder="First name"
              value={shippingAddress.first_name}
              onChange={handleAddressChange(setShippingAddress, 'first_name')}
            />
            <input
              className="ldc-input"
              placeholder="Last name"
              value={shippingAddress.last_name}
              onChange={handleAddressChange(setShippingAddress, 'last_name')}
            />
            <input
              className="ldc-input"
              placeholder="Company"
              value={shippingAddress.company}
              onChange={handleAddressChange(setShippingAddress, 'company')}
            />
            <input
              className="ldc-input"
              placeholder="Phone"
              value={shippingAddress.phone}
              onChange={handleAddressChange(setShippingAddress, 'phone')}
            />
            <input
              className="ldc-input"
              placeholder="Address line 1"
              value={shippingAddress.address_1}
              onChange={handleAddressChange(setShippingAddress, 'address_1')}
            />
            <input
              className="ldc-input"
              placeholder="Address line 2"
              value={shippingAddress.address_2}
              onChange={handleAddressChange(setShippingAddress, 'address_2')}
            />
            <input
              className="ldc-input"
              placeholder="City"
              value={shippingAddress.city}
              onChange={handleAddressChange(setShippingAddress, 'city')}
            />
            <input
              className="ldc-input"
              placeholder="State / Province"
              value={shippingAddress.province}
              onChange={handleAddressChange(setShippingAddress, 'province')}
            />
            <input
              className="ldc-input"
              placeholder="Postal code"
              value={shippingAddress.postal_code}
              onChange={handleAddressChange(setShippingAddress, 'postal_code')}
            />
            <input
              className="ldc-input"
              placeholder="Country code (US)"
              value={shippingAddress.country_code}
              onChange={handleAddressChange(setShippingAddress, 'country_code')}
            />
          </div>
        </div>

        <div className="ldc-card p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="font-heading text-xl text-ldc-ink">Billing Address</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Use the shipping address or set a custom billing address.
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              <input
                type="checkbox"
                className="h-4 w-4 accent-ldc-plum"
                checked={useShippingAsBilling}
                onChange={(event) => setUseShippingAsBilling(event.target.checked)}
              />
              Same as shipping
            </label>
          </div>
          {!useShippingAsBilling ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <input
                className="ldc-input"
                placeholder="First name"
                value={billingAddress.first_name}
                onChange={handleAddressChange(setBillingAddress, 'first_name')}
              />
              <input
                className="ldc-input"
                placeholder="Last name"
                value={billingAddress.last_name}
                onChange={handleAddressChange(setBillingAddress, 'last_name')}
              />
              <input
                className="ldc-input"
                placeholder="Company"
                value={billingAddress.company}
                onChange={handleAddressChange(setBillingAddress, 'company')}
              />
              <input
                className="ldc-input"
                placeholder="Phone"
                value={billingAddress.phone}
                onChange={handleAddressChange(setBillingAddress, 'phone')}
              />
              <input
                className="ldc-input"
                placeholder="Address line 1"
                value={billingAddress.address_1}
                onChange={handleAddressChange(setBillingAddress, 'address_1')}
              />
              <input
                className="ldc-input"
                placeholder="Address line 2"
                value={billingAddress.address_2}
                onChange={handleAddressChange(setBillingAddress, 'address_2')}
              />
              <input
                className="ldc-input"
                placeholder="City"
                value={billingAddress.city}
                onChange={handleAddressChange(setBillingAddress, 'city')}
              />
              <input
                className="ldc-input"
                placeholder="State / Province"
                value={billingAddress.province}
                onChange={handleAddressChange(setBillingAddress, 'province')}
              />
              <input
                className="ldc-input"
                placeholder="Postal code"
                value={billingAddress.postal_code}
                onChange={handleAddressChange(setBillingAddress, 'postal_code')}
              />
              <input
                className="ldc-input"
                placeholder="Country code (US)"
                value={billingAddress.country_code}
                onChange={handleAddressChange(setBillingAddress, 'country_code')}
              />
            </div>
          ) : (
            <p className="mt-3 text-sm text-ldc-ink/60">
              Billing address will match the shipping address.
            </p>
          )}
        </div>
      </form>
    </div>
  );
};

export default DraftOrderCreate;
