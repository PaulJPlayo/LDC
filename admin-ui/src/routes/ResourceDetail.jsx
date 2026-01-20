import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import DataTable from '../components/DataTable.jsx';
import PageHeader from '../components/PageHeader.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { ApiError, formatApiError, getDetail, getList, request, uploadFiles } from '../lib/api.js';
import { formatDateTime, formatMoney } from '../lib/formatters.js';

const getObjectFromPayload = (payload, key) => {
  if (!payload) return null;
  if (key && payload[key]) return payload[key];
  const candidate = Object.values(payload).find((value) => value && typeof value === 'object');
  return candidate || null;
};

const getArrayFromPayload = (payload, key) => {
  if (!payload) return [];
  if (key && Array.isArray(payload[key])) return payload[key];
  const candidate = Object.values(payload).find((value) => Array.isArray(value));
  return candidate || [];
};

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const getInventoryLevelForLocation = (item, locationId) => {
  if (!item || !locationId) return null;
  const levels = Array.isArray(item.location_levels) ? item.location_levels : [];
  return (
    levels.find((level) => {
      const levelLocationId =
        level?.location_id || level?.location?.id || level?.stock_location_id;
      return levelLocationId === locationId;
    }) || null
  );
};

const formatMoneyOrDash = (amount, currency) => {
  const numeric = toNumber(amount);
  if (numeric === null) return '-';
  return formatMoney(numeric, currency);
};

const GEO_ZONE_TYPE_OPTIONS = [
  { value: 'country', label: 'Country' },
  { value: 'province', label: 'Province' },
  { value: 'city', label: 'City' },
  { value: 'zip', label: 'Postal code' }
];

const TEAM_ROLE_OPTIONS = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' }
];

const resolveRoleValue = (record) => {
  const role =
    record?.role ||
    record?.metadata?.role ||
    (Array.isArray(record?.roles) ? record.roles[0] : undefined) ||
    (Array.isArray(record?.metadata?.roles) ? record.metadata.roles[0] : undefined);
  return role ? String(role) : '';
};

const buildGeoZoneDraft = (zone = {}) => ({
  id: zone?.id,
  type: zone?.type || 'country',
  country_code: zone?.country_code || '',
  province_code: zone?.province_code || '',
  city: zone?.city || '',
  postal_expression: zone?.postal_expression
    ? JSON.stringify(zone.postal_expression, null, 2)
    : ''
});

const buildServiceZoneDraft = (zone = {}) => ({
  name: zone?.name || '',
  geo_zones: Array.isArray(zone?.geo_zones) ? zone.geo_zones.map(buildGeoZoneDraft) : []
});

const formatGeoZoneSummary = (zone) => {
  if (!zone) return 'Unknown zone';
  const type = zone.type || 'country';
  const country = zone.country_code ? zone.country_code.toUpperCase() : '-';
  if (type === 'country') return `Country: ${country}`;
  if (type === 'province') {
    const province = zone.province_code ? zone.province_code.toUpperCase() : '-';
    return `Province: ${country}-${province}`;
  }
  if (type === 'city') {
    const province = zone.province_code ? zone.province_code.toUpperCase() : '-';
    return `City: ${zone.city || '-'} (${country}-${province})`;
  }
  if (type === 'zip') {
    const province = zone.province_code ? zone.province_code.toUpperCase() : '-';
    const postal = zone.postal_expression ? JSON.stringify(zone.postal_expression) : '-';
    return `Postal: ${zone.city || '-'} (${country}-${province}) ${postal}`;
  }
  return `${type}: ${country}`;
};

const extractServiceZones = (payload) => {
  const zones = [];
  const seen = new Set();
  const addZone = (zone, set, location = null) => {
    if (!zone?.id || seen.has(zone.id)) return;
    seen.add(zone.id);
    const zoneLabel = zone?.name || zone.id;
    const setLabel = set?.name || set?.id || 'Fulfillment set';
    const label = location
      ? `${location?.name || location?.id || 'Location'} / ${setLabel} - ${zoneLabel}`
      : `${setLabel} - ${zoneLabel}`;
    zones.push({ id: zone.id, name: label });
  };

  const sets = getArrayFromPayload(payload, 'fulfillment_sets');
  if (sets.length) {
    sets.forEach((set) => {
      const serviceZones = Array.isArray(set?.service_zones) ? set.service_zones : [];
      serviceZones.forEach((zone) => addZone(zone, set));
    });
    return zones;
  }

  const locations = getArrayFromPayload(payload, 'stock_locations');
  locations.forEach((location) => {
    const fulfillmentSets = Array.isArray(location?.fulfillment_sets)
      ? location.fulfillment_sets
      : [];
    fulfillmentSets.forEach((set) => {
      const serviceZones = Array.isArray(set?.service_zones) ? set.service_zones : [];
      serviceZones.forEach((zone) => addZone(zone, set, location));
    });
  });
  return zones;
};

const OPS_META_LABELS = {
  paymentProviders: 'Payment providers',
  fulfillmentProviders: 'Fulfillment providers',
  shippingProfiles: 'Shipping profiles',
  regions: 'Regions',
  serviceZones: 'Service zones',
  taxProviders: 'Tax providers',
  taxRegions: 'Tax regions'
};

const buildAddressLines = (address) => {
  if (!address) return [];
  const lines = [];
  const name = [address.first_name, address.last_name].filter(Boolean).join(' ');
  if (name) lines.push(name);
  if (address.company) lines.push(address.company);
  if (address.address_1) lines.push(address.address_1);
  if (address.address_2) lines.push(address.address_2);
  const cityParts = [address.city, address.province].filter(Boolean).join(', ');
  const postal = address.postal_code ? ` ${address.postal_code}` : '';
  if (cityParts || address.postal_code) {
    lines.push(`${cityParts}${postal}`.trim());
  }
  if (address.country_code) lines.push(address.country_code.toUpperCase());
  if (address.phone) lines.push(address.phone);
  return lines;
};

const buildAddressDraft = (address = {}) => ({
  first_name: address?.first_name || '',
  last_name: address?.last_name || '',
  company: address?.company || '',
  phone: address?.phone || '',
  address_1: address?.address_1 || '',
  address_2: address?.address_2 || '',
  city: address?.city || '',
  province: address?.province || '',
  postal_code: address?.postal_code || '',
  country_code: address?.country_code || ''
});

const buildAddressPayload = (draft) => {
  if (!draft) return null;
  const payload = {
    first_name: String(draft.first_name || '').trim() || null,
    last_name: String(draft.last_name || '').trim() || null,
    company: String(draft.company || '').trim() || null,
    phone: String(draft.phone || '').trim() || null,
    address_1: String(draft.address_1 || '').trim() || null,
    address_2: String(draft.address_2 || '').trim() || null,
    city: String(draft.city || '').trim() || null,
    province: String(draft.province || '').trim() || null,
    postal_code: String(draft.postal_code || '').trim() || null,
    country_code: String(draft.country_code || '').trim()
      ? String(draft.country_code).trim().toLowerCase()
      : null
  };
  const hasValue = Object.values(payload).some((value) => value);
  return hasValue ? payload : null;
};

const getLineItemTitle = (item) => {
  if (!item) return 'Item';
  const baseTitle =
    item.title ||
    item.product_title ||
    item.variant?.product?.title ||
    item.variant?.title ||
    'Item';
  const variantTitle = item.variant?.title || item.variant_title;
  if (variantTitle && variantTitle !== baseTitle) {
    return `${baseTitle} · ${variantTitle}`;
  }
  return baseTitle;
};

const getLineItemThumbnail = (item) => {
  return (
    item?.thumbnail ||
    item?.variant?.product?.thumbnail ||
    item?.variant?.product?.images?.[0]?.url ||
    item?.variant?.product?.images?.[0] ||
    ''
  );
};

const extractPromotionCodes = (promotions) => {
  if (!Array.isArray(promotions)) return [];
  const codes = promotions
    .map((promo) => promo?.code || promo?.promotion?.code || promo?.promotion_code || promo?.id)
    .filter(Boolean)
    .map((code) => String(code).trim())
    .filter(Boolean);
  return Array.from(new Set(codes));
};

const getReturnItemLine = (entry) =>
  entry?.item || entry?.line_item || entry?.detail || entry?.order_item || entry?.item_detail || entry;

const getReturnItemSku = (entry) => {
  const line = getReturnItemLine(entry);
  return (
    line?.variant_sku ||
    line?.variant?.sku ||
    line?.sku ||
    entry?.sku ||
    entry?.item_id ||
    '-'
  );
};

const getReturnItemQuantity = (entry) => {
  const line = getReturnItemLine(entry);
  const quantity =
    entry?.quantity ??
    entry?.return_quantity ??
    entry?.requested_quantity ??
    entry?.detail?.quantity ??
    line?.quantity;
  return toNumber(quantity) ?? 0;
};

const getReturnItemReceivedQuantity = (entry) => {
  const received =
    entry?.received_quantity ??
    entry?.received_return_quantity ??
    entry?.received_items_quantity ??
    entry?.detail?.received_quantity;
  return toNumber(received);
};

const getReturnItemReason = (entry) => {
  const reason = entry?.reason || entry?.reason_detail || entry?.reason_id || entry?.reason_code;
  if (!reason) return '-';
  if (typeof reason === 'string') return reason;
  return reason?.label || reason?.value || reason?.code || reason?.id || '-';
};

const getReturnItemNote = (entry) =>
  entry?.note || entry?.reason_note || entry?.description || entry?.detail?.note || '-';

const resolveExchangeReturnId = (exchangeId, exchanges = []) => {
  const match = (exchanges || []).find((exchange) => exchange?.id === exchangeId);
  return match?.return_id || match?.return?.id || null;
};

const getLineItemQuantity = (item) => {
  const quantity =
    item?.quantity ??
    item?.detail?.quantity ??
    item?.item?.quantity ??
    item?.fulfilled_quantity ??
    item?.shipped_quantity ??
    item?.delivered_quantity;
  return toNumber(quantity) ?? 0;
};

const getLineItemUnitPrice = (item) => {
  const unitPrice = item?.unit_price ?? item?.detail?.unit_price ?? item?.price ?? item?.item?.unit_price;
  return toNumber(unitPrice);
};

const getLineItemTotal = (item) => {
  const total =
    item?.total ??
    item?.subtotal ??
    item?.item_total ??
    item?.detail?.total ??
    item?.detail?.subtotal;
  const numericTotal = toNumber(total);
  if (numericTotal !== null) return numericTotal;
  const unitPrice = getLineItemUnitPrice(item);
  const quantity = getLineItemQuantity(item);
  if (unitPrice === null) return null;
  return unitPrice * quantity;
};

const getFulfillmentStatus = (fulfillment) => {
  if (!fulfillment) return 'pending';
  if (fulfillment.canceled_at) return 'canceled';
  if (fulfillment.delivered_at) return 'delivered';
  if (fulfillment.shipped_at) return 'shipped';
  if (fulfillment.packed_at) return 'packed';
  return 'pending';
};

const getExchangeShippingMethod = (preview, exchangeId, type = 'outbound', exchangeReturnId = null) => {
  if (!preview || !exchangeId) return null;
  const methods = Array.isArray(preview.shipping_methods) ? preview.shipping_methods : [];
  const isInbound = type === 'inbound';
  return (
    methods.find((method) => {
      const actions = Array.isArray(method?.actions) ? method.actions : [];
      return actions.some((action) => {
        if (!action || action.action !== 'SHIPPING_ADD') return false;
        const matchesExchange = action.exchange_id ? action.exchange_id === exchangeId : true;
        if (!matchesExchange) return false;
        if (isInbound && exchangeReturnId) {
          return action.return_id === exchangeReturnId;
        }
        return isInbound ? Boolean(action.return_id) : !action.return_id;
      });
    }) || null
  );
};

const getExchangeShippingActionId = (
  method,
  exchangeId,
  type = 'outbound',
  exchangeReturnId = null
) => {
  const actions = Array.isArray(method?.actions) ? method.actions : [];
  const isInbound = type === 'inbound';
  const match = actions.find((action) => {
    if (!action || action.action !== 'SHIPPING_ADD') return false;
    const matchesExchange = action.exchange_id ? action.exchange_id === exchangeId : true;
    if (!matchesExchange) return false;
    if (isInbound && exchangeReturnId) {
      return action.return_id === exchangeReturnId;
    }
    return isInbound ? Boolean(action.return_id) : !action.return_id;
  });
  return match?.id || null;
};

const getShippingMetaValue = (method, key) => {
  if (!method || !key) return '';
  const metadata =
    method?.metadata && typeof method.metadata === 'object' ? method.metadata : null;
  const data = method?.data && typeof method.data === 'object' ? method.data : null;
  const value = metadata?.[key] ?? data?.[key];
  return value === undefined || value === null ? '' : String(value);
};

const buildShippingMetadata = (existing, updates) => {
  const base =
    existing && typeof existing === 'object' && !Array.isArray(existing) ? { ...existing } : {};
  Object.entries(updates || {}).forEach(([key, value]) => {
    const trimmed = typeof value === 'string' ? value.trim() : value;
    if (trimmed === '' || trimmed === undefined || trimmed === null) {
      delete base[key];
    } else {
      base[key] = trimmed;
    }
  });
  return base;
};

const normalizeUrl = (value) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('/') && typeof window !== 'undefined') {
    return `${window.location.origin}${trimmed}`;
  }
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
};

const renderExternalLink = (value) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  const href = normalizeUrl(trimmed);
  return (
    <a
      className="text-ldc-plum underline"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {trimmed}
    </a>
  );
};

const getTrackingFieldValue = (entry, keys) => {
  if (!entry || !keys?.length) return '';
  for (const key of keys) {
    const value = entry?.[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return '';
};

const buildTrackingEntry = (entry) => {
  if (!entry) return null;
  const trackingNumber = getTrackingFieldValue(entry, [
    'tracking_number',
    'trackingNumber',
    'tracking_code',
    'trackingCode'
  ]);
  const trackingUrl = getTrackingFieldValue(entry, ['tracking_url', 'trackingUrl', 'url']);
  const labelUrl = getTrackingFieldValue(entry, ['label_url', 'labelUrl', 'label']);

  if (!trackingNumber && !trackingUrl && !labelUrl) return null;
  return {
    trackingNumber,
    trackingUrl,
    labelUrl
  };
};

const getFulfillmentTrackingEntries = (fulfillment) => {
  if (!fulfillment) return [];
  const entries = [];
  const seen = new Set();

  const pushEntry = (entry) => {
    const info = buildTrackingEntry(entry);
    if (!info) return;
    const key = `${info.trackingNumber}|${info.trackingUrl}|${info.labelUrl}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push(info);
  };

  const pushArray = (items) => {
    if (!Array.isArray(items)) return;
    items.forEach((item) => pushEntry(item));
  };

  const shipments = Array.isArray(fulfillment.shipments) ? fulfillment.shipments : [];
  shipments.forEach((shipment) => {
    pushEntry(shipment);
    pushArray(shipment?.labels);
    pushArray(shipment?.tracking_links);
  });

  pushEntry(fulfillment);
  pushArray(fulfillment?.labels);
  pushArray(fulfillment?.tracking_links);

  return entries;
};

const getPaymentProviderLabel = (collection) => {
  const providers = (collection?.payment_providers || [])
    .map((provider) => provider?.id || provider?.code || provider?.name)
    .filter(Boolean);
  if (providers.length) return providers.join(', ');
  const sessionProviders = (collection?.payment_sessions || [])
    .map((session) => session?.provider_id)
    .filter(Boolean);
  if (sessionProviders.length) return sessionProviders.join(', ');
  const paymentProviders = (collection?.payments || [])
    .map((payment) => payment?.provider_id)
    .filter(Boolean);
  if (paymentProviders.length) return paymentProviders.join(', ');
  return '-';
};

const PRODUCT_STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'proposed', label: 'Proposed' },
  { value: 'published', label: 'Published' },
  { value: 'rejected', label: 'Rejected' }
];

const sortByLabel = (items, getLabel) => {
  if (!Array.isArray(items)) return [];
  return [...items].sort((a, b) =>
    String(getLabel(a) || '').localeCompare(String(getLabel(b) || ''), undefined, { sensitivity: 'base' })
  );
};

const parseCsvInput = (value) =>
  String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

const buildOptionDrafts = (record) => {
  if (!record?.options) return [];
  return record.options.map((option) => {
    const values = (option?.values || [])
      .map((value) => (typeof value === 'string' ? value : value?.value))
      .filter(Boolean);
    return {
      id: option.id,
      title: option?.title || '',
      values: values.join(', ')
    };
  });
};

const formatPriceInput = (amount) => {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return '';
  return String(numeric / 100);
};

const parsePriceInput = (value) => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * 100);
};

const parseQuantityInput = (value) => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.floor(numeric));
};

const formatDateTimeInput = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 16);
};

const parseDateTimeInput = (value) => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

const parseNullableNumberInput = (value) => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return { value: null, error: '' };
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) {
    return { value: null, error: 'Value must be a number.' };
  }
  return { value: numeric, error: '' };
};

const parseJsonInput = (value) => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return { data: null, error: '' };
  try {
    return { data: JSON.parse(trimmed), error: '' };
  } catch (err) {
    return { data: null, error: err?.message || 'Invalid JSON.' };
  }
};

const formatJsonValue = (value) => {
  if (!value || typeof value !== 'object') return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch (err) {
    return '';
  }
};

const getDefaultCurrency = (record) => {
  if (!record) return 'usd';
  const directPrice = Array.isArray(record.prices) && record.prices.length ? record.prices[0] : null;
  if (directPrice?.currency_code) return directPrice.currency_code;
  const variantPrice = Array.isArray(record.variants)
    ? record.variants.find((variant) => Array.isArray(variant.prices) && variant.prices.length)?.prices?.[0]
    : null;
  if (variantPrice?.currency_code) return variantPrice.currency_code;
  const productVariantPrice = Array.isArray(record.product?.variants)
    ? record.product.variants.find((variant) => Array.isArray(variant.prices) && variant.prices.length)?.prices?.[0]
    : null;
  return productVariantPrice?.currency_code || 'usd';
};

const buildVariantOptionMap = (variant, productOptions = []) => {
  const map = {};
  if (Array.isArray(productOptions)) {
    productOptions.forEach((option) => {
      if (option?.id) map[option.id] = '';
    });
  }
  const applyValue = (key, value) => {
    if (!key) return;
    map[key] = value ?? '';
  };
  const fromList = (list) => {
    list.forEach((entry) => {
      if (!entry) return;
      const optionId = entry.option_id || entry.option?.id || entry.id;
      const value = entry.value ?? entry.option_value ?? entry.name;
      if (optionId) applyValue(optionId, value);
    });
  };
  if (Array.isArray(variant?.options)) {
    fromList(variant.options);
  } else if (Array.isArray(variant?.option_values)) {
    fromList(variant.option_values);
  } else if (variant?.options && typeof variant.options === 'object') {
    Object.entries(variant.options).forEach(([key, value]) => {
      applyValue(key, value);
    });
  }
  return map;
};

const buildVariantDrafts = (record) => {
  if (!record?.variants) return [];
  const productOptions = record?.options || [];
  const fallbackCurrency = getDefaultCurrency(record);
  return record.variants.map((variant) => ({
    id: variant.id,
    title: variant.title || '',
    sku: variant.sku || '',
    ean: variant.ean || '',
    upc: variant.upc || '',
    barcode: variant.barcode || '',
    hs_code: variant.hs_code || '',
    mid_code: variant.mid_code || '',
    origin_country: variant.origin_country || '',
    material: variant.material || '',
    weight: toNumber(variant.weight) == null ? '' : String(toNumber(variant.weight)),
    length: toNumber(variant.length) == null ? '' : String(toNumber(variant.length)),
    height: toNumber(variant.height) == null ? '' : String(toNumber(variant.height)),
    width: toNumber(variant.width) == null ? '' : String(toNumber(variant.width)),
    metadata: formatJsonValue(variant.metadata),
    thumbnail: variant.thumbnail || '',
    manage_inventory: variant.manage_inventory !== false,
    allow_backorder: Boolean(variant.allow_backorder),
    options: buildVariantOptionMap(variant, productOptions),
    prices: (variant.prices && variant.prices.length
      ? variant.prices
      : [{ currency_code: fallbackCurrency, amount: null }]
    ).map((price) => ({
      id: price.id,
      currency_code: price.currency_code || fallbackCurrency || '',
      amount: price.amount == null ? '' : formatPriceInput(price.amount)
    }))
  }));
};

const buildNewVariantDraft = (record, defaultCurrency) => {
  const productOptions = record?.options || [];
  const options = {};
  productOptions.forEach((option) => {
    if (option?.id) options[option.id] = '';
  });
  return {
    title: '',
    sku: '',
    ean: '',
    upc: '',
    barcode: '',
    hs_code: '',
    mid_code: '',
    origin_country: '',
    material: '',
    weight: '',
    length: '',
    height: '',
    width: '',
    metadata: '',
    thumbnail: '',
    manage_inventory: true,
    allow_backorder: false,
    options,
    prices: [{ currency_code: defaultCurrency || 'usd', amount: '' }]
  };
};

const buildVariantOptionsPayload = (optionsMap, productOptions, requireAll) => {
  const payload = {};
  const missing = [];
  if (Array.isArray(productOptions) && productOptions.length) {
    productOptions.forEach((option) => {
      const key = option.id;
      const value = String(optionsMap?.[key] || '').trim();
      if (value) {
        payload[key] = value;
      } else if (requireAll) {
        missing.push(option.title || option.id);
      }
    });
    return { payload, missing };
  }
  if (optionsMap && typeof optionsMap === 'object') {
    Object.entries(optionsMap).forEach(([key, value]) => {
      const normalized = String(value || '').trim();
      if (normalized) payload[key] = normalized;
    });
  }
  return { payload, missing };
};

const mapRecordToDraft = (record) => ({
  title: record?.title || '',
  subtitle: record?.subtitle ?? '',
  handle: record?.handle ?? '',
  status: record?.status || 'draft',
  description: record?.description ?? '',
  thumbnail: record?.thumbnail || '',
  external_id: record?.external_id ?? '',
  is_giftcard: Boolean(record?.is_giftcard),
  discountable: record?.discountable !== false,
  collection_id: record?.collection_id || record?.collection?.id || '',
  type_id: record?.type_id || record?.type?.id || '',
  shipping_profile_id: record?.shipping_profile_id || record?.shipping_profile?.id || '',
  weight: toNumber(record?.weight) == null ? '' : String(toNumber(record?.weight)),
  length: toNumber(record?.length) == null ? '' : String(toNumber(record?.length)),
  height: toNumber(record?.height) == null ? '' : String(toNumber(record?.height)),
  width: toNumber(record?.width) == null ? '' : String(toNumber(record?.width)),
  hs_code: record?.hs_code ?? '',
  mid_code: record?.mid_code ?? '',
  origin_country: record?.origin_country ?? '',
  material: record?.material ?? '',
  metadata: formatJsonValue(record?.metadata),
  sales_channel_ids: (record?.sales_channels || []).map((channel) => channel.id),
  tag_ids: (record?.tags || []).map((tag) => tag.id),
  category_ids: (record?.categories || []).map((category) => category.id)
});

const mapInventoryItemToDraft = (record) => ({
  title: record?.title || '',
  sku: record?.sku || '',
  description: record?.description || '',
  material: record?.material || '',
  hs_code: record?.hs_code || '',
  origin_country: record?.origin_country || '',
  mid_code: record?.mid_code || '',
  weight: toNumber(record?.weight) == null ? '' : String(toNumber(record?.weight)),
  length: toNumber(record?.length) == null ? '' : String(toNumber(record?.length)),
  height: toNumber(record?.height) == null ? '' : String(toNumber(record?.height)),
  width: toNumber(record?.width) == null ? '' : String(toNumber(record?.width)),
  requires_shipping: record?.requires_shipping !== false,
  thumbnail: record?.thumbnail || '',
  metadata: formatJsonValue(record?.metadata)
});

const mapStoreCurrencies = (currencies) => {
  if (!Array.isArray(currencies)) return [];
  return currencies
    .map((entry) => ({
      currency_code: entry?.currency_code || entry?.currency?.code || '',
      is_default: Boolean(entry?.is_default),
      is_tax_inclusive: Boolean(entry?.is_tax_inclusive)
    }))
    .filter((entry) => entry.currency_code);
};

const mapStoreLocales = (locales) => {
  if (!Array.isArray(locales)) return [];
  return locales
    .map((entry) => ({
      locale_code: entry?.locale_code || entry?.locale?.code || entry?.code || ''
    }))
    .filter((entry) => entry.locale_code);
};

const formatBooleanLabel = (value, truthyLabel, falsyLabel) =>
  value ? truthyLabel : falsyLabel;

const normalizeStatus = (value) => String(value || '').toLowerCase();

const formatRuleSet = (rules) => {
  if (!rules || typeof rules !== 'object') return '-';
  const entries = Object.entries(rules).filter(([, value]) => value !== undefined && value !== null);
  if (!entries.length) return '-';
  return entries.map(([key, value]) => `${key}: ${value}`).join(', ');
};

const getRuleBoolean = (rules, attribute, fallback = false) => {
  if (Array.isArray(rules)) {
    const match = rules.find((rule) => rule?.attribute === attribute || rule?.field === attribute);
    if (!match) return fallback;
    const raw = match.value ?? match?.values;
    if (raw === undefined || raw === null) return fallback;
    const normalized = String(raw).toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    return Boolean(raw);
  }
  if (rules && typeof rules === 'object') {
    const raw = rules[attribute];
    if (raw === undefined || raw === null) return fallback;
    const normalized = String(raw).toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    return Boolean(raw);
  }
  return fallback;
};

const extractIdList = (items) => {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => item?.id || item?.provider_id || item?.payment_provider_id || item?.code || item)
    .filter(Boolean);
};

const extractCountryCodes = (items) => {
  if (!Array.isArray(items)) return [];
  return items
    .map((country) => country?.iso_2 || country?.iso2 || country?.country_code || country?.id || country)
    .filter(Boolean);
};

const extractRuleValues = (rules, attribute) => {
  if (Array.isArray(rules)) {
    const match = rules.find((rule) => rule?.attribute === attribute || rule?.field === attribute);
    if (!match) return [];
    const value = match.value ?? match.values;
    if (Array.isArray(value)) return value.map((entry) => String(entry));
    if (value === undefined || value === null || value === '') return [];
    return [String(value)];
  }
  if (rules && typeof rules === 'object') {
    const value = rules[attribute];
    if (Array.isArray(value)) return value.map((entry) => String(entry));
    if (value === undefined || value === null || value === '') return [];
    return [String(value)];
  }
  return [];
};

const buildPriceListRules = (draft) => {
  const rules = [];
  const pushRule = (attribute, values) => {
    if (!Array.isArray(values) || !values.length) return;
    const cleaned = Array.from(new Set(values.map((entry) => String(entry).trim()).filter(Boolean)));
    if (!cleaned.length) return;
    rules.push({ attribute, operator: 'in', value: cleaned });
  };
  pushRule('customer_group_id', draft.customer_group_ids);
  pushRule('product_id', draft.product_ids);
  pushRule('product_collection_id', draft.collection_ids);
  pushRule('product_category_id', draft.category_ids);
  pushRule('product_tag_id', draft.tag_ids);
  pushRule('product_type_id', draft.type_ids);
  return rules;
};

const extractTaxRateRuleValues = (rules, reference) => {
  if (!Array.isArray(rules)) return [];
  return rules
    .filter((rule) => rule?.reference === reference)
    .map((rule) => rule?.reference_id)
    .filter(Boolean)
    .map((value) => String(value));
};

const buildTaxRateRules = (draft) => {
  const rules = [];
  const pushRules = (reference, values) => {
    if (!Array.isArray(values) || !values.length) return;
    const cleaned = Array.from(new Set(values.map((entry) => String(entry).trim()).filter(Boolean)));
    cleaned.forEach((referenceId) => {
      rules.push({ reference, reference_id: referenceId });
    });
  };
  pushRules('product', draft.product_ids);
  pushRules('product_type', draft.product_type_ids);
  pushRules('product_collection', draft.product_collection_ids);
  pushRules('product_tag', draft.product_tag_ids);
  pushRules('product_category', draft.product_category_ids);
  pushRules('shipping_option', draft.shipping_option_ids);
  return rules;
};

const buildPriceListPriceDrafts = (prices) => {
  const drafts = {};
  (prices || []).forEach((price) => {
    if (!price?.id) return;
    drafts[price.id] = {
      amount: formatPriceInput(price?.amount),
      currency_code: price?.currency_code || '',
      region_id: price?.region_id || price?.region?.id || '',
      min_quantity: price?.min_quantity != null ? String(price.min_quantity) : '',
      max_quantity: price?.max_quantity != null ? String(price.max_quantity) : '',
      variant_id: price?.variant_id || price?.variant?.id || ''
    };
  });
  return drafts;
};

const getPriceListVariantLabel = (price) => {
  const variant = price?.variant || price?.variant_detail || null;
  const variantTitle = variant?.title || variant?.name;
  const productTitle = variant?.product?.title || price?.product?.title;
  if (variantTitle && productTitle) return `${productTitle} - ${variantTitle}`;
  return variantTitle || productTitle || price?.variant_id || 'Variant';
};

const formatVariantOptions = (variant) => {
  if (!variant) return '-';
  const list = Array.isArray(variant.options)
    ? variant.options
    : Array.isArray(variant.option_values)
      ? variant.option_values
      : null;
  if (list && list.length) {
    const formatted = list
      .map((option) => {
        const value = option?.value ?? option?.option_value ?? option?.name;
        const title = option?.option?.title || option?.title;
        if (title && value) return `${title}: ${value}`;
        return value || title;
      })
      .filter(Boolean);
    return formatted.length ? formatted.join(' / ') : '-';
  }
  if (variant.options && typeof variant.options === 'object') {
    const values = Object.values(variant.options).filter(Boolean);
    if (values.length) return values.join(' / ');
  }
  return '-';
};

const getVariantInventoryQuantity = (variant) => {
  if (!variant) return null;
  if (typeof variant.inventory_quantity === 'number') {
    return variant.inventory_quantity;
  }
  if (Array.isArray(variant.inventory_items)) {
    let total = 0;
    let found = false;
    variant.inventory_items.forEach((entry) => {
      const quantity =
        entry?.inventory_item?.inventory_quantity ??
        entry?.inventory_item?.stocked_quantity ??
        entry?.inventory_item?.available_quantity ??
        entry?.inventory_quantity ??
        entry?.quantity;
      if (typeof quantity === 'number') {
        total += quantity;
        found = true;
      }
    });
    return found ? total : null;
  }
  return null;
};

const getVariantThumbnail = (variant, fallback) => {
  return (
    variant?.thumbnail ||
    variant?.image ||
    variant?.images?.[0]?.url ||
    variant?.images?.[0] ||
    fallback ||
    ''
  );
};

const getOrderItemId = (item) => item?.id || item?.item_id || item?.detail?.id || item?.item?.id || null;

const buildItemQuantityMap = (items) => {
  const map = {};
  (items || []).forEach((item) => {
    const itemId = getOrderItemId(item);
    if (itemId) {
      map[itemId] = 0;
    }
  });
  return map;
};

const buildReturnRequestMap = (items) => {
  const map = {};
  (items || []).forEach((item) => {
    const itemId = getOrderItemId(item);
    if (itemId) {
      map[itemId] = { quantity: 0, reason_id: '' };
    }
  });
  return map;
};

const buildReturnReceiveMap = (items) => {
  const map = {};
  (items || []).forEach((item) => {
    const itemId = getOrderItemId(item);
    if (itemId) {
      map[itemId] = 0;
    }
  });
  return map;
};

const buildReturnItemRows = (items, fallbackId) => {
  if (!Array.isArray(items)) return [];
  return items.map((entry, index) => {
    const line = getReturnItemLine(entry);
    const rowId =
      getOrderItemId(line) || entry?.id || entry?.item_id || `${fallbackId || 'item'}-${index}`;
    return {
      id: rowId,
      title: getLineItemTitle(line),
      sku: getReturnItemSku(entry),
      quantity: getReturnItemQuantity(entry),
      received: getReturnItemReceivedQuantity(entry),
      reason: getReturnItemReason(entry),
      note: getReturnItemNote(entry)
    };
  });
};

const ResourceDetail = ({ resource }) => {
  const navigate = useNavigate();
  const { id } = useParams();
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showRaw, setShowRaw] = useState(false);
  const isProduct = resource?.id === 'products';
  const isVariant = resource?.id === 'product-variants';
  const isCollection = resource?.id === 'collections';
  const isCategory = resource?.id === 'product-categories';
  const isProductType = resource?.id === 'product-types';
  const isProductTag = resource?.id === 'product-tags';
  const isGiftCard = resource?.id === 'gift-cards';
  const isOrder = resource?.id === 'orders';
  const isDraftOrder = resource?.id === 'draft-orders';
  const isOrderLike = isOrder || isDraftOrder;
  const isReturn = resource?.id === 'returns';
  const isExchange = resource?.id === 'exchanges';
  const isRegion = resource?.id === 'regions';
  const isShippingProfile = resource?.id === 'shipping-profiles';
  const isShippingOption = resource?.id === 'shipping-options';
  const isTaxRegion = resource?.id === 'tax-regions';
  const isTaxRate = resource?.id === 'tax-rates';
  const isReturnReason = resource?.id === 'return-reasons';
  const isRefundReason = resource?.id === 'refund-reasons';
  const isPromotion = resource?.id === 'promotions';
  const isCampaign = resource?.id === 'campaigns';
  const isPriceList = resource?.id === 'price-lists';
  const isCustomer = resource?.id === 'customers';
  const isCustomerGroup = resource?.id === 'customer-groups';
  const isInventoryItem = resource?.id === 'inventory-items';
  const isStockLocation = resource?.id === 'stock-locations';
  const isUser = resource?.id === 'users';
  const isInvite = resource?.id === 'invites';
  const isApiKey = resource?.id === 'api-keys';
  const isStore = resource?.id === 'stores';
  const isSalesChannel = resource?.id === 'sales-channels';
  const isOpsConfig =
    isRegion || isShippingProfile || isShippingOption || isTaxRegion || isTaxRate;
  const isMerchConfig = isPromotion || isCampaign || isPriceList;
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState('');
  const [inventoryMessage, setInventoryMessage] = useState('');
  const [inventoryCounts, setInventoryCounts] = useState({});
  const [productDraft, setProductDraft] = useState(null);
  const [saveState, setSaveState] = useState({ saving: false, error: '', success: '' });
  const [productUploadState, setProductUploadState] = useState({
    uploading: false,
    error: '',
    success: ''
  });
  const [productMeta, setProductMeta] = useState({
    collections: [],
    categories: [],
    salesChannels: [],
    types: [],
    tags: [],
    shippingProfiles: []
  });
  const [metaLoading, setMetaLoading] = useState(false);
  const [metaError, setMetaError] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tagSaving, setTagSaving] = useState(false);
  const [tagError, setTagError] = useState('');
  const [optionDrafts, setOptionDrafts] = useState([]);
  const [optionSavingId, setOptionSavingId] = useState(null);
  const [optionDeletingId, setOptionDeletingId] = useState(null);
  const [optionError, setOptionError] = useState('');
  const [optionMessage, setOptionMessage] = useState('');
  const [newOption, setNewOption] = useState({ title: '', values: '' });
  const [variantDrafts, setVariantDrafts] = useState([]);
  const [variantUploadState, setVariantUploadState] = useState({
    uploadingId: null,
    error: '',
    success: ''
  });
  const [variantSavingId, setVariantSavingId] = useState(null);
  const [variantDeletingId, setVariantDeletingId] = useState(null);
  const [variantError, setVariantError] = useState('');
  const [variantMessage, setVariantMessage] = useState('');
  const [newVariant, setNewVariant] = useState(null);
  const [variantProduct, setVariantProduct] = useState(null);
  const [variantProductError, setVariantProductError] = useState('');
  const [orderActionState, setOrderActionState] = useState({ saving: false, error: '', success: '' });
  const [orderArchiveState, setOrderArchiveState] = useState({
    saving: false,
    error: '',
    success: ''
  });
  const [orderTransferDraft, setOrderTransferDraft] = useState({
    customer_id: '',
    description: '',
    internal_note: ''
  });
  const [orderTransferSearch, setOrderTransferSearch] = useState({
    query: '',
    results: [],
    loading: false,
    error: ''
  });
  const [orderTransferState, setOrderTransferState] = useState({
    saving: false,
    canceling: false,
    error: '',
    success: ''
  });
  const [orderTransferTarget, setOrderTransferTarget] = useState(null);
  const [orderTransferTargetState, setOrderTransferTargetState] = useState({
    loading: false,
    error: ''
  });
  const [orderCreditDraft, setOrderCreditDraft] = useState({
    amount: '',
    reference: 'refund',
    reference_id: '',
    metadata: '',
    is_credit: true
  });
  const [orderCreditState, setOrderCreditState] = useState({
    saving: false,
    error: '',
    success: ''
  });
  const [orderNoteDraft, setOrderNoteDraft] = useState('');
  const [orderNoteState, setOrderNoteState] = useState({
    saving: false,
    error: '',
    success: ''
  });
  const [orderDetailDraft, setOrderDetailDraft] = useState(null);
  const [orderDetailState, setOrderDetailState] = useState({
    saving: false,
    error: '',
    success: ''
  });
  const [fulfillmentMeta, setFulfillmentMeta] = useState({ locations: [], shippingOptions: [] });
  const [fulfillmentMetaLoading, setFulfillmentMetaLoading] = useState(false);
  const [fulfillmentMetaError, setFulfillmentMetaError] = useState('');
  const [fulfillmentDraft, setFulfillmentDraft] = useState({
    location_id: '',
    shipping_option_id: '',
    manual_shipping_option_id: '',
    notify_customer: true,
    items: {}
  });
  const [fulfillmentState, setFulfillmentState] = useState({ saving: false, error: '', success: '' });
  const [shipmentDrafts, setShipmentDrafts] = useState({});
  const [shipmentState, setShipmentState] = useState({
    savingId: null,
    action: '',
    error: '',
    success: ''
  });
  const [paymentDrafts, setPaymentDrafts] = useState({});
  const [paymentState, setPaymentState] = useState({
    savingId: null,
    action: '',
    error: '',
    success: ''
  });
  const [refundReasons, setRefundReasons] = useState([]);
  const [refundReasonsError, setRefundReasonsError] = useState('');
  const [orderReturns, setOrderReturns] = useState([]);
  const [orderReturnsLoading, setOrderReturnsLoading] = useState(false);
  const [orderReturnsError, setOrderReturnsError] = useState('');
  const [orderExchanges, setOrderExchanges] = useState([]);
  const [orderExchangesLoading, setOrderExchangesLoading] = useState(false);
  const [orderExchangesError, setOrderExchangesError] = useState('');
  const [linkedOrder, setLinkedOrder] = useState(null);
  const [linkedOrderLoading, setLinkedOrderLoading] = useState(false);
  const [linkedOrderError, setLinkedOrderError] = useState('');
  const [orderPreview, setOrderPreview] = useState(null);
  const [orderPreviewLoading, setOrderPreviewLoading] = useState(false);
  const [orderPreviewError, setOrderPreviewError] = useState('');
  const [orderChanges, setOrderChanges] = useState([]);
  const [orderChangesLoading, setOrderChangesLoading] = useState(false);
  const [orderChangesError, setOrderChangesError] = useState('');
  const [orderEditDraft, setOrderEditDraft] = useState({
    description: '',
    internal_note: ''
  });
  const [orderEditState, setOrderEditState] = useState({
    saving: false,
    action: '',
    error: '',
    success: ''
  });
  const [orderEditItemDrafts, setOrderEditItemDrafts] = useState({});
  const [orderEditItemState, setOrderEditItemState] = useState({
    savingId: null,
    action: '',
    error: '',
    success: ''
  });
  const [orderEditAddDraft, setOrderEditAddDraft] = useState({
    variant_id: '',
    quantity: 1,
    unit_price: '',
    compare_at_unit_price: '',
    allow_backorder: false,
    internal_note: ''
  });
  const [orderEditAddState, setOrderEditAddState] = useState({
    saving: false,
    error: '',
    success: ''
  });
  const [orderEditVariantSearch, setOrderEditVariantSearch] = useState({
    query: '',
    results: [],
    loading: false,
    error: ''
  });
  const [orderEditSelectedVariant, setOrderEditSelectedVariant] = useState(null);
  const [orderEditAddActionDrafts, setOrderEditAddActionDrafts] = useState({});
  const [orderEditShippingDraft, setOrderEditShippingDraft] = useState({
    shipping_option_id: '',
    custom_amount: '',
    description: '',
    internal_note: ''
  });
  const [orderEditShippingActionDrafts, setOrderEditShippingActionDrafts] = useState({});
  const [orderEditShippingState, setOrderEditShippingState] = useState({
    savingId: null,
    action: '',
    error: '',
    success: ''
  });
  const [draftOrderShippingMethodDrafts, setDraftOrderShippingMethodDrafts] = useState({});
  const [draftOrderPromoDraft, setDraftOrderPromoDraft] = useState('');
  const [draftOrderPromoState, setDraftOrderPromoState] = useState({
    saving: false,
    action: '',
    error: '',
    success: ''
  });
  const [draftOrderActionState, setDraftOrderActionState] = useState({
    saving: false,
    error: '',
    success: ''
  });
  const [returnReasons, setReturnReasons] = useState([]);
  const [returnReasonsLoading, setReturnReasonsLoading] = useState(false);
  const [returnReasonsError, setReturnReasonsError] = useState('');
  const [returnDraft, setReturnDraft] = useState({
    location_id: '',
    description: '',
    internal_note: '',
    notify_customer: true
  });
  const [returnRequestDrafts, setReturnRequestDrafts] = useState({});
  const [returnReceiveDrafts, setReturnReceiveDrafts] = useState({});
  const [returnState, setReturnState] = useState({ savingId: null, error: '', success: '' });
  const [exchangeDraft, setExchangeDraft] = useState({
    description: '',
    internal_note: ''
  });
  const [exchangeInboundDrafts, setExchangeInboundDrafts] = useState({});
  const [exchangeOutboundDrafts, setExchangeOutboundDrafts] = useState({});
  const [exchangeState, setExchangeState] = useState({ savingId: null, error: '', success: '' });
  const [exchangeShippingDrafts, setExchangeShippingDrafts] = useState({});
  const [exchangeLabelUploadState, setExchangeLabelUploadState] = useState({
    uploadingId: null,
    targetId: null,
    error: '',
    success: ''
  });
  const [fulfillmentLabelUploadState, setFulfillmentLabelUploadState] = useState({
    uploadingId: null,
    targetId: null,
    error: '',
    success: ''
  });
  const [opsMeta, setOpsMeta] = useState({
    paymentProviders: [],
    fulfillmentProviders: [],
    shippingProfiles: [],
    serviceZones: [],
    regions: [],
    taxProviders: [],
    taxRegions: []
  });
  const [opsMetaLoading, setOpsMetaLoading] = useState(false);
  const [opsMetaError, setOpsMetaError] = useState('');
  const [opsMetaFailures, setOpsMetaFailures] = useState([]);

  const renderOpsMetaFailures = (className) =>
    opsMetaFailures.length ? (
      <ul className={className}>
        {opsMetaFailures.map((message) => (
          <li key={message}>• {message}</li>
        ))}
      </ul>
    ) : null;
  const [regionDraft, setRegionDraft] = useState({
    name: '',
    currency_code: '',
    countries: '',
    payment_providers: '',
    automatic_taxes: false,
    is_tax_inclusive: false,
    metadata: ''
  });
  const [regionState, setRegionState] = useState({ saving: false, deleting: false, error: '', success: '' });
  const [shippingProfileDraft, setShippingProfileDraft] = useState({
    name: '',
    type: '',
    metadata: ''
  });
  const [shippingProfileState, setShippingProfileState] = useState({
    saving: false,
    deleting: false,
    error: '',
    success: ''
  });
  const [shippingOptionDraft, setShippingOptionDraft] = useState({
    name: '',
    price_type: '',
    service_zone_id: '',
    shipping_profile_id: '',
    provider_id: '',
    prices: [],
    type_id: '',
    type_label: '',
    type_code: '',
    type_description: '',
    data: '',
    metadata: '',
    enabled_in_store: true,
    is_return: false
  });
  const [shippingOptionState, setShippingOptionState] = useState({
    saving: false,
    deleting: false,
    error: '',
    success: ''
  });
  const [taxRegionDraft, setTaxRegionDraft] = useState({
    country_code: '',
    province_code: '',
    provider_id: '',
    parent_id: '',
    metadata: ''
  });
  const [taxRegionState, setTaxRegionState] = useState({
    saving: false,
    deleting: false,
    error: '',
    success: ''
  });
  const [taxRateDraft, setTaxRateDraft] = useState({
    name: '',
    code: '',
    rate: '',
    tax_region_id: '',
    is_default: false,
    is_combinable: false,
    metadata: ''
  });
  const [taxRateState, setTaxRateState] = useState({
    saving: false,
    deleting: false,
    error: '',
    success: ''
  });
  const [returnReasonDraft, setReturnReasonDraft] = useState({
    value: '',
    label: '',
    description: '',
    parent_return_reason_id: '',
    metadata: ''
  });
  const [returnReasonState, setReturnReasonState] = useState({
    saving: false,
    deleting: false,
    error: '',
    success: ''
  });
  const [refundReasonDraft, setRefundReasonDraft] = useState({
    label: '',
    code: '',
    description: ''
  });
  const [refundReasonState, setRefundReasonState] = useState({
    saving: false,
    deleting: false,
    error: '',
    success: ''
  });
  const [inventoryItemDraft, setInventoryItemDraft] = useState({
    title: '',
    sku: '',
    description: '',
    material: '',
    hs_code: '',
    origin_country: '',
    mid_code: '',
    weight: '',
    length: '',
    height: '',
    width: '',
    requires_shipping: true,
    thumbnail: '',
    metadata: ''
  });
  const [inventoryItemState, setInventoryItemState] = useState({
    saving: false,
    deleting: false,
    error: '',
    success: ''
  });
  const [inventoryLevelDraft, setInventoryLevelDraft] = useState({
    location_id: '',
    stocked_quantity: '',
    incoming_quantity: ''
  });
  const [inventoryLevelState, setInventoryLevelState] = useState({
    savingId: null,
    deletingId: null,
    creating: false,
    error: '',
    success: ''
  });
  const [inventoryAdjustments, setInventoryAdjustments] = useState({});
  const [inventoryMeta, setInventoryMeta] = useState({ locations: [] });
  const [inventoryMetaLoading, setInventoryMetaLoading] = useState(false);
  const [inventoryMetaError, setInventoryMetaError] = useState('');
  const [inventoryReservations, setInventoryReservations] = useState([]);
  const [inventoryReservationsLoading, setInventoryReservationsLoading] = useState(false);
  const [inventoryReservationsError, setInventoryReservationsError] = useState('');
  const [inventoryReservationDraft, setInventoryReservationDraft] = useState({
    location_id: '',
    quantity: '',
    description: ''
  });
  const [inventoryReservationState, setInventoryReservationState] = useState({
    saving: false,
    error: '',
    success: ''
  });
  const [stockLocationDraft, setStockLocationDraft] = useState({
    name: '',
    address_1: '',
    address_2: '',
    city: '',
    province: '',
    postal_code: '',
    country_code: '',
    phone: '',
    metadata: ''
  });
  const [stockLocationState, setStockLocationState] = useState({
    saving: false,
    deleting: false,
    error: '',
    success: ''
  });
  const [stockLocationMeta, setStockLocationMeta] = useState({
    salesChannels: [],
    fulfillmentProviders: []
  });
  const [stockLocationMetaLoading, setStockLocationMetaLoading] = useState(false);
  const [stockLocationMetaError, setStockLocationMetaError] = useState('');
  const [stockLocationInventoryState, setStockLocationInventoryState] = useState({
    items: [],
    count: 0,
    loading: false,
    error: ''
  });
  const [stockLocationInventoryQuery, setStockLocationInventoryQuery] = useState('');
  const [stockLocationInventorySearch, setStockLocationInventorySearch] = useState('');
  const [fulfillmentSetDraft, setFulfillmentSetDraft] = useState({
    name: '',
    type: ''
  });
  const [fulfillmentSetState, setFulfillmentSetState] = useState({
    saving: false,
    deletingId: null,
    error: '',
    success: ''
  });
  const [serviceZoneDrafts, setServiceZoneDrafts] = useState({});
  const [serviceZoneEdits, setServiceZoneEdits] = useState({});
  const [serviceZoneState, setServiceZoneState] = useState({
    savingId: null,
    deletingId: null,
    error: '',
    success: ''
  });
  const [locationSalesChannelState, setLocationSalesChannelState] = useState({
    savingId: null,
    error: '',
    success: ''
  });
  const [locationProviderState, setLocationProviderState] = useState({
    savingId: null,
    error: '',
    success: ''
  });
  const [collectionDraft, setCollectionDraft] = useState({
    title: '',
    handle: '',
    description: '',
    thumbnail: '',
    metadata: ''
  });
  const [collectionState, setCollectionState] = useState({
    saving: false,
    deleting: false,
    error: '',
    success: ''
  });
  const [collectionProducts, setCollectionProducts] = useState([]);
  const [collectionProductCount, setCollectionProductCount] = useState(0);
  const [collectionProductLoading, setCollectionProductLoading] = useState(false);
  const [collectionProductError, setCollectionProductError] = useState('');
  const [collectionProductSearch, setCollectionProductSearch] = useState({
    query: '',
    results: [],
    loading: false,
    error: ''
  });
  const [collectionProductState, setCollectionProductState] = useState({
    savingId: null,
    error: '',
    success: ''
  });
  const [collectionSelection, setCollectionSelection] = useState({
    search: [],
    assigned: []
  });
  const [collectionBulkState, setCollectionBulkState] = useState({
    saving: false,
    error: '',
    success: ''
  });
  const [collectionUploadState, setCollectionUploadState] = useState({
    uploading: false,
    error: '',
    success: ''
  });
  const [categoryDraft, setCategoryDraft] = useState({
    name: '',
    handle: '',
    description: '',
    is_active: true,
    is_internal: false,
    parent_category_id: '',
    thumbnail: '',
    metadata: ''
  });
  const [categoryState, setCategoryState] = useState({
    saving: false,
    deleting: false,
    error: '',
    success: ''
  });
  const [categoryMeta, setCategoryMeta] = useState({ categories: [] });
  const [categoryMetaLoading, setCategoryMetaLoading] = useState(false);
  const [categoryMetaError, setCategoryMetaError] = useState('');
  const [categoryProducts, setCategoryProducts] = useState([]);
  const [categoryProductCount, setCategoryProductCount] = useState(0);
  const [categoryProductLoading, setCategoryProductLoading] = useState(false);
  const [categoryProductError, setCategoryProductError] = useState('');
  const [categoryProductSearch, setCategoryProductSearch] = useState({
    query: '',
    results: [],
    loading: false,
    error: ''
  });
  const [categoryProductState, setCategoryProductState] = useState({
    savingId: null,
    error: '',
    success: ''
  });
  const [categorySelection, setCategorySelection] = useState({
    search: [],
    assigned: []
  });
  const [categoryBulkState, setCategoryBulkState] = useState({
    saving: false,
    error: '',
    success: ''
  });
  const [categoryUploadState, setCategoryUploadState] = useState({
    uploading: false,
    error: '',
    success: ''
  });
  const [productTypeDraft, setProductTypeDraft] = useState({
    value: '',
    metadata: ''
  });
  const [productTypeState, setProductTypeState] = useState({
    saving: false,
    deleting: false,
    error: '',
    success: ''
  });
  const [productTypeProducts, setProductTypeProducts] = useState([]);
  const [productTypeProductCount, setProductTypeProductCount] = useState(0);
  const [productTypeProductLoading, setProductTypeProductLoading] = useState(false);
  const [productTypeProductError, setProductTypeProductError] = useState('');
  const [productTypeProductSearch, setProductTypeProductSearch] = useState({
    query: '',
    results: [],
    loading: false,
    error: ''
  });
  const [productTypeProductState, setProductTypeProductState] = useState({
    savingId: null,
    error: '',
    success: ''
  });
  const [productTypeSelection, setProductTypeSelection] = useState({
    search: [],
    assigned: []
  });
  const [productTypeBulkState, setProductTypeBulkState] = useState({
    saving: false,
    error: '',
    success: ''
  });
  const [productTagDraft, setProductTagDraft] = useState({
    value: '',
    metadata: ''
  });
  const [productTagState, setProductTagState] = useState({
    saving: false,
    deleting: false,
    error: '',
    success: ''
  });
  const [giftCardDraft, setGiftCardDraft] = useState({
    ends_at: '',
    is_disabled: false,
    metadata: ''
  });
  const [giftCardState, setGiftCardState] = useState({
    saving: false,
    deleting: false,
    error: '',
    success: ''
  });
  const [productTagProducts, setProductTagProducts] = useState([]);
  const [productTagProductCount, setProductTagProductCount] = useState(0);
  const [productTagProductLoading, setProductTagProductLoading] = useState(false);
  const [productTagProductError, setProductTagProductError] = useState('');
  const [productTagProductSearch, setProductTagProductSearch] = useState({
    query: '',
    results: [],
    loading: false,
    error: ''
  });
  const [productTagProductState, setProductTagProductState] = useState({
    savingId: null,
    error: '',
    success: ''
  });
  const [productTagSelection, setProductTagSelection] = useState({
    search: [],
    assigned: []
  });
  const [productTagBulkState, setProductTagBulkState] = useState({
    saving: false,
    error: '',
    success: ''
  });
  const [userDraft, setUserDraft] = useState({
    email: '',
    role: '',
    first_name: '',
    last_name: '',
    avatar_url: '',
    metadata: ''
  });
  const [userState, setUserState] = useState({
    saving: false,
    deleting: false,
    error: '',
    success: ''
  });
  const [inviteState, setInviteState] = useState({
    deleting: false,
    error: '',
    success: ''
  });
  const [apiKeyDraft, setApiKeyDraft] = useState({
    title: '',
    revoke_in: ''
  });
  const [apiKeyState, setApiKeyState] = useState({
    saving: false,
    deleting: false,
    revoking: false,
    error: '',
    success: ''
  });
  const [storeDraft, setStoreDraft] = useState({
    name: '',
    supported_currencies: [],
    supported_locales: [],
    default_sales_channel_id: '',
    default_region_id: '',
    default_location_id: '',
    metadata: ''
  });
  const [storeCurrencyInput, setStoreCurrencyInput] = useState('');
  const [storeLocaleInput, setStoreLocaleInput] = useState('');
  const [storeState, setStoreState] = useState({
    saving: false,
    error: '',
    success: ''
  });
  const [storeMeta, setStoreMeta] = useState({
    salesChannels: [],
    regions: [],
    locations: []
  });
  const [storeMetaLoading, setStoreMetaLoading] = useState(false);
  const [storeMetaError, setStoreMetaError] = useState('');
  const [salesChannelDraft, setSalesChannelDraft] = useState({
    name: '',
    description: '',
    is_disabled: false,
    metadata: ''
  });
  const [salesChannelState, setSalesChannelState] = useState({
    saving: false,
    deleting: false,
    error: '',
    success: ''
  });
  const [salesChannelProducts, setSalesChannelProducts] = useState([]);
  const [salesChannelProductCount, setSalesChannelProductCount] = useState(0);
  const [salesChannelProductLoading, setSalesChannelProductLoading] = useState(false);
  const [salesChannelProductError, setSalesChannelProductError] = useState('');
  const [salesChannelProductSearch, setSalesChannelProductSearch] = useState({
    query: '',
    results: [],
    loading: false,
    error: ''
  });
  const [salesChannelProductState, setSalesChannelProductState] = useState({
    savingId: null,
    error: '',
    success: ''
  });
  const [salesChannelSelection, setSalesChannelSelection] = useState({
    search: [],
    assigned: []
  });
  const [salesChannelBulkState, setSalesChannelBulkState] = useState({
    saving: false,
    error: '',
    success: ''
  });
  const [customerDraft, setCustomerDraft] = useState({
    email: '',
    first_name: '',
    last_name: '',
    company_name: '',
    phone: '',
    note: '',
    metadata: ''
  });
  const [customerState, setCustomerState] = useState({
    saving: false,
    deleting: false,
    error: '',
    success: ''
  });
  const [customerGroupDraft, setCustomerGroupDraft] = useState({
    name: '',
    note: '',
    metadata: ''
  });
  const [customerGroupState, setCustomerGroupState] = useState({
    saving: false,
    deleting: false,
    error: '',
    success: ''
  });
  const [customerGroupMeta, setCustomerGroupMeta] = useState({ groups: [] });
  const [customerGroupMetaLoading, setCustomerGroupMetaLoading] = useState(false);
  const [customerGroupMetaError, setCustomerGroupMetaError] = useState('');
  const [customerGroupMembership, setCustomerGroupMembership] = useState({
    initial: [],
    selected: []
  });
  const [customerGroupMembershipState, setCustomerGroupMembershipState] = useState({
    saving: false,
    error: '',
    success: ''
  });
  const [groupCustomerMembership, setGroupCustomerMembership] = useState({
    initial: [],
    selected: []
  });
  const [groupCustomerState, setGroupCustomerState] = useState({
    saving: false,
    error: '',
    success: ''
  });
  const [groupCustomerSearch, setGroupCustomerSearch] = useState({
    query: '',
    results: [],
    loading: false,
    error: ''
  });
  const [groupCustomerSelected, setGroupCustomerSelected] = useState([]);
  const [taxRateRuleDraft, setTaxRateRuleDraft] = useState({
    product_ids: [],
    product_type_ids: [],
    product_collection_ids: [],
    product_tag_ids: [],
    product_category_ids: [],
    shipping_option_ids: []
  });
  const [taxRateRuleMeta, setTaxRateRuleMeta] = useState({
    collections: [],
    categories: [],
    tags: [],
    types: [],
    shippingOptions: []
  });
  const [taxRateRuleMetaLoading, setTaxRateRuleMetaLoading] = useState(false);
  const [taxRateRuleMetaError, setTaxRateRuleMetaError] = useState('');
  const [taxRateProductSearch, setTaxRateProductSearch] = useState({
    query: '',
    results: [],
    loading: false,
    error: ''
  });
  const [taxRateSelectedProducts, setTaxRateSelectedProducts] = useState([]);
  const [merchMeta, setMerchMeta] = useState({ campaigns: [] });
  const [merchMetaLoading, setMerchMetaLoading] = useState(false);
  const [merchMetaError, setMerchMetaError] = useState('');
  const [promotionDraft, setPromotionDraft] = useState({
    code: '',
    description: '',
    status: '',
    starts_at: '',
    ends_at: '',
    is_automatic: false,
    campaign_id: '',
    type: 'standard',
    application_method_type: '',
    application_method_value: '',
    application_method_currency: '',
    application_method_target: 'items',
    application_method_allocation: 'across',
    extra: ''
  });
  const [promotionState, setPromotionState] = useState({
    saving: false,
    deleting: false,
    error: '',
    success: ''
  });
  const [campaignDraft, setCampaignDraft] = useState({
    name: '',
    description: '',
    starts_at: '',
    ends_at: '',
    extra: ''
  });
  const [campaignState, setCampaignState] = useState({
    saving: false,
    deleting: false,
    error: '',
    success: ''
  });
  const [priceListDraft, setPriceListDraft] = useState({
    title: '',
    description: '',
    status: '',
    type: '',
    starts_at: '',
    ends_at: '',
    extra: ''
  });
  const [priceListState, setPriceListState] = useState({
    saving: false,
    deleting: false,
    error: '',
    success: ''
  });
  const [priceListPrices, setPriceListPrices] = useState([]);
  const [priceListPricesLoading, setPriceListPricesLoading] = useState(false);
  const [priceListPricesError, setPriceListPricesError] = useState('');
  const [priceListPriceDrafts, setPriceListPriceDrafts] = useState({});
  const [priceListPriceState, setPriceListPriceState] = useState({
    savingId: null,
    action: '',
    error: '',
    success: ''
  });
  const [newPriceListPrice, setNewPriceListPrice] = useState({
    variant_id: '',
    amount: '',
    currency_code: '',
    region_id: '',
    min_quantity: '',
    max_quantity: ''
  });
  const [priceListVariantSearch, setPriceListVariantSearch] = useState({
    query: '',
    results: [],
    loading: false,
    error: ''
  });
  const [selectedPriceListVariant, setSelectedPriceListVariant] = useState(null);
  const [priceListRuleDraft, setPriceListRuleDraft] = useState({
    customer_group_ids: [],
    product_ids: [],
    collection_ids: [],
    category_ids: [],
    tag_ids: [],
    type_ids: []
  });
  const [priceListRuleMeta, setPriceListRuleMeta] = useState({
    customerGroups: [],
    collections: [],
    categories: [],
    tags: [],
    types: []
  });
  const [priceListRuleMetaLoading, setPriceListRuleMetaLoading] = useState(false);
  const [priceListRuleMetaError, setPriceListRuleMetaError] = useState('');
  const [priceListProductSearch, setPriceListProductSearch] = useState({
    query: '',
    results: [],
    loading: false,
    error: ''
  });
  const [priceListSelectedProducts, setPriceListSelectedProducts] = useState([]);

  const orderItems = useMemo(() => {
    if (!isOrderLike || !record) return [];
    return Array.isArray(record.items) ? record.items : [];
  }, [isOrderLike, record]);

  const returnRecordItems = useMemo(() => {
    if (!isReturn || !record) return [];
    if (Array.isArray(record.items) && record.items.length) return record.items;
    if (Array.isArray(record.return_items) && record.return_items.length) return record.return_items;
    if (Array.isArray(record.line_items) && record.line_items.length) return record.line_items;
    return [];
  }, [isReturn, record]);

  const linkedOrderItems = useMemo(() => {
    if (!linkedOrder) return [];
    return Array.isArray(linkedOrder.items) ? linkedOrder.items : [];
  }, [linkedOrder]);

  const returnItemSource = useMemo(() => {
    if (isReturn) {
      return linkedOrderItems.length ? linkedOrderItems : returnRecordItems;
    }
    return orderItems;
  }, [isReturn, linkedOrderItems, returnRecordItems, orderItems]);

  const exchangeInboundItems = useMemo(() => {
    if (!isExchange || !record) return [];
    if (Array.isArray(record.return_items) && record.return_items.length) return record.return_items;
    if (Array.isArray(record.inbound_items) && record.inbound_items.length) return record.inbound_items;
    if (Array.isArray(record.items) && record.items.length) return record.items;
    return [];
  }, [isExchange, record]);

  const exchangeOutboundItems = useMemo(() => {
    if (!isExchange || !record) return [];
    if (Array.isArray(record.additional_items) && record.additional_items.length) {
      return record.additional_items;
    }
    if (Array.isArray(record.outbound_items) && record.outbound_items.length) {
      return record.outbound_items;
    }
    if (Array.isArray(record.new_items) && record.new_items.length) {
      return record.new_items;
    }
    return [];
  }, [isExchange, record]);

  const exchangeRecords = useMemo(() => {
    if (isOrder) return orderExchanges;
    if (isExchange && record) return [record];
    return [];
  }, [isOrder, orderExchanges, isExchange, record]);

  const exchangeItemSource = useMemo(() => {
    if (isOrder) return orderItems;
    if (isExchange) {
      if (linkedOrderItems.length) return linkedOrderItems;
      if (exchangeInboundItems.length) return exchangeInboundItems;
    }
    return [];
  }, [isOrder, orderItems, isExchange, linkedOrderItems, exchangeInboundItems]);

  const orderCurrency =
    record?.currency_code ||
    record?.currency ||
    record?.region?.currency_code ||
    record?.region?.currency?.code ||
    'usd';
  const giftCardCurrency =
    record?.region?.currency_code ||
    record?.region?.currency?.code ||
    record?.currency_code ||
    'usd';
  const giftCardStatus = isGiftCard
    ? (() => {
        if (!record) return '';
        if (record?.is_disabled || record?.disabled_at) return 'Disabled';
        const endsAt = record?.ends_at || record?.expires_at;
        if (endsAt) {
          const time = new Date(endsAt).getTime();
          if (Number.isFinite(time) && time < Date.now()) return 'Expired';
        }
        return 'Active';
      })()
    : '';

  const orderPayments = useMemo(() => {
    if (!isOrder || !record) return [];
    const collections = Array.isArray(record.payment_collections) ? record.payment_collections : [];
    const payments = [];
    collections.forEach((collection) => {
      (collection.payments || []).forEach((payment) => {
        payments.push({
          ...payment,
          payment_collection: collection
        });
      });
    });
    return payments;
  }, [isOrder, record]);

  const orderNotes = useMemo(() => {
    if (!isOrder || !record) return [];
    const metadata =
      record?.metadata && typeof record.metadata === 'object' ? record.metadata : {};
    const notes = Array.isArray(metadata.notes) ? metadata.notes : [];
    const normalized = [];

    notes.forEach((note, index) => {
      if (!note) return;
      if (typeof note === 'string') {
        normalized.push({
          id: `note-${index}`,
          text: note,
          created_at: record?.updated_at || record?.created_at
        });
        return;
      }
      if (typeof note !== 'object') return;
      const text = note.text || note.note || note.message || '';
      if (!text) return;
      normalized.push({
        id: note.id || `note-${index}`,
        text: String(text),
        created_at: note.created_at || note.updated_at || record?.updated_at || record?.created_at,
        author: note.author || note.created_by || note.user || ''
      });
    });

    if (!normalized.length) {
      const fallback = metadata.note || (typeof metadata.notes === 'string' ? metadata.notes : '');
      if (fallback) {
        normalized.push({
          id: 'note-legacy',
          text: String(fallback),
          created_at: record?.updated_at || record?.created_at
        });
      }
    }

    return normalized.sort((a, b) => {
      const aTime = new Date(a?.created_at || 0).getTime();
      const bTime = new Date(b?.created_at || 0).getTime();
      return bTime - aTime;
    });
  }, [isOrder, record]);

  const orderTimelineItems = useMemo(() => {
    if (!isOrder || !record) return [];
    const items = [];
    const pushItem = (entry) => {
      if (!entry?.timestamp) return;
      const time = new Date(entry.timestamp).getTime();
      if (!Number.isFinite(time)) return;
      items.push({ ...entry, time });
    };
    const joinDetails = (parts) => parts.filter(Boolean).join(' · ');

    const orderLabel = record?.display_id ? `Order #${record.display_id}` : record?.id || '';
    pushItem({
      id: `order-${record.id}-created`,
      title: 'Order placed',
      detail: orderLabel || undefined,
      timestamp: record?.created_at
    });

    orderNotes.forEach((note, index) => {
      pushItem({
        id: note.id || `note-${index}`,
        title: 'Internal note',
        detail: note.text,
        timestamp: note.created_at
      });
    });

    orderChanges.forEach((change, index) => {
      if (!change) return;
      const type = change.change_type || 'change';
      const typeLabel =
        type === 'edit' ? 'Order edit' : type === 'transfer' ? 'Order transfer' : `Order ${type}`;
      const details = joinDetails([
        change.status ? `Status ${change.status}` : '',
        change.description || '',
        change.internal_note ? `Note: ${change.internal_note}` : ''
      ]);
      pushItem({
        id: change.id || `change-${index}`,
        title: typeLabel,
        detail: details || undefined,
        timestamp: change.created_at
      });
    });

    const creditLines = Array.isArray(record.credit_lines) ? record.credit_lines : [];
    creditLines.forEach((line, index) => {
      const amount = formatMoneyOrDash(
        line?.amount,
        line?.currency_code || record.currency_code || orderCurrency
      );
      const details = joinDetails([
        amount !== '-' ? `Amount ${amount}` : '',
        line?.reference || '',
        line?.reference_id ? `Ref ${line.reference_id}` : ''
      ]);
      pushItem({
        id: line?.id || `credit-${index}`,
        title: 'Credit line created',
        detail: details || undefined,
        timestamp: line?.created_at
      });
    });

    const transactions = Array.isArray(record.transactions) ? record.transactions : [];
    transactions.forEach((transaction, index) => {
      const label =
        transaction?.type ||
        transaction?.transaction_type ||
        transaction?.action ||
        'Transaction';
      const amount = formatMoneyOrDash(
        transaction?.amount,
        transaction?.currency_code || record.currency_code || orderCurrency
      );
      const details = joinDetails([
        amount !== '-' ? amount : '',
        transaction?.reference || transaction?.reference_id
          ? `Ref ${transaction.reference || transaction.reference_id}`
          : ''
      ]);
      pushItem({
        id: transaction?.id || `txn-${index}`,
        title: label,
        detail: details || undefined,
        timestamp: transaction?.created_at
      });
    });

    const fulfillments = Array.isArray(record.fulfillments) ? record.fulfillments : [];
    fulfillments.forEach((fulfillment, index) => {
      if (!fulfillment) return;
      const provider = fulfillment?.provider_id || fulfillment?.provider?.id || '';
      const providerDetail = provider ? `Provider ${provider}` : '';
      pushItem({
        id: fulfillment.id || `fulfillment-${index}`,
        title: 'Fulfillment created',
        detail: providerDetail || undefined,
        timestamp: fulfillment.created_at
      });
      if (fulfillment.shipped_at) {
        pushItem({
          id: `${fulfillment.id || `fulfillment-${index}`}-shipped`,
          title: 'Fulfillment shipped',
          detail: providerDetail || undefined,
          timestamp: fulfillment.shipped_at
        });
      }
      if (fulfillment.delivered_at) {
        pushItem({
          id: `${fulfillment.id || `fulfillment-${index}`}-delivered`,
          title: 'Fulfillment delivered',
          detail: providerDetail || undefined,
          timestamp: fulfillment.delivered_at
        });
      }
      if (fulfillment.canceled_at) {
        pushItem({
          id: `${fulfillment.id || `fulfillment-${index}`}-canceled`,
          title: 'Fulfillment canceled',
          detail: providerDetail || undefined,
          timestamp: fulfillment.canceled_at
        });
      }

      const shipments = Array.isArray(fulfillment.shipments) ? fulfillment.shipments : [];
      shipments.forEach((shipment, shipIndex) => {
        if (!shipment) return;
        const trackingNumbers = Array.isArray(shipment.tracking_numbers)
          ? shipment.tracking_numbers
          : shipment.tracking_number
            ? [shipment.tracking_number]
            : [];
        const shipmentDetail = trackingNumbers.length
          ? `Tracking ${trackingNumbers.join(', ')}`
          : '';
        pushItem({
          id: shipment.id || `${fulfillment.id || `fulfillment-${index}`}-ship-${shipIndex}`,
          title: 'Shipment created',
          detail: shipmentDetail || undefined,
          timestamp: shipment.created_at
        });
        if (shipment.delivered_at) {
          pushItem({
            id:
              (shipment.id || `${fulfillment.id || `fulfillment-${index}`}-ship-${shipIndex}`) +
              '-delivered',
            title: 'Shipment delivered',
            detail: shipmentDetail || undefined,
            timestamp: shipment.delivered_at
          });
        }
      });
    });

    orderReturns.forEach((orderReturn, index) => {
      if (!orderReturn) return;
      const detail = orderReturn.status ? `Status ${orderReturn.status}` : '';
      pushItem({
        id: orderReturn.id || `return-${index}`,
        title: 'Return created',
        detail: detail || undefined,
        timestamp: orderReturn.created_at
      });
      if (orderReturn.received_at) {
        pushItem({
          id: `${orderReturn.id || `return-${index}`}-received`,
          title: 'Return received',
          detail: detail || undefined,
          timestamp: orderReturn.received_at
        });
      }
      if (orderReturn.canceled_at) {
        pushItem({
          id: `${orderReturn.id || `return-${index}`}-canceled`,
          title: 'Return canceled',
          detail: detail || undefined,
          timestamp: orderReturn.canceled_at
        });
      }
    });

    orderExchanges.forEach((exchange, index) => {
      if (!exchange) return;
      const detail = exchange.status ? `Status ${exchange.status}` : '';
      pushItem({
        id: exchange.id || `exchange-${index}`,
        title: 'Exchange created',
        detail: detail || undefined,
        timestamp: exchange.created_at
      });
      if (exchange.canceled_at) {
        pushItem({
          id: `${exchange.id || `exchange-${index}`}-canceled`,
          title: 'Exchange canceled',
          detail: detail || undefined,
          timestamp: exchange.canceled_at
        });
      }
    });

    return items.sort((a, b) => b.time - a.time);
  }, [
    isOrder,
    record,
    orderNotes,
    orderChanges,
    orderReturns,
    orderExchanges,
    orderCurrency
  ]);

  const outboundShippingOptions = useMemo(() => {
    const options = Array.isArray(fulfillmentMeta.shippingOptions)
      ? fulfillmentMeta.shippingOptions
      : [];
    return options.filter((option) => {
      const rules = Array.isArray(option?.rules) ? option.rules : [];
      return !rules.some(
        (rule) => rule?.attribute === 'is_return' && String(rule?.value) === 'true'
      );
    });
  }, [fulfillmentMeta.shippingOptions]);

  const inboundShippingOptions = useMemo(() => {
    const options = Array.isArray(fulfillmentMeta.shippingOptions)
      ? fulfillmentMeta.shippingOptions
      : [];
    return options.filter((option) => {
      const rules = Array.isArray(option?.rules) ? option.rules : [];
      return rules.some(
        (rule) => rule?.attribute === 'is_return' && String(rule?.value) === 'true'
      );
    });
  }, [fulfillmentMeta.shippingOptions]);

  const orderDetailParams = useMemo(
    () =>
      isOrder
        ? {
            fields:
              '+fulfillments,+fulfillments.shipments,+fulfillments.tracking_links,+fulfillments.labels,+transactions,+credit_lines'
          }
        : undefined,
    [isOrder]
  );

  const orderEditChanges = useMemo(() => {
    if (!orderChanges.length) return [];
    const edits = orderChanges.filter((change) => change?.change_type === 'edit');
    return edits.sort((a, b) => {
      const aTime = new Date(a?.created_at || 0).getTime();
      const bTime = new Date(b?.created_at || 0).getTime();
      return bTime - aTime;
    });
  }, [orderChanges]);

  const orderTransferChanges = useMemo(() => {
    if (!orderChanges.length) return [];
    const transfers = orderChanges.filter((change) => change?.change_type === 'transfer');
    return transfers.sort((a, b) => {
      const aTime = new Date(a?.created_at || 0).getTime();
      const bTime = new Date(b?.created_at || 0).getTime();
      return bTime - aTime;
    });
  }, [orderChanges]);

  const orderTransferActiveChange = useMemo(
    () =>
      orderTransferChanges.find(
        (change) =>
          !change?.confirmed_at && !change?.declined_at && !change?.canceled_at
      ) || null,
    [orderTransferChanges]
  );

  const orderTransferLastChange = orderTransferChanges[0] || null;
  const orderTransferChange = orderTransferActiveChange || orderTransferLastChange;
  const orderTransferAction = Array.isArray(orderTransferChange?.actions)
    ? orderTransferChange.actions[0]
    : null;
  const orderTransferTargetId =
    orderTransferAction?.reference_id ||
    orderTransferAction?.details?.reference_id ||
    orderTransferAction?.reference ||
    '';
  const orderTransferOriginalEmail = orderTransferAction?.details?.original_email || '';

  const orderEditActiveChange = useMemo(
    () =>
      orderEditChanges.find((change) =>
        ['pending', 'requested'].includes(normalizeStatus(change?.status))
      ) || null,
    [orderEditChanges]
  );

  const orderEditChange = orderEditActiveChange;
  const orderEditLastChange = orderEditChanges[0] || null;
  const orderEditStatus = normalizeStatus(orderEditChange?.status);
  const orderEditActive = Boolean(orderEditChange);
  const orderEditActions = useMemo(
    () =>
      Array.isArray(orderEditChange?.actions)
        ? orderEditChange.actions.filter(Boolean)
        : [],
    [orderEditChange]
  );
  const orderEditItemUpdateMap = useMemo(() => {
    const map = {};
    orderEditActions.forEach((action) => {
      if (action?.action !== 'ITEM_UPDATE') return;
      const referenceId =
        action?.details?.reference_id || action?.reference_id || action?.reference;
      if (!referenceId) return;
      map[referenceId] = action;
    });
    return map;
  }, [orderEditActions]);
  const orderEditAddActions = useMemo(
    () => orderEditActions.filter((action) => action?.action === 'ITEM_ADD'),
    [orderEditActions]
  );
  const orderEditShippingActions = useMemo(
    () => orderEditActions.filter((action) => action?.action === 'SHIPPING_ADD'),
    [orderEditActions]
  );
  const draftOrderAddedShippingIds = useMemo(() => {
    const ids = new Set();
    orderEditShippingActions.forEach((action) => {
      const referenceId =
        action?.reference_id || action?.details?.reference_id || action?.reference;
      if (referenceId) ids.add(referenceId);
    });
    return ids;
  }, [orderEditShippingActions]);
  const draftOrderShippingMethods = useMemo(() => {
    if (!isDraftOrder) return [];
    const methods =
      Array.isArray(orderPreview?.shipping_methods) && orderPreview.shipping_methods.length
        ? orderPreview.shipping_methods
        : record?.shipping_methods;
    return Array.isArray(methods) ? methods : [];
  }, [isDraftOrder, orderPreview?.shipping_methods, record?.shipping_methods]);
  const draftOrderExistingShippingMethods = useMemo(
    () =>
      draftOrderShippingMethods.filter(
        (method) => method?.id && !draftOrderAddedShippingIds.has(method.id)
      ),
    [draftOrderShippingMethods, draftOrderAddedShippingIds]
  );
  const draftOrderPromotionCodes = useMemo(() => {
    if (!isDraftOrder) return [];
    const promotions = orderPreview?.promotions || record?.promotions || [];
    return extractPromotionCodes(promotions);
  }, [isDraftOrder, orderPreview?.promotions, record?.promotions]);
  const returnReasonParentOptions = useMemo(() => {
    if (!isReturnReason) return [];
    const options = returnReasons.filter((reason) => reason?.id && reason.id !== record?.id);
    const currentParentId = returnReasonDraft.parent_return_reason_id;
    if (currentParentId && !options.some((reason) => reason.id === currentParentId)) {
      options.unshift({
        id: currentParentId,
        label:
          record?.parent_return_reason?.label ||
          record?.parent_return_reason?.value ||
          currentParentId,
        value: record?.parent_return_reason?.value
      });
    }
    return options;
  }, [isReturnReason, returnReasons, record, returnReasonDraft.parent_return_reason_id]);

  const stockLocationFulfillmentSets = useMemo(
    () => (Array.isArray(record?.fulfillment_sets) ? record.fulfillment_sets : []),
    [record?.fulfillment_sets]
  );
  const stockLocationSalesChannels = useMemo(
    () => (Array.isArray(record?.sales_channels) ? record.sales_channels : []),
    [record?.sales_channels]
  );
  const stockLocationFulfillmentProviders = useMemo(
    () => (Array.isArray(record?.fulfillment_providers) ? record.fulfillment_providers : []),
    [record?.fulfillment_providers]
  );
  const availableStockLocationSalesChannels = useMemo(() => {
    const assigned = new Set(stockLocationSalesChannels.map((channel) => channel?.id).filter(Boolean));
    return (stockLocationMeta.salesChannels || []).filter((channel) => channel?.id && !assigned.has(channel.id));
  }, [stockLocationMeta.salesChannels, stockLocationSalesChannels]);
  const availableStockLocationProviders = useMemo(() => {
    const assigned = new Set(
      stockLocationFulfillmentProviders.map((provider) => provider?.id).filter(Boolean)
    );
    return (stockLocationMeta.fulfillmentProviders || []).filter(
      (provider) => provider?.id && !assigned.has(provider.id)
    );
  }, [stockLocationMeta.fulfillmentProviders, stockLocationFulfillmentProviders]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        if (resource?.id === 'product-variants') {
          const payload = await getList(resource.endpoint, {
            id,
            limit: 1,
            fields: '+inventory_quantity'
          });
          const variants = getArrayFromPayload(payload, resource.listKey);
          setRecord(variants?.[0] || null);
        } else {
          const detailParams = isProduct
            ? { fields: '+categories,+images,+shipping_profile_id,+shipping_profile' }
            : isOrder
              ? orderDetailParams
            : isPriceList
              ? { fields: '+prices,+prices.variant,+prices.variant.product' }
              : isCustomer
                  ? { fields: '+groups' }
                  : isCustomerGroup
                      ? { fields: '+customers' }
                      : isGiftCard
                        ? { fields: '+region' }
                      : isInventoryItem
                        ? { fields: '+location_levels' }
                        : isStockLocation
                        ? {
                            fields:
                              '+address,+sales_channels,+fulfillment_providers,+fulfillment_sets,+fulfillment_sets.service_zones,+fulfillment_sets.service_zones.geo_zones'
                          }
                        : undefined;
          const payload = await getDetail(resource.endpoint, id, detailParams);
          setRecord(getObjectFromPayload(payload, resource.detailKey));
        }
    } catch (err) {
      setError(formatApiError(err, 'Unable to load details.'));
      setRecord(null);
    } finally {
      setLoading(false);
    }
    };

    load();
  }, [
    resource,
    id,
    isProduct,
    isOrder,
    isPriceList,
    isCustomer,
    isCustomerGroup,
    isGiftCard,
    isCollection,
    isCategory,
    isInventoryItem,
    isStockLocation,
    isUser,
    isInvite,
    isApiKey,
    isStore,
    isSalesChannel,
    isReturnReason,
    isRefundReason,
    orderDetailParams
  ]);

  useEffect(() => {
    if (!record) return;
    if (isOrderLike) {
      setOrderDetailDraft({
        email: record?.email || record?.customer?.email || '',
        locale: record?.locale || '',
        metadata: formatJsonValue(record?.metadata),
        shipping_address: buildAddressDraft(record?.shipping_address || {}),
        billing_address: buildAddressDraft(record?.billing_address || {})
      });
      setOrderDetailState({ saving: false, error: '', success: '' });
    }
    if (isOrder) {
      setOrderTransferDraft({ customer_id: '', description: '', internal_note: '' });
      setOrderTransferSearch({ query: '', results: [], loading: false, error: '' });
      setOrderTransferState({ saving: false, canceling: false, error: '', success: '' });
      setOrderTransferTarget(null);
      setOrderTransferTargetState({ loading: false, error: '' });
      setOrderArchiveState({ saving: false, error: '', success: '' });
      setOrderCreditDraft({
        amount: '',
        reference: 'refund',
        reference_id: record?.id || '',
        metadata: '',
        is_credit: true
      });
      setOrderCreditState({ saving: false, error: '', success: '' });
      setOrderNoteDraft('');
      setOrderNoteState({ saving: false, error: '', success: '' });
    }
    if (isRegion) {
      setRegionDraft({
        name: record?.name || '',
        currency_code: record?.currency_code || '',
        countries: extractCountryCodes(record?.countries).join(', '),
        payment_providers: extractIdList(record?.payment_providers).join(', '),
        automatic_taxes: Boolean(record?.automatic_taxes),
        is_tax_inclusive: Boolean(record?.is_tax_inclusive),
        metadata: formatJsonValue(record?.metadata)
      });
    }
    if (isShippingProfile) {
      setShippingProfileDraft({
        name: record?.name || '',
        type: record?.type || '',
        metadata: formatJsonValue(record?.metadata)
      });
    }
    if (isShippingOption) {
      const prices = Array.isArray(record?.prices) ? record.prices : [];
      const priceDrafts = prices.length
        ? prices.map((price) => ({
            id: price?.id || '',
            amount: formatPriceInput(price?.amount),
            currency_code: price?.currency_code || '',
            region_id: price?.region_id || price?.region?.id || ''
          }))
        : [{ amount: '', currency_code: '', region_id: '' }];
      const type = record?.type || {};
      setShippingOptionDraft({
        name: record?.name || '',
        price_type: record?.price_type || 'flat',
        service_zone_id: record?.service_zone_id || record?.service_zone?.id || '',
        shipping_profile_id: record?.shipping_profile_id || record?.shipping_profile?.id || '',
        provider_id: record?.provider_id || record?.provider?.id || '',
        prices: priceDrafts,
        type_id: record?.shipping_option_type_id || record?.type?.id || '',
        type_label: type.label || '',
        type_code: type.code || '',
        type_description: type.description || '',
        data: formatJsonValue(record?.data),
        metadata: formatJsonValue(record?.metadata),
        enabled_in_store: getRuleBoolean(record?.rules, 'enabled_in_store', true),
        is_return: getRuleBoolean(record?.rules, 'is_return', false)
      });
    }
    if (isTaxRegion) {
      setTaxRegionDraft({
        country_code: record?.country_code || '',
        province_code: record?.province_code || '',
        provider_id: record?.provider_id || record?.provider?.id || '',
        parent_id: record?.parent_id || record?.parent?.id || '',
        metadata: formatJsonValue(record?.metadata)
      });
    }
    if (isTaxRate) {
      const rules = Array.isArray(record?.rules) ? record.rules : [];
      setTaxRateDraft({
        name: record?.name || '',
        code: record?.code || '',
        rate: record?.rate != null ? String(record.rate) : '',
        tax_region_id: record?.tax_region_id || record?.tax_region?.id || '',
        is_default: Boolean(record?.is_default),
        is_combinable: Boolean(record?.is_combinable),
        metadata: formatJsonValue(record?.metadata)
      });
      const nextRuleDraft = {
        product_ids: extractTaxRateRuleValues(rules, 'product'),
        product_type_ids: extractTaxRateRuleValues(rules, 'product_type'),
        product_collection_ids: extractTaxRateRuleValues(rules, 'product_collection'),
        product_tag_ids: extractTaxRateRuleValues(rules, 'product_tag'),
        product_category_ids: extractTaxRateRuleValues(rules, 'product_category'),
        shipping_option_ids: extractTaxRateRuleValues(rules, 'shipping_option')
      };
      setTaxRateRuleDraft(nextRuleDraft);
      setTaxRateSelectedProducts((prev) =>
        nextRuleDraft.product_ids.map((id) => prev.find((item) => item.id === id) || { id })
      );
    }
    if (isReturnReason) {
      setReturnReasonDraft({
        value: record?.value || '',
        label: record?.label || '',
        description: record?.description || '',
        parent_return_reason_id:
          record?.parent_return_reason_id || record?.parent_return_reason?.id || '',
        metadata: formatJsonValue(record?.metadata)
      });
    }
    if (isRefundReason) {
      setRefundReasonDraft({
        label: record?.label || '',
        code: record?.code || '',
        description: record?.description || ''
      });
    }
    if (isPromotion) {
      const applicationMethod = record?.application_method || record?.applicationMethod || {};
      setPromotionDraft({
        code: record?.code || '',
        description: record?.description || '',
        status: record?.status || '',
        starts_at: formatDateTimeInput(record?.starts_at),
        ends_at: formatDateTimeInput(record?.ends_at),
        is_automatic: Boolean(record?.is_automatic),
        campaign_id: record?.campaign_id || record?.campaign?.id || '',
        type: record?.type || 'standard',
        application_method_type: applicationMethod?.type || '',
        application_method_value:
          applicationMethod?.value != null ? String(applicationMethod.value) : '',
        application_method_currency: applicationMethod?.currency_code || '',
        application_method_target: applicationMethod?.target_type || 'items',
        application_method_allocation: applicationMethod?.allocation || 'across',
        extra: ''
      });
    }
    if (isCampaign) {
      setCampaignDraft({
        name: record?.name || '',
        description: record?.description || '',
        starts_at: formatDateTimeInput(record?.starts_at),
        ends_at: formatDateTimeInput(record?.ends_at),
        extra: ''
      });
    }
    if (isPriceList) {
      setPriceListDraft({
        title: record?.title || '',
        description: record?.description || '',
        status: record?.status || 'draft',
        type: record?.type || 'sale',
        starts_at: formatDateTimeInput(record?.starts_at),
        ends_at: formatDateTimeInput(record?.ends_at),
        extra: ''
      });
      const rules = record?.rules || [];
      const nextRuleDraft = {
        customer_group_ids: extractRuleValues(rules, 'customer_group_id'),
        product_ids: extractRuleValues(rules, 'product_id'),
        collection_ids: extractRuleValues(rules, 'product_collection_id'),
        category_ids: extractRuleValues(rules, 'product_category_id'),
        tag_ids: extractRuleValues(rules, 'product_tag_id'),
        type_ids: extractRuleValues(rules, 'product_type_id')
      };
      setPriceListRuleDraft(nextRuleDraft);
      setPriceListSelectedProducts((prev) =>
        nextRuleDraft.product_ids.map((id) => prev.find((item) => item.id === id) || { id })
      );
    }
    if (isCustomer) {
      const metadata = record?.metadata && typeof record.metadata === 'object' ? record.metadata : {};
      const note = metadata?.note || metadata?.notes || '';
      setCustomerDraft({
        email: record?.email || '',
        first_name: record?.first_name || '',
        last_name: record?.last_name || '',
        company_name: record?.company_name || '',
        phone: record?.phone || '',
        note: String(note || ''),
        metadata: formatJsonValue(record?.metadata)
      });
      const groupIds = Array.isArray(record?.groups)
        ? record.groups.map((group) => group?.id).filter(Boolean)
        : [];
      setCustomerGroupMembership({ initial: groupIds, selected: groupIds });
    }
    if (isCustomerGroup) {
      const metadata = record?.metadata && typeof record.metadata === 'object' ? record.metadata : {};
      const note = metadata?.note || metadata?.notes || '';
      setCustomerGroupDraft({
        name: record?.name || '',
        note: String(note || ''),
        metadata: formatJsonValue(record?.metadata)
      });
      const customerIds = Array.isArray(record?.customers)
        ? record.customers.map((customer) => customer?.id).filter(Boolean)
        : [];
      setGroupCustomerMembership({ initial: customerIds, selected: customerIds });
      setGroupCustomerSelected((prev) =>
        customerIds.map((id) => {
          const existing = prev.find((item) => item.id === id);
          const recordCustomer =
            Array.isArray(record?.customers) && record.customers.find((customer) => customer?.id === id);
          return existing || recordCustomer || { id };
        })
      );
    }
    if (isCollection) {
      const metadata = record?.metadata && typeof record.metadata === 'object' ? record.metadata : {};
      setCollectionDraft({
        title: record?.title || '',
        handle: record?.handle || '',
        description: record?.description || '',
        thumbnail: metadata?.thumbnail || metadata?.image || '',
        metadata: formatJsonValue(record?.metadata)
      });
      setCollectionSelection({ search: [], assigned: [] });
      setCollectionBulkState({ saving: false, error: '', success: '' });
      setCollectionUploadState({ uploading: false, error: '', success: '' });
    }
    if (isCategory) {
      const metadata = record?.metadata && typeof record.metadata === 'object' ? record.metadata : {};
      setCategoryDraft({
        name: record?.name || '',
        handle: record?.handle || '',
        description: record?.description || '',
        is_active: record?.is_active !== false,
        is_internal: Boolean(record?.is_internal),
        parent_category_id: record?.parent_category_id || record?.parent_category?.id || '',
        thumbnail: metadata?.thumbnail || metadata?.image || '',
        metadata: formatJsonValue(record?.metadata)
      });
      setCategorySelection({ search: [], assigned: [] });
      setCategoryBulkState({ saving: false, error: '', success: '' });
      setCategoryUploadState({ uploading: false, error: '', success: '' });
    }
    if (isProductType) {
      setProductTypeDraft({
        value: record?.value || '',
        metadata: formatJsonValue(record?.metadata)
      });
      setProductTypeSelection({ search: [], assigned: [] });
      setProductTypeBulkState({ saving: false, error: '', success: '' });
      setProductTypeProductState({ savingId: null, error: '', success: '' });
    }
    if (isProductTag) {
      setProductTagDraft({
        value: record?.value || '',
        metadata: formatJsonValue(record?.metadata)
      });
      setProductTagSelection({ search: [], assigned: [] });
      setProductTagBulkState({ saving: false, error: '', success: '' });
      setProductTagProductState({ savingId: null, error: '', success: '' });
    }
    if (isGiftCard) {
      setGiftCardDraft({
        ends_at: formatDateTimeInput(record?.ends_at || record?.expires_at),
        is_disabled: Boolean(record?.is_disabled || record?.disabled_at),
        metadata: formatJsonValue(record?.metadata)
      });
      setGiftCardState({ saving: false, deleting: false, error: '', success: '' });
    }
    if (isUser) {
      setUserDraft({
        email: record?.email || '',
        role: resolveRoleValue(record),
        first_name: record?.first_name || '',
        last_name: record?.last_name || '',
        avatar_url: record?.avatar_url || '',
        metadata: formatJsonValue(record?.metadata)
      });
    }
    if (isInvite) {
      setInviteState({ deleting: false, error: '', success: '' });
    }
    if (isApiKey) {
      setApiKeyDraft({
        title: record?.title || '',
        revoke_in: ''
      });
    }
    if (isStore) {
      setStoreDraft({
        name: record?.name || '',
        supported_currencies: mapStoreCurrencies(record?.supported_currencies),
        supported_locales: mapStoreLocales(record?.supported_locales),
        default_sales_channel_id:
          record?.default_sales_channel_id || record?.default_sales_channel?.id || '',
        default_region_id: record?.default_region_id || record?.default_region?.id || '',
        default_location_id: record?.default_location_id || record?.default_location?.id || '',
        metadata: formatJsonValue(record?.metadata)
      });
    }
    if (isSalesChannel) {
      setSalesChannelDraft({
        name: record?.name || '',
        description: record?.description || '',
        is_disabled: Boolean(record?.is_disabled),
        metadata: formatJsonValue(record?.metadata)
      });
      setSalesChannelSelection({ search: [], assigned: [] });
      setSalesChannelBulkState({ saving: false, error: '', success: '' });
    }
    if (isInventoryItem) {
      setInventoryItemDraft(mapInventoryItemToDraft(record));
      setInventoryLevelDraft({ location_id: '', stocked_quantity: '', incoming_quantity: '' });
    }
    if (isStockLocation) {
      const address = record?.address || {};
      setStockLocationDraft({
        name: record?.name || '',
        address_1: address?.address_1 || '',
        address_2: address?.address_2 || '',
        city: address?.city || '',
        province: address?.province || '',
        postal_code: address?.postal_code || '',
        country_code: address?.country_code || '',
        phone: address?.phone || '',
        metadata: formatJsonValue(record?.metadata)
      });
    }
  }, [
    record,
    isOrderLike,
    isOrder,
    isRegion,
    isShippingProfile,
    isShippingOption,
    isTaxRegion,
    isTaxRate,
    isPromotion,
    isCampaign,
    isPriceList,
    isCustomer,
    isCustomerGroup,
    isCollection,
    isCategory,
    isProductType,
    isProductTag,
    isGiftCard,
    isUser,
    isInvite,
    isApiKey,
    isStore,
    isSalesChannel,
    isReturnReason,
    isRefundReason,
    isInventoryItem,
    isStockLocation
  ]);

  useEffect(() => {
    if (!isProduct || !record) {
      setProductDraft(null);
      setOptionDrafts([]);
      setVariantDrafts([]);
      setNewVariant(null);
      setProductUploadState({ uploading: false, error: '', success: '' });
      return;
    }
    setProductDraft(mapRecordToDraft(record));
    setOptionDrafts(buildOptionDrafts(record));
    setVariantDrafts(buildVariantDrafts(record));
    setNewVariant(buildNewVariantDraft(record, getDefaultCurrency(record)));
    setProductUploadState({ uploading: false, error: '', success: '' });
  }, [isProduct, record]);

  useEffect(() => {
    if (!isVariant || !record) {
      setVariantDrafts([]);
      setVariantUploadState({ uploadingId: null, error: '', success: '' });
      return;
    }
    const productOptions = variantProduct?.options || record?.product?.options || [];
    setVariantDrafts([buildVariantDrafts({ variants: [record], options: productOptions })[0]]);
    setNewVariant(buildNewVariantDraft({ options: productOptions }, getDefaultCurrency(record)));
    setVariantUploadState({ uploadingId: null, error: '', success: '' });
  }, [isVariant, record, variantProduct]);

  useEffect(() => {
    if (!isVariant) {
      setVariantProduct(null);
      setVariantProductError('');
      return;
    }
    const productId = record?.product_id || record?.product?.id;
    if (!productId) {
      setVariantProduct(null);
      setVariantProductError('Product data unavailable for this variant.');
      return;
    }
    if (Array.isArray(record?.product?.options)) {
      setVariantProduct(record.product);
      setVariantProductError('');
      return;
    }

    let isActive = true;
    const loadVariantProduct = async () => {
      setVariantProductError('');
      try {
        const payload = await getDetail('/admin/products', productId, {
          fields: '+options,+options.values'
        });
        if (!isActive) return;
        const product = getObjectFromPayload(payload, 'product');
        setVariantProduct(product || record?.product || null);
      } catch (err) {
        if (!isActive) return;
        setVariantProduct(record?.product || null);
        setVariantProductError(err?.message || 'Unable to load product options.');
      }
    };

    loadVariantProduct();

    return () => {
      isActive = false;
    };
  }, [isVariant, record?.product_id, record?.product?.id]);

  useEffect(() => {
    if (!isProduct) return;
    let isActive = true;

    const loadMeta = async () => {
      setMetaLoading(true);
      setMetaError('');
      try {
        const results = await Promise.allSettled([
          getList('/admin/collections', { limit: 200 }),
          getList('/admin/product-categories', { limit: 200 }),
          getList('/admin/sales-channels', { limit: 200 }),
          getList('/admin/product-types', { limit: 200 }),
          getList('/admin/product-tags', { limit: 200 }),
          getList('/admin/shipping-profiles', { limit: 200 })
        ]);

        if (!isActive) return;

        const [
          collectionsResult,
          categoriesResult,
          salesChannelsResult,
          typesResult,
          tagsResult,
          shippingProfilesResult
        ] = results;

        const collectionsPayload =
          collectionsResult.status === 'fulfilled' ? collectionsResult.value : null;
        const categoriesPayload =
          categoriesResult.status === 'fulfilled' ? categoriesResult.value : null;
        const salesChannelsPayload =
          salesChannelsResult.status === 'fulfilled' ? salesChannelsResult.value : null;
        const typesPayload = typesResult.status === 'fulfilled' ? typesResult.value : null;
        const tagsPayload = tagsResult.status === 'fulfilled' ? tagsResult.value : null;
        const shippingProfilesPayload =
          shippingProfilesResult.status === 'fulfilled' ? shippingProfilesResult.value : null;

        setProductMeta({
          collections: sortByLabel(
            getArrayFromPayload(collectionsPayload, 'collections'),
            (item) => item?.title || item?.handle || item?.id
          ),
          categories: sortByLabel(
            getArrayFromPayload(categoriesPayload, 'product_categories'),
            (item) => item?.name || item?.handle || item?.id
          ),
          salesChannels: sortByLabel(
            getArrayFromPayload(salesChannelsPayload, 'sales_channels'),
            (item) => item?.name || item?.id
          ),
          types: sortByLabel(
            getArrayFromPayload(typesPayload, 'product_types'),
            (item) => item?.value || item?.name || item?.id
          ),
          tags: sortByLabel(
            getArrayFromPayload(tagsPayload, 'product_tags'),
            (item) => item?.value || item?.id
          ),
          shippingProfiles: sortByLabel(
            getArrayFromPayload(shippingProfilesPayload, 'shipping_profiles'),
            (item) => item?.name || item?.id
          )
        });

        const failedCount = results.filter((result) => result.status === 'rejected').length;
        if (failedCount) {
          setMetaError('Some product metadata failed to load.');
        }
      } catch (err) {
        if (!isActive) return;
        setMetaError(err?.message || 'Unable to load product metadata.');
      } finally {
        if (isActive) setMetaLoading(false);
      }
    };

    loadMeta();

    return () => {
      isActive = false;
    };
  }, [isProduct]);

  useEffect(() => {
    if (!isOpsConfig) {
      setOpsMeta({
        paymentProviders: [],
        fulfillmentProviders: [],
        shippingProfiles: [],
        serviceZones: [],
        regions: [],
        taxProviders: [],
        taxRegions: []
      });
      setOpsMetaLoading(false);
      setOpsMetaError('');
      setOpsMetaFailures([]);
      return;
    }
    let isActive = true;

    const loadOpsMeta = async () => {
      setOpsMetaLoading(true);
      setOpsMetaError('');
      setOpsMetaFailures([]);
      const tasks = [];

      if (isRegion) {
        tasks.push({
          key: 'paymentProviders',
          promise: getList('/admin/payments/payment-providers', { limit: 200 })
        });
      }
      if (isShippingOption) {
        tasks.push({
          key: 'fulfillmentProviders',
          promise: getList('/admin/fulfillment-providers', { limit: 200 })
        });
        tasks.push({
          key: 'shippingProfiles',
          promise: getList('/admin/shipping-profiles', { limit: 200 })
        });
        tasks.push({
          key: 'regions',
          promise: getList('/admin/regions', { limit: 200 })
        });
        tasks.push({
          key: 'serviceZones',
          promise: getList('/admin/stock-locations', {
            limit: 200,
            fields: '+fulfillment_sets,+fulfillment_sets.service_zones'
          })
        });
      }
      if (isTaxRegion) {
        tasks.push({ key: 'taxProviders', promise: getList('/admin/tax-providers', { limit: 200 }) });
      }
      if (isTaxRate || isTaxRegion) {
        tasks.push({ key: 'taxRegions', promise: getList('/admin/tax-regions', { limit: 200 }) });
      }

      if (!tasks.length) {
        if (isActive) setOpsMetaLoading(false);
        return;
      }

      const results = await Promise.allSettled(tasks.map((task) => task.promise));
      if (!isActive) return;

      const nextMeta = {
        paymentProviders: [],
        fulfillmentProviders: [],
        shippingProfiles: [],
        serviceZones: [],
        regions: [],
        taxProviders: [],
        taxRegions: []
      };
      let failedCount = 0;
      const failureMessages = [];

      results.forEach((result, index) => {
        const task = tasks[index];
        if (result.status !== 'fulfilled') {
          failedCount += 1;
          const label = OPS_META_LABELS[task.key] || task.key;
          failureMessages.push(`${label}: ${formatApiError(result.reason, 'Unable to load.')}`);
          return;
        }
        const payload = result.value;
        switch (task.key) {
          case 'paymentProviders':
            nextMeta.paymentProviders = getArrayFromPayload(payload, 'payment_providers');
            break;
          case 'fulfillmentProviders':
            nextMeta.fulfillmentProviders = getArrayFromPayload(payload, 'fulfillment_providers');
            break;
          case 'shippingProfiles':
            nextMeta.shippingProfiles = sortByLabel(
              getArrayFromPayload(payload, 'shipping_profiles'),
              (profile) => profile?.name || profile?.id
            );
            break;
          case 'regions':
            nextMeta.regions = sortByLabel(
              getArrayFromPayload(payload, 'regions'),
              (region) => region?.name || region?.id
            );
            break;
          case 'taxProviders':
            nextMeta.taxProviders = getArrayFromPayload(payload, 'tax_providers');
            break;
          case 'taxRegions':
            nextMeta.taxRegions = getArrayFromPayload(payload, 'tax_regions');
            break;
          case 'serviceZones': {
            nextMeta.serviceZones = extractServiceZones(payload);
            break;
          }
          default:
            break;
        }
      });

      setOpsMeta(nextMeta);
      if (failedCount) {
        setOpsMetaError('Some settings failed to load.');
      }
      setOpsMetaFailures(failureMessages);
      setOpsMetaLoading(false);
    };

    loadOpsMeta();

    return () => {
      isActive = false;
    };
  }, [isOpsConfig, isRegion, isShippingOption, isTaxRegion, isTaxRate]);

  useEffect(() => {
    if (!isMerchConfig || !isPromotion) {
      setMerchMeta({ campaigns: [] });
      setMerchMetaLoading(false);
      setMerchMetaError('');
      return;
    }
    let isActive = true;

    const loadMerchMeta = async () => {
      setMerchMetaLoading(true);
      setMerchMetaError('');
      try {
        const payload = await getList('/admin/campaigns', { limit: 200 });
        if (!isActive) return;
        setMerchMeta({
          campaigns: sortByLabel(
            getArrayFromPayload(payload, 'campaigns'),
            (campaign) => campaign?.name || campaign?.id
          )
        });
      } catch (err) {
        if (!isActive) return;
        setMerchMeta({ campaigns: [] });
        setMerchMetaError(err?.message || 'Unable to load campaigns.');
      } finally {
        if (isActive) setMerchMetaLoading(false);
      }
    };

    loadMerchMeta();

    return () => {
      isActive = false;
    };
  }, [isMerchConfig, isPromotion]);

  useEffect(() => {
    if (!isPriceList) {
      setPriceListRuleMeta({
        customerGroups: [],
        collections: [],
        categories: [],
        tags: [],
        types: []
      });
      setPriceListRuleMetaLoading(false);
      setPriceListRuleMetaError('');
      return;
    }
    let isActive = true;

    const loadPriceListMeta = async () => {
      setPriceListRuleMetaLoading(true);
      setPriceListRuleMetaError('');
      const results = await Promise.allSettled([
        getList('/admin/customer-groups', { limit: 200 }),
        getList('/admin/collections', { limit: 200 }),
        getList('/admin/product-categories', { limit: 200 }),
        getList('/admin/product-tags', { limit: 200 }),
        getList('/admin/product-types', { limit: 200 })
      ]);

      if (!isActive) return;

      const [
        customerGroupsResult,
        collectionsResult,
        categoriesResult,
        tagsResult,
        typesResult
      ] = results;

      const customerGroupsPayload =
        customerGroupsResult.status === 'fulfilled' ? customerGroupsResult.value : null;
      const collectionsPayload =
        collectionsResult.status === 'fulfilled' ? collectionsResult.value : null;
      const categoriesPayload =
        categoriesResult.status === 'fulfilled' ? categoriesResult.value : null;
      const tagsPayload = tagsResult.status === 'fulfilled' ? tagsResult.value : null;
      const typesPayload = typesResult.status === 'fulfilled' ? typesResult.value : null;

      setPriceListRuleMeta({
        customerGroups: sortByLabel(
          getArrayFromPayload(customerGroupsPayload, 'customer_groups'),
          (group) => group?.name || group?.id
        ),
        collections: sortByLabel(
          getArrayFromPayload(collectionsPayload, 'collections'),
          (collection) => collection?.title || collection?.handle || collection?.id
        ),
        categories: sortByLabel(
          getArrayFromPayload(categoriesPayload, 'product_categories'),
          (category) => category?.name || category?.handle || category?.id
        ),
        tags: sortByLabel(
          getArrayFromPayload(tagsPayload, 'product_tags'),
          (tag) => tag?.value || tag?.id
        ),
        types: sortByLabel(
          getArrayFromPayload(typesPayload, 'product_types'),
          (type) => type?.value || type?.name || type?.id
        )
      });

      const failedCount = results.filter((result) => result.status === 'rejected').length;
      if (failedCount) {
        setPriceListRuleMetaError('Some price list conditions failed to load.');
      }
      setPriceListRuleMetaLoading(false);
    };

    loadPriceListMeta();

    return () => {
      isActive = false;
    };
  }, [isPriceList]);

  useEffect(() => {
    if (!isInventoryItem) {
      setInventoryMeta({ locations: [] });
      setInventoryMetaLoading(false);
      setInventoryMetaError('');
      return;
    }
    let isActive = true;

    const loadInventoryMeta = async () => {
      setInventoryMetaLoading(true);
      setInventoryMetaError('');
      try {
        const payload = await getList('/admin/stock-locations', { limit: 200 });
        if (!isActive) return;
        setInventoryMeta({
          locations: sortByLabel(
            getArrayFromPayload(payload, 'stock_locations'),
            (location) => location?.name || location?.id
          )
        });
      } catch (err) {
        if (!isActive) return;
        setInventoryMeta({ locations: [] });
        setInventoryMetaError(err?.message || 'Unable to load stock locations.');
      } finally {
        if (isActive) setInventoryMetaLoading(false);
      }
    };

    loadInventoryMeta();

    return () => {
      isActive = false;
    };
  }, [isInventoryItem]);

  useEffect(() => {
    if (!isStockLocation) {
      setStockLocationMeta({ salesChannels: [], fulfillmentProviders: [] });
      setStockLocationMetaLoading(false);
      setStockLocationMetaError('');
      return;
    }
    let isActive = true;

    const loadStockLocationMeta = async () => {
      setStockLocationMetaLoading(true);
      setStockLocationMetaError('');
      const results = await Promise.allSettled([
        getList('/admin/sales-channels', { limit: 200 }),
        getList('/admin/fulfillment-providers', { limit: 200 })
      ]);

      if (!isActive) return;

      const [salesChannelsResult, fulfillmentProvidersResult] = results;

      const salesChannelsPayload =
        salesChannelsResult.status === 'fulfilled' ? salesChannelsResult.value : null;
      const fulfillmentProvidersPayload =
        fulfillmentProvidersResult.status === 'fulfilled' ? fulfillmentProvidersResult.value : null;

      setStockLocationMeta({
        salesChannels: sortByLabel(
          getArrayFromPayload(salesChannelsPayload, 'sales_channels'),
          (channel) => channel?.name || channel?.id
        ),
        fulfillmentProviders: sortByLabel(
          getArrayFromPayload(fulfillmentProvidersPayload, 'fulfillment_providers'),
          (provider) => provider?.id
        )
      });

      const failedCount = results.filter((result) => result.status === 'rejected').length;
      if (failedCount) {
        setStockLocationMetaError('Some location settings failed to load.');
      }
      setStockLocationMetaLoading(false);
    };

    loadStockLocationMeta();

    return () => {
      isActive = false;
    };
  }, [isStockLocation]);

  useEffect(() => {
    if (!isStockLocation || !record?.id) {
      setStockLocationInventoryState({
        items: [],
        count: 0,
        loading: false,
        error: ''
      });
      return;
    }
    refreshStockLocationInventory(stockLocationInventorySearch);
  }, [isStockLocation, record?.id, stockLocationInventorySearch]);

  useEffect(() => {
    if (!isStockLocation) {
      setStockLocationInventoryQuery((prev) => (prev ? '' : prev));
      setStockLocationInventorySearch((prev) => (prev ? '' : prev));
      return;
    }
    setStockLocationInventoryQuery((prev) => (prev ? '' : prev));
    setStockLocationInventorySearch((prev) => (prev ? '' : prev));
  }, [isStockLocation, record?.id]);

  useEffect(() => {
    if (!isStore) {
      setStoreMeta({ salesChannels: [], regions: [], locations: [] });
      setStoreMetaLoading(false);
      setStoreMetaError('');
      return;
    }
    let isActive = true;

    const loadStoreMeta = async () => {
      setStoreMetaLoading(true);
      setStoreMetaError('');
      const results = await Promise.allSettled([
        getList('/admin/sales-channels', { limit: 200 }),
        getList('/admin/regions', { limit: 200 }),
        getList('/admin/stock-locations', { limit: 200 })
      ]);

      if (!isActive) return;

      const [salesChannelsResult, regionsResult, locationsResult] = results;

      const salesChannelsPayload =
        salesChannelsResult.status === 'fulfilled' ? salesChannelsResult.value : null;
      const regionsPayload = regionsResult.status === 'fulfilled' ? regionsResult.value : null;
      const locationsPayload =
        locationsResult.status === 'fulfilled' ? locationsResult.value : null;

      setStoreMeta({
        salesChannels: sortByLabel(
          getArrayFromPayload(salesChannelsPayload, 'sales_channels'),
          (channel) => channel?.name || channel?.id
        ),
        regions: sortByLabel(
          getArrayFromPayload(regionsPayload, 'regions'),
          (region) => region?.name || region?.id
        ),
        locations: sortByLabel(
          getArrayFromPayload(locationsPayload, 'stock_locations'),
          (location) => location?.name || location?.id
        )
      });

      const failedCount = results.filter((result) => result.status === 'rejected').length;
      if (failedCount) {
        setStoreMetaError('Some store settings failed to load.');
      }
      setStoreMetaLoading(false);
    };

    loadStoreMeta();

    return () => {
      isActive = false;
    };
  }, [isStore]);

  useEffect(() => {
    if (!isPriceList || !record?.id) {
      setPriceListPrices([]);
      setPriceListPricesLoading(false);
      setPriceListPricesError('');
      setPriceListPriceDrafts({});
      return;
    }
    const prices = Array.isArray(record?.prices) ? record.prices : [];
    setPriceListPrices(prices);
    setPriceListPriceDrafts(buildPriceListPriceDrafts(prices));
  }, [isPriceList, record?.id, record?.prices]);

  useEffect(() => {
    if (!isPriceList) {
      setPriceListVariantSearch({ query: '', results: [], loading: false, error: '' });
      setSelectedPriceListVariant(null);
      return;
    }
    const query = priceListVariantSearch.query.trim();
    if (!query) {
      setPriceListVariantSearch((prev) => ({
        ...prev,
        results: [],
        loading: false,
        error: ''
      }));
      return;
    }
    let isActive = true;
    const loadVariants = async () => {
      setPriceListVariantSearch((prev) => ({ ...prev, loading: true, error: '' }));
      try {
        const payload = await getList('/admin/product-variants', { q: query, limit: 20 });
        if (!isActive) return;
        setPriceListVariantSearch((prev) => ({
          ...prev,
          results: getArrayFromPayload(payload, 'variants'),
          loading: false
        }));
      } catch (err) {
        if (!isActive) return;
        setPriceListVariantSearch((prev) => ({
          ...prev,
          results: [],
          loading: false,
          error: err?.message || 'Unable to search variants.'
        }));
      }
    };

    loadVariants();

    return () => {
      isActive = false;
    };
  }, [isPriceList, priceListVariantSearch.query]);

  useEffect(() => {
    if (!isPriceList) {
      setPriceListProductSearch({ query: '', results: [], loading: false, error: '' });
      return;
    }
    const query = priceListProductSearch.query.trim();
    if (!query) {
      setPriceListProductSearch((prev) => ({
        ...prev,
        results: [],
        loading: false,
        error: ''
      }));
      return;
    }
    let isActive = true;
    const loadProducts = async () => {
      setPriceListProductSearch((prev) => ({ ...prev, loading: true, error: '' }));
      try {
        const payload = await getList('/admin/products', { q: query, limit: 20 });
        if (!isActive) return;
        setPriceListProductSearch((prev) => ({
          ...prev,
          results: getArrayFromPayload(payload, 'products'),
          loading: false
        }));
      } catch (err) {
        if (!isActive) return;
        setPriceListProductSearch((prev) => ({
          ...prev,
          results: [],
          loading: false,
          error: err?.message || 'Unable to search products.'
        }));
      }
    };

    loadProducts();

    return () => {
      isActive = false;
    };
  }, [isPriceList, priceListProductSearch.query]);

  useEffect(() => {
    if (!isCustomer) {
      setCustomerGroupMeta({ groups: [] });
      setCustomerGroupMetaLoading(false);
      setCustomerGroupMetaError('');
      return;
    }
    let isActive = true;

    const loadCustomerGroups = async () => {
      setCustomerGroupMetaLoading(true);
      setCustomerGroupMetaError('');
      try {
        const payload = await getList('/admin/customer-groups', { limit: 200 });
        if (!isActive) return;
        setCustomerGroupMeta({
          groups: sortByLabel(
            getArrayFromPayload(payload, 'customer_groups'),
            (group) => group?.name || group?.id
          )
        });
      } catch (err) {
        if (!isActive) return;
        setCustomerGroupMeta({ groups: [] });
        setCustomerGroupMetaError(err?.message || 'Unable to load customer groups.');
      } finally {
        if (isActive) setCustomerGroupMetaLoading(false);
      }
    };

    loadCustomerGroups();

    return () => {
      isActive = false;
    };
  }, [isCustomer]);

  useEffect(() => {
    if (!isCategory) {
      setCategoryMeta({ categories: [] });
      setCategoryMetaLoading(false);
      setCategoryMetaError('');
      return;
    }
    let isActive = true;

    const loadCategoryMeta = async () => {
      setCategoryMetaLoading(true);
      setCategoryMetaError('');
      try {
        const payload = await getList('/admin/product-categories', { limit: 200 });
        if (!isActive) return;
        setCategoryMeta({
          categories: sortByLabel(
            getArrayFromPayload(payload, 'product_categories'),
            (category) => category?.name || category?.handle || category?.id
          )
        });
      } catch (err) {
        if (!isActive) return;
        setCategoryMeta({ categories: [] });
        setCategoryMetaError(err?.message || 'Unable to load categories.');
      } finally {
        if (isActive) setCategoryMetaLoading(false);
      }
    };

    loadCategoryMeta();

    return () => {
      isActive = false;
    };
  }, [isCategory]);

  useEffect(() => {
    if (!isCustomerGroup) {
      setGroupCustomerSearch({ query: '', results: [], loading: false, error: '' });
      return;
    }
    const query = groupCustomerSearch.query.trim();
    if (!query) {
      setGroupCustomerSearch((prev) => ({
        ...prev,
        results: [],
        loading: false,
        error: ''
      }));
      return;
    }
    let isActive = true;
    const loadCustomers = async () => {
      setGroupCustomerSearch((prev) => ({ ...prev, loading: true, error: '' }));
      try {
        const payload = await getList('/admin/customers', { q: query, limit: 20 });
        if (!isActive) return;
        setGroupCustomerSearch((prev) => ({
          ...prev,
          results: getArrayFromPayload(payload, 'customers'),
          loading: false
        }));
      } catch (err) {
        if (!isActive) return;
        setGroupCustomerSearch((prev) => ({
          ...prev,
          results: [],
          loading: false,
          error: err?.message || 'Unable to search customers.'
        }));
      }
    };

    loadCustomers();

    return () => {
      isActive = false;
    };
  }, [isCustomerGroup, groupCustomerSearch.query]);

  useEffect(() => {
    if (!isOrder) {
      setOrderTransferTarget(null);
      setOrderTransferTargetState({ loading: false, error: '' });
      return;
    }
    if (!orderTransferTargetId) {
      setOrderTransferTarget(null);
      setOrderTransferTargetState({ loading: false, error: '' });
      return;
    }
    let isActive = true;
    const loadTransferTarget = async () => {
      setOrderTransferTargetState({ loading: true, error: '' });
      try {
        const payload = await getDetail('/admin/customers', orderTransferTargetId);
        if (!isActive) return;
        const customer = getObjectFromPayload(payload, 'customer');
        setOrderTransferTarget(customer || null);
        setOrderTransferTargetState({ loading: false, error: '' });
      } catch (err) {
        if (!isActive) return;
        setOrderTransferTarget(null);
        setOrderTransferTargetState({
          loading: false,
          error: err?.message || 'Unable to load transfer customer.'
        });
      }
    };

    loadTransferTarget();

    return () => {
      isActive = false;
    };
  }, [isOrder, orderTransferTargetId]);

  useEffect(() => {
    if (!isOrder) {
      setOrderTransferSearch({ query: '', results: [], loading: false, error: '' });
      return;
    }
    const query = orderTransferSearch.query.trim();
    if (!query) {
      setOrderTransferSearch((prev) => ({
        ...prev,
        results: [],
        loading: false,
        error: ''
      }));
      return;
    }
    let isActive = true;
    const loadCustomers = async () => {
      setOrderTransferSearch((prev) => ({ ...prev, loading: true, error: '' }));
      try {
        const payload = await getList('/admin/customers', {
          q: query,
          limit: 20,
          has_account: true
        });
        if (!isActive) return;
        setOrderTransferSearch((prev) => ({
          ...prev,
          results: getArrayFromPayload(payload, 'customers'),
          loading: false
        }));
      } catch (err) {
        if (!isActive) return;
        setOrderTransferSearch((prev) => ({
          ...prev,
          results: [],
          loading: false,
          error: err?.message || 'Unable to search customers.'
        }));
      }
    };

    loadCustomers();

    return () => {
      isActive = false;
    };
  }, [isOrder, orderTransferSearch.query]);

  useEffect(() => {
    if (!isTaxRate) {
      setTaxRateRuleMeta({
        collections: [],
        categories: [],
        tags: [],
        types: [],
        shippingOptions: []
      });
      setTaxRateRuleMetaLoading(false);
      setTaxRateRuleMetaError('');
      return;
    }
    let isActive = true;

    const loadTaxRateMeta = async () => {
      setTaxRateRuleMetaLoading(true);
      setTaxRateRuleMetaError('');
      const results = await Promise.allSettled([
        getList('/admin/collections', { limit: 200 }),
        getList('/admin/product-categories', { limit: 200 }),
        getList('/admin/product-tags', { limit: 200 }),
        getList('/admin/product-types', { limit: 200 }),
        getList('/admin/shipping-options', { limit: 200 })
      ]);

      if (!isActive) return;

      const [
        collectionsResult,
        categoriesResult,
        tagsResult,
        typesResult,
        shippingOptionsResult
      ] = results;

      const collectionsPayload =
        collectionsResult.status === 'fulfilled' ? collectionsResult.value : null;
      const categoriesPayload =
        categoriesResult.status === 'fulfilled' ? categoriesResult.value : null;
      const tagsPayload = tagsResult.status === 'fulfilled' ? tagsResult.value : null;
      const typesPayload = typesResult.status === 'fulfilled' ? typesResult.value : null;
      const shippingOptionsPayload =
        shippingOptionsResult.status === 'fulfilled' ? shippingOptionsResult.value : null;

      setTaxRateRuleMeta({
        collections: sortByLabel(
          getArrayFromPayload(collectionsPayload, 'collections'),
          (collection) => collection?.title || collection?.handle || collection?.id
        ),
        categories: sortByLabel(
          getArrayFromPayload(categoriesPayload, 'product_categories'),
          (category) => category?.name || category?.handle || category?.id
        ),
        tags: sortByLabel(
          getArrayFromPayload(tagsPayload, 'product_tags'),
          (tag) => tag?.value || tag?.id
        ),
        types: sortByLabel(
          getArrayFromPayload(typesPayload, 'product_types'),
          (type) => type?.value || type?.name || type?.id
        ),
        shippingOptions: sortByLabel(
          getArrayFromPayload(shippingOptionsPayload, 'shipping_options'),
          (option) => option?.name || option?.id
        )
      });

      const failedCount = results.filter((result) => result.status === 'rejected').length;
      if (failedCount) {
        setTaxRateRuleMetaError('Some tax rule settings failed to load.');
      }
      setTaxRateRuleMetaLoading(false);
    };

    loadTaxRateMeta();

    return () => {
      isActive = false;
    };
  }, [isTaxRate]);

  useEffect(() => {
    if (!isTaxRate) {
      setTaxRateProductSearch({ query: '', results: [], loading: false, error: '' });
      return;
    }
    const query = taxRateProductSearch.query.trim();
    if (!query) {
      setTaxRateProductSearch((prev) => ({
        ...prev,
        results: [],
        loading: false,
        error: ''
      }));
      return;
    }
    let isActive = true;
    const loadProducts = async () => {
      setTaxRateProductSearch((prev) => ({ ...prev, loading: true, error: '' }));
      try {
        const payload = await getList('/admin/products', { q: query, limit: 20 });
        if (!isActive) return;
        setTaxRateProductSearch((prev) => ({
          ...prev,
          results: getArrayFromPayload(payload, 'products'),
          loading: false
        }));
      } catch (err) {
        if (!isActive) return;
        setTaxRateProductSearch((prev) => ({
          ...prev,
          results: [],
          loading: false,
          error: err?.message || 'Unable to search products.'
        }));
      }
    };

    loadProducts();

    return () => {
      isActive = false;
    };
  }, [isTaxRate, taxRateProductSearch.query]);

  useEffect(() => {
    if (!isCollection || !record?.id) {
      setCollectionProducts([]);
      setCollectionProductCount(0);
      setCollectionProductLoading(false);
      setCollectionProductError('');
      return;
    }
    refreshCollectionProducts();
  }, [isCollection, record?.id]);

  useEffect(() => {
    if (!isCategory || !record?.id) {
      setCategoryProducts([]);
      setCategoryProductCount(0);
      setCategoryProductLoading(false);
      setCategoryProductError('');
      return;
    }
    refreshCategoryProducts();
  }, [isCategory, record?.id]);

  useEffect(() => {
    if (!isCollection) {
      setCollectionProductSearch({ query: '', results: [], loading: false, error: '' });
      return;
    }
    const query = collectionProductSearch.query.trim();
    if (!query) {
      setCollectionProductSearch((prev) => ({
        ...prev,
        results: [],
        loading: false,
        error: ''
      }));
      return;
    }
    let isActive = true;
    const loadProducts = async () => {
      setCollectionProductSearch((prev) => ({ ...prev, loading: true, error: '' }));
      try {
        const payload = await getList('/admin/products', { q: query, limit: 20 });
        if (!isActive) return;
        setCollectionProductSearch((prev) => ({
          ...prev,
          results: getArrayFromPayload(payload, 'products'),
          loading: false
        }));
      } catch (err) {
        if (!isActive) return;
        setCollectionProductSearch((prev) => ({
          ...prev,
          results: [],
          loading: false,
          error: err?.message || 'Unable to search products.'
        }));
      }
    };

    loadProducts();

    return () => {
      isActive = false;
    };
  }, [isCollection, collectionProductSearch.query]);

  useEffect(() => {
    if (!isCategory) {
      setCategoryProductSearch({ query: '', results: [], loading: false, error: '' });
      return;
    }
    const query = categoryProductSearch.query.trim();
    if (!query) {
      setCategoryProductSearch((prev) => ({
        ...prev,
        results: [],
        loading: false,
        error: ''
      }));
      return;
    }
    let isActive = true;
    const loadProducts = async () => {
      setCategoryProductSearch((prev) => ({ ...prev, loading: true, error: '' }));
      try {
        const payload = await getList('/admin/products', { q: query, limit: 20 });
        if (!isActive) return;
        setCategoryProductSearch((prev) => ({
          ...prev,
          results: getArrayFromPayload(payload, 'products'),
          loading: false
        }));
      } catch (err) {
        if (!isActive) return;
        setCategoryProductSearch((prev) => ({
          ...prev,
          results: [],
          loading: false,
          error: err?.message || 'Unable to search products.'
        }));
      }
    };

    loadProducts();

    return () => {
      isActive = false;
    };
  }, [isCategory, categoryProductSearch.query]);

  useEffect(() => {
    if (!isProductType || !record?.id) {
      setProductTypeProducts([]);
      setProductTypeProductCount(0);
      setProductTypeProductLoading(false);
      setProductTypeProductError('');
      return;
    }
    refreshProductTypeProducts();
  }, [isProductType, record?.id]);

  useEffect(() => {
    if (!isProductTag || !record?.id) {
      setProductTagProducts([]);
      setProductTagProductCount(0);
      setProductTagProductLoading(false);
      setProductTagProductError('');
      return;
    }
    refreshProductTagProducts();
  }, [isProductTag, record?.id]);

  useEffect(() => {
    if (!isProductType) {
      setProductTypeProductSearch({ query: '', results: [], loading: false, error: '' });
      return;
    }
    const query = productTypeProductSearch.query.trim();
    if (!query) {
      setProductTypeProductSearch((prev) => ({
        ...prev,
        results: [],
        loading: false,
        error: ''
      }));
      return;
    }
    let isActive = true;
    const loadProducts = async () => {
      setProductTypeProductSearch((prev) => ({ ...prev, loading: true, error: '' }));
      try {
        const payload = await getList('/admin/products', { q: query, limit: 20 });
        if (!isActive) return;
        setProductTypeProductSearch((prev) => ({
          ...prev,
          results: getArrayFromPayload(payload, 'products'),
          loading: false
        }));
      } catch (err) {
        if (!isActive) return;
        setProductTypeProductSearch((prev) => ({
          ...prev,
          results: [],
          loading: false,
          error: err?.message || 'Unable to search products.'
        }));
      }
    };

    loadProducts();

    return () => {
      isActive = false;
    };
  }, [isProductType, productTypeProductSearch.query]);

  useEffect(() => {
    if (!isProductTag) {
      setProductTagProductSearch({ query: '', results: [], loading: false, error: '' });
      return;
    }
    const query = productTagProductSearch.query.trim();
    if (!query) {
      setProductTagProductSearch((prev) => ({
        ...prev,
        results: [],
        loading: false,
        error: ''
      }));
      return;
    }
    let isActive = true;
    const loadProducts = async () => {
      setProductTagProductSearch((prev) => ({ ...prev, loading: true, error: '' }));
      try {
        const payload = await getList('/admin/products', { q: query, limit: 20 });
        if (!isActive) return;
        setProductTagProductSearch((prev) => ({
          ...prev,
          results: getArrayFromPayload(payload, 'products'),
          loading: false
        }));
      } catch (err) {
        if (!isActive) return;
        setProductTagProductSearch((prev) => ({
          ...prev,
          results: [],
          loading: false,
          error: err?.message || 'Unable to search products.'
        }));
      }
    };

    loadProducts();

    return () => {
      isActive = false;
    };
  }, [isProductTag, productTagProductSearch.query]);

  useEffect(() => {
    if (!isSalesChannel || !record?.id) {
      setSalesChannelProducts([]);
      setSalesChannelProductCount(0);
      setSalesChannelProductLoading(false);
      setSalesChannelProductError('');
      return;
    }
    refreshSalesChannelProducts();
  }, [isSalesChannel, record?.id]);

  useEffect(() => {
    if (!isSalesChannel) {
      setSalesChannelProductSearch({ query: '', results: [], loading: false, error: '' });
      return;
    }
    const query = salesChannelProductSearch.query.trim();
    if (!query) {
      setSalesChannelProductSearch((prev) => ({
        ...prev,
        results: [],
        loading: false,
        error: ''
      }));
      return;
    }
    let isActive = true;
    const loadProducts = async () => {
      setSalesChannelProductSearch((prev) => ({ ...prev, loading: true, error: '' }));
      try {
        const payload = await getList('/admin/products', { q: query, limit: 20 });
        if (!isActive) return;
        setSalesChannelProductSearch((prev) => ({
          ...prev,
          results: getArrayFromPayload(payload, 'products'),
          loading: false
        }));
      } catch (err) {
        if (!isActive) return;
        setSalesChannelProductSearch((prev) => ({
          ...prev,
          results: [],
          loading: false,
          error: err?.message || 'Unable to search products.'
        }));
      }
    };

    loadProducts();

    return () => {
      isActive = false;
    };
  }, [isSalesChannel, salesChannelProductSearch.query]);

  useEffect(() => {
    if (!isOrderLike && !isExchange) {
      setFulfillmentMeta({ locations: [], shippingOptions: [] });
      setFulfillmentMetaError('');
      setFulfillmentMetaLoading(false);
      return;
    }
    const orderId = isExchange ? record?.order_id || record?.order?.id : record?.id;
    if (!orderId) {
      setFulfillmentMeta({ locations: [], shippingOptions: [] });
      setFulfillmentMetaError('');
      setFulfillmentMetaLoading(false);
      return;
    }
    let isActive = true;

    const loadOrderMeta = async () => {
      setFulfillmentMetaLoading(true);
      setFulfillmentMetaError('');
      try {
        const results = await Promise.allSettled([
          getList('/admin/stock-locations', { limit: 200 }),
          getList(`/admin/orders/${orderId}/shipping-options`)
        ]);
        if (!isActive) return;

        const [locationsResult, shippingResult] = results;
        const locationsPayload =
          locationsResult.status === 'fulfilled' ? locationsResult.value : null;
        const shippingPayload =
          shippingResult.status === 'fulfilled' ? shippingResult.value : null;

        setFulfillmentMeta({
          locations: sortByLabel(
            getArrayFromPayload(locationsPayload, 'stock_locations'),
            (location) => location?.name || location?.id
          ),
          shippingOptions: sortByLabel(
            getArrayFromPayload(shippingPayload, 'shipping_options'),
            (option) => option?.name || option?.id
          )
        });

        const failedCount = results.filter((result) => result.status === 'rejected').length;
        if (failedCount) {
          setFulfillmentMetaError('Some fulfillment settings failed to load.');
        }
      } catch (err) {
        if (!isActive) return;
        setFulfillmentMetaError(err?.message || 'Unable to load fulfillment settings.');
      } finally {
        if (isActive) setFulfillmentMetaLoading(false);
      }
    };

    loadOrderMeta();

    return () => {
      isActive = false;
    };
  }, [isOrderLike, isExchange, record?.id, record?.order_id, record?.order?.id]);

  useEffect(() => {
    if (!isOrder || !record?.items) {
      setFulfillmentDraft((prev) => ({ ...prev, items: {} }));
      return;
    }
    const itemsMap = buildItemQuantityMap(record.items);
    setFulfillmentDraft((prev) => ({ ...prev, items: itemsMap }));
  }, [isOrder, record?.id, record?.items]);

  useEffect(() => {
    if (!isOrder || !record?.fulfillments) {
      setShipmentDrafts({});
      return;
    }
    const baseItems = buildItemQuantityMap(record.items || []);
    setShipmentDrafts((prev) => {
      const next = {};
      record.fulfillments.forEach((fulfillment) => {
        if (!fulfillment?.id) return;
        next[fulfillment.id] = prev?.[fulfillment.id] || {
          items: { ...baseItems },
          tracking_number: '',
          tracking_url: '',
          label_url: '',
          notify_customer: true
        };
      });
      return next;
    });
  }, [isOrder, record?.id, record?.items, record?.fulfillments]);

  useEffect(() => {
    if (!isOrder) {
      setRefundReasons([]);
      setRefundReasonsError('');
      return;
    }
    let isActive = true;
    const loadRefundReasons = async () => {
      setRefundReasonsError('');
      try {
        const payload = await getList('/admin/refund-reasons', { limit: 200 });
        if (!isActive) return;
        setRefundReasons(
          sortByLabel(getArrayFromPayload(payload, 'refund_reasons'), (reason) => reason?.label)
        );
      } catch (err) {
        if (!isActive) return;
        setRefundReasonsError(err?.message || 'Unable to load refund reasons.');
      }
    };

    loadRefundReasons();

    return () => {
      isActive = false;
    };
  }, [isOrder]);

  useEffect(() => {
    if (!isOrder && !isReturnReason && !isReturn && !isExchange) {
      setReturnReasons([]);
      setReturnReasonsError('');
      setReturnReasonsLoading(false);
      return;
    }
    let isActive = true;
    const loadReturnReasons = async () => {
      setReturnReasonsLoading(true);
      setReturnReasonsError('');
      try {
        const payload = await getList('/admin/return-reasons', { limit: 200 });
        if (!isActive) return;
        setReturnReasons(
          sortByLabel(getArrayFromPayload(payload, 'return_reasons'), (reason) => reason?.label)
        );
      } catch (err) {
        if (!isActive) return;
        setReturnReasonsError(err?.message || 'Unable to load return reasons.');
      } finally {
        if (isActive) setReturnReasonsLoading(false);
      }
    };

    loadReturnReasons();

    return () => {
      isActive = false;
    };
  }, [isOrder, isReturnReason, isReturn, isExchange]);

  useEffect(() => {
    if (!isOrder || !record?.id) {
      setOrderReturns([]);
      setOrderReturnsError('');
      setOrderExchanges([]);
      setOrderExchangesError('');
      return;
    }
    refreshReturns();
    refreshExchanges();
  }, [isOrder, record?.id]);

  useEffect(() => {
    if (!isExchange) return;
    const orderId = record?.order_id || record?.order?.id;
    if (!orderId) {
      setOrderExchanges([]);
      setOrderExchangesError('');
      setOrderExchangesLoading(false);
      return;
    }
    refreshExchanges(orderId);
  }, [isExchange, record?.order_id, record?.order?.id]);

  useEffect(() => {
    if (!isOrderLike && !isExchange) {
      setOrderPreview(null);
      setOrderPreviewError('');
      setOrderPreviewLoading(false);
      return;
    }
    const orderId = isExchange ? record?.order_id || record?.order?.id : record?.id;
    if (!orderId) {
      setOrderPreview(null);
      setOrderPreviewError('');
      setOrderPreviewLoading(false);
      return;
    }
    refreshOrderPreview(orderId);
  }, [isOrderLike, isExchange, record?.id, record?.order_id, record?.order?.id]);

  useEffect(() => {
    if (!isOrderLike || !record?.id) {
      setOrderChanges([]);
      setOrderChangesError('');
      setOrderChangesLoading(false);
      return;
    }
    refreshOrderChanges();
  }, [isOrderLike, record?.id]);

  useEffect(() => {
    if (!isReturn && !isExchange) {
      setLinkedOrder(null);
      setLinkedOrderError('');
      setLinkedOrderLoading(false);
      return;
    }
    const orderId = record?.order_id || record?.order?.id;
    if (!orderId) {
      setLinkedOrder(null);
      setLinkedOrderError('');
      setLinkedOrderLoading(false);
      return;
    }
    let isActive = true;
    const loadLinkedOrder = async () => {
      setLinkedOrderLoading(true);
      setLinkedOrderError('');
      try {
        const payload = await getDetail('/admin/orders', orderId, orderDetailParams);
        const order = getObjectFromPayload(payload, 'order');
        if (isActive) setLinkedOrder(order);
      } catch (err) {
        if (!isActive) return;
        setLinkedOrder(null);
        setLinkedOrderError(err?.message || 'Unable to load related order.');
      } finally {
        if (isActive) setLinkedOrderLoading(false);
      }
    };

    loadLinkedOrder();

    return () => {
      isActive = false;
    };
  }, [
    isReturn,
    isExchange,
    record?.order_id,
    record?.order?.id,
    orderDetailParams
  ]);

  useEffect(() => {
    if (!isOrderLike) {
      setOrderEditItemDrafts({});
      return;
    }
    const items = Array.isArray(record?.items) ? record.items : [];
    if (!items.length) {
      setOrderEditItemDrafts({});
      return;
    }
    setOrderEditItemDrafts((prev) => {
      const next = { ...prev };
      items.forEach((item) => {
        const itemId = getOrderItemId(item);
        if (!itemId) return;
        const updateAction = orderEditItemUpdateMap[itemId];
        const quantity = updateAction?.details?.quantity ?? item?.quantity ?? 0;
        const unitPrice =
          updateAction?.details?.unit_price ??
          item?.unit_price ??
          item?.detail?.unit_price ??
          null;
        const compareAt =
          updateAction?.details?.compare_at_unit_price ??
          item?.compare_at_unit_price ??
          item?.detail?.compare_at_unit_price ??
          null;
        if (!next[itemId]) {
          next[itemId] = {
            quantity: quantity ?? 0,
            unit_price: unitPrice != null ? formatPriceInput(unitPrice) : '',
            compare_at_unit_price: compareAt != null ? formatPriceInput(compareAt) : '',
            internal_note: ''
          };
        }
      });
      Object.keys(next).forEach((itemId) => {
        if (!items.some((item) => getOrderItemId(item) === itemId)) {
          delete next[itemId];
        }
      });
      return next;
    });
  }, [isOrderLike, record?.items, orderEditItemUpdateMap]);

  useEffect(() => {
    if (!isOrderLike) {
      setOrderEditAddActionDrafts({});
      return;
    }
    if (!orderEditAddActions.length) {
      setOrderEditAddActionDrafts({});
      return;
    }
    setOrderEditAddActionDrafts((prev) => {
      const next = { ...prev };
      orderEditAddActions.forEach((action) => {
        if (!action?.id) return;
        if (!next[action.id]) {
          next[action.id] = {
            quantity: action?.details?.quantity ?? 1,
            unit_price:
              action?.details?.unit_price != null
                ? formatPriceInput(action.details.unit_price)
                : '',
            compare_at_unit_price:
              action?.details?.compare_at_unit_price != null
                ? formatPriceInput(action.details.compare_at_unit_price)
                : '',
            internal_note: action?.internal_note || ''
          };
        }
      });
      Object.keys(next).forEach((actionId) => {
        if (!orderEditAddActions.some((action) => action?.id === actionId)) {
          delete next[actionId];
        }
      });
      return next;
    });
  }, [isOrderLike, orderEditAddActions]);

  useEffect(() => {
    if (!isOrderLike) {
      setOrderEditShippingActionDrafts({});
      return;
    }
    if (!orderEditShippingActions.length) {
      setOrderEditShippingActionDrafts({});
      return;
    }
    setOrderEditShippingActionDrafts((prev) => {
      const next = { ...prev };
      const previewMethods = Array.isArray(orderPreview?.shipping_methods)
        ? orderPreview.shipping_methods
        : [];
      orderEditShippingActions.forEach((action) => {
        if (!action?.id) return;
        const referenceId =
          action?.reference_id || action?.details?.reference_id || action?.reference;
        const method = previewMethods.find((entry) => entry?.id === referenceId);
        if (!next[action.id]) {
          const amount = method?.amount ?? action?.details?.amount ?? null;
          next[action.id] = {
            custom_amount: amount != null ? formatPriceInput(amount) : '',
            internal_note: action?.internal_note || ''
          };
        }
      });
      Object.keys(next).forEach((actionId) => {
        if (!orderEditShippingActions.some((action) => action?.id === actionId)) {
          delete next[actionId];
        }
      });
      return next;
    });
  }, [isOrderLike, orderEditShippingActions, orderPreview?.shipping_methods]);

  useEffect(() => {
    if (!isDraftOrder) {
      setDraftOrderShippingMethodDrafts({});
      return;
    }
    if (!draftOrderExistingShippingMethods.length) {
      setDraftOrderShippingMethodDrafts({});
      return;
    }
    setDraftOrderShippingMethodDrafts((prev) => {
      const next = { ...prev };
      draftOrderExistingShippingMethods.forEach((method) => {
        if (!method?.id) return;
        if (!next[method.id]) {
          next[method.id] = {
            custom_amount:
              method?.amount !== undefined && method?.amount !== null
                ? formatPriceInput(method.amount)
                : ''
          };
        }
      });
      Object.keys(next).forEach((methodId) => {
        if (!draftOrderExistingShippingMethods.some((method) => method?.id === methodId)) {
          delete next[methodId];
        }
      });
      return next;
    });
  }, [isDraftOrder, draftOrderExistingShippingMethods]);

  useEffect(() => {
    if (!isOrderLike || !orderEditActive) {
      setOrderEditVariantSearch({ query: '', results: [], loading: false, error: '' });
      setOrderEditSelectedVariant(null);
      return;
    }
    const query = orderEditVariantSearch.query.trim();
    if (!query) {
      setOrderEditVariantSearch((prev) => ({ ...prev, results: [], loading: false, error: '' }));
      return;
    }
    let isActive = true;
    const loadVariants = async () => {
      setOrderEditVariantSearch((prev) => ({ ...prev, loading: true, error: '' }));
      try {
        const payload = await getList('/admin/product-variants', { q: query, limit: 20 });
        if (!isActive) return;
        setOrderEditVariantSearch((prev) => ({
          ...prev,
          results: getArrayFromPayload(payload, 'variants'),
          loading: false
        }));
      } catch (err) {
        if (!isActive) return;
        setOrderEditVariantSearch((prev) => ({
          ...prev,
          results: [],
          loading: false,
          error: err?.message || 'Unable to search variants.'
        }));
      }
    };

    loadVariants();

    return () => {
      isActive = false;
    };
  }, [isOrderLike, orderEditActive, orderEditVariantSearch.query]);

  useEffect(() => {
    if (!isOrder) return;
    if (!orderReturns.length) {
      setReturnRequestDrafts({});
      setReturnReceiveDrafts({});
      return;
    }
    setReturnRequestDrafts((prev) => {
      const next = { ...prev };
      orderReturns.forEach((orderReturn) => {
        if (!orderReturn?.id) return;
        if (!next[orderReturn.id]) {
          next[orderReturn.id] = buildReturnRequestMap(orderItems);
        }
      });
      return next;
    });
    setReturnReceiveDrafts((prev) => {
      const next = { ...prev };
      orderReturns.forEach((orderReturn) => {
        if (!orderReturn?.id) return;
        if (!next[orderReturn.id]) {
          next[orderReturn.id] = buildReturnReceiveMap(orderItems);
        }
      });
      return next;
    });
  }, [isOrder, orderReturns, orderItems]);

  useEffect(() => {
    if (!isReturn || !record?.id) return;
    setReturnRequestDrafts((prev) => {
      const existing = prev[record.id];
      if (existing && Object.keys(existing).length) return prev;
      return { ...prev, [record.id]: buildReturnRequestMap(returnItemSource) };
    });
    setReturnReceiveDrafts((prev) => {
      const existing = prev[record.id];
      if (existing && Object.keys(existing).length) return prev;
      return { ...prev, [record.id]: buildReturnReceiveMap(returnItemSource) };
    });
  }, [isReturn, record?.id, returnItemSource]);

  useEffect(() => {
    if (!isOrder && !isExchange) return;
    if (!exchangeRecords.length) {
      setExchangeInboundDrafts({});
      setExchangeOutboundDrafts({});
      setExchangeShippingDrafts({});
      return;
    }
    setExchangeInboundDrafts((prev) => {
      const next = { ...prev };
      exchangeRecords.forEach((exchange) => {
        if (!exchange?.id) return;
        if (!next[exchange.id]) {
          next[exchange.id] = {
            location_id: '',
            items: buildReturnRequestMap(exchangeItemSource)
          };
        }
      });
      return next;
    });
    setExchangeOutboundDrafts((prev) => {
      const next = { ...prev };
      exchangeRecords.forEach((exchange) => {
        if (!exchange?.id) return;
        if (!next[exchange.id]) {
          next[exchange.id] = {
            items: [],
            newItem: { variant_id: '', quantity: 1, unit_price: '', allow_backorder: false }
          };
        }
      });
      return next;
    });
  }, [isOrder, isExchange, exchangeRecords, exchangeItemSource]);

  useEffect(() => {
    if (!isOrder && !isExchange) return;
    if (!exchangeRecords.length) {
      setExchangeShippingDrafts({});
      return;
    }
    setExchangeShippingDrafts((prev) => {
      const next = { ...prev };
      exchangeRecords.forEach((exchange) => {
        if (!exchange?.id) return;
        const exchangeReturnId = resolveExchangeReturnId(exchange.id, exchangeRecords);
        const hasPreview = Boolean(orderPreview);
        const outboundShipping = getExchangeShippingMethod(orderPreview, exchange.id, 'outbound');
        const inboundShipping = getExchangeShippingMethod(
          orderPreview,
          exchange.id,
          'inbound',
          exchangeReturnId
        );
        const inboundTrackingNumber = hasPreview
          ? getShippingMetaValue(inboundShipping, 'tracking_number')
          : prev[exchange.id]?.inbound_tracking_number || '';
        const inboundTrackingUrl = hasPreview
          ? getShippingMetaValue(inboundShipping, 'tracking_url')
          : prev[exchange.id]?.inbound_tracking_url || '';
        const inboundLabelUrl = hasPreview
          ? getShippingMetaValue(inboundShipping, 'label_url')
          : prev[exchange.id]?.inbound_label_url || '';
        next[exchange.id] = {
          outbound_option_id: hasPreview
            ? outboundShipping?.shipping_option_id || ''
            : prev[exchange.id]?.outbound_option_id || '',
          outbound_custom_amount: hasPreview
            ? outboundShipping?.amount !== undefined && outboundShipping?.amount !== null
              ? formatPriceInput(outboundShipping.amount)
              : ''
            : prev[exchange.id]?.outbound_custom_amount || '',
          inbound_option_id: hasPreview
            ? inboundShipping?.shipping_option_id || ''
            : prev[exchange.id]?.inbound_option_id || '',
          inbound_custom_amount: hasPreview
            ? inboundShipping?.amount !== undefined && inboundShipping?.amount !== null
              ? formatPriceInput(inboundShipping.amount)
              : ''
            : prev[exchange.id]?.inbound_custom_amount || '',
          inbound_tracking_number: inboundTrackingNumber,
          inbound_tracking_url: inboundTrackingUrl,
          inbound_label_url: inboundLabelUrl
        };
      });
      return next;
    });
  }, [isOrder, isExchange, exchangeRecords, orderPreview]);

  useEffect(() => {
    if (!isProduct || !record?.id) {
      setInventoryCounts({});
      setInventoryMessage('');
      setInventoryError('');
      return;
    }
    let isActive = true;

    const loadInventoryCounts = async () => {
      setInventoryLoading(true);
      setInventoryError('');
      setInventoryMessage('');
      try {
        const expectedCount = record?.variants?.length || 0;
        const limit = Math.min(200, Math.max(50, expectedCount || 50));
        const payload = await getList(`/admin/products/${record.id}/variants`, {
          limit,
          fields: '+inventory_quantity'
        });
        if (!isActive) return;
        const variants = getArrayFromPayload(payload, 'variants');
        const nextCounts = {};
        variants.forEach((variant) => {
          if (variant?.id && typeof variant.inventory_quantity === 'number') {
            nextCounts[variant.id] = variant.inventory_quantity;
          }
        });
        setInventoryCounts(nextCounts);
        const total = typeof payload?.count === 'number' ? payload.count : variants.length;
        if (total > limit) {
          setInventoryMessage(`Showing inventory for the first ${limit} variants.`);
        }
      } catch (err) {
        if (!isActive) return;
        setInventoryError(err?.message || 'Unable to load inventory counts.');
        setInventoryCounts({});
      } finally {
        if (isActive) setInventoryLoading(false);
      }
    };

    loadInventoryCounts();

    return () => {
      isActive = false;
    };
  }, [isProduct, record?.id, record?.variants?.length]);


  const orderLabel = isDraftOrder ? 'draft order' : 'order';
  const orderEditLabel = isDraftOrder ? 'draft order edit' : 'order edit';
  const primaryTitle = record?.title || record?.name || record?.email || record?.code || record?.id || '';

  const applyProductPayload = (payload) => {
    const updated =
      payload?.product ||
      payload?.parent ||
      getObjectFromPayload(payload, resource?.detailKey);
    if (!updated) return;
    setRecord(updated);
    setProductDraft(mapRecordToDraft(updated));
    setOptionDrafts(buildOptionDrafts(updated));
  };

  const applyOrderPayload = (payload) => {
    const updated = payload?.order || getObjectFromPayload(payload, resource?.detailKey);
    if (!updated) return;
    setRecord(updated);
  };

  const applyOrderPreviewPayload = (payload) => {
    const preview =
      payload?.draft_order_preview || payload?.order_preview || payload?.order || payload?.preview;
    if (!preview) return;
    setOrderPreview(preview);
  };

  const applyInventoryItemPayload = (payload) => {
    const updated =
      payload?.inventory_item ||
      payload?.parent ||
      getObjectFromPayload(payload, resource?.detailKey);
    if (!updated) return;
    setRecord(updated);
    setInventoryItemDraft(mapInventoryItemToDraft(updated));
  };

  const refreshReturns = async () => {
    if (!isOrder || !record?.id) return;
    setOrderReturnsLoading(true);
    setOrderReturnsError('');
    try {
      const payload = await getList('/admin/returns', { order_id: record.id, limit: 50 });
      setOrderReturns(getArrayFromPayload(payload, 'returns'));
    } catch (err) {
      setOrderReturns([]);
      setOrderReturnsError(err?.message || 'Unable to load returns.');
    } finally {
      setOrderReturnsLoading(false);
    }
  };

  const refreshExchanges = async (orderIdOverride = null) => {
    if (!isOrder && !isExchange && !orderIdOverride) return;
    const orderId =
      orderIdOverride || (isOrder ? record?.id : record?.order_id || record?.order?.id);
    if (!orderId) return;
    setOrderExchangesLoading(true);
    setOrderExchangesError('');
    try {
      const payload = await getList('/admin/exchanges', { order_id: orderId, limit: 50 });
      setOrderExchanges(getArrayFromPayload(payload, 'exchanges'));
    } catch (err) {
      setOrderExchanges([]);
      setOrderExchangesError(err?.message || 'Unable to load exchanges.');
    } finally {
      setOrderExchangesLoading(false);
    }
  };

  const refreshExchangeContext = async () => {
    if (isExchange) {
      await refreshExchangeDetail();
      const orderId = record?.order_id || record?.order?.id;
      if (orderId) {
        await refreshOrderPreview(orderId);
      }
      return;
    }
    await refreshExchanges();
    await refreshOrderPreview();
  };

  const refreshOrder = async () => {
    if (!isOrderLike || !record?.id) return;
    try {
      const payload = await getDetail(
        resource.endpoint,
        record.id,
        isOrder ? orderDetailParams : undefined
      );
      const updated = getObjectFromPayload(payload, resource?.detailKey);
      if (updated) setRecord(updated);
    } catch (err) {
      setError(err?.message || 'Unable to refresh order details.');
    }
  };

  const refreshReturnDetail = async () => {
    if (!isReturn || !record?.id) return;
    try {
      const payload = await getDetail(resource.endpoint, record.id);
      const updated = getObjectFromPayload(payload, resource?.detailKey);
      if (updated) setRecord(updated);
    } catch (err) {
      setError(err?.message || 'Unable to refresh return details.');
    }
  };

  const refreshExchangeDetail = async () => {
    if (!isExchange || !record?.id) return;
    try {
      const payload = await getDetail(resource.endpoint, record.id);
      const updated = getObjectFromPayload(payload, resource?.detailKey);
      if (updated) setRecord(updated);
    } catch (err) {
      setError(err?.message || 'Unable to refresh exchange details.');
    }
  };

  const refreshOrderPreview = async (orderIdOverride = null) => {
    if (!isOrderLike && !isExchange && !orderIdOverride) return;
    const orderId = orderIdOverride || (isExchange ? record?.order_id || record?.order?.id : record?.id);
    if (!orderId) return;
    setOrderPreviewLoading(true);
    setOrderPreviewError('');
    try {
      const payload = await request(`/admin/orders/${orderId}/preview`);
      const updated = getObjectFromPayload(payload, 'order');
      setOrderPreview(updated || null);
    } catch (err) {
      setOrderPreview(null);
      setOrderPreviewError(err?.message || 'Unable to load order preview.');
    } finally {
      setOrderPreviewLoading(false);
    }
  };

  const refreshOrderChanges = async () => {
    if (!isOrderLike || !record?.id) return;
    setOrderChangesLoading(true);
    setOrderChangesError('');
    try {
      const payload = await getList(`/admin/orders/${record.id}/changes`);
      setOrderChanges(getArrayFromPayload(payload, 'order_changes'));
    } catch (err) {
      setOrderChanges([]);
      setOrderChangesError(err?.message || 'Unable to load order changes.');
    } finally {
      setOrderChangesLoading(false);
    }
  };

  const refreshInventoryItem = async () => {
    if (!isInventoryItem || !record?.id) return;
    try {
      const payload = await getDetail(resource.endpoint, record.id, {
        fields: '+location_levels'
      });
      const updated = getObjectFromPayload(payload, resource?.detailKey);
      if (updated) {
        setRecord(updated);
        setInventoryItemDraft(mapInventoryItemToDraft(updated));
      }
    } catch (err) {
      setInventoryItemState((prev) => ({
        ...prev,
        error: err?.message || 'Unable to refresh inventory item.'
      }));
    }
  };

  const refreshStockLocation = async () => {
    if (!isStockLocation || !record?.id) return;
    try {
      const payload = await getDetail(resource.endpoint, record.id, {
        fields:
          '+address,+sales_channels,+fulfillment_providers,+fulfillment_sets,+fulfillment_sets.service_zones,+fulfillment_sets.service_zones.geo_zones'
      });
      const updated = getObjectFromPayload(payload, resource?.detailKey);
      if (updated) setRecord(updated);
    } catch (err) {
      setStockLocationState((prev) => ({
        ...prev,
        error: err?.message || 'Unable to refresh stock location.'
      }));
    }
  };

  const refreshStockLocationInventory = async (searchTerm = '') => {
    if (!isStockLocation || !record?.id) return;
    setStockLocationInventoryState((prev) => ({
      ...prev,
      loading: true,
      error: ''
    }));
    try {
      const payload = await getList('/admin/inventory-items', {
        limit: 50,
        order: '-updated_at',
        q: searchTerm || undefined,
        'location_levels[location_id]': record.id,
        fields: '+location_levels'
      });
      const items = getArrayFromPayload(payload, 'inventory_items');
      const count =
        typeof payload?.count === 'number' ? payload.count : items.length;
      setStockLocationInventoryState({
        items,
        count,
        loading: false,
        error: ''
      });
    } catch (err) {
      setStockLocationInventoryState({
        items: [],
        count: 0,
        loading: false,
        error: err?.message || 'Unable to load inventory for this location.'
      });
    }
  };

  const refreshInventoryReservations = async () => {
    if (!isInventoryItem || !record?.id) return;
    setInventoryReservationsLoading(true);
    setInventoryReservationsError('');
    try {
      const payload = await getList('/admin/reservations', {
        inventory_item_id: record.id,
        limit: 50
      });
      setInventoryReservations(getArrayFromPayload(payload, 'reservations'));
    } catch (err) {
      setInventoryReservations([]);
      setInventoryReservationsError(err?.message || 'Unable to load reservations.');
    } finally {
      setInventoryReservationsLoading(false);
    }
  };

  useEffect(() => {
    if (!isInventoryItem || !record?.id) {
      setInventoryReservations([]);
      setInventoryReservationsLoading(false);
      setInventoryReservationsError('');
      return;
    }
    refreshInventoryReservations();
  }, [isInventoryItem, record?.id]);

  const handleDraftField = (field) => (event) => {
    const value = event.target.value;
    setProductDraft((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const handleDraftToggle = (field) => (event) => {
    const value = event.target.checked;
    setProductDraft((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const toggleDraftSelection = (field, idValue) => {
    setProductDraft((prev) => {
      if (!prev) return prev;
      const current = new Set(prev[field] || []);
      if (current.has(idValue)) {
        current.delete(idValue);
      } else {
        current.add(idValue);
      }
      return { ...prev, [field]: Array.from(current) };
    });
  };

  const handleResetProduct = () => {
    if (!record) return;
    setProductDraft(mapRecordToDraft(record));
    setSaveState({ saving: false, error: '', success: '' });
    setProductUploadState({ uploading: false, error: '', success: '' });
  };

  const handleProductThumbnailUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setProductUploadState({ uploading: true, error: '', success: '' });
    try {
      const payload = await uploadFiles(file);
      const files = getArrayFromPayload(payload, 'files');
      const uploaded = files[0] || getObjectFromPayload(payload, 'file');
      const url = uploaded?.url || uploaded?.id;
      if (!url) {
        throw new Error('Upload response missing file URL.');
      }
      setProductDraft((prev) => (prev ? { ...prev, thumbnail: url } : prev));
      setProductUploadState({ uploading: false, error: '', success: 'Thumbnail uploaded.' });
    } catch (err) {
      setProductUploadState({
        uploading: false,
        error: err?.message || 'Unable to upload thumbnail.',
        success: ''
      });
    } finally {
      event.target.value = '';
    }
  };

  const handleSaveProduct = async () => {
    if (!record || !productDraft) return;
    setSaveState({ saving: true, error: '', success: '' });
    try {
      const thumbnail = productDraft.thumbnail.trim();
      const weightResult = parseNullableNumberInput(productDraft.weight);
      const lengthResult = parseNullableNumberInput(productDraft.length);
      const heightResult = parseNullableNumberInput(productDraft.height);
      const widthResult = parseNullableNumberInput(productDraft.width);
      const numberError = [
        { label: 'Weight', result: weightResult },
        { label: 'Length', result: lengthResult },
        { label: 'Height', result: heightResult },
        { label: 'Width', result: widthResult }
      ].find((entry) => entry.result.error);
      if (numberError) {
        setSaveState({
          saving: false,
          error: `${numberError.label}: ${numberError.result.error}`,
          success: ''
        });
        return;
      }
      const { data: metadata, error: metadataError } = parseJsonInput(productDraft.metadata);
      if (metadataError) {
        setSaveState({
          saving: false,
          error: `Metadata: ${metadataError}`,
          success: ''
        });
        return;
      }
      const payload = await request(`${resource.endpoint}/${record.id}`, {
        method: 'POST',
        body: {
          title: productDraft.title.trim() || undefined,
          subtitle: productDraft.subtitle || null,
          handle: productDraft.handle || null,
          status: productDraft.status || undefined,
          description: productDraft.description || null,
          thumbnail: thumbnail || null,
          external_id: productDraft.external_id.trim() || null,
          is_giftcard: productDraft.is_giftcard,
          discountable: productDraft.discountable,
          collection_id: productDraft.collection_id || null,
          type_id: productDraft.type_id || null,
          shipping_profile_id: productDraft.shipping_profile_id || null,
          weight: weightResult.value,
          length: lengthResult.value,
          height: heightResult.value,
          width: widthResult.value,
          hs_code: productDraft.hs_code.trim() || null,
          mid_code: productDraft.mid_code.trim() || null,
          origin_country: productDraft.origin_country.trim() || null,
          material: productDraft.material.trim() || null,
          metadata,
          sales_channels: (productDraft.sales_channel_ids || []).map((idValue) => ({ id: idValue })),
          tags: (productDraft.tag_ids || []).map((idValue) => ({ id: idValue })),
          categories: (productDraft.category_ids || []).map((idValue) => ({ id: idValue }))
        }
      });
      applyProductPayload(payload);
      setSaveState({ saving: false, error: '', success: 'Product updated.' });
    } catch (err) {
      setSaveState({
        saving: false,
        error: err?.message || 'Unable to save product.',
        success: ''
      });
    }
  };

  const buildOrderDetailDraft = (target) => ({
    email: target?.email || target?.customer?.email || '',
    locale: target?.locale || '',
    metadata: formatJsonValue(target?.metadata),
    shipping_address: buildAddressDraft(target?.shipping_address || {}),
    billing_address: buildAddressDraft(target?.billing_address || {})
  });

  const handleOrderDetailField = (field) => (event) => {
    const value = event.target.value;
    setOrderDetailDraft((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const handleOrderAddressField = (type, field) => (event) => {
    const value = event.target.value;
    setOrderDetailDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        [type]: {
          ...(prev[type] || {}),
          [field]: value
        }
      };
    });
  };

  const handleResetOrderDetails = () => {
    if (!record) return;
    setOrderDetailDraft(buildOrderDetailDraft(record));
    setOrderDetailState({ saving: false, error: '', success: '' });
  };

  const handleSaveOrderDetails = async () => {
    if (!record || !orderDetailDraft) return;
    setOrderDetailState({ saving: true, error: '', success: '' });
    try {
      const { data: metadata, error: metadataError } = parseJsonInput(orderDetailDraft.metadata);
      if (metadataError) {
        setOrderDetailState({
          saving: false,
          error: `Metadata: ${metadataError}`,
          success: ''
        });
        return;
      }
      const shippingAddress = buildAddressPayload(orderDetailDraft.shipping_address);
      const billingAddress = buildAddressPayload(orderDetailDraft.billing_address);
      const body = {
        email: orderDetailDraft.email.trim() || undefined,
        locale: orderDetailDraft.locale.trim() || undefined,
        metadata,
        shipping_address: shippingAddress,
        billing_address: billingAddress
      };
      const endpoint = isDraftOrder
        ? `/admin/draft-orders/${record.id}`
        : `/admin/orders/${record.id}`;
      const payload = await request(endpoint, {
        method: 'POST',
        body
      });
      const updated = isDraftOrder
        ? payload?.draft_order || getObjectFromPayload(payload, resource?.detailKey)
        : payload?.order || getObjectFromPayload(payload, resource?.detailKey);
      if (updated) {
        setRecord(updated);
      }
      setOrderDetailState({
        saving: false,
        error: '',
        success: `${isDraftOrder ? 'Draft order' : 'Order'} details updated.`
      });
    } catch (err) {
      setOrderDetailState({
        saving: false,
        error: err?.message || 'Unable to update order details.',
        success: ''
      });
    }
  };

  const handleRegionDraftChange = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setRegionDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleRegionProviderToggle = (providerId) => {
    if (!providerId) return;
    setRegionDraft((prev) => {
      const current = new Set(parseCsvInput(prev.payment_providers));
      if (current.has(providerId)) {
        current.delete(providerId);
      } else {
        current.add(providerId);
      }
      return { ...prev, payment_providers: Array.from(current).join(', ') };
    });
  };

  const handleSaveRegion = async (event) => {
    event.preventDefault();
    if (!record?.id) return;
    const name = regionDraft.name.trim();
    const currencyCode = regionDraft.currency_code.trim().toLowerCase();
    const countries = parseCsvInput(regionDraft.countries);
    const paymentProviders = parseCsvInput(regionDraft.payment_providers);
    const { data: metadata, error: metadataError } = parseJsonInput(regionDraft.metadata);

    if (!name || !currencyCode || !countries.length) {
      setRegionState({
        saving: false,
        deleting: false,
        error: 'Name, currency, and at least one country are required.',
        success: ''
      });
      return;
    }

    if (metadataError) {
      setRegionState({
        saving: false,
        deleting: false,
        error: `Metadata JSON error: ${metadataError}`,
        success: ''
      });
      return;
    }

    setRegionState({ saving: true, deleting: false, error: '', success: '' });
    try {
      const payload = await request(`${resource.endpoint}/${record.id}`, {
        method: 'POST',
        body: {
          name,
          currency_code: currencyCode,
          countries,
          automatic_taxes: Boolean(regionDraft.automatic_taxes),
          is_tax_inclusive: Boolean(regionDraft.is_tax_inclusive),
          payment_providers: paymentProviders.length ? paymentProviders : undefined,
          ...(metadata && typeof metadata === 'object' ? { metadata } : {})
        }
      });
      const updated = getObjectFromPayload(payload, resource.detailKey);
      if (updated) setRecord(updated);
      setRegionState({
        saving: false,
        deleting: false,
        error: '',
        success: 'Region updated.'
      });
    } catch (err) {
      setRegionState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to update region.',
        success: ''
      });
    }
  };

  const handleDeleteRegion = async () => {
    if (!record?.id) return;
    if (!window.confirm('Delete this region?')) return;
    setRegionState({ saving: false, deleting: true, error: '', success: '' });
    try {
      await request(`${resource.endpoint}/${record.id}`, { method: 'DELETE' });
      navigate(resource.path);
    } catch (err) {
      setRegionState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to delete region.',
        success: ''
      });
    }
  };

  const handleShippingProfileDraftChange = (field) => (event) => {
    const value = event.target.value;
    setShippingProfileDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveShippingProfile = async (event) => {
    event.preventDefault();
    if (!record?.id) return;
    const name = shippingProfileDraft.name.trim();
    const type = shippingProfileDraft.type.trim();
    const { data: metadata, error: metadataError } = parseJsonInput(shippingProfileDraft.metadata);

    if (!name || !type) {
      setShippingProfileState({
        saving: false,
        deleting: false,
        error: 'Name and type are required.',
        success: ''
      });
      return;
    }

    if (metadataError) {
      setShippingProfileState({
        saving: false,
        deleting: false,
        error: `Metadata JSON error: ${metadataError}`,
        success: ''
      });
      return;
    }

    setShippingProfileState({ saving: true, deleting: false, error: '', success: '' });
    try {
      const payload = await request(`${resource.endpoint}/${record.id}`, {
        method: 'POST',
        body: {
          name,
          type,
          ...(metadata && typeof metadata === 'object' ? { metadata } : {})
        }
      });
      const updated = getObjectFromPayload(payload, resource.detailKey);
      if (updated) setRecord(updated);
      setShippingProfileState({
        saving: false,
        deleting: false,
        error: '',
        success: 'Shipping profile updated.'
      });
    } catch (err) {
      setShippingProfileState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to update shipping profile.',
        success: ''
      });
    }
  };

  const handleDeleteShippingProfile = async () => {
    if (!record?.id) return;
    if (!window.confirm('Delete this shipping profile?')) return;
    setShippingProfileState({ saving: false, deleting: true, error: '', success: '' });
    try {
      await request(`${resource.endpoint}/${record.id}`, { method: 'DELETE' });
      navigate(resource.path);
    } catch (err) {
      setShippingProfileState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to delete shipping profile.',
        success: ''
      });
    }
  };

  const handleShippingOptionDraftChange = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setShippingOptionDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleShippingOptionPriceChange = (index, field) => (event) => {
    const value = event.target.value;
    setShippingOptionDraft((prev) => {
      const nextPrices = prev.prices.map((price, priceIndex) =>
        priceIndex === index ? { ...price, [field]: value } : price
      );
      return { ...prev, prices: nextPrices };
    });
  };

  const handleAddShippingOptionPrice = () => {
    setShippingOptionDraft((prev) => ({
      ...prev,
      prices: [...(prev.prices || []), { amount: '', currency_code: '', region_id: '' }]
    }));
  };

  const handleRemoveShippingOptionPrice = (index) => {
    setShippingOptionDraft((prev) => {
      const nextPrices = prev.prices.filter((_, priceIndex) => priceIndex !== index);
      return {
        ...prev,
        prices: nextPrices.length ? nextPrices : [{ amount: '', currency_code: '', region_id: '' }]
      };
    });
  };

  const handleSaveShippingOption = async (event) => {
    event.preventDefault();
    if (!record?.id) return;
    const name = shippingOptionDraft.name.trim();
    const priceType = shippingOptionDraft.price_type.trim();
    const providerId = shippingOptionDraft.provider_id.trim();
    const shippingProfileId = shippingOptionDraft.shipping_profile_id.trim();
    const serviceZoneId = shippingOptionDraft.service_zone_id.trim();
    const typeId = shippingOptionDraft.type_id.trim();
    const { data: dataPayload, error: dataError } = parseJsonInput(shippingOptionDraft.data);
    const { data: metadata, error: metadataError } = parseJsonInput(shippingOptionDraft.metadata);

    if (!name || !priceType || !providerId || !shippingProfileId || !serviceZoneId) {
      setShippingOptionState({
        saving: false,
        deleting: false,
        error: 'Name, provider, profile, service zone, and price type are required.',
        success: ''
      });
      return;
    }

    if (dataError || metadataError) {
      setShippingOptionState({
        saving: false,
        deleting: false,
        error: `JSON error: ${dataError || metadataError}`,
        success: ''
      });
      return;
    }

    const pricesPayload = (shippingOptionDraft.prices || [])
      .map((price) => {
        const amount = parsePriceInput(price.amount);
        const currencyCode = String(price.currency_code || '').trim().toLowerCase();
        const regionId = String(price.region_id || '').trim();
        if (!Number.isFinite(amount)) return null;
        if (!currencyCode && !regionId) return null;
        return {
          ...(price.id ? { id: price.id } : {}),
          amount,
          ...(currencyCode ? { currency_code: currencyCode } : {}),
          ...(regionId ? { region_id: regionId } : {})
        };
      })
      .filter(Boolean);

    if (priceType === 'flat' && !pricesPayload.length) {
      setShippingOptionState({
        saving: false,
        deleting: false,
        error: 'Flat shipping options require at least one valid price.',
        success: ''
      });
      return;
    }

    const typePayload =
      shippingOptionDraft.type_label.trim() ||
      shippingOptionDraft.type_code.trim() ||
      shippingOptionDraft.type_description.trim()
        ? {
            label: shippingOptionDraft.type_label.trim() || undefined,
            code: shippingOptionDraft.type_code.trim() || undefined,
            description: shippingOptionDraft.type_description.trim() || undefined
          }
        : undefined;

    const existingRules = Array.isArray(record?.rules) ? record.rules : [];
    const buildRule = (attribute, value) => {
      const match = existingRules.find((rule) => rule?.attribute === attribute);
      return {
        ...(match?.id ? { id: match.id } : {}),
        attribute,
        operator: 'eq',
        value: String(value)
      };
    };
    const rules = [
      buildRule('enabled_in_store', shippingOptionDraft.enabled_in_store),
      buildRule('is_return', shippingOptionDraft.is_return)
    ];

    setShippingOptionState({ saving: true, deleting: false, error: '', success: '' });
    try {
      const payload = await request(`${resource.endpoint}/${record.id}`, {
        method: 'POST',
        body: {
          name,
          price_type: priceType,
          provider_id: providerId,
          shipping_profile_id: shippingProfileId,
          service_zone_id: serviceZoneId,
          prices: priceType === 'flat' && pricesPayload.length ? pricesPayload : undefined,
          ...(typeId ? { type_id: typeId } : { type: typePayload }),
          ...(dataPayload && typeof dataPayload === 'object' ? { data: dataPayload } : {}),
          ...(metadata && typeof metadata === 'object' ? { metadata } : {}),
          rules
        }
      });
      const updated = getObjectFromPayload(payload, resource.detailKey);
      if (updated) setRecord(updated);
      setShippingOptionState({
        saving: false,
        deleting: false,
        error: '',
        success: 'Shipping option updated.'
      });
    } catch (err) {
      setShippingOptionState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to update shipping option.',
        success: ''
      });
    }
  };

  const handleDeleteShippingOption = async () => {
    if (!record?.id) return;
    if (!window.confirm('Delete this shipping option?')) return;
    setShippingOptionState({ saving: false, deleting: true, error: '', success: '' });
    try {
      await request(`${resource.endpoint}/${record.id}`, { method: 'DELETE' });
      navigate(resource.path);
    } catch (err) {
      setShippingOptionState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to delete shipping option.',
        success: ''
      });
    }
  };

  const handleTaxRegionDraftChange = (field) => (event) => {
    const value = event.target.value;
    setTaxRegionDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveTaxRegion = async (event) => {
    event.preventDefault();
    if (!record?.id) return;
    const countryCode = taxRegionDraft.country_code.trim().toLowerCase();
    const provinceCode = taxRegionDraft.province_code.trim().toLowerCase();
    const providerId = taxRegionDraft.provider_id.trim();
    const parentId = taxRegionDraft.parent_id.trim();
    const { data: metadata, error: metadataError } = parseJsonInput(taxRegionDraft.metadata);

    if (!countryCode) {
      setTaxRegionState({
        saving: false,
        deleting: false,
        error: 'Country code is required.',
        success: ''
      });
      return;
    }

    if (metadataError) {
      setTaxRegionState({
        saving: false,
        deleting: false,
        error: `Metadata JSON error: ${metadataError}`,
        success: ''
      });
      return;
    }

    if (parentId && parentId === record.id) {
      setTaxRegionState({
        saving: false,
        deleting: false,
        error: 'Parent tax region cannot be the same as this region.',
        success: ''
      });
      return;
    }

    setTaxRegionState({ saving: true, deleting: false, error: '', success: '' });
    try {
      const payload = await request(`${resource.endpoint}/${record.id}`, {
        method: 'POST',
        body: {
          country_code: countryCode,
          province_code: provinceCode || undefined,
          provider_id: providerId || undefined,
          parent_id: parentId || null,
          ...(metadata && typeof metadata === 'object' ? { metadata } : {})
        }
      });
      const updated = getObjectFromPayload(payload, resource.detailKey);
      if (updated) setRecord(updated);
      setTaxRegionState({
        saving: false,
        deleting: false,
        error: '',
        success: 'Tax region updated.'
      });
    } catch (err) {
      setTaxRegionState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to update tax region.',
        success: ''
      });
    }
  };

  const handleDeleteTaxRegion = async () => {
    if (!record?.id) return;
    if (!window.confirm('Delete this tax region?')) return;
    setTaxRegionState({ saving: false, deleting: true, error: '', success: '' });
    try {
      await request(`${resource.endpoint}/${record.id}`, { method: 'DELETE' });
      navigate(resource.path);
    } catch (err) {
      setTaxRegionState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to delete tax region.',
        success: ''
      });
    }
  };

  const handleTaxRateDraftChange = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setTaxRateDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleTaxRateRuleToggle = (field, value) => {
    if (!value) return;
    setTaxRateRuleDraft((prev) => {
      const current = new Set(prev[field] || []);
      if (current.has(value)) {
        current.delete(value);
      } else {
        current.add(value);
      }
      return { ...prev, [field]: Array.from(current) };
    });
  };

  const handleTaxRateProductSearchChange = (event) => {
    const value = event.target.value;
    setTaxRateProductSearch((prev) => ({ ...prev, query: value }));
  };

  const handleSelectTaxRateProduct = (product) => {
    if (!product?.id) return;
    setTaxRateRuleDraft((prev) => {
      if (prev.product_ids.includes(product.id)) return prev;
      return { ...prev, product_ids: [...prev.product_ids, product.id] };
    });
    setTaxRateSelectedProducts((prev) => {
      if (prev.some((item) => item.id === product.id)) return prev;
      return [...prev, product];
    });
    setTaxRateProductSearch({ query: '', results: [], loading: false, error: '' });
  };

  const handleRemoveTaxRateProduct = (productId) => {
    setTaxRateRuleDraft((prev) => ({
      ...prev,
      product_ids: prev.product_ids.filter((id) => id !== productId)
    }));
    setTaxRateSelectedProducts((prev) => prev.filter((item) => item.id !== productId));
  };

  const handleSaveTaxRate = async (event) => {
    event.preventDefault();
    if (!record?.id) return;
    const name = taxRateDraft.name.trim();
    const code = taxRateDraft.code.trim();
    const rateInput = taxRateDraft.rate.trim();
    const rateValue = rateInput ? Number(rateInput) : null;
    const taxRegionId = taxRateDraft.tax_region_id.trim();
    const { data: metadata, error: metadataError } = parseJsonInput(taxRateDraft.metadata);
    const rules = buildTaxRateRules(taxRateRuleDraft);

    if (!name || !code || !taxRegionId) {
      setTaxRateState({
        saving: false,
        deleting: false,
        error: 'Name, code, and tax region are required.',
        success: ''
      });
      return;
    }

    if (rateInput && !Number.isFinite(rateValue)) {
      setTaxRateState({
        saving: false,
        deleting: false,
        error: 'Rate must be a number.',
        success: ''
      });
      return;
    }

    if (metadataError) {
      setTaxRateState({
        saving: false,
        deleting: false,
        error: `Metadata JSON error: ${metadataError}`,
        success: ''
      });
      return;
    }

    setTaxRateState({ saving: true, deleting: false, error: '', success: '' });
    try {
      const payload = await request(`${resource.endpoint}/${record.id}`, {
        method: 'POST',
        body: {
          name,
          code: code || undefined,
          rate: Number.isFinite(rateValue) ? rateValue : undefined,
          tax_region_id: taxRegionId,
          is_default: Boolean(taxRateDraft.is_default),
          is_combinable: Boolean(taxRateDraft.is_combinable),
          rules: rules.length ? rules : undefined,
          ...(metadata && typeof metadata === 'object' ? { metadata } : {})
        }
      });
      const updated = getObjectFromPayload(payload, resource.detailKey);
      if (updated) setRecord(updated);
      setTaxRateState({
        saving: false,
        deleting: false,
        error: '',
        success: 'Tax rate updated.'
      });
    } catch (err) {
      setTaxRateState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to update tax rate.',
        success: ''
      });
    }
  };

  const handleDeleteTaxRate = async () => {
    if (!record?.id) return;
    if (!window.confirm('Delete this tax rate?')) return;
    setTaxRateState({ saving: false, deleting: true, error: '', success: '' });
    try {
      await request(`${resource.endpoint}/${record.id}`, { method: 'DELETE' });
      navigate(resource.path);
    } catch (err) {
      setTaxRateState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to delete tax rate.',
        success: ''
      });
    }
  };

  const handleReturnReasonDraftChange = (field) => (event) => {
    const value = event.target.value;
    setReturnReasonDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveReturnReason = async (event) => {
    event.preventDefault();
    if (!record?.id) return;
    const value = returnReasonDraft.value.trim();
    const label = returnReasonDraft.label.trim();
    const description = returnReasonDraft.description.trim();
    const parentId = returnReasonDraft.parent_return_reason_id.trim();
    const { data: metadata, error: metadataError } = parseJsonInput(returnReasonDraft.metadata);

    if (!value || !label) {
      setReturnReasonState({
        saving: false,
        deleting: false,
        error: 'Value and label are required.',
        success: ''
      });
      return;
    }

    if (parentId && parentId === record.id) {
      setReturnReasonState({
        saving: false,
        deleting: false,
        error: 'Parent reason cannot be the same as this reason.',
        success: ''
      });
      return;
    }

    if (metadataError) {
      setReturnReasonState({
        saving: false,
        deleting: false,
        error: `Metadata JSON error: ${metadataError}`,
        success: ''
      });
      return;
    }

    setReturnReasonState({ saving: true, deleting: false, error: '', success: '' });
    try {
      const payload = await request(`${resource.endpoint}/${record.id}`, {
        method: 'POST',
        body: {
          value,
          label,
          description: description || null,
          parent_return_reason_id: parentId || null,
          ...(metadata && typeof metadata === 'object' ? { metadata } : {})
        }
      });
      const updated = getObjectFromPayload(payload, resource.detailKey);
      if (updated) setRecord(updated);
      setReturnReasonState({
        saving: false,
        deleting: false,
        error: '',
        success: 'Return reason updated.'
      });
    } catch (err) {
      setReturnReasonState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to update return reason.',
        success: ''
      });
    }
  };

  const handleDeleteReturnReason = async () => {
    if (!record?.id) return;
    if (!window.confirm('Delete this return reason?')) return;
    setReturnReasonState({ saving: false, deleting: true, error: '', success: '' });
    try {
      await request(`${resource.endpoint}/${record.id}`, { method: 'DELETE' });
      navigate(resource.path);
    } catch (err) {
      setReturnReasonState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to delete return reason.',
        success: ''
      });
    }
  };

  const handleRefundReasonDraftChange = (field) => (event) => {
    const value = event.target.value;
    setRefundReasonDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveRefundReason = async (event) => {
    event.preventDefault();
    if (!record?.id) return;
    const label = refundReasonDraft.label.trim();
    const code = refundReasonDraft.code.trim();
    const description = refundReasonDraft.description.trim();

    if (!label || !code) {
      setRefundReasonState({
        saving: false,
        deleting: false,
        error: 'Label and code are required.',
        success: ''
      });
      return;
    }

    setRefundReasonState({ saving: true, deleting: false, error: '', success: '' });
    try {
      const payload = await request(`${resource.endpoint}/${record.id}`, {
        method: 'POST',
        body: {
          label,
          code,
          description: description || null
        }
      });
      const updated = getObjectFromPayload(payload, resource.detailKey);
      if (updated) setRecord(updated);
      setRefundReasonState({
        saving: false,
        deleting: false,
        error: '',
        success: 'Refund reason updated.'
      });
    } catch (err) {
      setRefundReasonState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to update refund reason.',
        success: ''
      });
    }
  };

  const handleDeleteRefundReason = async () => {
    if (!record?.id) return;
    if (!window.confirm('Delete this refund reason?')) return;
    setRefundReasonState({ saving: false, deleting: true, error: '', success: '' });
    try {
      await request(`${resource.endpoint}/${record.id}`, { method: 'DELETE' });
      navigate(resource.path);
    } catch (err) {
      setRefundReasonState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to delete refund reason.',
        success: ''
      });
    }
  };

  const handleInventoryItemDraftChange = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setInventoryItemDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveInventoryItem = async (event) => {
    event.preventDefault();
    if (!record?.id) return;
    const title = inventoryItemDraft.title.trim();
    const sku = inventoryItemDraft.sku.trim();
    const description = inventoryItemDraft.description.trim();
    const material = inventoryItemDraft.material.trim();
    const hsCode = inventoryItemDraft.hs_code.trim();
    const originCountry = inventoryItemDraft.origin_country.trim();
    const midCode = inventoryItemDraft.mid_code.trim();
    const thumbnail = inventoryItemDraft.thumbnail.trim();
    const weightResult = parseNullableNumberInput(inventoryItemDraft.weight);
    const lengthResult = parseNullableNumberInput(inventoryItemDraft.length);
    const heightResult = parseNullableNumberInput(inventoryItemDraft.height);
    const widthResult = parseNullableNumberInput(inventoryItemDraft.width);
    const { data: metadata, error: metadataError } = parseJsonInput(inventoryItemDraft.metadata);

    if (weightResult.error || lengthResult.error || heightResult.error || widthResult.error) {
      setInventoryItemState({
        saving: false,
        deleting: false,
        error: 'Weight, length, height, and width must be valid numbers.',
        success: ''
      });
      return;
    }

    if (metadataError) {
      setInventoryItemState({
        saving: false,
        deleting: false,
        error: `Metadata JSON error: ${metadataError}`,
        success: ''
      });
      return;
    }

    setInventoryItemState({ saving: true, deleting: false, error: '', success: '' });
    try {
      const payload = await request(`${resource.endpoint}/${record.id}`, {
        method: 'POST',
        body: {
          title: title || null,
          sku: sku || null,
          description: description || null,
          material: material || null,
          hs_code: hsCode || null,
          origin_country: originCountry || null,
          mid_code: midCode || null,
          thumbnail: thumbnail || null,
          requires_shipping: Boolean(inventoryItemDraft.requires_shipping),
          ...(weightResult.value != null ? { weight: weightResult.value } : {}),
          ...(lengthResult.value != null ? { length: lengthResult.value } : {}),
          ...(heightResult.value != null ? { height: heightResult.value } : {}),
          ...(widthResult.value != null ? { width: widthResult.value } : {}),
          ...(metadata && typeof metadata === 'object' ? { metadata } : {})
        }
      });
      applyInventoryItemPayload(payload);
      setInventoryItemState({
        saving: false,
        deleting: false,
        error: '',
        success: 'Inventory item updated.'
      });
    } catch (err) {
      setInventoryItemState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to update inventory item.',
        success: ''
      });
    }
  };

  const handleDeleteInventoryItem = async () => {
    if (!record?.id) return;
    if (!window.confirm('Delete this inventory item?')) return;
    setInventoryItemState({ saving: false, deleting: true, error: '', success: '' });
    try {
      await request(`${resource.endpoint}/${record.id}`, { method: 'DELETE' });
      navigate(resource.path);
    } catch (err) {
      setInventoryItemState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to delete inventory item.',
        success: ''
      });
    }
  };

  const handleInventoryLevelDraftChange = (field) => (event) => {
    const value = event.target.value;
    setInventoryLevelDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleCreateInventoryLevel = async (event) => {
    event.preventDefault();
    if (!record?.id) return;
    const locationId = inventoryLevelDraft.location_id.trim();
    const stockedResult = parseNullableNumberInput(inventoryLevelDraft.stocked_quantity);
    const incomingResult = parseNullableNumberInput(inventoryLevelDraft.incoming_quantity);

    if (!locationId) {
      setInventoryLevelState({
        savingId: null,
        deletingId: null,
        creating: false,
        error: 'Select a stock location.',
        success: ''
      });
      return;
    }

    if (stockedResult.error || incomingResult.error) {
      setInventoryLevelState({
        savingId: null,
        deletingId: null,
        creating: false,
        error: 'Stocked and incoming quantities must be valid numbers.',
        success: ''
      });
      return;
    }

    if (
      (stockedResult.value != null && stockedResult.value < 0) ||
      (incomingResult.value != null && incomingResult.value < 0)
    ) {
      setInventoryLevelState({
        savingId: null,
        deletingId: null,
        creating: false,
        error: 'Quantities cannot be negative.',
        success: ''
      });
      return;
    }

    setInventoryLevelState({ savingId: null, deletingId: null, creating: true, error: '', success: '' });
    try {
      const payload = await request(
        `/admin/inventory-items/${record.id}/location-levels`,
        {
          method: 'POST',
          body: {
            location_id: locationId,
            ...(stockedResult.value != null ? { stocked_quantity: stockedResult.value } : {}),
            ...(incomingResult.value != null ? { incoming_quantity: incomingResult.value } : {})
          }
        }
      );
      applyInventoryItemPayload(payload);
      setInventoryLevelDraft({ location_id: '', stocked_quantity: '', incoming_quantity: '' });
      setInventoryLevelState({
        savingId: null,
        deletingId: null,
        creating: false,
        error: '',
        success: 'Stock level created.'
      });
    } catch (err) {
      setInventoryLevelState({
        savingId: null,
        deletingId: null,
        creating: false,
        error: err?.message || 'Unable to create stock level.',
        success: ''
      });
    }
  };

  const handleInventoryAdjustmentChange = (locationId, field) => (event) => {
    const value = event.target.value;
    setInventoryAdjustments((prev) => ({
      ...prev,
      [locationId]: { ...(prev[locationId] || {}), [field]: value }
    }));
  };

  const handleApplyInventoryAdjustment = async (locationId) => {
    if (!record?.id) return;
    const levels = Array.isArray(record?.location_levels) ? record.location_levels : [];
    const level = levels.find((entry) => entry?.location_id === locationId);
    if (!level) {
      setInventoryLevelState({
        savingId: null,
        deletingId: null,
        creating: false,
        error: 'Inventory level not found for this location.',
        success: ''
      });
      return;
    }

    const adjustment = inventoryAdjustments[locationId] || {};
    const stockedDelta = parseNullableNumberInput(adjustment.stocked_quantity);
    const incomingDelta = parseNullableNumberInput(adjustment.incoming_quantity);

    if (stockedDelta.error || incomingDelta.error) {
      setInventoryLevelState({
        savingId: null,
        deletingId: null,
        creating: false,
        error: 'Adjustments must be valid numbers.',
        success: ''
      });
      return;
    }

    if (stockedDelta.value == null && incomingDelta.value == null) {
      setInventoryLevelState({
        savingId: null,
        deletingId: null,
        creating: false,
        error: 'Enter an adjustment for stocked or incoming quantities.',
        success: ''
      });
      return;
    }

    const currentStocked = toNumber(level.stocked_quantity) ?? 0;
    const currentIncoming = toNumber(level.incoming_quantity) ?? 0;
    const currentReserved = toNumber(level.reserved_quantity) ?? 0;
    const nextStocked =
      stockedDelta.value != null ? currentStocked + stockedDelta.value : null;
    const nextIncoming =
      incomingDelta.value != null ? currentIncoming + incomingDelta.value : null;

    if (nextStocked != null && nextStocked < currentReserved) {
      setInventoryLevelState({
        savingId: null,
        deletingId: null,
        creating: false,
        error: `Stocked quantity cannot be lower than reserved quantity (${currentReserved}).`,
        success: ''
      });
      return;
    }

    if (
      (nextStocked != null && nextStocked < 0) ||
      (nextIncoming != null && nextIncoming < 0)
    ) {
      setInventoryLevelState({
        savingId: null,
        deletingId: null,
        creating: false,
        error: 'Adjustments cannot result in negative quantities.',
        success: ''
      });
      return;
    }

    setInventoryLevelState({ savingId: locationId, deletingId: null, creating: false, error: '', success: '' });
    try {
      const payload = await request(
        `/admin/inventory-items/${record.id}/location-levels/${locationId}`,
        {
          method: 'POST',
          body: {
            ...(nextStocked != null ? { stocked_quantity: nextStocked } : {}),
            ...(nextIncoming != null ? { incoming_quantity: nextIncoming } : {})
          }
        }
      );
      applyInventoryItemPayload(payload);
      setInventoryAdjustments((prev) => ({
        ...prev,
        [locationId]: { stocked_quantity: '', incoming_quantity: '' }
      }));
      setInventoryLevelState({
        savingId: null,
        deletingId: null,
        creating: false,
        error: '',
        success: 'Inventory adjusted.'
      });
    } catch (err) {
      setInventoryLevelState({
        savingId: null,
        deletingId: null,
        creating: false,
        error: err?.message || 'Unable to adjust inventory.',
        success: ''
      });
    }
  };

  const handleDeleteInventoryLevel = async (locationId) => {
    if (!record?.id) return;
    if (!window.confirm('Remove this location level?')) return;
    setInventoryLevelState({ savingId: null, deletingId: locationId, creating: false, error: '', success: '' });
    try {
      const payload = await request(
        `/admin/inventory-items/${record.id}/location-levels/${locationId}`,
        { method: 'DELETE' }
      );
      applyInventoryItemPayload(payload);
      setInventoryLevelState({
        savingId: null,
        deletingId: null,
        creating: false,
        error: '',
        success: 'Location level removed.'
      });
    } catch (err) {
      setInventoryLevelState({
        savingId: null,
        deletingId: null,
        creating: false,
        error: err?.message || 'Unable to remove location level.',
        success: ''
      });
    }
  };

  const handleInventoryReservationDraftChange = (field) => (event) => {
    const value = event.target.value;
    setInventoryReservationDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleCreateInventoryReservation = async (event) => {
    event.preventDefault();
    if (!record?.id) return;
    const locationId = inventoryReservationDraft.location_id.trim();
    const description = inventoryReservationDraft.description.trim();
    const quantityResult = parseNullableNumberInput(inventoryReservationDraft.quantity);

    if (!locationId) {
      setInventoryReservationState({
        saving: false,
        error: 'Select a stock location.',
        success: ''
      });
      return;
    }

    if (quantityResult.error || quantityResult.value == null || quantityResult.value <= 0) {
      setInventoryReservationState({
        saving: false,
        error: 'Quantity must be a positive number.',
        success: ''
      });
      return;
    }

    setInventoryReservationState({ saving: true, error: '', success: '' });
    try {
      await request('/admin/reservations', {
        method: 'POST',
        body: {
          inventory_item_id: record.id,
          location_id: locationId,
          quantity: quantityResult.value,
          description: description || undefined
        }
      });
      setInventoryReservationDraft({ location_id: '', quantity: '', description: '' });
      setInventoryReservationState({ saving: false, error: '', success: 'Reservation created.' });
      await refreshInventoryReservations();
      await refreshInventoryItem();
    } catch (err) {
      setInventoryReservationState({
        saving: false,
        error: err?.message || 'Unable to create reservation.',
        success: ''
      });
    }
  };

  const handleDeleteInventoryReservation = async (reservationId) => {
    if (!reservationId) return;
    if (!window.confirm('Delete this reservation?')) return;
    try {
      await request(`/admin/reservations/${reservationId}`, { method: 'DELETE' });
      await refreshInventoryReservations();
      await refreshInventoryItem();
    } catch (err) {
      setInventoryReservationsError(err?.message || 'Unable to delete reservation.');
    }
  };

  const handleStockLocationDraftChange = (field) => (event) => {
    const value = event.target.value;
    setStockLocationDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveStockLocation = async (event) => {
    event.preventDefault();
    if (!record?.id) return;
    const name = stockLocationDraft.name.trim();
    const address1 = stockLocationDraft.address_1.trim();
    const address2 = stockLocationDraft.address_2.trim();
    const city = stockLocationDraft.city.trim();
    const province = stockLocationDraft.province.trim();
    const postalCode = stockLocationDraft.postal_code.trim();
    const countryCode = stockLocationDraft.country_code.trim();
    const phone = stockLocationDraft.phone.trim();
    const { data: metadata, error: metadataError } = parseJsonInput(stockLocationDraft.metadata);

    if (metadataError) {
      setStockLocationState({
        saving: false,
        deleting: false,
        error: `Metadata JSON error: ${metadataError}`,
        success: ''
      });
      return;
    }

    const hasAddressFields =
      address1 || address2 || city || province || postalCode || countryCode || phone;
    if (hasAddressFields && (!address1 || !countryCode)) {
      setStockLocationState({
        saving: false,
        deleting: false,
        error: 'Address line 1 and country code are required when setting an address.',
        success: ''
      });
      return;
    }

    const addressPayload = hasAddressFields
      ? {
          address_1: address1,
          address_2: address2 || null,
          city: city || null,
          province: province || null,
          postal_code: postalCode || null,
          country_code: countryCode,
          phone: phone || null
        }
      : undefined;

    setStockLocationState({ saving: true, deleting: false, error: '', success: '' });
    try {
      const payload = await request(`${resource.endpoint}/${record.id}`, {
        method: 'POST',
        body: {
          name: name || undefined,
          ...(addressPayload ? { address: addressPayload } : {}),
          ...(metadata && typeof metadata === 'object' ? { metadata } : {})
        }
      });
      const updated = getObjectFromPayload(payload, resource.detailKey);
      if (updated) setRecord(updated);
      setStockLocationState({
        saving: false,
        deleting: false,
        error: '',
        success: 'Stock location updated.'
      });
    } catch (err) {
      setStockLocationState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to update stock location.',
        success: ''
      });
    }
  };

  const handleDeleteStockLocation = async () => {
    if (!record?.id) return;
    if (!window.confirm('Delete this stock location?')) return;
    setStockLocationState({ saving: false, deleting: true, error: '', success: '' });
    try {
      await request(`${resource.endpoint}/${record.id}`, { method: 'DELETE' });
      navigate(resource.path);
    } catch (err) {
      setStockLocationState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to delete stock location.',
        success: ''
      });
    }
  };

  const handleStockLocationInventorySearchChange = (event) => {
    setStockLocationInventoryQuery(event.target.value);
  };

  const handleStockLocationInventorySearch = (event) => {
    event.preventDefault();
    const nextQuery = stockLocationInventoryQuery.trim();
    setStockLocationInventorySearch(nextQuery);
  };

  const handleClearStockLocationInventorySearch = () => {
    setStockLocationInventoryQuery('');
    setStockLocationInventorySearch('');
  };

  const buildEmptyServiceZoneDraft = () => ({
    name: '',
    geo_zones: [buildGeoZoneDraft()]
  });

  const updateServiceZoneDraftState = (setter, key, updater) => {
    setter((prev) => {
      const current = prev[key] || buildEmptyServiceZoneDraft();
      return { ...prev, [key]: updater(current) };
    });
  };

  const handleFulfillmentSetDraftChange = (field) => (event) => {
    const value = event.target.value;
    setFulfillmentSetDraft((prev) => ({ ...prev, [field]: value }));
  };

  const normalizeGeoZones = (drafts = []) => {
    const zones = [];
    for (let index = 0; index < drafts.length; index += 1) {
      const draft = drafts[index] || {};
      const type = (draft.type || 'country').trim();
      const country = String(draft.country_code || '').trim().toLowerCase();
      const province = String(draft.province_code || '').trim().toLowerCase();
      const city = String(draft.city || '').trim();
      const postalExpression = String(draft.postal_expression || '').trim();
      const hasData = country || province || city || postalExpression;
      if (!hasData) continue;
      if (!country) {
        return { zones: [], error: `Geo zone ${index + 1}: country code is required.` };
      }
      if (['province', 'city', 'zip'].includes(type) && !province) {
        return { zones: [], error: `Geo zone ${index + 1}: province code is required.` };
      }
      if (['city', 'zip'].includes(type) && !city) {
        return { zones: [], error: `Geo zone ${index + 1}: city is required.` };
      }
      const payload = {
        type,
        country_code: country,
        ...(province ? { province_code: province } : {}),
        ...(city ? { city } : {})
      };
      if (type === 'zip') {
        const { data, error } = parseJsonInput(postalExpression || '{}');
        if (error) {
          return { zones: [], error: `Geo zone ${index + 1}: postal expression ${error}` };
        }
        payload.postal_expression = data || {};
      }
      if (draft.id) payload.id = draft.id;
      zones.push(payload);
    }
    return { zones, error: '' };
  };

  const handleCreateFulfillmentSet = async (event) => {
    event.preventDefault();
    if (!record?.id) return;
    const name = fulfillmentSetDraft.name.trim();
    const type = fulfillmentSetDraft.type.trim();
    if (!name || !type) {
      setFulfillmentSetState({
        saving: false,
        deletingId: null,
        error: 'Name and type are required.',
        success: ''
      });
      return;
    }
    setFulfillmentSetState({ saving: true, deletingId: null, error: '', success: '' });
    try {
      await request(`/admin/stock-locations/${record.id}/fulfillment-sets`, {
        method: 'POST',
        body: { name, type }
      });
      setFulfillmentSetDraft({ name: '', type: '' });
      setFulfillmentSetState({
        saving: false,
        deletingId: null,
        error: '',
        success: 'Fulfillment set created.'
      });
      await refreshStockLocation();
    } catch (err) {
      setFulfillmentSetState({
        saving: false,
        deletingId: null,
        error: err?.message || 'Unable to create fulfillment set.',
        success: ''
      });
    }
  };

  const handleDeleteFulfillmentSet = async (setId) => {
    if (!setId) return;
    if (!window.confirm('Delete this fulfillment set?')) return;
    setFulfillmentSetState({ saving: false, deletingId: setId, error: '', success: '' });
    try {
      await request(`/admin/fulfillment-sets/${setId}`, { method: 'DELETE' });
      setFulfillmentSetState({
        saving: false,
        deletingId: null,
        error: '',
        success: 'Fulfillment set deleted.'
      });
      await refreshStockLocation();
    } catch (err) {
      setFulfillmentSetState({
        saving: false,
        deletingId: null,
        error: err?.message || 'Unable to delete fulfillment set.',
        success: ''
      });
    }
  };

  const handleServiceZoneDraftChange = (setId, field) => (event) => {
    const value = event.target.value;
    updateServiceZoneDraftState(setServiceZoneDrafts, setId, (current) => ({
      ...current,
      [field]: value
    }));
  };

  const handleServiceZoneGeoZoneChange = (setId, index, field) => (event) => {
    const value = event.target.value;
    updateServiceZoneDraftState(setServiceZoneDrafts, setId, (current) => {
      const zones = Array.isArray(current.geo_zones) ? [...current.geo_zones] : [];
      zones[index] = { ...(zones[index] || buildGeoZoneDraft()), [field]: value };
      return { ...current, geo_zones: zones };
    });
  };

  const handleAddServiceZoneGeoZone = (setId) => {
    updateServiceZoneDraftState(setServiceZoneDrafts, setId, (current) => ({
      ...current,
      geo_zones: [...(current.geo_zones || []), buildGeoZoneDraft()]
    }));
  };

  const handleRemoveServiceZoneGeoZone = (setId, index) => {
    updateServiceZoneDraftState(setServiceZoneDrafts, setId, (current) => {
      const zones = Array.isArray(current.geo_zones) ? [...current.geo_zones] : [];
      zones.splice(index, 1);
      return { ...current, geo_zones: zones };
    });
  };

  const handleStartServiceZoneEdit = (zone) => {
    if (!zone?.id) return;
    setServiceZoneEdits((prev) => ({ ...prev, [zone.id]: buildServiceZoneDraft(zone) }));
  };

  const handleCancelServiceZoneEdit = (zoneId) => {
    if (!zoneId) return;
    setServiceZoneEdits((prev) => {
      const next = { ...prev };
      delete next[zoneId];
      return next;
    });
  };

  const handleServiceZoneEditChange = (zoneId, field) => (event) => {
    const value = event.target.value;
    updateServiceZoneDraftState(setServiceZoneEdits, zoneId, (current) => ({
      ...current,
      [field]: value
    }));
  };

  const handleServiceZoneEditGeoZoneChange = (zoneId, index, field) => (event) => {
    const value = event.target.value;
    updateServiceZoneDraftState(setServiceZoneEdits, zoneId, (current) => {
      const zones = Array.isArray(current.geo_zones) ? [...current.geo_zones] : [];
      zones[index] = { ...(zones[index] || buildGeoZoneDraft()), [field]: value };
      return { ...current, geo_zones: zones };
    });
  };

  const handleAddServiceZoneEditGeoZone = (zoneId) => {
    updateServiceZoneDraftState(setServiceZoneEdits, zoneId, (current) => ({
      ...current,
      geo_zones: [...(current.geo_zones || []), buildGeoZoneDraft()]
    }));
  };

  const handleRemoveServiceZoneEditGeoZone = (zoneId, index) => {
    updateServiceZoneDraftState(setServiceZoneEdits, zoneId, (current) => {
      const zones = Array.isArray(current.geo_zones) ? [...current.geo_zones] : [];
      zones.splice(index, 1);
      return { ...current, geo_zones: zones };
    });
  };

  const handleCreateServiceZone = async (setId) => {
    const draft = serviceZoneDrafts[setId] || buildEmptyServiceZoneDraft();
    const name = draft.name.trim();
    if (!name) {
      setServiceZoneState({
        savingId: null,
        deletingId: null,
        error: 'Service zone name is required.',
        success: ''
      });
      return;
    }
    const { zones, error } = normalizeGeoZones(draft.geo_zones || []);
    if (error) {
      setServiceZoneState({ savingId: null, deletingId: null, error, success: '' });
      return;
    }
    setServiceZoneState({ savingId: setId, deletingId: null, error: '', success: '' });
    try {
      await request(`/admin/fulfillment-sets/${setId}/service-zones`, {
        method: 'POST',
        body: {
          name,
          ...(zones.length ? { geo_zones: zones } : {})
        }
      });
      setServiceZoneDrafts((prev) => ({ ...prev, [setId]: buildEmptyServiceZoneDraft() }));
      setServiceZoneState({
        savingId: null,
        deletingId: null,
        error: '',
        success: 'Service zone created.'
      });
      await refreshStockLocation();
    } catch (err) {
      setServiceZoneState({
        savingId: null,
        deletingId: null,
        error: err?.message || 'Unable to create service zone.',
        success: ''
      });
    }
  };

  const handleSaveServiceZoneEdit = async (setId, zoneId) => {
    const draft = serviceZoneEdits[zoneId];
    if (!draft) return;
    const name = draft.name.trim();
    const { zones, error } = normalizeGeoZones(draft.geo_zones || []);
    if (error) {
      setServiceZoneState({ savingId: null, deletingId: null, error, success: '' });
      return;
    }
    setServiceZoneState({ savingId: zoneId, deletingId: null, error: '', success: '' });
    try {
      await request(`/admin/fulfillment-sets/${setId}/service-zones/${zoneId}`, {
        method: 'POST',
        body: {
          ...(name ? { name } : {}),
          ...(zones.length ? { geo_zones: zones } : {})
        }
      });
      setServiceZoneState({
        savingId: null,
        deletingId: null,
        error: '',
        success: 'Service zone updated.'
      });
      handleCancelServiceZoneEdit(zoneId);
      await refreshStockLocation();
    } catch (err) {
      setServiceZoneState({
        savingId: null,
        deletingId: null,
        error: err?.message || 'Unable to update service zone.',
        success: ''
      });
    }
  };

  const handleDeleteServiceZone = async (setId, zoneId) => {
    if (!zoneId) return;
    if (!window.confirm('Delete this service zone?')) return;
    setServiceZoneState({ savingId: null, deletingId: zoneId, error: '', success: '' });
    try {
      await request(`/admin/fulfillment-sets/${setId}/service-zones/${zoneId}`, { method: 'DELETE' });
      setServiceZoneState({
        savingId: null,
        deletingId: null,
        error: '',
        success: 'Service zone deleted.'
      });
      await refreshStockLocation();
    } catch (err) {
      setServiceZoneState({
        savingId: null,
        deletingId: null,
        error: err?.message || 'Unable to delete service zone.',
        success: ''
      });
    }
  };

  const updateStockLocationSalesChannels = async ({ add = [], remove = [] }) => {
    await request(`/admin/stock-locations/${record.id}/sales-channels`, {
      method: 'POST',
      body: {
        ...(add.length ? { add } : {}),
        ...(remove.length ? { remove } : {})
      }
    });
  };

  const handleAddStockLocationSalesChannel = async (channelId) => {
    if (!record?.id || !channelId) return;
    setLocationSalesChannelState({ savingId: channelId, error: '', success: '' });
    try {
      await updateStockLocationSalesChannels({ add: [channelId] });
      setLocationSalesChannelState({
        savingId: null,
        error: '',
        success: 'Sales channel added.'
      });
      await refreshStockLocation();
    } catch (err) {
      setLocationSalesChannelState({
        savingId: null,
        error: err?.message || 'Unable to update sales channels.',
        success: ''
      });
    }
  };

  const handleRemoveStockLocationSalesChannel = async (channelId) => {
    if (!record?.id || !channelId) return;
    setLocationSalesChannelState({ savingId: channelId, error: '', success: '' });
    try {
      await updateStockLocationSalesChannels({ remove: [channelId] });
      setLocationSalesChannelState({
        savingId: null,
        error: '',
        success: 'Sales channel removed.'
      });
      await refreshStockLocation();
    } catch (err) {
      setLocationSalesChannelState({
        savingId: null,
        error: err?.message || 'Unable to update sales channels.',
        success: ''
      });
    }
  };

  const updateStockLocationFulfillmentProviders = async ({ add = [], remove = [] }) => {
    await request(`/admin/stock-locations/${record.id}/fulfillment-providers`, {
      method: 'POST',
      body: {
        ...(add.length ? { add } : {}),
        ...(remove.length ? { remove } : {})
      }
    });
  };

  const handleAddStockLocationFulfillmentProvider = async (providerId) => {
    if (!record?.id || !providerId) return;
    setLocationProviderState({ savingId: providerId, error: '', success: '' });
    try {
      await updateStockLocationFulfillmentProviders({ add: [providerId] });
      setLocationProviderState({
        savingId: null,
        error: '',
        success: 'Fulfillment provider added.'
      });
      await refreshStockLocation();
    } catch (err) {
      setLocationProviderState({
        savingId: null,
        error: err?.message || 'Unable to update fulfillment providers.',
        success: ''
      });
    }
  };

  const handleRemoveStockLocationFulfillmentProvider = async (providerId) => {
    if (!record?.id || !providerId) return;
    setLocationProviderState({ savingId: providerId, error: '', success: '' });
    try {
      await updateStockLocationFulfillmentProviders({ remove: [providerId] });
      setLocationProviderState({
        savingId: null,
        error: '',
        success: 'Fulfillment provider removed.'
      });
      await refreshStockLocation();
    } catch (err) {
      setLocationProviderState({
        savingId: null,
        error: err?.message || 'Unable to update fulfillment providers.',
        success: ''
      });
    }
  };

  const handleUserDraftChange = (field) => (event) => {
    const value = event.target.value;
    setUserDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveUser = async (event) => {
    event.preventDefault();
    if (!record?.id) return;
    const firstName = userDraft.first_name.trim();
    const lastName = userDraft.last_name.trim();
    const avatarUrl = userDraft.avatar_url.trim();
    const role = userDraft.role.trim();
    const { data: metadata, error: metadataError } = parseJsonInput(userDraft.metadata);

    if (metadataError) {
      setUserState({
        saving: false,
        deleting: false,
        error: `Metadata JSON error: ${metadataError}`,
        success: ''
      });
      return;
    }

    setUserState({ saving: true, deleting: false, error: '', success: '' });
    try {
      const hasRoleField = Object.prototype.hasOwnProperty.call(record, 'role');
      const nextMetadata = metadata && typeof metadata === 'object' ? { ...metadata } : {};
      if (!hasRoleField) {
        if (role) {
          nextMetadata.role = role;
        } else if ('role' in nextMetadata) {
          delete nextMetadata.role;
        }
      }
      const payload = await request(`${resource.endpoint}/${record.id}`, {
        method: 'POST',
        body: {
          first_name: firstName || null,
          last_name: lastName || null,
          avatar_url: avatarUrl || null,
          ...(hasRoleField && role ? { role } : {}),
          ...(Object.keys(nextMetadata).length ? { metadata: nextMetadata } : {})
        }
      });
      const updated = getObjectFromPayload(payload, resource.detailKey);
      if (updated) setRecord(updated);
      setUserState({
        saving: false,
        deleting: false,
        error: '',
        success: 'User updated.'
      });
    } catch (err) {
      setUserState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to update user.',
        success: ''
      });
    }
  };

  const handleDeleteUser = async () => {
    if (!record?.id) return;
    if (!window.confirm('Delete this user?')) return;
    setUserState({ saving: false, deleting: true, error: '', success: '' });
    try {
      await request(`${resource.endpoint}/${record.id}`, { method: 'DELETE' });
      navigate(resource.path);
    } catch (err) {
      setUserState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to delete user.',
        success: ''
      });
    }
  };

  const handleDeleteInvite = async () => {
    if (!record?.id) return;
    if (!window.confirm('Cancel this invite?')) return;
    setInviteState({ deleting: true, error: '', success: '' });
    try {
      await request(`${resource.endpoint}/${record.id}`, { method: 'DELETE' });
      setInviteState({ deleting: false, error: '', success: 'Invite canceled.' });
      navigate(resource.path);
    } catch (err) {
      setInviteState({
        deleting: false,
        error: err?.message || 'Unable to cancel invite.',
        success: ''
      });
    }
  };

  const handleApiKeyDraftChange = (field) => (event) => {
    const value = event.target.value;
    setApiKeyDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveApiKey = async (event) => {
    event.preventDefault();
    if (!record?.id) return;
    const title = apiKeyDraft.title.trim();

    if (!title) {
      setApiKeyState({
        saving: false,
        deleting: false,
        revoking: false,
        error: 'Title is required.',
        success: ''
      });
      return;
    }

    setApiKeyState({ saving: true, deleting: false, revoking: false, error: '', success: '' });
    try {
      const payload = await request(`${resource.endpoint}/${record.id}`, {
        method: 'POST',
        body: { title }
      });
      const updated = getObjectFromPayload(payload, resource.detailKey);
      if (updated) setRecord(updated);
      setApiKeyState({
        saving: false,
        deleting: false,
        revoking: false,
        error: '',
        success: 'API key updated.'
      });
    } catch (err) {
      setApiKeyState({
        saving: false,
        deleting: false,
        revoking: false,
        error: err?.message || 'Unable to update API key.',
        success: ''
      });
    }
  };

  const handleRevokeApiKey = async () => {
    if (!record?.id) return;
    if (!window.confirm('Revoke this API key?')) return;
    const revokeInResult = parseNullableNumberInput(apiKeyDraft.revoke_in);
    if (revokeInResult.error) {
      setApiKeyState({
        saving: false,
        deleting: false,
        revoking: false,
        error: 'Revoke delay must be a number.',
        success: ''
      });
      return;
    }

    setApiKeyState({ saving: false, deleting: false, revoking: true, error: '', success: '' });
    try {
      const payload = await request(`/admin/api-keys/${record.id}/revoke`, {
        method: 'POST',
        body: {
          ...(revokeInResult.value != null ? { revoke_in: revokeInResult.value } : {})
        }
      });
      const updated = getObjectFromPayload(payload, resource.detailKey);
      if (updated) setRecord(updated);
      setApiKeyState({
        saving: false,
        deleting: false,
        revoking: false,
        error: '',
        success: 'API key revoked.'
      });
    } catch (err) {
      setApiKeyState({
        saving: false,
        deleting: false,
        revoking: false,
        error: err?.message || 'Unable to revoke API key.',
        success: ''
      });
    }
  };

  const handleDeleteApiKey = async () => {
    if (!record?.id) return;
    if (!window.confirm('Delete this API key?')) return;
    setApiKeyState({ saving: false, deleting: true, revoking: false, error: '', success: '' });
    try {
      await request(`${resource.endpoint}/${record.id}`, { method: 'DELETE' });
      navigate(resource.path);
    } catch (err) {
      setApiKeyState({
        saving: false,
        deleting: false,
        revoking: false,
        error: err?.message || 'Unable to delete API key.',
        success: ''
      });
    }
  };

  const handleStoreDraftChange = (field) => (event) => {
    const value = event.target.value;
    setStoreDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleAddStoreCurrency = () => {
    const code = storeCurrencyInput.trim().toLowerCase();
    if (!code) return;
    setStoreDraft((prev) => {
      if (prev.supported_currencies.some((entry) => entry.currency_code === code)) return prev;
      const next = [
        ...prev.supported_currencies,
        { currency_code: code, is_default: prev.supported_currencies.length === 0, is_tax_inclusive: false }
      ];
      return { ...prev, supported_currencies: next };
    });
    setStoreCurrencyInput('');
  };

  const handleRemoveStoreCurrency = (code) => {
    if (!code) return;
    setStoreDraft((prev) => {
      const next = prev.supported_currencies.filter((entry) => entry.currency_code !== code);
      if (next.length && !next.some((entry) => entry.is_default)) {
        next[0].is_default = true;
      }
      return { ...prev, supported_currencies: next };
    });
  };

  const handleToggleStoreDefaultCurrency = (code) => {
    if (!code) return;
    setStoreDraft((prev) => ({
      ...prev,
      supported_currencies: prev.supported_currencies.map((entry) => ({
        ...entry,
        is_default: entry.currency_code === code
      }))
    }));
  };

  const handleToggleStoreTaxInclusive = (code) => {
    if (!code) return;
    setStoreDraft((prev) => ({
      ...prev,
      supported_currencies: prev.supported_currencies.map((entry) =>
        entry.currency_code === code
          ? { ...entry, is_tax_inclusive: !entry.is_tax_inclusive }
          : entry
      )
    }));
  };

  const handleAddStoreLocale = () => {
    const code = storeLocaleInput.trim();
    if (!code) return;
    setStoreDraft((prev) => {
      if (prev.supported_locales.some((entry) => entry.locale_code === code)) return prev;
      return {
        ...prev,
        supported_locales: [...prev.supported_locales, { locale_code: code }]
      };
    });
    setStoreLocaleInput('');
  };

  const handleRemoveStoreLocale = (code) => {
    if (!code) return;
    setStoreDraft((prev) => ({
      ...prev,
      supported_locales: prev.supported_locales.filter((entry) => entry.locale_code !== code)
    }));
  };

  const handleSaveStore = async (event) => {
    event.preventDefault();
    if (!record?.id) return;
    const name = storeDraft.name.trim();
    const { data: metadata, error: metadataError } = parseJsonInput(storeDraft.metadata);
    if (metadataError) {
      setStoreState({
        saving: false,
        error: `Metadata JSON error: ${metadataError}`,
        success: ''
      });
      return;
    }

    const supportedCurrencies = storeDraft.supported_currencies
      .map((entry) => ({
        currency_code: String(entry.currency_code || '').trim().toLowerCase(),
        is_default: Boolean(entry.is_default),
        is_tax_inclusive: Boolean(entry.is_tax_inclusive)
      }))
      .filter((entry) => entry.currency_code);

    if (supportedCurrencies.length && !supportedCurrencies.some((entry) => entry.is_default)) {
      supportedCurrencies[0].is_default = true;
    }

    const supportedLocales = storeDraft.supported_locales
      .map((entry) => ({
        locale_code: String(entry.locale_code || '').trim()
      }))
      .filter((entry) => entry.locale_code);

    setStoreState({ saving: true, error: '', success: '' });
    try {
      const payload = await request(`${resource.endpoint}/${record.id}`, {
        method: 'POST',
        body: {
          name: name || undefined,
          default_sales_channel_id: storeDraft.default_sales_channel_id || null,
          default_region_id: storeDraft.default_region_id || null,
          default_location_id: storeDraft.default_location_id || null,
          supported_currencies: supportedCurrencies.length ? supportedCurrencies : undefined,
          supported_locales: supportedLocales.length ? supportedLocales : undefined,
          ...(metadata && typeof metadata === 'object' ? { metadata } : {})
        }
      });
      const updated = getObjectFromPayload(payload, resource.detailKey);
      if (updated) setRecord(updated);
      setStoreState({
        saving: false,
        error: '',
        success: 'Store settings updated.'
      });
    } catch (err) {
      setStoreState({
        saving: false,
        error: err?.message || 'Unable to update store settings.',
        success: ''
      });
    }
  };

  const handleSalesChannelDraftChange = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setSalesChannelDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveSalesChannel = async (event) => {
    event.preventDefault();
    if (!record?.id) return;
    const name = salesChannelDraft.name.trim();
    const description = salesChannelDraft.description.trim();
    const { data: metadata, error: metadataError } = parseJsonInput(salesChannelDraft.metadata);

    if (!name) {
      setSalesChannelState({
        saving: false,
        deleting: false,
        error: 'Sales channel name is required.',
        success: ''
      });
      return;
    }

    if (metadataError) {
      setSalesChannelState({
        saving: false,
        deleting: false,
        error: `Metadata JSON error: ${metadataError}`,
        success: ''
      });
      return;
    }

    setSalesChannelState({ saving: true, deleting: false, error: '', success: '' });
    try {
      const payload = await request(`${resource.endpoint}/${record.id}`, {
        method: 'POST',
        body: {
          name,
          description: description || null,
          is_disabled: Boolean(salesChannelDraft.is_disabled),
          ...(metadata && typeof metadata === 'object' ? { metadata } : {})
        }
      });
      const updated = getObjectFromPayload(payload, resource.detailKey);
      if (updated) setRecord(updated);
      setSalesChannelState({
        saving: false,
        deleting: false,
        error: '',
        success: 'Sales channel updated.'
      });
    } catch (err) {
      setSalesChannelState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to update sales channel.',
        success: ''
      });
    }
  };

  const handleDeleteSalesChannel = async () => {
    if (!record?.id) return;
    if (!window.confirm('Delete this sales channel?')) return;
    setSalesChannelState({ saving: false, deleting: true, error: '', success: '' });
    try {
      await request(`${resource.endpoint}/${record.id}`, { method: 'DELETE' });
      navigate(resource.path);
    } catch (err) {
      setSalesChannelState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to delete sales channel.',
        success: ''
      });
    }
  };

  const refreshSalesChannelProducts = async () => {
    if (!record?.id) return;
    setSalesChannelProductLoading(true);
    setSalesChannelProductError('');
    try {
      const payload = await getList('/admin/products', { sales_channel_id: record.id, limit: 200 });
      const items = getArrayFromPayload(payload, 'products');
      setSalesChannelProducts(items);
      setSalesChannelProductCount(typeof payload?.count === 'number' ? payload.count : items.length);
      setSalesChannelSelection((prev) => ({
        ...prev,
        assigned: prev.assigned.filter((idValue) => items.some((item) => item.id === idValue))
      }));
    } catch (err) {
      setSalesChannelProducts([]);
      setSalesChannelProductCount(0);
      setSalesChannelProductError(err?.message || 'Unable to load sales channel products.');
    } finally {
      setSalesChannelProductLoading(false);
    }
  };

  const handleSalesChannelProductSearchChange = (event) => {
    const value = event.target.value;
    setSalesChannelProductSearch((prev) => ({ ...prev, query: value }));
  };

  const handleToggleSalesChannelSelection = (field, productId) => {
    if (!productId) return;
    setSalesChannelSelection((prev) => {
      const current = new Set(prev[field] || []);
      if (current.has(productId)) {
        current.delete(productId);
      } else {
        current.add(productId);
      }
      return { ...prev, [field]: Array.from(current) };
    });
  };

  const handleSelectAllSalesChannelSearch = (productIds) => {
    setSalesChannelSelection((prev) => ({ ...prev, search: productIds }));
  };

  const handleSelectAllSalesChannelAssigned = (productIds) => {
    setSalesChannelSelection((prev) => ({ ...prev, assigned: productIds }));
  };

  const handleClearSalesChannelSearchSelection = () => {
    setSalesChannelSelection((prev) => ({ ...prev, search: [] }));
  };

  const handleClearSalesChannelAssignedSelection = () => {
    setSalesChannelSelection((prev) => ({ ...prev, assigned: [] }));
  };

  const updateSalesChannelProducts = async ({ add = [], remove = [] }) => {
    await request(`/admin/sales-channels/${record.id}/products`, {
      method: 'POST',
      body: {
        ...(add.length ? { add } : {}),
        ...(remove.length ? { remove } : {})
      }
    });
  };

  const handleAssignSalesChannelProduct = async (product) => {
    if (!record?.id || !product?.id) return;
    setSalesChannelProductState({ savingId: product.id, error: '', success: '' });
    try {
      await updateSalesChannelProducts({ add: [product.id] });
      setSalesChannelProductState({
        savingId: null,
        error: '',
        success: 'Product added to sales channel.'
      });
      setSalesChannelProductSearch({ query: '', results: [], loading: false, error: '' });
      refreshSalesChannelProducts();
    } catch (err) {
      setSalesChannelProductState({
        savingId: null,
        error: err?.message || 'Unable to update sales channel products.',
        success: ''
      });
    }
  };

  const handleRemoveSalesChannelProduct = async (productId) => {
    if (!record?.id || !productId) return;
    setSalesChannelProductState({ savingId: productId, error: '', success: '' });
    try {
      await updateSalesChannelProducts({ remove: [productId] });
      setSalesChannelProductState({
        savingId: null,
        error: '',
        success: 'Product removed from sales channel.'
      });
      refreshSalesChannelProducts();
    } catch (err) {
      setSalesChannelProductState({
        savingId: null,
        error: err?.message || 'Unable to update sales channel products.',
        success: ''
      });
    }
  };

  const handleBulkAssignSalesChannel = async () => {
    if (!record?.id) return;
    const assignedIds = new Set(salesChannelProducts.map((item) => item.id));
    const targets = (salesChannelSelection.search || []).filter((idValue) => !assignedIds.has(idValue));
    if (!targets.length) {
      setSalesChannelBulkState({
        saving: false,
        error: 'Select at least one unassigned product.',
        success: ''
      });
      return;
    }
    setSalesChannelBulkState({ saving: true, error: '', success: '' });
    try {
      await updateSalesChannelProducts({ add: targets });
      setSalesChannelBulkState({
        saving: false,
        error: '',
        success: 'Products added to sales channel.'
      });
      setSalesChannelSelection((prev) => ({ ...prev, search: [] }));
      refreshSalesChannelProducts();
    } catch (err) {
      setSalesChannelBulkState({
        saving: false,
        error: err?.message || 'Unable to update sales channel products.',
        success: ''
      });
    }
  };

  const handleBulkRemoveSalesChannel = async () => {
    if (!record?.id) return;
    const targets = salesChannelSelection.assigned || [];
    if (!targets.length) {
      setSalesChannelBulkState({
        saving: false,
        error: 'Select at least one assigned product.',
        success: ''
      });
      return;
    }
    setSalesChannelBulkState({ saving: true, error: '', success: '' });
    try {
      await updateSalesChannelProducts({ remove: targets });
      setSalesChannelBulkState({
        saving: false,
        error: '',
        success: 'Products removed from sales channel.'
      });
      setSalesChannelSelection((prev) => ({ ...prev, assigned: [] }));
      refreshSalesChannelProducts();
    } catch (err) {
      setSalesChannelBulkState({
        saving: false,
        error: err?.message || 'Unable to update sales channel products.',
        success: ''
      });
    }
  };

  const handleCustomerDraftChange = (field) => (event) => {
    const value = event.target.value;
    setCustomerDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveCustomer = async (event) => {
    event.preventDefault();
    if (!record?.id) return;
    const firstName = customerDraft.first_name.trim();
    const lastName = customerDraft.last_name.trim();
    const companyName = customerDraft.company_name.trim();
    const phone = customerDraft.phone.trim();
    const note = customerDraft.note.trim();
    const { data: metadata, error: metadataError } = parseJsonInput(customerDraft.metadata);

    if (metadataError) {
      setCustomerState({
        saving: false,
        deleting: false,
        error: `Metadata JSON error: ${metadataError}`,
        success: ''
      });
      return;
    }

    let nextMetadata =
      metadata && typeof metadata === 'object' ? { ...metadata } : metadata ? {} : null;
    if (note) {
      nextMetadata = nextMetadata || {};
      nextMetadata.note = note;
    }

    setCustomerState({ saving: true, deleting: false, error: '', success: '' });
    try {
      const payload = await request(`${resource.endpoint}/${record.id}`, {
        method: 'POST',
        body: {
          first_name: firstName || undefined,
          last_name: lastName || undefined,
          company_name: companyName || undefined,
          phone: phone || undefined,
          ...(nextMetadata && typeof nextMetadata === 'object' ? { metadata: nextMetadata } : {})
        }
      });
      const updated = getObjectFromPayload(payload, resource.detailKey);
      if (updated) setRecord(updated);
      setCustomerState({
        saving: false,
        deleting: false,
        error: '',
        success: 'Customer updated.'
      });
    } catch (err) {
      setCustomerState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to update customer.',
        success: ''
      });
    }
  };

  const handleDeleteCustomer = async () => {
    if (!record?.id) return;
    if (!window.confirm('Delete this customer?')) return;
    setCustomerState({ saving: false, deleting: true, error: '', success: '' });
    try {
      await request(`${resource.endpoint}/${record.id}`, { method: 'DELETE' });
      navigate(resource.path);
    } catch (err) {
      setCustomerState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to delete customer.',
        success: ''
      });
    }
  };

  const handleCustomerGroupMembershipToggle = (groupId) => {
    if (!groupId) return;
    setCustomerGroupMembership((prev) => {
      const selected = new Set(prev.selected || []);
      if (selected.has(groupId)) {
        selected.delete(groupId);
      } else {
        selected.add(groupId);
      }
      return { ...prev, selected: Array.from(selected) };
    });
  };

  const handleSaveCustomerGroups = async () => {
    if (!record?.id) return;
    const initial = customerGroupMembership.initial || [];
    const selected = customerGroupMembership.selected || [];
    const add = selected.filter((id) => !initial.includes(id));
    const remove = initial.filter((id) => !selected.includes(id));

    if (!add.length && !remove.length) {
      setCustomerGroupMembershipState({
        saving: false,
        error: 'No group changes to apply.',
        success: ''
      });
      return;
    }

    setCustomerGroupMembershipState({ saving: true, error: '', success: '' });
    try {
      const payload = await request(`/admin/customers/${record.id}/customer-groups`, {
        method: 'POST',
        body: {
          add: add.length ? add : undefined,
          remove: remove.length ? remove : undefined
        }
      });
      const updated = getObjectFromPayload(payload, resource.detailKey);
      if (updated) setRecord(updated);
      setCustomerGroupMembershipState({
        saving: false,
        error: '',
        success: 'Customer groups updated.'
      });
    } catch (err) {
      setCustomerGroupMembershipState({
        saving: false,
        error: err?.message || 'Unable to update customer groups.',
        success: ''
      });
    }
  };

  const handleCustomerGroupDraftChange = (field) => (event) => {
    const value = event.target.value;
    setCustomerGroupDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveCustomerGroup = async (event) => {
    event.preventDefault();
    if (!record?.id) return;
    const name = customerGroupDraft.name.trim();
    const note = customerGroupDraft.note.trim();
    const { data: metadata, error: metadataError } = parseJsonInput(customerGroupDraft.metadata);

    if (!name) {
      setCustomerGroupState({
        saving: false,
        deleting: false,
        error: 'Group name is required.',
        success: ''
      });
      return;
    }

    if (metadataError) {
      setCustomerGroupState({
        saving: false,
        deleting: false,
        error: `Metadata JSON error: ${metadataError}`,
        success: ''
      });
      return;
    }

    let nextMetadata =
      metadata && typeof metadata === 'object' ? { ...metadata } : metadata ? {} : null;
    if (note) {
      nextMetadata = nextMetadata || {};
      nextMetadata.note = note;
    }

    setCustomerGroupState({ saving: true, deleting: false, error: '', success: '' });
    try {
      const payload = await request(`${resource.endpoint}/${record.id}`, {
        method: 'POST',
        body: {
          name,
          ...(nextMetadata && typeof nextMetadata === 'object' ? { metadata: nextMetadata } : {})
        }
      });
      const updated = getObjectFromPayload(payload, resource.detailKey);
      if (updated) setRecord(updated);
      setCustomerGroupState({
        saving: false,
        deleting: false,
        error: '',
        success: 'Customer group updated.'
      });
    } catch (err) {
      setCustomerGroupState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to update customer group.',
        success: ''
      });
    }
  };

  const handleDeleteCustomerGroup = async () => {
    if (!record?.id) return;
    if (!window.confirm('Delete this customer group?')) return;
    setCustomerGroupState({ saving: false, deleting: true, error: '', success: '' });
    try {
      await request(`${resource.endpoint}/${record.id}`, { method: 'DELETE' });
      navigate(resource.path);
    } catch (err) {
      setCustomerGroupState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to delete customer group.',
        success: ''
      });
    }
  };

  const handleCollectionDraftChange = (field) => (event) => {
    const value = event.target.value;
    setCollectionDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveCollection = async (event) => {
    event.preventDefault();
    if (!record?.id) return;
    const title = collectionDraft.title.trim();
    const handleValue = collectionDraft.handle.trim();
    const description = collectionDraft.description.trim();
    const thumbnail = collectionDraft.thumbnail.trim();
    const { data: metadata, error: metadataError } = parseJsonInput(collectionDraft.metadata);

    if (!title) {
      setCollectionState({
        saving: false,
        deleting: false,
        error: 'Collection title is required.',
        success: ''
      });
      return;
    }

    if (metadataError) {
      setCollectionState({
        saving: false,
        deleting: false,
        error: `Metadata JSON error: ${metadataError}`,
        success: ''
      });
      return;
    }

    let nextMetadata =
      metadata && typeof metadata === 'object' ? { ...metadata } : metadata ? {} : null;
    if (thumbnail) {
      nextMetadata = nextMetadata || {};
      nextMetadata.thumbnail = thumbnail;
    }

    setCollectionState({ saving: true, deleting: false, error: '', success: '' });
    try {
      const payload = await request(`${resource.endpoint}/${record.id}`, {
        method: 'POST',
        body: {
          title,
          ...(handleValue ? { handle: handleValue } : {}),
          ...(description ? { description } : {}),
          ...(nextMetadata && typeof nextMetadata === 'object' ? { metadata: nextMetadata } : {})
        }
      });
      const updated = getObjectFromPayload(payload, resource.detailKey);
      if (updated) setRecord(updated);
      setCollectionState({
        saving: false,
        deleting: false,
        error: '',
        success: 'Collection updated.'
      });
    } catch (err) {
      setCollectionState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to update collection.',
        success: ''
      });
    }
  };

  const handleDeleteCollection = async () => {
    if (!record?.id) return;
    if (!window.confirm('Delete this collection?')) return;
    setCollectionState({ saving: false, deleting: true, error: '', success: '' });
    try {
      await request(`${resource.endpoint}/${record.id}`, { method: 'DELETE' });
      navigate(resource.path);
    } catch (err) {
      setCollectionState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to delete collection.',
        success: ''
      });
    }
  };

  const refreshCollectionProducts = async () => {
    if (!record?.id) return;
    setCollectionProductLoading(true);
    setCollectionProductError('');
    try {
      const payload = await getList('/admin/products', { collection_id: record.id, limit: 200 });
      const items = getArrayFromPayload(payload, 'products');
      setCollectionProducts(items);
      setCollectionProductCount(typeof payload?.count === 'number' ? payload.count : items.length);
      setCollectionSelection((prev) => ({
        ...prev,
        assigned: prev.assigned.filter((idValue) => items.some((item) => item.id === idValue))
      }));
    } catch (err) {
      setCollectionProducts([]);
      setCollectionProductCount(0);
      setCollectionProductError(err?.message || 'Unable to load collection products.');
    } finally {
      setCollectionProductLoading(false);
    }
  };

  const handleCollectionProductSearchChange = (event) => {
    const value = event.target.value;
    setCollectionProductSearch((prev) => ({ ...prev, query: value }));
  };

  const handleToggleCollectionSelection = (field, productId) => {
    if (!productId) return;
    setCollectionSelection((prev) => {
      const current = new Set(prev[field] || []);
      if (current.has(productId)) {
        current.delete(productId);
      } else {
        current.add(productId);
      }
      return { ...prev, [field]: Array.from(current) };
    });
  };

  const handleSelectAllCollectionSearch = (productIds) => {
    setCollectionSelection((prev) => ({
      ...prev,
      search: productIds
    }));
  };

  const handleSelectAllCollectionAssigned = (productIds) => {
    setCollectionSelection((prev) => ({
      ...prev,
      assigned: productIds
    }));
  };

  const handleClearCollectionSearchSelection = () => {
    setCollectionSelection((prev) => ({ ...prev, search: [] }));
  };

  const handleClearCollectionAssignedSelection = () => {
    setCollectionSelection((prev) => ({ ...prev, assigned: [] }));
  };

  const handleAssignCollectionProduct = async (product) => {
    if (!record?.id || !product?.id) return;
    setCollectionProductState({ savingId: product.id, error: '', success: '' });
    try {
      await request(`/admin/products/${product.id}`, {
        method: 'POST',
        body: {
          collection_id: record.id
        }
      });
      setCollectionProductState({
        savingId: null,
        error: '',
        success: 'Product added to collection.'
      });
      setCollectionProductSearch({ query: '', results: [], loading: false, error: '' });
      refreshCollectionProducts();
    } catch (err) {
      setCollectionProductState({
        savingId: null,
        error: err?.message || 'Unable to update collection products.',
        success: ''
      });
    }
  };

  const handleBulkAssignCollection = async () => {
    if (!record?.id) return;
    const assignedIds = new Set(collectionProducts.map((item) => item.id));
    const targets = (collectionSelection.search || []).filter((idValue) => !assignedIds.has(idValue));
    if (!targets.length) {
      setCollectionBulkState({
        saving: false,
        error: 'Select at least one unassigned product.',
        success: ''
      });
      return;
    }
    setCollectionBulkState({ saving: true, error: '', success: '' });
    const results = await Promise.allSettled(
      targets.map((productId) =>
        request(`/admin/products/${productId}`, {
          method: 'POST',
          body: { collection_id: record.id }
        })
      )
    );
    const failures = results.filter((result) => result.status === 'rejected');
    setCollectionBulkState({
      saving: false,
      error: failures.length
        ? `Failed to add ${failures.length} of ${targets.length} products.`
        : '',
      success: failures.length ? '' : 'Products added to collection.'
    });
    setCollectionSelection((prev) => ({ ...prev, search: [] }));
    refreshCollectionProducts();
  };

  const handleBulkRemoveCollection = async () => {
    if (!record?.id) return;
    const targets = collectionSelection.assigned || [];
    if (!targets.length) {
      setCollectionBulkState({
        saving: false,
        error: 'Select at least one assigned product.',
        success: ''
      });
      return;
    }
    setCollectionBulkState({ saving: true, error: '', success: '' });
    const results = await Promise.allSettled(
      targets.map((productId) =>
        request(`/admin/products/${productId}`, {
          method: 'POST',
          body: { collection_id: null }
        })
      )
    );
    const failures = results.filter((result) => result.status === 'rejected');
    setCollectionBulkState({
      saving: false,
      error: failures.length
        ? `Failed to remove ${failures.length} of ${targets.length} products.`
        : '',
      success: failures.length ? '' : 'Products removed from collection.'
    });
    setCollectionSelection((prev) => ({ ...prev, assigned: [] }));
    refreshCollectionProducts();
  };

  const handleRemoveCollectionProduct = async (productId) => {
    if (!record?.id || !productId) return;
    setCollectionProductState({ savingId: productId, error: '', success: '' });
    try {
      await request(`/admin/products/${productId}`, {
        method: 'POST',
        body: {
          collection_id: null
        }
      });
      setCollectionProductState({
        savingId: null,
        error: '',
        success: 'Product removed from collection.'
      });
      refreshCollectionProducts();
    } catch (err) {
      setCollectionProductState({
        savingId: null,
        error: err?.message || 'Unable to update collection products.',
        success: ''
      });
    }
  };

  const handleCollectionThumbnailUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setCollectionUploadState({ uploading: true, error: '', success: '' });
    try {
      const payload = await uploadFiles(file);
      const files = getArrayFromPayload(payload, 'files');
      const uploaded = files[0] || getObjectFromPayload(payload, 'file');
      const url = uploaded?.url || uploaded?.id;
      if (!url) {
        throw new Error('Upload response missing file URL.');
      }
      setCollectionDraft((prev) => ({ ...prev, thumbnail: url }));
      setCollectionUploadState({
        uploading: false,
        error: '',
        success: 'Thumbnail uploaded.'
      });
    } catch (err) {
      setCollectionUploadState({
        uploading: false,
        error: err?.message || 'Unable to upload thumbnail.',
        success: ''
      });
    } finally {
      event.target.value = '';
    }
  };

  const handleCategoryDraftChange = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setCategoryDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveCategory = async (event) => {
    event.preventDefault();
    if (!record?.id) return;
    const name = categoryDraft.name.trim();
    const handleValue = categoryDraft.handle.trim();
    const description = categoryDraft.description.trim();
    const parentId = categoryDraft.parent_category_id.trim();
    const thumbnail = categoryDraft.thumbnail.trim();
    const { data: metadata, error: metadataError } = parseJsonInput(categoryDraft.metadata);

    if (!name) {
      setCategoryState({
        saving: false,
        deleting: false,
        error: 'Category name is required.',
        success: ''
      });
      return;
    }

    if (metadataError) {
      setCategoryState({
        saving: false,
        deleting: false,
        error: `Metadata JSON error: ${metadataError}`,
        success: ''
      });
      return;
    }

    let nextMetadata =
      metadata && typeof metadata === 'object' ? { ...metadata } : metadata ? {} : null;
    if (thumbnail) {
      nextMetadata = nextMetadata || {};
      nextMetadata.thumbnail = thumbnail;
    }

    setCategoryState({ saving: true, deleting: false, error: '', success: '' });
    try {
      const payload = await request(`${resource.endpoint}/${record.id}`, {
        method: 'POST',
        body: {
          name,
          ...(handleValue ? { handle: handleValue } : {}),
          ...(description ? { description } : {}),
          is_active: Boolean(categoryDraft.is_active),
          is_internal: Boolean(categoryDraft.is_internal),
          parent_category_id: parentId || null,
          ...(nextMetadata && typeof nextMetadata === 'object' ? { metadata: nextMetadata } : {})
        }
      });
      const updated = getObjectFromPayload(payload, resource.detailKey);
      if (updated) setRecord(updated);
      setCategoryState({
        saving: false,
        deleting: false,
        error: '',
        success: 'Category updated.'
      });
    } catch (err) {
      setCategoryState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to update category.',
        success: ''
      });
    }
  };

  const handleDeleteCategory = async () => {
    if (!record?.id) return;
    if (!window.confirm('Delete this category?')) return;
    setCategoryState({ saving: false, deleting: true, error: '', success: '' });
    try {
      await request(`${resource.endpoint}/${record.id}`, { method: 'DELETE' });
      navigate(resource.path);
    } catch (err) {
      setCategoryState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to delete category.',
        success: ''
      });
    }
  };

  const refreshCategoryProducts = async () => {
    if (!record?.id) return;
    setCategoryProductLoading(true);
    setCategoryProductError('');
    try {
      const payload = await getList('/admin/products', { category_id: record.id, limit: 200 });
      const items = getArrayFromPayload(payload, 'products');
      setCategoryProducts(items);
      setCategoryProductCount(typeof payload?.count === 'number' ? payload.count : items.length);
      setCategorySelection((prev) => ({
        ...prev,
        assigned: prev.assigned.filter((idValue) => items.some((item) => item.id === idValue))
      }));
    } catch (err) {
      setCategoryProducts([]);
      setCategoryProductCount(0);
      setCategoryProductError(err?.message || 'Unable to load category products.');
    } finally {
      setCategoryProductLoading(false);
    }
  };

  const handleCategoryProductSearchChange = (event) => {
    const value = event.target.value;
    setCategoryProductSearch((prev) => ({ ...prev, query: value }));
  };

  const handleToggleCategorySelection = (field, productId) => {
    if (!productId) return;
    setCategorySelection((prev) => {
      const current = new Set(prev[field] || []);
      if (current.has(productId)) {
        current.delete(productId);
      } else {
        current.add(productId);
      }
      return { ...prev, [field]: Array.from(current) };
    });
  };

  const handleSelectAllCategorySearch = (productIds) => {
    setCategorySelection((prev) => ({
      ...prev,
      search: productIds
    }));
  };

  const handleSelectAllCategoryAssigned = (productIds) => {
    setCategorySelection((prev) => ({
      ...prev,
      assigned: productIds
    }));
  };

  const handleClearCategorySearchSelection = () => {
    setCategorySelection((prev) => ({ ...prev, search: [] }));
  };

  const handleClearCategoryAssignedSelection = () => {
    setCategorySelection((prev) => ({ ...prev, assigned: [] }));
  };

  const fetchProductCategoryIds = async (productId) => {
    const payload = await getDetail('/admin/products', productId, { fields: '+categories' });
    const product = getObjectFromPayload(payload, 'product');
    return Array.isArray(product?.categories)
      ? product.categories.map((category) => category?.id).filter(Boolean)
      : [];
  };

  const updateProductCategories = async (productId, updater) => {
    const current = await fetchProductCategoryIds(productId);
    const nextIds = updater(current);
    await request(`/admin/products/${productId}`, {
      method: 'POST',
      body: {
        categories: nextIds.map((idValue) => ({ id: idValue }))
      }
    });
  };

  const handleAssignCategoryProduct = async (product) => {
    if (!record?.id || !product?.id) return;
    setCategoryProductState({ savingId: product.id, error: '', success: '' });
    try {
      await updateProductCategories(product.id, (current) => {
        if (current.includes(record.id)) return current;
        return [...current, record.id];
      });
      setCategoryProductState({
        savingId: null,
        error: '',
        success: 'Product added to category.'
      });
      setCategoryProductSearch({ query: '', results: [], loading: false, error: '' });
      refreshCategoryProducts();
    } catch (err) {
      setCategoryProductState({
        savingId: null,
        error: err?.message || 'Unable to update category products.',
        success: ''
      });
    }
  };

  const handleRemoveCategoryProduct = async (productId) => {
    if (!record?.id || !productId) return;
    setCategoryProductState({ savingId: productId, error: '', success: '' });
    try {
      await updateProductCategories(productId, (current) => current.filter((idValue) => idValue !== record.id));
      setCategoryProductState({
        savingId: null,
        error: '',
        success: 'Product removed from category.'
      });
      refreshCategoryProducts();
    } catch (err) {
      setCategoryProductState({
        savingId: null,
        error: err?.message || 'Unable to update category products.',
        success: ''
      });
    }
  };

  const handleBulkAssignCategory = async () => {
    if (!record?.id) return;
    const assignedIds = new Set(categoryProducts.map((item) => item.id));
    const targets = (categorySelection.search || []).filter((idValue) => !assignedIds.has(idValue));
    if (!targets.length) {
      setCategoryBulkState({
        saving: false,
        error: 'Select at least one unassigned product.',
        success: ''
      });
      return;
    }
    setCategoryBulkState({ saving: true, error: '', success: '' });
    const results = await Promise.allSettled(
      targets.map((productId) =>
        updateProductCategories(productId, (current) => {
          if (current.includes(record.id)) return current;
          return [...current, record.id];
        })
      )
    );
    const failures = results.filter((result) => result.status === 'rejected');
    setCategoryBulkState({
      saving: false,
      error: failures.length
        ? `Failed to add ${failures.length} of ${targets.length} products.`
        : '',
      success: failures.length ? '' : 'Products added to category.'
    });
    setCategorySelection((prev) => ({ ...prev, search: [] }));
    refreshCategoryProducts();
  };

  const handleBulkRemoveCategory = async () => {
    if (!record?.id) return;
    const targets = categorySelection.assigned || [];
    if (!targets.length) {
      setCategoryBulkState({
        saving: false,
        error: 'Select at least one assigned product.',
        success: ''
      });
      return;
    }
    setCategoryBulkState({ saving: true, error: '', success: '' });
    const results = await Promise.allSettled(
      targets.map((productId) =>
        updateProductCategories(productId, (current) => current.filter((idValue) => idValue !== record.id))
      )
    );
    const failures = results.filter((result) => result.status === 'rejected');
    setCategoryBulkState({
      saving: false,
      error: failures.length
        ? `Failed to remove ${failures.length} of ${targets.length} products.`
        : '',
      success: failures.length ? '' : 'Products removed from category.'
    });
    setCategorySelection((prev) => ({ ...prev, assigned: [] }));
    refreshCategoryProducts();
  };

  const handleCategoryThumbnailUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setCategoryUploadState({ uploading: true, error: '', success: '' });
    try {
      const payload = await uploadFiles(file);
      const files = getArrayFromPayload(payload, 'files');
      const uploaded = files[0] || getObjectFromPayload(payload, 'file');
      const url = uploaded?.url || uploaded?.id;
      if (!url) {
        throw new Error('Upload response missing file URL.');
      }
      setCategoryDraft((prev) => ({ ...prev, thumbnail: url }));
      setCategoryUploadState({
        uploading: false,
        error: '',
        success: 'Thumbnail uploaded.'
      });
    } catch (err) {
      setCategoryUploadState({
        uploading: false,
        error: err?.message || 'Unable to upload thumbnail.',
        success: ''
      });
    } finally {
      event.target.value = '';
    }
  };

  const refreshProductTypeProducts = async () => {
    if (!record?.id) return;
    setProductTypeProductLoading(true);
    setProductTypeProductError('');
    try {
      const payload = await getList('/admin/products', { type_id: record.id, limit: 200 });
      const items = getArrayFromPayload(payload, 'products');
      setProductTypeProducts(items);
      setProductTypeProductCount(
        typeof payload?.count === 'number' ? payload.count : items.length
      );
      setProductTypeSelection((prev) => ({
        ...prev,
        assigned: prev.assigned.filter((idValue) => items.some((item) => item.id === idValue))
      }));
    } catch (err) {
      setProductTypeProducts([]);
      setProductTypeProductCount(0);
      setProductTypeProductError(err?.message || 'Unable to load type products.');
    } finally {
      setProductTypeProductLoading(false);
    }
  };

  const handleProductTypeProductSearchChange = (event) => {
    const value = event.target.value;
    setProductTypeProductSearch((prev) => ({ ...prev, query: value }));
  };

  const handleToggleProductTypeSelection = (field, productId) => {
    if (!productId) return;
    setProductTypeSelection((prev) => {
      const current = new Set(prev[field] || []);
      if (current.has(productId)) {
        current.delete(productId);
      } else {
        current.add(productId);
      }
      return { ...prev, [field]: Array.from(current) };
    });
  };

  const handleSelectAllProductTypeSearch = (productIds) => {
    setProductTypeSelection((prev) => ({
      ...prev,
      search: productIds
    }));
  };

  const handleSelectAllProductTypeAssigned = (productIds) => {
    setProductTypeSelection((prev) => ({
      ...prev,
      assigned: productIds
    }));
  };

  const handleClearProductTypeSearchSelection = () => {
    setProductTypeSelection((prev) => ({ ...prev, search: [] }));
  };

  const handleClearProductTypeAssignedSelection = () => {
    setProductTypeSelection((prev) => ({ ...prev, assigned: [] }));
  };

  const handleAssignProductTypeProduct = async (product) => {
    if (!record?.id || !product?.id) return;
    setProductTypeProductState({ savingId: product.id, error: '', success: '' });
    try {
      await request(`/admin/products/${product.id}`, {
        method: 'POST',
        body: {
          type_id: record.id
        }
      });
      setProductTypeProductState({
        savingId: null,
        error: '',
        success: 'Product assigned to type.'
      });
      setProductTypeProductSearch({ query: '', results: [], loading: false, error: '' });
      refreshProductTypeProducts();
    } catch (err) {
      setProductTypeProductState({
        savingId: null,
        error: err?.message || 'Unable to update type products.',
        success: ''
      });
    }
  };

  const handleRemoveProductTypeProduct = async (productId) => {
    if (!record?.id || !productId) return;
    setProductTypeProductState({ savingId: productId, error: '', success: '' });
    try {
      await request(`/admin/products/${productId}`, {
        method: 'POST',
        body: {
          type_id: null
        }
      });
      setProductTypeProductState({
        savingId: null,
        error: '',
        success: 'Product removed from type.'
      });
      refreshProductTypeProducts();
    } catch (err) {
      setProductTypeProductState({
        savingId: null,
        error: err?.message || 'Unable to update type products.',
        success: ''
      });
    }
  };

  const handleBulkAssignProductType = async () => {
    if (!record?.id) return;
    const assignedIds = new Set(productTypeProducts.map((item) => item.id));
    const targets = (productTypeSelection.search || []).filter((idValue) => !assignedIds.has(idValue));
    if (!targets.length) {
      setProductTypeBulkState({
        saving: false,
        error: 'Select at least one unassigned product.',
        success: ''
      });
      return;
    }
    setProductTypeBulkState({ saving: true, error: '', success: '' });
    const results = await Promise.allSettled(
      targets.map((productId) =>
        request(`/admin/products/${productId}`, {
          method: 'POST',
          body: { type_id: record.id }
        })
      )
    );
    const failures = results.filter((result) => result.status === 'rejected');
    setProductTypeBulkState({
      saving: false,
      error: failures.length
        ? `Failed to add ${failures.length} of ${targets.length} products.`
        : '',
      success: failures.length ? '' : 'Products assigned to type.'
    });
    setProductTypeSelection((prev) => ({ ...prev, search: [] }));
    refreshProductTypeProducts();
  };

  const handleBulkRemoveProductType = async () => {
    if (!record?.id) return;
    const targets = productTypeSelection.assigned || [];
    if (!targets.length) {
      setProductTypeBulkState({
        saving: false,
        error: 'Select at least one assigned product.',
        success: ''
      });
      return;
    }
    setProductTypeBulkState({ saving: true, error: '', success: '' });
    const results = await Promise.allSettled(
      targets.map((productId) =>
        request(`/admin/products/${productId}`, {
          method: 'POST',
          body: { type_id: null }
        })
      )
    );
    const failures = results.filter((result) => result.status === 'rejected');
    setProductTypeBulkState({
      saving: false,
      error: failures.length
        ? `Failed to remove ${failures.length} of ${targets.length} products.`
        : '',
      success: failures.length ? '' : 'Products removed from type.'
    });
    setProductTypeSelection((prev) => ({ ...prev, assigned: [] }));
    refreshProductTypeProducts();
  };

  const refreshProductTagProducts = async () => {
    if (!record?.id) return;
    setProductTagProductLoading(true);
    setProductTagProductError('');
    try {
      const payload = await getList('/admin/products', { tag_id: record.id, limit: 200 });
      const items = getArrayFromPayload(payload, 'products');
      setProductTagProducts(items);
      setProductTagProductCount(typeof payload?.count === 'number' ? payload.count : items.length);
      setProductTagSelection((prev) => ({
        ...prev,
        assigned: prev.assigned.filter((idValue) => items.some((item) => item.id === idValue))
      }));
    } catch (err) {
      setProductTagProducts([]);
      setProductTagProductCount(0);
      setProductTagProductError(err?.message || 'Unable to load tag products.');
    } finally {
      setProductTagProductLoading(false);
    }
  };

  const handleProductTagProductSearchChange = (event) => {
    const value = event.target.value;
    setProductTagProductSearch((prev) => ({ ...prev, query: value }));
  };

  const handleToggleProductTagSelection = (field, productId) => {
    if (!productId) return;
    setProductTagSelection((prev) => {
      const current = new Set(prev[field] || []);
      if (current.has(productId)) {
        current.delete(productId);
      } else {
        current.add(productId);
      }
      return { ...prev, [field]: Array.from(current) };
    });
  };

  const handleSelectAllProductTagSearch = (productIds) => {
    setProductTagSelection((prev) => ({
      ...prev,
      search: productIds
    }));
  };

  const handleSelectAllProductTagAssigned = (productIds) => {
    setProductTagSelection((prev) => ({
      ...prev,
      assigned: productIds
    }));
  };

  const handleClearProductTagSearchSelection = () => {
    setProductTagSelection((prev) => ({ ...prev, search: [] }));
  };

  const handleClearProductTagAssignedSelection = () => {
    setProductTagSelection((prev) => ({ ...prev, assigned: [] }));
  };

  const fetchProductTagIds = async (productId) => {
    const payload = await getDetail('/admin/products', productId, { fields: '+tags' });
    const product = getObjectFromPayload(payload, 'product');
    return Array.isArray(product?.tags)
      ? product.tags.map((tag) => tag?.id).filter(Boolean)
      : [];
  };

  const updateProductTags = async (productId, updater) => {
    const current = await fetchProductTagIds(productId);
    const nextIds = updater(current);
    await request(`/admin/products/${productId}`, {
      method: 'POST',
      body: {
        tags: nextIds.map((idValue) => ({ id: idValue }))
      }
    });
  };

  const handleAssignProductTagProduct = async (product) => {
    if (!record?.id || !product?.id) return;
    setProductTagProductState({ savingId: product.id, error: '', success: '' });
    try {
      await updateProductTags(product.id, (current) => {
        if (current.includes(record.id)) return current;
        return [...current, record.id];
      });
      setProductTagProductState({
        savingId: null,
        error: '',
        success: 'Product tagged.'
      });
      setProductTagProductSearch({ query: '', results: [], loading: false, error: '' });
      refreshProductTagProducts();
    } catch (err) {
      setProductTagProductState({
        savingId: null,
        error: err?.message || 'Unable to update tag products.',
        success: ''
      });
    }
  };

  const handleRemoveProductTagProduct = async (productId) => {
    if (!record?.id || !productId) return;
    setProductTagProductState({ savingId: productId, error: '', success: '' });
    try {
      await updateProductTags(productId, (current) => current.filter((idValue) => idValue !== record.id));
      setProductTagProductState({
        savingId: null,
        error: '',
        success: 'Tag removed from product.'
      });
      refreshProductTagProducts();
    } catch (err) {
      setProductTagProductState({
        savingId: null,
        error: err?.message || 'Unable to update tag products.',
        success: ''
      });
    }
  };

  const handleBulkAssignProductTag = async () => {
    if (!record?.id) return;
    const assignedIds = new Set(productTagProducts.map((item) => item.id));
    const targets = (productTagSelection.search || []).filter((idValue) => !assignedIds.has(idValue));
    if (!targets.length) {
      setProductTagBulkState({
        saving: false,
        error: 'Select at least one unassigned product.',
        success: ''
      });
      return;
    }
    setProductTagBulkState({ saving: true, error: '', success: '' });
    const results = await Promise.allSettled(
      targets.map((productId) =>
        updateProductTags(productId, (current) => {
          if (current.includes(record.id)) return current;
          return [...current, record.id];
        })
      )
    );
    const failures = results.filter((result) => result.status === 'rejected');
    setProductTagBulkState({
      saving: false,
      error: failures.length
        ? `Failed to add ${failures.length} of ${targets.length} products.`
        : '',
      success: failures.length ? '' : 'Products tagged.'
    });
    setProductTagSelection((prev) => ({ ...prev, search: [] }));
    refreshProductTagProducts();
  };

  const handleBulkRemoveProductTag = async () => {
    if (!record?.id) return;
    const targets = productTagSelection.assigned || [];
    if (!targets.length) {
      setProductTagBulkState({
        saving: false,
        error: 'Select at least one assigned product.',
        success: ''
      });
      return;
    }
    setProductTagBulkState({ saving: true, error: '', success: '' });
    const results = await Promise.allSettled(
      targets.map((productId) =>
        updateProductTags(productId, (current) => current.filter((idValue) => idValue !== record.id))
      )
    );
    const failures = results.filter((result) => result.status === 'rejected');
    setProductTagBulkState({
      saving: false,
      error: failures.length
        ? `Failed to remove ${failures.length} of ${targets.length} products.`
        : '',
      success: failures.length ? '' : 'Tags removed from products.'
    });
    setProductTagSelection((prev) => ({ ...prev, assigned: [] }));
    refreshProductTagProducts();
  };

  const handleProductTypeDraftChange = (field) => (event) => {
    const value = event.target.value;
    setProductTypeDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveProductType = async (event) => {
    event.preventDefault();
    if (!record?.id) return;
    const value = productTypeDraft.value.trim();
    const { data: metadata, error: metadataError } = parseJsonInput(productTypeDraft.metadata);

    if (!value) {
      setProductTypeState({
        saving: false,
        deleting: false,
        error: 'Value is required.',
        success: ''
      });
      return;
    }

    if (metadataError) {
      setProductTypeState({
        saving: false,
        deleting: false,
        error: `Metadata JSON error: ${metadataError}`,
        success: ''
      });
      return;
    }

    setProductTypeState({ saving: true, deleting: false, error: '', success: '' });
    try {
      const payload = await request(`${resource.endpoint}/${record.id}`, {
        method: 'POST',
        body: {
          value,
          ...(metadata && typeof metadata === 'object' ? { metadata } : {})
        }
      });
      const updated = getObjectFromPayload(payload, resource.detailKey);
      if (updated) setRecord(updated);
      setProductTypeState({
        saving: false,
        deleting: false,
        error: '',
        success: 'Product type updated.'
      });
    } catch (err) {
      setProductTypeState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to update product type.',
        success: ''
      });
    }
  };

  const handleDeleteProductType = async () => {
    if (!record?.id) return;
    if (!window.confirm('Delete this product type?')) return;
    setProductTypeState({ saving: false, deleting: true, error: '', success: '' });
    try {
      await request(`${resource.endpoint}/${record.id}`, { method: 'DELETE' });
      navigate(resource.path);
    } catch (err) {
      setProductTypeState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to delete product type.',
        success: ''
      });
    }
  };

  const handleProductTagDraftChange = (field) => (event) => {
    const value = event.target.value;
    setProductTagDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveProductTag = async (event) => {
    event.preventDefault();
    if (!record?.id) return;
    const value = productTagDraft.value.trim();
    const { data: metadata, error: metadataError } = parseJsonInput(productTagDraft.metadata);

    if (!value) {
      setProductTagState({
        saving: false,
        deleting: false,
        error: 'Value is required.',
        success: ''
      });
      return;
    }

    if (metadataError) {
      setProductTagState({
        saving: false,
        deleting: false,
        error: `Metadata JSON error: ${metadataError}`,
        success: ''
      });
      return;
    }

    setProductTagState({ saving: true, deleting: false, error: '', success: '' });
    try {
      const payload = await request(`${resource.endpoint}/${record.id}`, {
        method: 'POST',
        body: {
          value,
          ...(metadata && typeof metadata === 'object' ? { metadata } : {})
        }
      });
      const updated = getObjectFromPayload(payload, resource.detailKey);
      if (updated) setRecord(updated);
      setProductTagState({
        saving: false,
        deleting: false,
        error: '',
        success: 'Product tag updated.'
      });
    } catch (err) {
      setProductTagState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to update product tag.',
        success: ''
      });
    }
  };

  const handleDeleteProductTag = async () => {
    if (!record?.id) return;
    if (!window.confirm('Delete this product tag?')) return;
    setProductTagState({ saving: false, deleting: true, error: '', success: '' });
    try {
      await request(`${resource.endpoint}/${record.id}`, { method: 'DELETE' });
      navigate(resource.path);
    } catch (err) {
      setProductTagState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to delete product tag.',
        success: ''
      });
    }
  };

  const handleGiftCardDraftChange = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setGiftCardDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveGiftCard = async (event) => {
    event.preventDefault();
    if (!record?.id) return;
    const endsInput = giftCardDraft.ends_at.trim();
    const endsAt = endsInput ? parseDateTimeInput(endsInput) : null;
    const { data: metadata, error: metadataError } = parseJsonInput(giftCardDraft.metadata);

    if (endsInput && !endsAt) {
      setGiftCardState({
        saving: false,
        deleting: false,
        error: 'Expiration date is invalid.',
        success: ''
      });
      return;
    }

    if (metadataError) {
      setGiftCardState({
        saving: false,
        deleting: false,
        error: `Metadata JSON error: ${metadataError}`,
        success: ''
      });
      return;
    }

    setGiftCardState({ saving: true, deleting: false, error: '', success: '' });
    try {
      const payload = await request(`${resource.endpoint}/${record.id}`, {
        method: 'POST',
        body: {
          is_disabled: Boolean(giftCardDraft.is_disabled),
          ends_at: endsInput ? endsAt : null,
          ...(metadata && typeof metadata === 'object' ? { metadata } : {})
        }
      });
      const updated = getObjectFromPayload(payload, resource.detailKey);
      if (updated) setRecord(updated);
      setGiftCardState({
        saving: false,
        deleting: false,
        error: '',
        success: 'Gift card updated.'
      });
    } catch (err) {
      setGiftCardState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to update gift card.',
        success: ''
      });
    }
  };

  const handleDeleteGiftCard = async () => {
    if (!record?.id) return;
    if (!window.confirm('Delete this gift card?')) return;
    setGiftCardState({ saving: false, deleting: true, error: '', success: '' });
    try {
      await request(`${resource.endpoint}/${record.id}`, { method: 'DELETE' });
      navigate(resource.path);
    } catch (err) {
      setGiftCardState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to delete gift card.',
        success: ''
      });
    }
  };

  const handleGroupCustomerSearchChange = (event) => {
    const value = event.target.value;
    setGroupCustomerSearch((prev) => ({ ...prev, query: value }));
  };

  const handleSelectGroupCustomer = (customer) => {
    if (!customer?.id) return;
    setGroupCustomerMembership((prev) => {
      if (prev.selected.includes(customer.id)) return prev;
      return { ...prev, selected: [...prev.selected, customer.id] };
    });
    setGroupCustomerSelected((prev) => {
      if (prev.some((item) => item.id === customer.id)) return prev;
      return [...prev, customer];
    });
    setGroupCustomerSearch({ query: '', results: [], loading: false, error: '' });
  };

  const handleRemoveGroupCustomer = (customerId) => {
    setGroupCustomerMembership((prev) => ({
      ...prev,
      selected: prev.selected.filter((id) => id !== customerId)
    }));
    setGroupCustomerSelected((prev) => prev.filter((item) => item.id !== customerId));
  };

  const handleSaveGroupCustomers = async () => {
    if (!record?.id) return;
    const initial = groupCustomerMembership.initial || [];
    const selected = groupCustomerMembership.selected || [];
    const add = selected.filter((id) => !initial.includes(id));
    const remove = initial.filter((id) => !selected.includes(id));

    if (!add.length && !remove.length) {
      setGroupCustomerState({
        saving: false,
        error: 'No customer changes to apply.',
        success: ''
      });
      return;
    }

    setGroupCustomerState({ saving: true, error: '', success: '' });
    try {
      const payload = await request(`/admin/customer-groups/${record.id}/customers`, {
        method: 'POST',
        body: {
          add: add.length ? add : undefined,
          remove: remove.length ? remove : undefined
        }
      });
      const updated = getObjectFromPayload(payload, resource.detailKey);
      if (updated) setRecord(updated);
      setGroupCustomerState({
        saving: false,
        error: '',
        success: 'Group customers updated.'
      });
    } catch (err) {
      setGroupCustomerState({
        saving: false,
        error: err?.message || 'Unable to update group customers.',
        success: ''
      });
    }
  };

  const handlePromotionDraftChange = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setPromotionDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleSavePromotion = async (event) => {
    event.preventDefault();
    if (!record?.id) return;
    const code = promotionDraft.code.trim();
    const description = promotionDraft.description.trim();
    const status = promotionDraft.status.trim();
    const campaignId = promotionDraft.campaign_id.trim();
    const type = promotionDraft.type.trim();
    const startsInput = promotionDraft.starts_at.trim();
    const endsInput = promotionDraft.ends_at.trim();
    const startsAt = startsInput ? parseDateTimeInput(startsInput) : null;
    const endsAt = endsInput ? parseDateTimeInput(endsInput) : null;
    const applicationMethodType = promotionDraft.application_method_type.trim();
    const applicationMethodValue = promotionDraft.application_method_value.trim();
    const applicationMethodCurrency = promotionDraft.application_method_currency.trim();
    const applicationMethodTarget = promotionDraft.application_method_target.trim();
    const applicationMethodAllocation = promotionDraft.application_method_allocation.trim();
    const { data: extra, error: extraError } = parseJsonInput(promotionDraft.extra);

    if (startsInput && !startsAt) {
      setPromotionState({
        saving: false,
        deleting: false,
        error: 'Start date is invalid.',
        success: ''
      });
      return;
    }

    if (endsInput && !endsAt) {
      setPromotionState({
        saving: false,
        deleting: false,
        error: 'End date is invalid.',
        success: ''
      });
      return;
    }

    if (!type) {
      setPromotionState({
        saving: false,
        deleting: false,
        error: 'Promotion type is required.',
        success: ''
      });
      return;
    }

    if (!code && !promotionDraft.is_automatic) {
      setPromotionState({
        saving: false,
        deleting: false,
        error: 'Add a code or enable automatic promotion.',
        success: ''
      });
      return;
    }

    if (extraError) {
      setPromotionState({
        saving: false,
        deleting: false,
        error: `Advanced JSON error: ${extraError}`,
        success: ''
      });
      return;
    }

    let applicationMethod = null;
    if (applicationMethodType || applicationMethodValue || applicationMethodCurrency) {
      const numericValue = applicationMethodValue ? Number(applicationMethodValue) : null;
      if (applicationMethodValue && !Number.isFinite(numericValue)) {
        setPromotionState({
          saving: false,
          deleting: false,
          error: 'Application method value must be a number.',
          success: ''
        });
        return;
      }
      applicationMethod = {
        ...(applicationMethodType ? { type: applicationMethodType } : {}),
        ...(Number.isFinite(numericValue) ? { value: numericValue } : {}),
        ...(applicationMethodCurrency ? { currency_code: applicationMethodCurrency } : {}),
        ...(applicationMethodTarget ? { target_type: applicationMethodTarget } : {}),
        ...(applicationMethodAllocation ? { allocation: applicationMethodAllocation } : {})
      };
    }

    setPromotionState({ saving: true, deleting: false, error: '', success: '' });
    try {
      const payload = await request(`${resource.endpoint}/${record.id}`, {
        method: 'POST',
        body: {
          code: code || undefined,
          description: description || undefined,
          status: status || undefined,
          is_automatic: promotionDraft.is_automatic,
          campaign_id: campaignId || undefined,
          starts_at: startsInput ? startsAt : null,
          ends_at: endsInput ? endsAt : null,
          type,
          ...(applicationMethod ? { application_method: applicationMethod } : {}),
          ...(extra && typeof extra === 'object' ? extra : {})
        }
      });
      const updated = getObjectFromPayload(payload, resource.detailKey);
      if (updated) setRecord(updated);
      setPromotionState({
        saving: false,
        deleting: false,
        error: '',
        success: 'Promotion updated.'
      });
    } catch (err) {
      setPromotionState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to update promotion.',
        success: ''
      });
    }
  };

  const handleDeletePromotion = async () => {
    if (!record?.id) return;
    if (!window.confirm('Delete this promotion?')) return;
    setPromotionState({ saving: false, deleting: true, error: '', success: '' });
    try {
      await request(`${resource.endpoint}/${record.id}`, { method: 'DELETE' });
      navigate(resource.path);
    } catch (err) {
      setPromotionState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to delete promotion.',
        success: ''
      });
    }
  };

  const handleCampaignDraftChange = (field) => (event) => {
    const value = event.target.value;
    setCampaignDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveCampaign = async (event) => {
    event.preventDefault();
    if (!record?.id) return;
    const name = campaignDraft.name.trim();
    const description = campaignDraft.description.trim();
    const startsInput = campaignDraft.starts_at.trim();
    const endsInput = campaignDraft.ends_at.trim();
    const startsAt = startsInput ? parseDateTimeInput(startsInput) : null;
    const endsAt = endsInput ? parseDateTimeInput(endsInput) : null;
    const { data: extra, error: extraError } = parseJsonInput(campaignDraft.extra);

    if (!name) {
      setCampaignState({
        saving: false,
        deleting: false,
        error: 'Campaign name is required.',
        success: ''
      });
      return;
    }

    if (startsInput && !startsAt) {
      setCampaignState({
        saving: false,
        deleting: false,
        error: 'Start date is invalid.',
        success: ''
      });
      return;
    }

    if (endsInput && !endsAt) {
      setCampaignState({
        saving: false,
        deleting: false,
        error: 'End date is invalid.',
        success: ''
      });
      return;
    }

    if (extraError) {
      setCampaignState({
        saving: false,
        deleting: false,
        error: `Advanced JSON error: ${extraError}`,
        success: ''
      });
      return;
    }

    setCampaignState({ saving: true, deleting: false, error: '', success: '' });
    try {
      const payload = await request(`${resource.endpoint}/${record.id}`, {
        method: 'POST',
        body: {
          name,
          description: description || undefined,
          starts_at: startsInput ? startsAt : null,
          ends_at: endsInput ? endsAt : null,
          ...(extra && typeof extra === 'object' ? extra : {})
        }
      });
      const updated = getObjectFromPayload(payload, resource.detailKey);
      if (updated) setRecord(updated);
      setCampaignState({
        saving: false,
        deleting: false,
        error: '',
        success: 'Campaign updated.'
      });
    } catch (err) {
      setCampaignState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to update campaign.',
        success: ''
      });
    }
  };

  const handleDeleteCampaign = async () => {
    if (!record?.id) return;
    if (!window.confirm('Delete this campaign?')) return;
    setCampaignState({ saving: false, deleting: true, error: '', success: '' });
    try {
      await request(`${resource.endpoint}/${record.id}`, { method: 'DELETE' });
      navigate(resource.path);
    } catch (err) {
      setCampaignState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to delete campaign.',
        success: ''
      });
    }
  };

  const handlePriceListDraftChange = (field) => (event) => {
    const value = event.target.value;
    setPriceListDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handlePriceListRuleToggle = (field, value) => {
    if (!value) return;
    setPriceListRuleDraft((prev) => {
      const current = new Set(prev[field] || []);
      if (current.has(value)) {
        current.delete(value);
      } else {
        current.add(value);
      }
      return { ...prev, [field]: Array.from(current) };
    });
  };

  const handlePriceListProductSearchChange = (event) => {
    const value = event.target.value;
    setPriceListProductSearch((prev) => ({ ...prev, query: value }));
  };

  const handleSelectPriceListProduct = (product) => {
    if (!product?.id) return;
    setPriceListRuleDraft((prev) => {
      if (prev.product_ids.includes(product.id)) return prev;
      return { ...prev, product_ids: [...prev.product_ids, product.id] };
    });
    setPriceListSelectedProducts((prev) => {
      if (prev.some((item) => item.id === product.id)) return prev;
      return [...prev, product];
    });
    setPriceListProductSearch({ query: '', results: [], loading: false, error: '' });
  };

  const handleRemovePriceListProduct = (productId) => {
    setPriceListRuleDraft((prev) => ({
      ...prev,
      product_ids: prev.product_ids.filter((id) => id !== productId)
    }));
    setPriceListSelectedProducts((prev) => prev.filter((item) => item.id !== productId));
  };

  const handleSavePriceList = async (event) => {
    event.preventDefault();
    if (!record?.id) return;
    const title = priceListDraft.title.trim();
    const description = priceListDraft.description.trim();
    const status = priceListDraft.status.trim();
    const type = priceListDraft.type.trim();
    const startsInput = priceListDraft.starts_at.trim();
    const endsInput = priceListDraft.ends_at.trim();
    const startsAt = startsInput ? parseDateTimeInput(startsInput) : null;
    const endsAt = endsInput ? parseDateTimeInput(endsInput) : null;
    const { data: extra, error: extraError } = parseJsonInput(priceListDraft.extra);
    const rules = buildPriceListRules(priceListRuleDraft);

    if (!title || !type) {
      setPriceListState({
        saving: false,
        deleting: false,
        error: 'Title and type are required.',
        success: ''
      });
      return;
    }

    if (startsInput && !startsAt) {
      setPriceListState({
        saving: false,
        deleting: false,
        error: 'Start date is invalid.',
        success: ''
      });
      return;
    }

    if (endsInput && !endsAt) {
      setPriceListState({
        saving: false,
        deleting: false,
        error: 'End date is invalid.',
        success: ''
      });
      return;
    }

    if (extraError) {
      setPriceListState({
        saving: false,
        deleting: false,
        error: `Advanced JSON error: ${extraError}`,
        success: ''
      });
      return;
    }

    setPriceListState({ saving: true, deleting: false, error: '', success: '' });
    try {
      const payload = await request(`${resource.endpoint}/${record.id}`, {
        method: 'POST',
        body: {
          title,
          description: description || undefined,
          status: status || undefined,
          type,
          starts_at: startsInput ? startsAt : null,
          ends_at: endsInput ? endsAt : null,
          rules,
          ...(extra && typeof extra === 'object' ? extra : {})
        }
      });
      const updated = getObjectFromPayload(payload, resource.detailKey);
      if (updated) setRecord(updated);
      setPriceListState({
        saving: false,
        deleting: false,
        error: '',
        success: 'Price list updated.'
      });
    } catch (err) {
      setPriceListState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to update price list.',
        success: ''
      });
    }
  };

  const handleDeletePriceList = async () => {
    if (!record?.id) return;
    if (!window.confirm('Delete this price list?')) return;
    setPriceListState({ saving: false, deleting: true, error: '', success: '' });
    try {
      await request(`${resource.endpoint}/${record.id}`, { method: 'DELETE' });
      navigate(resource.path);
    } catch (err) {
      setPriceListState({
        saving: false,
        deleting: false,
        error: err?.message || 'Unable to delete price list.',
        success: ''
      });
    }
  };

  const refreshPriceListPrices = async () => {
    if (!record?.id) return;
    setPriceListPricesLoading(true);
    setPriceListPricesError('');
    try {
      const payload = await getDetail('/admin/price-lists', record.id, {
        fields: '+prices,+prices.variant,+prices.variant.product'
      });
      const updated = getObjectFromPayload(payload, resource.detailKey);
      if (updated) {
        setRecord(updated);
        const prices = Array.isArray(updated.prices) ? updated.prices : [];
        setPriceListPrices(prices);
        setPriceListPriceDrafts(buildPriceListPriceDrafts(prices));
      }
    } catch (err) {
      setPriceListPricesError(err?.message || 'Unable to refresh price list prices.');
    } finally {
      setPriceListPricesLoading(false);
    }
  };

  const handlePriceListPriceDraftChange = (priceId, field) => (event) => {
    const value = event.target.value;
    setPriceListPriceDrafts((prev) => ({
      ...prev,
      [priceId]: {
        ...(prev[priceId] || {}),
        [field]: value
      }
    }));
  };

  const handleNewPriceListPriceChange = (field) => (event) => {
    const value = event.target.value;
    setNewPriceListPrice((prev) => ({
      ...prev,
      [field]: value
    }));
    if (field === 'variant_id') {
      setSelectedPriceListVariant(null);
    }
  };

  const handleVariantSearchChange = (event) => {
    const value = event.target.value;
    setPriceListVariantSearch((prev) => ({ ...prev, query: value }));
  };

  const handleSelectPriceListVariant = (variant) => {
    if (!variant?.id) return;
    setSelectedPriceListVariant(variant);
    setNewPriceListPrice((prev) => ({ ...prev, variant_id: variant.id }));
    setPriceListVariantSearch((prev) => ({
      ...prev,
      query: '',
      results: [],
      loading: false,
      error: ''
    }));
  };

  const handleAddPriceListPrice = async (event) => {
    event.preventDefault();
    if (!record?.id) return;
    const variantId = newPriceListPrice.variant_id.trim();
    const amount = parsePriceInput(newPriceListPrice.amount);
    const currencyCode = newPriceListPrice.currency_code.trim().toLowerCase();
    const regionId = newPriceListPrice.region_id.trim();
    const minQuantity = newPriceListPrice.min_quantity.trim();
    const maxQuantity = newPriceListPrice.max_quantity.trim();
    const minValue = minQuantity ? Number(minQuantity) : null;
    const maxValue = maxQuantity ? Number(maxQuantity) : null;

    if (!variantId) {
      setPriceListPriceState({
        savingId: null,
        action: '',
        error: 'Variant ID is required.',
        success: ''
      });
      return;
    }

    if (!Number.isFinite(amount)) {
      setPriceListPriceState({
        savingId: null,
        action: '',
        error: 'Price amount is required.',
        success: ''
      });
      return;
    }

    if (!currencyCode && !regionId) {
      setPriceListPriceState({
        savingId: null,
        action: '',
        error: 'Currency code or region ID is required.',
        success: ''
      });
      return;
    }

    if (minQuantity && !Number.isFinite(minValue)) {
      setPriceListPriceState({
        savingId: null,
        action: '',
        error: 'Minimum quantity must be a number.',
        success: ''
      });
      return;
    }

    if (maxQuantity && !Number.isFinite(maxValue)) {
      setPriceListPriceState({
        savingId: null,
        action: '',
        error: 'Maximum quantity must be a number.',
        success: ''
      });
      return;
    }

    setPriceListPriceState({ savingId: 'new', action: 'add', error: '', success: '' });
    try {
      await request(`/admin/price-lists/${record.id}/prices/batch`, {
        method: 'POST',
        body: {
          prices: [
            {
              variant_id: variantId,
              amount,
              ...(currencyCode ? { currency_code: currencyCode } : {}),
              ...(regionId ? { region_id: regionId } : {}),
              ...(Number.isFinite(minValue) ? { min_quantity: minValue } : {}),
              ...(Number.isFinite(maxValue) ? { max_quantity: maxValue } : {})
            }
          ]
        }
      });
      setNewPriceListPrice({
        variant_id: '',
        amount: '',
        currency_code: '',
        region_id: '',
        min_quantity: '',
        max_quantity: ''
      });
      setSelectedPriceListVariant(null);
      setPriceListPriceState({
        savingId: null,
        action: '',
        error: '',
        success: 'Price added.'
      });
      refreshPriceListPrices();
    } catch (err) {
      setPriceListPriceState({
        savingId: null,
        action: '',
        error: err?.message || 'Unable to add price.',
        success: ''
      });
    }
  };

  const handleUpdatePriceListPrice = async (priceId) => {
    if (!record?.id || !priceId) return;
    const draft = priceListPriceDrafts[priceId] || {};
    const amount = parsePriceInput(draft.amount);
    const currencyCode = String(draft.currency_code || '').trim().toLowerCase();
    const regionId = String(draft.region_id || '').trim();
    const minQuantity = String(draft.min_quantity || '').trim();
    const maxQuantity = String(draft.max_quantity || '').trim();
    const minValue = minQuantity ? Number(minQuantity) : null;
    const maxValue = maxQuantity ? Number(maxQuantity) : null;

    if (!Number.isFinite(amount)) {
      setPriceListPriceState({
        savingId: null,
        action: '',
        error: 'Price amount is required.',
        success: ''
      });
      return;
    }

    if (!currencyCode && !regionId) {
      setPriceListPriceState({
        savingId: null,
        action: '',
        error: 'Currency code or region ID is required.',
        success: ''
      });
      return;
    }

    if (minQuantity && !Number.isFinite(minValue)) {
      setPriceListPriceState({
        savingId: null,
        action: '',
        error: 'Minimum quantity must be a number.',
        success: ''
      });
      return;
    }

    if (maxQuantity && !Number.isFinite(maxValue)) {
      setPriceListPriceState({
        savingId: null,
        action: '',
        error: 'Maximum quantity must be a number.',
        success: ''
      });
      return;
    }

    setPriceListPriceState({ savingId: priceId, action: 'update', error: '', success: '' });
    try {
      await request(`/admin/price-lists/${record.id}/prices/batch`, {
        method: 'POST',
        body: {
          prices: [
            {
              id: priceId,
              amount,
              ...(currencyCode ? { currency_code: currencyCode } : {}),
              ...(regionId ? { region_id: regionId } : {}),
              ...(Number.isFinite(minValue) ? { min_quantity: minValue } : {}),
              ...(Number.isFinite(maxValue) ? { max_quantity: maxValue } : {})
            }
          ]
        }
      });
      setPriceListPriceState({
        savingId: null,
        action: '',
        error: '',
        success: 'Price updated.'
      });
      refreshPriceListPrices();
    } catch (err) {
      setPriceListPriceState({
        savingId: null,
        action: '',
        error: err?.message || 'Unable to update price.',
        success: ''
      });
    }
  };

  const handleDeletePriceListPrice = async (priceId) => {
    if (!record?.id || !priceId) return;
    if (!window.confirm('Remove this price from the list?')) return;
    setPriceListPriceState({ savingId: priceId, action: 'delete', error: '', success: '' });
    try {
      await request(`/admin/price-lists/${record.id}/prices/batch`, {
        method: 'POST',
        body: {
          delete: [priceId]
        }
      });
      setPriceListPriceState({
        savingId: null,
        action: '',
        error: '',
        success: 'Price removed.'
      });
      refreshPriceListPrices();
    } catch (err) {
      setPriceListPriceState({
        savingId: null,
        action: '',
        error: err?.message || 'Unable to remove price.',
        success: ''
      });
    }
  };

  const handleCreateTag = async (event) => {
    event.preventDefault();
    const value = tagInput.trim();
    if (!value) return;
    setTagSaving(true);
    setTagError('');
    try {
      const existing = productMeta.tags.find(
        (tag) => tag?.value?.toLowerCase() === value.toLowerCase()
      );
      if (existing) {
        setProductDraft((prev) => {
          if (!prev) return prev;
          const next = new Set(prev.tag_ids || []);
          next.add(existing.id);
          return { ...prev, tag_ids: Array.from(next) };
        });
        setTagInput('');
        return;
      }
      const payload = await request('/admin/product-tags', {
        method: 'POST',
        body: { value }
      });
      const newTag = payload?.product_tag || getObjectFromPayload(payload, 'product_tag');
      if (newTag) {
        setProductMeta((prev) => ({
          ...prev,
          tags: sortByLabel([...(prev.tags || []), newTag], (item) => item?.value || item?.id)
        }));
        setProductDraft((prev) => {
          if (!prev) return prev;
          const next = new Set(prev.tag_ids || []);
          next.add(newTag.id);
          return { ...prev, tag_ids: Array.from(next) };
        });
        setTagInput('');
      }
    } catch (err) {
      setTagError(err?.message || 'Unable to add tag.');
    } finally {
      setTagSaving(false);
    }
  };

  const parseOptionValues = (value) =>
    String(value || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

  const handleOptionDraftChange = (idValue, field) => (event) => {
    const value = event.target.value;
    setOptionDrafts((prev) =>
      prev.map((option) => (option.id === idValue ? { ...option, [field]: value } : option))
    );
  };

  const handleSaveOption = async (option) => {
    if (!record || !option?.id) return;
    const title = option.title.trim();
    const values = parseOptionValues(option.values);
    if (!title || !values.length) {
      setOptionError('Option title and values are required.');
      setOptionMessage('');
      return;
    }
    setOptionSavingId(option.id);
    setOptionError('');
    setOptionMessage('');
    try {
      const payload = await request(`/admin/products/${record.id}/options/${option.id}`, {
        method: 'POST',
        body: {
          title,
          values
        }
      });
      applyProductPayload(payload);
      setOptionMessage('Option updated.');
    } catch (err) {
      setOptionError(err?.message || 'Unable to update option.');
    } finally {
      setOptionSavingId(null);
    }
  };

  const handleDeleteOption = async (option) => {
    if (!record || !option?.id) return;
    setOptionDeletingId(option.id);
    setOptionError('');
    setOptionMessage('');
    try {
      const payload = await request(`/admin/products/${record.id}/options/${option.id}`, {
        method: 'DELETE'
      });
      applyProductPayload(payload);
      setOptionMessage('Option removed.');
    } catch (err) {
      setOptionError(err?.message || 'Unable to remove option.');
    } finally {
      setOptionDeletingId(null);
    }
  };

  const handleCreateOption = async (event) => {
    event.preventDefault();
    if (!record) return;
    const title = newOption.title.trim();
    const values = parseOptionValues(newOption.values);
    if (!title || !values.length) {
      setOptionError('Option title and values are required.');
      return;
    }
    setOptionSavingId('new');
    setOptionError('');
    setOptionMessage('');
    try {
      const payload = await request(`/admin/products/${record.id}/options`, {
        method: 'POST',
        body: { title, values }
      });
      applyProductPayload(payload);
      setNewOption({ title: '', values: '' });
      setOptionMessage('Option added.');
    } catch (err) {
      setOptionError(err?.message || 'Unable to add option.');
    } finally {
      setOptionSavingId(null);
    }
  };

  const buildPricePayload = (prices) => {
    const payload = [];
    (prices || []).forEach((price) => {
      const currency = String(price.currency_code || '').trim().toLowerCase();
      const amount = parsePriceInput(price.amount);
      if (!currency || amount === null) return;
      const entry = {
        currency_code: currency,
        amount
      };
      if (price.id) {
        entry.id = price.id;
      }
      payload.push(entry);
    });
    return payload;
  };

  const variantOptionList = isVariant
    ? variantProduct?.options || record?.product?.options || []
    : record?.options || [];

  const handleVariantFieldChange = (variantId, field) => (event) => {
    const value = event.target.value;
    setVariantDrafts((prev) =>
      prev.map((variant) => (variant.id === variantId ? { ...variant, [field]: value } : variant))
    );
  };

  const handleVariantToggle = (variantId, field) => (event) => {
    const value = event.target.checked;
    setVariantDrafts((prev) =>
      prev.map((variant) => (variant.id === variantId ? { ...variant, [field]: value } : variant))
    );
  };

  const handleVariantOptionChange = (variantId, optionId) => (event) => {
    const value = event.target.value;
    setVariantDrafts((prev) =>
      prev.map((variant) =>
        variant.id === variantId
          ? { ...variant, options: { ...variant.options, [optionId]: value } }
          : variant
      )
    );
  };

  const handleVariantPriceChange = (variantId, index, field) => (event) => {
    const value = event.target.value;
    setVariantDrafts((prev) =>
      prev.map((variant) => {
        if (variant.id !== variantId) return variant;
        const nextPrices = variant.prices.map((price, priceIndex) =>
          priceIndex === index ? { ...price, [field]: value } : price
        );
        return { ...variant, prices: nextPrices };
      })
    );
  };

  const handleAddVariantPrice = (variantId) => {
    const defaultCurrency = getDefaultCurrency(isVariant ? record : record);
    setVariantDrafts((prev) =>
      prev.map((variant) =>
        variant.id === variantId
          ? {
              ...variant,
              prices: [...variant.prices, { currency_code: defaultCurrency, amount: '' }]
            }
          : variant
      )
    );
  };

  const handleRemoveVariantPrice = (variantId, index) => {
    setVariantDrafts((prev) =>
      prev.map((variant) => {
        if (variant.id !== variantId) return variant;
        if (variant.prices.length <= 1) return variant;
        const nextPrices = variant.prices.filter((_, priceIndex) => priceIndex !== index);
        return { ...variant, prices: nextPrices };
      })
    );
  };

  const handleVariantThumbnailUpload = (variantId) => async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setVariantUploadState({ uploadingId: variantId, error: '', success: '' });
    try {
      const payload = await uploadFiles(file);
      const files = getArrayFromPayload(payload, 'files');
      const uploaded = files[0] || getObjectFromPayload(payload, 'file');
      const url = uploaded?.url || uploaded?.id;
      if (!url) {
        throw new Error('Upload response missing file URL.');
      }
      if (variantId === 'new') {
        setNewVariant((prev) => (prev ? { ...prev, thumbnail: url } : prev));
      } else {
        setVariantDrafts((prev) =>
          prev.map((variant) =>
            variant.id === variantId ? { ...variant, thumbnail: url } : variant
          )
        );
      }
      setVariantUploadState({ uploadingId: null, error: '', success: 'Thumbnail uploaded.' });
    } catch (err) {
      setVariantUploadState({
        uploadingId: null,
        error: err?.message || 'Unable to upload thumbnail.',
        success: ''
      });
    } finally {
      event.target.value = '';
    }
  };

  const handleSaveVariant = async (variant) => {
    if (!record || !variant?.id) return;
    const productId = isVariant ? record?.product_id || record?.product?.id : record?.id;
    if (!productId) {
      setVariantError('Product ID missing for this variant.');
      setVariantMessage('');
      return;
    }
    const title = variant.title.trim();
    if (!title) {
      setVariantError('Variant title is required.');
      setVariantMessage('');
      return;
    }
    const thumbnail = String(variant.thumbnail || '').trim();
    const { payload: optionsPayload, missing } = buildVariantOptionsPayload(
      variant.options,
      variantOptionList,
      Array.isArray(variantOptionList) && variantOptionList.length > 0
    );
    if (missing.length) {
      setVariantError(`Add values for: ${missing.join(', ')}`);
      setVariantMessage('');
      return;
    }
    const pricesPayload = buildPricePayload(variant.prices);
    if (!pricesPayload.length) {
      setVariantError('At least one price is required.');
      setVariantMessage('');
      return;
    }
    const weightResult = parseNullableNumberInput(variant.weight);
    const lengthResult = parseNullableNumberInput(variant.length);
    const heightResult = parseNullableNumberInput(variant.height);
    const widthResult = parseNullableNumberInput(variant.width);
    const numberError = [
      { label: 'Weight', result: weightResult },
      { label: 'Length', result: lengthResult },
      { label: 'Height', result: heightResult },
      { label: 'Width', result: widthResult }
    ].find((entry) => entry.result.error);
    if (numberError) {
      setVariantError(`${numberError.label}: ${numberError.result.error}`);
      setVariantMessage('');
      return;
    }
    const { data: metadata, error: metadataError } = parseJsonInput(variant.metadata);
    if (metadataError) {
      setVariantError(`Metadata: ${metadataError}`);
      setVariantMessage('');
      return;
    }
    setVariantSavingId(variant.id);
    setVariantError('');
    setVariantMessage('');
    try {
      const payload = await request(`/admin/products/${productId}/variants/${variant.id}`, {
        method: 'POST',
        body: {
          title,
          sku: variant.sku || null,
          ean: String(variant.ean || '').trim() || null,
          upc: String(variant.upc || '').trim() || null,
          barcode: String(variant.barcode || '').trim() || null,
          hs_code: String(variant.hs_code || '').trim() || null,
          mid_code: String(variant.mid_code || '').trim() || null,
          origin_country: String(variant.origin_country || '').trim() || null,
          material: String(variant.material || '').trim() || null,
          weight: weightResult.value,
          length: lengthResult.value,
          height: heightResult.value,
          width: widthResult.value,
          metadata,
          thumbnail: thumbnail || null,
          manage_inventory: variant.manage_inventory,
          allow_backorder: variant.allow_backorder,
          options: Object.keys(optionsPayload).length ? optionsPayload : undefined,
          prices: pricesPayload
        }
      });
      if (isVariant) {
        const updated = payload?.parent || payload?.product || record;
        const refreshed = updated?.variants?.find((entry) => entry.id === variant.id);
        if (refreshed) {
          setRecord(refreshed);
        } else {
          applyProductPayload(payload);
        }
      } else {
        applyProductPayload(payload);
      }
      setVariantMessage('Variant updated.');
    } catch (err) {
      setVariantError(err?.message || 'Unable to update variant.');
    } finally {
      setVariantSavingId(null);
    }
  };

  const handleDeleteVariant = async (variant) => {
    if (!record || !variant?.id) return;
    const productId = isVariant ? record?.product_id || record?.product?.id : record?.id;
    if (!productId) {
      setVariantError('Product ID missing for this variant.');
      setVariantMessage('');
      return;
    }
    if (!window.confirm('Delete this variant? This cannot be undone.')) return;
    setVariantDeletingId(variant.id);
    setVariantError('');
    setVariantMessage('');
    try {
      const payload = await request(`/admin/products/${productId}/variants/${variant.id}`, {
        method: 'DELETE'
      });
      if (isVariant) {
        navigate('/variants');
      } else {
        applyProductPayload(payload);
        setVariantMessage('Variant deleted.');
      }
    } catch (err) {
      setVariantError(err?.message || 'Unable to delete variant.');
    } finally {
      setVariantDeletingId(null);
    }
  };

  const handleNewVariantField = (field) => (event) => {
    const value = event.target.value;
    setNewVariant((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const handleNewVariantToggle = (field) => (event) => {
    const value = event.target.checked;
    setNewVariant((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const handleNewVariantOptionChange = (optionId) => (event) => {
    const value = event.target.value;
    setNewVariant((prev) =>
      prev ? { ...prev, options: { ...prev.options, [optionId]: value } } : prev
    );
  };

  const handleNewVariantPriceChange = (index, field) => (event) => {
    const value = event.target.value;
    setNewVariant((prev) => {
      if (!prev) return prev;
      const nextPrices = prev.prices.map((price, priceIndex) =>
        priceIndex === index ? { ...price, [field]: value } : price
      );
      return { ...prev, prices: nextPrices };
    });
  };

  const handleAddNewVariantPrice = () => {
    const defaultCurrency = getDefaultCurrency(isVariant ? record : record);
    setNewVariant((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        prices: [...prev.prices, { currency_code: defaultCurrency, amount: '' }]
      };
    });
  };

  const handleRemoveNewVariantPrice = (index) => {
    setNewVariant((prev) => {
      if (!prev) return prev;
      if (prev.prices.length <= 1) return prev;
      return {
        ...prev,
        prices: prev.prices.filter((_, priceIndex) => priceIndex !== index)
      };
    });
  };

  const handleCreateVariant = async (event) => {
    event.preventDefault();
    if (!record || !newVariant) return;
    const productId = isVariant ? record?.product_id || record?.product?.id : record?.id;
    if (!productId) {
      setVariantError('Product ID missing for this variant.');
      setVariantMessage('');
      return;
    }
    const title = newVariant.title.trim();
    if (!title) {
      setVariantError('Variant title is required.');
      setVariantMessage('');
      return;
    }
    const thumbnail = String(newVariant.thumbnail || '').trim();
    const { payload: optionsPayload, missing } = buildVariantOptionsPayload(
      newVariant.options,
      variantOptionList,
      Array.isArray(variantOptionList) && variantOptionList.length > 0
    );
    if (missing.length) {
      setVariantError(`Add values for: ${missing.join(', ')}`);
      setVariantMessage('');
      return;
    }
    const pricesPayload = buildPricePayload(newVariant.prices);
    if (!pricesPayload.length) {
      setVariantError('At least one price is required.');
      setVariantMessage('');
      return;
    }
    const weightResult = parseNullableNumberInput(newVariant.weight);
    const lengthResult = parseNullableNumberInput(newVariant.length);
    const heightResult = parseNullableNumberInput(newVariant.height);
    const widthResult = parseNullableNumberInput(newVariant.width);
    const numberError = [
      { label: 'Weight', result: weightResult },
      { label: 'Length', result: lengthResult },
      { label: 'Height', result: heightResult },
      { label: 'Width', result: widthResult }
    ].find((entry) => entry.result.error);
    if (numberError) {
      setVariantError(`${numberError.label}: ${numberError.result.error}`);
      setVariantMessage('');
      return;
    }
    const { data: metadata, error: metadataError } = parseJsonInput(newVariant.metadata);
    if (metadataError) {
      setVariantError(`Metadata: ${metadataError}`);
      setVariantMessage('');
      return;
    }
    setVariantSavingId('new');
    setVariantError('');
    setVariantMessage('');
    try {
      const payload = await request(`/admin/products/${productId}/variants`, {
        method: 'POST',
        body: {
          title,
          sku: newVariant.sku || null,
          ean: String(newVariant.ean || '').trim() || null,
          upc: String(newVariant.upc || '').trim() || null,
          barcode: String(newVariant.barcode || '').trim() || null,
          hs_code: String(newVariant.hs_code || '').trim() || null,
          mid_code: String(newVariant.mid_code || '').trim() || null,
          origin_country: String(newVariant.origin_country || '').trim() || null,
          material: String(newVariant.material || '').trim() || null,
          weight: weightResult.value,
          length: lengthResult.value,
          height: heightResult.value,
          width: widthResult.value,
          metadata,
          thumbnail: thumbnail || null,
          manage_inventory: newVariant.manage_inventory,
          allow_backorder: newVariant.allow_backorder,
          options: Object.keys(optionsPayload).length ? optionsPayload : undefined,
          prices: pricesPayload
        }
      });
      if (isVariant) {
        const updated = payload?.product || payload?.parent;
        const refreshed = updated?.variants?.find((entry) => entry.id === record.id);
        if (refreshed) {
          setRecord(refreshed);
        }
      } else {
        applyProductPayload(payload);
      }
      setVariantMessage('Variant created.');
      setNewVariant(buildNewVariantDraft(isVariant ? variantProduct || record?.product : record, getDefaultCurrency(record)));
    } catch (err) {
      setVariantError(err?.message || 'Unable to create variant.');
    } finally {
      setVariantSavingId(null);
    }
  };

  const handleOrderCancel = async () => {
    if (!record?.id) return;
    if (!window.confirm('Cancel this order? This cannot be undone.')) return;
    setOrderActionState({ saving: true, error: '', success: '' });
    try {
      const payload = await request(`/admin/orders/${record.id}/cancel`, {
        method: 'POST'
      });
      applyOrderPayload(payload);
      setOrderActionState({ saving: false, error: '', success: 'Order canceled.' });
    } catch (err) {
      setOrderActionState({
        saving: false,
        error: err?.message || 'Unable to cancel order.',
        success: ''
      });
    }
  };

  const handleOrderComplete = async () => {
    if (!record?.id) return;
    if (!window.confirm('Mark this order as completed?')) return;
    setOrderActionState({ saving: true, error: '', success: '' });
    try {
      const payload = await request(`/admin/orders/${record.id}/complete`, {
        method: 'POST',
        body: {}
      });
      applyOrderPayload(payload);
      setOrderActionState({ saving: false, error: '', success: 'Order completed.' });
    } catch (err) {
      setOrderActionState({
        saving: false,
        error: err?.message || 'Unable to complete order.',
        success: ''
      });
    }
  };

  const handleOrderArchive = async () => {
    if (!record?.id) return;
    if (!window.confirm('Archive this order?')) return;
    setOrderArchiveState({ saving: true, error: '', success: '' });
    try {
      const payload = await request(`/admin/orders/${record.id}/archive`, {
        method: 'POST'
      });
      applyOrderPayload(payload);
      setOrderArchiveState({ saving: false, error: '', success: 'Order archived.' });
    } catch (err) {
      setOrderArchiveState({
        saving: false,
        error: err?.message || 'Unable to archive order.',
        success: ''
      });
    }
  };

  const handleOrderTransferSearchChange = (event) => {
    const value = event.target.value;
    setOrderTransferSearch((prev) => ({ ...prev, query: value }));
  };

  const handleSelectOrderTransferCustomer = (customer) => {
    if (!customer?.id) return;
    setOrderTransferDraft((prev) => ({
      ...prev,
      customer_id: customer.id
    }));
    setOrderTransferSearch((prev) => ({ ...prev, results: [] }));
  };

  const handleOrderTransferDraftChange = (field) => (event) => {
    const value = event.target.value;
    setOrderTransferDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleRequestOrderTransfer = async () => {
    if (!record?.id) return;
    if (!orderTransferDraft.customer_id) {
      setOrderTransferState({
        saving: false,
        canceling: false,
        error: 'Select a customer to transfer this order.',
        success: ''
      });
      return;
    }
    setOrderTransferState({ saving: true, canceling: false, error: '', success: '' });
    try {
      await request(`/admin/orders/${record.id}/transfer`, {
        method: 'POST',
        body: {
          customer_id: orderTransferDraft.customer_id,
          description: orderTransferDraft.description.trim() || undefined,
          internal_note: orderTransferDraft.internal_note.trim() || undefined
        }
      });
      setOrderTransferState({
        saving: false,
        canceling: false,
        error: '',
        success: 'Transfer request sent.'
      });
      refreshOrderChanges();
    } catch (err) {
      setOrderTransferState({
        saving: false,
        canceling: false,
        error: err?.message || 'Unable to request transfer.',
        success: ''
      });
    }
  };

  const handleCancelOrderTransfer = async () => {
    if (!record?.id) return;
    if (!window.confirm('Cancel the active transfer request?')) return;
    setOrderTransferState({ saving: false, canceling: true, error: '', success: '' });
    try {
      await request(`/admin/orders/${record.id}/transfer/cancel`, {
        method: 'POST'
      });
      setOrderTransferState({
        saving: false,
        canceling: false,
        error: '',
        success: 'Transfer request canceled.'
      });
      refreshOrderChanges();
    } catch (err) {
      setOrderTransferState({
        saving: false,
        canceling: false,
        error: err?.message || 'Unable to cancel transfer.',
        success: ''
      });
    }
  };

  const handleOrderCreditDraftChange = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setOrderCreditDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleCreateOrderCreditLine = async () => {
    if (!record?.id) return;
    const amount = parsePriceInput(orderCreditDraft.amount);
    const reference = orderCreditDraft.reference.trim();
    const referenceId = orderCreditDraft.reference_id.trim();
    if (!amount) {
      setOrderCreditState({
        saving: false,
        error: 'Enter a valid amount.',
        success: ''
      });
      return;
    }
    if (!reference || !referenceId) {
      setOrderCreditState({
        saving: false,
        error: 'Reference and reference ID are required.',
        success: ''
      });
      return;
    }
    const { data: metadata, error: metadataError } = parseJsonInput(orderCreditDraft.metadata);
    if (metadataError) {
      setOrderCreditState({
        saving: false,
        error: `Metadata: ${metadataError}`,
        success: ''
      });
      return;
    }
    const signedAmount = orderCreditDraft.is_credit ? -Math.abs(amount) : Math.abs(amount);
    setOrderCreditState({ saving: true, error: '', success: '' });
    try {
      const payload = await request(`/admin/orders/${record.id}/credit-lines`, {
        method: 'POST',
        body: {
          amount: signedAmount,
          reference,
          reference_id: referenceId,
          metadata
        }
      });
      applyOrderPayload(payload);
      setOrderCreditState({
        saving: false,
        error: '',
        success: 'Credit line created.'
      });
    } catch (err) {
      setOrderCreditState({
        saving: false,
        error: err?.message || 'Unable to create credit line.',
        success: ''
      });
    }
  };

  const handleOrderNoteChange = (event) => {
    setOrderNoteDraft(event.target.value);
  };

  const handleAddOrderNote = async () => {
    if (!record?.id) return;
    const text = String(orderNoteDraft || '').trim();
    if (!text) {
      setOrderNoteState({ saving: false, error: 'Enter a note before saving.', success: '' });
      return;
    }
    setOrderNoteState({ saving: true, error: '', success: '' });
    try {
      const now = Date.now();
      const nowIso = new Date().toISOString();
      const metadataSource =
        record?.metadata && typeof record.metadata === 'object' ? { ...record.metadata } : {};
      let notes = [];

      if (Array.isArray(metadataSource.notes)) {
        notes = metadataSource.notes.filter(Boolean);
      } else if (typeof metadataSource.notes === 'string') {
        const legacy = metadataSource.notes.trim();
        if (legacy) {
          notes.push({
            id: `note-${now}-legacy`,
            text: legacy,
            created_at: record?.updated_at || record?.created_at
          });
        }
      }

      if (!notes.length && metadataSource.note) {
        notes.push({
          id: `note-${now}-legacy`,
          text: String(metadataSource.note),
          created_at: record?.updated_at || record?.created_at
        });
      }

      notes.push({
        id: `note-${now}`,
        text,
        created_at: nowIso
      });

      metadataSource.notes = notes;
      if (metadataSource.note) delete metadataSource.note;

      const payload = await request(`/admin/orders/${record.id}`, {
        method: 'POST',
        body: { metadata: metadataSource }
      });
      const updated = payload?.order || getObjectFromPayload(payload, resource?.detailKey);
      if (updated) setRecord(updated);
      setOrderNoteDraft('');
      setOrderNoteState({ saving: false, error: '', success: 'Note added.' });
    } catch (err) {
      setOrderNoteState({
        saving: false,
        error: err?.message || 'Unable to add note.',
        success: ''
      });
    }
  };

  const handleOrderEditDraftChange = (field) => (event) => {
    const value = event.target.value;
    setOrderEditDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleStartOrderEdit = async (event) => {
    event.preventDefault();
    if (!record?.id) return;
    if (isDraftOrder) {
      setOrderEditState({ saving: true, action: 'start', error: '', success: '' });
      try {
        const payload = await request(`/admin/draft-orders/${record.id}/edit`, {
          method: 'POST'
        });
        applyOrderPreviewPayload(payload);
        setOrderEditState({
          saving: false,
          action: '',
          error: '',
          success: 'Draft order edit started.'
        });
        refreshOrderChanges();
        refreshOrderPreview();
      } catch (err) {
        setOrderEditState({
          saving: false,
          action: '',
          error: err?.message || 'Unable to start draft order edit.',
          success: ''
        });
      }
      return;
    }
    const description = orderEditDraft.description.trim();
    const internal_note = orderEditDraft.internal_note.trim();
    setOrderEditState({ saving: true, action: 'start', error: '', success: '' });
    try {
      await request('/admin/order-edits', {
        method: 'POST',
        body: {
          order_id: record.id,
          ...(description ? { description } : {}),
          ...(internal_note ? { internal_note } : {})
        }
      });
      setOrderEditDraft({ description: '', internal_note: '' });
      setOrderEditState({
        saving: false,
        action: '',
        error: '',
        success: 'Order edit started.'
      });
      refreshOrderChanges();
      refreshOrderPreview();
    } catch (err) {
      setOrderEditState({
        saving: false,
        action: '',
        error: err?.message || 'Unable to start order edit.',
        success: ''
      });
    }
  };

  const handleCancelOrderEdit = async () => {
    if (!orderEditChange?.id) {
      setOrderEditState({
        saving: false,
        action: '',
        error: `Start an ${orderEditLabel} before canceling.`,
        success: ''
      });
      return;
    }
    if (!window.confirm(`Cancel this ${orderEditLabel}?`)) return;
    setOrderEditState({ saving: true, action: 'cancel', error: '', success: '' });
    try {
      if (isDraftOrder) {
        await request(`/admin/draft-orders/${record.id}/edit`, { method: 'DELETE' });
      } else {
        await request(`/admin/order-edits/${orderEditChange.id}`, { method: 'DELETE' });
      }
      setOrderEditState({
        saving: false,
        action: '',
        error: '',
        success: `${orderLabel.charAt(0).toUpperCase() + orderLabel.slice(1)} edit canceled.`
      });
      refreshOrderChanges();
      refreshOrderPreview();
    } catch (err) {
      setOrderEditState({
        saving: false,
        action: '',
        error: err?.message || `Unable to cancel ${orderEditLabel}.`,
        success: ''
      });
    }
  };

  const handleRequestOrderEdit = async () => {
    if (!orderEditChange?.id) {
      setOrderEditState({
        saving: false,
        action: '',
        error: `Start an ${orderEditLabel} before requesting.`,
        success: ''
      });
      return;
    }
    setOrderEditState({ saving: true, action: 'request', error: '', success: '' });
    try {
      const payload = isDraftOrder
        ? await request(`/admin/draft-orders/${record.id}/edit/request`, { method: 'POST' })
        : await request(`/admin/order-edits/${orderEditChange.id}/request`, { method: 'POST' });
      applyOrderPreviewPayload(payload);
      setOrderEditState({
        saving: false,
        action: '',
        error: '',
        success: `${orderLabel.charAt(0).toUpperCase() + orderLabel.slice(1)} edit requested.`
      });
      refreshOrderChanges();
    } catch (err) {
      setOrderEditState({
        saving: false,
        action: '',
        error: err?.message || `Unable to request ${orderEditLabel}.`,
        success: ''
      });
    }
  };

  const handleConfirmOrderEdit = async () => {
    if (!orderEditChange?.id) {
      setOrderEditState({
        saving: false,
        action: '',
        error: `Start an ${orderEditLabel} before confirming.`,
        success: ''
      });
      return;
    }
    if (!window.confirm(`Confirm and apply this ${orderEditLabel}?`)) return;
    setOrderEditState({ saving: true, action: 'confirm', error: '', success: '' });
    try {
      const payload = isDraftOrder
        ? await request(`/admin/draft-orders/${record.id}/edit/confirm`, { method: 'POST' })
        : await request(`/admin/order-edits/${orderEditChange.id}/confirm`, { method: 'POST' });
      applyOrderPreviewPayload(payload);
      setOrderEditState({
        saving: false,
        action: '',
        error: '',
        success: `${orderLabel.charAt(0).toUpperCase() + orderLabel.slice(1)} edit confirmed.`
      });
      refreshOrderChanges();
      refreshOrder();
    } catch (err) {
      setOrderEditState({
        saving: false,
        action: '',
        error: err?.message || `Unable to confirm ${orderEditLabel}.`,
        success: ''
      });
    }
  };

  const handleOrderEditItemDraftChange = (itemId, field) => (event) => {
    const value = event.target.value;
    setOrderEditItemDrafts((prev) => ({
      ...prev,
      [itemId]: {
        ...(prev[itemId] || {}),
        [field]: value
      }
    }));
  };

  const submitOrderEditItem = async (itemId, overrideQuantity = null) => {
    if (!record?.id) return;
    if (!orderEditActive) {
      setOrderEditItemState({
        savingId: itemId,
        action: 'update',
        error: `Start an ${orderEditLabel} before updating items.`,
        success: ''
      });
      return;
    }
    if (!orderEditChange?.id) {
      setOrderEditItemState({
        savingId: itemId,
        action: 'update',
        error: `${orderEditLabel.charAt(0).toUpperCase() + orderEditLabel.slice(1)} not found. Refresh and try again.`,
        success: ''
      });
      return;
    }
    const draft = orderEditItemDrafts[itemId] || {};
    const quantityValue =
      overrideQuantity !== null ? overrideQuantity : parseQuantityInput(draft.quantity);
    if (quantityValue === null) {
      setOrderEditItemState({
        savingId: itemId,
        action: 'update',
        error: 'Quantity must be a number.',
        success: ''
      });
      return;
    }
    const unitPriceInput = String(draft.unit_price ?? '').trim();
    const unitPrice = unitPriceInput ? parsePriceInput(unitPriceInput) : null;
    if (unitPriceInput && unitPrice === null) {
      setOrderEditItemState({
        savingId: itemId,
        action: 'update',
        error: 'Unit price must be a number.',
        success: ''
      });
      return;
    }
    const compareInput = String(draft.compare_at_unit_price ?? '').trim();
    const compareAt = compareInput ? parsePriceInput(compareInput) : null;
    if (compareInput && compareAt === null) {
      setOrderEditItemState({
        savingId: itemId,
        action: 'update',
        error: 'Compare at price must be a number.',
        success: ''
      });
      return;
    }
    setOrderEditItemState({
      savingId: itemId,
      action: overrideQuantity === 0 ? 'remove' : 'update',
      error: '',
      success: ''
    });
    try {
      const payload = await request(
        isDraftOrder
          ? `/admin/draft-orders/${record.id}/edit/items/item/${itemId}`
          : `/admin/order-edits/${orderEditChange.id}/items/item/${itemId}`,
        {
          method: 'POST',
          body: {
            quantity: quantityValue,
            ...(unitPrice !== null ? { unit_price: unitPrice } : {}),
            ...(compareAt !== null ? { compare_at_unit_price: compareAt } : {}),
            ...(draft.internal_note?.trim() ? { internal_note: draft.internal_note.trim() } : {})
          }
        }
      );
      applyOrderPreviewPayload(payload);
      setOrderEditItemState({
        savingId: null,
        action: '',
        error: '',
        success: overrideQuantity === 0 ? 'Item removed from edit.' : 'Item updated.'
      });
      refreshOrderChanges();
    } catch (err) {
      setOrderEditItemState({
        savingId: null,
        action: '',
        error: err?.message || `Unable to update ${orderLabel} item.`,
        success: ''
      });
    }
  };

  const handleOrderEditAddDraftChange = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setOrderEditAddDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleOrderEditVariantSearchChange = (event) => {
    const value = event.target.value;
    setOrderEditVariantSearch((prev) => ({ ...prev, query: value }));
  };

  const handleSelectOrderEditVariant = (variant) => {
    if (!variant?.id) return;
    setOrderEditSelectedVariant(variant);
    setOrderEditAddDraft((prev) => ({ ...prev, variant_id: variant.id }));
    setOrderEditVariantSearch((prev) => ({ ...prev, query: '', results: [], error: '' }));
  };

  const handleAddOrderEditItem = async (event) => {
    event.preventDefault();
    if (!record?.id) return;
    if (!orderEditActive) {
      setOrderEditAddState({
        saving: false,
        error: `Start an ${orderEditLabel} before adding items.`,
        success: ''
      });
      return;
    }
    if (!orderEditChange?.id) {
      setOrderEditAddState({
        saving: false,
        error: `${orderEditLabel.charAt(0).toUpperCase() + orderEditLabel.slice(1)} not found. Refresh and try again.`,
        success: ''
      });
      return;
    }
    const variantId = orderEditAddDraft.variant_id.trim();
    const quantityValue = parseQuantityInput(orderEditAddDraft.quantity);
    if (!variantId) {
      setOrderEditAddState({ saving: false, error: 'Variant ID is required.', success: '' });
      return;
    }
    if (!quantityValue || quantityValue <= 0) {
      setOrderEditAddState({ saving: false, error: 'Quantity must be at least 1.', success: '' });
      return;
    }
    const unitPriceInput = String(orderEditAddDraft.unit_price ?? '').trim();
    const unitPrice = unitPriceInput ? parsePriceInput(unitPriceInput) : null;
    if (unitPriceInput && unitPrice === null) {
      setOrderEditAddState({ saving: false, error: 'Unit price must be a number.', success: '' });
      return;
    }
    const compareInput = String(orderEditAddDraft.compare_at_unit_price ?? '').trim();
    const compareAt = compareInput ? parsePriceInput(compareInput) : null;
    if (compareInput && compareAt === null) {
      setOrderEditAddState({
        saving: false,
        error: 'Compare at price must be a number.',
        success: ''
      });
      return;
    }
    setOrderEditAddState({ saving: true, error: '', success: '' });
    try {
      const payload = await request(
        isDraftOrder
          ? `/admin/draft-orders/${record.id}/edit/items`
          : `/admin/order-edits/${orderEditChange.id}/items`,
        {
          method: 'POST',
          body: {
            items: [
              {
                variant_id: variantId,
                quantity: quantityValue,
                ...(unitPrice !== null ? { unit_price: unitPrice } : {}),
                ...(compareAt !== null ? { compare_at_unit_price: compareAt } : {}),
                allow_backorder: Boolean(orderEditAddDraft.allow_backorder),
                ...(orderEditAddDraft.internal_note?.trim()
                  ? { internal_note: orderEditAddDraft.internal_note.trim() }
                  : {})
              }
            ]
          }
        }
      );
      applyOrderPreviewPayload(payload);
      setOrderEditAddDraft({
        variant_id: '',
        quantity: 1,
        unit_price: '',
        compare_at_unit_price: '',
        allow_backorder: false,
        internal_note: ''
      });
      setOrderEditSelectedVariant(null);
      setOrderEditAddState({
        saving: false,
        error: '',
        success: 'Item added to edit.'
      });
      refreshOrderChanges();
    } catch (err) {
      setOrderEditAddState({
        saving: false,
        error: err?.message || `Unable to add item to ${orderEditLabel}.`,
        success: ''
      });
    }
  };

  const handleOrderEditAddActionDraftChange = (actionId, field) => (event) => {
    const value = event.target.value;
    setOrderEditAddActionDrafts((prev) => ({
      ...prev,
      [actionId]: {
        ...(prev[actionId] || {}),
        [field]: value
      }
    }));
  };

  const handleUpdateOrderEditAddAction = async (actionId) => {
    if (!record?.id) return;
    if (!orderEditActive) {
      setOrderEditItemState({
        savingId: actionId,
        action: 'add-update',
        error: `Start an ${orderEditLabel} before updating added items.`,
        success: ''
      });
      return;
    }
    if (!orderEditChange?.id) {
      setOrderEditItemState({
        savingId: actionId,
        action: 'add-update',
        error: `${orderEditLabel.charAt(0).toUpperCase() + orderEditLabel.slice(1)} not found. Refresh and try again.`,
        success: ''
      });
      return;
    }
    const draft = orderEditAddActionDrafts[actionId] || {};
    const quantityValue = parseQuantityInput(draft.quantity);
    if (!quantityValue || quantityValue <= 0) {
      setOrderEditItemState({
        savingId: actionId,
        action: 'add-update',
        error: 'Quantity must be at least 1.',
        success: ''
      });
      return;
    }
    const unitPriceInput = String(draft.unit_price ?? '').trim();
    const unitPrice = unitPriceInput ? parsePriceInput(unitPriceInput) : null;
    if (unitPriceInput && unitPrice === null) {
      setOrderEditItemState({
        savingId: actionId,
        action: 'add-update',
        error: 'Unit price must be a number.',
        success: ''
      });
      return;
    }
    const compareInput = String(draft.compare_at_unit_price ?? '').trim();
    const compareAt = compareInput ? parsePriceInput(compareInput) : null;
    if (compareInput && compareAt === null) {
      setOrderEditItemState({
        savingId: actionId,
        action: 'add-update',
        error: 'Compare at price must be a number.',
        success: ''
      });
      return;
    }
    setOrderEditItemState({ savingId: actionId, action: 'add-update', error: '', success: '' });
    try {
      const payload = await request(
        isDraftOrder
          ? `/admin/draft-orders/${record.id}/edit/items/${actionId}`
          : `/admin/order-edits/${orderEditChange.id}/items/${actionId}`,
        {
          method: 'POST',
          body: {
            quantity: quantityValue,
            ...(unitPrice !== null ? { unit_price: unitPrice } : {}),
            ...(compareAt !== null ? { compare_at_unit_price: compareAt } : {}),
            ...(draft.internal_note?.trim() ? { internal_note: draft.internal_note.trim() } : {})
          }
        }
      );
      applyOrderPreviewPayload(payload);
      setOrderEditItemState({
        savingId: null,
        action: '',
        error: '',
        success: 'Added item updated.'
      });
      refreshOrderChanges();
    } catch (err) {
      setOrderEditItemState({
        savingId: null,
        action: '',
        error: err?.message || 'Unable to update added item.',
        success: ''
      });
    }
  };

  const handleRemoveOrderEditAddAction = async (actionId) => {
    if (!record?.id) return;
    if (!orderEditChange?.id) {
      setOrderEditItemState({
        savingId: actionId,
        action: 'add-remove',
        error: `${orderEditLabel.charAt(0).toUpperCase() + orderEditLabel.slice(1)} not found. Refresh and try again.`,
        success: ''
      });
      return;
    }
    if (!window.confirm('Remove this added item from the edit?')) return;
    setOrderEditItemState({ savingId: actionId, action: 'add-remove', error: '', success: '' });
    try {
      const payload = await request(
        isDraftOrder
          ? `/admin/draft-orders/${record.id}/edit/items/${actionId}`
          : `/admin/order-edits/${orderEditChange.id}/items/${actionId}`,
        { method: 'DELETE' }
      );
      applyOrderPreviewPayload(payload);
      setOrderEditItemState({
        savingId: null,
        action: '',
        error: '',
        success: 'Added item removed.'
      });
      refreshOrderChanges();
    } catch (err) {
      setOrderEditItemState({
        savingId: null,
        action: '',
        error: err?.message || 'Unable to remove added item.',
        success: ''
      });
    }
  };

  const handleOrderEditShippingDraftChange = (field) => (event) => {
    const value = event.target.value;
    setOrderEditShippingDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleOrderEditShippingActionDraftChange = (actionId, field) => (event) => {
    const value = event.target.value;
    setOrderEditShippingActionDrafts((prev) => ({
      ...prev,
      [actionId]: {
        ...(prev[actionId] || {}),
        [field]: value
      }
    }));
  };

  const handleAddOrderEditShipping = async (event) => {
    event.preventDefault();
    if (!record?.id) return;
    if (!orderEditActive) {
      setOrderEditShippingState({
        savingId: 'new',
        action: 'add',
        error: `Start an ${orderEditLabel} before adding shipping.`,
        success: ''
      });
      return;
    }
    if (!orderEditChange?.id) {
      setOrderEditShippingState({
        savingId: 'new',
        action: 'add',
        error: `${orderEditLabel.charAt(0).toUpperCase() + orderEditLabel.slice(1)} not found. Refresh and try again.`,
        success: ''
      });
      return;
    }
    const shippingOptionId = orderEditShippingDraft.shipping_option_id.trim();
    if (!shippingOptionId) {
      setOrderEditShippingState({
        savingId: 'new',
        action: 'add',
        error: 'Shipping option is required.',
        success: ''
      });
      return;
    }
    const customAmountInput = String(orderEditShippingDraft.custom_amount ?? '').trim();
    const customAmount = customAmountInput ? parsePriceInput(customAmountInput) : null;
    if (customAmountInput && customAmount === null) {
      setOrderEditShippingState({
        savingId: 'new',
        action: 'add',
        error: 'Custom amount must be a number.',
        success: ''
      });
      return;
    }
    setOrderEditShippingState({ savingId: 'new', action: 'add', error: '', success: '' });
    try {
      const payload = await request(
        isDraftOrder
          ? `/admin/draft-orders/${record.id}/edit/shipping-methods`
          : `/admin/order-edits/${orderEditChange.id}/shipping-method`,
        {
          method: 'POST',
          body: {
            shipping_option_id: shippingOptionId,
            ...(customAmount !== null ? { custom_amount: customAmount } : {}),
            ...(orderEditShippingDraft.description?.trim()
              ? { description: orderEditShippingDraft.description.trim() }
              : {}),
            ...(orderEditShippingDraft.internal_note?.trim()
              ? { internal_note: orderEditShippingDraft.internal_note.trim() }
              : {})
          }
        }
      );
      applyOrderPreviewPayload(payload);
      setOrderEditShippingDraft({
        shipping_option_id: '',
        custom_amount: '',
        description: '',
        internal_note: ''
      });
      setOrderEditShippingState({
        savingId: null,
        action: '',
        error: '',
        success: 'Shipping method added.'
      });
      refreshOrderChanges();
    } catch (err) {
      setOrderEditShippingState({
        savingId: null,
        action: '',
        error: err?.message || `Unable to add shipping method to ${orderEditLabel}.`,
        success: ''
      });
    }
  };

  const handleUpdateOrderEditShipping = async (actionId) => {
    if (!record?.id) return;
    if (!orderEditChange?.id) {
      setOrderEditShippingState({
        savingId: actionId,
        action: 'update',
        error: `${orderEditLabel.charAt(0).toUpperCase() + orderEditLabel.slice(1)} not found. Refresh and try again.`,
        success: ''
      });
      return;
    }
    const draft = orderEditShippingActionDrafts[actionId] || {};
    const customAmountInput = String(draft.custom_amount ?? '').trim();
    const customAmount = customAmountInput ? parsePriceInput(customAmountInput) : null;
    if (customAmountInput && customAmount === null) {
      setOrderEditShippingState({
        savingId: actionId,
        action: 'update',
        error: 'Custom amount must be a number.',
        success: ''
      });
      return;
    }
    setOrderEditShippingState({ savingId: actionId, action: 'update', error: '', success: '' });
    try {
      const payload = await request(
        isDraftOrder
          ? `/admin/draft-orders/${record.id}/edit/shipping-methods/${actionId}`
          : `/admin/order-edits/${orderEditChange.id}/shipping-method/${actionId}`,
        {
          method: 'POST',
          body: {
            ...(customAmount !== null ? { custom_amount: customAmount } : {}),
            ...(draft.internal_note?.trim() ? { internal_note: draft.internal_note.trim() } : {})
          }
        }
      );
      applyOrderPreviewPayload(payload);
      setOrderEditShippingState({
        savingId: null,
        action: '',
        error: '',
        success: 'Shipping method updated.'
      });
      refreshOrderChanges();
    } catch (err) {
      setOrderEditShippingState({
        savingId: null,
        action: '',
        error: err?.message || 'Unable to update shipping method.',
        success: ''
      });
    }
  };

  const handleRemoveOrderEditShipping = async (actionId) => {
    if (!record?.id) return;
    if (!orderEditChange?.id) {
      setOrderEditShippingState({
        savingId: actionId,
        action: 'remove',
        error: `${orderEditLabel.charAt(0).toUpperCase() + orderEditLabel.slice(1)} not found. Refresh and try again.`,
        success: ''
      });
      return;
    }
    if (!window.confirm('Remove this shipping method from the edit?')) return;
    setOrderEditShippingState({ savingId: actionId, action: 'remove', error: '', success: '' });
    try {
      const payload = await request(
        isDraftOrder
          ? `/admin/draft-orders/${record.id}/edit/shipping-methods/${actionId}`
          : `/admin/order-edits/${orderEditChange.id}/shipping-method/${actionId}`,
        { method: 'DELETE' }
      );
      applyOrderPreviewPayload(payload);
      setOrderEditShippingState({
        savingId: null,
        action: '',
        error: '',
        success: 'Shipping method removed.'
      });
      refreshOrderChanges();
    } catch (err) {
      setOrderEditShippingState({
        savingId: null,
        action: '',
        error: err?.message || 'Unable to remove shipping method.',
        success: ''
      });
    }
  };

  const handleDraftOrderShippingMethodDraftChange = (methodId, field) => (event) => {
    const value = event.target.value;
    setDraftOrderShippingMethodDrafts((prev) => ({
      ...prev,
      [methodId]: {
        ...(prev[methodId] || {}),
        [field]: value
      }
    }));
  };

  const handleUpdateDraftOrderShippingMethod = async (methodId) => {
    if (!isDraftOrder || !record?.id) return;
    if (!orderEditActive) {
      setOrderEditShippingState({
        savingId: methodId,
        action: 'update-existing',
        error: `Start an ${orderEditLabel} before updating shipping methods.`,
        success: ''
      });
      return;
    }
    const draft = draftOrderShippingMethodDrafts[methodId] || {};
    const customAmountInput = String(draft.custom_amount ?? '').trim();
    const customAmount = customAmountInput ? parsePriceInput(customAmountInput) : null;
    if (customAmountInput && customAmount === null) {
      setOrderEditShippingState({
        savingId: methodId,
        action: 'update-existing',
        error: 'Custom amount must be a number.',
        success: ''
      });
      return;
    }
    setOrderEditShippingState({
      savingId: methodId,
      action: 'update-existing',
      error: '',
      success: ''
    });
    try {
      const payload = await request(
        `/admin/draft-orders/${record.id}/edit/shipping-methods/method/${methodId}`,
        {
          method: 'POST',
          body: {
            ...(customAmount !== null ? { custom_amount: customAmount } : {})
          }
        }
      );
      applyOrderPreviewPayload(payload);
      setOrderEditShippingState({
        savingId: null,
        action: '',
        error: '',
        success: 'Shipping method updated.'
      });
      refreshOrderChanges();
    } catch (err) {
      setOrderEditShippingState({
        savingId: null,
        action: '',
        error: err?.message || 'Unable to update shipping method.',
        success: ''
      });
    }
  };

  const handleRemoveDraftOrderShippingMethod = async (methodId) => {
    if (!isDraftOrder || !record?.id) return;
    if (!orderEditActive) {
      setOrderEditShippingState({
        savingId: methodId,
        action: 'remove-existing',
        error: `Start an ${orderEditLabel} before removing shipping methods.`,
        success: ''
      });
      return;
    }
    if (!window.confirm('Remove this shipping method from the draft order edit?')) return;
    setOrderEditShippingState({
      savingId: methodId,
      action: 'remove-existing',
      error: '',
      success: ''
    });
    try {
      const payload = await request(
        `/admin/draft-orders/${record.id}/edit/shipping-methods/method/${methodId}`,
        { method: 'DELETE' }
      );
      applyOrderPreviewPayload(payload);
      setOrderEditShippingState({
        savingId: null,
        action: '',
        error: '',
        success: 'Shipping method removed.'
      });
      refreshOrderChanges();
    } catch (err) {
      setOrderEditShippingState({
        savingId: null,
        action: '',
        error: err?.message || 'Unable to remove shipping method.',
        success: ''
      });
    }
  };

  const handleDraftOrderPromotionAdd = async (event) => {
    event.preventDefault();
    if (!isDraftOrder || !record?.id) return;
    if (!orderEditActive) {
      setDraftOrderPromoState({
        saving: false,
        action: 'add',
        error: `Start an ${orderEditLabel} before adding promotions.`,
        success: ''
      });
      return;
    }
    const codes = draftOrderPromoDraft
      .split(',')
      .map((code) => code.trim())
      .filter(Boolean);
    if (!codes.length) {
      setDraftOrderPromoState({
        saving: false,
        action: 'add',
        error: 'Enter at least one promo code.',
        success: ''
      });
      return;
    }
    setDraftOrderPromoState({ saving: true, action: 'add', error: '', success: '' });
    try {
      const payload = await request(`/admin/draft-orders/${record.id}/edit/promotions`, {
        method: 'POST',
        body: { promo_codes: codes }
      });
      applyOrderPreviewPayload(payload);
      setDraftOrderPromoDraft('');
      setDraftOrderPromoState({
        saving: false,
        action: '',
        error: '',
        success: 'Promotion(s) added.'
      });
      refreshOrderChanges();
    } catch (err) {
      setDraftOrderPromoState({
        saving: false,
        action: '',
        error: err?.message || 'Unable to add promotions.',
        success: ''
      });
    }
  };

  const handleDraftOrderPromotionRemove = async (code) => {
    if (!isDraftOrder || !record?.id) return;
    if (!orderEditActive) {
      setDraftOrderPromoState({
        saving: false,
        action: 'remove',
        error: `Start an ${orderEditLabel} before removing promotions.`,
        success: ''
      });
      return;
    }
    if (!code) return;
    setDraftOrderPromoState({ saving: true, action: 'remove', error: '', success: '' });
    try {
      const payload = await request(`/admin/draft-orders/${record.id}/edit/promotions`, {
        method: 'DELETE',
        body: { promo_codes: [code] }
      });
      applyOrderPreviewPayload(payload);
      setDraftOrderPromoState({
        saving: false,
        action: '',
        error: '',
        success: 'Promotion removed.'
      });
      refreshOrderChanges();
    } catch (err) {
      setDraftOrderPromoState({
        saving: false,
        action: '',
        error: err?.message || 'Unable to remove promotion.',
        success: ''
      });
    }
  };

  const handleConvertDraftOrder = async () => {
    if (!isDraftOrder || !record?.id) return;
    if (!window.confirm('Convert this draft order into a live order?')) return;
    setDraftOrderActionState({ saving: true, error: '', success: '' });
    try {
      const payload = await request(`/admin/draft-orders/${record.id}/convert-to-order`, {
        method: 'POST'
      });
      const order =
        payload?.order ||
        payload?.draft_order ||
        payload?.parent ||
        getObjectFromPayload(payload, 'order');
      setDraftOrderActionState({
        saving: false,
        error: '',
        success: 'Draft order converted.'
      });
      if (order?.id) {
        navigate(`/orders/${order.id}`);
      }
    } catch (err) {
      setDraftOrderActionState({
        saving: false,
        error: err?.message || 'Unable to convert draft order.',
        success: ''
      });
    }
  };

  const handleFulfillmentFieldChange = (field) => (event) => {
    const value = event.target.value;
    setFulfillmentDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleFulfillmentToggle = (event) => {
    const value = event.target.checked;
    setFulfillmentDraft((prev) => ({ ...prev, notify_customer: value }));
  };

  const handleFulfillmentItemChange = (itemId) => (event) => {
    const value = Number(event.target.value);
    setFulfillmentDraft((prev) => ({
      ...prev,
      items: {
        ...prev.items,
        [itemId]: Number.isFinite(value) && value > 0 ? value : 0
      }
    }));
  };

  const handleCreateFulfillment = async (event) => {
    event.preventDefault();
    if (!record?.id) return;
    const itemsPayload = Object.entries(fulfillmentDraft.items || {})
      .map(([itemId, quantity]) => ({
        id: itemId,
        quantity: Number(quantity)
      }))
      .filter((entry) => Number.isFinite(entry.quantity) && entry.quantity > 0);

    if (!itemsPayload.length) {
      setFulfillmentState({
        saving: false,
        error: 'Select at least one item to fulfill.',
        success: ''
      });
      return;
    }

    const shippingOptionId =
      fulfillmentDraft.shipping_option_id || fulfillmentDraft.manual_shipping_option_id.trim();

    setFulfillmentState({ saving: true, error: '', success: '' });
    try {
      const payload = await request(`/admin/orders/${record.id}/fulfillments`, {
        method: 'POST',
        body: {
          items: itemsPayload,
          location_id: fulfillmentDraft.location_id || undefined,
          shipping_option_id: shippingOptionId || undefined,
          no_notification: !fulfillmentDraft.notify_customer
        }
      });
      applyOrderPayload(payload);
      setFulfillmentDraft((prev) => ({
        ...prev,
        items: buildItemQuantityMap(orderItems)
      }));
      setFulfillmentState({ saving: false, error: '', success: 'Fulfillment created.' });
    } catch (err) {
      setFulfillmentState({
        saving: false,
        error: err?.message || 'Unable to create fulfillment.',
        success: ''
      });
    }
  };

  const handleShipmentFieldChange = (fulfillmentId, field) => (event) => {
    const value = event.target.value;
    setShipmentDrafts((prev) => ({
      ...prev,
      [fulfillmentId]: {
        ...prev[fulfillmentId],
        [field]: value
      }
    }));
  };

  const handleShipmentToggle = (fulfillmentId) => (event) => {
    const value = event.target.checked;
    setShipmentDrafts((prev) => ({
      ...prev,
      [fulfillmentId]: {
        ...prev[fulfillmentId],
        notify_customer: value
      }
    }));
  };

  const handleShipmentItemChange = (fulfillmentId, itemId) => (event) => {
    const value = Number(event.target.value);
    setShipmentDrafts((prev) => ({
      ...prev,
      [fulfillmentId]: {
        ...prev[fulfillmentId],
        items: {
          ...(prev[fulfillmentId]?.items || {}),
          [itemId]: Number.isFinite(value) && value > 0 ? value : 0
        }
      }
    }));
  };

  const handleFulfillmentLabelUpload = async (fulfillmentId, event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFulfillmentLabelUploadState({
      uploadingId: fulfillmentId,
      targetId: fulfillmentId,
      error: '',
      success: ''
    });
    try {
      const payload = await uploadFiles(file);
      const files = getArrayFromPayload(payload, 'files');
      const uploaded = files[0] || getObjectFromPayload(payload, 'file');
      const url = uploaded?.url || uploaded?.id;
      if (!url) {
        throw new Error('Upload succeeded, but no file URL was returned.');
      }
      setShipmentDrafts((prev) => ({
        ...prev,
        [fulfillmentId]: {
          ...(prev[fulfillmentId] || {}),
          label_url: url
        }
      }));
      setFulfillmentLabelUploadState({
        uploadingId: null,
        targetId: fulfillmentId,
        error: '',
        success: 'Label uploaded. Click Create shipment to attach it.'
      });
    } catch (err) {
      setFulfillmentLabelUploadState({
        uploadingId: null,
        targetId: fulfillmentId,
        error: err?.message || 'Unable to upload label.',
        success: ''
      });
    } finally {
      event.target.value = '';
    }
  };

  const handleCreateShipment = async (fulfillmentId) => {
    if (!record?.id) return;
    const draft = shipmentDrafts[fulfillmentId];
    const itemsPayload = Object.entries(draft?.items || {})
      .map(([itemId, quantity]) => ({
        id: itemId,
        quantity: Number(quantity)
      }))
      .filter((entry) => Number.isFinite(entry.quantity) && entry.quantity > 0);

    if (!itemsPayload.length) {
      setShipmentState({
        savingId: null,
        action: '',
        error: 'Select at least one item to ship.',
        success: ''
      });
      return;
    }

    const trackingNumber = String(draft?.tracking_number || '').trim();
    const trackingUrl = String(draft?.tracking_url || '').trim();
    const labelUrl = String(draft?.label_url || '').trim();
    const hasTrackingNumber = Boolean(trackingNumber);
    const hasTrackingUrl = Boolean(trackingUrl);
    const hasLabelUrl = Boolean(labelUrl);
    const hasLabelData = hasTrackingNumber || hasTrackingUrl || hasLabelUrl;

    if ((hasTrackingNumber || hasTrackingUrl) && !(hasTrackingNumber && hasTrackingUrl)) {
      setShipmentState({
        savingId: null,
        action: '',
        error: 'Tracking number and tracking URL are both required when providing tracking info.',
        success: ''
      });
      return;
    }

    const labelPayload = {};
    if (hasTrackingNumber) labelPayload.tracking_number = trackingNumber;
    if (hasTrackingUrl) labelPayload.tracking_url = trackingUrl;
    if (hasLabelUrl) labelPayload.label_url = labelUrl;

    const labels = hasLabelData ? [labelPayload] : undefined;

    setShipmentState({ savingId: fulfillmentId, action: 'ship', error: '', success: '' });
    try {
      const payload = await request(
        `/admin/orders/${record.id}/fulfillments/${fulfillmentId}/shipments`,
        {
          method: 'POST',
          body: {
            items: itemsPayload,
            labels,
            no_notification: draft?.notify_customer === false
          }
        }
      );
      applyOrderPayload(payload);
      setShipmentState({
        savingId: null,
        action: '',
        error: '',
        success: 'Shipment created.'
      });
    } catch (err) {
      setShipmentState({
        savingId: null,
        action: '',
        error: err?.message || 'Unable to create shipment.',
        success: ''
      });
    }
  };

  const handleMarkFulfillmentDelivered = async (fulfillmentId) => {
    if (!record?.id) return;
    setShipmentState({ savingId: fulfillmentId, action: 'deliver', error: '', success: '' });
    try {
      const payload = await request(
        `/admin/orders/${record.id}/fulfillments/${fulfillmentId}/mark-as-delivered`,
        { method: 'POST' }
      );
      applyOrderPayload(payload);
      setShipmentState({
        savingId: null,
        action: '',
        error: '',
        success: 'Fulfillment marked as delivered.'
      });
    } catch (err) {
      setShipmentState({
        savingId: null,
        action: '',
        error: err?.message || 'Unable to mark fulfillment delivered.',
        success: ''
      });
    }
  };

  const handleCancelFulfillment = async (fulfillmentId) => {
    if (!record?.id) return;
    if (!window.confirm('Cancel this fulfillment?')) return;
    setShipmentState({ savingId: fulfillmentId, action: 'cancel', error: '', success: '' });
    try {
      const payload = await request(
        `/admin/orders/${record.id}/fulfillments/${fulfillmentId}/cancel`,
        { method: 'POST', body: {} }
      );
      applyOrderPayload(payload);
      setShipmentState({
        savingId: null,
        action: '',
        error: '',
        success: 'Fulfillment canceled.'
      });
    } catch (err) {
      setShipmentState({
        savingId: null,
        action: '',
        error: err?.message || 'Unable to cancel fulfillment.',
        success: ''
      });
    }
  };

  const updatePaymentDraft = (paymentId, field, value) => {
    setPaymentDrafts((prev) => ({
      ...prev,
      [paymentId]: {
        capture_amount: '',
        refund_amount: '',
        refund_note: '',
        refund_reason_id: '',
        ...(prev[paymentId] || {}),
        [field]: value
      }
    }));
  };

  const handleCapturePayment = async (paymentId) => {
    if (!paymentId) return;
    const draft = paymentDrafts[paymentId] || {};
    const amount = parsePriceInput(draft.capture_amount);
    setPaymentState({ savingId: paymentId, action: 'capture', error: '', success: '' });
    try {
      await request(`/admin/payments/${paymentId}/capture`, {
        method: 'POST',
        body: amount === null ? {} : { amount }
      });
      await refreshOrder();
      setPaymentState({
        savingId: null,
        action: '',
        error: '',
        success: 'Payment captured.'
      });
    } catch (err) {
      setPaymentState({
        savingId: null,
        action: '',
        error: err?.message || 'Unable to capture payment.',
        success: ''
      });
    }
  };

  const handleRefundPayment = async (paymentId) => {
    if (!paymentId) return;
    const draft = paymentDrafts[paymentId] || {};
    const amount = parsePriceInput(draft.refund_amount);
    setPaymentState({ savingId: paymentId, action: 'refund', error: '', success: '' });
    try {
      await request(`/admin/payments/${paymentId}/refund`, {
        method: 'POST',
        body: {
          ...(amount === null ? {} : { amount }),
          note: draft.refund_note || undefined,
          refund_reason_id: draft.refund_reason_id || undefined
        }
      });
      await refreshOrder();
      setPaymentState({
        savingId: null,
        action: '',
        error: '',
        success: 'Refund created.'
      });
    } catch (err) {
      setPaymentState({
        savingId: null,
        action: '',
        error: err?.message || 'Unable to refund payment.',
        success: ''
      });
    }
  };

  const handleReturnDraftChange = (field) => (event) => {
    const value = event.target.value;
    setReturnDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleReturnDraftToggle = (event) => {
    const value = event.target.checked;
    setReturnDraft((prev) => ({ ...prev, notify_customer: value }));
  };

  const handleReturnRequestItemChange = (returnId, itemId, field) => (event) => {
    const value = field === 'quantity' ? Number(event.target.value) : event.target.value;
    setReturnRequestDrafts((prev) => ({
      ...prev,
      [returnId]: {
        ...(prev[returnId] || buildReturnRequestMap(returnItemSource)),
        [itemId]: {
          ...(prev[returnId]?.[itemId] || { quantity: 0, reason_id: '' }),
          [field]: field === 'quantity' ? (Number.isFinite(value) && value > 0 ? value : 0) : value
        }
      }
    }));
  };

  const handleReturnReceiveItemChange = (returnId, itemId) => (event) => {
    const value = Number(event.target.value);
    setReturnReceiveDrafts((prev) => ({
      ...prev,
      [returnId]: {
        ...(prev[returnId] || buildReturnReceiveMap(returnItemSource)),
        [itemId]: Number.isFinite(value) && value > 0 ? value : 0
      }
    }));
  };

  const handleCreateReturn = async (event) => {
    event.preventDefault();
    if (!record?.id) return;
    setReturnState({ savingId: 'new', error: '', success: '' });
    try {
      const payload = await request('/admin/returns', {
        method: 'POST',
        body: {
          order_id: record.id,
          location_id: returnDraft.location_id || undefined,
          description: returnDraft.description || undefined,
          internal_note: returnDraft.internal_note || undefined,
          no_notification: !returnDraft.notify_customer
        }
      });
      if (payload?.order) applyOrderPayload(payload);
      await refreshReturns();
      setReturnState({ savingId: null, error: '', success: 'Return created.' });
    } catch (err) {
      setReturnState({
        savingId: null,
        error: err?.message || 'Unable to create return.',
        success: ''
      });
    }
  };

  const handleRequestReturnItems = async (returnId) => {
    const draft = returnRequestDrafts[returnId] || {};
    const itemsPayload = Object.entries(draft)
      .map(([itemId, entry]) => ({
        id: itemId,
        quantity: Number(entry.quantity || 0),
        reason_id: entry.reason_id || undefined
      }))
      .filter((entry) => Number.isFinite(entry.quantity) && entry.quantity > 0);

    if (!itemsPayload.length) {
      setReturnState({
        savingId: null,
        error: 'Select at least one item to request.',
        success: ''
      });
      return;
    }

    setReturnState({ savingId: returnId, error: '', success: '' });
    try {
      await request(`/admin/returns/${returnId}/request-items`, {
        method: 'POST',
        body: { items: itemsPayload }
      });
      if (isReturn) {
        await refreshReturnDetail();
      } else {
        await refreshReturns();
      }
      setReturnState({ savingId: null, error: '', success: 'Return items requested.' });
    } catch (err) {
      setReturnState({
        savingId: null,
        error: err?.message || 'Unable to request return items.',
        success: ''
      });
    }
  };

  const handleConfirmReturnRequest = async (returnId) => {
    setReturnState({ savingId: returnId, error: '', success: '' });
    try {
      await request(`/admin/returns/${returnId}/request`, {
        method: 'POST',
        body: { no_notification: !returnDraft.notify_customer }
      });
      if (isReturn) {
        await refreshReturnDetail();
      } else {
        await refreshReturns();
      }
      setReturnState({ savingId: null, error: '', success: 'Return request confirmed.' });
    } catch (err) {
      setReturnState({
        savingId: null,
        error: err?.message || 'Unable to confirm return request.',
        success: ''
      });
    }
  };

  const handleStartReturnReceive = async (returnId) => {
    setReturnState({ savingId: returnId, error: '', success: '' });
    try {
      await request(`/admin/returns/${returnId}/receive`, {
        method: 'POST',
        body: {
          description: returnDraft.description || undefined,
          internal_note: returnDraft.internal_note || undefined
        }
      });
      if (isReturn) {
        await refreshReturnDetail();
      } else {
        await refreshReturns();
      }
      setReturnState({ savingId: null, error: '', success: 'Receiving started.' });
    } catch (err) {
      setReturnState({
        savingId: null,
        error: err?.message || 'Unable to start receiving.',
        success: ''
      });
    }
  };

  const handleReceiveReturnItems = async (returnId) => {
    const draft = returnReceiveDrafts[returnId] || {};
    const itemsPayload = Object.entries(draft)
      .map(([itemId, quantity]) => ({
        id: itemId,
        quantity: Number(quantity || 0)
      }))
      .filter((entry) => Number.isFinite(entry.quantity) && entry.quantity > 0);

    if (!itemsPayload.length) {
      setReturnState({
        savingId: null,
        error: 'Select at least one item to receive.',
        success: ''
      });
      return;
    }

    setReturnState({ savingId: returnId, error: '', success: '' });
    try {
      await request(`/admin/returns/${returnId}/receive-items`, {
        method: 'POST',
        body: { items: itemsPayload }
      });
      if (isReturn) {
        await refreshReturnDetail();
      } else {
        await refreshReturns();
      }
      setReturnState({ savingId: null, error: '', success: 'Return items received.' });
    } catch (err) {
      setReturnState({
        savingId: null,
        error: err?.message || 'Unable to receive return items.',
        success: ''
      });
    }
  };

  const handleConfirmReturnReceive = async (returnId) => {
    setReturnState({ savingId: returnId, error: '', success: '' });
    try {
      await request(`/admin/returns/${returnId}/receive/confirm`, {
        method: 'POST',
        body: { no_notification: !returnDraft.notify_customer }
      });
      if (isReturn) {
        await refreshReturnDetail();
      } else {
        await refreshReturns();
      }
      setReturnState({ savingId: null, error: '', success: 'Return received.' });
    } catch (err) {
      setReturnState({
        savingId: null,
        error: err?.message || 'Unable to confirm receipt.',
        success: ''
      });
    }
  };

  const handleCancelReturn = async (returnId) => {
    if (!window.confirm('Cancel this return?')) return;
    setReturnState({ savingId: returnId, error: '', success: '' });
    try {
      await request(`/admin/returns/${returnId}/cancel`, {
        method: 'POST',
        body: { no_notification: !returnDraft.notify_customer }
      });
      if (isReturn) {
        await refreshReturnDetail();
      } else {
        await refreshReturns();
      }
      setReturnState({ savingId: null, error: '', success: 'Return canceled.' });
    } catch (err) {
      setReturnState({
        savingId: null,
        error: err?.message || 'Unable to cancel return.',
        success: ''
      });
    }
  };

  const handleExchangeDraftChange = (field) => (event) => {
    const value = event.target.value;
    setExchangeDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleCreateExchange = async (event) => {
    event.preventDefault();
    if (!record?.id) return;
    setExchangeState({ savingId: 'new', error: '', success: '' });
    try {
      await request('/admin/exchanges', {
        method: 'POST',
        body: {
          order_id: record.id,
          description: exchangeDraft.description || undefined,
          internal_note: exchangeDraft.internal_note || undefined
        }
      });
      if (isExchange) {
        await refreshExchangeDetail();
      } else {
        await refreshExchanges();
        await refreshOrderPreview();
      }
      setExchangeState({ savingId: null, error: '', success: 'Exchange created.' });
    } catch (err) {
      setExchangeState({
        savingId: null,
        error: err?.message || 'Unable to create exchange.',
        success: ''
      });
    }
  };

  const handleExchangeInboundChange = (exchangeId, itemId, field) => (event) => {
    const value = field === 'quantity' ? Number(event.target.value) : event.target.value;
    setExchangeInboundDrafts((prev) => ({
      ...prev,
      [exchangeId]: {
        ...(prev[exchangeId] || { location_id: '', items: buildReturnRequestMap(exchangeItemSource) }),
        items: {
          ...(prev[exchangeId]?.items || buildReturnRequestMap(exchangeItemSource)),
          [itemId]: {
            ...(prev[exchangeId]?.items?.[itemId] || { quantity: 0, reason_id: '' }),
            [field]: field === 'quantity' ? (Number.isFinite(value) && value > 0 ? value : 0) : value
          }
        }
      }
    }));
  };

  const handleExchangeInboundLocation = (exchangeId) => (event) => {
    const value = event.target.value;
    setExchangeInboundDrafts((prev) => ({
      ...prev,
      [exchangeId]: {
        ...(prev[exchangeId] || { location_id: '', items: buildReturnRequestMap(exchangeItemSource) }),
        location_id: value
      }
    }));
  };

  const handleAddExchangeInboundItems = async (exchangeId) => {
    const draft = exchangeInboundDrafts[exchangeId] || {};
    const itemsPayload = Object.entries(draft.items || {})
      .map(([itemId, entry]) => ({
        id: itemId,
        quantity: Number(entry.quantity || 0),
        reason_id: entry.reason_id || undefined
      }))
      .filter((entry) => Number.isFinite(entry.quantity) && entry.quantity > 0);

    if (!itemsPayload.length) {
      setExchangeState({
        savingId: null,
        error: 'Select at least one inbound item.',
        success: ''
      });
      return;
    }

    setExchangeState({ savingId: exchangeId, error: '', success: '' });
    try {
      await request(`/admin/exchanges/${exchangeId}/inbound/items`, {
        method: 'POST',
        body: {
          location_id: draft.location_id || undefined,
          items: itemsPayload
        }
      });
      await refreshExchangeContext();
      setExchangeState({ savingId: null, error: '', success: 'Inbound items added.' });
    } catch (err) {
      setExchangeState({
        savingId: null,
        error: err?.message || 'Unable to add inbound items.',
        success: ''
      });
    }
  };

  const handleExchangeOutboundField = (exchangeId, field) => (event) => {
    const value = event.target.value;
    setExchangeOutboundDrafts((prev) => ({
      ...prev,
      [exchangeId]: {
        ...(prev[exchangeId] || {
          items: [],
          newItem: { variant_id: '', quantity: 1, unit_price: '', allow_backorder: false }
        }),
        newItem: {
          ...(prev[exchangeId]?.newItem || {
            variant_id: '',
            quantity: 1,
            unit_price: '',
            allow_backorder: false
          }),
          [field]: field === 'quantity' ? Number(value) : value
        }
      }
    }));
  };

  const handleExchangeOutboundToggle = (exchangeId) => (event) => {
    const value = event.target.checked;
    setExchangeOutboundDrafts((prev) => ({
      ...prev,
      [exchangeId]: {
        ...(prev[exchangeId] || {
          items: [],
          newItem: { variant_id: '', quantity: 1, unit_price: '', allow_backorder: false }
        }),
        newItem: {
          ...(prev[exchangeId]?.newItem || {
            variant_id: '',
            quantity: 1,
            unit_price: '',
            allow_backorder: false
          }),
          allow_backorder: value
        }
      }
    }));
  };

  const handleExchangeShippingDraftChange = (exchangeId, field) => (event) => {
    const value = event.target.value;
    setExchangeShippingDrafts((prev) => ({
      ...prev,
      [exchangeId]: {
        ...(prev[exchangeId] || {
          outbound_option_id: '',
          outbound_custom_amount: '',
          inbound_option_id: '',
          inbound_custom_amount: '',
          inbound_tracking_number: '',
          inbound_tracking_url: '',
          inbound_label_url: ''
        }),
        [field]: value
      }
    }));
  };

  const handleInboundLabelUpload = async (exchangeId, event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setExchangeLabelUploadState({
      uploadingId: exchangeId,
      targetId: exchangeId,
      error: '',
      success: ''
    });
    try {
      const payload = await uploadFiles(file);
      const files = getArrayFromPayload(payload, 'files');
      const uploaded = files[0] || getObjectFromPayload(payload, 'file');
      const url = uploaded?.url || uploaded?.id;
      if (!url) {
        throw new Error('Upload succeeded, but no file URL was returned.');
      }
      setExchangeShippingDrafts((prev) => ({
        ...prev,
        [exchangeId]: {
          ...(prev[exchangeId] || {}),
          inbound_label_url: url
        }
      }));
      setExchangeLabelUploadState({
        uploadingId: null,
        targetId: exchangeId,
        error: '',
        success: 'Label uploaded. Click save inbound shipping to attach it.'
      });
    } catch (err) {
      setExchangeLabelUploadState({
        uploadingId: null,
        targetId: exchangeId,
        error: err?.message || 'Unable to upload label.',
        success: ''
      });
    } finally {
      event.target.value = '';
    }
  };

  const handleSaveExchangeInboundShipping = async (exchangeId) => {
    const draft = exchangeShippingDrafts[exchangeId] || {};
    const optionId = String(draft.inbound_option_id || '').trim();
    const customAmount = parsePriceInput(draft.inbound_custom_amount);
    const trackingNumber = String(draft.inbound_tracking_number || '').trim();
    const trackingUrl = String(draft.inbound_tracking_url || '').trim();
    const labelUrl = String(draft.inbound_label_url || '').trim();
    const exchangeReturnId = resolveExchangeReturnId(exchangeId, exchangeRecords);
    const inboundShipping = getExchangeShippingMethod(
      orderPreview,
      exchangeId,
      'inbound',
      exchangeReturnId
    );
    const actionId = inboundShipping
      ? getExchangeShippingActionId(inboundShipping, exchangeId, 'inbound', exchangeReturnId)
      : null;
    const resolvedOptionId = optionId || inboundShipping?.shipping_option_id || '';
    const trackingUpdates = {
      tracking_number: trackingNumber,
      tracking_url: trackingUrl,
      label_url: labelUrl
    };
    const hasTrackingInput = Object.values(trackingUpdates).some((value) => value);
    const metadataPayload = inboundShipping
      ? buildShippingMetadata(inboundShipping.metadata, trackingUpdates)
      : hasTrackingInput
        ? buildShippingMetadata({}, trackingUpdates)
        : undefined;

    if (!exchangeReturnId) {
      setExchangeState({
        savingId: null,
        error: 'Add inbound items first to create a return.',
        success: ''
      });
      return;
    }

    if (!resolvedOptionId) {
      setExchangeState({
        savingId: null,
        error: 'Select a shipping option before saving.',
        success: ''
      });
      return;
    }

    if (inboundShipping && !actionId) {
      setExchangeState({
        savingId: null,
        error: 'Unable to resolve inbound shipping action. Refresh and try again.',
        success: ''
      });
      return;
    }

    setExchangeState({ savingId: exchangeId, error: '', success: '' });
    try {
      if (inboundShipping && actionId && inboundShipping.shipping_option_id === resolvedOptionId) {
        const updateBody = {
          custom_amount: customAmount ?? null
        };
        if (metadataPayload !== undefined) {
          updateBody.metadata = metadataPayload;
        }
        await request(`/admin/exchanges/${exchangeId}/inbound/shipping-method/${actionId}`, {
          method: 'POST',
          body: updateBody
        });
      } else {
        if (actionId) {
          await request(`/admin/exchanges/${exchangeId}/inbound/shipping-method/${actionId}`, {
            method: 'DELETE'
          });
        }
        const createBody = {
          shipping_option_id: resolvedOptionId,
          custom_amount: customAmount ?? undefined
        };
        if (metadataPayload !== undefined) {
          createBody.metadata = metadataPayload;
        }
        await request(`/admin/exchanges/${exchangeId}/inbound/shipping-method`, {
          method: 'POST',
          body: createBody
        });
      }

      await refreshExchangeContext();
      setExchangeState({ savingId: null, error: '', success: 'Inbound shipping updated.' });
    } catch (err) {
      setExchangeState({
        savingId: null,
        error: err?.message || 'Unable to update inbound shipping.',
        success: ''
      });
    }
  };

  const handleClearExchangeInboundShipping = async (exchangeId) => {
    const exchangeReturnId = resolveExchangeReturnId(exchangeId, exchangeRecords);
    const inboundShipping = getExchangeShippingMethod(
      orderPreview,
      exchangeId,
      'inbound',
      exchangeReturnId
    );
    const actionId = inboundShipping
      ? getExchangeShippingActionId(inboundShipping, exchangeId, 'inbound', exchangeReturnId)
      : null;

    if (!actionId) {
      setExchangeState({
        savingId: null,
        error: 'No inbound shipping method to remove.',
        success: ''
      });
      return;
    }

    setExchangeState({ savingId: exchangeId, error: '', success: '' });
    try {
      await request(`/admin/exchanges/${exchangeId}/inbound/shipping-method/${actionId}`, {
        method: 'DELETE'
      });
      await refreshExchangeContext();
      setExchangeState({ savingId: null, error: '', success: 'Inbound shipping removed.' });
    } catch (err) {
      setExchangeState({
        savingId: null,
        error: err?.message || 'Unable to remove inbound shipping.',
        success: ''
      });
    }
  };

  const handleSaveExchangeOutboundShipping = async (exchangeId) => {
    const draft = exchangeShippingDrafts[exchangeId] || {};
    const optionId = String(draft.outbound_option_id || '').trim();
    const customAmount = parsePriceInput(draft.outbound_custom_amount);
    const outboundShipping = getExchangeShippingMethod(orderPreview, exchangeId, 'outbound');
    const actionId = outboundShipping
      ? getExchangeShippingActionId(outboundShipping, exchangeId, 'outbound')
      : null;

    if (!optionId) {
      setExchangeState({
        savingId: null,
        error: 'Select a shipping option before saving.',
        success: ''
      });
      return;
    }

    if (outboundShipping && !actionId) {
      setExchangeState({
        savingId: null,
        error: 'Unable to resolve outbound shipping action. Refresh and try again.',
        success: ''
      });
      return;
    }

    setExchangeState({ savingId: exchangeId, error: '', success: '' });
    try {
      if (outboundShipping && actionId && outboundShipping.shipping_option_id === optionId) {
        await request(`/admin/exchanges/${exchangeId}/outbound/shipping-method/${actionId}`, {
          method: 'POST',
          body: {
            custom_amount: customAmount ?? null
          }
        });
      } else {
        if (actionId) {
          await request(`/admin/exchanges/${exchangeId}/outbound/shipping-method/${actionId}`, {
            method: 'DELETE'
          });
        }
        await request(`/admin/exchanges/${exchangeId}/outbound/shipping-method`, {
          method: 'POST',
          body: {
            shipping_option_id: optionId,
            custom_amount: customAmount ?? undefined
          }
        });
      }

      await refreshExchangeContext();
      setExchangeState({ savingId: null, error: '', success: 'Outbound shipping updated.' });
    } catch (err) {
      setExchangeState({
        savingId: null,
        error: err?.message || 'Unable to update outbound shipping.',
        success: ''
      });
    }
  };

  const handleClearExchangeOutboundShipping = async (exchangeId) => {
    const outboundShipping = getExchangeShippingMethod(orderPreview, exchangeId, 'outbound');
    const actionId = outboundShipping
      ? getExchangeShippingActionId(outboundShipping, exchangeId, 'outbound')
      : null;

    if (!actionId) {
      setExchangeState({
        savingId: null,
        error: 'No outbound shipping method to remove.',
        success: ''
      });
      return;
    }

    setExchangeState({ savingId: exchangeId, error: '', success: '' });
    try {
      await request(`/admin/exchanges/${exchangeId}/outbound/shipping-method/${actionId}`, {
        method: 'DELETE'
      });
      await refreshExchangeContext();
      setExchangeState({ savingId: null, error: '', success: 'Outbound shipping removed.' });
    } catch (err) {
      setExchangeState({
        savingId: null,
        error: err?.message || 'Unable to remove outbound shipping.',
        success: ''
      });
    }
  };

  const handleAddExchangeOutboundItem = (exchangeId) => {
    const draft = exchangeOutboundDrafts[exchangeId];
    if (!draft) return;
    const variantId = String(draft.newItem?.variant_id || '').trim();
    const quantity = Number(draft.newItem?.quantity || 0);
    if (!variantId) {
      setExchangeState({ savingId: null, error: 'Variant ID is required.', success: '' });
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setExchangeState({ savingId: null, error: 'Quantity must be at least 1.', success: '' });
      return;
    }
    setExchangeOutboundDrafts((prev) => ({
      ...prev,
      [exchangeId]: {
        ...prev[exchangeId],
        items: [
          ...prev[exchangeId].items,
          {
            variant_id: variantId,
            quantity,
            unit_price: draft.newItem?.unit_price || '',
            allow_backorder: Boolean(draft.newItem?.allow_backorder)
          }
        ],
        newItem: { variant_id: '', quantity: 1, unit_price: '', allow_backorder: false }
      }
    }));
  };

  const handleRemoveExchangeOutboundItem = (exchangeId, index) => {
    setExchangeOutboundDrafts((prev) => ({
      ...prev,
      [exchangeId]: {
        ...prev[exchangeId],
        items: prev[exchangeId].items.filter((_, itemIndex) => itemIndex !== index)
      }
    }));
  };

  const handleSubmitExchangeOutboundItems = async (exchangeId) => {
    const draft = exchangeOutboundDrafts[exchangeId];
    if (!draft?.items?.length) {
      setExchangeState({ savingId: null, error: 'Add at least one outbound item.', success: '' });
      return;
    }
    const itemsPayload = draft.items.map((item) => ({
      variant_id: item.variant_id,
      quantity: Number(item.quantity),
      unit_price: parsePriceInput(item.unit_price) ?? undefined,
      allow_backorder: item.allow_backorder || undefined
    }));

    setExchangeState({ savingId: exchangeId, error: '', success: '' });
    try {
      await request(`/admin/exchanges/${exchangeId}/outbound/items`, {
        method: 'POST',
        body: { items: itemsPayload }
      });
      await refreshExchangeContext();
      setExchangeOutboundDrafts((prev) => ({
        ...prev,
        [exchangeId]: {
          ...prev[exchangeId],
          items: []
        }
      }));
      setExchangeState({ savingId: null, error: '', success: 'Outbound items added.' });
    } catch (err) {
      setExchangeState({
        savingId: null,
        error: err?.message || 'Unable to add outbound items.',
        success: ''
      });
    }
  };

  const handleConfirmExchangeRequest = async (exchangeId) => {
    setExchangeState({ savingId: exchangeId, error: '', success: '' });
    try {
      await request(`/admin/exchanges/${exchangeId}/request`, { method: 'POST' });
      await refreshExchangeContext();
      setExchangeState({ savingId: null, error: '', success: 'Exchange request confirmed.' });
    } catch (err) {
      setExchangeState({
        savingId: null,
        error: err?.message || 'Unable to confirm exchange request.',
        success: ''
      });
    }
  };

  const handleCancelExchange = async (exchangeId) => {
    if (!window.confirm('Cancel this exchange?')) return;
    setExchangeState({ savingId: exchangeId, error: '', success: '' });
    try {
      let canceledViaRequest = false;
      try {
        await request(`/admin/exchanges/${exchangeId}/request`, {
          method: 'DELETE'
        });
        canceledViaRequest = true;
      } catch (err) {
        if (!(err instanceof ApiError) || ![400, 404, 409].includes(err.status)) {
          throw err;
        }
      }

      if (!canceledViaRequest) {
        await request(`/admin/exchanges/${exchangeId}/cancel`, {
          method: 'POST',
          body: { no_notification: false }
        });
      }

      await refreshExchangeContext();
      setExchangeState({
        savingId: null,
        error: '',
        success: canceledViaRequest ? 'Exchange request canceled.' : 'Exchange canceled.'
      });
    } catch (err) {
      setExchangeState({
        savingId: null,
        error: err?.message || 'Unable to cancel exchange.',
        success: ''
      });
    }
  };

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

  const productThumbnail = useMemo(() => {
    if (!record) return '';
    return (
      record.thumbnail ||
      record.image ||
      record.cover_image ||
      record.images?.[0]?.url ||
      record.images?.[0] ||
      ''
    );
  }, [record]);

  const returnOrderId = isReturn ? record?.order_id || record?.order?.id : null;
  const returnRefundAmount = isReturn
    ? record?.refund_amount ??
      record?.refund_total ??
      record?.refund?.amount ??
      record?.refunded_amount ??
      null
    : null;
  const returnShippingMethod = isReturn
    ? record?.shipping_method || record?.shipping_methods?.[0] || record?.shipping_option
    : null;
  const returnShippingLabel =
    returnShippingMethod?.name ||
    returnShippingMethod?.shipping_option?.name ||
    returnShippingMethod?.shipping_option_id ||
    returnShippingMethod?.id ||
    '';
  const returnOrderDisplayId = linkedOrder?.display_id || record?.order?.display_id || null;
  const returnOrderLabel = returnOrderId
    ? returnOrderDisplayId
      ? `#${returnOrderDisplayId}`
      : returnOrderId
    : '';
  const returnRequestDraft =
    isReturn && record?.id ? returnRequestDrafts[record.id] || {} : {};
  const returnReceiveDraft =
    isReturn && record?.id ? returnReceiveDrafts[record.id] || {} : {};
  const returnIsBusy = isReturn && record?.id ? returnState.savingId === record.id : false;

  const customerDetails = useMemo(() => {
    if (!isOrderLike || !record) return [];
    const details = [];
    const name = [record?.customer?.first_name, record?.customer?.last_name]
      .filter(Boolean)
      .join(' ');
    const email = record?.email || record?.customer?.email;
    const phone =
      record?.customer?.phone || record?.shipping_address?.phone || record?.billing_address?.phone;
    if (name) details.push({ label: 'Name', value: name });
    if (email) details.push({ label: 'Email', value: email });
    if (phone) details.push({ label: 'Phone', value: phone });
    if (record?.customer?.id) {
      details.push({ label: 'Customer ID', value: record.customer.id });
    } else if (record?.customer_id) {
      details.push({ label: 'Customer ID', value: record.customer_id });
    }
    return details;
  }, [isOrderLike, record]);

  const shippingAddressLines = useMemo(
    () => (isOrderLike ? buildAddressLines(record?.shipping_address) : []),
    [isOrderLike, record]
  );

  const billingAddressLines = useMemo(
    () => (isOrderLike ? buildAddressLines(record?.billing_address) : []),
    [isOrderLike, record]
  );

  const orderItemRows = useMemo(() => {
    if (!isOrderLike || !record) return [];
    const items = Array.isArray(record.items)
      ? record.items
      : Array.isArray(record.line_items)
        ? record.line_items
        : [];
    return items.map((item, index) => {
      const quantity = getLineItemQuantity(item);
      const unitPrice = getLineItemUnitPrice(item);
      const total = getLineItemTotal(item);
      return {
        id: item?.id || item?.item_id || item?.detail?.id || `${record.id || 'item'}-${index}`,
        thumbnail: getLineItemThumbnail(item),
        title: getLineItemTitle(item),
        sku: item?.variant_sku || item?.variant?.sku || item?.sku || '-',
        quantity,
        unit_price: unitPrice,
        total,
        currency_code: item?.currency_code || record.currency_code || orderCurrency
      };
    });
  }, [isOrder, record, orderCurrency]);

  const orderItemColumns = useMemo(
    () => [
      { key: 'thumbnail', label: 'Item', type: 'thumbnail' },
      { key: 'title', label: 'Item' },
      { key: 'sku', label: 'SKU' },
      { key: 'quantity', label: 'Qty' },
      {
        key: 'unit_price',
        label: 'Unit',
        format: (value, row) => formatMoneyOrDash(value, row?.currency_code || orderCurrency)
      },
      {
        key: 'total',
        label: 'Total',
        format: (value, row) => formatMoneyOrDash(value, row?.currency_code || orderCurrency)
      }
    ],
    [orderCurrency]
  );

  const returnItemColumns = useMemo(
    () => [
      { key: 'title', label: 'Item' },
      { key: 'sku', label: 'SKU' },
      { key: 'quantity', label: 'Requested' },
      {
        key: 'received',
        label: 'Received',
        format: (value) => (value === null || value === undefined ? '-' : value)
      },
      { key: 'reason', label: 'Reason' },
      { key: 'note', label: 'Note' }
    ],
    []
  );

  const returnItemRows = useMemo(
    () => buildReturnItemRows(returnRecordItems, record?.id),
    [returnRecordItems, record?.id]
  );

  const orderTotals = useMemo(() => {
    if (!isOrderLike || !record) return [];
    const totals = [];
    const pushTotal = (label, amount) => {
      const numeric = toNumber(amount);
      if (numeric === null) return;
      totals.push({ label, amount: numeric });
    };
    pushTotal('Item subtotal', record.item_subtotal ?? record.subtotal ?? record.original_subtotal);
    pushTotal('Discounts', record.discount_total ?? record.discount_subtotal);
    pushTotal('Shipping', record.shipping_total ?? record.shipping_subtotal);
    pushTotal('Tax', record.tax_total ?? record.shipping_tax_total ?? record.item_tax_total);
    pushTotal('Total', record.total ?? record.original_total);
    if (record.summary) {
      pushTotal('Paid', record.summary.paid_total);
      pushTotal('Refunded', record.summary.refunded_total);
      pushTotal('Credits', record.summary.credit_line_total);
    }
    return totals;
  }, [isOrderLike, record]);

  const orderEditPreviewTotals = useMemo(() => {
    if (!orderPreview) return [];
    const totals = [];
    const pushTotal = (label, amount) => {
      const numeric = toNumber(amount);
      if (numeric === null) return;
      totals.push({ label, amount: numeric });
    };
    pushTotal('Item subtotal', orderPreview.item_subtotal ?? orderPreview.subtotal);
    pushTotal('Discounts', orderPreview.discount_total ?? orderPreview.discount_subtotal);
    pushTotal('Shipping', orderPreview.shipping_total ?? orderPreview.shipping_subtotal);
    pushTotal('Tax', orderPreview.tax_total ?? orderPreview.shipping_tax_total);
    pushTotal('Total', orderPreview.total ?? orderPreview.original_total);
    return totals;
  }, [orderPreview]);

  const orderEditPreviewItems = useMemo(() => {
    if (!orderPreview) return [];
    return Array.isArray(orderPreview.items) ? orderPreview.items : [];
  }, [orderPreview]);

  const orderEditAddedItems = useMemo(
    () =>
      orderEditAddActions.map((action) => {
        const referenceId =
          action?.details?.reference_id || action?.reference_id || action?.reference;
        const item = orderEditPreviewItems.find((entry) => getOrderItemId(entry) === referenceId);
        return { action, item, referenceId };
      }),
    [orderEditAddActions, orderEditPreviewItems]
  );

  const orderEditShippingMethods = useMemo(() => {
    const methods = Array.isArray(orderPreview?.shipping_methods)
      ? orderPreview.shipping_methods
      : [];
    return orderEditShippingActions.map((action) => {
      const referenceId =
        action?.reference_id || action?.details?.reference_id || action?.reference;
      const method = methods.find((entry) => entry?.id === referenceId);
      return { action, method, referenceId };
    });
  }, [orderEditShippingActions, orderPreview?.shipping_methods]);

  const shippingMethodRows = useMemo(() => {
    if (!isOrderLike || !record) return [];
    const methods = Array.isArray(record.shipping_methods) ? record.shipping_methods : [];
    return methods.map((method, index) => ({
      id: method?.id || `${record.id || 'order'}-ship-${index}`,
      name: method?.name || method?.shipping_option?.name || 'Shipping',
      amount: method?.amount,
      is_tax_inclusive: method?.is_tax_inclusive,
      option: method?.shipping_option?.name || method?.shipping_option_id || '-',
      currency_code: method?.currency_code || record.currency_code || orderCurrency,
      created_at: method?.created_at
    }));
  }, [isOrderLike, record, orderCurrency]);

  const shippingMethodColumns = useMemo(
    () => [
      { key: 'name', label: 'Method' },
      {
        key: 'amount',
        label: 'Amount',
        format: (value, row) => formatMoneyOrDash(value, row?.currency_code || orderCurrency)
      },
      {
        key: 'is_tax_inclusive',
        label: 'Tax',
        format: (value) => (value ? 'Inclusive' : 'Exclusive')
      },
      { key: 'option', label: 'Option' },
      { key: 'created_at', label: 'Created', format: formatDateTime }
    ],
    [orderCurrency]
  );

  const fulfillmentRows = useMemo(() => {
    if (!isOrderLike || !record) return [];
    const fulfillments = Array.isArray(record.fulfillments) ? record.fulfillments : [];
    return fulfillments.map((fulfillment, index) => ({
      id: fulfillment?.id || `${record.id || 'order'}-fulfillment-${index}`,
      status: getFulfillmentStatus(fulfillment),
      provider: fulfillment?.provider_id || fulfillment?.provider?.id || '-',
      shipped_at: fulfillment?.shipped_at,
      delivered_at: fulfillment?.delivered_at,
      created_at: fulfillment?.created_at
    }));
  }, [isOrderLike, record]);

  const fulfillmentColumns = useMemo(
    () => [
      { key: 'status', label: 'Status', badge: true },
      { key: 'provider', label: 'Provider' },
      { key: 'shipped_at', label: 'Shipped', format: formatDateTime },
      { key: 'delivered_at', label: 'Delivered', format: formatDateTime },
      { key: 'created_at', label: 'Created', format: formatDateTime }
    ],
    []
  );

  const paymentCollectionRows = useMemo(() => {
    if (!isOrderLike || !record) return [];
    const collections = Array.isArray(record.payment_collections) ? record.payment_collections : [];
    return collections.map((collection, index) => ({
      id: collection?.id || `${record.id || 'order'}-payment-${index}`,
      status: collection?.status,
      amount: collection?.amount,
      authorized_amount: collection?.authorized_amount,
      captured_amount: collection?.captured_amount,
      refunded_amount: collection?.refunded_amount,
      provider: getPaymentProviderLabel(collection),
      currency_code: collection?.currency_code || record.currency_code || orderCurrency
    }));
  }, [isOrderLike, record, orderCurrency]);

  const paymentCollectionColumns = useMemo(
    () => [
      { key: 'status', label: 'Status', badge: true },
      {
        key: 'amount',
        label: 'Amount',
        format: (value, row) => formatMoneyOrDash(value, row?.currency_code || orderCurrency)
      },
      {
        key: 'authorized_amount',
        label: 'Authorized',
        format: (value, row) => formatMoneyOrDash(value, row?.currency_code || orderCurrency)
      },
      {
        key: 'captured_amount',
        label: 'Captured',
        format: (value, row) => formatMoneyOrDash(value, row?.currency_code || orderCurrency)
      },
      {
        key: 'refunded_amount',
        label: 'Refunded',
        format: (value, row) => formatMoneyOrDash(value, row?.currency_code || orderCurrency)
      },
      { key: 'provider', label: 'Provider' }
    ],
    [orderCurrency]
  );

  const transactionRows = useMemo(() => {
    if (!isOrderLike || !record) return [];
    const transactions = Array.isArray(record.transactions) ? record.transactions : [];
    return transactions.map((transaction, index) => ({
      id: transaction?.id || `${record.id || 'order'}-txn-${index}`,
      reference: transaction?.reference || transaction?.reference_id || '-',
      amount: transaction?.amount,
      currency_code: transaction?.currency_code || record.currency_code || orderCurrency,
      created_at: transaction?.created_at
    }));
  }, [isOrderLike, record, orderCurrency]);

  const transactionColumns = useMemo(
    () => [
      { key: 'reference', label: 'Reference' },
      {
        key: 'amount',
        label: 'Amount',
        format: (value, row) => formatMoneyOrDash(value, row?.currency_code || orderCurrency)
      },
      { key: 'created_at', label: 'Created', format: formatDateTime }
    ],
    [orderCurrency]
  );

  const creditLineRows = useMemo(() => {
    if (!isOrder || !record) return [];
    const lines = Array.isArray(record.credit_lines) ? record.credit_lines : [];
    return lines.map((line, index) => ({
      id: line?.id || `${record.id || 'order'}-credit-${index}`,
      reference: line?.reference || line?.reference_id || '-',
      reference_id: line?.reference_id || '-',
      amount: line?.amount,
      currency_code: line?.currency_code || record.currency_code || orderCurrency,
      created_at: line?.created_at
    }));
  }, [isOrderLike, record, orderCurrency]);

  const creditLineColumns = useMemo(
    () => [
      { key: 'reference', label: 'Reference' },
      { key: 'reference_id', label: 'Reference ID' },
      {
        key: 'amount',
        label: 'Amount',
        format: (value, row) => formatMoneyOrDash(value, row?.currency_code || orderCurrency)
      },
      { key: 'created_at', label: 'Created', format: formatDateTime }
    ],
    [orderCurrency]
  );

  const variantRows = useMemo(() => {
    if (!isProduct || !record?.variants) return [];
    return record.variants.map((variant) => ({
      id: variant.id,
      title: variant.title || variant.sku || 'Variant',
      sku: variant.sku || '-',
      options: formatVariantOptions(variant),
      inventory_status: formatBooleanLabel(variant.manage_inventory, 'Managed', 'Not managed'),
      backorder_status: formatBooleanLabel(variant.allow_backorder, 'Allowed', 'Not allowed'),
      inventory_quantity:
        inventoryCounts[variant.id] ??
        getVariantInventoryQuantity(variant),
      thumbnail: getVariantThumbnail(variant, productThumbnail),
      prices: variant.prices || []
    }));
  }, [isProduct, record, productThumbnail, inventoryCounts]);

  const priceRows = useMemo(() => {
    if (!isProduct || !record?.variants) return [];
    const rows = [];
    record.variants.forEach((variant) => {
      (variant.prices || []).forEach((price, index) => {
        rows.push({
          id: price.id || `${variant.id}-${index}`,
          variant: variant.title || variant.sku || 'Variant',
          currency_code: price.currency_code,
          amount: price.amount,
          min_quantity: price.min_quantity,
          max_quantity: price.max_quantity,
          rules: price.rules
        });
      });
    });
    return rows;
  }, [isProduct, record]);

  const inventoryRows = useMemo(() => {
    if (!isProduct || !record?.variants) return [];
    return record.variants.map((variant) => ({
      id: variant.id,
      variant: variant.title || variant.sku || 'Variant',
      sku: variant.sku || '-',
      inventory_quantity:
        inventoryCounts[variant.id] ??
        getVariantInventoryQuantity(variant),
      manage_inventory: variant.manage_inventory,
      allow_backorder: variant.allow_backorder
    }));
  }, [isProduct, record, inventoryCounts]);

  const hasInventoryCounts = useMemo(
    () => inventoryRows.some((row) => typeof row.inventory_quantity === 'number'),
    [inventoryRows]
  );

  const inventoryCoverage = useMemo(() => {
    const total = inventoryRows.length;
    const counted = inventoryRows.filter((row) => typeof row.inventory_quantity === 'number').length;
    return { total, counted };
  }, [inventoryRows]);

  const imageUrls = useMemo(() => {
    if (!record) return [];
    const urls = [];
    const addUrl = (value) => {
      if (value && !urls.includes(value)) {
        urls.push(value);
      }
    };
    addUrl(record.thumbnail);
    addUrl(record.image);
    addUrl(record.cover_image);
    if (Array.isArray(record.images)) {
      record.images.forEach((image) => {
        if (typeof image === 'string') {
          addUrl(image);
        } else {
          addUrl(image?.url);
        }
      });
    }
    if (record.product) {
      addUrl(record.product.thumbnail);
      addUrl(record.product.image);
      addUrl(record.product.cover_image);
      if (Array.isArray(record.product.images)) {
        record.product.images.forEach((image) => {
          if (typeof image === 'string') {
            addUrl(image);
          } else {
            addUrl(image?.url);
          }
        });
      }
    }
    if (record.metadata) {
      addUrl(record.metadata.thumbnail);
      addUrl(record.metadata.image);
      if (Array.isArray(record.metadata.images)) {
        record.metadata.images.forEach((image) => {
          if (typeof image === 'string') {
            addUrl(image);
          } else {
            addUrl(image?.url);
          }
        });
      }
    }
    return urls;
  }, [record]);

  const variantColumns = useMemo(
    () => [
      { key: 'thumbnail', label: 'Image', type: 'thumbnail' },
      { key: 'title', label: 'Variant' },
      { key: 'sku', label: 'SKU' },
      { key: 'options', label: 'Options' },
      { key: 'inventory_status', label: 'Inventory' },
      { key: 'backorder_status', label: 'Backorder' }
    ],
    []
  );

  const pricingColumns = useMemo(
    () => [
      { key: 'variant', label: 'Variant' },
      {
        key: 'currency_code',
        label: 'Currency',
        format: (value) => (value ? String(value).toUpperCase() : '-')
      },
      { key: 'amount', label: 'Amount', format: (value, row) => formatMoney(value, row?.currency_code) },
      { key: 'min_quantity', label: 'Min Qty', format: (value) => (value ?? '-') },
      { key: 'max_quantity', label: 'Max Qty', format: (value) => (value ?? '-') },
      { key: 'rules', label: 'Rules', format: formatRuleSet }
    ],
    []
  );

  const inventoryColumns = useMemo(
    () => [
      { key: 'variant', label: 'Variant' },
      { key: 'sku', label: 'SKU' },
      {
        key: 'inventory_quantity',
        label: 'On hand',
        format: (value) => (typeof value === 'number' ? value : 'Not available')
      },
      {
        key: 'manage_inventory',
        label: 'Tracking',
        format: (value) => formatBooleanLabel(value, 'Managed', 'Not managed')
      },
      {
        key: 'allow_backorder',
        label: 'Backorder',
        format: (value) => formatBooleanLabel(value, 'Allowed', 'Not allowed')
      }
    ],
    []
  );

  const inventoryLocationMap = useMemo(() => {
    const map = new Map();
    (inventoryMeta.locations || []).forEach((location) => {
      if (location?.id) map.set(location.id, location);
    });
    return map;
  }, [inventoryMeta.locations]);

  const inventoryLevelRows = useMemo(() => {
    if (!isInventoryItem) return [];
    const levels = Array.isArray(record?.location_levels) ? record.location_levels : [];
    const rows = levels.map((level) => {
      const location = inventoryLocationMap.get(level?.location_id);
      return {
        id: level?.id || `${level?.location_id || 'loc'}-${record?.id || 'item'}`,
        location_id: level?.location_id || '',
        location_name: location?.name || level?.location_id || 'Unknown',
        stocked_quantity: toNumber(level?.stocked_quantity),
        reserved_quantity: toNumber(level?.reserved_quantity),
        incoming_quantity: toNumber(level?.incoming_quantity),
        available_quantity: toNumber(level?.available_quantity),
        created_at: level?.created_at,
        updated_at: level?.updated_at
      };
    });
    return rows.sort((a, b) =>
      String(a.location_name || '').localeCompare(String(b.location_name || ''), undefined, {
        sensitivity: 'base'
      })
    );
  }, [inventoryLocationMap, isInventoryItem, record]);

  const inventoryActivity = useMemo(() => {
    if (!isInventoryItem) return [];
    const events = [];
    inventoryLevelRows.forEach((level) => {
      const timestamp = level.updated_at || level.created_at;
      if (!timestamp) return;
      events.push({
        id: `level-${level.id}`,
        type: 'Level update',
        timestamp,
        location: level.location_name,
        detail: `Stocked ${level.stocked_quantity ?? 0}, Reserved ${level.reserved_quantity ?? 0}, Incoming ${level.incoming_quantity ?? 0}`
      });
    });
    (inventoryReservations || []).forEach((reservation) => {
      const timestamp = reservation?.created_at || reservation?.updated_at;
      if (!timestamp) return;
      const locationName =
        inventoryLocationMap.get(reservation?.location_id)?.name || reservation?.location_id || 'Unknown';
      events.push({
        id: `reservation-${reservation.id}`,
        type: 'Reservation',
        timestamp,
        location: locationName,
        detail: `${reservation.quantity || 0} reserved${reservation.line_item_id ? ` · ${reservation.line_item_id}` : ''}`
      });
    });
    return events.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [inventoryLevelRows, inventoryReservations, inventoryLocationMap, isInventoryItem]);

  const stockLocationInventoryRows = useMemo(() => {
    if (!isStockLocation || !record?.id) return [];
    const items = stockLocationInventoryState.items || [];
    return items.map((item) => {
      const level = getInventoryLevelForLocation(item, record.id);
      const stocked = toNumber(level?.stocked_quantity) ?? 0;
      const reserved = toNumber(level?.reserved_quantity) ?? 0;
      const incoming = toNumber(level?.incoming_quantity) ?? 0;
      const available =
        toNumber(level?.available_quantity) ?? Math.max(0, stocked - reserved);
      return {
        id: item.id,
        title: item.title || item.sku || item.id,
        sku: item.sku || '-',
        stocked,
        reserved,
        incoming,
        available,
        updated_at: item.updated_at || level?.updated_at
      };
    });
  }, [isStockLocation, record?.id, stockLocationInventoryState.items]);

  const stockLocationInventoryColumns = useMemo(
    () => [
      {
        key: 'title',
        label: 'Inventory Item',
        format: (_, row) => (
          <Link className="text-ldc-plum underline" to={`/inventory/${row.id}`}>
            {row.title}
          </Link>
        )
      },
      { key: 'sku', label: 'SKU' },
      { key: 'stocked', label: 'Stocked' },
      { key: 'reserved', label: 'Reserved' },
      { key: 'incoming', label: 'Incoming' },
      { key: 'available', label: 'Available' },
      { key: 'updated_at', label: 'Updated', format: formatDateTime }
    ],
    []
  );

  const variantEditorTitle = isVariant ? 'Variant Details' : 'Variant Manager';
  const variantEditorSubtitle = isVariant
    ? 'Edit this variant details, options, and pricing.'
    : 'Create and update product variants, options, and pricing.';

  const renderExchangeCard = (exchange) => {
    if (!exchange?.id) return null;
    const exchangeReturnId = resolveExchangeReturnId(exchange.id, exchangeRecords);
    const inboundDraft = exchangeInboundDrafts[exchange.id] || {
      location_id: '',
      items: buildReturnRequestMap(exchangeItemSource)
    };
    const outboundDraft = exchangeOutboundDrafts[exchange.id] || {
      items: [],
      newItem: { variant_id: '', quantity: 1, unit_price: '', allow_backorder: false }
    };
    const shippingDraft = exchangeShippingDrafts[exchange.id] || {
      outbound_option_id: '',
      outbound_custom_amount: '',
      inbound_option_id: '',
      inbound_custom_amount: '',
      inbound_tracking_number: '',
      inbound_tracking_url: '',
      inbound_label_url: ''
    };
    const outboundShipping = getExchangeShippingMethod(orderPreview, exchange.id, 'outbound');
    const outboundShippingActionId = getExchangeShippingActionId(
      outboundShipping,
      exchange.id,
      'outbound'
    );
    const inboundShipping = getExchangeShippingMethod(
      orderPreview,
      exchange.id,
      'inbound',
      exchangeReturnId
    );
    const inboundShippingActionId = getExchangeShippingActionId(
      inboundShipping,
      exchange.id,
      'inbound',
      exchangeReturnId
    );
    const inboundTrackingNumber = getShippingMetaValue(inboundShipping, 'tracking_number');
    const inboundTrackingUrl = getShippingMetaValue(inboundShipping, 'tracking_url');
    const inboundLabelUrl = getShippingMetaValue(inboundShipping, 'label_url');
    const canManageInboundShipping = Boolean(exchangeReturnId);
    const isBusy = exchangeState.savingId === exchange.id;
    return (
      <div key={exchange.id} className="rounded-2xl bg-white/70 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-ldc-ink">Exchange {exchange.id}</div>
            <div className="mt-1 text-xs text-ldc-ink/60">
              Created {formatDateTime(exchange.created_at)}
            </div>
          </div>
          <StatusBadge
            value={exchange.status || (exchange.canceled_at ? 'canceled' : 'requested')}
          />
        </div>

        <div className="mt-4">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
            Inbound return items
          </div>
          <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
            Stock location
            <select
              className="ldc-input mt-2"
              value={inboundDraft.location_id}
              onChange={handleExchangeInboundLocation(exchange.id)}
            >
              <option value="">Default location</option>
              {fulfillmentMeta.locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name || location.id}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-3 space-y-3">
            {exchangeItemSource.length ? (
              exchangeItemSource.map((item) => {
                const itemId = getOrderItemId(item);
                if (!itemId) return null;
                const entry = inboundDraft.items?.[itemId] || {
                  quantity: 0,
                  reason_id: ''
                };
                return (
                  <div key={itemId} className="rounded-2xl bg-white/80 p-3">
                    <div className="text-sm font-semibold text-ldc-ink">
                      {getLineItemTitle(item)}
                    </div>
                    <div className="mt-2 grid gap-3 md:grid-cols-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                        Quantity
                        <input
                          className="ldc-input mt-2"
                          type="number"
                          min="0"
                          max={item?.quantity ?? undefined}
                          value={entry.quantity ?? ''}
                          onChange={handleExchangeInboundChange(exchange.id, itemId, 'quantity')}
                        />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                        Reason
                        <select
                          className="ldc-input mt-2"
                          value={entry.reason_id || ''}
                          onChange={handleExchangeInboundChange(exchange.id, itemId, 'reason_id')}
                        >
                          <option value="">Select reason</option>
                          {returnReasons.map((reason) => (
                            <option key={reason.id} value={reason.id}>
                              {reason.label || reason.value || reason.id}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="text-sm text-ldc-ink/60">No items available.</p>
            )}
          </div>
          <button
            className="ldc-button-primary mt-3"
            type="button"
            onClick={() => handleAddExchangeInboundItems(exchange.id)}
            disabled={isBusy}
          >
            {isBusy ? 'Saving...' : 'Add inbound items'}
          </button>
        </div>

        <div className="mt-6">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
            Inbound shipping
          </div>
          <p className="mt-2 text-sm text-ldc-ink/60">
            Choose the return shipping option for inbound items.
          </p>
          {orderPreviewLoading ? (
            <div className="mt-2 text-sm text-ldc-ink/60">Loading order preview...</div>
          ) : null}
          {orderPreviewError ? (
            <div className="mt-2 text-sm text-rose-600">{orderPreviewError}</div>
          ) : null}
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Return shipping option
              <select
                className="ldc-input mt-2"
                value={shippingDraft.inbound_option_id}
                onChange={handleExchangeShippingDraftChange(exchange.id, 'inbound_option_id')}
                disabled={
                  !inboundShippingOptions.length || isBusy || !canManageInboundShipping
                }
              >
                <option value="">Select option</option>
                {inboundShippingOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name || option.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Custom amount (optional)
              <input
                className="ldc-input mt-2"
                type="number"
                min="0"
                step="0.01"
                value={shippingDraft.inbound_custom_amount}
                onChange={handleExchangeShippingDraftChange(exchange.id, 'inbound_custom_amount')}
                disabled={isBusy || !canManageInboundShipping}
              />
            </label>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Tracking number (optional)
              <input
                className="ldc-input mt-2"
                value={shippingDraft.inbound_tracking_number}
                onChange={handleExchangeShippingDraftChange(exchange.id, 'inbound_tracking_number')}
                disabled={isBusy || !canManageInboundShipping}
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Tracking URL (optional)
              <input
                className="ldc-input mt-2"
                value={shippingDraft.inbound_tracking_url}
                onChange={handleExchangeShippingDraftChange(exchange.id, 'inbound_tracking_url')}
                disabled={isBusy || !canManageInboundShipping}
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Label URL (optional)
              <input
                className="ldc-input mt-2"
                value={shippingDraft.inbound_label_url}
                onChange={handleExchangeShippingDraftChange(exchange.id, 'inbound_label_url')}
                disabled={isBusy || !canManageInboundShipping}
              />
            </label>
          </div>
          <div className="mt-3">
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Upload label file (optional)
              <input
                className="ldc-input mt-2"
                type="file"
                accept="application/pdf,image/*"
                onChange={(event) => handleInboundLabelUpload(exchange.id, event)}
                disabled={isBusy || !canManageInboundShipping}
              />
            </label>
            {exchangeLabelUploadState.targetId === exchange.id ? (
              <>
                {exchangeLabelUploadState.uploadingId === exchange.id ? (
                  <div className="mt-2 text-sm text-ldc-ink/60">Uploading label...</div>
                ) : null}
                {exchangeLabelUploadState.error ? (
                  <div className="mt-2 text-sm text-rose-600">
                    {exchangeLabelUploadState.error}
                  </div>
                ) : null}
                {exchangeLabelUploadState.success ? (
                  <div className="mt-2 text-sm text-emerald-700">
                    {exchangeLabelUploadState.success}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
          {!canManageInboundShipping ? (
            <p className="mt-2 text-sm text-ldc-ink/60">
              Add inbound items first to enable return shipping.
            </p>
          ) : null}
          {!inboundShippingOptions.length ? (
            <p className="mt-2 text-sm text-ldc-ink/60">
              No inbound shipping options available for this order.
            </p>
          ) : null}
          <p className="mt-2 text-xs text-ldc-ink/60">
            Current:{' '}
            {inboundShipping
              ? `${inboundShipping.name || inboundShipping.shipping_option_id || 'Inbound shipping'} · ${formatMoneyOrDash(
                  inboundShipping.amount ?? inboundShipping.total,
                  orderCurrency
                )}`
              : 'No inbound shipping set.'}
          </p>
          {inboundTrackingNumber || inboundTrackingUrl || inboundLabelUrl ? (
            <div className="mt-2 space-y-1 text-xs text-ldc-ink/60">
              {inboundTrackingNumber ? <div>Tracking # {inboundTrackingNumber}</div> : null}
              {inboundTrackingUrl ? (
                <div>Tracking URL: {renderExternalLink(inboundTrackingUrl)}</div>
              ) : null}
              {inboundLabelUrl ? (
                <div>Label URL: {renderExternalLink(inboundLabelUrl)}</div>
              ) : null}
            </div>
          ) : (
            <div className="mt-2 text-xs text-ldc-ink/60">No tracking info set.</div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              className="ldc-button-primary"
              type="button"
              onClick={() => handleSaveExchangeInboundShipping(exchange.id)}
              disabled={
                isBusy ||
                !canManageInboundShipping ||
                (!shippingDraft.inbound_option_id && !inboundShippingActionId)
              }
            >
              {isBusy ? 'Saving...' : 'Save inbound shipping'}
            </button>
            <button
              className="ldc-button-secondary"
              type="button"
              onClick={() => handleClearExchangeInboundShipping(exchange.id)}
              disabled={isBusy || !inboundShippingActionId}
            >
              Clear inbound shipping
            </button>
          </div>
        </div>

        <div className="mt-6">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
            Outbound items
          </div>
          {outboundDraft.items.length ? (
            <div className="mt-3 space-y-2">
              {outboundDraft.items.map((item, index) => (
                <div key={`${item.variant_id}-${index}`} className="rounded-2xl bg-white/80 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-ldc-ink">
                      Variant {item.variant_id}
                    </div>
                    <button
                      className="ldc-button-secondary"
                      type="button"
                      onClick={() => handleRemoveExchangeOutboundItem(exchange.id, index)}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="mt-2 text-xs text-ldc-ink/60">
                    Qty: {item.quantity} {item.unit_price ? `· Price: ${item.unit_price}` : ''}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-ldc-ink/60">No outbound items added.</p>
          )}

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Variant ID
              <input
                className="ldc-input mt-2"
                value={outboundDraft.newItem?.variant_id || ''}
                onChange={handleExchangeOutboundField(exchange.id, 'variant_id')}
                placeholder="variant_..."
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Quantity
              <input
                className="ldc-input mt-2"
                type="number"
                min="1"
                value={outboundDraft.newItem?.quantity || 1}
                onChange={handleExchangeOutboundField(exchange.id, 'quantity')}
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Unit price (optional)
              <input
                className="ldc-input mt-2"
                value={outboundDraft.newItem?.unit_price || ''}
                onChange={handleExchangeOutboundField(exchange.id, 'unit_price')}
              />
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              <input
                type="checkbox"
                className="h-4 w-4 accent-ldc-plum"
                checked={Boolean(outboundDraft.newItem?.allow_backorder)}
                onChange={handleExchangeOutboundToggle(exchange.id)}
              />
              Allow backorder
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              className="ldc-button-secondary"
              type="button"
              onClick={() => handleAddExchangeOutboundItem(exchange.id)}
              disabled={isBusy}
            >
              Add outbound item
            </button>
            <button
              className="ldc-button-primary"
              type="button"
              onClick={() => handleSubmitExchangeOutboundItems(exchange.id)}
              disabled={isBusy || !outboundDraft.items.length}
            >
              {isBusy ? 'Saving...' : 'Save outbound items'}
            </button>
          </div>
        </div>

        <div className="mt-6">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
            Outbound shipping
          </div>
          <p className="mt-2 text-sm text-ldc-ink/60">
            Select shipping for the replacement items.
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Shipping option
              <select
                className="ldc-input mt-2"
                value={shippingDraft.outbound_option_id}
                onChange={handleExchangeShippingDraftChange(exchange.id, 'outbound_option_id')}
                disabled={!outboundShippingOptions.length || isBusy}
              >
                <option value="">Select option</option>
                {outboundShippingOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name || option.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Custom amount (optional)
              <input
                className="ldc-input mt-2"
                type="number"
                min="0"
                step="0.01"
                value={shippingDraft.outbound_custom_amount}
                onChange={handleExchangeShippingDraftChange(exchange.id, 'outbound_custom_amount')}
                disabled={isBusy}
              />
            </label>
          </div>
          {!outboundShippingOptions.length ? (
            <p className="mt-2 text-sm text-ldc-ink/60">
              No outbound shipping options available for this order.
            </p>
          ) : null}
          <p className="mt-2 text-xs text-ldc-ink/60">
            Current:{' '}
            {outboundShipping
              ? `${outboundShipping.name || outboundShipping.shipping_option_id || 'Outbound shipping'} · ${formatMoneyOrDash(
                  outboundShipping.amount ?? outboundShipping.total,
                  orderCurrency
                )}`
              : 'No outbound shipping set.'}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              className="ldc-button-primary"
              type="button"
              onClick={() => handleSaveExchangeOutboundShipping(exchange.id)}
              disabled={isBusy || !shippingDraft.outbound_option_id}
            >
              {isBusy ? 'Saving...' : 'Save outbound shipping'}
            </button>
            <button
              className="ldc-button-secondary"
              type="button"
              onClick={() => handleClearExchangeOutboundShipping(exchange.id)}
              disabled={isBusy || !outboundShippingActionId}
            >
              Clear outbound shipping
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            className="ldc-button-secondary"
            type="button"
            onClick={() => handleConfirmExchangeRequest(exchange.id)}
            disabled={isBusy}
          >
            Confirm exchange request
          </button>
          <button
            className="ldc-button-secondary"
            type="button"
            onClick={() => handleCancelExchange(exchange.id)}
            disabled={isBusy}
          >
            Cancel exchange
          </button>
        </div>
      </div>
    );
  };

  const renderExchangeWorkflow = (showCreate) => (
    <div className="ldc-card p-6">
      <h3 className="font-heading text-xl text-ldc-ink">Exchanges</h3>
      <p className="mt-2 text-sm text-ldc-ink/70">
        {showCreate
          ? 'Create exchanges, attach return items, and add outbound variants.'
          : 'Manage inbound returns, outbound items, and shipping for this exchange.'}
      </p>
      {orderExchangesError ? (
        <div className="mt-3 text-sm text-rose-600">{orderExchangesError}</div>
      ) : null}
      {exchangeState.error ? (
        <div className="mt-3 text-sm text-rose-600">{exchangeState.error}</div>
      ) : null}
      {exchangeState.success ? (
        <div className="mt-3 text-sm text-emerald-700">{exchangeState.success}</div>
      ) : null}

      {showCreate ? (
        <form className="mt-4 space-y-4" onSubmit={handleCreateExchange}>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
            Create exchange
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Description
              <input
                className="ldc-input mt-2"
                value={exchangeDraft.description}
                onChange={handleExchangeDraftChange('description')}
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Internal note
              <input
                className="ldc-input mt-2"
                value={exchangeDraft.internal_note}
                onChange={handleExchangeDraftChange('internal_note')}
              />
            </label>
          </div>
          <button
            className="ldc-button-primary"
            type="submit"
            disabled={exchangeState.savingId === 'new'}
          >
            {exchangeState.savingId === 'new' ? 'Creating...' : 'Create exchange'}
          </button>
        </form>
      ) : null}

      <div className={showCreate ? 'mt-8 space-y-4' : 'mt-4 space-y-4'}>
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
          {showCreate ? 'Existing exchanges' : 'Exchange workflow'}
        </div>
        {orderExchangesLoading ? (
          <div className="text-sm text-ldc-ink/60">Loading exchanges...</div>
        ) : null}
        {exchangeRecords.length ? (
          exchangeRecords.map((exchange) => renderExchangeCard(exchange))
        ) : (
          <p className="text-sm text-ldc-ink/60">No exchanges yet.</p>
        )}
      </div>
    </div>
  );

  return (
    <div>
      <PageHeader
        eyebrow={resource.label}
        title={primaryTitle || `${resource.label} Details`}
        subtitle="Detailed view from LDC Admin API."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {isStockLocation && record?.id ? (
              <Link
                className="ldc-button-secondary"
                to={`/inventory?inventory_location_id=${record.id}`}
              >
                View inventory
              </Link>
            ) : null}
            <Link className="ldc-button-secondary" to={resource.path}>
              Back to {resource.label}
            </Link>
          </div>
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

          {isOrderLike ? (
            <>
              <div className="ldc-card p-6">
                <h3 className="font-heading text-xl text-ldc-ink">Customer & Addresses</h3>
                <p className="mt-2 text-sm text-ldc-ink/70">
                  Contact details plus shipping and billing information.
                </p>
                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  <div className="rounded-2xl bg-white/70 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                      Customer
                    </div>
                    {customerDetails.length ? (
                      <div className="mt-3 space-y-3 text-sm text-ldc-ink">
                        {customerDetails.map((detail) => (
                          <div key={detail.label}>
                            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                              {detail.label}
                            </div>
                            <div className="mt-1">{detail.value}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-ldc-ink/60">
                        No customer details available.
                      </p>
                    )}
                  </div>
                  <div className="rounded-2xl bg-white/70 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                      Shipping address
                    </div>
                    {shippingAddressLines.length ? (
                      <div className="mt-3 space-y-1 text-sm text-ldc-ink">
                        {shippingAddressLines.map((line, index) => (
                          <div key={`ship-${index}`}>{line}</div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-ldc-ink/60">
                        No shipping address on file.
                      </p>
                    )}
                  </div>
                  <div className="rounded-2xl bg-white/70 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                      Billing address
                    </div>
                    {billingAddressLines.length ? (
                      <div className="mt-3 space-y-1 text-sm text-ldc-ink">
                        {billingAddressLines.map((line, index) => (
                          <div key={`bill-${index}`}>{line}</div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-ldc-ink/60">
                        No billing address on file.
                      </p>
                    )}
                  </div>
                </div>

                {orderDetailDraft ? (
                  <div className="mt-6 border-t border-white/70 pt-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                          Edit details
                        </div>
                        <p className="mt-2 text-sm text-ldc-ink/60">
                          Update email, locale, addresses, and metadata for this{' '}
                          {isDraftOrder ? 'draft order' : 'order'}.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          className="ldc-button-secondary"
                          type="button"
                          onClick={handleResetOrderDetails}
                          disabled={orderDetailState.saving}
                        >
                          Reset
                        </button>
                        <button
                          className="ldc-button-primary"
                          type="button"
                          onClick={handleSaveOrderDetails}
                          disabled={orderDetailState.saving}
                        >
                          {orderDetailState.saving ? 'Saving...' : 'Save details'}
                        </button>
                      </div>
                    </div>

                    {orderDetailState.error ? (
                      <div className="mt-3 text-sm text-rose-600">{orderDetailState.error}</div>
                    ) : null}
                    {orderDetailState.success ? (
                      <div className="mt-3 text-sm text-emerald-700">
                        {orderDetailState.success}
                      </div>
                    ) : null}

                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                        Email
                        <input
                          className="ldc-input mt-2"
                          value={orderDetailDraft.email}
                          onChange={handleOrderDetailField('email')}
                        />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                        Locale
                        <input
                          className="ldc-input mt-2"
                          value={orderDetailDraft.locale}
                          onChange={handleOrderDetailField('locale')}
                          placeholder="en-US"
                        />
                      </label>
                    </div>

                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                      <div className="rounded-2xl bg-white/70 p-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                          Shipping address
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            First name
                            <input
                              className="ldc-input mt-2"
                              value={orderDetailDraft.shipping_address.first_name}
                              onChange={handleOrderAddressField('shipping_address', 'first_name')}
                            />
                          </label>
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Last name
                            <input
                              className="ldc-input mt-2"
                              value={orderDetailDraft.shipping_address.last_name}
                              onChange={handleOrderAddressField('shipping_address', 'last_name')}
                            />
                          </label>
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Company
                            <input
                              className="ldc-input mt-2"
                              value={orderDetailDraft.shipping_address.company}
                              onChange={handleOrderAddressField('shipping_address', 'company')}
                            />
                          </label>
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Phone
                            <input
                              className="ldc-input mt-2"
                              value={orderDetailDraft.shipping_address.phone}
                              onChange={handleOrderAddressField('shipping_address', 'phone')}
                            />
                          </label>
                          <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Address line 1
                            <input
                              className="ldc-input mt-2"
                              value={orderDetailDraft.shipping_address.address_1}
                              onChange={handleOrderAddressField('shipping_address', 'address_1')}
                            />
                          </label>
                          <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Address line 2
                            <input
                              className="ldc-input mt-2"
                              value={orderDetailDraft.shipping_address.address_2}
                              onChange={handleOrderAddressField('shipping_address', 'address_2')}
                            />
                          </label>
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            City
                            <input
                              className="ldc-input mt-2"
                              value={orderDetailDraft.shipping_address.city}
                              onChange={handleOrderAddressField('shipping_address', 'city')}
                            />
                          </label>
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            State / Province
                            <input
                              className="ldc-input mt-2"
                              value={orderDetailDraft.shipping_address.province}
                              onChange={handleOrderAddressField('shipping_address', 'province')}
                            />
                          </label>
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Postal code
                            <input
                              className="ldc-input mt-2"
                              value={orderDetailDraft.shipping_address.postal_code}
                              onChange={handleOrderAddressField('shipping_address', 'postal_code')}
                            />
                          </label>
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Country code
                            <input
                              className="ldc-input mt-2"
                              value={orderDetailDraft.shipping_address.country_code}
                              onChange={handleOrderAddressField('shipping_address', 'country_code')}
                              placeholder="us"
                            />
                          </label>
                        </div>
                      </div>

                      <div className="rounded-2xl bg-white/70 p-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                          Billing address
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            First name
                            <input
                              className="ldc-input mt-2"
                              value={orderDetailDraft.billing_address.first_name}
                              onChange={handleOrderAddressField('billing_address', 'first_name')}
                            />
                          </label>
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Last name
                            <input
                              className="ldc-input mt-2"
                              value={orderDetailDraft.billing_address.last_name}
                              onChange={handleOrderAddressField('billing_address', 'last_name')}
                            />
                          </label>
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Company
                            <input
                              className="ldc-input mt-2"
                              value={orderDetailDraft.billing_address.company}
                              onChange={handleOrderAddressField('billing_address', 'company')}
                            />
                          </label>
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Phone
                            <input
                              className="ldc-input mt-2"
                              value={orderDetailDraft.billing_address.phone}
                              onChange={handleOrderAddressField('billing_address', 'phone')}
                            />
                          </label>
                          <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Address line 1
                            <input
                              className="ldc-input mt-2"
                              value={orderDetailDraft.billing_address.address_1}
                              onChange={handleOrderAddressField('billing_address', 'address_1')}
                            />
                          </label>
                          <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Address line 2
                            <input
                              className="ldc-input mt-2"
                              value={orderDetailDraft.billing_address.address_2}
                              onChange={handleOrderAddressField('billing_address', 'address_2')}
                            />
                          </label>
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            City
                            <input
                              className="ldc-input mt-2"
                              value={orderDetailDraft.billing_address.city}
                              onChange={handleOrderAddressField('billing_address', 'city')}
                            />
                          </label>
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            State / Province
                            <input
                              className="ldc-input mt-2"
                              value={orderDetailDraft.billing_address.province}
                              onChange={handleOrderAddressField('billing_address', 'province')}
                            />
                          </label>
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Postal code
                            <input
                              className="ldc-input mt-2"
                              value={orderDetailDraft.billing_address.postal_code}
                              onChange={handleOrderAddressField('billing_address', 'postal_code')}
                            />
                          </label>
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Country code
                            <input
                              className="ldc-input mt-2"
                              value={orderDetailDraft.billing_address.country_code}
                              onChange={handleOrderAddressField('billing_address', 'country_code')}
                              placeholder="us"
                            />
                          </label>
                        </div>
                      </div>
                    </div>

                    <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                      Metadata (JSON)
                      <textarea
                        className="ldc-input mt-2 min-h-[120px] font-mono text-xs"
                        value={orderDetailDraft.metadata}
                        onChange={handleOrderDetailField('metadata')}
                      />
                    </label>
                  </div>
                ) : null}
              </div>

              {isOrder ? (
                <div className="ldc-card p-6">
                  <h3 className="font-heading text-xl text-ldc-ink">Internal Notes</h3>
                  <p className="mt-2 text-sm text-ldc-ink/70">
                    Capture private notes for internal order handling.
                  </p>

                  {orderNotes.length ? (
                    <div className="mt-4 space-y-3">
                      {orderNotes.map((note, index) => (
                        <div
                          key={note.id || `${note.created_at || 'note'}-${index}`}
                          className="rounded-2xl bg-white/70 p-4 text-sm text-ldc-ink"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ldc-ink/60">
                            <span>{note.author ? `By ${note.author}` : 'Admin note'}</span>
                            <span>{note.created_at ? formatDateTime(note.created_at) : '-'}</span>
                          </div>
                          <div className="mt-2 whitespace-pre-line">{note.text}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-ldc-ink/60">No internal notes yet.</p>
                  )}

                  {orderNoteState.error ? (
                    <div className="mt-3 text-sm text-rose-600">{orderNoteState.error}</div>
                  ) : null}
                  {orderNoteState.success ? (
                    <div className="mt-3 text-sm text-emerald-700">{orderNoteState.success}</div>
                  ) : null}

                  <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Add note
                    <textarea
                      className="ldc-input mt-2 min-h-[120px]"
                      value={orderNoteDraft}
                      onChange={handleOrderNoteChange}
                      placeholder="Add a private note about this order."
                    />
                  </label>
                  <div className="mt-3">
                    <button
                      className="ldc-button-primary"
                      type="button"
                      onClick={handleAddOrderNote}
                      disabled={orderNoteState.saving}
                    >
                      {orderNoteState.saving ? 'Saving...' : 'Save note'}
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="ldc-card p-6">
                <h3 className="font-heading text-xl text-ldc-ink">Line Items</h3>
                <p className="mt-2 text-sm text-ldc-ink/70">
                  Products, quantities, and totals for this order.
                </p>
                <div className="mt-4">
                  <DataTable
                    columns={orderItemColumns}
                    rows={orderItemRows}
                    getRowId={(row) => row.id}
                    isLoading={false}
                    emptyText="No line items available."
                  />
                </div>
              </div>

              <div className="grid gap-6 lg:grid-cols-2">
                <div className="ldc-card p-6">
                  <h3 className="font-heading text-xl text-ldc-ink">Order Totals</h3>
                  <p className="mt-2 text-sm text-ldc-ink/70">
                    Charges, discounts, and payments summary.
                  </p>
                  {orderTotals.length ? (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {orderTotals.map((total) => (
                        <div key={total.label} className="rounded-2xl bg-white/70 px-4 py-3">
                          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                            {total.label}
                          </div>
                          <div className="mt-2 text-sm text-ldc-ink">
                            {formatMoneyOrDash(total.amount, orderCurrency)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-ldc-ink/60">Totals unavailable.</p>
                  )}
                </div>
                <div className="ldc-card p-6">
                  <h3 className="font-heading text-xl text-ldc-ink">Payments</h3>
                  <p className="mt-2 text-sm text-ldc-ink/70">
                    Payment collections and transaction history.
                  </p>
                  <div className="mt-4 space-y-4">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                        Payment collections
                      </div>
                      <div className="mt-2">
                        <DataTable
                          columns={paymentCollectionColumns}
                          rows={paymentCollectionRows}
                          getRowId={(row) => row.id}
                          isLoading={false}
                          emptyText="No payment collections yet."
                        />
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                        Transactions
                      </div>
                      <div className="mt-2">
                        <DataTable
                          columns={transactionColumns}
                          rows={transactionRows}
                          getRowId={(row) => row.id}
                          isLoading={false}
                          emptyText="No transactions available."
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {isOrder ? (
                <div className="ldc-card p-6">
                  <h3 className="font-heading text-xl text-ldc-ink">Credit Lines</h3>
                  <p className="mt-2 text-sm text-ldc-ink/70">
                    Apply credits to this order and review existing lines.
                  </p>
                  <div className="mt-4">
                    <DataTable
                      columns={creditLineColumns}
                      rows={creditLineRows}
                      getRowId={(row) => row.id}
                      isLoading={false}
                      emptyText="No credit lines yet."
                    />
                  </div>

                  <div className="mt-6 rounded-2xl bg-white/70 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                      Create credit line
                    </div>
                    <div className="mt-3 grid gap-4 md:grid-cols-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                        Amount (major units)
                        <input
                          className="ldc-input mt-2"
                          type="number"
                          step="0.01"
                          min="0"
                          value={orderCreditDraft.amount}
                          onChange={handleOrderCreditDraftChange('amount')}
                        />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                        Reference
                        <input
                          className="ldc-input mt-2"
                          value={orderCreditDraft.reference}
                          onChange={handleOrderCreditDraftChange('reference')}
                        />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                        Reference ID
                        <input
                          className="ldc-input mt-2"
                          value={orderCreditDraft.reference_id}
                          onChange={handleOrderCreditDraftChange('reference_id')}
                        />
                      </label>
                      <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-ldc-plum"
                          checked={orderCreditDraft.is_credit}
                          onChange={handleOrderCreditDraftChange('is_credit')}
                        />
                        Apply as credit (negative)
                      </label>
                    </div>
                    <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                      Metadata (JSON)
                      <textarea
                        className="ldc-input mt-2 min-h-[100px] font-mono text-xs"
                        value={orderCreditDraft.metadata}
                        onChange={handleOrderCreditDraftChange('metadata')}
                      />
                    </label>
                    {orderCreditState.error ? (
                      <div className="mt-3 text-sm text-rose-600">{orderCreditState.error}</div>
                    ) : null}
                    {orderCreditState.success ? (
                      <div className="mt-3 text-sm text-emerald-700">
                        {orderCreditState.success}
                      </div>
                    ) : null}
                    <div className="mt-4">
                      <button
                        className="ldc-button-primary"
                        type="button"
                        onClick={handleCreateOrderCreditLine}
                        disabled={orderCreditState.saving}
                      >
                        {orderCreditState.saving ? 'Creating...' : 'Create credit line'}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="ldc-card p-6">
                <h3 className="font-heading text-xl text-ldc-ink">Shipping & Fulfillment</h3>
                <p className="mt-2 text-sm text-ldc-ink/70">
                  Shipping methods and fulfillment updates from LDC.
                </p>
                <div className="mt-4 space-y-4">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                      Shipping methods
                    </div>
                    <div className="mt-2">
                      <DataTable
                        columns={shippingMethodColumns}
                        rows={shippingMethodRows}
                        getRowId={(row) => row.id}
                        isLoading={false}
                        emptyText="No shipping methods added."
                      />
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                      Fulfillments
                    </div>
                    <div className="mt-2">
                      <DataTable
                        columns={fulfillmentColumns}
                        rows={fulfillmentRows}
                        getRowId={(row) => row.id}
                        isLoading={false}
                        emptyText="No fulfillments yet."
                      />
                    </div>
                  </div>
                </div>
              </div>

              {isOrder || isDraftOrder ? (
                <>
                  {isOrder ? (
                    <div className="ldc-card p-6">
                      <h3 className="font-heading text-xl text-ldc-ink">Order Actions</h3>
                      <p className="mt-2 text-sm text-ldc-ink/70">
                        Cancel or complete the order from the LDC Admin Studio.
                      </p>
                      {orderActionState.error ? (
                        <div className="mt-3 text-sm text-rose-600">{orderActionState.error}</div>
                      ) : null}
                      {orderActionState.success ? (
                        <div className="mt-3 text-sm text-emerald-700">
                          {orderActionState.success}
                        </div>
                      ) : null}
                      {orderArchiveState.error ? (
                        <div className="mt-3 text-sm text-rose-600">
                          {orderArchiveState.error}
                        </div>
                      ) : null}
                      {orderArchiveState.success ? (
                        <div className="mt-3 text-sm text-emerald-700">
                          {orderArchiveState.success}
                        </div>
                      ) : null}
                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <button
                          className="ldc-button-primary"
                          type="button"
                          onClick={handleOrderComplete}
                          disabled={orderActionState.saving || record?.status === 'completed'}
                        >
                          {orderActionState.saving ? 'Working...' : 'Complete Order'}
                        </button>
                        <button
                          className="ldc-button-secondary"
                          type="button"
                          onClick={handleOrderCancel}
                          disabled={orderActionState.saving || record?.status === 'canceled'}
                        >
                          Cancel Order
                        </button>
                        <button
                          className="ldc-button-secondary"
                          type="button"
                          onClick={handleOrderArchive}
                          disabled={orderArchiveState.saving}
                        >
                          {orderArchiveState.saving ? 'Archiving...' : 'Archive Order'}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {isOrder ? (
                    <div className="ldc-card p-6">
                      <h3 className="font-heading text-xl text-ldc-ink">Order Activity</h3>
                      <p className="mt-2 text-sm text-ldc-ink/70">
                        Timeline of payments, fulfillment, returns, and internal updates.
                      </p>
                      {orderTimelineItems.length ? (
                        <div className="mt-4 space-y-3">
                          {orderTimelineItems.map((item, index) => (
                            <div
                              key={item.id || `${item.title}-${index}`}
                              className="rounded-2xl bg-white/70 p-4"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ldc-ink/60">
                                <span className="font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                                  {item.title}
                                </span>
                                <span>
                                  {item.timestamp ? formatDateTime(item.timestamp) : '-'}
                                </span>
                              </div>
                              {item.detail ? (
                                <div className="mt-2 whitespace-pre-line text-sm text-ldc-ink">
                                  {item.detail}
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-3 text-sm text-ldc-ink/60">No activity yet.</p>
                      )}
                    </div>
                  ) : null}

                  {isOrder ? (
                    <div className="ldc-card p-6">
                      <h3 className="font-heading text-xl text-ldc-ink">Order Transfer</h3>
                      <p className="mt-2 text-sm text-ldc-ink/70">
                        Move ownership of this order to another customer.
                      </p>

                      {orderTransferChange ? (
                        <div className="mt-4 rounded-2xl bg-white/70 p-4 text-sm text-ldc-ink">
                          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                            Transfer status
                          </div>
                          <div className="mt-2">
                            {orderTransferChange.confirmed_at
                              ? 'Confirmed'
                              : orderTransferChange.declined_at
                                ? 'Declined'
                                : orderTransferChange.canceled_at
                                  ? 'Canceled'
                                  : 'Requested'}
                          </div>
                          {orderTransferOriginalEmail ? (
                            <div className="mt-2 text-xs text-ldc-ink/60">
                              From: {orderTransferOriginalEmail}
                            </div>
                          ) : null}
                          {orderTransferTargetId ? (
                            <div className="mt-2 text-xs text-ldc-ink/60">
                              To:{' '}
                              {orderTransferTarget
                                ? `${orderTransferTarget.first_name || ''} ${orderTransferTarget.last_name || ''}`.trim() ||
                                  orderTransferTarget.email ||
                                  orderTransferTargetId
                                : orderTransferTargetId}
                            </div>
                          ) : null}
                          <div className="mt-2 text-xs text-ldc-ink/60">
                            Requested {formatDateTime(orderTransferChange.created_at)}
                          </div>
                        </div>
                      ) : (
                        <p className="mt-4 text-sm text-ldc-ink/60">
                          No transfer requests yet.
                        </p>
                      )}

                      {orderTransferTargetState.error ? (
                        <div className="mt-3 text-sm text-rose-600">
                          {orderTransferTargetState.error}
                        </div>
                      ) : null}
                      {orderTransferState.error ? (
                        <div className="mt-3 text-sm text-rose-600">{orderTransferState.error}</div>
                      ) : null}
                      {orderTransferState.success ? (
                        <div className="mt-3 text-sm text-emerald-700">
                          {orderTransferState.success}
                        </div>
                      ) : null}

                      {orderTransferActiveChange ? (
                        <div className="mt-4">
                          <button
                            className="ldc-button-secondary"
                            type="button"
                            onClick={handleCancelOrderTransfer}
                            disabled={orderTransferState.canceling}
                          >
                            {orderTransferState.canceling ? 'Canceling...' : 'Cancel transfer'}
                          </button>
                        </div>
                      ) : (
                        <div className="mt-4 space-y-4">
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Search customer
                            <input
                              className="ldc-input mt-2"
                              value={orderTransferSearch.query}
                              onChange={handleOrderTransferSearchChange}
                              placeholder="Search by name or email"
                            />
                          </label>
                          {orderTransferSearch.loading ? (
                            <div className="text-sm text-ldc-ink/60">Searching customers...</div>
                          ) : null}
                          {orderTransferSearch.error ? (
                            <div className="text-sm text-rose-600">
                              {orderTransferSearch.error}
                            </div>
                          ) : null}
                          {orderTransferSearch.results.length ? (
                            <div className="grid gap-2 md:grid-cols-2">
                              {orderTransferSearch.results.map((customer) => (
                                <button
                                  key={customer.id}
                                  type="button"
                                  className="rounded-2xl border border-white/70 bg-white/70 px-3 py-2 text-left text-xs text-ldc-ink"
                                  onClick={() => handleSelectOrderTransferCustomer(customer)}
                                >
                                  <div className="font-semibold">
                                    {customer.first_name || customer.last_name
                                      ? `${customer.first_name || ''} ${customer.last_name || ''}`.trim()
                                      : customer.email || customer.id}
                                  </div>
                                  <div className="text-ldc-ink/60">
                                    {customer.email || customer.id}
                                  </div>
                                </button>
                              ))}
                            </div>
                          ) : null}
                          {orderTransferDraft.customer_id ? (
                            <div className="text-xs text-ldc-ink/60">
                              Selected customer ID: {orderTransferDraft.customer_id}
                            </div>
                          ) : null}
                          <div className="grid gap-3 md:grid-cols-2">
                            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                              Description (optional)
                              <input
                                className="ldc-input mt-2"
                                value={orderTransferDraft.description}
                                onChange={handleOrderTransferDraftChange('description')}
                              />
                            </label>
                            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                              Internal note (optional)
                              <input
                                className="ldc-input mt-2"
                                value={orderTransferDraft.internal_note}
                                onChange={handleOrderTransferDraftChange('internal_note')}
                              />
                            </label>
                          </div>
                          <button
                            className="ldc-button-primary"
                            type="button"
                            onClick={handleRequestOrderTransfer}
                            disabled={orderTransferState.saving}
                          >
                            {orderTransferState.saving ? 'Requesting...' : 'Request transfer'}
                          </button>
                        </div>
                      )}
                    </div>
                  ) : null}

                  {isDraftOrder ? (
                    <div className="ldc-card p-6">
                      <h3 className="font-heading text-xl text-ldc-ink">Draft Order Actions</h3>
                      <p className="mt-2 text-sm text-ldc-ink/70">
                        Convert this draft order into a live order when it is ready.
                      </p>
                      {draftOrderActionState.error ? (
                        <div className="mt-3 text-sm text-rose-600">
                          {draftOrderActionState.error}
                        </div>
                      ) : null}
                      {draftOrderActionState.success ? (
                        <div className="mt-3 text-sm text-emerald-700">
                          {draftOrderActionState.success}
                        </div>
                      ) : null}
                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <button
                          className="ldc-button-primary"
                          type="button"
                          onClick={handleConvertDraftOrder}
                          disabled={draftOrderActionState.saving}
                        >
                          {draftOrderActionState.saving ? 'Converting...' : 'Convert to order'}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <div className="ldc-card p-6">
                    <h3 className="font-heading text-xl text-ldc-ink">
                      {isDraftOrder ? 'Draft Order Edit' : 'Order Edit'}
                    </h3>
                    <p className="mt-2 text-sm text-ldc-ink/70">
                      {isDraftOrder
                        ? 'Edit items, shipping, and promotions before confirming the draft.'
                        : 'Adjust line items and shipping before confirming the update.'}
                    </p>
                    {orderChangesLoading ? (
                      <div className="mt-3 text-sm text-ldc-ink/60">
                        Loading {isDraftOrder ? 'draft order edits' : 'order edits'}...
                      </div>
                    ) : null}
                    {orderChangesError ? (
                      <div className="mt-3 text-sm text-rose-600">{orderChangesError}</div>
                    ) : null}

                    {orderEditChange ? (
                      <>
                        <div className="mt-4 grid gap-4 md:grid-cols-2">
                          <div className="rounded-2xl bg-white/70 p-3 text-xs text-ldc-ink/70">
                            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                              Active edit
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <StatusBadge value={orderEditChange.status || 'pending'} />
                              <span className="text-ldc-ink/60">ID {orderEditChange.id}</span>
                            </div>
                            {orderEditChange.description ? (
                              <div className="mt-2 text-xs text-ldc-ink/60">
                                {orderEditChange.description}
                              </div>
                            ) : null}
                            {orderEditChange.internal_note ? (
                              <div className="mt-2 text-xs text-ldc-ink/60">
                                Note: {orderEditChange.internal_note}
                              </div>
                            ) : null}
                          </div>
                          <div className="rounded-2xl bg-white/70 p-3 text-xs text-ldc-ink/70">
                            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                              Timeline
                            </div>
                            <div className="mt-2 text-xs text-ldc-ink/60">
                              Created {formatDateTime(orderEditChange.created_at)}
                            </div>
                            {orderEditChange.requested_at ? (
                              <div className="mt-1 text-xs text-ldc-ink/60">
                                Requested {formatDateTime(orderEditChange.requested_at)}
                              </div>
                            ) : null}
                            {orderEditChange.confirmed_at ? (
                              <div className="mt-1 text-xs text-ldc-ink/60">
                                Confirmed {formatDateTime(orderEditChange.confirmed_at)}
                              </div>
                            ) : null}
                          </div>
                        </div>

                        {orderEditState.error ? (
                          <div className="mt-3 text-sm text-rose-600">{orderEditState.error}</div>
                        ) : null}
                        {orderEditState.success ? (
                          <div className="mt-3 text-sm text-emerald-700">
                            {orderEditState.success}
                          </div>
                        ) : null}

                        <div className="mt-4 flex flex-wrap items-center gap-3">
                          <button
                            className="ldc-button-secondary"
                            type="button"
                            onClick={handleRequestOrderEdit}
                            disabled={
                              orderEditState.saving ||
                              orderEditStatus === 'requested'
                            }
                          >
                            {orderEditState.saving && orderEditState.action === 'request'
                              ? 'Requesting...'
                              : 'Request edit'}
                          </button>
                          <button
                            className="ldc-button-primary"
                            type="button"
                            onClick={handleConfirmOrderEdit}
                            disabled={orderEditState.saving}
                          >
                            {orderEditState.saving && orderEditState.action === 'confirm'
                              ? 'Confirming...'
                              : 'Confirm edit'}
                          </button>
                          <button
                            className="ldc-button-secondary"
                            type="button"
                            onClick={handleCancelOrderEdit}
                            disabled={orderEditState.saving}
                          >
                            {orderEditState.saving && orderEditState.action === 'cancel'
                              ? 'Canceling...'
                              : 'Cancel edit'}
                          </button>
                        </div>
                      </>
                    ) : (
                      <form
                        className={`mt-4 grid gap-4 ${isDraftOrder ? '' : 'md:grid-cols-2'}`}
                        onSubmit={handleStartOrderEdit}
                      >
                        {!isDraftOrder ? (
                          <>
                            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                              Description (optional)
                              <input
                                className="ldc-input mt-2"
                                value={orderEditDraft.description}
                                onChange={handleOrderEditDraftChange('description')}
                                placeholder="Adjust quantities or add items"
                              />
                            </label>
                            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                              Internal note (optional)
                              <input
                                className="ldc-input mt-2"
                                value={orderEditDraft.internal_note}
                                onChange={handleOrderEditDraftChange('internal_note')}
                                placeholder="Private context for the edit"
                              />
                            </label>
                          </>
                        ) : null}
                        {orderEditLastChange ? (
                          <div className="md:col-span-2 text-xs text-ldc-ink/60">
                            Last edit {orderEditLastChange.status || 'completed'} on{' '}
                            {formatDateTime(orderEditLastChange.updated_at || orderEditLastChange.created_at)}
                          </div>
                        ) : null}
                        {orderEditState.error ? (
                          <div className="md:col-span-2 text-sm text-rose-600">
                            {orderEditState.error}
                          </div>
                        ) : null}
                        {orderEditState.success ? (
                          <div className="md:col-span-2 text-sm text-emerald-700">
                            {orderEditState.success}
                          </div>
                        ) : null}
                        <button
                          className="ldc-button-primary md:col-span-2"
                          type="submit"
                          disabled={orderEditState.saving}
                        >
                          {orderEditState.saving
                            ? 'Starting...'
                            : `Start ${isDraftOrder ? 'draft order' : 'order'} edit`}
                        </button>
                      </form>
                    )}

                    {orderEditChange ? (
                      <div className="mt-6 space-y-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                          Line item adjustments
                        </div>
                        {orderEditItemState.error ? (
                          <div className="text-sm text-rose-600">{orderEditItemState.error}</div>
                        ) : null}
                        {orderEditItemState.success ? (
                          <div className="text-sm text-emerald-700">{orderEditItemState.success}</div>
                        ) : null}
                        {orderItems.length ? (
                          <div className="space-y-3">
                            {orderItems.map((item) => {
                              const itemId = getOrderItemId(item);
                              if (!itemId) return null;
                              const draft = orderEditItemDrafts[itemId] || {};
                              const currentQty = getLineItemQuantity(item);
                              const pendingQty = orderEditItemUpdateMap[itemId]?.details?.quantity;
                              const isSaving = orderEditItemState.savingId === itemId;
                              return (
                                <div key={itemId} className="rounded-2xl bg-white/70 p-4">
                                  <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                      <div className="text-sm font-semibold text-ldc-ink">
                                        {getLineItemTitle(item)}
                                      </div>
                                      <div className="mt-1 text-xs text-ldc-ink/60">
                                        SKU: {item?.variant_sku || item?.variant?.sku || '-'}
                                      </div>
                                      <div className="mt-1 text-xs text-ldc-ink/60">
                                        Current qty: {currentQty}
                                        {pendingQty != null && pendingQty !== currentQty
                                          ? ` • Pending ${pendingQty}`
                                          : ''}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                                      New quantity
                                      <input
                                        className="ldc-input mt-2"
                                        type="number"
                                        min="0"
                                        value={draft.quantity ?? currentQty ?? ''}
                                        onChange={handleOrderEditItemDraftChange(itemId, 'quantity')}
                                      />
                                    </label>
                                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                                      Unit price override
                                      <input
                                        className="ldc-input mt-2"
                                        value={draft.unit_price ?? ''}
                                        onChange={handleOrderEditItemDraftChange(itemId, 'unit_price')}
                                        placeholder="Leave blank to keep"
                                      />
                                    </label>
                                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                                      Compare at price
                                      <input
                                        className="ldc-input mt-2"
                                        value={draft.compare_at_unit_price ?? ''}
                                        onChange={handleOrderEditItemDraftChange(itemId, 'compare_at_unit_price')}
                                        placeholder="Optional"
                                      />
                                    </label>
                                  </div>
                                  <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                                    Internal note (optional)
                                    <input
                                      className="ldc-input mt-2"
                                      value={draft.internal_note ?? ''}
                                      onChange={handleOrderEditItemDraftChange(itemId, 'internal_note')}
                                    />
                                  </label>
                                  <div className="mt-3 flex flex-wrap items-center gap-3">
                                    <button
                                      className="ldc-button-primary"
                                      type="button"
                                      onClick={() => submitOrderEditItem(itemId)}
                                      disabled={isSaving}
                                    >
                                      {isSaving && orderEditItemState.action === 'update'
                                        ? 'Updating...'
                                        : 'Update item'}
                                    </button>
                                    <button
                                      className="ldc-button-secondary"
                                      type="button"
                                      onClick={() => submitOrderEditItem(itemId, 0)}
                                      disabled={isSaving}
                                    >
                                      {isSaving && orderEditItemState.action === 'remove'
                                        ? 'Removing...'
                                        : 'Remove item'}
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="text-sm text-ldc-ink/60">No line items found.</div>
                        )}
                      </div>
                    ) : null}

                    {orderEditChange ? (
                      <div className="mt-6 space-y-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                          Added items
                        </div>
                        {orderEditAddedItems.length ? (
                          <div className="space-y-3">
                            {orderEditAddedItems.map(({ action, item, referenceId }) => {
                              if (!action?.id) return null;
                              const draft = orderEditAddActionDrafts[action.id] || {};
                              const isSaving = orderEditItemState.savingId === action.id;
                              return (
                                <div key={action.id} className="rounded-2xl bg-white/70 p-4">
                                  <div className="text-sm font-semibold text-ldc-ink">
                                    {item ? getLineItemTitle(item) : `Added item ${referenceId}`}
                                  </div>
                                  <div className="mt-1 text-xs text-ldc-ink/60">
                                    SKU: {item?.variant_sku || item?.variant?.sku || '-'}
                                  </div>
                                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                                      Quantity
                                      <input
                                        className="ldc-input mt-2"
                                        type="number"
                                        min="1"
                                        value={draft.quantity ?? 1}
                                        onChange={handleOrderEditAddActionDraftChange(action.id, 'quantity')}
                                      />
                                    </label>
                                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                                      Unit price override
                                      <input
                                        className="ldc-input mt-2"
                                        value={draft.unit_price ?? ''}
                                        onChange={handleOrderEditAddActionDraftChange(action.id, 'unit_price')}
                                      />
                                    </label>
                                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                                      Compare at price
                                      <input
                                        className="ldc-input mt-2"
                                        value={draft.compare_at_unit_price ?? ''}
                                        onChange={handleOrderEditAddActionDraftChange(action.id, 'compare_at_unit_price')}
                                      />
                                    </label>
                                  </div>
                                  <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                                    Internal note (optional)
                                    <input
                                      className="ldc-input mt-2"
                                      value={draft.internal_note ?? ''}
                                      onChange={handleOrderEditAddActionDraftChange(action.id, 'internal_note')}
                                    />
                                  </label>
                                  <div className="mt-3 flex flex-wrap items-center gap-3">
                                    <button
                                      className="ldc-button-primary"
                                      type="button"
                                      onClick={() => handleUpdateOrderEditAddAction(action.id)}
                                      disabled={isSaving}
                                    >
                                      {isSaving && orderEditItemState.action === 'add-update'
                                        ? 'Updating...'
                                        : 'Update added item'}
                                    </button>
                                    <button
                                      className="ldc-button-secondary"
                                      type="button"
                                      onClick={() => handleRemoveOrderEditAddAction(action.id)}
                                      disabled={isSaving}
                                    >
                                      {isSaving && orderEditItemState.action === 'add-remove'
                                        ? 'Removing...'
                                        : 'Remove'}
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="text-sm text-ldc-ink/60">No items added yet.</div>
                        )}
                      </div>
                    ) : null}

                    {orderEditChange ? (
                      <div className="mt-6 space-y-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                          Add new item
                        </div>
                        {orderEditVariantSearch.error ? (
                          <div className="text-sm text-rose-600">{orderEditVariantSearch.error}</div>
                        ) : null}
                        <div className="grid gap-4 md:grid-cols-2">
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Search variants
                            <input
                              className="ldc-input mt-2"
                              value={orderEditVariantSearch.query}
                              onChange={handleOrderEditVariantSearchChange}
                              placeholder="Search by title or SKU"
                            />
                          </label>
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Variant ID
                            <input
                              className="ldc-input mt-2"
                              value={orderEditAddDraft.variant_id}
                              onChange={handleOrderEditAddDraftChange('variant_id')}
                              placeholder="variant_..."
                            />
                          </label>
                        </div>
                        {orderEditVariantSearch.loading ? (
                          <div className="text-sm text-ldc-ink/60">Searching variants...</div>
                        ) : null}
                        {orderEditVariantSearch.results.length ? (
                          <div className="grid gap-2 md:grid-cols-2">
                            {orderEditVariantSearch.results.map((variant) => (
                              <button
                                key={variant.id}
                                className="rounded-2xl border border-white/70 bg-white/70 px-3 py-2 text-left text-xs text-ldc-ink"
                                type="button"
                                onClick={() => handleSelectOrderEditVariant(variant)}
                              >
                                <div className="font-semibold">
                                  {variant.product?.title || variant.title || variant.id}
                                </div>
                                <div className="text-ldc-ink/60">
                                  {variant.title ? `${variant.title} · ` : ''}SKU {variant.sku || '-'}
                                </div>
                              </button>
                            ))}
                          </div>
                        ) : null}
                        {orderEditSelectedVariant ? (
                          <div className="rounded-2xl bg-white/70 p-3 text-xs text-ldc-ink/70">
                            Selected: {orderEditSelectedVariant.product?.title || 'Variant'} ·{' '}
                            {orderEditSelectedVariant.title || orderEditSelectedVariant.id}
                          </div>
                        ) : null}
                        <form className="grid gap-4 md:grid-cols-3" onSubmit={handleAddOrderEditItem}>
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Quantity
                            <input
                              className="ldc-input mt-2"
                              type="number"
                              min="1"
                              value={orderEditAddDraft.quantity}
                              onChange={handleOrderEditAddDraftChange('quantity')}
                            />
                          </label>
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Unit price override
                            <input
                              className="ldc-input mt-2"
                              value={orderEditAddDraft.unit_price}
                              onChange={handleOrderEditAddDraftChange('unit_price')}
                              placeholder="Optional"
                            />
                          </label>
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Compare at price
                            <input
                              className="ldc-input mt-2"
                              value={orderEditAddDraft.compare_at_unit_price}
                              onChange={handleOrderEditAddDraftChange('compare_at_unit_price')}
                              placeholder="Optional"
                            />
                          </label>
                          <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Internal note (optional)
                            <input
                              className="ldc-input mt-2"
                              value={orderEditAddDraft.internal_note}
                              onChange={handleOrderEditAddDraftChange('internal_note')}
                            />
                          </label>
                          <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            <input
                              type="checkbox"
                              className="h-4 w-4 accent-ldc-plum"
                              checked={orderEditAddDraft.allow_backorder}
                              onChange={handleOrderEditAddDraftChange('allow_backorder')}
                            />
                            Allow backorder
                          </label>
                          {orderEditAddState.error ? (
                            <div className="md:col-span-3 text-sm text-rose-600">
                              {orderEditAddState.error}
                            </div>
                          ) : null}
                          {orderEditAddState.success ? (
                            <div className="md:col-span-3 text-sm text-emerald-700">
                              {orderEditAddState.success}
                            </div>
                          ) : null}
                          <button
                            className="ldc-button-primary md:col-span-3"
                            type="submit"
                            disabled={orderEditAddState.saving}
                          >
                            {orderEditAddState.saving ? 'Adding...' : 'Add item to edit'}
                          </button>
                        </form>
                      </div>
                    ) : null}

                    {orderEditChange ? (
                      <div className="mt-6 space-y-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                          Shipping adjustments
                        </div>
                        {orderEditShippingState.error ? (
                          <div className="text-sm text-rose-600">{orderEditShippingState.error}</div>
                        ) : null}
                        {orderEditShippingState.success ? (
                          <div className="text-sm text-emerald-700">
                            {orderEditShippingState.success}
                          </div>
                        ) : null}
                        {isDraftOrder ? (
                          <div className="space-y-3">
                            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                              Existing shipping methods
                            </div>
                            {draftOrderExistingShippingMethods.length ? (
                              draftOrderExistingShippingMethods.map((method) => {
                                const draft = draftOrderShippingMethodDrafts[method.id] || {};
                                const isSaving = orderEditShippingState.savingId === method.id;
                                const label =
                                  method?.name ||
                                  method?.shipping_option?.name ||
                                  method?.shipping_option_id ||
                                  method?.id ||
                                  'Shipping method';
                                return (
                                  <div key={method.id} className="rounded-2xl bg-white/70 p-4">
                                    <div className="text-sm font-semibold text-ldc-ink">{label}</div>
                                    <div className="mt-1 text-xs text-ldc-ink/60">
                                      Current amount:{' '}
                                      {formatMoneyOrDash(method?.amount, method?.currency_code || orderCurrency)}
                                    </div>
                                    <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                                      Custom amount
                                      <input
                                        className="ldc-input mt-2"
                                        value={draft.custom_amount ?? ''}
                                        onChange={handleDraftOrderShippingMethodDraftChange(method.id, 'custom_amount')}
                                      />
                                    </label>
                                    <div className="mt-3 flex flex-wrap items-center gap-3">
                                      <button
                                        className="ldc-button-primary"
                                        type="button"
                                        onClick={() => handleUpdateDraftOrderShippingMethod(method.id)}
                                        disabled={isSaving}
                                      >
                                        {isSaving && orderEditShippingState.action === 'update-existing'
                                          ? 'Updating...'
                                          : 'Update shipping'}
                                      </button>
                                      <button
                                        className="ldc-button-secondary"
                                        type="button"
                                        onClick={() => handleRemoveDraftOrderShippingMethod(method.id)}
                                        disabled={isSaving}
                                      >
                                        {isSaving && orderEditShippingState.action === 'remove-existing'
                                          ? 'Removing...'
                                          : 'Remove'}
                                      </button>
                                    </div>
                                  </div>
                                );
                              })
                            ) : (
                              <div className="text-sm text-ldc-ink/60">
                                No existing shipping methods to edit.
                              </div>
                            )}
                          </div>
                        ) : null}
                        {orderEditShippingMethods.length ? (
                          <div className="space-y-3">
                            {orderEditShippingMethods.map(({ action, method, referenceId }) => {
                              if (!action?.id) return null;
                              const draft = orderEditShippingActionDrafts[action.id] || {};
                              const isSaving = orderEditShippingState.savingId === action.id;
                              const label =
                                method?.name ||
                                method?.shipping_option?.name ||
                                method?.shipping_option_id ||
                                referenceId ||
                                'Shipping method';
                              return (
                                <div key={action.id} className="rounded-2xl bg-white/70 p-4">
                                  <div className="text-sm font-semibold text-ldc-ink">{label}</div>
                                  <div className="mt-1 text-xs text-ldc-ink/60">
                                    Current amount:{' '}
                                    {formatMoneyOrDash(method?.amount, method?.currency_code || orderCurrency)}
                                  </div>
                                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                                      Custom amount
                                      <input
                                        className="ldc-input mt-2"
                                        value={draft.custom_amount ?? ''}
                                        onChange={handleOrderEditShippingActionDraftChange(action.id, 'custom_amount')}
                                      />
                                    </label>
                                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                                      Internal note
                                      <input
                                        className="ldc-input mt-2"
                                        value={draft.internal_note ?? ''}
                                        onChange={handleOrderEditShippingActionDraftChange(action.id, 'internal_note')}
                                      />
                                    </label>
                                  </div>
                                  <div className="mt-3 flex flex-wrap items-center gap-3">
                                    <button
                                      className="ldc-button-primary"
                                      type="button"
                                      onClick={() => handleUpdateOrderEditShipping(action.id)}
                                      disabled={isSaving}
                                    >
                                      {isSaving && orderEditShippingState.action === 'update'
                                        ? 'Updating...'
                                        : 'Update shipping'}
                                    </button>
                                    <button
                                      className="ldc-button-secondary"
                                      type="button"
                                      onClick={() => handleRemoveOrderEditShipping(action.id)}
                                      disabled={isSaving}
                                    >
                                      {isSaving && orderEditShippingState.action === 'remove'
                                        ? 'Removing...'
                                        : 'Remove'}
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="text-sm text-ldc-ink/60">
                            No shipping changes yet.
                          </div>
                        )}
                        <form className="grid gap-4 md:grid-cols-2" onSubmit={handleAddOrderEditShipping}>
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Shipping option
                            <select
                              className="ldc-input mt-2"
                              value={orderEditShippingDraft.shipping_option_id}
                              onChange={handleOrderEditShippingDraftChange('shipping_option_id')}
                            >
                              <option value="">Select a shipping option</option>
                              {fulfillmentMeta.shippingOptions.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.name || option.id}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Custom amount
                            <input
                              className="ldc-input mt-2"
                              value={orderEditShippingDraft.custom_amount}
                              onChange={handleOrderEditShippingDraftChange('custom_amount')}
                              placeholder="Optional"
                            />
                          </label>
                          <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Description (optional)
                            <input
                              className="ldc-input mt-2"
                              value={orderEditShippingDraft.description}
                              onChange={handleOrderEditShippingDraftChange('description')}
                            />
                          </label>
                          <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Internal note (optional)
                            <input
                              className="ldc-input mt-2"
                              value={orderEditShippingDraft.internal_note}
                              onChange={handleOrderEditShippingDraftChange('internal_note')}
                            />
                          </label>
                          <button
                            className="ldc-button-primary md:col-span-2"
                            type="submit"
                            disabled={
                              orderEditShippingState.savingId === 'new' &&
                              orderEditShippingState.action === 'add'
                            }
                          >
                            {orderEditShippingState.savingId === 'new' &&
                            orderEditShippingState.action === 'add'
                              ? 'Adding...'
                              : 'Add shipping method'}
                          </button>
                        </form>
                      </div>
                    ) : null}

                    {orderEditChange && isDraftOrder ? (
                      <div className="mt-6 space-y-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                          Promotions
                        </div>
                        {draftOrderPromoState.error ? (
                          <div className="text-sm text-rose-600">{draftOrderPromoState.error}</div>
                        ) : null}
                        {draftOrderPromoState.success ? (
                          <div className="text-sm text-emerald-700">{draftOrderPromoState.success}</div>
                        ) : null}
                        {draftOrderPromotionCodes.length ? (
                          <div className="flex flex-wrap items-center gap-2">
                            {draftOrderPromotionCodes.map((code) => (
                              <div
                                key={code}
                                className="flex items-center gap-2 rounded-full bg-white/70 px-3 py-1 text-xs text-ldc-ink"
                              >
                                <span className="font-semibold">{code}</span>
                                <button
                                  className="text-rose-600"
                                  type="button"
                                  onClick={() => handleDraftOrderPromotionRemove(code)}
                                  disabled={draftOrderPromoState.saving}
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-sm text-ldc-ink/60">No promotions applied yet.</div>
                        )}
                        <form
                          className="grid gap-3 md:grid-cols-2"
                          onSubmit={handleDraftOrderPromotionAdd}
                        >
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Promo codes
                            <input
                              className="ldc-input mt-2"
                              value={draftOrderPromoDraft}
                              onChange={(event) => setDraftOrderPromoDraft(event.target.value)}
                              placeholder="CODE10, VIP"
                            />
                          </label>
                          <div className="flex items-end">
                            <button
                              className="ldc-button-primary"
                              type="submit"
                              disabled={draftOrderPromoState.saving}
                            >
                              {draftOrderPromoState.saving && draftOrderPromoState.action === 'add'
                                ? 'Adding...'
                                : 'Add promotions'}
                            </button>
                          </div>
                        </form>
                      </div>
                    ) : null}

                    {orderEditChange ? (
                      <div className="mt-6 space-y-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                          {isDraftOrder ? 'Draft order preview totals' : 'Order preview totals'}
                        </div>
                        {orderPreviewLoading ? (
                          <div className="text-sm text-ldc-ink/60">Loading preview...</div>
                        ) : null}
                        {orderPreviewError ? (
                          <div className="text-sm text-rose-600">{orderPreviewError}</div>
                        ) : null}
                        {orderEditPreviewTotals.length ? (
                          <div className="grid gap-3 md:grid-cols-3">
                            {orderEditPreviewTotals.map((total) => (
                              <div key={total.label} className="rounded-2xl bg-white/70 p-3">
                                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                                  {total.label}
                                </div>
                                <div className="mt-2 text-sm text-ldc-ink">
                                  {formatMoneyOrDash(total.amount, orderCurrency)}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-sm text-ldc-ink/60">
                            Preview totals unavailable yet.
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>

                  {isOrder ? (
                    <>
                      <div className="ldc-card p-6">
                    <h3 className="font-heading text-xl text-ldc-ink">Fulfillment Workflow</h3>
                    <p className="mt-2 text-sm text-ldc-ink/70">
                      Create fulfillments, ship items, and mark deliveries.
                    </p>
                    {fulfillmentMetaLoading ? (
                      <div className="mt-3 text-sm text-ldc-ink/60">
                        Loading fulfillment settings...
                      </div>
                    ) : null}
                    {fulfillmentMetaError ? (
                      <div className="mt-3 text-sm text-rose-600">{fulfillmentMetaError}</div>
                    ) : null}
                    {fulfillmentState.error ? (
                      <div className="mt-3 text-sm text-rose-600">{fulfillmentState.error}</div>
                    ) : null}
                    {fulfillmentState.success ? (
                      <div className="mt-3 text-sm text-emerald-700">{fulfillmentState.success}</div>
                    ) : null}

                    <form className="mt-4 space-y-4" onSubmit={handleCreateFulfillment}>
                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                          Stock location
                          <select
                            className="ldc-input mt-2"
                            value={fulfillmentDraft.location_id}
                            onChange={handleFulfillmentFieldChange('location_id')}
                          >
                            <option value="">Default location</option>
                            {fulfillmentMeta.locations.map((location) => (
                              <option key={location.id} value={location.id}>
                                {location.name || location.id}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                          Shipping option
                          <select
                            className="ldc-input mt-2"
                            value={fulfillmentDraft.shipping_option_id}
                            onChange={handleFulfillmentFieldChange('shipping_option_id')}
                          >
                            <option value="">Select a shipping option</option>
                            {fulfillmentMeta.shippingOptions.map((option) => (
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
                            value={fulfillmentDraft.manual_shipping_option_id}
                            onChange={handleFulfillmentFieldChange('manual_shipping_option_id')}
                            placeholder="ship_opt_..."
                          />
                        </label>
                        <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-ldc-plum"
                            checked={fulfillmentDraft.notify_customer}
                            onChange={handleFulfillmentToggle}
                          />
                          Notify customer
                        </label>
                      </div>

                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                          Items to fulfill
                        </div>
                        <div className="mt-3 space-y-3">
                          {orderItems.length ? (
                            orderItems.map((item) => {
                              const itemId = getOrderItemId(item);
                              if (!itemId) return null;
                              return (
                                <div key={itemId} className="rounded-2xl bg-white/70 p-3">
                                  <div className="text-sm font-semibold text-ldc-ink">
                                    {getLineItemTitle(item)}
                                  </div>
                                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ldc-ink/60">
                                    <span>SKU: {item?.variant_sku || item?.variant?.sku || '-'}</span>
                                    <span>Qty: {item?.quantity ?? '-'}</span>
                                  </div>
                                  <label className="mt-2 block text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                                    Fulfill quantity
                                    <input
                                      className="ldc-input mt-2"
                                      type="number"
                                      min="0"
                                      max={item?.quantity ?? undefined}
                                      value={fulfillmentDraft.items?.[itemId] ?? ''}
                                      onChange={handleFulfillmentItemChange(itemId)}
                                    />
                                  </label>
                                </div>
                              );
                            })
                          ) : (
                            <p className="text-sm text-ldc-ink/60">No line items found.</p>
                          )}
                        </div>
                      </div>

                      <button
                        className="ldc-button-primary"
                        type="submit"
                        disabled={fulfillmentState.saving}
                      >
                        {fulfillmentState.saving ? 'Creating...' : 'Create fulfillment'}
                      </button>
                    </form>

                    <div className="mt-8 space-y-4">
                      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                        Existing fulfillments
                      </div>
                      {shipmentState.error ? (
                        <div className="text-sm text-rose-600">{shipmentState.error}</div>
                      ) : null}
                      {shipmentState.success ? (
                        <div className="text-sm text-emerald-700">{shipmentState.success}</div>
                      ) : null}
                      {Array.isArray(record?.fulfillments) && record.fulfillments.length ? (
                        record.fulfillments.map((fulfillment) => {
                          const draft = shipmentDrafts[fulfillment.id] || {};
                          const fulfillmentItems =
                            Array.isArray(fulfillment.items) && fulfillment.items.length
                              ? fulfillment.items
                              : orderItems;
                          const fulfillmentTrackingEntries =
                            getFulfillmentTrackingEntries(fulfillment);
                          return (
                            <div key={fulfillment.id} className="rounded-2xl bg-white/70 p-4">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <div className="text-sm font-semibold text-ldc-ink">
                                    Fulfillment {fulfillment.id}
                                  </div>
                                  <div className="mt-1 text-xs text-ldc-ink/60">
                                    Provider: {fulfillment.provider_id || '-'}
                                  </div>
                                </div>
                                <StatusBadge value={getFulfillmentStatus(fulfillment)} />
                              </div>

                              <div className="mt-4 grid gap-4 md:grid-cols-3">
                                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                                  Tracking number
                                  <input
                                    className="ldc-input mt-2"
                                    value={draft.tracking_number || ''}
                                    onChange={handleShipmentFieldChange(fulfillment.id, 'tracking_number')}
                                  />
                                </label>
                                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                                  Tracking URL
                                  <input
                                    className="ldc-input mt-2"
                                    value={draft.tracking_url || ''}
                                    onChange={handleShipmentFieldChange(fulfillment.id, 'tracking_url')}
                                  />
                                </label>
                                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                                  Label URL
                                  <input
                                    className="ldc-input mt-2"
                                    value={draft.label_url || ''}
                                    onChange={handleShipmentFieldChange(fulfillment.id, 'label_url')}
                                  />
                                </label>
                              </div>
                              <div className="mt-3">
                                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                                  Upload label file (optional)
                                  <input
                                    className="ldc-input mt-2"
                                    type="file"
                                    accept="application/pdf,image/*"
                                    onChange={(event) =>
                                      handleFulfillmentLabelUpload(fulfillment.id, event)
                                    }
                                    disabled={fulfillmentLabelUploadState.uploadingId === fulfillment.id}
                                  />
                                </label>
                                {fulfillmentLabelUploadState.targetId === fulfillment.id ? (
                                  <>
                                    {fulfillmentLabelUploadState.uploadingId === fulfillment.id ? (
                                      <div className="mt-2 text-sm text-ldc-ink/60">
                                        Uploading label...
                                      </div>
                                    ) : null}
                                    {fulfillmentLabelUploadState.error ? (
                                      <div className="mt-2 text-sm text-rose-600">
                                        {fulfillmentLabelUploadState.error}
                                      </div>
                                    ) : null}
                                    {fulfillmentLabelUploadState.success ? (
                                      <div className="mt-2 text-sm text-emerald-700">
                                        {fulfillmentLabelUploadState.success}
                                      </div>
                                    ) : null}
                                  </>
                                ) : null}
                              </div>
                              <div className="mt-3">
                                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                                  Current shipment info
                                </div>
                                {fulfillmentTrackingEntries.length ? (
                                  <div className="mt-2 space-y-2 text-xs text-ldc-ink/60">
                                    {fulfillmentTrackingEntries.map((entry, index) => (
                                      <div
                                        key={`${fulfillment.id}-tracking-${index}`}
                                        className="rounded-2xl bg-white/80 p-3"
                                      >
                                        {entry.trackingNumber ? (
                                          <div>Tracking # {entry.trackingNumber}</div>
                                        ) : null}
                                        {entry.trackingUrl ? (
                                          <div>
                                            Tracking URL: {renderExternalLink(entry.trackingUrl)}
                                          </div>
                                        ) : null}
                                        {entry.labelUrl ? (
                                          <div>Label URL: {renderExternalLink(entry.labelUrl)}</div>
                                        ) : null}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="mt-2 text-xs text-ldc-ink/60">
                                    No shipment tracking info yet.
                                  </div>
                                )}
                              </div>

                              <label className="mt-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 accent-ldc-plum"
                                  checked={draft.notify_customer !== false}
                                  onChange={handleShipmentToggle(fulfillment.id)}
                                />
                                Notify customer on shipment
                              </label>

                              <div className="mt-4">
                                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                                  Items to ship
                                </div>
                                <div className="mt-3 space-y-3">
                                  {fulfillmentItems.length ? (
                                    fulfillmentItems.map((item) => {
                                      const itemId = getOrderItemId(item);
                                      if (!itemId) return null;
                                      return (
                                        <div key={itemId} className="rounded-2xl bg-white/80 p-3">
                                          <div className="text-sm font-semibold text-ldc-ink">
                                            {getLineItemTitle(item)}
                                          </div>
                                          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ldc-ink/60">
                                            <span>SKU: {item?.variant_sku || item?.variant?.sku || '-'}</span>
                                            <span>Qty: {item?.quantity ?? '-'}</span>
                                          </div>
                                          <label className="mt-2 block text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                                            Ship quantity
                                            <input
                                              className="ldc-input mt-2"
                                              type="number"
                                              min="0"
                                              max={item?.quantity ?? undefined}
                                              value={draft.items?.[itemId] ?? ''}
                                              onChange={handleShipmentItemChange(fulfillment.id, itemId)}
                                            />
                                          </label>
                                        </div>
                                      );
                                    })
                                  ) : (
                                    <p className="text-sm text-ldc-ink/60">No items available.</p>
                                  )}
                                </div>
                              </div>

                              <div className="mt-4 flex flex-wrap items-center gap-3">
                                <button
                                  className="ldc-button-primary"
                                  type="button"
                                  onClick={() => handleCreateShipment(fulfillment.id)}
                                  disabled={
                                    shipmentState.savingId === fulfillment.id &&
                                    shipmentState.action === 'ship'
                                  }
                                >
                                  {shipmentState.savingId === fulfillment.id &&
                                  shipmentState.action === 'ship'
                                    ? 'Shipping...'
                                    : 'Create shipment'}
                                </button>
                                <button
                                  className="ldc-button-secondary"
                                  type="button"
                                  onClick={() => handleMarkFulfillmentDelivered(fulfillment.id)}
                                  disabled={
                                    fulfillment.delivered_at ||
                                    fulfillment.canceled_at ||
                                    (shipmentState.savingId === fulfillment.id &&
                                      shipmentState.action === 'deliver')
                                  }
                                >
                                  {shipmentState.savingId === fulfillment.id &&
                                  shipmentState.action === 'deliver'
                                    ? 'Marking...'
                                    : 'Mark delivered'}
                                </button>
                                <button
                                  className="ldc-button-secondary"
                                  type="button"
                                  onClick={() => handleCancelFulfillment(fulfillment.id)}
                                  disabled={
                                    fulfillment.canceled_at ||
                                    (shipmentState.savingId === fulfillment.id &&
                                      shipmentState.action === 'cancel')
                                  }
                                >
                                  {shipmentState.savingId === fulfillment.id &&
                                  shipmentState.action === 'cancel'
                                    ? 'Canceling...'
                                    : 'Cancel fulfillment'}
                                </button>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <p className="text-sm text-ldc-ink/60">No fulfillments created yet.</p>
                      )}
                    </div>
                  </div>

                  <div className="ldc-card p-6">
                    <h3 className="font-heading text-xl text-ldc-ink">Payment Actions</h3>
                    <p className="mt-2 text-sm text-ldc-ink/70">
                      Capture and refund payments tied to this order.
                    </p>
                    {refundReasonsError ? (
                      <div className="mt-3 text-sm text-rose-600">{refundReasonsError}</div>
                    ) : null}
                    {paymentState.error ? (
                      <div className="mt-3 text-sm text-rose-600">{paymentState.error}</div>
                    ) : null}
                    {paymentState.success ? (
                      <div className="mt-3 text-sm text-emerald-700">{paymentState.success}</div>
                    ) : null}

                    <div className="mt-4 space-y-4">
                      {orderPayments.length ? (
                        orderPayments.map((payment) => {
                          const draft = paymentDrafts[payment.id] || {};
                          const currency = payment.currency_code || orderCurrency;
                          return (
                            <div key={payment.id} className="rounded-2xl bg-white/70 p-4">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <div className="text-sm font-semibold text-ldc-ink">
                                    Payment {payment.id}
                                  </div>
                                  <div className="mt-1 text-xs text-ldc-ink/60">
                                    Provider: {payment.provider_id || '-'}
                                  </div>
                                </div>
                                <StatusBadge value={payment.captured_at ? 'captured' : 'pending'} />
                              </div>

                              <div className="mt-3 grid gap-3 md:grid-cols-4 text-xs text-ldc-ink/60">
                                <div>
                                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                                    Amount
                                  </div>
                                  <div className="mt-1 text-sm text-ldc-ink">
                                    {formatMoneyOrDash(payment.amount, currency)}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                                    Captured
                                  </div>
                                  <div className="mt-1 text-sm text-ldc-ink">
                                    {formatMoneyOrDash(payment.captured_amount, currency)}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                                    Refunded
                                  </div>
                                  <div className="mt-1 text-sm text-ldc-ink">
                                    {formatMoneyOrDash(payment.refunded_amount, currency)}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                                    Currency
                                  </div>
                                  <div className="mt-1 text-sm text-ldc-ink">
                                    {currency?.toUpperCase?.() || '-'}
                                  </div>
                                </div>
                              </div>

                              <div className="mt-4 grid gap-4 md:grid-cols-2">
                                <div className="rounded-2xl border border-white/70 bg-white/70 p-3">
                                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                                    Capture payment
                                  </div>
                                  <input
                                    className="ldc-input mt-3"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    placeholder="Amount (leave blank for full)"
                                    value={draft.capture_amount || ''}
                                    onChange={(event) =>
                                      updatePaymentDraft(payment.id, 'capture_amount', event.target.value)
                                    }
                                  />
                                  <button
                                    className="ldc-button-primary mt-3"
                                    type="button"
                                    onClick={() => handleCapturePayment(payment.id)}
                                    disabled={
                                      paymentState.savingId === payment.id &&
                                      paymentState.action === 'capture'
                                    }
                                  >
                                    {paymentState.savingId === payment.id &&
                                    paymentState.action === 'capture'
                                      ? 'Capturing...'
                                      : 'Capture'}
                                  </button>
                                </div>
                                <div className="rounded-2xl border border-white/70 bg-white/70 p-3">
                                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                                    Refund payment
                                  </div>
                                  <input
                                    className="ldc-input mt-3"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    placeholder="Amount (leave blank for full)"
                                    value={draft.refund_amount || ''}
                                    onChange={(event) =>
                                      updatePaymentDraft(payment.id, 'refund_amount', event.target.value)
                                    }
                                  />
                                  <select
                                    className="ldc-input mt-3"
                                    value={draft.refund_reason_id || ''}
                                    onChange={(event) =>
                                      updatePaymentDraft(payment.id, 'refund_reason_id', event.target.value)
                                    }
                                  >
                                    <option value="">Refund reason (optional)</option>
                                    {refundReasons.map((reason) => (
                                      <option key={reason.id} value={reason.id}>
                                        {reason.label || reason.code || reason.id}
                                      </option>
                                    ))}
                                  </select>
                                  <input
                                    className="ldc-input mt-3"
                                    placeholder="Refund note (optional)"
                                    value={draft.refund_note || ''}
                                    onChange={(event) =>
                                      updatePaymentDraft(payment.id, 'refund_note', event.target.value)
                                    }
                                  />
                                  <button
                                    className="ldc-button-secondary mt-3"
                                    type="button"
                                    onClick={() => handleRefundPayment(payment.id)}
                                    disabled={
                                      paymentState.savingId === payment.id &&
                                      paymentState.action === 'refund'
                                    }
                                  >
                                    {paymentState.savingId === payment.id &&
                                    paymentState.action === 'refund'
                                      ? 'Refunding...'
                                      : 'Refund'}
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <p className="text-sm text-ldc-ink/60">
                          No payments available for this order.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="ldc-card p-6">
                    <h3 className="font-heading text-xl text-ldc-ink">Returns</h3>
                    <p className="mt-2 text-sm text-ldc-ink/70">
                      Create return requests, receive items, and manage return status.
                    </p>
                    {returnReasonsError ? (
                      <div className="mt-3 text-sm text-rose-600">{returnReasonsError}</div>
                    ) : null}
                    {orderReturnsError ? (
                      <div className="mt-3 text-sm text-rose-600">{orderReturnsError}</div>
                    ) : null}
                    {returnState.error ? (
                      <div className="mt-3 text-sm text-rose-600">{returnState.error}</div>
                    ) : null}
                    {returnState.success ? (
                      <div className="mt-3 text-sm text-emerald-700">{returnState.success}</div>
                    ) : null}

                    <form className="mt-4 space-y-4" onSubmit={handleCreateReturn}>
                      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                        Create return
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                          Stock location
                          <select
                            className="ldc-input mt-2"
                            value={returnDraft.location_id}
                            onChange={handleReturnDraftChange('location_id')}
                          >
                            <option value="">Default location</option>
                            {fulfillmentMeta.locations.map((location) => (
                              <option key={location.id} value={location.id}>
                                {location.name || location.id}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                          Description
                          <input
                            className="ldc-input mt-2"
                            value={returnDraft.description}
                            onChange={handleReturnDraftChange('description')}
                          />
                        </label>
                        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                          Internal note
                          <input
                            className="ldc-input mt-2"
                            value={returnDraft.internal_note}
                            onChange={handleReturnDraftChange('internal_note')}
                          />
                        </label>
                        <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-ldc-plum"
                            checked={returnDraft.notify_customer}
                            onChange={handleReturnDraftToggle}
                          />
                          Notify customer
                        </label>
                      </div>
                      <button
                        className="ldc-button-primary"
                        type="submit"
                        disabled={returnState.savingId === 'new'}
                      >
                        {returnState.savingId === 'new' ? 'Creating...' : 'Create return'}
                      </button>
                    </form>

                    <div className="mt-8 space-y-4">
                      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                        Existing returns
                      </div>
                      {orderReturnsLoading ? (
                        <div className="text-sm text-ldc-ink/60">Loading returns...</div>
                      ) : null}
                      {orderReturns.length ? (
                        orderReturns.map((orderReturn) => {
                          const requestDraft = returnRequestDrafts[orderReturn.id] || {};
                          const receiveDraft = returnReceiveDrafts[orderReturn.id] || {};
                          const isBusy = returnState.savingId === orderReturn.id;
                          return (
                            <div key={orderReturn.id} className="rounded-2xl bg-white/70 p-4">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <div className="text-sm font-semibold text-ldc-ink">
                                    Return {orderReturn.id}
                                  </div>
                                  <div className="mt-1 text-xs text-ldc-ink/60">
                                    Created {formatDateTime(orderReturn.created_at)}
                                  </div>
                                </div>
                                <StatusBadge value={orderReturn.status || 'requested'} />
                              </div>

                              <div className="mt-4">
                                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                                  Request items
                                </div>
                                <div className="mt-3 space-y-3">
                                  {orderItems.map((item) => {
                                    const itemId = getOrderItemId(item);
                                    if (!itemId) return null;
                                    const entry = requestDraft[itemId] || { quantity: 0, reason_id: '' };
                                    return (
                                      <div key={itemId} className="rounded-2xl bg-white/80 p-3">
                                        <div className="text-sm font-semibold text-ldc-ink">
                                          {getLineItemTitle(item)}
                                        </div>
                                        <div className="mt-2 grid gap-3 md:grid-cols-2">
                                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                                            Quantity
                                            <input
                                              className="ldc-input mt-2"
                                              type="number"
                                              min="0"
                                              max={item?.quantity ?? undefined}
                                              value={entry.quantity ?? ''}
                                              onChange={handleReturnRequestItemChange(orderReturn.id, itemId, 'quantity')}
                                            />
                                          </label>
                                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                                            Reason
                                            <select
                                              className="ldc-input mt-2"
                                              value={entry.reason_id || ''}
                                              onChange={handleReturnRequestItemChange(orderReturn.id, itemId, 'reason_id')}
                                            >
                                              <option value="">Select reason</option>
                                              {returnReasons.map((reason) => (
                                                <option key={reason.id} value={reason.id}>
                                                  {reason.label || reason.value || reason.id}
                                                </option>
                                              ))}
                                            </select>
                                          </label>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                                <div className="mt-3 flex flex-wrap items-center gap-3">
                                  <button
                                    className="ldc-button-primary"
                                    type="button"
                                    onClick={() => handleRequestReturnItems(orderReturn.id)}
                                    disabled={isBusy}
                                  >
                                    {isBusy ? 'Saving...' : 'Request items'}
                                  </button>
                                  <button
                                    className="ldc-button-secondary"
                                    type="button"
                                    onClick={() => handleConfirmReturnRequest(orderReturn.id)}
                                    disabled={isBusy}
                                  >
                                    Confirm request
                                  </button>
                                </div>
                              </div>

                              <div className="mt-6">
                                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                                  Receive items
                                </div>
                                <div className="mt-3 space-y-3">
                                  {orderItems.map((item) => {
                                    const itemId = getOrderItemId(item);
                                    if (!itemId) return null;
                                    const quantity = receiveDraft[itemId] ?? '';
                                    return (
                                      <div key={itemId} className="rounded-2xl bg-white/80 p-3">
                                        <div className="text-sm font-semibold text-ldc-ink">
                                          {getLineItemTitle(item)}
                                        </div>
                                        <label className="mt-2 block text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                                          Quantity received
                                          <input
                                            className="ldc-input mt-2"
                                            type="number"
                                            min="0"
                                            max={item?.quantity ?? undefined}
                                            value={quantity}
                                            onChange={handleReturnReceiveItemChange(orderReturn.id, itemId)}
                                          />
                                        </label>
                                      </div>
                                    );
                                  })}
                                </div>
                                <div className="mt-3 flex flex-wrap items-center gap-3">
                                  <button
                                    className="ldc-button-secondary"
                                    type="button"
                                    onClick={() => handleStartReturnReceive(orderReturn.id)}
                                    disabled={isBusy}
                                  >
                                    Start receiving
                                  </button>
                                  <button
                                    className="ldc-button-primary"
                                    type="button"
                                    onClick={() => handleReceiveReturnItems(orderReturn.id)}
                                    disabled={isBusy}
                                  >
                                    Receive items
                                  </button>
                                  <button
                                    className="ldc-button-secondary"
                                    type="button"
                                    onClick={() => handleConfirmReturnReceive(orderReturn.id)}
                                    disabled={isBusy}
                                  >
                                    Confirm receipt
                                  </button>
                                </div>
                              </div>

                              <div className="mt-4">
                                <button
                                  className="ldc-button-secondary"
                                  type="button"
                                  onClick={() => handleCancelReturn(orderReturn.id)}
                                  disabled={isBusy}
                                >
                                  Cancel return
                                </button>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <p className="text-sm text-ldc-ink/60">No returns yet.</p>
                      )}
                    </div>
                  </div>

                      {renderExchangeWorkflow(true)}
                    </>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}

          {isReturn ? (
            <>
              <div className="ldc-card p-6">
                <h3 className="font-heading text-xl text-ldc-ink">Return Details</h3>
                <p className="mt-2 text-sm text-ldc-ink/70">
                  Review return metadata and the related order.
                </p>
                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  <div className="rounded-2xl bg-white/70 px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                      Order
                    </div>
                    <div className="mt-2 text-sm text-ldc-ink">
                      {returnOrderId ? (
                        <Link className="underline" to={`/orders/${returnOrderId}`}>
                          {returnOrderLabel || returnOrderId}
                        </Link>
                      ) : (
                        '-'
                      )}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-white/70 px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                      Status
                    </div>
                    <div className="mt-2 text-sm text-ldc-ink">
                      <StatusBadge value={record?.status || 'pending'} />
                    </div>
                  </div>
                  <div className="rounded-2xl bg-white/70 px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                      Refund
                    </div>
                    <div className="mt-2 text-sm text-ldc-ink">
                      {formatMoneyOrDash(returnRefundAmount, orderCurrency)}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-white/70 px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                      Return shipping
                    </div>
                    <div className="mt-2 text-sm text-ldc-ink">
                      {returnShippingLabel || '—'}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-white/70 px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                      Created
                    </div>
                    <div className="mt-2 text-sm text-ldc-ink">
                      {record?.created_at ? formatDateTime(record.created_at) : '—'}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-white/70 px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                      Updated
                    </div>
                    <div className="mt-2 text-sm text-ldc-ink">
                      {record?.updated_at ? formatDateTime(record.updated_at) : '—'}
                    </div>
                  </div>
                </div>
                {linkedOrderLoading ? (
                  <div className="mt-3 text-xs text-ldc-ink/60">Loading order details...</div>
                ) : null}
                {linkedOrderError ? (
                  <div className="mt-3 text-sm text-rose-600">{linkedOrderError}</div>
                ) : null}
              </div>

              <div className="ldc-card p-6">
                <h3 className="font-heading text-xl text-ldc-ink">Return Items</h3>
                <p className="mt-2 text-sm text-ldc-ink/70">
                  Requested items and quantities for this return.
                </p>
                <div className="mt-4">
                  <DataTable
                    columns={returnItemColumns}
                    rows={returnItemRows}
                    getRowId={(row) => row.id}
                    isLoading={false}
                    emptyText="No return items recorded yet."
                  />
                </div>
              </div>

              <div className="ldc-card p-6">
                <h3 className="font-heading text-xl text-ldc-ink">Return Workflow</h3>
                <p className="mt-2 text-sm text-ldc-ink/70">
                  Request items and confirm receipt as they come back.
                </p>
                {returnReasonsError ? (
                  <div className="mt-3 text-sm text-rose-600">{returnReasonsError}</div>
                ) : null}
                {returnReasonsLoading ? (
                  <div className="mt-2 text-xs text-ldc-ink/60">Loading return reasons...</div>
                ) : null}
                {returnState.error ? (
                  <div className="mt-3 text-sm text-rose-600">{returnState.error}</div>
                ) : null}
                {returnState.success ? (
                  <div className="mt-3 text-sm text-emerald-700">{returnState.success}</div>
                ) : null}

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Description
                    <input
                      className="ldc-input mt-2"
                      value={returnDraft.description}
                      onChange={handleReturnDraftChange('description')}
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Internal note
                    <input
                      className="ldc-input mt-2"
                      value={returnDraft.internal_note}
                      onChange={handleReturnDraftChange('internal_note')}
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-ldc-plum"
                      checked={returnDraft.notify_customer}
                      onChange={handleReturnDraftToggle}
                    />
                    Notify customer
                  </label>
                </div>

                <div className="mt-6">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                    Request items
                  </div>
                  <div className="mt-3 space-y-3">
                    {returnItemSource.length ? (
                      returnItemSource.map((item) => {
                        const itemId = getOrderItemId(item);
                        if (!itemId) return null;
                        const line = getReturnItemLine(item);
                        const entry = returnRequestDraft[itemId] || { quantity: 0, reason_id: '' };
                        return (
                          <div key={itemId} className="rounded-2xl bg-white/80 p-3">
                            <div className="text-sm font-semibold text-ldc-ink">
                              {getLineItemTitle(line)}
                            </div>
                            <div className="mt-1 text-xs text-ldc-ink/60">
                              SKU: {getReturnItemSku(item)}
                            </div>
                            <div className="mt-2 grid gap-3 md:grid-cols-2">
                              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                                Quantity
                                <input
                                  className="ldc-input mt-2"
                                  type="number"
                                  min="0"
                                  max={line?.quantity ?? undefined}
                                  value={entry.quantity ?? ''}
                                  onChange={handleReturnRequestItemChange(record.id, itemId, 'quantity')}
                                />
                              </label>
                              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                                Reason
                                <select
                                  className="ldc-input mt-2"
                                  value={entry.reason_id || ''}
                                  onChange={handleReturnRequestItemChange(record.id, itemId, 'reason_id')}
                                >
                                  <option value="">Select reason</option>
                                  {returnReasons.map((reason) => (
                                    <option key={reason.id} value={reason.id}>
                                      {reason.label || reason.value || reason.id}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-sm text-ldc-ink/60">No items available.</p>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button
                      className="ldc-button-primary"
                      type="button"
                      onClick={() => handleRequestReturnItems(record.id)}
                      disabled={returnIsBusy}
                    >
                      {returnIsBusy ? 'Saving...' : 'Request items'}
                    </button>
                    <button
                      className="ldc-button-secondary"
                      type="button"
                      onClick={() => handleConfirmReturnRequest(record.id)}
                      disabled={returnIsBusy}
                    >
                      Confirm request
                    </button>
                  </div>
                </div>

                <div className="mt-6">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                    Receive items
                  </div>
                  <div className="mt-3 space-y-3">
                    {returnItemSource.length ? (
                      returnItemSource.map((item) => {
                        const itemId = getOrderItemId(item);
                        if (!itemId) return null;
                        const line = getReturnItemLine(item);
                        const quantity = returnReceiveDraft[itemId] ?? '';
                        return (
                          <div key={itemId} className="rounded-2xl bg-white/80 p-3">
                            <div className="text-sm font-semibold text-ldc-ink">
                              {getLineItemTitle(line)}
                            </div>
                            <div className="mt-1 text-xs text-ldc-ink/60">
                              SKU: {getReturnItemSku(item)}
                            </div>
                            <label className="mt-2 block text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                              Quantity received
                              <input
                                className="ldc-input mt-2"
                                type="number"
                                min="0"
                                max={line?.quantity ?? undefined}
                                value={quantity}
                                onChange={handleReturnReceiveItemChange(record.id, itemId)}
                              />
                            </label>
                          </div>
                        );
                      })
                    ) : (
                      <p className="text-sm text-ldc-ink/60">No items available.</p>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button
                      className="ldc-button-secondary"
                      type="button"
                      onClick={() => handleStartReturnReceive(record.id)}
                      disabled={returnIsBusy}
                    >
                      Start receiving
                    </button>
                    <button
                      className="ldc-button-primary"
                      type="button"
                      onClick={() => handleReceiveReturnItems(record.id)}
                      disabled={returnIsBusy}
                    >
                      Receive items
                    </button>
                    <button
                      className="ldc-button-secondary"
                      type="button"
                      onClick={() => handleConfirmReturnReceive(record.id)}
                      disabled={returnIsBusy}
                    >
                      Confirm receipt
                    </button>
                  </div>
                </div>

                <div className="mt-4">
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={() => handleCancelReturn(record.id)}
                    disabled={returnIsBusy}
                  >
                    Cancel return
                  </button>
                </div>
              </div>
            </>
          ) : null}

          {isExchange ? renderExchangeWorkflow(false) : null}

          {isProduct && productDraft ? (
            <div className="ldc-card p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="font-heading text-xl text-ldc-ink">Product Profile</h3>
                  <p className="mt-2 text-sm text-ldc-ink/70">
                    Edit core product details, merchandising, and channel visibility.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={handleResetProduct}
                    disabled={saveState.saving}
                  >
                    Reset
                  </button>
                  <button
                    className="ldc-button-primary"
                    type="button"
                    onClick={handleSaveProduct}
                    disabled={saveState.saving}
                  >
                    {saveState.saving ? 'Saving...' : 'Save changes'}
                  </button>
                </div>
              </div>

              {saveState.error ? (
                <div className="mt-3 text-sm text-rose-600">{saveState.error}</div>
              ) : null}
              {saveState.success ? (
                <div className="mt-3 text-sm text-emerald-700">{saveState.success}</div>
              ) : null}
              {metaLoading ? (
                <div className="mt-3 text-sm text-ldc-ink/60">Loading product metadata...</div>
              ) : null}
              {metaError ? <div className="mt-2 text-sm text-rose-600">{metaError}</div> : null}

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Title
                  <input
                    className="ldc-input mt-2"
                    value={productDraft.title}
                    onChange={handleDraftField('title')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Status
                  <select
                    className="ldc-input mt-2"
                    value={productDraft.status}
                    onChange={handleDraftField('status')}
                  >
                    {PRODUCT_STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Handle
                  <input
                    className="ldc-input mt-2"
                    value={productDraft.handle}
                    onChange={handleDraftField('handle')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Subtitle
                  <input
                    className="ldc-input mt-2"
                    value={productDraft.subtitle}
                    onChange={handleDraftField('subtitle')}
                  />
                </label>
              </div>

              <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                Description
                <textarea
                  className="ldc-input mt-2 min-h-[120px]"
                  value={productDraft.description}
                  onChange={handleDraftField('description')}
                />
              </label>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Thumbnail URL
                  <input
                    className="ldc-input mt-2"
                    value={productDraft.thumbnail}
                    onChange={handleDraftField('thumbnail')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Upload thumbnail
                  <input
                    className="mt-2 block w-full text-sm text-ldc-ink/70"
                    type="file"
                    accept="image/*"
                    onChange={handleProductThumbnailUpload}
                    disabled={productUploadState.uploading}
                  />
                </label>
              </div>
              {productUploadState.error ? (
                <div className="mt-2 text-sm text-rose-600">{productUploadState.error}</div>
              ) : null}
              {productUploadState.success ? (
                <div className="mt-2 text-sm text-emerald-700">{productUploadState.success}</div>
              ) : null}

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Collection
                  <select
                    className="ldc-input mt-2"
                    value={productDraft.collection_id}
                    onChange={handleDraftField('collection_id')}
                  >
                    <option value="">No collection</option>
                    {productMeta.collections.map((collection) => (
                      <option key={collection.id} value={collection.id}>
                        {collection.title || collection.handle || collection.id}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Product type
                  <select
                    className="ldc-input mt-2"
                    value={productDraft.type_id}
                    onChange={handleDraftField('type_id')}
                  >
                    <option value="">No type</option>
                    {productMeta.types.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.value || type.name || type.id}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-ldc-plum"
                    checked={productDraft.discountable}
                    onChange={handleDraftToggle('discountable')}
                  />
                  Discountable
                </label>
                <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-ldc-plum"
                    checked={productDraft.is_giftcard}
                    onChange={handleDraftToggle('is_giftcard')}
                  />
                  Gift card
                </label>
              </div>

              <div className="mt-6">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                  Sales channels
                </div>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  {productMeta.salesChannels.length ? (
                    productMeta.salesChannels.map((channel) => (
                      <label
                        key={channel.id}
                        className="flex items-center gap-2 rounded-2xl border border-white/70 bg-white/70 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/70"
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-ldc-plum"
                          checked={productDraft.sales_channel_ids.includes(channel.id)}
                          onChange={() => toggleDraftSelection('sales_channel_ids', channel.id)}
                        />
                        {channel.name || channel.id}
                      </label>
                    ))
                  ) : (
                    <p className="text-sm text-ldc-ink/60">No sales channels available.</p>
                  )}
                </div>
              </div>

              <div className="mt-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                    Tags
                  </div>
                  <form className="flex items-center gap-2" onSubmit={handleCreateTag}>
                    <input
                      className="ldc-input h-10 w-48"
                      value={tagInput}
                      onChange={(event) => setTagInput(event.target.value)}
                      placeholder="Add a tag..."
                    />
                    <button
                      className="ldc-button-secondary"
                      type="submit"
                      disabled={tagSaving}
                    >
                      {tagSaving ? 'Adding...' : 'Add tag'}
                    </button>
                  </form>
                </div>
                {tagError ? <div className="mt-2 text-sm text-rose-600">{tagError}</div> : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  {productMeta.tags.length ? (
                    productMeta.tags.map((tag) => (
                      <label
                        key={tag.id}
                        className="flex items-center gap-2 rounded-full border border-white/70 bg-white/70 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/70"
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-ldc-plum"
                          checked={productDraft.tag_ids.includes(tag.id)}
                          onChange={() => toggleDraftSelection('tag_ids', tag.id)}
                        />
                        {tag.value || tag.id}
                      </label>
                    ))
                  ) : (
                    <p className="text-sm text-ldc-ink/60">No tags available yet.</p>
                  )}
                </div>
              </div>

              <div className="mt-6">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                  Categories
                </div>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  {productMeta.categories.length ? (
                    productMeta.categories.map((category) => (
                      <label
                        key={category.id}
                        className="flex items-center gap-2 rounded-2xl border border-white/70 bg-white/70 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/70"
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-ldc-plum"
                          checked={productDraft.category_ids.includes(category.id)}
                          onChange={() => toggleDraftSelection('category_ids', category.id)}
                        />
                        {category.name || category.handle || category.id}
                      </label>
                    ))
                  ) : (
                    <p className="text-sm text-ldc-ink/60">No categories available yet.</p>
                  )}
                </div>
              </div>

              <div className="mt-6">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                  Shipping & Identifiers
                </div>
                <div className="mt-2 grid gap-4 md:grid-cols-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Shipping profile
                    {productMeta.shippingProfiles.length ? (
                      <select
                        className="ldc-input mt-2"
                        value={productDraft.shipping_profile_id}
                        onChange={handleDraftField('shipping_profile_id')}
                      >
                        <option value="">Default profile</option>
                        {productMeta.shippingProfiles.map((profile) => (
                          <option key={profile.id} value={profile.id}>
                            {profile.name || profile.id}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="ldc-input mt-2"
                        value={productDraft.shipping_profile_id}
                        onChange={handleDraftField('shipping_profile_id')}
                        placeholder="profile id"
                      />
                    )}
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    External ID
                    <input
                      className="ldc-input mt-2"
                      value={productDraft.external_id}
                      onChange={handleDraftField('external_id')}
                    />
                  </label>
                </div>
              </div>

              <div className="mt-6">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                  Attributes
                </div>
                <div className="mt-2 grid gap-4 md:grid-cols-4">
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Weight
                    <input
                      className="ldc-input mt-2"
                      type="number"
                      step="0.01"
                      min="0"
                      value={productDraft.weight}
                      onChange={handleDraftField('weight')}
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Length
                    <input
                      className="ldc-input mt-2"
                      type="number"
                      step="0.01"
                      min="0"
                      value={productDraft.length}
                      onChange={handleDraftField('length')}
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Width
                    <input
                      className="ldc-input mt-2"
                      type="number"
                      step="0.01"
                      min="0"
                      value={productDraft.width}
                      onChange={handleDraftField('width')}
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Height
                    <input
                      className="ldc-input mt-2"
                      type="number"
                      step="0.01"
                      min="0"
                      value={productDraft.height}
                      onChange={handleDraftField('height')}
                    />
                  </label>
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    HS code
                    <input
                      className="ldc-input mt-2"
                      value={productDraft.hs_code}
                      onChange={handleDraftField('hs_code')}
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    MID code
                    <input
                      className="ldc-input mt-2"
                      value={productDraft.mid_code}
                      onChange={handleDraftField('mid_code')}
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Origin country
                    <input
                      className="ldc-input mt-2"
                      value={productDraft.origin_country}
                      onChange={handleDraftField('origin_country')}
                      placeholder="US"
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Material
                    <input
                      className="ldc-input mt-2"
                      value={productDraft.material}
                      onChange={handleDraftField('material')}
                    />
                  </label>
                </div>
              </div>

              <label className="mt-6 block text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                Metadata (JSON)
                <textarea
                  className="ldc-input mt-2 min-h-[110px] font-mono text-xs"
                  value={productDraft.metadata}
                  onChange={handleDraftField('metadata')}
                />
              </label>
            </div>
          ) : null}

          {isProduct ? (
            <div className="ldc-card p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="font-heading text-xl text-ldc-ink">Options</h3>
                  <p className="mt-2 text-sm text-ldc-ink/70">
                    Define option sets used to build product variants.
                  </p>
                </div>
              </div>

              {optionError ? <div className="mt-3 text-sm text-rose-600">{optionError}</div> : null}
              {optionMessage ? (
                <div className="mt-3 text-sm text-emerald-700">{optionMessage}</div>
              ) : null}

              <div className="mt-4 space-y-4">
                {optionDrafts.length ? (
                  optionDrafts.map((option) => (
                    <div key={option.id} className="rounded-2xl bg-white/70 p-4">
                      <div className="grid gap-3 md:grid-cols-[1.2fr_1.4fr_auto]">
                        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                          Option title
                          <input
                            className="ldc-input mt-2"
                            value={option.title}
                            onChange={handleOptionDraftChange(option.id, 'title')}
                          />
                        </label>
                        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                          Values (comma separated)
                          <input
                            className="ldc-input mt-2"
                            value={option.values}
                            onChange={handleOptionDraftChange(option.id, 'values')}
                          />
                        </label>
                        <div className="flex items-end gap-2">
                          <button
                            className="ldc-button-secondary"
                            type="button"
                            onClick={() => handleSaveOption(option)}
                            disabled={optionSavingId === option.id}
                          >
                            {optionSavingId === option.id ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            className="ldc-button-secondary"
                            type="button"
                            onClick={() => handleDeleteOption(option)}
                            disabled={optionDeletingId === option.id}
                          >
                            {optionDeletingId === option.id ? 'Removing...' : 'Remove'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-ldc-ink/60">No options yet.</p>
                )}
              </div>

              <form className="mt-6 rounded-2xl bg-white/70 p-4" onSubmit={handleCreateOption}>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                  Add option
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-[1.2fr_1.4fr_auto]">
                  <input
                    className="ldc-input"
                    placeholder="Option title"
                    value={newOption.title}
                    onChange={(event) =>
                      setNewOption((prev) => ({ ...prev, title: event.target.value }))
                    }
                  />
                  <input
                    className="ldc-input"
                    placeholder="Values (comma separated)"
                    value={newOption.values}
                    onChange={(event) =>
                      setNewOption((prev) => ({ ...prev, values: event.target.value }))
                    }
                  />
                  <button
                    className="ldc-button-primary"
                    type="submit"
                    disabled={optionSavingId === 'new'}
                  >
                    {optionSavingId === 'new' ? 'Adding...' : 'Add'}
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {imageUrls.length ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">Product Imagery</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                LDC product thumbnails and gallery images.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {imageUrls.map((url, index) => {
                  const isCurrentThumbnail = productDraft?.thumbnail === url;
                  return (
                  <div
                    key={`${url}-${index}`}
                    className="rounded-3xl bg-white/70 p-3 shadow-glow"
                  >
                    <img
                      src={url}
                      alt={record?.title || record?.name || `Image ${index + 1}`}
                      className="h-40 w-full rounded-2xl object-cover"
                      loading="lazy"
                    />
                    <div className="mt-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                      Image {index + 1}
                    </div>
                    <button
                      type="button"
                      className="mt-2 inline-flex items-center rounded-full border border-white/70 bg-white/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-ldc-ink/70 transition hover:text-ldc-plum disabled:cursor-default disabled:text-ldc-ink/40"
                      onClick={() =>
                        setProductDraft((prev) => (prev ? { ...prev, thumbnail: url } : prev))
                      }
                      disabled={isCurrentThumbnail}
                    >
                      {isCurrentThumbnail ? 'Current thumbnail' : 'Set as thumbnail'}
                    </button>
                  </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {isProduct ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">Variants</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Review variant options, inventory settings, and SKUs.
              </p>
              <div className="mt-4">
                <DataTable
                  columns={variantColumns}
                  rows={variantRows}
                  getRowId={(row) => row.id}
                  onRowClick={(row) => row?.id && navigate(`/variants/${row.id}`)}
                  isLoading={false}
                  emptyText="No variants available for this product."
                />
              </div>
            </div>
          ) : null}

          {isProduct || isVariant ? (
            <div className="ldc-card p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="font-heading text-xl text-ldc-ink">{variantEditorTitle}</h3>
                  <p className="mt-2 text-sm text-ldc-ink/70">{variantEditorSubtitle}</p>
                </div>
              </div>

              {variantError ? <div className="mt-3 text-sm text-rose-600">{variantError}</div> : null}
              {variantMessage ? (
                <div className="mt-3 text-sm text-emerald-700">{variantMessage}</div>
              ) : null}
              {variantUploadState.error ? (
                <div className="mt-3 text-sm text-rose-600">{variantUploadState.error}</div>
              ) : null}
              {variantUploadState.success ? (
                <div className="mt-3 text-sm text-emerald-700">{variantUploadState.success}</div>
              ) : null}
              {isVariant && variantProductError ? (
                <div className="mt-3 text-sm text-rose-600">{variantProductError}</div>
              ) : null}

              <div className="mt-4 space-y-4">
                {variantDrafts.length ? (
                  variantDrafts.map((variant) => (
                    <div key={variant.id} className="rounded-2xl bg-white/70 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-ldc-ink">
                            {variant.title || 'Untitled variant'}
                          </div>
                          <div className="text-xs text-ldc-ink/60">
                            {variant.sku || 'No SKU'}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            className="ldc-button-secondary"
                            type="button"
                            onClick={() => handleSaveVariant(variant)}
                            disabled={variantSavingId === variant.id}
                          >
                            {variantSavingId === variant.id ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            className="ldc-button-secondary"
                            type="button"
                            onClick={() => handleDeleteVariant(variant)}
                            disabled={variantDeletingId === variant.id}
                          >
                            {variantDeletingId === variant.id ? 'Removing...' : 'Delete'}
                          </button>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                          Title
                          <input
                            className="ldc-input mt-2"
                            value={variant.title}
                            onChange={handleVariantFieldChange(variant.id, 'title')}
                          />
                        </label>
                        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                          SKU
                          <input
                            className="ldc-input mt-2"
                            value={variant.sku}
                            onChange={handleVariantFieldChange(variant.id, 'sku')}
                          />
                        </label>
                        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                          Thumbnail URL
                          <input
                            className="ldc-input mt-2"
                            value={variant.thumbnail}
                            onChange={handleVariantFieldChange(variant.id, 'thumbnail')}
                          />
                        </label>
                        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                          Upload thumbnail
                          <input
                            className="mt-2 block w-full text-sm text-ldc-ink/70"
                            type="file"
                            accept="image/*"
                            onChange={handleVariantThumbnailUpload(variant.id)}
                            disabled={variantUploadState.uploadingId === variant.id}
                          />
                        </label>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-4">
                        <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-ldc-plum"
                            checked={variant.manage_inventory}
                            onChange={handleVariantToggle(variant.id, 'manage_inventory')}
                          />
                          Track inventory
                        </label>
                        <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-ldc-plum"
                            checked={variant.allow_backorder}
                            onChange={handleVariantToggle(variant.id, 'allow_backorder')}
                          />
                          Allow backorder
                        </label>
                      </div>

                      <div className="mt-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                          Identifiers & Attributes
                        </div>
                        <div className="mt-2 grid gap-3 md:grid-cols-3">
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Barcode
                            <input
                              className="ldc-input mt-2"
                              value={variant.barcode}
                              onChange={handleVariantFieldChange(variant.id, 'barcode')}
                            />
                          </label>
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            EAN
                            <input
                              className="ldc-input mt-2"
                              value={variant.ean}
                              onChange={handleVariantFieldChange(variant.id, 'ean')}
                            />
                          </label>
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            UPC
                            <input
                              className="ldc-input mt-2"
                              value={variant.upc}
                              onChange={handleVariantFieldChange(variant.id, 'upc')}
                            />
                          </label>
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            HS code
                            <input
                              className="ldc-input mt-2"
                              value={variant.hs_code}
                              onChange={handleVariantFieldChange(variant.id, 'hs_code')}
                            />
                          </label>
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            MID code
                            <input
                              className="ldc-input mt-2"
                              value={variant.mid_code}
                              onChange={handleVariantFieldChange(variant.id, 'mid_code')}
                            />
                          </label>
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Origin country
                            <input
                              className="ldc-input mt-2"
                              value={variant.origin_country}
                              onChange={handleVariantFieldChange(variant.id, 'origin_country')}
                              placeholder="US"
                            />
                          </label>
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Material
                            <input
                              className="ldc-input mt-2"
                              value={variant.material}
                              onChange={handleVariantFieldChange(variant.id, 'material')}
                            />
                          </label>
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-4">
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Weight
                            <input
                              className="ldc-input mt-2"
                              type="number"
                              step="0.01"
                              min="0"
                              value={variant.weight}
                              onChange={handleVariantFieldChange(variant.id, 'weight')}
                            />
                          </label>
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Length
                            <input
                              className="ldc-input mt-2"
                              type="number"
                              step="0.01"
                              min="0"
                              value={variant.length}
                              onChange={handleVariantFieldChange(variant.id, 'length')}
                            />
                          </label>
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Width
                            <input
                              className="ldc-input mt-2"
                              type="number"
                              step="0.01"
                              min="0"
                              value={variant.width}
                              onChange={handleVariantFieldChange(variant.id, 'width')}
                            />
                          </label>
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Height
                            <input
                              className="ldc-input mt-2"
                              type="number"
                              step="0.01"
                              min="0"
                              value={variant.height}
                              onChange={handleVariantFieldChange(variant.id, 'height')}
                            />
                          </label>
                        </div>
                        <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                          Metadata (JSON)
                          <textarea
                            className="ldc-input mt-2 min-h-[90px] font-mono text-xs"
                            value={variant.metadata}
                            onChange={handleVariantFieldChange(variant.id, 'metadata')}
                          />
                        </label>
                      </div>

                      {variantOptionList.length ? (
                        <div className="mt-4">
                          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                            Option values
                          </div>
                          <div className="mt-2 grid gap-3 md:grid-cols-2">
                            {variantOptionList.map((option) => (
                              <label
                                key={option.id}
                                className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60"
                              >
                                {option.title || 'Option'}
                                <input
                                  className="ldc-input mt-2"
                                  value={variant.options?.[option.id] || ''}
                                  onChange={handleVariantOptionChange(variant.id, option.id)}
                                />
                              </label>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <div className="mt-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                          Prices (major units)
                        </div>
                        <div className="mt-2 space-y-2">
                          {(variant.prices.length ? variant.prices : [{ currency_code: '', amount: '' }]).map(
                            (price, index) => (
                              <div key={`${variant.id}-price-${index}`} className="flex flex-wrap items-center gap-2">
                                <input
                                  className="ldc-input h-10 w-24"
                                  placeholder="USD"
                                  value={price.currency_code}
                                  onChange={handleVariantPriceChange(variant.id, index, 'currency_code')}
                                />
                                <input
                                  className="ldc-input h-10 w-32"
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  placeholder="0.00"
                                  value={price.amount}
                                  onChange={handleVariantPriceChange(variant.id, index, 'amount')}
                                />
                                <button
                                  className="ldc-button-secondary"
                                  type="button"
                                  onClick={() => handleRemoveVariantPrice(variant.id, index)}
                                  disabled={variant.prices.length <= 1}
                                >
                                  Remove
                                </button>
                              </div>
                            )
                          )}
                          <button
                            className="ldc-button-secondary"
                            type="button"
                            onClick={() => handleAddVariantPrice(variant.id)}
                          >
                            Add price
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-ldc-ink/60">No variants yet.</p>
                )}
              </div>

              {(isProduct || isVariant) && newVariant ? (
                <form className="mt-6 rounded-2xl bg-white/70 p-4" onSubmit={handleCreateVariant}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                      Add variant
                    </div>
                    <button
                      className="ldc-button-primary"
                      type="submit"
                      disabled={variantSavingId === 'new'}
                    >
                      {variantSavingId === 'new' ? 'Creating...' : 'Create variant'}
                    </button>
                  </div>

                  <div className="mt-3 grid gap-4 md:grid-cols-2">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                      Title
                      <input
                        className="ldc-input mt-2"
                        value={newVariant.title}
                        onChange={handleNewVariantField('title')}
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                      SKU
                      <input
                        className="ldc-input mt-2"
                        value={newVariant.sku}
                        onChange={handleNewVariantField('sku')}
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                      Thumbnail URL
                      <input
                        className="ldc-input mt-2"
                        value={newVariant.thumbnail}
                        onChange={handleNewVariantField('thumbnail')}
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                      Upload thumbnail
                      <input
                        className="mt-2 block w-full text-sm text-ldc-ink/70"
                        type="file"
                        accept="image/*"
                        onChange={handleVariantThumbnailUpload('new')}
                        disabled={variantUploadState.uploadingId === 'new'}
                      />
                    </label>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-4">
                    <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-ldc-plum"
                        checked={newVariant.manage_inventory}
                        onChange={handleNewVariantToggle('manage_inventory')}
                      />
                      Track inventory
                    </label>
                    <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-ldc-plum"
                        checked={newVariant.allow_backorder}
                        onChange={handleNewVariantToggle('allow_backorder')}
                      />
                      Allow backorder
                    </label>
                  </div>

                  <div className="mt-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                      Identifiers & Attributes
                    </div>
                    <div className="mt-2 grid gap-3 md:grid-cols-3">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                        Barcode
                        <input
                          className="ldc-input mt-2"
                          value={newVariant.barcode}
                          onChange={handleNewVariantField('barcode')}
                        />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                        EAN
                        <input
                          className="ldc-input mt-2"
                          value={newVariant.ean}
                          onChange={handleNewVariantField('ean')}
                        />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                        UPC
                        <input
                          className="ldc-input mt-2"
                          value={newVariant.upc}
                          onChange={handleNewVariantField('upc')}
                        />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                        HS code
                        <input
                          className="ldc-input mt-2"
                          value={newVariant.hs_code}
                          onChange={handleNewVariantField('hs_code')}
                        />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                        MID code
                        <input
                          className="ldc-input mt-2"
                          value={newVariant.mid_code}
                          onChange={handleNewVariantField('mid_code')}
                        />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                        Origin country
                        <input
                          className="ldc-input mt-2"
                          value={newVariant.origin_country}
                          onChange={handleNewVariantField('origin_country')}
                          placeholder="US"
                        />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                        Material
                        <input
                          className="ldc-input mt-2"
                          value={newVariant.material}
                          onChange={handleNewVariantField('material')}
                        />
                      </label>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-4">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                        Weight
                        <input
                          className="ldc-input mt-2"
                          type="number"
                          step="0.01"
                          min="0"
                          value={newVariant.weight}
                          onChange={handleNewVariantField('weight')}
                        />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                        Length
                        <input
                          className="ldc-input mt-2"
                          type="number"
                          step="0.01"
                          min="0"
                          value={newVariant.length}
                          onChange={handleNewVariantField('length')}
                        />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                        Width
                        <input
                          className="ldc-input mt-2"
                          type="number"
                          step="0.01"
                          min="0"
                          value={newVariant.width}
                          onChange={handleNewVariantField('width')}
                        />
                      </label>
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                        Height
                        <input
                          className="ldc-input mt-2"
                          type="number"
                          step="0.01"
                          min="0"
                          value={newVariant.height}
                          onChange={handleNewVariantField('height')}
                        />
                      </label>
                    </div>
                    <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                      Metadata (JSON)
                      <textarea
                        className="ldc-input mt-2 min-h-[90px] font-mono text-xs"
                        value={newVariant.metadata}
                        onChange={handleNewVariantField('metadata')}
                      />
                    </label>
                  </div>

                  {variantOptionList.length ? (
                    <div className="mt-4">
                      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                        Option values
                      </div>
                      <div className="mt-2 grid gap-3 md:grid-cols-2">
                        {variantOptionList.map((option) => (
                          <label
                            key={option.id}
                            className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60"
                          >
                            {option.title || 'Option'}
                            <input
                              className="ldc-input mt-2"
                              value={newVariant.options?.[option.id] || ''}
                              onChange={handleNewVariantOptionChange(option.id)}
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                      Prices (major units)
                    </div>
                    <div className="mt-2 space-y-2">
                      {newVariant.prices.map((price, index) => (
                        <div key={`new-variant-price-${index}`} className="flex flex-wrap items-center gap-2">
                          <input
                            className="ldc-input h-10 w-24"
                            placeholder="USD"
                            value={price.currency_code}
                            onChange={handleNewVariantPriceChange(index, 'currency_code')}
                          />
                          <input
                            className="ldc-input h-10 w-32"
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            value={price.amount}
                            onChange={handleNewVariantPriceChange(index, 'amount')}
                          />
                          <button
                            className="ldc-button-secondary"
                            type="button"
                            onClick={() => handleRemoveNewVariantPrice(index)}
                            disabled={newVariant.prices.length <= 1}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                      <button
                        className="ldc-button-secondary"
                        type="button"
                        onClick={handleAddNewVariantPrice}
                      >
                        Add price
                      </button>
                    </div>
                  </div>
                </form>
              ) : null}
            </div>
          ) : null}

          {isProduct ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">Pricing</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Variant price sets and currency coverage.
              </p>
              <div className="mt-4">
                <DataTable
                  columns={pricingColumns}
                  rows={priceRows}
                  getRowId={(row) => row.id}
                  isLoading={false}
                  emptyText="No prices found for this product."
                />
              </div>
            </div>
          ) : null}

          {isProduct ? (
            <div className="ldc-card p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-heading text-xl text-ldc-ink">Inventory</h3>
                  <p className="mt-2 text-sm text-ldc-ink/70">
                    Inventory tracking and backorder rules per variant.
                  </p>
                </div>
                {!hasInventoryCounts ? (
                  <span className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                    Counts managed in Inventory Items
                  </span>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                {inventoryLoading ? <span>Syncing inventory counts...</span> : null}
                {!inventoryLoading && inventoryError ? (
                  <span className="text-rose-600">{inventoryError}</span>
                ) : null}
                {!inventoryLoading && !inventoryError && inventoryMessage ? (
                  <span>{inventoryMessage}</span>
                ) : null}
                {inventoryCoverage.total ? (
                  <span>
                    Counts available for {inventoryCoverage.counted} of {inventoryCoverage.total} variants
                  </span>
                ) : null}
              </div>
              <div className="mt-4">
                <DataTable
                  columns={inventoryColumns}
                  rows={inventoryRows}
                  getRowId={(row) => row.id}
                  isLoading={false}
                  emptyText="No inventory data available."
                />
              </div>
              {!hasInventoryCounts ? (
                <p className="mt-3 text-sm text-ldc-ink/60">
                  Inventory quantities are not returned by this endpoint. Use the Inventory Items
                  section to review stock levels.
                </p>
              ) : null}
            </div>
          ) : null}

          {isInventoryItem ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">Inventory Item</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Update item attributes, shipping requirements, and metadata.
              </p>
              <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={handleSaveInventoryItem}>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Title
                  <input
                    className="ldc-input mt-2"
                    value={inventoryItemDraft.title}
                    onChange={handleInventoryItemDraftChange('title')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  SKU
                  <input
                    className="ldc-input mt-2"
                    value={inventoryItemDraft.sku}
                    onChange={handleInventoryItemDraftChange('sku')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Thumbnail URL
                  <input
                    className="ldc-input mt-2"
                    value={inventoryItemDraft.thumbnail}
                    onChange={handleInventoryItemDraftChange('thumbnail')}
                  />
                </label>
                <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-ldc-plum"
                    checked={inventoryItemDraft.requires_shipping}
                    onChange={handleInventoryItemDraftChange('requires_shipping')}
                  />
                  Requires shipping
                </label>
                <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Description
                  <textarea
                    className="ldc-input mt-2 min-h-[100px]"
                    value={inventoryItemDraft.description}
                    onChange={handleInventoryItemDraftChange('description')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Material
                  <input
                    className="ldc-input mt-2"
                    value={inventoryItemDraft.material}
                    onChange={handleInventoryItemDraftChange('material')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  HS Code
                  <input
                    className="ldc-input mt-2"
                    value={inventoryItemDraft.hs_code}
                    onChange={handleInventoryItemDraftChange('hs_code')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Origin country
                  <input
                    className="ldc-input mt-2"
                    value={inventoryItemDraft.origin_country}
                    onChange={handleInventoryItemDraftChange('origin_country')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  MID code
                  <input
                    className="ldc-input mt-2"
                    value={inventoryItemDraft.mid_code}
                    onChange={handleInventoryItemDraftChange('mid_code')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Weight
                  <input
                    className="ldc-input mt-2"
                    type="number"
                    step="0.01"
                    value={inventoryItemDraft.weight}
                    onChange={handleInventoryItemDraftChange('weight')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Length
                  <input
                    className="ldc-input mt-2"
                    type="number"
                    step="0.01"
                    value={inventoryItemDraft.length}
                    onChange={handleInventoryItemDraftChange('length')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Height
                  <input
                    className="ldc-input mt-2"
                    type="number"
                    step="0.01"
                    value={inventoryItemDraft.height}
                    onChange={handleInventoryItemDraftChange('height')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Width
                  <input
                    className="ldc-input mt-2"
                    type="number"
                    step="0.01"
                    value={inventoryItemDraft.width}
                    onChange={handleInventoryItemDraftChange('width')}
                  />
                </label>
                <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Metadata (optional)
                  <textarea
                    className="ldc-input mt-2 min-h-[90px] font-mono text-xs"
                    value={inventoryItemDraft.metadata}
                    onChange={handleInventoryItemDraftChange('metadata')}
                    placeholder='{"tag":"fragile"}'
                  />
                </label>
                {inventoryItemState.error ? (
                  <div className="md:col-span-2 text-sm text-rose-600">
                    {inventoryItemState.error}
                  </div>
                ) : null}
                {inventoryItemState.success ? (
                  <div className="md:col-span-2 text-sm text-emerald-700">
                    {inventoryItemState.success}
                  </div>
                ) : null}
                <div className="md:col-span-2 flex flex-wrap items-center gap-3">
                  <button
                    className="ldc-button-primary"
                    type="submit"
                    disabled={inventoryItemState.saving}
                  >
                    {inventoryItemState.saving ? 'Saving...' : 'Save item'}
                  </button>
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={handleDeleteInventoryItem}
                    disabled={inventoryItemState.deleting}
                  >
                    {inventoryItemState.deleting ? 'Deleting...' : 'Delete item'}
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {isInventoryItem ? (
            <div className="ldc-card p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-heading text-xl text-ldc-ink">Stock Levels</h3>
                  <p className="mt-2 text-sm text-ldc-ink/70">
                    Track stocked, reserved, incoming, and available quantities per location.
                  </p>
                </div>
                {inventoryMetaLoading ? (
                  <span className="text-xs text-ldc-ink/60">Loading locations...</span>
                ) : null}
              </div>
              {inventoryMetaError ? (
                <div className="mt-3 text-sm text-rose-600">{inventoryMetaError}</div>
              ) : null}
              {inventoryLevelState.error ? (
                <div className="mt-3 text-sm text-rose-600">{inventoryLevelState.error}</div>
              ) : null}
              {inventoryLevelState.success ? (
                <div className="mt-3 text-sm text-emerald-700">{inventoryLevelState.success}</div>
              ) : null}

              <div className="mt-4 space-y-4">
                {inventoryLevelRows.length ? (
                  inventoryLevelRows.map((level) => (
                    <div key={level.id} className="rounded-2xl bg-white/70 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                            Location
                          </div>
                          <div className="mt-1 text-sm text-ldc-ink">
                            {level.location_name}
                          </div>
                        </div>
                        <button
                          className="ldc-button-secondary"
                          type="button"
                          onClick={() => handleDeleteInventoryLevel(level.location_id)}
                          disabled={inventoryLevelState.deletingId === level.location_id}
                        >
                          {inventoryLevelState.deletingId === level.location_id
                            ? 'Removing...'
                            : 'Remove level'}
                        </button>
                      </div>
                      <div className="mt-4 grid gap-3 md:grid-cols-4">
                        <div className="rounded-2xl bg-white/70 px-3 py-2 text-sm text-ldc-ink">
                          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                            Stocked
                          </div>
                          <div className="mt-1">{level.stocked_quantity ?? 0}</div>
                        </div>
                        <div className="rounded-2xl bg-white/70 px-3 py-2 text-sm text-ldc-ink">
                          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                            Reserved
                          </div>
                          <div className="mt-1">{level.reserved_quantity ?? 0}</div>
                        </div>
                        <div className="rounded-2xl bg-white/70 px-3 py-2 text-sm text-ldc-ink">
                          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                            Incoming
                          </div>
                          <div className="mt-1">{level.incoming_quantity ?? 0}</div>
                        </div>
                        <div className="rounded-2xl bg-white/70 px-3 py-2 text-sm text-ldc-ink">
                          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                            Available
                          </div>
                          <div className="mt-1">{level.available_quantity ?? 0}</div>
                        </div>
                      </div>
                      <div className="mt-4 grid gap-3 md:grid-cols-3">
                        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                          Adjust stocked (+/-)
                          <input
                            className="ldc-input mt-2"
                            type="number"
                            step="1"
                            value={inventoryAdjustments[level.location_id]?.stocked_quantity || ''}
                            onChange={handleInventoryAdjustmentChange(
                              level.location_id,
                              'stocked_quantity'
                            )}
                          />
                        </label>
                        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                          Adjust incoming (+/-)
                          <input
                            className="ldc-input mt-2"
                            type="number"
                            step="1"
                            value={inventoryAdjustments[level.location_id]?.incoming_quantity || ''}
                            onChange={handleInventoryAdjustmentChange(
                              level.location_id,
                              'incoming_quantity'
                            )}
                          />
                        </label>
                        <div className="flex items-end">
                          <button
                            className="ldc-button-primary w-full"
                            type="button"
                            onClick={() => handleApplyInventoryAdjustment(level.location_id)}
                            disabled={inventoryLevelState.savingId === level.location_id}
                          >
                            {inventoryLevelState.savingId === level.location_id
                              ? 'Saving...'
                              : 'Apply adjustment'}
                          </button>
                        </div>
                      </div>
                      {level.updated_at ? (
                        <div className="mt-3 text-xs text-ldc-ink/60">
                          Updated {formatDateTime(level.updated_at)}
                        </div>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl bg-white/70 p-4 text-sm text-ldc-ink/70">
                    No stock levels created yet.
                  </div>
                )}
              </div>

              <div className="mt-6 rounded-3xl border border-white/80 bg-white/60 p-4">
                <h4 className="font-heading text-lg text-ldc-ink">Add location level</h4>
                <form className="mt-3 grid gap-3 md:grid-cols-3" onSubmit={handleCreateInventoryLevel}>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Location
                    {inventoryMeta.locations.length ? (
                      <select
                        className="ldc-input mt-2"
                        value={inventoryLevelDraft.location_id}
                        onChange={handleInventoryLevelDraftChange('location_id')}
                      >
                        <option value="">Select location</option>
                        {inventoryMeta.locations.map((location) => (
                          <option key={location.id} value={location.id}>
                            {location.name || location.id}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="ldc-input mt-2"
                        value={inventoryLevelDraft.location_id}
                        onChange={handleInventoryLevelDraftChange('location_id')}
                        placeholder="loc_..."
                      />
                    )}
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Stocked quantity
                    <input
                      className="ldc-input mt-2"
                      type="number"
                      step="1"
                      value={inventoryLevelDraft.stocked_quantity}
                      onChange={handleInventoryLevelDraftChange('stocked_quantity')}
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Incoming quantity
                    <input
                      className="ldc-input mt-2"
                      type="number"
                      step="1"
                      value={inventoryLevelDraft.incoming_quantity}
                      onChange={handleInventoryLevelDraftChange('incoming_quantity')}
                    />
                  </label>
                  <div className="md:col-span-3">
                    <button
                      className="ldc-button-primary"
                      type="submit"
                      disabled={inventoryLevelState.creating}
                    >
                      {inventoryLevelState.creating ? 'Adding...' : 'Add level'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : null}

          {isInventoryItem ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">Reservations</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Reserve inventory for pending orders or manual holds.
              </p>
              <form className="mt-4 grid gap-3 md:grid-cols-3" onSubmit={handleCreateInventoryReservation}>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Location
                  {inventoryMeta.locations.length ? (
                    <select
                      className="ldc-input mt-2"
                      value={inventoryReservationDraft.location_id}
                      onChange={handleInventoryReservationDraftChange('location_id')}
                    >
                      <option value="">Select location</option>
                      {inventoryMeta.locations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.name || location.id}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="ldc-input mt-2"
                      value={inventoryReservationDraft.location_id}
                      onChange={handleInventoryReservationDraftChange('location_id')}
                      placeholder="loc_..."
                    />
                  )}
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Quantity
                  <input
                    className="ldc-input mt-2"
                    type="number"
                    step="1"
                    value={inventoryReservationDraft.quantity}
                    onChange={handleInventoryReservationDraftChange('quantity')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Description
                  <input
                    className="ldc-input mt-2"
                    value={inventoryReservationDraft.description}
                    onChange={handleInventoryReservationDraftChange('description')}
                  />
                </label>
                <div className="md:col-span-3 flex flex-wrap items-center gap-3">
                  <button
                    className="ldc-button-primary"
                    type="submit"
                    disabled={inventoryReservationState.saving}
                  >
                    {inventoryReservationState.saving ? 'Saving...' : 'Create reservation'}
                  </button>
                  {inventoryReservationState.error ? (
                    <span className="text-sm text-rose-600">
                      {inventoryReservationState.error}
                    </span>
                  ) : null}
                  {inventoryReservationState.success ? (
                    <span className="text-sm text-emerald-700">
                      {inventoryReservationState.success}
                    </span>
                  ) : null}
                </div>
              </form>

              <div className="mt-5 space-y-3">
                {inventoryReservationsLoading ? (
                  <div className="text-sm text-ldc-ink/60">Loading reservations...</div>
                ) : null}
                {inventoryReservationsError ? (
                  <div className="text-sm text-rose-600">{inventoryReservationsError}</div>
                ) : null}
                {inventoryReservations.length ? (
                  inventoryReservations.map((reservation) => {
                    const locationName =
                      inventoryLocationMap.get(reservation.location_id)?.name ||
                      reservation.location_id ||
                      'Unknown';
                    return (
                      <div key={reservation.id} className="rounded-2xl bg-white/70 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                              {locationName}
                            </div>
                            <div className="mt-1 text-sm text-ldc-ink">
                              {reservation.quantity || 0} reserved
                            </div>
                          </div>
                          <button
                            className="ldc-button-secondary"
                            type="button"
                            onClick={() => handleDeleteInventoryReservation(reservation.id)}
                          >
                            Delete
                          </button>
                        </div>
                        <div className="mt-2 text-xs text-ldc-ink/60">
                          {reservation.description || 'No description'} · Created{' '}
                          {reservation.created_at ? formatDateTime(reservation.created_at) : '—'}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-2xl bg-white/70 p-4 text-sm text-ldc-ink/70">
                    No reservations yet.
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {isInventoryItem ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">Inventory Activity</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Recent stock updates and reservation changes.
              </p>
              <div className="mt-4 space-y-3">
                {inventoryActivity.length ? (
                  inventoryActivity.slice(0, 8).map((event) => (
                    <div key={event.id} className="rounded-2xl bg-white/70 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                            {event.type}
                          </div>
                          <div className="mt-1 text-sm text-ldc-ink">{event.detail}</div>
                        </div>
                        <div className="text-xs text-ldc-ink/60">
                          {event.timestamp ? formatDateTime(event.timestamp) : '—'}
                        </div>
                      </div>
                      <div className="mt-2 text-xs text-ldc-ink/50">
                        {event.location}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl bg-white/70 p-4 text-sm text-ldc-ink/70">
                    No activity yet.
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {isStockLocation ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">Stock Location</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Update the location name, address, and metadata.
              </p>
              <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={handleSaveStockLocation}>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Name
                  <input
                    className="ldc-input mt-2"
                    value={stockLocationDraft.name}
                    onChange={handleStockLocationDraftChange('name')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Address line 1
                  <input
                    className="ldc-input mt-2"
                    value={stockLocationDraft.address_1}
                    onChange={handleStockLocationDraftChange('address_1')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Address line 2
                  <input
                    className="ldc-input mt-2"
                    value={stockLocationDraft.address_2}
                    onChange={handleStockLocationDraftChange('address_2')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  City
                  <input
                    className="ldc-input mt-2"
                    value={stockLocationDraft.city}
                    onChange={handleStockLocationDraftChange('city')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Province
                  <input
                    className="ldc-input mt-2"
                    value={stockLocationDraft.province}
                    onChange={handleStockLocationDraftChange('province')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Postal code
                  <input
                    className="ldc-input mt-2"
                    value={stockLocationDraft.postal_code}
                    onChange={handleStockLocationDraftChange('postal_code')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Country code
                  <input
                    className="ldc-input mt-2"
                    value={stockLocationDraft.country_code}
                    onChange={handleStockLocationDraftChange('country_code')}
                    placeholder="US"
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Phone
                  <input
                    className="ldc-input mt-2"
                    value={stockLocationDraft.phone}
                    onChange={handleStockLocationDraftChange('phone')}
                  />
                </label>
                <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Metadata (optional)
                  <textarea
                    className="ldc-input mt-2 min-h-[90px] font-mono text-xs"
                    value={stockLocationDraft.metadata}
                    onChange={handleStockLocationDraftChange('metadata')}
                  />
                </label>
                {stockLocationState.error ? (
                  <div className="md:col-span-2 text-sm text-rose-600">
                    {stockLocationState.error}
                  </div>
                ) : null}
                {stockLocationState.success ? (
                  <div className="md:col-span-2 text-sm text-emerald-700">
                    {stockLocationState.success}
                  </div>
                ) : null}
                <div className="md:col-span-2 flex flex-wrap items-center gap-3">
                  <button
                    className="ldc-button-primary"
                    type="submit"
                    disabled={stockLocationState.saving}
                  >
                    {stockLocationState.saving ? 'Saving...' : 'Save location'}
                  </button>
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={handleDeleteStockLocation}
                    disabled={stockLocationState.deleting}
                  >
                    {stockLocationState.deleting ? 'Deleting...' : 'Delete location'}
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {isStockLocation ? (
            <div className="ldc-card p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-heading text-xl text-ldc-ink">Inventory at this location</h3>
                  <p className="mt-2 text-sm text-ldc-ink/70">
                    Review the stock levels for inventory items assigned to this location.
                  </p>
                </div>
                {record?.id ? (
                  <Link
                    className="ldc-button-secondary"
                    to={`/inventory?inventory_location_id=${record.id}`}
                  >
                    View all inventory
                  </Link>
                ) : null}
              </div>

              <form
                className="mt-4 flex flex-wrap items-center gap-2"
                onSubmit={handleStockLocationInventorySearch}
              >
                <input
                  className="ldc-input h-11 w-64"
                  value={stockLocationInventoryQuery}
                  onChange={handleStockLocationInventorySearchChange}
                  placeholder="Search inventory items..."
                />
                <button className="ldc-button-secondary" type="submit">
                  Search
                </button>
                {stockLocationInventorySearch ? (
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={handleClearStockLocationInventorySearch}
                  >
                    Clear
                  </button>
                ) : null}
                <div className="text-xs text-ldc-ink/60">
                  {stockLocationInventoryState.count
                    ? `${stockLocationInventoryState.count} item${
                        stockLocationInventoryState.count === 1 ? '' : 's'
                      }`
                    : null}
                </div>
              </form>

              {stockLocationInventoryState.error ? (
                <div className="mt-3 text-sm text-rose-600">
                  {stockLocationInventoryState.error}
                </div>
              ) : null}

              <div className="mt-4">
                <DataTable
                  columns={stockLocationInventoryColumns}
                  rows={stockLocationInventoryRows}
                  getRowId={(row) => row.id}
                  isLoading={stockLocationInventoryState.loading}
                  emptyText="No inventory items found for this location."
                />
              </div>
            </div>
          ) : null}

          {isStockLocation ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">Fulfillment Sets</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Define service zones and shipping reach for this location.
              </p>
              {fulfillmentSetState.error ? (
                <div className="mt-3 text-sm text-rose-600">{fulfillmentSetState.error}</div>
              ) : null}
              {fulfillmentSetState.success ? (
                <div className="mt-3 text-sm text-emerald-700">{fulfillmentSetState.success}</div>
              ) : null}
              {serviceZoneState.error ? (
                <div className="mt-3 text-sm text-rose-600">{serviceZoneState.error}</div>
              ) : null}
              {serviceZoneState.success ? (
                <div className="mt-3 text-sm text-emerald-700">{serviceZoneState.success}</div>
              ) : null}

              <div className="mt-4 space-y-4">
                {stockLocationFulfillmentSets.length ? (
                  stockLocationFulfillmentSets.map((set) => {
                    const serviceZones = Array.isArray(set?.service_zones) ? set.service_zones : [];
                    const createDraft = serviceZoneDrafts[set.id] || buildEmptyServiceZoneDraft();
                    return (
                      <div key={set.id} className="rounded-2xl bg-white/70 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-ldc-ink">
                              {set.name || set.id}
                            </div>
                            <div className="mt-1 text-xs text-ldc-ink/60">
                              Type: {set.type || 'delivery'}{' '}
                              {set.created_at ? `· Created ${formatDateTime(set.created_at)}` : ''}
                            </div>
                          </div>
                          <button
                            className="ldc-button-secondary"
                            type="button"
                            onClick={() => handleDeleteFulfillmentSet(set.id)}
                            disabled={fulfillmentSetState.deletingId === set.id}
                          >
                            {fulfillmentSetState.deletingId === set.id ? 'Deleting...' : 'Delete set'}
                          </button>
                        </div>

                        <div className="mt-4">
                          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                            Service zones
                          </div>
                          <div className="mt-3 space-y-3">
                            {serviceZones.length ? (
                              serviceZones.map((zone) => {
                                const editDraft = serviceZoneEdits[zone.id];
                                const isEditing = Boolean(editDraft);
                                const geoZones = Array.isArray(zone?.geo_zones) ? zone.geo_zones : [];
                                return (
                                  <div
                                    key={zone.id}
                                    className="rounded-2xl border border-white/70 bg-white/80 p-3"
                                  >
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                      <div>
                                        <div className="text-sm font-semibold text-ldc-ink">
                                          {zone.name || zone.id}
                                        </div>
                                        <div className="mt-1 text-xs text-ldc-ink/60">
                                          {geoZones.length
                                            ? `${geoZones.length} geo zone(s)`
                                            : 'No geo zones yet.'}
                                        </div>
                                      </div>
                                      <div className="flex flex-wrap items-center gap-2">
                                        {!isEditing ? (
                                          <button
                                            className="ldc-button-secondary"
                                            type="button"
                                            onClick={() => handleStartServiceZoneEdit(zone)}
                                          >
                                            Edit
                                          </button>
                                        ) : null}
                                        <button
                                          className="ldc-button-secondary"
                                          type="button"
                                          onClick={() => handleDeleteServiceZone(set.id, zone.id)}
                                          disabled={serviceZoneState.deletingId === zone.id}
                                        >
                                          {serviceZoneState.deletingId === zone.id
                                            ? 'Deleting...'
                                            : 'Delete'}
                                        </button>
                                      </div>
                                    </div>

                                    {isEditing ? (
                                      <div className="mt-3 space-y-3">
                                        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                                          Service zone name
                                          <input
                                            className="ldc-input mt-2"
                                            value={editDraft.name}
                                            onChange={handleServiceZoneEditChange(zone.id, 'name')}
                                          />
                                        </label>
                                        <div className="space-y-2">
                                          {(editDraft.geo_zones || []).map((geo, index) => {
                                            const geoType = geo.type || 'country';
                                            return (
                                              <div
                                                key={`${zone.id}-geo-${index}`}
                                                className="rounded-2xl bg-white/70 p-3"
                                              >
                                                <div className="grid gap-3 md:grid-cols-4">
                                                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                                                    Type
                                                    <select
                                                      className="ldc-input mt-2"
                                                      value={geoType}
                                                      onChange={handleServiceZoneEditGeoZoneChange(
                                                        zone.id,
                                                        index,
                                                        'type'
                                                      )}
                                                    >
                                                      {GEO_ZONE_TYPE_OPTIONS.map((option) => (
                                                        <option key={option.value} value={option.value}>
                                                          {option.label}
                                                        </option>
                                                      ))}
                                                    </select>
                                                  </label>
                                                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                                                    Country code
                                                    <input
                                                      className="ldc-input mt-2"
                                                      value={geo.country_code || ''}
                                                      onChange={handleServiceZoneEditGeoZoneChange(
                                                        zone.id,
                                                        index,
                                                        'country_code'
                                                      )}
                                                      placeholder="us"
                                                    />
                                                  </label>
                                                  {['province', 'city', 'zip'].includes(geoType) ? (
                                                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                                                      Province code
                                                      <input
                                                        className="ldc-input mt-2"
                                                        value={geo.province_code || ''}
                                                        onChange={handleServiceZoneEditGeoZoneChange(
                                                          zone.id,
                                                          index,
                                                          'province_code'
                                                        )}
                                                        placeholder="ca"
                                                      />
                                                    </label>
                                                  ) : null}
                                                  {['city', 'zip'].includes(geoType) ? (
                                                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                                                      City
                                                      <input
                                                        className="ldc-input mt-2"
                                                        value={geo.city || ''}
                                                        onChange={handleServiceZoneEditGeoZoneChange(
                                                          zone.id,
                                                          index,
                                                          'city'
                                                        )}
                                                        placeholder="Los Angeles"
                                                      />
                                                    </label>
                                                  ) : null}
                                                </div>
                                                {geoType === 'zip' ? (
                                                  <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                                                    Postal expression (JSON)
                                                    <textarea
                                                      className="ldc-input mt-2 min-h-[70px] font-mono text-xs"
                                                      value={geo.postal_expression || ''}
                                                      onChange={handleServiceZoneEditGeoZoneChange(
                                                        zone.id,
                                                        index,
                                                        'postal_expression'
                                                      )}
                                                      placeholder='{"starts_with":"90"}'
                                                    />
                                                  </label>
                                                ) : null}
                                                <div className="mt-3 flex justify-end">
                                                  <button
                                                    className="text-xs text-rose-600"
                                                    type="button"
                                                    onClick={() =>
                                                      handleRemoveServiceZoneEditGeoZone(zone.id, index)
                                                    }
                                                    disabled={(editDraft.geo_zones || []).length <= 1}
                                                  >
                                                    Remove geo zone
                                                  </button>
                                                </div>
                                              </div>
                                            );
                                          })}
                                          <button
                                            className="ldc-button-secondary"
                                            type="button"
                                            onClick={() => handleAddServiceZoneEditGeoZone(zone.id)}
                                          >
                                            Add geo zone
                                          </button>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-3">
                                          <button
                                            className="ldc-button-primary"
                                            type="button"
                                            onClick={() => handleSaveServiceZoneEdit(set.id, zone.id)}
                                            disabled={serviceZoneState.savingId === zone.id}
                                          >
                                            {serviceZoneState.savingId === zone.id
                                              ? 'Saving...'
                                              : 'Save changes'}
                                          </button>
                                          <button
                                            className="ldc-button-secondary"
                                            type="button"
                                            onClick={() => handleCancelServiceZoneEdit(zone.id)}
                                            disabled={serviceZoneState.savingId === zone.id}
                                          >
                                            Cancel
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="mt-3 space-y-1 text-xs text-ldc-ink/60">
                                        {geoZones.length ? (
                                          geoZones.map((geo, index) => (
                                            <div key={geo.id || `${zone.id}-geo-${index}`}>
                                              {formatGeoZoneSummary(geo)}
                                            </div>
                                          ))
                                        ) : (
                                          <div>No geo zones set.</div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })
                            ) : (
                              <div className="rounded-2xl bg-white/70 p-4 text-sm text-ldc-ink/70">
                                No service zones yet.
                              </div>
                            )}
                          </div>
                        </div>

                        <form
                          className="mt-4 rounded-2xl border border-white/70 bg-white/70 p-4"
                          onSubmit={(event) => {
                            event.preventDefault();
                            handleCreateServiceZone(set.id);
                          }}
                        >
                          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                            Add service zone
                          </div>
                          <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Service zone name
                            <input
                              className="ldc-input mt-2"
                              value={createDraft.name}
                              onChange={handleServiceZoneDraftChange(set.id, 'name')}
                            />
                          </label>
                          <div className="mt-3 space-y-2">
                            {(createDraft.geo_zones || []).map((geo, index) => {
                              const geoType = geo.type || 'country';
                              return (
                                <div
                                  key={`${set.id}-new-geo-${index}`}
                                  className="rounded-2xl bg-white/80 p-3"
                                >
                                  <div className="grid gap-3 md:grid-cols-4">
                                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                                      Type
                                      <select
                                        className="ldc-input mt-2"
                                        value={geoType}
                                        onChange={handleServiceZoneGeoZoneChange(
                                          set.id,
                                          index,
                                          'type'
                                        )}
                                      >
                                        {GEO_ZONE_TYPE_OPTIONS.map((option) => (
                                          <option key={option.value} value={option.value}>
                                            {option.label}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                                      Country code
                                      <input
                                        className="ldc-input mt-2"
                                        value={geo.country_code || ''}
                                        onChange={handleServiceZoneGeoZoneChange(
                                          set.id,
                                          index,
                                          'country_code'
                                        )}
                                        placeholder="us"
                                      />
                                    </label>
                                    {['province', 'city', 'zip'].includes(geoType) ? (
                                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                                        Province code
                                        <input
                                          className="ldc-input mt-2"
                                          value={geo.province_code || ''}
                                          onChange={handleServiceZoneGeoZoneChange(
                                            set.id,
                                            index,
                                            'province_code'
                                          )}
                                          placeholder="ca"
                                        />
                                      </label>
                                    ) : null}
                                    {['city', 'zip'].includes(geoType) ? (
                                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                                        City
                                        <input
                                          className="ldc-input mt-2"
                                          value={geo.city || ''}
                                          onChange={handleServiceZoneGeoZoneChange(
                                            set.id,
                                            index,
                                            'city'
                                          )}
                                          placeholder="Los Angeles"
                                        />
                                      </label>
                                    ) : null}
                                  </div>
                                  {geoType === 'zip' ? (
                                    <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                                      Postal expression (JSON)
                                      <textarea
                                        className="ldc-input mt-2 min-h-[70px] font-mono text-xs"
                                        value={geo.postal_expression || ''}
                                        onChange={handleServiceZoneGeoZoneChange(
                                          set.id,
                                          index,
                                          'postal_expression'
                                        )}
                                        placeholder='{"starts_with":"90"}'
                                      />
                                    </label>
                                  ) : null}
                                  <div className="mt-3 flex justify-end">
                                    <button
                                      className="text-xs text-rose-600"
                                      type="button"
                                      onClick={() => handleRemoveServiceZoneGeoZone(set.id, index)}
                                      disabled={(createDraft.geo_zones || []).length <= 1}
                                    >
                                      Remove geo zone
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                            <button
                              className="ldc-button-secondary"
                              type="button"
                              onClick={() => handleAddServiceZoneGeoZone(set.id)}
                            >
                              Add geo zone
                            </button>
                          </div>
                          <div className="mt-4 flex justify-end">
                            <button
                              className="ldc-button-primary"
                              type="submit"
                              disabled={serviceZoneState.savingId === set.id}
                            >
                              {serviceZoneState.savingId === set.id
                                ? 'Creating...'
                                : 'Create service zone'}
                            </button>
                          </div>
                        </form>
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-2xl bg-white/70 p-4 text-sm text-ldc-ink/70">
                    No fulfillment sets yet.
                  </div>
                )}
              </div>

              <div className="mt-6 rounded-3xl border border-white/70 bg-white/70 p-4">
                <h4 className="font-heading text-lg text-ldc-ink">Create fulfillment set</h4>
                <form className="mt-3 grid gap-3 md:grid-cols-2" onSubmit={handleCreateFulfillmentSet}>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Name
                    <input
                      className="ldc-input mt-2"
                      value={fulfillmentSetDraft.name}
                      onChange={handleFulfillmentSetDraftChange('name')}
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Type
                    <input
                      className="ldc-input mt-2"
                      value={fulfillmentSetDraft.type}
                      onChange={handleFulfillmentSetDraftChange('type')}
                      placeholder="delivery"
                    />
                  </label>
                  <div className="md:col-span-2">
                    <button
                      className="ldc-button-primary"
                      type="submit"
                      disabled={fulfillmentSetState.saving}
                    >
                      {fulfillmentSetState.saving ? 'Creating...' : 'Create fulfillment set'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : null}

          {isStockLocation ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">Sales Channels</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Control which channels can fulfill from this location.
              </p>
              {stockLocationMetaLoading ? (
                <div className="mt-3 text-sm text-ldc-ink/60">Loading channels...</div>
              ) : null}
              {stockLocationMetaError ? (
                <div className="mt-3 text-sm text-rose-600">{stockLocationMetaError}</div>
              ) : null}
              {locationSalesChannelState.error ? (
                <div className="mt-3 text-sm text-rose-600">{locationSalesChannelState.error}</div>
              ) : null}
              {locationSalesChannelState.success ? (
                <div className="mt-3 text-sm text-emerald-700">
                  {locationSalesChannelState.success}
                </div>
              ) : null}
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl bg-white/70 p-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                    Assigned
                  </div>
                  <div className="mt-3 space-y-2">
                    {stockLocationSalesChannels.length ? (
                      stockLocationSalesChannels.map((channel) => (
                        <div
                          key={channel.id}
                          className="flex items-start justify-between gap-2 text-xs text-ldc-ink"
                        >
                          <div>
                            <div className="font-semibold">
                              {channel.name || channel.id}
                            </div>
                            <div className="text-ldc-ink/60">{channel.id}</div>
                          </div>
                          <button
                            className="text-rose-600"
                            type="button"
                            onClick={() => handleRemoveStockLocationSalesChannel(channel.id)}
                            disabled={locationSalesChannelState.savingId === channel.id}
                          >
                            {locationSalesChannelState.savingId === channel.id
                              ? 'Removing...'
                              : 'Remove'}
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-ldc-ink/60">No channels assigned.</div>
                    )}
                  </div>
                </div>
                <div className="rounded-2xl bg-white/70 p-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                    Available
                  </div>
                  <div className="mt-3 space-y-2">
                    {availableStockLocationSalesChannels.length ? (
                      availableStockLocationSalesChannels.map((channel) => (
                        <div
                          key={channel.id}
                          className="flex items-start justify-between gap-2 text-xs text-ldc-ink"
                        >
                          <div>
                            <div className="font-semibold">
                              {channel.name || channel.id}
                            </div>
                            <div className="text-ldc-ink/60">{channel.id}</div>
                          </div>
                          <button
                            className="ldc-button-secondary"
                            type="button"
                            onClick={() => handleAddStockLocationSalesChannel(channel.id)}
                            disabled={locationSalesChannelState.savingId === channel.id}
                          >
                            {locationSalesChannelState.savingId === channel.id ? 'Adding...' : 'Add'}
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-ldc-ink/60">No channels available.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {isStockLocation ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">Fulfillment Providers</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Manage providers available for this location.
              </p>
              {stockLocationMetaLoading ? (
                <div className="mt-3 text-sm text-ldc-ink/60">Loading providers...</div>
              ) : null}
              {stockLocationMetaError ? (
                <div className="mt-3 text-sm text-rose-600">{stockLocationMetaError}</div>
              ) : null}
              {locationProviderState.error ? (
                <div className="mt-3 text-sm text-rose-600">{locationProviderState.error}</div>
              ) : null}
              {locationProviderState.success ? (
                <div className="mt-3 text-sm text-emerald-700">
                  {locationProviderState.success}
                </div>
              ) : null}
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl bg-white/70 p-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                    Assigned
                  </div>
                  <div className="mt-3 space-y-2">
                    {stockLocationFulfillmentProviders.length ? (
                      stockLocationFulfillmentProviders.map((provider) => (
                        <div
                          key={provider.id}
                          className="flex items-start justify-between gap-2 text-xs text-ldc-ink"
                        >
                          <div>
                            <div className="font-semibold">{provider.id}</div>
                            <div className="text-ldc-ink/60">
                              {provider.is_enabled ? 'Enabled' : 'Disabled'}
                            </div>
                          </div>
                          <button
                            className="text-rose-600"
                            type="button"
                            onClick={() => handleRemoveStockLocationFulfillmentProvider(provider.id)}
                            disabled={locationProviderState.savingId === provider.id}
                          >
                            {locationProviderState.savingId === provider.id
                              ? 'Removing...'
                              : 'Remove'}
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-ldc-ink/60">No providers assigned.</div>
                    )}
                  </div>
                </div>
                <div className="rounded-2xl bg-white/70 p-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                    Available
                  </div>
                  <div className="mt-3 space-y-2">
                    {availableStockLocationProviders.length ? (
                      availableStockLocationProviders.map((provider) => (
                        <div
                          key={provider.id}
                          className="flex items-start justify-between gap-2 text-xs text-ldc-ink"
                        >
                          <div>
                            <div className="font-semibold">{provider.id}</div>
                            <div className="text-ldc-ink/60">
                              {provider.is_enabled ? 'Enabled' : 'Disabled'}
                            </div>
                          </div>
                          <button
                            className="ldc-button-secondary"
                            type="button"
                            onClick={() => handleAddStockLocationFulfillmentProvider(provider.id)}
                            disabled={locationProviderState.savingId === provider.id}
                          >
                            {locationProviderState.savingId === provider.id ? 'Adding...' : 'Add'}
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-ldc-ink/60">No providers available.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {isCollection ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">Collection</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Update the collection details and imagery metadata.
              </p>
              <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={handleSaveCollection}>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Title
                  <input
                    className="ldc-input mt-2"
                    value={collectionDraft.title}
                    onChange={handleCollectionDraftChange('title')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Handle
                  <input
                    className="ldc-input mt-2"
                    value={collectionDraft.handle}
                    onChange={handleCollectionDraftChange('handle')}
                  />
                </label>
                <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Description (optional)
                  <textarea
                    className="ldc-input mt-2 min-h-[90px]"
                    value={collectionDraft.description}
                    onChange={handleCollectionDraftChange('description')}
                  />
                </label>
                <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Thumbnail URL (optional)
                  <input
                    className="ldc-input mt-2"
                    value={collectionDraft.thumbnail}
                    onChange={handleCollectionDraftChange('thumbnail')}
                    placeholder="https://..."
                  />
                </label>
                <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Upload thumbnail
                  <input
                    className="ldc-input mt-2"
                    type="file"
                    accept="image/*"
                    onChange={handleCollectionThumbnailUpload}
                    disabled={collectionUploadState.uploading}
                  />
                </label>
                <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Metadata (optional)
                  <textarea
                    className="ldc-input mt-2 min-h-[90px] font-mono text-xs"
                    value={collectionDraft.metadata}
                    onChange={handleCollectionDraftChange('metadata')}
                    placeholder='{"hero":"..."}'
                  />
                </label>
                {collectionState.error ? (
                  <div className="md:col-span-2 text-sm text-rose-600">
                    {collectionState.error}
                  </div>
                ) : null}
                {collectionUploadState.error ? (
                  <div className="md:col-span-2 text-sm text-rose-600">
                    {collectionUploadState.error}
                  </div>
                ) : null}
                {collectionState.success ? (
                  <div className="md:col-span-2 text-sm text-emerald-700">
                    {collectionState.success}
                  </div>
                ) : null}
                {collectionUploadState.success ? (
                  <div className="md:col-span-2 text-sm text-emerald-700">
                    {collectionUploadState.success}
                  </div>
                ) : null}
                <div className="md:col-span-2 flex flex-wrap items-center gap-3">
                  <button
                    className="ldc-button-primary"
                    type="submit"
                    disabled={collectionState.saving}
                  >
                    {collectionState.saving ? 'Saving...' : 'Save collection'}
                  </button>
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={handleDeleteCollection}
                    disabled={collectionState.deleting}
                  >
                    {collectionState.deleting ? 'Deleting...' : 'Delete collection'}
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {isCollection ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">Collection Products</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Assign products to this collection and remove them as needed.
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Search products
                  <input
                    className="ldc-input mt-2"
                    value={collectionProductSearch.query}
                    onChange={handleCollectionProductSearchChange}
                    placeholder="Search by title or handle"
                  />
                </label>
                <div className="rounded-2xl bg-white/80 p-3 text-xs text-ldc-ink/60">
                  {collectionProductCount
                    ? `${collectionProductCount} product(s) in this collection.`
                    : 'No products assigned yet.'}
                </div>
              </div>

              {collectionProductSearch.loading ? (
                <div className="mt-2 text-sm text-ldc-ink/60">Searching products...</div>
              ) : null}
              {collectionProductSearch.error ? (
                <div className="mt-2 text-sm text-rose-600">{collectionProductSearch.error}</div>
              ) : null}
              {collectionProductSearch.results.length ? (
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {collectionProductSearch.results.map((product) => {
                    const assigned = collectionProducts.some((item) => item.id === product.id);
                    const selected = collectionSelection.search.includes(product.id);
                    return (
                      <div
                        key={product.id}
                        className="flex items-start gap-3 rounded-2xl border border-white/70 bg-white/70 px-3 py-2 text-xs text-ldc-ink"
                      >
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 accent-ldc-plum"
                          checked={selected}
                          disabled={assigned}
                          onChange={() => handleToggleCollectionSelection('search', product.id)}
                        />
                        <div className="flex-1">
                          <div className="font-semibold">
                            {product.title || product.handle || product.id}
                          </div>
                          <div className="text-ldc-ink/60">Handle {product.handle || '-'}</div>
                        </div>
                        <button
                          className="ldc-button-secondary"
                          type="button"
                          disabled={
                            assigned ||
                            collectionProductState.savingId === product.id ||
                            collectionBulkState.saving
                          }
                          onClick={() => handleAssignCollectionProduct(product)}
                        >
                          {assigned ? 'Assigned' : 'Add'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <button
                  className="ldc-button-secondary"
                  type="button"
                  onClick={() =>
                    handleSelectAllCollectionSearch(
                      collectionProductSearch.results
                        .filter((product) => !collectionProducts.some((item) => item.id === product.id))
                        .map((product) => product.id)
                    )
                  }
                  disabled={!collectionProductSearch.results.length}
                >
                  Select all results
                </button>
                <button
                  className="ldc-button-secondary"
                  type="button"
                  onClick={handleClearCollectionSearchSelection}
                  disabled={!collectionSelection.search.length}
                >
                  Clear selection
                </button>
                <button
                  className="ldc-button-primary"
                  type="button"
                  onClick={handleBulkAssignCollection}
                  disabled={collectionBulkState.saving || !collectionSelection.search.length}
                >
                  {collectionBulkState.saving ? 'Updating...' : 'Add selected'}
                </button>
              </div>

              <div className="mt-4 space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={() =>
                      handleSelectAllCollectionAssigned(collectionProducts.map((product) => product.id))
                    }
                    disabled={!collectionProducts.length}
                  >
                    Select all assigned
                  </button>
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={handleClearCollectionAssignedSelection}
                    disabled={!collectionSelection.assigned.length}
                  >
                    Clear selection
                  </button>
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={handleBulkRemoveCollection}
                    disabled={collectionBulkState.saving || !collectionSelection.assigned.length}
                  >
                    {collectionBulkState.saving ? 'Updating...' : 'Remove selected'}
                  </button>
                </div>
                {collectionProductLoading ? (
                  <div className="text-sm text-ldc-ink/60">Loading collection products...</div>
                ) : null}
                {collectionProducts.length ? (
                  collectionProducts.map((product) => (
                    <div
                      key={product.id}
                      className="flex items-start gap-3 rounded-2xl bg-white/70 px-3 py-2 text-xs text-ldc-ink"
                    >
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 accent-ldc-plum"
                        checked={collectionSelection.assigned.includes(product.id)}
                        onChange={() => handleToggleCollectionSelection('assigned', product.id)}
                      />
                      <div className="flex-1">
                        <div className="font-semibold">
                          {product.title || product.handle || product.id}
                        </div>
                        <div className="text-ldc-ink/60">Handle {product.handle || '-'}</div>
                      </div>
                      <button
                        className="text-rose-600"
                        type="button"
                        disabled={
                          collectionProductState.savingId === product.id || collectionBulkState.saving
                        }
                        onClick={() => handleRemoveCollectionProduct(product.id)}
                      >
                        Remove
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl bg-white/70 p-4 text-sm text-ldc-ink/70">
                    No products assigned to this collection.
                  </div>
                )}
              </div>
              {collectionProductError ? (
                <div className="mt-3 text-sm text-rose-600">{collectionProductError}</div>
              ) : null}
              {collectionProductState.error ? (
                <div className="mt-2 text-sm text-rose-600">{collectionProductState.error}</div>
              ) : null}
              {collectionProductState.success ? (
                <div className="mt-2 text-sm text-emerald-700">{collectionProductState.success}</div>
              ) : null}
              {collectionBulkState.error ? (
                <div className="mt-2 text-sm text-rose-600">{collectionBulkState.error}</div>
              ) : null}
              {collectionBulkState.success ? (
                <div className="mt-2 text-sm text-emerald-700">{collectionBulkState.success}</div>
              ) : null}
            </div>
          ) : null}

          {isCategory ? (
            <div className="ldc-card p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-heading text-xl text-ldc-ink">Category</h3>
                  <p className="mt-2 text-sm text-ldc-ink/70">
                    Manage category settings, parent hierarchy, and metadata.
                  </p>
                </div>
                {categoryMetaLoading ? (
                  <span className="text-xs text-ldc-ink/60">Loading categories...</span>
                ) : null}
              </div>
              <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={handleSaveCategory}>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Name
                  <input
                    className="ldc-input mt-2"
                    value={categoryDraft.name}
                    onChange={handleCategoryDraftChange('name')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Handle
                  <input
                    className="ldc-input mt-2"
                    value={categoryDraft.handle}
                    onChange={handleCategoryDraftChange('handle')}
                  />
                </label>
                <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Description (optional)
                  <textarea
                    className="ldc-input mt-2 min-h-[90px]"
                    value={categoryDraft.description}
                    onChange={handleCategoryDraftChange('description')}
                  />
                </label>
                <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Thumbnail URL (optional)
                  <input
                    className="ldc-input mt-2"
                    value={categoryDraft.thumbnail}
                    onChange={handleCategoryDraftChange('thumbnail')}
                    placeholder="https://..."
                  />
                </label>
                <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Upload thumbnail
                  <input
                    className="ldc-input mt-2"
                    type="file"
                    accept="image/*"
                    onChange={handleCategoryThumbnailUpload}
                    disabled={categoryUploadState.uploading}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Parent category
                  {categoryMeta.categories.length ? (
                    <select
                      className="ldc-input mt-2"
                      value={categoryDraft.parent_category_id}
                      onChange={handleCategoryDraftChange('parent_category_id')}
                    >
                      <option value="">No parent</option>
                      {categoryMeta.categories
                        .filter((category) => category.id !== record?.id)
                        .map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name || category.handle || category.id}
                          </option>
                        ))}
                    </select>
                  ) : (
                    <input
                      className="ldc-input mt-2"
                      value={categoryDraft.parent_category_id}
                      onChange={handleCategoryDraftChange('parent_category_id')}
                      placeholder="pcat_..."
                    />
                  )}
                </label>
                <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-ldc-plum"
                    checked={categoryDraft.is_active}
                    onChange={handleCategoryDraftChange('is_active')}
                  />
                  Active category
                </label>
                <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-ldc-plum"
                    checked={categoryDraft.is_internal}
                    onChange={handleCategoryDraftChange('is_internal')}
                  />
                  Internal-only category
                </label>
                <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Metadata (optional)
                  <textarea
                    className="ldc-input mt-2 min-h-[90px] font-mono text-xs"
                    value={categoryDraft.metadata}
                    onChange={handleCategoryDraftChange('metadata')}
                    placeholder='{"theme":"featured"}'
                  />
                </label>
                {categoryMetaError ? (
                  <div className="md:col-span-2 text-sm text-rose-600">{categoryMetaError}</div>
                ) : null}
                {categoryState.error ? (
                  <div className="md:col-span-2 text-sm text-rose-600">{categoryState.error}</div>
                ) : null}
                {categoryUploadState.error ? (
                  <div className="md:col-span-2 text-sm text-rose-600">
                    {categoryUploadState.error}
                  </div>
                ) : null}
                {categoryState.success ? (
                  <div className="md:col-span-2 text-sm text-emerald-700">
                    {categoryState.success}
                  </div>
                ) : null}
                {categoryUploadState.success ? (
                  <div className="md:col-span-2 text-sm text-emerald-700">
                    {categoryUploadState.success}
                  </div>
                ) : null}
                <div className="md:col-span-2 flex flex-wrap items-center gap-3">
                  <button
                    className="ldc-button-primary"
                    type="submit"
                    disabled={categoryState.saving}
                  >
                    {categoryState.saving ? 'Saving...' : 'Save category'}
                  </button>
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={handleDeleteCategory}
                    disabled={categoryState.deleting}
                  >
                    {categoryState.deleting ? 'Deleting...' : 'Delete category'}
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {isCategory ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">Category Products</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Add products to this category or remove them when needed.
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Search products
                  <input
                    className="ldc-input mt-2"
                    value={categoryProductSearch.query}
                    onChange={handleCategoryProductSearchChange}
                    placeholder="Search by title or handle"
                  />
                </label>
                <div className="rounded-2xl bg-white/80 p-3 text-xs text-ldc-ink/60">
                  {categoryProductCount
                    ? `${categoryProductCount} product(s) in this category.`
                    : 'No products assigned yet.'}
                </div>
              </div>

              {categoryProductSearch.loading ? (
                <div className="mt-2 text-sm text-ldc-ink/60">Searching products...</div>
              ) : null}
              {categoryProductSearch.error ? (
                <div className="mt-2 text-sm text-rose-600">{categoryProductSearch.error}</div>
              ) : null}
              {categoryProductSearch.results.length ? (
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {categoryProductSearch.results.map((product) => {
                    const assigned = categoryProducts.some((item) => item.id === product.id);
                    const selected = categorySelection.search.includes(product.id);
                    return (
                      <div
                        key={product.id}
                        className="flex items-start gap-3 rounded-2xl border border-white/70 bg-white/70 px-3 py-2 text-xs text-ldc-ink"
                      >
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 accent-ldc-plum"
                          checked={selected}
                          disabled={assigned}
                          onChange={() => handleToggleCategorySelection('search', product.id)}
                        />
                        <div className="flex-1">
                          <div className="font-semibold">
                            {product.title || product.handle || product.id}
                          </div>
                          <div className="text-ldc-ink/60">Handle {product.handle || '-'}</div>
                        </div>
                        <button
                          className="ldc-button-secondary"
                          type="button"
                          disabled={
                            assigned || categoryProductState.savingId === product.id || categoryBulkState.saving
                          }
                          onClick={() => handleAssignCategoryProduct(product)}
                        >
                          {assigned ? 'Assigned' : 'Add'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <button
                  className="ldc-button-secondary"
                  type="button"
                  onClick={() =>
                    handleSelectAllCategorySearch(
                      categoryProductSearch.results
                        .filter((product) => !categoryProducts.some((item) => item.id === product.id))
                        .map((product) => product.id)
                    )
                  }
                  disabled={!categoryProductSearch.results.length}
                >
                  Select all results
                </button>
                <button
                  className="ldc-button-secondary"
                  type="button"
                  onClick={handleClearCategorySearchSelection}
                  disabled={!categorySelection.search.length}
                >
                  Clear selection
                </button>
                <button
                  className="ldc-button-primary"
                  type="button"
                  onClick={handleBulkAssignCategory}
                  disabled={categoryBulkState.saving || !categorySelection.search.length}
                >
                  {categoryBulkState.saving ? 'Updating...' : 'Add selected'}
                </button>
              </div>

              <div className="mt-4 space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={() =>
                      handleSelectAllCategoryAssigned(categoryProducts.map((product) => product.id))
                    }
                    disabled={!categoryProducts.length}
                  >
                    Select all assigned
                  </button>
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={handleClearCategoryAssignedSelection}
                    disabled={!categorySelection.assigned.length}
                  >
                    Clear selection
                  </button>
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={handleBulkRemoveCategory}
                    disabled={categoryBulkState.saving || !categorySelection.assigned.length}
                  >
                    {categoryBulkState.saving ? 'Updating...' : 'Remove selected'}
                  </button>
                </div>
                {categoryProductLoading ? (
                  <div className="text-sm text-ldc-ink/60">Loading category products...</div>
                ) : null}
                {categoryProducts.length ? (
                  categoryProducts.map((product) => (
                    <div
                      key={product.id}
                      className="flex items-start gap-3 rounded-2xl bg-white/70 px-3 py-2 text-xs text-ldc-ink"
                    >
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 accent-ldc-plum"
                        checked={categorySelection.assigned.includes(product.id)}
                        onChange={() => handleToggleCategorySelection('assigned', product.id)}
                      />
                      <div className="flex-1">
                        <div className="font-semibold">
                          {product.title || product.handle || product.id}
                        </div>
                        <div className="text-ldc-ink/60">Handle {product.handle || '-'}</div>
                      </div>
                      <button
                        className="text-rose-600"
                        type="button"
                        disabled={categoryProductState.savingId === product.id || categoryBulkState.saving}
                        onClick={() => handleRemoveCategoryProduct(product.id)}
                      >
                        Remove
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl bg-white/70 p-4 text-sm text-ldc-ink/70">
                    No products assigned to this category.
                  </div>
                )}
              </div>
              {categoryProductError ? (
                <div className="mt-3 text-sm text-rose-600">{categoryProductError}</div>
              ) : null}
              {categoryProductState.error ? (
                <div className="mt-2 text-sm text-rose-600">{categoryProductState.error}</div>
              ) : null}
              {categoryProductState.success ? (
                <div className="mt-2 text-sm text-emerald-700">{categoryProductState.success}</div>
              ) : null}
              {categoryBulkState.error ? (
                <div className="mt-2 text-sm text-rose-600">{categoryBulkState.error}</div>
              ) : null}
              {categoryBulkState.success ? (
                <div className="mt-2 text-sm text-emerald-700">{categoryBulkState.success}</div>
              ) : null}
            </div>
          ) : null}

          {isProductType ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">Product Type</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Manage reusable product type labels and metadata.
              </p>
              <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={handleSaveProductType}>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Value
                  <input
                    className="ldc-input mt-2"
                    value={productTypeDraft.value}
                    onChange={handleProductTypeDraftChange('value')}
                  />
                </label>
                <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Metadata (optional)
                  <textarea
                    className="ldc-input mt-2 min-h-[90px] font-mono text-xs"
                    value={productTypeDraft.metadata}
                    onChange={handleProductTypeDraftChange('metadata')}
                    placeholder='{"priority":"high"}'
                  />
                </label>
                {productTypeState.error ? (
                  <div className="md:col-span-2 text-sm text-rose-600">
                    {productTypeState.error}
                  </div>
                ) : null}
                {productTypeState.success ? (
                  <div className="md:col-span-2 text-sm text-emerald-700">
                    {productTypeState.success}
                  </div>
                ) : null}
                <div className="md:col-span-2 flex flex-wrap items-center gap-3">
                  <button
                    className="ldc-button-primary"
                    type="submit"
                    disabled={productTypeState.saving}
                  >
                    {productTypeState.saving ? 'Saving...' : 'Save product type'}
                  </button>
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={handleDeleteProductType}
                    disabled={productTypeState.deleting}
                  >
                    {productTypeState.deleting ? 'Deleting...' : 'Delete product type'}
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {isProductType ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">Type Products</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Assign products to this type. Assigning a product replaces its current type.
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Search products
                  <input
                    className="ldc-input mt-2"
                    value={productTypeProductSearch.query}
                    onChange={handleProductTypeProductSearchChange}
                    placeholder="Search by title or handle"
                  />
                </label>
                <div className="rounded-2xl bg-white/80 p-3 text-xs text-ldc-ink/60">
                  {productTypeProductCount
                    ? `${productTypeProductCount} product(s) with this type.`
                    : 'No products assigned yet.'}
                </div>
              </div>

              {productTypeProductSearch.loading ? (
                <div className="mt-2 text-sm text-ldc-ink/60">Searching products...</div>
              ) : null}
              {productTypeProductSearch.error ? (
                <div className="mt-2 text-sm text-rose-600">
                  {productTypeProductSearch.error}
                </div>
              ) : null}
              {productTypeProductSearch.results.length ? (
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {productTypeProductSearch.results.map((product) => {
                    const assigned = productTypeProducts.some((item) => item.id === product.id);
                    const selected = productTypeSelection.search.includes(product.id);
                    return (
                      <div
                        key={product.id}
                        className="flex items-start gap-3 rounded-2xl border border-white/70 bg-white/70 px-3 py-2 text-xs text-ldc-ink"
                      >
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 accent-ldc-plum"
                          checked={selected}
                          disabled={assigned}
                          onChange={() => handleToggleProductTypeSelection('search', product.id)}
                        />
                        <div className="flex-1">
                          <div className="font-semibold">
                            {product.title || product.handle || product.id}
                          </div>
                          <div className="text-ldc-ink/60">Handle {product.handle || '-'}</div>
                        </div>
                        <button
                          className="ldc-button-secondary"
                          type="button"
                          disabled={
                            assigned ||
                            productTypeProductState.savingId === product.id ||
                            productTypeBulkState.saving
                          }
                          onClick={() => handleAssignProductTypeProduct(product)}
                        >
                          {assigned ? 'Assigned' : 'Add'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <button
                  className="ldc-button-secondary"
                  type="button"
                  onClick={() =>
                    handleSelectAllProductTypeSearch(
                      productTypeProductSearch.results
                        .filter((product) => !productTypeProducts.some((item) => item.id === product.id))
                        .map((product) => product.id)
                    )
                  }
                  disabled={!productTypeProductSearch.results.length}
                >
                  Select all results
                </button>
                <button
                  className="ldc-button-secondary"
                  type="button"
                  onClick={handleClearProductTypeSearchSelection}
                  disabled={!productTypeSelection.search.length}
                >
                  Clear selection
                </button>
                <button
                  className="ldc-button-primary"
                  type="button"
                  onClick={handleBulkAssignProductType}
                  disabled={productTypeBulkState.saving || !productTypeSelection.search.length}
                >
                  {productTypeBulkState.saving ? 'Updating...' : 'Add selected'}
                </button>
              </div>

              <div className="mt-4 space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={() =>
                      handleSelectAllProductTypeAssigned(
                        productTypeProducts.map((product) => product.id)
                      )
                    }
                    disabled={!productTypeProducts.length}
                  >
                    Select all assigned
                  </button>
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={handleClearProductTypeAssignedSelection}
                    disabled={!productTypeSelection.assigned.length}
                  >
                    Clear selection
                  </button>
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={handleBulkRemoveProductType}
                    disabled={productTypeBulkState.saving || !productTypeSelection.assigned.length}
                  >
                    {productTypeBulkState.saving ? 'Updating...' : 'Remove selected'}
                  </button>
                </div>
                {productTypeProductLoading ? (
                  <div className="text-sm text-ldc-ink/60">Loading type products...</div>
                ) : null}
                {productTypeProducts.length ? (
                  productTypeProducts.map((product) => (
                    <div
                      key={product.id}
                      className="flex items-start gap-3 rounded-2xl bg-white/70 px-3 py-2 text-xs text-ldc-ink"
                    >
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 accent-ldc-plum"
                        checked={productTypeSelection.assigned.includes(product.id)}
                        onChange={() => handleToggleProductTypeSelection('assigned', product.id)}
                      />
                      <div className="flex-1">
                        <div className="font-semibold">
                          {product.title || product.handle || product.id}
                        </div>
                        <div className="text-ldc-ink/60">Handle {product.handle || '-'}</div>
                      </div>
                      <button
                        className="text-rose-600"
                        type="button"
                        disabled={
                          productTypeProductState.savingId === product.id ||
                          productTypeBulkState.saving
                        }
                        onClick={() => handleRemoveProductTypeProduct(product.id)}
                      >
                        Remove
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl bg-white/70 p-4 text-sm text-ldc-ink/70">
                    No products assigned to this type.
                  </div>
                )}
              </div>
              {productTypeProductError ? (
                <div className="mt-3 text-sm text-rose-600">{productTypeProductError}</div>
              ) : null}
              {productTypeProductState.error ? (
                <div className="mt-2 text-sm text-rose-600">
                  {productTypeProductState.error}
                </div>
              ) : null}
              {productTypeProductState.success ? (
                <div className="mt-2 text-sm text-emerald-700">
                  {productTypeProductState.success}
                </div>
              ) : null}
              {productTypeBulkState.error ? (
                <div className="mt-2 text-sm text-rose-600">{productTypeBulkState.error}</div>
              ) : null}
              {productTypeBulkState.success ? (
                <div className="mt-2 text-sm text-emerald-700">
                  {productTypeBulkState.success}
                </div>
              ) : null}
            </div>
          ) : null}

          {isProductTag ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">Product Tag</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Update tags used to organize and filter products.
              </p>
              <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={handleSaveProductTag}>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Value
                  <input
                    className="ldc-input mt-2"
                    value={productTagDraft.value}
                    onChange={handleProductTagDraftChange('value')}
                  />
                </label>
                <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Metadata (optional)
                  <textarea
                    className="ldc-input mt-2 min-h-[90px] font-mono text-xs"
                    value={productTagDraft.metadata}
                    onChange={handleProductTagDraftChange('metadata')}
                    placeholder='{"badge":"top"}'
                  />
                </label>
                {productTagState.error ? (
                  <div className="md:col-span-2 text-sm text-rose-600">
                    {productTagState.error}
                  </div>
                ) : null}
                {productTagState.success ? (
                  <div className="md:col-span-2 text-sm text-emerald-700">
                    {productTagState.success}
                  </div>
                ) : null}
                <div className="md:col-span-2 flex flex-wrap items-center gap-3">
                  <button
                    className="ldc-button-primary"
                    type="submit"
                    disabled={productTagState.saving}
                  >
                    {productTagState.saving ? 'Saving...' : 'Save product tag'}
                  </button>
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={handleDeleteProductTag}
                    disabled={productTagState.deleting}
                  >
                    {productTagState.deleting ? 'Deleting...' : 'Delete product tag'}
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {isProductTag ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">Tag Products</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Apply this tag to products or remove it when it is no longer needed.
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Search products
                  <input
                    className="ldc-input mt-2"
                    value={productTagProductSearch.query}
                    onChange={handleProductTagProductSearchChange}
                    placeholder="Search by title or handle"
                  />
                </label>
                <div className="rounded-2xl bg-white/80 p-3 text-xs text-ldc-ink/60">
                  {productTagProductCount
                    ? `${productTagProductCount} product(s) with this tag.`
                    : 'No products tagged yet.'}
                </div>
              </div>

              {productTagProductSearch.loading ? (
                <div className="mt-2 text-sm text-ldc-ink/60">Searching products...</div>
              ) : null}
              {productTagProductSearch.error ? (
                <div className="mt-2 text-sm text-rose-600">
                  {productTagProductSearch.error}
                </div>
              ) : null}
              {productTagProductSearch.results.length ? (
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {productTagProductSearch.results.map((product) => {
                    const assigned = productTagProducts.some((item) => item.id === product.id);
                    const selected = productTagSelection.search.includes(product.id);
                    return (
                      <div
                        key={product.id}
                        className="flex items-start gap-3 rounded-2xl border border-white/70 bg-white/70 px-3 py-2 text-xs text-ldc-ink"
                      >
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 accent-ldc-plum"
                          checked={selected}
                          disabled={assigned}
                          onChange={() => handleToggleProductTagSelection('search', product.id)}
                        />
                        <div className="flex-1">
                          <div className="font-semibold">
                            {product.title || product.handle || product.id}
                          </div>
                          <div className="text-ldc-ink/60">Handle {product.handle || '-'}</div>
                        </div>
                        <button
                          className="ldc-button-secondary"
                          type="button"
                          disabled={
                            assigned ||
                            productTagProductState.savingId === product.id ||
                            productTagBulkState.saving
                          }
                          onClick={() => handleAssignProductTagProduct(product)}
                        >
                          {assigned ? 'Tagged' : 'Add'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <button
                  className="ldc-button-secondary"
                  type="button"
                  onClick={() =>
                    handleSelectAllProductTagSearch(
                      productTagProductSearch.results
                        .filter((product) => !productTagProducts.some((item) => item.id === product.id))
                        .map((product) => product.id)
                    )
                  }
                  disabled={!productTagProductSearch.results.length}
                >
                  Select all results
                </button>
                <button
                  className="ldc-button-secondary"
                  type="button"
                  onClick={handleClearProductTagSearchSelection}
                  disabled={!productTagSelection.search.length}
                >
                  Clear selection
                </button>
                <button
                  className="ldc-button-primary"
                  type="button"
                  onClick={handleBulkAssignProductTag}
                  disabled={productTagBulkState.saving || !productTagSelection.search.length}
                >
                  {productTagBulkState.saving ? 'Updating...' : 'Add selected'}
                </button>
              </div>

              <div className="mt-4 space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={() =>
                      handleSelectAllProductTagAssigned(
                        productTagProducts.map((product) => product.id)
                      )
                    }
                    disabled={!productTagProducts.length}
                  >
                    Select all tagged
                  </button>
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={handleClearProductTagAssignedSelection}
                    disabled={!productTagSelection.assigned.length}
                  >
                    Clear selection
                  </button>
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={handleBulkRemoveProductTag}
                    disabled={productTagBulkState.saving || !productTagSelection.assigned.length}
                  >
                    {productTagBulkState.saving ? 'Updating...' : 'Remove selected'}
                  </button>
                </div>
                {productTagProductLoading ? (
                  <div className="text-sm text-ldc-ink/60">Loading tag products...</div>
                ) : null}
                {productTagProducts.length ? (
                  productTagProducts.map((product) => (
                    <div
                      key={product.id}
                      className="flex items-start gap-3 rounded-2xl bg-white/70 px-3 py-2 text-xs text-ldc-ink"
                    >
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 accent-ldc-plum"
                        checked={productTagSelection.assigned.includes(product.id)}
                        onChange={() => handleToggleProductTagSelection('assigned', product.id)}
                      />
                      <div className="flex-1">
                        <div className="font-semibold">
                          {product.title || product.handle || product.id}
                        </div>
                        <div className="text-ldc-ink/60">Handle {product.handle || '-'}</div>
                      </div>
                      <button
                        className="text-rose-600"
                        type="button"
                        disabled={
                          productTagProductState.savingId === product.id ||
                          productTagBulkState.saving
                        }
                        onClick={() => handleRemoveProductTagProduct(product.id)}
                      >
                        Remove
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl bg-white/70 p-4 text-sm text-ldc-ink/70">
                    No products tagged with this label.
                  </div>
                )}
              </div>
              {productTagProductError ? (
                <div className="mt-3 text-sm text-rose-600">{productTagProductError}</div>
              ) : null}
              {productTagProductState.error ? (
                <div className="mt-2 text-sm text-rose-600">
                  {productTagProductState.error}
                </div>
              ) : null}
              {productTagProductState.success ? (
                <div className="mt-2 text-sm text-emerald-700">
                  {productTagProductState.success}
                </div>
              ) : null}
              {productTagBulkState.error ? (
                <div className="mt-2 text-sm text-rose-600">{productTagBulkState.error}</div>
              ) : null}
              {productTagBulkState.success ? (
                <div className="mt-2 text-sm text-emerald-700">
                  {productTagBulkState.success}
                </div>
              ) : null}
            </div>
          ) : null}

          {isGiftCard ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">Gift Card</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Review balance details and manage expiry or disabled status.
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl bg-white/70 px-4 py-3 text-xs text-ldc-ink/70">
                  <div className="font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                    Status
                  </div>
                  <div className="mt-2 text-sm text-ldc-ink">{giftCardStatus || '-'}</div>
                </div>
                <div className="rounded-2xl bg-white/70 px-4 py-3 text-xs text-ldc-ink/70">
                  <div className="font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                    Region
                  </div>
                  <div className="mt-2 text-sm text-ldc-ink">
                    {record?.region?.name ||
                      record?.region?.currency_code?.toUpperCase() ||
                      record?.region_id ||
                      '-'}
                  </div>
                </div>
              </div>
              <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={handleSaveGiftCard}>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Code
                  <input className="ldc-input mt-2" value={record?.code || ''} disabled />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Issued value
                  <input
                    className="ldc-input mt-2"
                    value={formatMoneyOrDash(record?.value, giftCardCurrency)}
                    disabled
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Balance
                  <input
                    className="ldc-input mt-2"
                    value={formatMoneyOrDash(record?.balance, giftCardCurrency)}
                    disabled
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Expires at (optional)
                  <input
                    className="ldc-input mt-2"
                    type="datetime-local"
                    value={giftCardDraft.ends_at}
                    onChange={handleGiftCardDraftChange('ends_at')}
                  />
                </label>
                <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-ldc-plum"
                    checked={giftCardDraft.is_disabled}
                    onChange={handleGiftCardDraftChange('is_disabled')}
                  />
                  Disable gift card
                </label>
                <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Metadata (optional)
                  <textarea
                    className="ldc-input mt-2 min-h-[90px] font-mono text-xs"
                    value={giftCardDraft.metadata}
                    onChange={handleGiftCardDraftChange('metadata')}
                    placeholder='{"note":"Issued for giveaway"}'
                  />
                </label>
                {giftCardState.error ? (
                  <div className="md:col-span-2 text-sm text-rose-600">
                    {giftCardState.error}
                  </div>
                ) : null}
                {giftCardState.success ? (
                  <div className="md:col-span-2 text-sm text-emerald-700">
                    {giftCardState.success}
                  </div>
                ) : null}
                <div className="md:col-span-2 flex flex-wrap items-center gap-3">
                  <button
                    className="ldc-button-primary"
                    type="submit"
                    disabled={giftCardState.saving}
                  >
                    {giftCardState.saving ? 'Saving...' : 'Save gift card'}
                  </button>
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={handleDeleteGiftCard}
                    disabled={giftCardState.deleting}
                  >
                    {giftCardState.deleting ? 'Deleting...' : 'Delete gift card'}
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {isUser ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">Team Member</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Update team member details and profile metadata.
              </p>
              <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={handleSaveUser}>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Email
                  <input className="ldc-input mt-2" value={userDraft.email} disabled />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Role
                  <select
                    className="ldc-input mt-2"
                    value={userDraft.role}
                    onChange={handleUserDraftChange('role')}
                  >
                    <option value="">Unassigned</option>
                    {TEAM_ROLE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Avatar URL
                  <input
                    className="ldc-input mt-2"
                    value={userDraft.avatar_url}
                    onChange={handleUserDraftChange('avatar_url')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  First name
                  <input
                    className="ldc-input mt-2"
                    value={userDraft.first_name}
                    onChange={handleUserDraftChange('first_name')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Last name
                  <input
                    className="ldc-input mt-2"
                    value={userDraft.last_name}
                    onChange={handleUserDraftChange('last_name')}
                  />
                </label>
                <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Metadata (optional)
                  <textarea
                    className="ldc-input mt-2 min-h-[90px] font-mono text-xs"
                    value={userDraft.metadata}
                    onChange={handleUserDraftChange('metadata')}
                  />
                </label>
                {userState.error ? (
                  <div className="md:col-span-2 text-sm text-rose-600">{userState.error}</div>
                ) : null}
                {userState.success ? (
                  <div className="md:col-span-2 text-sm text-emerald-700">{userState.success}</div>
                ) : null}
                <div className="md:col-span-2 flex flex-wrap items-center gap-3">
                  <button className="ldc-button-primary" type="submit" disabled={userState.saving}>
                    {userState.saving ? 'Saving...' : 'Save user'}
                  </button>
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={handleDeleteUser}
                    disabled={userState.deleting}
                  >
                    {userState.deleting ? 'Deleting...' : 'Delete user'}
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {isInvite ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">Invite</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Review invitation status or cancel a pending invite.
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl bg-white/70 px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                    Email
                  </div>
                  <div className="mt-2 text-sm text-ldc-ink">{record.email || '-'}</div>
                </div>
                <div className="rounded-2xl bg-white/70 px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                    Status
                  </div>
                  <div className="mt-2 text-sm text-ldc-ink">
                    {record.accepted ? 'Accepted' : 'Pending'}
                  </div>
                </div>
                <div className="rounded-2xl bg-white/70 px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                    Role
                  </div>
                  <div className="mt-2 text-sm text-ldc-ink">
                    {resolveRoleValue(record) || '-'}
                  </div>
                </div>
                <div className="rounded-2xl bg-white/70 px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                    Expires
                  </div>
                  <div className="mt-2 text-sm text-ldc-ink">
                    {record.expires_at ? formatDateTime(record.expires_at) : '-'}
                  </div>
                </div>
                <div className="rounded-2xl bg-white/70 px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                    Token
                  </div>
                  <div className="mt-2 break-all text-sm text-ldc-ink">
                    {record.token || '-'}
                  </div>
                </div>
              </div>
              {inviteState.error ? (
                <div className="mt-3 text-sm text-rose-600">{inviteState.error}</div>
              ) : null}
              {inviteState.success ? (
                <div className="mt-3 text-sm text-emerald-700">{inviteState.success}</div>
              ) : null}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  className="ldc-button-secondary"
                  type="button"
                  onClick={handleDeleteInvite}
                  disabled={inviteState.deleting || record.accepted}
                >
                  {inviteState.deleting ? 'Canceling...' : 'Cancel invite'}
                </button>
                {record.accepted ? (
                  <span className="text-xs text-ldc-ink/60">Invite already accepted.</span>
                ) : null}
              </div>
            </div>
          ) : null}

          {isApiKey ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">API Key</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Update the key title, revoke access, or delete the key.
              </p>
              <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={handleSaveApiKey}>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Title
                  <input
                    className="ldc-input mt-2"
                    value={apiKeyDraft.title}
                    onChange={handleApiKeyDraftChange('title')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Type
                  <input className="ldc-input mt-2" value={record.type || ''} disabled />
                </label>
                <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Redacted token
                  <input
                    className="ldc-input mt-2"
                    value={record.redacted || record.token || ''}
                    disabled
                  />
                </label>
                <div className="md:col-span-2 rounded-2xl bg-white/70 px-4 py-3 text-sm text-ldc-ink">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                    Sales channels
                  </div>
                  <div className="mt-2">
                    {(record.sales_channels || [])
                      .map((channel) => channel?.name || channel?.id)
                      .filter(Boolean)
                      .join(', ') || 'All channels'}
                  </div>
                </div>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Revoke in (seconds)
                  <input
                    className="ldc-input mt-2"
                    type="number"
                    value={apiKeyDraft.revoke_in}
                    onChange={handleApiKeyDraftChange('revoke_in')}
                    placeholder="0"
                  />
                </label>
                <div className="flex items-end gap-2">
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={handleRevokeApiKey}
                    disabled={apiKeyState.revoking || Boolean(record.revoked_at)}
                  >
                    {apiKeyState.revoking ? 'Revoking...' : 'Revoke key'}
                  </button>
                </div>
                {apiKeyState.error ? (
                  <div className="md:col-span-2 text-sm text-rose-600">{apiKeyState.error}</div>
                ) : null}
                {apiKeyState.success ? (
                  <div className="md:col-span-2 text-sm text-emerald-700">{apiKeyState.success}</div>
                ) : null}
                <div className="md:col-span-2 flex flex-wrap items-center gap-3">
                  <button
                    className="ldc-button-primary"
                    type="submit"
                    disabled={apiKeyState.saving}
                  >
                    {apiKeyState.saving ? 'Saving...' : 'Save key'}
                  </button>
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={handleDeleteApiKey}
                    disabled={apiKeyState.deleting}
                  >
                    {apiKeyState.deleting ? 'Deleting...' : 'Delete key'}
                  </button>
                  {record.revoked_at ? (
                    <span className="text-xs text-ldc-ink/60">
                      Revoked {formatDateTime(record.revoked_at)}
                    </span>
                  ) : null}
                </div>
              </form>
            </div>
          ) : null}

          {isStore ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">Store Settings</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Configure currencies, locales, and default settings for the storefront.
              </p>
              <form className="mt-4 space-y-4" onSubmit={handleSaveStore}>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Store name
                  <input
                    className="ldc-input mt-2"
                    value={storeDraft.name}
                    onChange={handleStoreDraftChange('name')}
                  />
                </label>

                <div className="rounded-2xl bg-white/70 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                    Supported currencies
                  </div>
                  <div className="mt-3 space-y-2">
                    {storeDraft.supported_currencies.length ? (
                      storeDraft.supported_currencies.map((currency) => (
                        <div
                          key={currency.currency_code}
                          className="flex flex-wrap items-center gap-3 rounded-2xl bg-white/70 px-3 py-2 text-xs text-ldc-ink"
                        >
                          <span className="font-semibold uppercase tracking-[0.2em]">
                            {currency.currency_code}
                          </span>
                          <label className="flex items-center gap-2">
                            <input
                              type="radio"
                              checked={currency.is_default}
                              onChange={() => handleToggleStoreDefaultCurrency(currency.currency_code)}
                            />
                            Default
                          </label>
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={currency.is_tax_inclusive}
                              onChange={() => handleToggleStoreTaxInclusive(currency.currency_code)}
                            />
                            Tax inclusive
                          </label>
                          <button
                            className="ml-auto text-xs text-rose-600"
                            type="button"
                            onClick={() => handleRemoveStoreCurrency(currency.currency_code)}
                          >
                            Remove
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-ldc-ink/60">No currencies set.</div>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input
                      className="ldc-input h-10 w-32"
                      value={storeCurrencyInput}
                      onChange={(event) => setStoreCurrencyInput(event.target.value)}
                      placeholder="usd"
                    />
                    <button className="ldc-button-secondary" type="button" onClick={handleAddStoreCurrency}>
                      Add currency
                    </button>
                  </div>
                </div>

                <div className="rounded-2xl bg-white/70 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                    Supported locales
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {storeDraft.supported_locales.length ? (
                      storeDraft.supported_locales.map((locale) => (
                        <button
                          key={locale.locale_code}
                          type="button"
                          className="flex items-center gap-2 rounded-full border border-white/70 bg-white/70 px-3 py-1 text-xs text-ldc-ink"
                          onClick={() => handleRemoveStoreLocale(locale.locale_code)}
                        >
                          <span>{locale.locale_code}</span>
                          <span className="text-ldc-ink/50">x</span>
                        </button>
                      ))
                    ) : (
                      <div className="text-xs text-ldc-ink/60">No locales set.</div>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input
                      className="ldc-input h-10 w-32"
                      value={storeLocaleInput}
                      onChange={(event) => setStoreLocaleInput(event.target.value)}
                      placeholder="en-US"
                    />
                    <button className="ldc-button-secondary" type="button" onClick={handleAddStoreLocale}>
                      Add locale
                    </button>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Default sales channel
                    {storeMeta.salesChannels.length ? (
                      <select
                        className="ldc-input mt-2"
                        value={storeDraft.default_sales_channel_id}
                        onChange={handleStoreDraftChange('default_sales_channel_id')}
                      >
                        <option value="">None</option>
                        {storeMeta.salesChannels.map((channel) => (
                          <option key={channel.id} value={channel.id}>
                            {channel.name || channel.id}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="ldc-input mt-2"
                        value={storeDraft.default_sales_channel_id}
                        onChange={handleStoreDraftChange('default_sales_channel_id')}
                        placeholder="sc_..."
                      />
                    )}
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Default region
                    {storeMeta.regions.length ? (
                      <select
                        className="ldc-input mt-2"
                        value={storeDraft.default_region_id}
                        onChange={handleStoreDraftChange('default_region_id')}
                      >
                        <option value="">None</option>
                        {storeMeta.regions.map((region) => (
                          <option key={region.id} value={region.id}>
                            {region.name || region.id}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="ldc-input mt-2"
                        value={storeDraft.default_region_id}
                        onChange={handleStoreDraftChange('default_region_id')}
                        placeholder="reg_..."
                      />
                    )}
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Default location
                    {storeMeta.locations.length ? (
                      <select
                        className="ldc-input mt-2"
                        value={storeDraft.default_location_id}
                        onChange={handleStoreDraftChange('default_location_id')}
                      >
                        <option value="">None</option>
                        {storeMeta.locations.map((location) => (
                          <option key={location.id} value={location.id}>
                            {location.name || location.id}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="ldc-input mt-2"
                        value={storeDraft.default_location_id}
                        onChange={handleStoreDraftChange('default_location_id')}
                        placeholder="loc_..."
                      />
                    )}
                  </label>
                </div>

                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Metadata (optional)
                  <textarea
                    className="ldc-input mt-2 min-h-[90px] font-mono text-xs"
                    value={storeDraft.metadata}
                    onChange={handleStoreDraftChange('metadata')}
                  />
                </label>

                {storeMetaLoading ? (
                  <div className="text-xs text-ldc-ink/60">Loading store settings...</div>
                ) : null}
                {storeMetaError ? (
                  <div className="text-sm text-rose-600">{storeMetaError}</div>
                ) : null}
                {storeState.error ? (
                  <div className="text-sm text-rose-600">{storeState.error}</div>
                ) : null}
                {storeState.success ? (
                  <div className="text-sm text-emerald-700">{storeState.success}</div>
                ) : null}

                <button className="ldc-button-primary" type="submit" disabled={storeState.saving}>
                  {storeState.saving ? 'Saving...' : 'Save store settings'}
                </button>
              </form>
            </div>
          ) : null}

          {isSalesChannel ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">Sales Channel</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Update channel settings and control where products are published.
              </p>
              <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={handleSaveSalesChannel}>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Name
                  <input
                    className="ldc-input mt-2"
                    value={salesChannelDraft.name}
                    onChange={handleSalesChannelDraftChange('name')}
                  />
                </label>
                <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-ldc-plum"
                    checked={salesChannelDraft.is_disabled}
                    onChange={handleSalesChannelDraftChange('is_disabled')}
                  />
                  Disabled
                </label>
                <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Description (optional)
                  <textarea
                    className="ldc-input mt-2 min-h-[90px]"
                    value={salesChannelDraft.description}
                    onChange={handleSalesChannelDraftChange('description')}
                  />
                </label>
                <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Metadata (optional)
                  <textarea
                    className="ldc-input mt-2 min-h-[90px] font-mono text-xs"
                    value={salesChannelDraft.metadata}
                    onChange={handleSalesChannelDraftChange('metadata')}
                    placeholder='{"region":"US"}'
                  />
                </label>
                {salesChannelState.error ? (
                  <div className="md:col-span-2 text-sm text-rose-600">
                    {salesChannelState.error}
                  </div>
                ) : null}
                {salesChannelState.success ? (
                  <div className="md:col-span-2 text-sm text-emerald-700">
                    {salesChannelState.success}
                  </div>
                ) : null}
                <div className="md:col-span-2 flex flex-wrap items-center gap-3">
                  <button
                    className="ldc-button-primary"
                    type="submit"
                    disabled={salesChannelState.saving}
                  >
                    {salesChannelState.saving ? 'Saving...' : 'Save sales channel'}
                  </button>
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={handleDeleteSalesChannel}
                    disabled={salesChannelState.deleting}
                  >
                    {salesChannelState.deleting ? 'Deleting...' : 'Delete sales channel'}
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {isSalesChannel ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">Published Products</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Add or remove products to control where they appear.
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Search products
                  <input
                    className="ldc-input mt-2"
                    value={salesChannelProductSearch.query}
                    onChange={handleSalesChannelProductSearchChange}
                    placeholder="Search by title or handle"
                  />
                </label>
                <div className="rounded-2xl bg-white/80 p-3 text-xs text-ldc-ink/60">
                  {salesChannelProductCount
                    ? `${salesChannelProductCount} product(s) published here.`
                    : 'No products published yet.'}
                </div>
              </div>

              {salesChannelProductSearch.loading ? (
                <div className="mt-2 text-sm text-ldc-ink/60">Searching products...</div>
              ) : null}
              {salesChannelProductSearch.error ? (
                <div className="mt-2 text-sm text-rose-600">{salesChannelProductSearch.error}</div>
              ) : null}
              {salesChannelProductSearch.results.length ? (
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {salesChannelProductSearch.results.map((product) => {
                    const assigned = salesChannelProducts.some((item) => item.id === product.id);
                    const selected = salesChannelSelection.search.includes(product.id);
                    return (
                      <div
                        key={product.id}
                        className="flex items-start gap-3 rounded-2xl border border-white/70 bg-white/70 px-3 py-2 text-xs text-ldc-ink"
                      >
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 accent-ldc-plum"
                          checked={selected}
                          disabled={assigned}
                          onChange={() => handleToggleSalesChannelSelection('search', product.id)}
                        />
                        <div className="flex-1">
                          <div className="font-semibold">
                            {product.title || product.handle || product.id}
                          </div>
                          <div className="text-ldc-ink/60">Handle {product.handle || '-'}</div>
                        </div>
                        <button
                          className="ldc-button-secondary"
                          type="button"
                          disabled={
                            assigned ||
                            salesChannelProductState.savingId === product.id ||
                            salesChannelBulkState.saving
                          }
                          onClick={() => handleAssignSalesChannelProduct(product)}
                        >
                          {assigned ? 'Published' : 'Publish'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <button
                  className="ldc-button-secondary"
                  type="button"
                  onClick={() =>
                    handleSelectAllSalesChannelSearch(
                      salesChannelProductSearch.results
                        .filter((product) => !salesChannelProducts.some((item) => item.id === product.id))
                        .map((product) => product.id)
                    )
                  }
                  disabled={!salesChannelProductSearch.results.length}
                >
                  Select all results
                </button>
                <button
                  className="ldc-button-secondary"
                  type="button"
                  onClick={handleClearSalesChannelSearchSelection}
                  disabled={!salesChannelSelection.search.length}
                >
                  Clear selection
                </button>
                <button
                  className="ldc-button-primary"
                  type="button"
                  onClick={handleBulkAssignSalesChannel}
                  disabled={salesChannelBulkState.saving || !salesChannelSelection.search.length}
                >
                  {salesChannelBulkState.saving ? 'Updating...' : 'Publish selected'}
                </button>
              </div>

              <div className="mt-4 space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={() =>
                      handleSelectAllSalesChannelAssigned(
                        salesChannelProducts.map((product) => product.id)
                      )
                    }
                    disabled={!salesChannelProducts.length}
                  >
                    Select all published
                  </button>
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={handleClearSalesChannelAssignedSelection}
                    disabled={!salesChannelSelection.assigned.length}
                  >
                    Clear selection
                  </button>
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={handleBulkRemoveSalesChannel}
                    disabled={salesChannelBulkState.saving || !salesChannelSelection.assigned.length}
                  >
                    {salesChannelBulkState.saving ? 'Updating...' : 'Unpublish selected'}
                  </button>
                </div>
                {salesChannelProductLoading ? (
                  <div className="text-sm text-ldc-ink/60">Loading published products...</div>
                ) : null}
                {salesChannelProducts.length ? (
                  salesChannelProducts.map((product) => (
                    <div
                      key={product.id}
                      className="flex items-start gap-3 rounded-2xl bg-white/70 px-3 py-2 text-xs text-ldc-ink"
                    >
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 accent-ldc-plum"
                        checked={salesChannelSelection.assigned.includes(product.id)}
                        onChange={() => handleToggleSalesChannelSelection('assigned', product.id)}
                      />
                      <div className="flex-1">
                        <div className="font-semibold">
                          {product.title || product.handle || product.id}
                        </div>
                        <div className="text-ldc-ink/60">Handle {product.handle || '-'}</div>
                      </div>
                      <button
                        className="text-rose-600"
                        type="button"
                        disabled={
                          salesChannelProductState.savingId === product.id || salesChannelBulkState.saving
                        }
                        onClick={() => handleRemoveSalesChannelProduct(product.id)}
                      >
                        Remove
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl bg-white/70 p-4 text-sm text-ldc-ink/70">
                    No products published to this channel.
                  </div>
                )}
              </div>
              {salesChannelProductError ? (
                <div className="mt-3 text-sm text-rose-600">{salesChannelProductError}</div>
              ) : null}
              {salesChannelProductState.error ? (
                <div className="mt-2 text-sm text-rose-600">{salesChannelProductState.error}</div>
              ) : null}
              {salesChannelProductState.success ? (
                <div className="mt-2 text-sm text-emerald-700">{salesChannelProductState.success}</div>
              ) : null}
              {salesChannelBulkState.error ? (
                <div className="mt-2 text-sm text-rose-600">{salesChannelBulkState.error}</div>
              ) : null}
              {salesChannelBulkState.success ? (
                <div className="mt-2 text-sm text-emerald-700">{salesChannelBulkState.success}</div>
              ) : null}
            </div>
          ) : null}

          {isRegion ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">Region Settings</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Update currency, countries, and payment providers tied to this region.
              </p>
              <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={handleSaveRegion}>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Name
                  <input
                    className="ldc-input mt-2"
                    value={regionDraft.name}
                    onChange={handleRegionDraftChange('name')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Currency code
                  <input
                    className="ldc-input mt-2"
                    value={regionDraft.currency_code}
                    onChange={handleRegionDraftChange('currency_code')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Countries (comma-separated)
                  <input
                    className="ldc-input mt-2"
                    value={regionDraft.countries}
                    onChange={handleRegionDraftChange('countries')}
                    placeholder="us, ca"
                  />
                </label>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Payment providers
                  {opsMeta.paymentProviders.length ? (
                    <div className="mt-2 max-h-40 space-y-2 overflow-y-auto rounded-2xl bg-white/70 p-3">
                      {opsMeta.paymentProviders.map((provider) => {
                        const id = provider?.id || provider?.code || provider?.name;
                        if (!id) return null;
                        const selected = parseCsvInput(regionDraft.payment_providers).includes(id);
                        return (
                          <label key={id} className="flex items-center gap-2 text-xs text-ldc-ink/80">
                            <input
                              type="checkbox"
                              className="h-4 w-4 accent-ldc-plum"
                              checked={selected}
                              onChange={() => handleRegionProviderToggle(id)}
                            />
                            <span>{id}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <input
                      className="ldc-input mt-2"
                      value={regionDraft.payment_providers}
                      onChange={handleRegionDraftChange('payment_providers')}
                      placeholder="pp_stripe_stripe, pp_system_default"
                    />
                  )}
                </div>

                <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-ldc-plum"
                    checked={regionDraft.automatic_taxes}
                    onChange={handleRegionDraftChange('automatic_taxes')}
                  />
                  Automatic taxes
                </label>
                <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-ldc-plum"
                    checked={regionDraft.is_tax_inclusive}
                    onChange={handleRegionDraftChange('is_tax_inclusive')}
                  />
                  Prices include tax
                </label>

                <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Metadata (optional)
                  <textarea
                    className="ldc-input mt-2 min-h-[90px] font-mono text-xs"
                    value={regionDraft.metadata}
                    onChange={handleRegionDraftChange('metadata')}
                    placeholder='{"market":"US"}'
                  />
                </label>
                {opsMetaLoading ? (
                  <div className="md:col-span-2 text-xs text-ldc-ink/60">
                    Loading providers...
                  </div>
                ) : null}
                {opsMetaError ? (
                  <div className="md:col-span-2 text-sm text-rose-600">{opsMetaError}</div>
                ) : null}
                {renderOpsMetaFailures('md:col-span-2 text-xs text-ldc-ink/60')}
                {regionState.error ? (
                  <div className="md:col-span-2 text-sm text-rose-600">{regionState.error}</div>
                ) : null}
                {regionState.success ? (
                  <div className="md:col-span-2 text-sm text-emerald-700">
                    {regionState.success}
                  </div>
                ) : null}
                <div className="md:col-span-2 flex flex-wrap items-center gap-3">
                  <button
                    className="ldc-button-primary"
                    type="submit"
                    disabled={regionState.saving}
                  >
                    {regionState.saving ? 'Saving...' : 'Save region'}
                  </button>
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={handleDeleteRegion}
                    disabled={regionState.deleting}
                  >
                    {regionState.deleting ? 'Deleting...' : 'Delete region'}
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {isShippingProfile ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">Shipping Profile</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Update the name or type for this shipping profile.
              </p>
              <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={handleSaveShippingProfile}>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Name
                  <input
                    className="ldc-input mt-2"
                    value={shippingProfileDraft.name}
                    onChange={handleShippingProfileDraftChange('name')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Type
                  <input
                    className="ldc-input mt-2"
                    value={shippingProfileDraft.type}
                    onChange={handleShippingProfileDraftChange('type')}
                  />
                </label>
                <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Metadata (optional)
                  <textarea
                    className="ldc-input mt-2 min-h-[90px] font-mono text-xs"
                    value={shippingProfileDraft.metadata}
                    onChange={handleShippingProfileDraftChange('metadata')}
                    placeholder='{"group":"default"}'
                  />
                </label>
                {shippingProfileState.error ? (
                  <div className="md:col-span-2 text-sm text-rose-600">
                    {shippingProfileState.error}
                  </div>
                ) : null}
                {shippingProfileState.success ? (
                  <div className="md:col-span-2 text-sm text-emerald-700">
                    {shippingProfileState.success}
                  </div>
                ) : null}
                <div className="md:col-span-2 flex flex-wrap items-center gap-3">
                  <button
                    className="ldc-button-primary"
                    type="submit"
                    disabled={shippingProfileState.saving}
                  >
                    {shippingProfileState.saving ? 'Saving...' : 'Save profile'}
                  </button>
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={handleDeleteShippingProfile}
                    disabled={shippingProfileState.deleting}
                  >
                    {shippingProfileState.deleting ? 'Deleting...' : 'Delete profile'}
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {isShippingOption ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">Shipping Option</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Manage pricing, provider, and service zone for this option.
              </p>
              <form className="mt-4 space-y-4" onSubmit={handleSaveShippingOption}>
                <div className="grid gap-4 md:grid-cols-3">
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Name
                    <input
                      className="ldc-input mt-2"
                      value={shippingOptionDraft.name}
                      onChange={handleShippingOptionDraftChange('name')}
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Price type
                    <select
                      className="ldc-input mt-2"
                      value={shippingOptionDraft.price_type}
                      onChange={handleShippingOptionDraftChange('price_type')}
                    >
                      <option value="flat">Flat</option>
                      <option value="calculated">Calculated</option>
                    </select>
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Provider
                    {opsMeta.fulfillmentProviders.length ? (
                      <select
                        className="ldc-input mt-2"
                        value={shippingOptionDraft.provider_id}
                        onChange={handleShippingOptionDraftChange('provider_id')}
                      >
                        <option value="">Select provider</option>
                        {opsMeta.fulfillmentProviders.map((provider) => (
                          <option key={provider.id} value={provider.id}>
                            {provider.id || provider.code || provider.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="ldc-input mt-2"
                        value={shippingOptionDraft.provider_id}
                        onChange={handleShippingOptionDraftChange('provider_id')}
                      />
                    )}
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Shipping profile
                    {opsMeta.shippingProfiles.length ? (
                      <select
                        className="ldc-input mt-2"
                        value={shippingOptionDraft.shipping_profile_id}
                        onChange={handleShippingOptionDraftChange('shipping_profile_id')}
                      >
                        <option value="">Select profile</option>
                        {opsMeta.shippingProfiles.map((profile) => (
                          <option key={profile.id} value={profile.id}>
                            {profile.name || profile.id}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="ldc-input mt-2"
                        value={shippingOptionDraft.shipping_profile_id}
                        onChange={handleShippingOptionDraftChange('shipping_profile_id')}
                      />
                    )}
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Service zone
                    {opsMeta.serviceZones.length ? (
                      <select
                        className="ldc-input mt-2"
                        value={shippingOptionDraft.service_zone_id}
                        onChange={handleShippingOptionDraftChange('service_zone_id')}
                      >
                        <option value="">Select zone</option>
                        {opsMeta.serviceZones.map((zone) => (
                          <option key={zone.id} value={zone.id}>
                            {zone.name || zone.id}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="ldc-input mt-2"
                        value={shippingOptionDraft.service_zone_id}
                        onChange={handleShippingOptionDraftChange('service_zone_id')}
                      />
                    )}
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Type ID (optional)
                    <input
                      className="ldc-input mt-2"
                      value={shippingOptionDraft.type_id}
                      onChange={handleShippingOptionDraftChange('type_id')}
                      placeholder="shiptype_..."
                    />
                  </label>
                </div>

                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                    Prices (major units)
                  </div>
                  <div className="mt-2 space-y-2">
                    {(shippingOptionDraft.prices.length
                      ? shippingOptionDraft.prices
                      : [{ amount: '', currency_code: '', region_id: '' }]
                    ).map((price, index) => (
                      <div key={`shipping-price-${index}`} className="flex flex-wrap items-center gap-2">
                        <input
                          className="ldc-input h-10 w-28"
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          value={price.amount}
                          onChange={handleShippingOptionPriceChange(index, 'amount')}
                        />
                        <input
                          className="ldc-input h-10 w-24"
                          placeholder="USD"
                          value={price.currency_code}
                          onChange={handleShippingOptionPriceChange(index, 'currency_code')}
                        />
                        {opsMeta.regions.length ? (
                          <select
                            className="ldc-input h-10"
                            value={price.region_id}
                            onChange={handleShippingOptionPriceChange(index, 'region_id')}
                          >
                            <option value="">Region</option>
                            {opsMeta.regions.map((region) => (
                              <option key={region.id} value={region.id}>
                                {region.name || region.id}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            className="ldc-input h-10 w-40"
                            placeholder="Region id"
                            value={price.region_id}
                            onChange={handleShippingOptionPriceChange(index, 'region_id')}
                          />
                        )}
                        <button
                          className="ldc-button-secondary"
                          type="button"
                          onClick={() => handleRemoveShippingOptionPrice(index)}
                          disabled={shippingOptionDraft.prices.length <= 1}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    <button
                      className="ldc-button-secondary"
                      type="button"
                      onClick={handleAddShippingOptionPrice}
                    >
                      Add price
                    </button>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Type label (optional)
                    <input
                      className="ldc-input mt-2"
                      value={shippingOptionDraft.type_label}
                      onChange={handleShippingOptionDraftChange('type_label')}
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Type code (optional)
                    <input
                      className="ldc-input mt-2"
                      value={shippingOptionDraft.type_code}
                      onChange={handleShippingOptionDraftChange('type_code')}
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Type description (optional)
                    <input
                      className="ldc-input mt-2"
                      value={shippingOptionDraft.type_description}
                      onChange={handleShippingOptionDraftChange('type_description')}
                    />
                  </label>
                </div>

                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Provider data (optional)
                  <textarea
                    className="ldc-input mt-2 min-h-[90px] font-mono text-xs"
                    value={shippingOptionDraft.data}
                    onChange={handleShippingOptionDraftChange('data')}
                    placeholder='{"service":"standard"}'
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Metadata (optional)
                  <textarea
                    className="ldc-input mt-2 min-h-[90px] font-mono text-xs"
                    value={shippingOptionDraft.metadata}
                    onChange={handleShippingOptionDraftChange('metadata')}
                    placeholder='{"notes":"fragile"}'
                  />
                </label>

                <div className="flex flex-wrap items-center gap-4 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-ldc-plum"
                      checked={shippingOptionDraft.enabled_in_store}
                      onChange={handleShippingOptionDraftChange('enabled_in_store')}
                    />
                    Enabled in store
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-ldc-plum"
                      checked={shippingOptionDraft.is_return}
                      onChange={handleShippingOptionDraftChange('is_return')}
                    />
                    Return shipping
                  </label>
                </div>

                {opsMetaLoading ? (
                  <div className="text-xs text-ldc-ink/60">Loading settings...</div>
                ) : null}
                {opsMetaError ? (
                  <div className="text-sm text-rose-600">{opsMetaError}</div>
                ) : null}
                {renderOpsMetaFailures('text-xs text-ldc-ink/60')}
                {shippingOptionState.error ? (
                  <div className="text-sm text-rose-600">{shippingOptionState.error}</div>
                ) : null}
                {shippingOptionState.success ? (
                  <div className="text-sm text-emerald-700">{shippingOptionState.success}</div>
                ) : null}

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    className="ldc-button-primary"
                    type="submit"
                    disabled={shippingOptionState.saving}
                  >
                    {shippingOptionState.saving ? 'Saving...' : 'Save shipping option'}
                  </button>
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={handleDeleteShippingOption}
                    disabled={shippingOptionState.deleting}
                  >
                    {shippingOptionState.deleting ? 'Deleting...' : 'Delete shipping option'}
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {isTaxRegion ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">Tax Region</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Manage the location and provider used for taxes.
              </p>
              <form className="mt-4 grid gap-4 md:grid-cols-3" onSubmit={handleSaveTaxRegion}>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Country code
                  <input
                    className="ldc-input mt-2"
                    value={taxRegionDraft.country_code}
                    onChange={handleTaxRegionDraftChange('country_code')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Province code (optional)
                  <input
                    className="ldc-input mt-2"
                    value={taxRegionDraft.province_code}
                    onChange={handleTaxRegionDraftChange('province_code')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Tax provider (optional)
                  {opsMeta.taxProviders.length ? (
                    <select
                      className="ldc-input mt-2"
                      value={taxRegionDraft.provider_id}
                      onChange={handleTaxRegionDraftChange('provider_id')}
                    >
                      <option value="">Select provider</option>
                      {opsMeta.taxProviders.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.id || provider.code || provider.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="ldc-input mt-2"
                      value={taxRegionDraft.provider_id}
                      onChange={handleTaxRegionDraftChange('provider_id')}
                    />
                  )}
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Parent tax region (optional)
                  {opsMeta.taxRegions.length ? (
                    <select
                      className="ldc-input mt-2"
                      value={taxRegionDraft.parent_id}
                      onChange={handleTaxRegionDraftChange('parent_id')}
                    >
                      <option value="">No parent</option>
                      {opsMeta.taxRegions
                        .filter((region) => region.id !== record?.id)
                        .map((region) => (
                          <option key={region.id} value={region.id}>
                            {region.country_code || region.name || region.id}
                          </option>
                        ))}
                    </select>
                  ) : (
                    <input
                      className="ldc-input mt-2"
                      value={taxRegionDraft.parent_id}
                      onChange={handleTaxRegionDraftChange('parent_id')}
                    />
                  )}
                </label>
                <label className="md:col-span-3 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Metadata (optional)
                  <textarea
                    className="ldc-input mt-2 min-h-[90px] font-mono text-xs"
                    value={taxRegionDraft.metadata}
                    onChange={handleTaxRegionDraftChange('metadata')}
                    placeholder='{"jurisdiction":"state"}'
                  />
                </label>
                {opsMetaLoading ? (
                  <div className="md:col-span-3 text-xs text-ldc-ink/60">
                    Loading tax providers...
                  </div>
                ) : null}
                {opsMetaError ? (
                  <div className="md:col-span-3 text-sm text-rose-600">{opsMetaError}</div>
                ) : null}
                {renderOpsMetaFailures('md:col-span-3 text-xs text-ldc-ink/60')}
                {taxRegionState.error ? (
                  <div className="md:col-span-3 text-sm text-rose-600">
                    {taxRegionState.error}
                  </div>
                ) : null}
                {taxRegionState.success ? (
                  <div className="md:col-span-3 text-sm text-emerald-700">
                    {taxRegionState.success}
                  </div>
                ) : null}
                <div className="md:col-span-3 flex flex-wrap items-center gap-3">
                  <button
                    className="ldc-button-primary"
                    type="submit"
                    disabled={taxRegionState.saving}
                  >
                    {taxRegionState.saving ? 'Saving...' : 'Save tax region'}
                  </button>
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={handleDeleteTaxRegion}
                    disabled={taxRegionState.deleting}
                  >
                    {taxRegionState.deleting ? 'Deleting...' : 'Delete tax region'}
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {isTaxRate ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">Tax Rate</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Manage percentage and tax region assignment.
              </p>
              <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={handleSaveTaxRate}>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Name
                  <input
                    className="ldc-input mt-2"
                    value={taxRateDraft.name}
                    onChange={handleTaxRateDraftChange('name')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Code
                  <input
                    className="ldc-input mt-2"
                    value={taxRateDraft.code}
                    onChange={handleTaxRateDraftChange('code')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Rate (%)
                  <input
                    className="ldc-input mt-2"
                    type="number"
                    min="0"
                    step="0.01"
                    value={taxRateDraft.rate}
                    onChange={handleTaxRateDraftChange('rate')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Tax region
                  {opsMeta.taxRegions.length ? (
                    <select
                      className="ldc-input mt-2"
                      value={taxRateDraft.tax_region_id}
                      onChange={handleTaxRateDraftChange('tax_region_id')}
                    >
                      <option value="">Select tax region</option>
                      {opsMeta.taxRegions.map((region) => (
                        <option key={region.id} value={region.id}>
                          {region.country_code || region.name || region.id}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="ldc-input mt-2"
                      value={taxRateDraft.tax_region_id}
                      onChange={handleTaxRateDraftChange('tax_region_id')}
                    />
                  )}
                </label>
                <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-ldc-plum"
                    checked={taxRateDraft.is_default}
                    onChange={handleTaxRateDraftChange('is_default')}
                  />
                  Default tax rate
                </label>
                <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-ldc-plum"
                    checked={taxRateDraft.is_combinable}
                    onChange={handleTaxRateDraftChange('is_combinable')}
                  />
                  Combinable with other rates
                </label>

                <div className="md:col-span-2 rounded-2xl bg-white/70 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                    Rules (optional)
                  </div>
                  <p className="mt-2 text-sm text-ldc-ink/70">
                    Target specific products or shipping options for this tax rate.
                  </p>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                        Collections
                      </div>
                      <div className="mt-2 max-h-40 space-y-2 overflow-y-auto rounded-2xl bg-white/60 p-3">
                        {taxRateRuleMeta.collections.length ? (
                          taxRateRuleMeta.collections.map((collection) => (
                            <label
                              key={collection.id}
                              className="flex items-center gap-2 text-xs text-ldc-ink/80"
                            >
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-ldc-plum"
                                checked={taxRateRuleDraft.product_collection_ids.includes(collection.id)}
                                onChange={() =>
                                  handleTaxRateRuleToggle('product_collection_ids', collection.id)
                                }
                              />
                              <span>{collection.title || collection.handle || collection.id}</span>
                            </label>
                          ))
                        ) : (
                          <div className="text-xs text-ldc-ink/60">No collections found.</div>
                        )}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                        Categories
                      </div>
                      <div className="mt-2 max-h-40 space-y-2 overflow-y-auto rounded-2xl bg-white/60 p-3">
                        {taxRateRuleMeta.categories.length ? (
                          taxRateRuleMeta.categories.map((category) => (
                            <label
                              key={category.id}
                              className="flex items-center gap-2 text-xs text-ldc-ink/80"
                            >
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-ldc-plum"
                                checked={taxRateRuleDraft.product_category_ids.includes(category.id)}
                                onChange={() =>
                                  handleTaxRateRuleToggle('product_category_ids', category.id)
                                }
                              />
                              <span>{category.name || category.handle || category.id}</span>
                            </label>
                          ))
                        ) : (
                          <div className="text-xs text-ldc-ink/60">No categories found.</div>
                        )}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                        Tags
                      </div>
                      <div className="mt-2 max-h-40 space-y-2 overflow-y-auto rounded-2xl bg-white/60 p-3">
                        {taxRateRuleMeta.tags.length ? (
                          taxRateRuleMeta.tags.map((tag) => (
                            <label key={tag.id} className="flex items-center gap-2 text-xs text-ldc-ink/80">
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-ldc-plum"
                                checked={taxRateRuleDraft.product_tag_ids.includes(tag.id)}
                                onChange={() => handleTaxRateRuleToggle('product_tag_ids', tag.id)}
                              />
                              <span>{tag.value || tag.id}</span>
                            </label>
                          ))
                        ) : (
                          <div className="text-xs text-ldc-ink/60">No tags found.</div>
                        )}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                        Types
                      </div>
                      <div className="mt-2 max-h-40 space-y-2 overflow-y-auto rounded-2xl bg-white/60 p-3">
                        {taxRateRuleMeta.types.length ? (
                          taxRateRuleMeta.types.map((type) => (
                            <label key={type.id} className="flex items-center gap-2 text-xs text-ldc-ink/80">
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-ldc-plum"
                                checked={taxRateRuleDraft.product_type_ids.includes(type.id)}
                                onChange={() => handleTaxRateRuleToggle('product_type_ids', type.id)}
                              />
                              <span>{type.value || type.name || type.id}</span>
                            </label>
                          ))
                        ) : (
                          <div className="text-xs text-ldc-ink/60">No types found.</div>
                        )}
                      </div>
                    </div>

                    <div className="md:col-span-2">
                      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                        Products
                      </div>
                      <div className="mt-2 grid gap-3 md:grid-cols-2">
                        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                          Search products
                          <input
                            className="ldc-input mt-2"
                            value={taxRateProductSearch.query}
                            onChange={handleTaxRateProductSearchChange}
                            placeholder="Search by title or handle"
                          />
                        </label>
                        <div className="rounded-2xl bg-white/80 p-3 text-xs text-ldc-ink/60">
                          {taxRateRuleDraft.product_ids.length
                            ? `${taxRateRuleDraft.product_ids.length} product(s) selected.`
                            : 'No products selected.'}
                        </div>
                      </div>

                      {taxRateProductSearch.loading ? (
                        <div className="mt-2 text-sm text-ldc-ink/60">Searching products...</div>
                      ) : null}
                      {taxRateProductSearch.error ? (
                        <div className="mt-2 text-sm text-rose-600">{taxRateProductSearch.error}</div>
                      ) : null}
                      {taxRateProductSearch.results.length ? (
                        <div className="mt-3 grid gap-2 md:grid-cols-2">
                          {taxRateProductSearch.results.map((product) => (
                            <button
                              key={product.id}
                              className="rounded-2xl border border-white/70 bg-white/70 px-3 py-2 text-left text-xs text-ldc-ink"
                              type="button"
                              onClick={() => handleSelectTaxRateProduct(product)}
                            >
                              <div className="font-semibold">
                                {product.title || product.handle || product.id}
                              </div>
                              <div className="text-ldc-ink/60">Handle {product.handle || '-'}</div>
                            </button>
                          ))}
                        </div>
                      ) : null}

                      {taxRateRuleDraft.product_ids.length ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {taxRateRuleDraft.product_ids.map((productId) => {
                            const product =
                              taxRateSelectedProducts.find((item) => item.id === productId) || null;
                            const label = product?.title || product?.handle || productId;
                            return (
                              <button
                                key={productId}
                                className="flex items-center gap-2 rounded-full border border-white/70 bg-white/70 px-3 py-1 text-xs text-ldc-ink"
                                type="button"
                                onClick={() => handleRemoveTaxRateProduct(productId)}
                              >
                                <span>{label}</span>
                                <span className="text-ldc-ink/50">x</span>
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>

                    <div className="md:col-span-2">
                      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                        Shipping options
                      </div>
                      <div className="mt-2 max-h-40 space-y-2 overflow-y-auto rounded-2xl bg-white/60 p-3">
                        {taxRateRuleMeta.shippingOptions.length ? (
                          taxRateRuleMeta.shippingOptions.map((option) => (
                            <label
                              key={option.id}
                              className="flex items-center gap-2 text-xs text-ldc-ink/80"
                            >
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-ldc-plum"
                                checked={taxRateRuleDraft.shipping_option_ids.includes(option.id)}
                                onChange={() =>
                                  handleTaxRateRuleToggle('shipping_option_ids', option.id)
                                }
                              />
                              <span>{option.name || option.id}</span>
                            </label>
                          ))
                        ) : (
                          <div className="text-xs text-ldc-ink/60">No shipping options found.</div>
                        )}
                      </div>
                    </div>
                  </div>

                  {taxRateRuleMetaLoading ? (
                    <div className="mt-3 text-xs text-ldc-ink/60">Loading tax rule metadata...</div>
                  ) : null}
                  {taxRateRuleMetaError ? (
                    <div className="mt-2 text-sm text-rose-600">{taxRateRuleMetaError}</div>
                  ) : null}
                </div>

                <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Metadata (optional)
                  <textarea
                    className="ldc-input mt-2 min-h-[90px] font-mono text-xs"
                    value={taxRateDraft.metadata}
                    onChange={handleTaxRateDraftChange('metadata')}
                    placeholder='{"jurisdiction":"CA"}'
                  />
                </label>
                {opsMetaLoading ? (
                  <div className="md:col-span-2 text-xs text-ldc-ink/60">
                    Loading tax regions...
                  </div>
                ) : null}
                {opsMetaError ? (
                  <div className="md:col-span-2 text-sm text-rose-600">{opsMetaError}</div>
                ) : null}
                {renderOpsMetaFailures('md:col-span-2 text-xs text-ldc-ink/60')}
                {taxRateState.error ? (
                  <div className="md:col-span-2 text-sm text-rose-600">
                    {taxRateState.error}
                  </div>
                ) : null}
                {taxRateState.success ? (
                  <div className="md:col-span-2 text-sm text-emerald-700">
                    {taxRateState.success}
                  </div>
                ) : null}
                <div className="md:col-span-2 flex flex-wrap items-center gap-3">
                  <button
                    className="ldc-button-primary"
                    type="submit"
                    disabled={taxRateState.saving}
                  >
                    {taxRateState.saving ? 'Saving...' : 'Save tax rate'}
                  </button>
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={handleDeleteTaxRate}
                    disabled={taxRateState.deleting}
                  >
                    {taxRateState.deleting ? 'Deleting...' : 'Delete tax rate'}
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {isReturnReason ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">Return Reason</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Manage reasons shown in return and exchange workflows.
              </p>
              <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={handleSaveReturnReason}>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Label
                  <input
                    className="ldc-input mt-2"
                    value={returnReasonDraft.label}
                    onChange={handleReturnReasonDraftChange('label')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Value
                  <input
                    className="ldc-input mt-2"
                    value={returnReasonDraft.value}
                    onChange={handleReturnReasonDraftChange('value')}
                  />
                </label>
                <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Description (optional)
                  <textarea
                    className="ldc-input mt-2 min-h-[90px]"
                    value={returnReasonDraft.description}
                    onChange={handleReturnReasonDraftChange('description')}
                  />
                </label>
                <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Parent reason (optional)
                  {returnReasonParentOptions.length ? (
                    <select
                      className="ldc-input mt-2"
                      value={returnReasonDraft.parent_return_reason_id}
                      onChange={handleReturnReasonDraftChange('parent_return_reason_id')}
                    >
                      <option value="">No parent</option>
                      {returnReasonParentOptions.map((reason) => (
                        <option key={reason.id} value={reason.id}>
                          {reason.label || reason.value || reason.id}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="ldc-input mt-2"
                      value={returnReasonDraft.parent_return_reason_id}
                      onChange={handleReturnReasonDraftChange('parent_return_reason_id')}
                      placeholder="rr_..."
                    />
                  )}
                  {returnReasonsLoading ? (
                    <div className="mt-2 text-xs text-ldc-ink/60">Loading return reasons...</div>
                  ) : null}
                </label>
                <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Metadata (optional)
                  <textarea
                    className="ldc-input mt-2 min-h-[90px] font-mono text-xs"
                    value={returnReasonDraft.metadata}
                    onChange={handleReturnReasonDraftChange('metadata')}
                    placeholder='{"priority":"high"}'
                  />
                </label>
                {returnReasonsError ? (
                  <div className="md:col-span-2 text-sm text-rose-600">
                    {returnReasonsError}
                  </div>
                ) : null}
                {returnReasonState.error ? (
                  <div className="md:col-span-2 text-sm text-rose-600">
                    {returnReasonState.error}
                  </div>
                ) : null}
                {returnReasonState.success ? (
                  <div className="md:col-span-2 text-sm text-emerald-700">
                    {returnReasonState.success}
                  </div>
                ) : null}
                <div className="md:col-span-2 flex flex-wrap items-center gap-3">
                  <button
                    className="ldc-button-primary"
                    type="submit"
                    disabled={returnReasonState.saving}
                  >
                    {returnReasonState.saving ? 'Saving...' : 'Save return reason'}
                  </button>
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={handleDeleteReturnReason}
                    disabled={returnReasonState.deleting}
                  >
                    {returnReasonState.deleting ? 'Deleting...' : 'Delete return reason'}
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {isRefundReason ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">Refund Reason</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Manage reasons displayed when issuing refunds.
              </p>
              <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={handleSaveRefundReason}>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Label
                  <input
                    className="ldc-input mt-2"
                    value={refundReasonDraft.label}
                    onChange={handleRefundReasonDraftChange('label')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Code
                  <input
                    className="ldc-input mt-2"
                    value={refundReasonDraft.code}
                    onChange={handleRefundReasonDraftChange('code')}
                  />
                </label>
                <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Description (optional)
                  <textarea
                    className="ldc-input mt-2 min-h-[90px]"
                    value={refundReasonDraft.description}
                    onChange={handleRefundReasonDraftChange('description')}
                  />
                </label>
                {refundReasonState.error ? (
                  <div className="md:col-span-2 text-sm text-rose-600">
                    {refundReasonState.error}
                  </div>
                ) : null}
                {refundReasonState.success ? (
                  <div className="md:col-span-2 text-sm text-emerald-700">
                    {refundReasonState.success}
                  </div>
                ) : null}
                <div className="md:col-span-2 flex flex-wrap items-center gap-3">
                  <button
                    className="ldc-button-primary"
                    type="submit"
                    disabled={refundReasonState.saving}
                  >
                    {refundReasonState.saving ? 'Saving...' : 'Save refund reason'}
                  </button>
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={handleDeleteRefundReason}
                    disabled={refundReasonState.deleting}
                  >
                    {refundReasonState.deleting ? 'Deleting...' : 'Delete refund reason'}
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {isCustomer ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">Customer Profile</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Update customer profile details and metadata.
              </p>
              <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={handleSaveCustomer}>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Email
                  <input className="ldc-input mt-2" value={customerDraft.email} disabled />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Account status
                  <input
                    className="ldc-input mt-2"
                    value={record?.has_account ? 'Has account' : 'Guest'}
                    disabled
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  First name
                  <input
                    className="ldc-input mt-2"
                    value={customerDraft.first_name}
                    onChange={handleCustomerDraftChange('first_name')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Last name
                  <input
                    className="ldc-input mt-2"
                    value={customerDraft.last_name}
                    onChange={handleCustomerDraftChange('last_name')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Company
                  <input
                    className="ldc-input mt-2"
                    value={customerDraft.company_name}
                    onChange={handleCustomerDraftChange('company_name')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Phone
                  <input
                    className="ldc-input mt-2"
                    value={customerDraft.phone}
                    onChange={handleCustomerDraftChange('phone')}
                  />
                </label>
                <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Notes (saved in metadata.note)
                  <textarea
                    className="ldc-input mt-2 min-h-[80px]"
                    value={customerDraft.note}
                    onChange={handleCustomerDraftChange('note')}
                    placeholder="Add private notes for this customer."
                  />
                </label>
                <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Metadata (optional)
                  <textarea
                    className="ldc-input mt-2 min-h-[90px] font-mono text-xs"
                    value={customerDraft.metadata}
                    onChange={handleCustomerDraftChange('metadata')}
                    placeholder='{"loyalty":"gold"}'
                  />
                </label>

                {customerState.error ? (
                  <div className="md:col-span-2 text-sm text-rose-600">{customerState.error}</div>
                ) : null}
                {customerState.success ? (
                  <div className="md:col-span-2 text-sm text-emerald-700">
                    {customerState.success}
                  </div>
                ) : null}
                <div className="md:col-span-2 flex flex-wrap items-center gap-3">
                  <button
                    className="ldc-button-primary"
                    type="submit"
                    disabled={customerState.saving}
                  >
                    {customerState.saving ? 'Saving...' : 'Save customer'}
                  </button>
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={handleDeleteCustomer}
                    disabled={customerState.deleting}
                  >
                    {customerState.deleting ? 'Deleting...' : 'Delete customer'}
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {isCustomer ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">Customer Groups</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Assign this customer to groups for pricing and segmentation.
              </p>
              <div className="mt-4">
                <div className="max-h-48 space-y-2 overflow-y-auto rounded-2xl bg-white/70 p-4">
                  {customerGroupMeta.groups.length ? (
                    customerGroupMeta.groups.map((group) => (
                      <label key={group.id} className="flex items-center gap-2 text-xs text-ldc-ink/80">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-ldc-plum"
                          checked={customerGroupMembership.selected.includes(group.id)}
                          onChange={() => handleCustomerGroupMembershipToggle(group.id)}
                        />
                        <span>{group.name || group.id}</span>
                      </label>
                    ))
                  ) : (
                    <div className="text-xs text-ldc-ink/60">No customer groups found.</div>
                  )}
                </div>
                {customerGroupMetaLoading ? (
                  <div className="mt-2 text-xs text-ldc-ink/60">Loading groups...</div>
                ) : null}
                {customerGroupMetaError ? (
                  <div className="mt-2 text-sm text-rose-600">{customerGroupMetaError}</div>
                ) : null}
                {customerGroupMembershipState.error ? (
                  <div className="mt-2 text-sm text-rose-600">
                    {customerGroupMembershipState.error}
                  </div>
                ) : null}
                {customerGroupMembershipState.success ? (
                  <div className="mt-2 text-sm text-emerald-700">
                    {customerGroupMembershipState.success}
                  </div>
                ) : null}
                <button
                  className="ldc-button-primary mt-4"
                  type="button"
                  onClick={handleSaveCustomerGroups}
                  disabled={customerGroupMembershipState.saving}
                >
                  {customerGroupMembershipState.saving ? 'Saving...' : 'Save group membership'}
                </button>
              </div>
            </div>
          ) : null}

          {isCustomerGroup ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">Customer Group</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Update group metadata and messaging notes.
              </p>
              <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={handleSaveCustomerGroup}>
                <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Name
                  <input
                    className="ldc-input mt-2"
                    value={customerGroupDraft.name}
                    onChange={handleCustomerGroupDraftChange('name')}
                  />
                </label>
                <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Notes (saved in metadata.note)
                  <textarea
                    className="ldc-input mt-2 min-h-[80px]"
                    value={customerGroupDraft.note}
                    onChange={handleCustomerGroupDraftChange('note')}
                    placeholder="Internal notes for this group."
                  />
                </label>
                <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Metadata (optional)
                  <textarea
                    className="ldc-input mt-2 min-h-[90px] font-mono text-xs"
                    value={customerGroupDraft.metadata}
                    onChange={handleCustomerGroupDraftChange('metadata')}
                    placeholder='{"tier":"vip"}'
                  />
                </label>
                {customerGroupState.error ? (
                  <div className="md:col-span-2 text-sm text-rose-600">
                    {customerGroupState.error}
                  </div>
                ) : null}
                {customerGroupState.success ? (
                  <div className="md:col-span-2 text-sm text-emerald-700">
                    {customerGroupState.success}
                  </div>
                ) : null}
                <div className="md:col-span-2 flex flex-wrap items-center gap-3">
                  <button
                    className="ldc-button-primary"
                    type="submit"
                    disabled={customerGroupState.saving}
                  >
                    {customerGroupState.saving ? 'Saving...' : 'Save group'}
                  </button>
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={handleDeleteCustomerGroup}
                    disabled={customerGroupState.deleting}
                  >
                    {customerGroupState.deleting ? 'Deleting...' : 'Delete group'}
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {isCustomerGroup ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">Group Members</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Add or remove customers in this group.
              </p>
              <div className="mt-4 space-y-3">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Search customers
                  <input
                    className="ldc-input mt-2"
                    value={groupCustomerSearch.query}
                    onChange={handleGroupCustomerSearchChange}
                    placeholder="Search by name or email"
                  />
                </label>
                {groupCustomerSearch.loading ? (
                  <div className="text-sm text-ldc-ink/60">Searching customers...</div>
                ) : null}
                {groupCustomerSearch.error ? (
                  <div className="text-sm text-rose-600">{groupCustomerSearch.error}</div>
                ) : null}
                {groupCustomerSearch.results.length ? (
                  <div className="grid gap-2 md:grid-cols-2">
                    {groupCustomerSearch.results.map((customer) => (
                      <button
                        key={customer.id}
                        className="rounded-2xl border border-white/70 bg-white/70 px-3 py-2 text-left text-xs text-ldc-ink"
                        type="button"
                        onClick={() => handleSelectGroupCustomer(customer)}
                      >
                        <div className="font-semibold">
                          {customer.first_name || customer.last_name
                            ? `${customer.first_name || ''} ${customer.last_name || ''}`.trim()
                            : customer.email || customer.id}
                        </div>
                        <div className="text-ldc-ink/60">{customer.email || customer.id}</div>
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="rounded-2xl bg-white/70 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                    Selected customers
                  </div>
                  {groupCustomerMembership.selected.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {groupCustomerMembership.selected.map((customerId) => {
                        const customer =
                          groupCustomerSelected.find((item) => item.id === customerId) || null;
                        const label = customer?.email || customer?.id || customerId;
                        const name = customer
                          ? `${customer.first_name || ''} ${customer.last_name || ''}`.trim()
                          : '';
                        return (
                          <button
                            key={customerId}
                            className="flex items-center gap-2 rounded-full border border-white/70 bg-white/70 px-3 py-1 text-xs text-ldc-ink"
                            type="button"
                            onClick={() => handleRemoveGroupCustomer(customerId)}
                          >
                            <span>{name || label}</span>
                            <span className="text-ldc-ink/50">x</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="mt-2 text-xs text-ldc-ink/60">No customers selected.</div>
                  )}
                </div>

                {groupCustomerState.error ? (
                  <div className="text-sm text-rose-600">{groupCustomerState.error}</div>
                ) : null}
                {groupCustomerState.success ? (
                  <div className="text-sm text-emerald-700">{groupCustomerState.success}</div>
                ) : null}
                <button
                  className="ldc-button-primary"
                  type="button"
                  onClick={handleSaveGroupCustomers}
                  disabled={groupCustomerState.saving}
                >
                  {groupCustomerState.saving ? 'Saving...' : 'Save group members'}
                </button>
              </div>
            </div>
          ) : null}

          {isPromotion ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">Promotion</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Update promotion rules, dates, and application method.
              </p>
              <form className="mt-4 space-y-4" onSubmit={handleSavePromotion}>
                <div className="grid gap-4 md:grid-cols-3">
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Code
                    <input
                      className="ldc-input mt-2"
                      value={promotionDraft.code}
                      onChange={handlePromotionDraftChange('code')}
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Status (optional)
                    <input
                      className="ldc-input mt-2"
                      value={promotionDraft.status}
                      onChange={handlePromotionDraftChange('status')}
                      placeholder="draft"
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Type
                    <input
                      className="ldc-input mt-2"
                      value={promotionDraft.type}
                      onChange={handlePromotionDraftChange('type')}
                      placeholder="standard"
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Campaign (optional)
                    {merchMeta.campaigns.length ? (
                      <select
                        className="ldc-input mt-2"
                        value={promotionDraft.campaign_id}
                        onChange={handlePromotionDraftChange('campaign_id')}
                      >
                        <option value="">No campaign</option>
                        {merchMeta.campaigns.map((campaign) => (
                          <option key={campaign.id} value={campaign.id}>
                            {campaign.name || campaign.id}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="ldc-input mt-2"
                        value={promotionDraft.campaign_id}
                        onChange={handlePromotionDraftChange('campaign_id')}
                        placeholder="campaign id"
                      />
                    )}
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Starts at (optional)
                    <input
                      className="ldc-input mt-2"
                      type="datetime-local"
                      value={promotionDraft.starts_at}
                      onChange={handlePromotionDraftChange('starts_at')}
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Ends at (optional)
                    <input
                      className="ldc-input mt-2"
                      type="datetime-local"
                      value={promotionDraft.ends_at}
                      onChange={handlePromotionDraftChange('ends_at')}
                    />
                  </label>
                </div>

                <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-ldc-plum"
                    checked={promotionDraft.is_automatic}
                    onChange={handlePromotionDraftChange('is_automatic')}
                  />
                  Automatic promotion
                </label>

                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Description (optional)
                  <textarea
                    className="ldc-input mt-2 min-h-[80px]"
                    value={promotionDraft.description}
                    onChange={handlePromotionDraftChange('description')}
                  />
                </label>

                <div className="rounded-2xl bg-white/70 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                    Application method (optional)
                  </div>
                  <div className="mt-3 grid gap-4 md:grid-cols-3">
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                      Method type
                      <select
                        className="ldc-input mt-2"
                        value={promotionDraft.application_method_type}
                        onChange={handlePromotionDraftChange('application_method_type')}
                      >
                        <option value="">Select type</option>
                        <option value="percentage">Percentage</option>
                        <option value="fixed">Fixed</option>
                      </select>
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                      Value
                      <input
                        className="ldc-input mt-2"
                        value={promotionDraft.application_method_value}
                        onChange={handlePromotionDraftChange('application_method_value')}
                        placeholder="10"
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                      Currency (for fixed)
                      <input
                        className="ldc-input mt-2"
                        value={promotionDraft.application_method_currency}
                        onChange={handlePromotionDraftChange('application_method_currency')}
                        placeholder="usd"
                      />
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                      Target
                      <select
                        className="ldc-input mt-2"
                        value={promotionDraft.application_method_target}
                        onChange={handlePromotionDraftChange('application_method_target')}
                      >
                        <option value="items">Items</option>
                        <option value="shipping_methods">Shipping</option>
                        <option value="order">Order</option>
                      </select>
                    </label>
                    <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                      Allocation
                      <select
                        className="ldc-input mt-2"
                        value={promotionDraft.application_method_allocation}
                        onChange={handlePromotionDraftChange('application_method_allocation')}
                      >
                        <option value="across">Across</option>
                        <option value="each">Each</option>
                      </select>
                    </label>
                  </div>
                </div>

                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Advanced JSON (optional)
                  <textarea
                    className="ldc-input mt-2 min-h-[80px] font-mono text-xs"
                    value={promotionDraft.extra}
                    onChange={handlePromotionDraftChange('extra')}
                    placeholder='{"rules":[{"attribute":"customer_group_id","operator":"in","value":["cg_..."]}]}'
                  />
                </label>

                {merchMetaLoading ? (
                  <div className="text-xs text-ldc-ink/60">Loading campaigns...</div>
                ) : null}
                {merchMetaError ? (
                  <div className="text-sm text-rose-600">{merchMetaError}</div>
                ) : null}
                {promotionState.error ? (
                  <div className="text-sm text-rose-600">{promotionState.error}</div>
                ) : null}
                {promotionState.success ? (
                  <div className="text-sm text-emerald-700">{promotionState.success}</div>
                ) : null}
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    className="ldc-button-primary"
                    type="submit"
                    disabled={promotionState.saving}
                  >
                    {promotionState.saving ? 'Saving...' : 'Save promotion'}
                  </button>
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={handleDeletePromotion}
                    disabled={promotionState.deleting}
                  >
                    {promotionState.deleting ? 'Deleting...' : 'Delete promotion'}
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {isCampaign ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">Campaign</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Update campaign timing and budgeting metadata.
              </p>
              <form className="mt-4 space-y-4" onSubmit={handleSaveCampaign}>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Name
                    <input
                      className="ldc-input mt-2"
                      value={campaignDraft.name}
                      onChange={handleCampaignDraftChange('name')}
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Description (optional)
                    <input
                      className="ldc-input mt-2"
                      value={campaignDraft.description}
                      onChange={handleCampaignDraftChange('description')}
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Starts at (optional)
                    <input
                      className="ldc-input mt-2"
                      type="datetime-local"
                      value={campaignDraft.starts_at}
                      onChange={handleCampaignDraftChange('starts_at')}
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Ends at (optional)
                    <input
                      className="ldc-input mt-2"
                      type="datetime-local"
                      value={campaignDraft.ends_at}
                      onChange={handleCampaignDraftChange('ends_at')}
                    />
                  </label>
                </div>

                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Advanced JSON (optional)
                  <textarea
                    className="ldc-input mt-2 min-h-[80px] font-mono text-xs"
                    value={campaignDraft.extra}
                    onChange={handleCampaignDraftChange('extra')}
                    placeholder='{"budget":{"type":"spend","limit":5000,"currency_code":"usd"}}'
                  />
                </label>

                {campaignState.error ? (
                  <div className="text-sm text-rose-600">{campaignState.error}</div>
                ) : null}
                {campaignState.success ? (
                  <div className="text-sm text-emerald-700">{campaignState.success}</div>
                ) : null}
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    className="ldc-button-primary"
                    type="submit"
                    disabled={campaignState.saving}
                  >
                    {campaignState.saving ? 'Saving...' : 'Save campaign'}
                  </button>
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={handleDeleteCampaign}
                    disabled={campaignState.deleting}
                  >
                    {campaignState.deleting ? 'Deleting...' : 'Delete campaign'}
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {isPriceList ? (
            <div className="ldc-card p-6">
              <h3 className="font-heading text-xl text-ldc-ink">Price List</h3>
              <p className="mt-2 text-sm text-ldc-ink/70">
                Manage pricing windows and list settings.
              </p>
              <form className="mt-4 space-y-4" onSubmit={handleSavePriceList}>
                <div className="grid gap-4 md:grid-cols-3">
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Title
                    <input
                      className="ldc-input mt-2"
                      value={priceListDraft.title}
                      onChange={handlePriceListDraftChange('title')}
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Status
                    <select
                      className="ldc-input mt-2"
                      value={priceListDraft.status}
                      onChange={handlePriceListDraftChange('status')}
                    >
                      <option value="draft">Draft</option>
                      <option value="active">Active</option>
                    </select>
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Type
                    <select
                      className="ldc-input mt-2"
                      value={priceListDraft.type}
                      onChange={handlePriceListDraftChange('type')}
                    >
                      <option value="sale">Sale</option>
                      <option value="override">Override</option>
                    </select>
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Starts at (optional)
                    <input
                      className="ldc-input mt-2"
                      type="datetime-local"
                      value={priceListDraft.starts_at}
                      onChange={handlePriceListDraftChange('starts_at')}
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Ends at (optional)
                    <input
                      className="ldc-input mt-2"
                      type="datetime-local"
                      value={priceListDraft.ends_at}
                      onChange={handlePriceListDraftChange('ends_at')}
                    />
                  </label>
                </div>

                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Description (optional)
                  <textarea
                    className="ldc-input mt-2 min-h-[80px]"
                    value={priceListDraft.description}
                    onChange={handlePriceListDraftChange('description')}
                  />
                </label>

                <div className="rounded-2xl bg-white/70 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                    Conditions (optional)
                  </div>
                  <p className="mt-2 text-sm text-ldc-ink/70">
                    Limit this price list to specific customer groups or catalog items.
                  </p>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                        Customer groups
                      </div>
                      <div className="mt-2 max-h-40 space-y-2 overflow-y-auto rounded-2xl bg-white/60 p-3">
                        {priceListRuleMeta.customerGroups.length ? (
                          priceListRuleMeta.customerGroups.map((group) => (
                            <label
                              key={group.id}
                              className="flex items-center gap-2 text-xs text-ldc-ink/80"
                            >
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-ldc-plum"
                                checked={priceListRuleDraft.customer_group_ids.includes(group.id)}
                                onChange={() => handlePriceListRuleToggle('customer_group_ids', group.id)}
                              />
                              <span>{group.name || group.id}</span>
                            </label>
                          ))
                        ) : (
                          <div className="text-xs text-ldc-ink/60">No customer groups found.</div>
                        )}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                        Collections
                      </div>
                      <div className="mt-2 max-h-40 space-y-2 overflow-y-auto rounded-2xl bg-white/60 p-3">
                        {priceListRuleMeta.collections.length ? (
                          priceListRuleMeta.collections.map((collection) => (
                            <label
                              key={collection.id}
                              className="flex items-center gap-2 text-xs text-ldc-ink/80"
                            >
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-ldc-plum"
                                checked={priceListRuleDraft.collection_ids.includes(collection.id)}
                                onChange={() => handlePriceListRuleToggle('collection_ids', collection.id)}
                              />
                              <span>{collection.title || collection.handle || collection.id}</span>
                            </label>
                          ))
                        ) : (
                          <div className="text-xs text-ldc-ink/60">No collections found.</div>
                        )}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                        Categories
                      </div>
                      <div className="mt-2 max-h-40 space-y-2 overflow-y-auto rounded-2xl bg-white/60 p-3">
                        {priceListRuleMeta.categories.length ? (
                          priceListRuleMeta.categories.map((category) => (
                            <label
                              key={category.id}
                              className="flex items-center gap-2 text-xs text-ldc-ink/80"
                            >
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-ldc-plum"
                                checked={priceListRuleDraft.category_ids.includes(category.id)}
                                onChange={() => handlePriceListRuleToggle('category_ids', category.id)}
                              />
                              <span>{category.name || category.handle || category.id}</span>
                            </label>
                          ))
                        ) : (
                          <div className="text-xs text-ldc-ink/60">No categories found.</div>
                        )}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                        Tags
                      </div>
                      <div className="mt-2 max-h-40 space-y-2 overflow-y-auto rounded-2xl bg-white/60 p-3">
                        {priceListRuleMeta.tags.length ? (
                          priceListRuleMeta.tags.map((tag) => (
                            <label
                              key={tag.id}
                              className="flex items-center gap-2 text-xs text-ldc-ink/80"
                            >
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-ldc-plum"
                                checked={priceListRuleDraft.tag_ids.includes(tag.id)}
                                onChange={() => handlePriceListRuleToggle('tag_ids', tag.id)}
                              />
                              <span>{tag.value || tag.id}</span>
                            </label>
                          ))
                        ) : (
                          <div className="text-xs text-ldc-ink/60">No tags found.</div>
                        )}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                        Types
                      </div>
                      <div className="mt-2 max-h-40 space-y-2 overflow-y-auto rounded-2xl bg-white/60 p-3">
                        {priceListRuleMeta.types.length ? (
                          priceListRuleMeta.types.map((type) => (
                            <label
                              key={type.id}
                              className="flex items-center gap-2 text-xs text-ldc-ink/80"
                            >
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-ldc-plum"
                                checked={priceListRuleDraft.type_ids.includes(type.id)}
                                onChange={() => handlePriceListRuleToggle('type_ids', type.id)}
                              />
                              <span>{type.value || type.name || type.id}</span>
                            </label>
                          ))
                        ) : (
                          <div className="text-xs text-ldc-ink/60">No types found.</div>
                        )}
                      </div>
                    </div>

                    <div className="md:col-span-2">
                      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                        Products
                      </div>
                      <div className="mt-2 grid gap-3 md:grid-cols-2">
                        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                          Search products
                          <input
                            className="ldc-input mt-2"
                            value={priceListProductSearch.query}
                            onChange={handlePriceListProductSearchChange}
                            placeholder="Search by title or handle"
                          />
                        </label>
                        <div className="rounded-2xl bg-white/80 p-3 text-xs text-ldc-ink/60">
                          {priceListRuleDraft.product_ids.length
                            ? `${priceListRuleDraft.product_ids.length} product(s) selected.`
                            : 'No products selected.'}
                        </div>
                      </div>

                      {priceListProductSearch.loading ? (
                        <div className="mt-2 text-sm text-ldc-ink/60">Searching products...</div>
                      ) : null}
                      {priceListProductSearch.error ? (
                        <div className="mt-2 text-sm text-rose-600">
                          {priceListProductSearch.error}
                        </div>
                      ) : null}
                      {priceListProductSearch.results.length ? (
                        <div className="mt-3 grid gap-2 md:grid-cols-2">
                          {priceListProductSearch.results.map((product) => (
                            <button
                              key={product.id}
                              className="rounded-2xl border border-white/70 bg-white/70 px-3 py-2 text-left text-xs text-ldc-ink"
                              type="button"
                              onClick={() => handleSelectPriceListProduct(product)}
                            >
                              <div className="font-semibold">
                                {product.title || product.handle || product.id}
                              </div>
                              <div className="text-ldc-ink/60">
                                Handle {product.handle || '-'}
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : null}

                      {priceListRuleDraft.product_ids.length ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {priceListRuleDraft.product_ids.map((productId) => {
                            const product =
                              priceListSelectedProducts.find((item) => item.id === productId) ||
                              null;
                            const label = product?.title || product?.handle || productId;
                            return (
                              <button
                                key={productId}
                                className="flex items-center gap-2 rounded-full border border-white/70 bg-white/70 px-3 py-1 text-xs text-ldc-ink"
                                type="button"
                                onClick={() => handleRemovePriceListProduct(productId)}
                              >
                                <span>{label}</span>
                                <span className="text-ldc-ink/50">x</span>
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {priceListRuleMetaLoading ? (
                    <div className="mt-3 text-xs text-ldc-ink/60">
                      Loading price list conditions...
                    </div>
                  ) : null}
                  {priceListRuleMetaError ? (
                    <div className="mt-2 text-sm text-rose-600">{priceListRuleMetaError}</div>
                  ) : null}
                </div>

                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Advanced JSON (optional)
                  <textarea
                    className="ldc-input mt-2 min-h-[80px] font-mono text-xs"
                    value={priceListDraft.extra}
                    onChange={handlePriceListDraftChange('extra')}
                    placeholder='{"rules":[{"attribute":"customer_group_id","operator":"in","value":["cg_..."]}]}'
                  />
                </label>

                {priceListState.error ? (
                  <div className="text-sm text-rose-600">{priceListState.error}</div>
                ) : null}
                {priceListState.success ? (
                  <div className="text-sm text-emerald-700">{priceListState.success}</div>
                ) : null}
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    className="ldc-button-primary"
                    type="submit"
                    disabled={priceListState.saving}
                  >
                    {priceListState.saving ? 'Saving...' : 'Save price list'}
                  </button>
                  <button
                    className="ldc-button-secondary"
                    type="button"
                    onClick={handleDeletePriceList}
                    disabled={priceListState.deleting}
                  >
                    {priceListState.deleting ? 'Deleting...' : 'Delete price list'}
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {isPriceList ? (
            <div className="ldc-card p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-heading text-xl text-ldc-ink">Price List Prices</h3>
                  <p className="mt-2 text-sm text-ldc-ink/70">
                    Add, edit, and remove variant prices for this list.
                  </p>
                </div>
                <button
                  className="ldc-button-secondary"
                  type="button"
                  onClick={refreshPriceListPrices}
                  disabled={priceListPricesLoading}
                >
                  {priceListPricesLoading ? 'Refreshing...' : 'Refresh prices'}
                </button>
              </div>

              {priceListPricesError ? (
                <div className="mt-3 text-sm text-rose-600">{priceListPricesError}</div>
              ) : null}
              {priceListPriceState.error ? (
                <div className="mt-3 text-sm text-rose-600">{priceListPriceState.error}</div>
              ) : null}
              {priceListPriceState.success ? (
                <div className="mt-3 text-sm text-emerald-700">{priceListPriceState.success}</div>
              ) : null}

              <form className="mt-4 rounded-2xl bg-white/70 p-4" onSubmit={handleAddPriceListPrice}>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                  Add price
                </div>
                <div className="mt-3 grid gap-4 md:grid-cols-3">
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Variant ID
                    <input
                      className="ldc-input mt-2"
                      value={newPriceListPrice.variant_id}
                      onChange={handleNewPriceListPriceChange('variant_id')}
                      placeholder="variant_..."
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Price (major units)
                    <input
                      className="ldc-input mt-2"
                      type="number"
                      min="0"
                      step="0.01"
                      value={newPriceListPrice.amount}
                      onChange={handleNewPriceListPriceChange('amount')}
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Currency code
                    <input
                      className="ldc-input mt-2"
                      value={newPriceListPrice.currency_code}
                      onChange={handleNewPriceListPriceChange('currency_code')}
                      placeholder="usd"
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Region ID (optional)
                    <input
                      className="ldc-input mt-2"
                      value={newPriceListPrice.region_id}
                      onChange={handleNewPriceListPriceChange('region_id')}
                      placeholder="region_..."
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Min qty (optional)
                    <input
                      className="ldc-input mt-2"
                      type="number"
                      min="0"
                      value={newPriceListPrice.min_quantity}
                      onChange={handleNewPriceListPriceChange('min_quantity')}
                    />
                  </label>
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Max qty (optional)
                    <input
                      className="ldc-input mt-2"
                      type="number"
                      min="0"
                      value={newPriceListPrice.max_quantity}
                      onChange={handleNewPriceListPriceChange('max_quantity')}
                    />
                  </label>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                    Search variants (optional)
                    <input
                      className="ldc-input mt-2"
                      value={priceListVariantSearch.query}
                      onChange={handleVariantSearchChange}
                      placeholder="Search by title or SKU"
                    />
                  </label>
                  {selectedPriceListVariant ? (
                    <div className="rounded-2xl bg-white/80 p-3 text-xs text-ldc-ink/70">
                      Selected: {selectedPriceListVariant.title || selectedPriceListVariant.id}
                      {selectedPriceListVariant.sku ? ` · SKU ${selectedPriceListVariant.sku}` : ''}
                    </div>
                  ) : (
                    <div className="rounded-2xl bg-white/80 p-3 text-xs text-ldc-ink/60">
                      No variant selected.
                    </div>
                  )}
                </div>

                {priceListVariantSearch.loading ? (
                  <div className="mt-2 text-sm text-ldc-ink/60">Searching variants...</div>
                ) : null}
                {priceListVariantSearch.error ? (
                  <div className="mt-2 text-sm text-rose-600">{priceListVariantSearch.error}</div>
                ) : null}
                {priceListVariantSearch.results.length ? (
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {priceListVariantSearch.results.map((variant) => (
                      <button
                        key={variant.id}
                        className="rounded-2xl border border-white/70 bg-white/70 px-3 py-2 text-left text-xs text-ldc-ink"
                        type="button"
                        onClick={() => handleSelectPriceListVariant(variant)}
                      >
                        <div className="font-semibold">
                          {variant.product?.title || variant.title || variant.id}
                        </div>
                        <div className="text-ldc-ink/60">
                          {variant.title ? `${variant.title} · ` : ''}SKU {variant.sku || '-'}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}

                <button
                  className="ldc-button-primary mt-4"
                  type="submit"
                  disabled={priceListPriceState.savingId === 'new'}
                >
                  {priceListPriceState.savingId === 'new' ? 'Adding...' : 'Add price'}
                </button>
              </form>

              <div className="mt-6 space-y-4">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                  Existing prices
                </div>
                {priceListPricesLoading ? (
                  <div className="text-sm text-ldc-ink/60">Loading prices...</div>
                ) : null}
                {!priceListPricesLoading && priceListPrices.length ? (
                  priceListPrices.map((price) => {
                    const draft = priceListPriceDrafts[price.id] || {};
                    const variantLabel = getPriceListVariantLabel(price);
                    const sku = price?.variant?.sku || price?.variant_sku || '-';
                    return (
                      <div key={price.id} className="rounded-2xl bg-white/70 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-ldc-ink">{variantLabel}</div>
                            <div className="text-xs text-ldc-ink/60">SKU {sku}</div>
                            <div className="text-xs text-ldc-ink/50">Price ID {price.id}</div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              className="ldc-button-secondary"
                              type="button"
                              onClick={() => handleUpdatePriceListPrice(price.id)}
                              disabled={
                                priceListPriceState.savingId === price.id &&
                                priceListPriceState.action === 'update'
                              }
                            >
                              {priceListPriceState.savingId === price.id &&
                              priceListPriceState.action === 'update'
                                ? 'Saving...'
                                : 'Save'}
                            </button>
                            <button
                              className="ldc-button-secondary"
                              type="button"
                              onClick={() => handleDeletePriceListPrice(price.id)}
                              disabled={
                                priceListPriceState.savingId === price.id &&
                                priceListPriceState.action === 'delete'
                              }
                            >
                              {priceListPriceState.savingId === price.id &&
                              priceListPriceState.action === 'delete'
                                ? 'Removing...'
                                : 'Remove'}
                            </button>
                          </div>
                        </div>

                        <div className="mt-3 grid gap-4 md:grid-cols-3">
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Price (major units)
                            <input
                              className="ldc-input mt-2"
                              type="number"
                              min="0"
                              step="0.01"
                              value={draft.amount || ''}
                              onChange={handlePriceListPriceDraftChange(price.id, 'amount')}
                            />
                          </label>
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Currency
                            <input
                              className="ldc-input mt-2"
                              value={draft.currency_code || ''}
                              onChange={handlePriceListPriceDraftChange(price.id, 'currency_code')}
                            />
                          </label>
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Region ID (optional)
                            <input
                              className="ldc-input mt-2"
                              value={draft.region_id || ''}
                              onChange={handlePriceListPriceDraftChange(price.id, 'region_id')}
                            />
                          </label>
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Min qty
                            <input
                              className="ldc-input mt-2"
                              type="number"
                              min="0"
                              value={draft.min_quantity || ''}
                              onChange={handlePriceListPriceDraftChange(price.id, 'min_quantity')}
                            />
                          </label>
                          <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                            Max qty
                            <input
                              className="ldc-input mt-2"
                              type="number"
                              min="0"
                              value={draft.max_quantity || ''}
                              onChange={handlePriceListPriceDraftChange(price.id, 'max_quantity')}
                            />
                          </label>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-ldc-ink/60">No prices added yet.</p>
                )}
              </div>
            </div>
          ) : null}

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
