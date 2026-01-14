import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';
import { formatApiError, getList, request, uploadFiles } from '../lib/api.js';

const getArrayFromPayload = (payload, key) => {
  if (!payload) return [];
  if (key && Array.isArray(payload[key])) return payload[key];
  const candidate = Object.values(payload).find((value) => Array.isArray(value));
  return candidate || [];
};

const getCountFromPayload = (payload, fallbackLength) => {
  if (!payload) return fallbackLength;
  if (typeof payload.count === 'number') return payload.count;
  return fallbackLength;
};

const PRODUCT_STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'proposed', label: 'Proposed' },
  { value: 'published', label: 'Published' },
  { value: 'rejected', label: 'Rejected' }
];

const PRODUCT_ORDER_OPTIONS = [
  { value: '-created_at', label: 'Newest first' },
  { value: 'created_at', label: 'Oldest first' },
  { value: '-updated_at', label: 'Recently updated' },
  { value: 'title', label: 'Title A-Z' },
  { value: '-title', label: 'Title Z-A' }
];

const PRODUCT_PAGE_SIZES = [20, 50, 100];

const LIST_META_LABELS = {
  paymentProviders: 'Payment providers',
  fulfillmentProviders: 'Fulfillment providers',
  shippingProfiles: 'Shipping profiles',
  regions: 'Regions',
  serviceZones: 'Service zones',
  taxProviders: 'Tax providers',
  taxRegions: 'Tax regions',
  campaigns: 'Campaigns'
};

const parsePositiveInt = (value, fallback) => {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
};

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

const parsePriceInput = (value) => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * 100);
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

const parseDateTimeInput = (value) => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
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

const getUploadUrl = (file) =>
  file?.url || file?.file_url || file?.public_url || file?.uri || file?.id || '';

const getUploadName = (file) =>
  file?.filename || file?.name || file?.originalname || file?.id || 'File';

const getUploadType = (file) => file?.mime_type || file?.type || '';

const getFileExtension = (value) => {
  const match = String(value || '').match(/\.([a-z0-9]+)(?:\?|#|$)/i);
  return match ? match[1].toLowerCase() : '';
};

const isImageFile = (file) => {
  const mime = getUploadType(file);
  if (mime.startsWith('image/')) return true;
  const url = getUploadUrl(file) || getUploadName(file);
  const ext = getFileExtension(url);
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'].includes(ext);
};

const formatUploadLabel = (file) => {
  const mime = getUploadType(file);
  if (mime) return mime;
  const ext = getFileExtension(getUploadUrl(file) || getUploadName(file));
  return ext ? ext.toUpperCase() : 'FILE';
};

const MEDIA_BASE = (import.meta.env.VITE_MEDUSA_BACKEND_URL || 'https://api.lovettsldc.com')
  .replace(/\/$/, '');

const resolveUploadUrl = (file) => {
  const url = getUploadUrl(file);
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('/')) return `${MEDIA_BASE}${url}`;
  if (!url.includes('://') && url.includes('/')) return `${MEDIA_BASE}/${url}`;
  return '';
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

const formatOptionsList = (items) =>
  (items || [])
    .map((item) => item?.id || item?.code || item?.name || item?.label)
    .filter(Boolean)
    .join(', ');

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

const ResourceList = ({ resource }) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filtersLoading, setFiltersLoading] = useState(false);
  const [filtersError, setFiltersError] = useState('');
  const [productFilters, setProductFilters] = useState({
    collections: [],
    categories: [],
    salesChannels: [],
    types: [],
    tags: []
  });
  const [listMeta, setListMeta] = useState({
    paymentProviders: [],
    fulfillmentProviders: [],
    taxProviders: [],
    shippingProfiles: [],
    serviceZones: [],
    regions: [],
    taxRegions: [],
    campaigns: []
  });
  const [listMetaLoading, setListMetaLoading] = useState(false);
  const [listMetaError, setListMetaError] = useState('');
  const [listMetaFailures, setListMetaFailures] = useState([]);
  const [regionDraft, setRegionDraft] = useState({
    name: '',
    currency_code: '',
    countries: '',
    payment_providers: '',
    automatic_taxes: false,
    is_tax_inclusive: false,
    metadata: ''
  });
  const [regionCreateState, setRegionCreateState] = useState({
    saving: false,
    error: '',
    success: ''
  });
  const [shippingProfileDraft, setShippingProfileDraft] = useState({
    name: '',
    type: 'default',
    metadata: ''
  });
  const [shippingProfileCreateState, setShippingProfileCreateState] = useState({
    saving: false,
    error: '',
    success: ''
  });
  const [shippingOptionDraft, setShippingOptionDraft] = useState({
    name: '',
    price_type: 'flat',
    service_zone_id: '',
    shipping_profile_id: '',
    provider_id: '',
    prices: [{ amount: '', currency_code: '', region_id: '' }],
    type_id: '',
    type_label: '',
    type_code: '',
    type_description: '',
    data: '',
    metadata: '',
    enabled_in_store: true,
    is_return: false
  });
  const [shippingOptionCreateState, setShippingOptionCreateState] = useState({
    saving: false,
    error: '',
    success: ''
  });
  const [taxRegionDraft, setTaxRegionDraft] = useState({
    country_code: '',
    province_code: '',
    provider_id: '',
    parent_id: '',
    default_tax_rate_name: '',
    default_tax_rate_code: '',
    default_tax_rate_rate: '',
    default_tax_rate_is_combinable: false,
    default_tax_rate_metadata: '',
    metadata: ''
  });
  const [taxRegionCreateState, setTaxRegionCreateState] = useState({
    saving: false,
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
  const [taxRateCreateState, setTaxRateCreateState] = useState({
    saving: false,
    error: '',
    success: ''
  });
  const [returnReasonCreateDraft, setReturnReasonCreateDraft] = useState({
    value: '',
    label: '',
    description: '',
    parent_return_reason_id: '',
    metadata: ''
  });
  const [returnReasonCreateState, setReturnReasonCreateState] = useState({
    saving: false,
    error: '',
    success: ''
  });
  const [returnReasonMeta, setReturnReasonMeta] = useState({ reasons: [] });
  const [returnReasonMetaLoading, setReturnReasonMetaLoading] = useState(false);
  const [returnReasonMetaError, setReturnReasonMetaError] = useState('');
  const [refundReasonCreateDraft, setRefundReasonCreateDraft] = useState({
    label: '',
    code: '',
    description: ''
  });
  const [refundReasonCreateState, setRefundReasonCreateState] = useState({
    saving: false,
    error: '',
    success: ''
  });
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
  const [promotionCreateState, setPromotionCreateState] = useState({
    saving: false,
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
  const [campaignCreateState, setCampaignCreateState] = useState({
    saving: false,
    error: '',
    success: ''
  });
  const [priceListDraft, setPriceListDraft] = useState({
    title: '',
    description: '',
    status: 'draft',
    type: 'sale',
    starts_at: '',
    ends_at: '',
    extra: ''
  });
  const [priceListCreateState, setPriceListCreateState] = useState({
    saving: false,
    error: '',
    success: ''
  });
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
  const [customerCreateDraft, setCustomerCreateDraft] = useState({
    email: '',
    first_name: '',
    last_name: '',
    company_name: '',
    phone: '',
    note: '',
    metadata: ''
  });
  const [customerCreateState, setCustomerCreateState] = useState({
    saving: false,
    error: '',
    success: ''
  });
  const [customerCreateGroupIds, setCustomerCreateGroupIds] = useState([]);
  const [customerCreateMeta, setCustomerCreateMeta] = useState({ groups: [] });
  const [customerCreateMetaLoading, setCustomerCreateMetaLoading] = useState(false);
  const [customerCreateMetaError, setCustomerCreateMetaError] = useState('');
  const [customerGroupCreateDraft, setCustomerGroupCreateDraft] = useState({
    name: '',
    note: '',
    metadata: ''
  });
  const [customerGroupCreateState, setCustomerGroupCreateState] = useState({
    saving: false,
    error: '',
    success: ''
  });
  const [inventoryItemCreateDraft, setInventoryItemCreateDraft] = useState({
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
    metadata: '',
    location_id: '',
    stocked_quantity: '',
    incoming_quantity: ''
  });
  const [inventoryItemCreateState, setInventoryItemCreateState] = useState({
    saving: false,
    error: '',
    success: ''
  });
  const [inventoryItemMeta, setInventoryItemMeta] = useState({ locations: [] });
  const [inventoryItemMetaLoading, setInventoryItemMetaLoading] = useState(false);
  const [inventoryItemMetaError, setInventoryItemMetaError] = useState('');
  const [stockLocationCreateDraft, setStockLocationCreateDraft] = useState({
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
  const [stockLocationCreateState, setStockLocationCreateState] = useState({
    saving: false,
    error: '',
    success: ''
  });
  const [collectionCreateDraft, setCollectionCreateDraft] = useState({
    title: '',
    handle: '',
    description: '',
    thumbnail: '',
    metadata: ''
  });
  const [collectionCreateState, setCollectionCreateState] = useState({
    saving: false,
    error: '',
    success: ''
  });
  const [collectionCreateUploadState, setCollectionCreateUploadState] = useState({
    uploading: false,
    error: '',
    success: ''
  });
  const [categoryCreateDraft, setCategoryCreateDraft] = useState({
    name: '',
    handle: '',
    description: '',
    parent_category_id: '',
    is_active: true,
    is_internal: false,
    thumbnail: '',
    metadata: ''
  });
  const [categoryCreateState, setCategoryCreateState] = useState({
    saving: false,
    error: '',
    success: ''
  });
  const [categoryCreateUploadState, setCategoryCreateUploadState] = useState({
    uploading: false,
    error: '',
    success: ''
  });
  const [categoryCreateMeta, setCategoryCreateMeta] = useState({ categories: [] });
  const [categoryCreateMetaLoading, setCategoryCreateMetaLoading] = useState(false);
  const [categoryCreateMetaError, setCategoryCreateMetaError] = useState('');
  const [productTypeCreateDraft, setProductTypeCreateDraft] = useState({
    value: '',
    metadata: ''
  });
  const [productTypeCreateState, setProductTypeCreateState] = useState({
    saving: false,
    error: '',
    success: ''
  });
  const [productTagCreateDraft, setProductTagCreateDraft] = useState({
    value: '',
    metadata: ''
  });
  const [productTagCreateState, setProductTagCreateState] = useState({
    saving: false,
    error: '',
    success: ''
  });
  const [salesChannelCreateDraft, setSalesChannelCreateDraft] = useState({
    name: '',
    description: '',
    is_disabled: false,
    metadata: ''
  });
  const [salesChannelCreateState, setSalesChannelCreateState] = useState({
    saving: false,
    error: '',
    success: ''
  });
  const [inviteCreateDraft, setInviteCreateDraft] = useState({
    email: '',
    metadata: ''
  });
  const [inviteCreateState, setInviteCreateState] = useState({
    saving: false,
    error: '',
    success: ''
  });
  const [apiKeyCreateDraft, setApiKeyCreateDraft] = useState({
    title: '',
    type: 'secret'
  });
  const [apiKeyCreateState, setApiKeyCreateState] = useState({
    saving: false,
    error: '',
    success: ''
  });
  const [apiKeyCreateSecret, setApiKeyCreateSecret] = useState('');
  const [uploadState, setUploadState] = useState({
    uploading: false,
    error: '',
    success: ''
  });
  const [uploadSearch, setUploadSearch] = useState('');
  const [uploadCopyId, setUploadCopyId] = useState('');
  const [uploadDeleteState, setUploadDeleteState] = useState({
    deletingId: '',
    error: '',
    success: ''
  });

  const renderListMetaFailures = (className) =>
    listMetaFailures.length ? (
      <ul className={className}>
        {listMetaFailures.map((message) => (
          <li key={message}>• {message}</li>
        ))}
      </ul>
    ) : null;

  const isProductList = resource?.id === 'products';
  const isDraftOrderList = resource?.id === 'draft-orders';
  const isCollectionList = resource?.id === 'collections';
  const isCategoryList = resource?.id === 'product-categories';
  const isProductTypeList = resource?.id === 'product-types';
  const isProductTagList = resource?.id === 'product-tags';
  const isSalesChannelList = resource?.id === 'sales-channels';
  const isRegionList = resource?.id === 'regions';
  const isShippingProfileList = resource?.id === 'shipping-profiles';
  const isShippingOptionList = resource?.id === 'shipping-options';
  const isTaxRegionList = resource?.id === 'tax-regions';
  const isTaxRateList = resource?.id === 'tax-rates';
  const isReturnReasonList = resource?.id === 'return-reasons';
  const isRefundReasonList = resource?.id === 'refund-reasons';
  const isPromotionList = resource?.id === 'promotions';
  const isCampaignList = resource?.id === 'campaigns';
  const isPriceListList = resource?.id === 'price-lists';
  const isCustomerList = resource?.id === 'customers';
  const isCustomerGroupList = resource?.id === 'customer-groups';
  const isInventoryItemList = resource?.id === 'inventory-items';
  const isStockLocationList = resource?.id === 'stock-locations';
  const isInviteList = resource?.id === 'invites';
  const isApiKeyList = resource?.id === 'api-keys';
  const isUploadList = resource?.id === 'uploads';

  const page = Math.max(1, Number(searchParams.get('page') || 1));
  const query = searchParams.get('q') || '';
  const limit = isProductList
    ? parsePositiveInt(searchParams.get('limit'), 20)
    : isUploadList
      ? 50
      : 20;
  const offset = (page - 1) * limit;
  const order = isProductList ? searchParams.get('order') || '-created_at' : undefined;
  const statusFilters = isProductList ? searchParams.getAll('status') : [];
  const statusFiltersKey = statusFilters.join('|');
  const collectionId = isProductList ? searchParams.get('collection_id') || '' : '';
  const categoryId = isProductList ? searchParams.get('category_id') || '' : '';
  const salesChannelId = isProductList ? searchParams.get('sales_channel_id') || '' : '';
  const typeId = isProductList ? searchParams.get('type_id') || '' : '';
  const tagId = isProductList ? searchParams.get('tag_id') || '' : '';

  const totalPages = Math.max(1, Math.ceil(count / limit));

  const columns = useMemo(() => resource.columns || [], [resource]);
  const uploadRows = useMemo(() => {
    if (!isUploadList) return rows;
    const term = uploadSearch.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((file) => {
      const haystack = [getUploadName(file), getUploadUrl(file), getUploadType(file), file?.id]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [isUploadList, rows, uploadSearch]);
  const listParams = useMemo(() => {
    if (!resource?.listParams) return {};
    if (typeof resource.listParams === 'function') {
      return resource.listParams({
        page,
        limit,
        offset,
        query,
        filters: {
          status: statusFilters,
          collection_id: collectionId || undefined,
          category_id: categoryId || undefined,
          sales_channel_id: salesChannelId || undefined,
          type_id: typeId || undefined,
          tag_id: tagId || undefined
        }
      });
    }
    return resource.listParams;
  }, [
    resource,
    page,
    limit,
    offset,
    query,
    statusFiltersKey,
    collectionId,
    categoryId,
    salesChannelId,
    typeId,
    tagId
  ]);

  const fetchList = async () => {
    if (!resource) return;
    setLoading(true);
    setError('');
    try {
      const payload = await getList(resource.endpoint, {
        ...listParams,
        limit,
        offset,
        q: isUploadList ? undefined : query || undefined,
        order: isProductList ? order : undefined,
        status: statusFilters.length ? statusFilters : undefined,
        collection_id: isProductList ? collectionId || undefined : undefined,
        category_id: isProductList ? categoryId || undefined : undefined,
        sales_channel_id: isProductList ? salesChannelId || undefined : undefined,
        type_id: isProductList ? typeId || undefined : undefined,
        tag_id: isProductList ? tagId || undefined : undefined
      });
      const items = getArrayFromPayload(payload, resource.listKey);
      setRows(items);
      setCount(getCountFromPayload(payload, items.length));
    } catch (err) {
      setRows([]);
      setCount(0);
      setError(formatApiError(err, 'Unable to load data.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isProductList) return;
    let isActive = true;

    const loadFilters = async () => {
      setFiltersLoading(true);
      setFiltersError('');
      try {
        const results = await Promise.allSettled([
          getList('/admin/collections', { limit: 200 }),
          getList('/admin/product-categories', { limit: 200 }),
          getList('/admin/sales-channels', { limit: 200 }),
          getList('/admin/product-types', { limit: 200 }),
          getList('/admin/product-tags', { limit: 200 })
        ]);

        if (!isActive) return;

        const [
          collectionsResult,
          categoriesResult,
          salesChannelsResult,
          typesResult,
          tagsResult
        ] = results;

        const collectionsPayload =
          collectionsResult.status === 'fulfilled' ? collectionsResult.value : null;
        const categoriesPayload =
          categoriesResult.status === 'fulfilled' ? categoriesResult.value : null;
        const salesChannelsPayload =
          salesChannelsResult.status === 'fulfilled' ? salesChannelsResult.value : null;
        const typesPayload = typesResult.status === 'fulfilled' ? typesResult.value : null;
        const tagsPayload = tagsResult.status === 'fulfilled' ? tagsResult.value : null;

        setProductFilters({
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
          )
        });
        const failedCount = results.filter((result) => result.status === 'rejected').length;
        if (failedCount) {
          setFiltersError('Some filters are temporarily unavailable.');
        }
      } catch (err) {
        if (!isActive) return;
        setFiltersError(err?.message || 'Unable to load product filters.');
      } finally {
        if (isActive) setFiltersLoading(false);
      }
    };

    loadFilters();

    return () => {
      isActive = false;
    };
  }, [isProductList]);

  useEffect(() => {
    if (
      !isRegionList &&
      !isShippingOptionList &&
      !isTaxRegionList &&
      !isTaxRateList &&
      !isPromotionList
    ) {
      setListMeta({
        paymentProviders: [],
        fulfillmentProviders: [],
        taxProviders: [],
        shippingProfiles: [],
        serviceZones: [],
        regions: [],
        taxRegions: [],
        campaigns: []
      });
      setListMetaLoading(false);
      setListMetaError('');
      setListMetaFailures([]);
      return;
    }
    let isActive = true;

    const loadMeta = async () => {
      setListMetaLoading(true);
      setListMetaError('');
      setListMetaFailures([]);
      const tasks = [];

      if (isRegionList) {
        tasks.push({
          key: 'paymentProviders',
          promise: getList('/admin/payments/payment-providers', { limit: 200 })
        });
      }
      if (isPromotionList) {
        tasks.push({ key: 'campaigns', promise: getList('/admin/campaigns', { limit: 200 }) });
      }
      if (isShippingOptionList) {
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
      if (isTaxRegionList) {
        tasks.push({ key: 'taxProviders', promise: getList('/admin/tax-providers', { limit: 200 }) });
        tasks.push({ key: 'taxRegions', promise: getList('/admin/tax-regions', { limit: 200 }) });
      }
      if (isTaxRateList) {
        tasks.push({ key: 'taxRegions', promise: getList('/admin/tax-regions', { limit: 200 }) });
      }

      if (!tasks.length) {
        setListMetaLoading(false);
        return;
      }

      const results = await Promise.allSettled(tasks.map((task) => task.promise));
      if (!isActive) return;

      const nextMeta = {
        paymentProviders: [],
        fulfillmentProviders: [],
        taxProviders: [],
        shippingProfiles: [],
        serviceZones: [],
        regions: [],
        taxRegions: [],
        campaigns: []
      };
      let failedCount = 0;
      const failureMessages = [];

      results.forEach((result, index) => {
        const task = tasks[index];
        if (result.status !== 'fulfilled') {
          failedCount += 1;
          const label = LIST_META_LABELS[task.key] || task.key;
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
            nextMeta.shippingProfiles = getArrayFromPayload(payload, 'shipping_profiles');
            break;
          case 'regions':
            nextMeta.regions = getArrayFromPayload(payload, 'regions');
            break;
          case 'taxProviders':
            nextMeta.taxProviders = getArrayFromPayload(payload, 'tax_providers');
            break;
          case 'taxRegions':
            nextMeta.taxRegions = getArrayFromPayload(payload, 'tax_regions');
            break;
          case 'campaigns':
            nextMeta.campaigns = sortByLabel(
              getArrayFromPayload(payload, 'campaigns'),
              (campaign) => campaign?.name || campaign?.id
            );
            break;
          case 'serviceZones': {
            nextMeta.serviceZones = extractServiceZones(payload);
            break;
          }
          default:
            break;
        }
      });

      setListMeta(nextMeta);
      if (failedCount) {
        setListMetaError('Some settings failed to load.');
      }
      setListMetaFailures(failureMessages);
      setListMetaLoading(false);
    };

    loadMeta();

    return () => {
      isActive = false;
    };
  }, [isRegionList, isShippingOptionList, isTaxRegionList, isTaxRateList, isPromotionList]);

  useEffect(() => {
    if (!isReturnReasonList) {
      setReturnReasonMeta({ reasons: [] });
      setReturnReasonMetaLoading(false);
      setReturnReasonMetaError('');
      return;
    }
    let isActive = true;

    const loadReturnReasonMeta = async () => {
      setReturnReasonMetaLoading(true);
      setReturnReasonMetaError('');
      try {
        const payload = await getList('/admin/return-reasons', { limit: 200 });
        if (!isActive) return;
        setReturnReasonMeta({
          reasons: sortByLabel(
            getArrayFromPayload(payload, 'return_reasons'),
            (reason) => reason?.label || reason?.value || reason?.id
          )
        });
      } catch (err) {
        if (!isActive) return;
        setReturnReasonMeta({ reasons: [] });
        setReturnReasonMetaError(err?.message || 'Unable to load return reasons.');
      } finally {
        if (isActive) setReturnReasonMetaLoading(false);
      }
    };

    loadReturnReasonMeta();

    return () => {
      isActive = false;
    };
  }, [isReturnReasonList]);

  useEffect(() => {
    if (!isPriceListList) {
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
  }, [isPriceListList]);

  useEffect(() => {
    if (!isCustomerList) {
      setCustomerCreateMeta({ groups: [] });
      setCustomerCreateMetaLoading(false);
      setCustomerCreateMetaError('');
      return;
    }
    let isActive = true;

    const loadCustomerGroups = async () => {
      setCustomerCreateMetaLoading(true);
      setCustomerCreateMetaError('');
      try {
        const payload = await getList('/admin/customer-groups', { limit: 200 });
        if (!isActive) return;
        setCustomerCreateMeta({
          groups: sortByLabel(
            getArrayFromPayload(payload, 'customer_groups'),
            (group) => group?.name || group?.id
          )
        });
      } catch (err) {
        if (!isActive) return;
        setCustomerCreateMetaError(err?.message || 'Unable to load customer groups.');
        setCustomerCreateMeta({ groups: [] });
      } finally {
        if (isActive) setCustomerCreateMetaLoading(false);
      }
    };

    loadCustomerGroups();

    return () => {
      isActive = false;
    };
  }, [isCustomerList]);

  useEffect(() => {
    if (!isInventoryItemList) {
      setInventoryItemMeta({ locations: [] });
      setInventoryItemMetaLoading(false);
      setInventoryItemMetaError('');
      return;
    }
    let isActive = true;

    const loadInventoryLocations = async () => {
      setInventoryItemMetaLoading(true);
      setInventoryItemMetaError('');
      try {
        const payload = await getList('/admin/stock-locations', { limit: 200 });
        if (!isActive) return;
        setInventoryItemMeta({
          locations: sortByLabel(
            getArrayFromPayload(payload, 'stock_locations'),
            (location) => location?.name || location?.id
          )
        });
      } catch (err) {
        if (!isActive) return;
        setInventoryItemMetaError(err?.message || 'Unable to load stock locations.');
        setInventoryItemMeta({ locations: [] });
      } finally {
        if (isActive) setInventoryItemMetaLoading(false);
      }
    };

    loadInventoryLocations();

    return () => {
      isActive = false;
    };
  }, [isInventoryItemList]);

  useEffect(() => {
    if (!isCategoryList) {
      setCategoryCreateMeta({ categories: [] });
      setCategoryCreateMetaLoading(false);
      setCategoryCreateMetaError('');
      return;
    }
    let isActive = true;

    const loadCategoryMeta = async () => {
      setCategoryCreateMetaLoading(true);
      setCategoryCreateMetaError('');
      try {
        const payload = await getList('/admin/product-categories', { limit: 200 });
        if (!isActive) return;
        setCategoryCreateMeta({
          categories: sortByLabel(
            getArrayFromPayload(payload, 'product_categories'),
            (category) => category?.name || category?.handle || category?.id
          )
        });
      } catch (err) {
        if (!isActive) return;
        setCategoryCreateMeta({ categories: [] });
        setCategoryCreateMetaError(err?.message || 'Unable to load categories.');
      } finally {
        if (isActive) setCategoryCreateMetaLoading(false);
      }
    };

    loadCategoryMeta();

    return () => {
      isActive = false;
    };
  }, [isCategoryList]);

  useEffect(() => {
    if (!isTaxRateList) {
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
  }, [isTaxRateList]);

  useEffect(() => {
    fetchList();
  }, [
    resource,
    offset,
    query,
    order,
    statusFiltersKey,
    collectionId,
    categoryId,
    salesChannelId,
    typeId,
    tagId,
    isProductList,
    listParams
  ]);

  useEffect(() => {
    if (!isPriceListList) {
      setPriceListProductSearch({ query: '', results: [], loading: false, error: '' });
      return;
    }
    const queryValue = priceListProductSearch.query.trim();
    if (!queryValue) {
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
        const payload = await getList('/admin/products', { q: queryValue, limit: 20 });
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
  }, [isPriceListList, priceListProductSearch.query]);

  useEffect(() => {
    if (!isTaxRateList) {
      setTaxRateProductSearch({ query: '', results: [], loading: false, error: '' });
      return;
    }
    const queryValue = taxRateProductSearch.query.trim();
    if (!queryValue) {
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
        const payload = await getList('/admin/products', { q: queryValue, limit: 20 });
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
  }, [isTaxRateList, taxRateProductSearch.query]);

  const handleRowClick = (row) => {
    if (isUploadList) return;
    navigate(`${resource.path}/${row.id}`);
  };

  const handleSearch = (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextQuery = String(formData.get('q') || '').trim();
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (nextQuery) {
        next.set('q', nextQuery);
      } else {
        next.delete('q');
      }
      next.set('page', '1');
      return next;
    });
  };

  const handleUploadSearchChange = (event) => {
    setUploadSearch(event.target.value);
  };

  const handleUploadLibraryChange = async (event) => {
    const files = event.target.files;
    if (!files || !files.length) return;
    setUploadState({ uploading: true, error: '', success: '' });
    try {
      const payload = await uploadFiles(files);
      const uploadedFiles = getArrayFromPayload(payload, 'files');
      const uploadedCount = uploadedFiles.length || (payload?.file ? 1 : 0);
      setUploadState({
        uploading: false,
        error: '',
        success: uploadedCount
          ? `Uploaded ${uploadedCount} file${uploadedCount === 1 ? '' : 's'}.`
          : 'Upload complete.'
      });
      fetchList();
    } catch (err) {
      setUploadState({
        uploading: false,
        error: err?.message || 'Unable to upload files.',
        success: ''
      });
    } finally {
      event.target.value = '';
    }
  };

  const handleCopyUploadUrl = async (file) => {
    const url = resolveUploadUrl(file);
    const fileId = file?.id || url || getUploadName(file);
    if (!url) {
      setUploadState((prev) => ({
        ...prev,
        error: 'No file URL available to copy.'
      }));
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = url;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const success = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (!success) {
          throw new Error('Copy failed.');
        }
      }
      setUploadCopyId(fileId);
      setUploadState((prev) => ({ ...prev, error: '' }));
      window.setTimeout(() => {
        setUploadCopyId((current) => (current === fileId ? '' : current));
      }, 2000);
    } catch (err) {
      setUploadState((prev) => ({
        ...prev,
        error: err?.message || 'Unable to copy URL.'
      }));
    }
  };

  const handleDeleteUpload = async (file) => {
    const fileId = file?.id;
    if (!fileId) {
      setUploadDeleteState({
        deletingId: '',
        error: 'Unable to delete file without an ID.',
        success: ''
      });
      return;
    }
    if (!window.confirm('Delete this file?')) return;
    setUploadDeleteState({ deletingId: fileId, error: '', success: '' });
    try {
      try {
        await request(`${resource.endpoint}/${fileId}`, { method: 'DELETE' });
      } catch (err) {
        if (resource.endpoint === '/admin/files' && err?.status === 404) {
          await request(`/admin/uploads/${fileId}`, { method: 'DELETE' });
        } else {
          throw err;
        }
      }
      setUploadDeleteState({
        deletingId: '',
        error: '',
        success: 'File deleted.'
      });
      fetchList();
    } catch (err) {
      setUploadDeleteState({
        deletingId: '',
        error: err?.message || 'Unable to delete file.',
        success: ''
      });
    }
  };

  const setFilterParams = (updates) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(updates).forEach(([key, value]) => {
        next.delete(key);
        if (Array.isArray(value)) {
          value.forEach((entry) => {
            if (entry) next.append(key, String(entry));
          });
          return;
        }
        if (value !== undefined && value !== null && value !== '') {
          next.set(key, String(value));
        }
      });
      next.set('page', '1');
      return next;
    });
  };

  const handleStatusToggle = (value) => {
    const nextStatuses = statusFilters.includes(value)
      ? statusFilters.filter((status) => status !== value)
      : [...statusFilters, value];
    setFilterParams({ status: nextStatuses });
  };

  const handleSelectChange = (key) => (event) => {
    const value = event.target.value;
    setFilterParams({ [key]: value || undefined });
  };

  const handleOrderChange = (event) => {
    setFilterParams({ order: event.target.value });
  };

  const handleLimitChange = (event) => {
    setFilterParams({ limit: event.target.value });
  };

  const clearFilters = () => {
    setFilterParams({
      status: [],
      collection_id: undefined,
      category_id: undefined,
      sales_channel_id: undefined,
      type_id: undefined,
      tag_id: undefined
    });
  };

  const goToPage = (nextPage) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('page', String(nextPage));
      return next;
    });
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

  const handleShippingProfileDraftChange = (field) => (event) => {
    const value = event.target.value;
    setShippingProfileDraft((prev) => ({ ...prev, [field]: value }));
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

  const handleTaxRegionDraftChange = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setTaxRegionDraft((prev) => ({ ...prev, [field]: value }));
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

  const handleCreateRegion = async (event) => {
    event.preventDefault();
    const name = regionDraft.name.trim();
    const currency = regionDraft.currency_code.trim().toLowerCase();
    const countries = parseCsvInput(regionDraft.countries);
    const providers = parseCsvInput(regionDraft.payment_providers);
    const { data: metadata, error: metadataError } = parseJsonInput(regionDraft.metadata);

    if (!name || !currency || !countries.length) {
      setRegionCreateState({
        saving: false,
        error: 'Name, currency, and at least one country are required.',
        success: ''
      });
      return;
    }

    if (metadataError) {
      setRegionCreateState({
        saving: false,
        error: `Metadata JSON error: ${metadataError}`,
        success: ''
      });
      return;
    }

    setRegionCreateState({ saving: true, error: '', success: '' });
    try {
      await request('/admin/regions', {
        method: 'POST',
        body: {
          name,
          currency_code: currency,
          countries,
          automatic_taxes: Boolean(regionDraft.automatic_taxes),
          is_tax_inclusive: Boolean(regionDraft.is_tax_inclusive),
          payment_providers: providers.length ? providers : undefined,
          ...(metadata && typeof metadata === 'object' ? { metadata } : {})
        }
      });
      setRegionDraft({
        name: '',
        currency_code: '',
        countries: '',
        payment_providers: '',
        automatic_taxes: false,
        is_tax_inclusive: false,
        metadata: ''
      });
      setRegionCreateState({ saving: false, error: '', success: 'Region created.' });
      fetchList();
    } catch (err) {
      setRegionCreateState({
        saving: false,
        error: err?.message || 'Unable to create region.',
        success: ''
      });
    }
  };

  const handleCreateShippingProfile = async (event) => {
    event.preventDefault();
    const name = shippingProfileDraft.name.trim();
    const type = shippingProfileDraft.type.trim();
    const { data: metadata, error: metadataError } = parseJsonInput(shippingProfileDraft.metadata);

    if (!name || !type) {
      setShippingProfileCreateState({
        saving: false,
        error: 'Name and type are required.',
        success: ''
      });
      return;
    }

    if (metadataError) {
      setShippingProfileCreateState({
        saving: false,
        error: `Metadata JSON error: ${metadataError}`,
        success: ''
      });
      return;
    }

    setShippingProfileCreateState({ saving: true, error: '', success: '' });
    try {
      await request('/admin/shipping-profiles', {
        method: 'POST',
        body: {
          name,
          type,
          ...(metadata && typeof metadata === 'object' ? { metadata } : {})
        }
      });
      setShippingProfileDraft({ name: '', type: 'default', metadata: '' });
      setShippingProfileCreateState({
        saving: false,
        error: '',
        success: 'Shipping profile created.'
      });
      fetchList();
    } catch (err) {
      setShippingProfileCreateState({
        saving: false,
        error: err?.message || 'Unable to create shipping profile.',
        success: ''
      });
    }
  };

  const handleCreateShippingOption = async (event) => {
    event.preventDefault();
    const name = shippingOptionDraft.name.trim();
    const providerId = shippingOptionDraft.provider_id.trim();
    const shippingProfileId = shippingOptionDraft.shipping_profile_id.trim();
    const serviceZoneId = shippingOptionDraft.service_zone_id.trim();
    const priceType = shippingOptionDraft.price_type.trim();
    const typeId = shippingOptionDraft.type_id.trim();
    const { data: dataPayload, error: dataError } = parseJsonInput(shippingOptionDraft.data);
    const { data: metadata, error: metadataError } = parseJsonInput(shippingOptionDraft.metadata);

    if (!name || !providerId || !shippingProfileId || !serviceZoneId || !priceType) {
      setShippingOptionCreateState({
        saving: false,
        error: 'Name, provider, profile, service zone, and price type are required.',
        success: ''
      });
      return;
    }

    if (dataError || metadataError) {
      setShippingOptionCreateState({
        saving: false,
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
          amount,
          ...(regionId ? { region_id: regionId } : {}),
          ...(currencyCode ? { currency_code: currencyCode } : {})
        };
      })
      .filter(Boolean);

    if (priceType === 'flat' && !pricesPayload.length) {
      setShippingOptionCreateState({
        saving: false,
        error: 'Flat shipping options require at least one valid price.',
        success: ''
      });
      return;
    }

    const rules = [
      {
        attribute: 'enabled_in_store',
        operator: 'eq',
        value: String(shippingOptionDraft.enabled_in_store)
      },
      {
        attribute: 'is_return',
        operator: 'eq',
        value: String(shippingOptionDraft.is_return)
      }
    ];

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

    setShippingOptionCreateState({ saving: true, error: '', success: '' });
    try {
      await request('/admin/shipping-options', {
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
      setShippingOptionDraft({
        name: '',
        price_type: 'flat',
        service_zone_id: '',
        shipping_profile_id: '',
        provider_id: '',
        prices: [{ amount: '', currency_code: '', region_id: '' }],
        type_id: '',
        type_label: '',
        type_code: '',
        type_description: '',
        data: '',
        metadata: '',
        enabled_in_store: true,
        is_return: false
      });
      setShippingOptionCreateState({
        saving: false,
        error: '',
        success: 'Shipping option created.'
      });
      fetchList();
    } catch (err) {
      setShippingOptionCreateState({
        saving: false,
        error: err?.message || 'Unable to create shipping option.',
        success: ''
      });
    }
  };

  const handleCreateTaxRegion = async (event) => {
    event.preventDefault();
    const countryCode = taxRegionDraft.country_code.trim().toLowerCase();
    const provinceCode = taxRegionDraft.province_code.trim().toLowerCase();
    const providerId = taxRegionDraft.provider_id.trim();
    const parentId = taxRegionDraft.parent_id.trim();
    const defaultRateName = taxRegionDraft.default_tax_rate_name.trim();
    const defaultRateCode = taxRegionDraft.default_tax_rate_code.trim();
    const defaultRateRate = taxRegionDraft.default_tax_rate_rate.trim();
    const defaultRateIsCombinable = Boolean(taxRegionDraft.default_tax_rate_is_combinable);
    const { data: defaultRateMetadata, error: defaultRateError } = parseJsonInput(
      taxRegionDraft.default_tax_rate_metadata
    );
    const { data: metadata, error: metadataError } = parseJsonInput(taxRegionDraft.metadata);

    if (!countryCode) {
      setTaxRegionCreateState({
        saving: false,
        error: 'Country code is required.',
        success: ''
      });
      return;
    }

    if (defaultRateError || metadataError) {
      setTaxRegionCreateState({
        saving: false,
        error: `JSON error: ${defaultRateError || metadataError}`,
        success: ''
      });
      return;
    }

    const hasDefaultRate =
      defaultRateName || defaultRateCode || defaultRateRate || defaultRateIsCombinable;
    let defaultTaxRate;
    if (hasDefaultRate) {
      const parsedRate = defaultRateRate ? Number(defaultRateRate) : undefined;
      if (!defaultRateName || !defaultRateCode) {
        setTaxRegionCreateState({
          saving: false,
          error: 'Default tax rate name and code are required.',
          success: ''
        });
        return;
      }
      if (defaultRateRate && !Number.isFinite(parsedRate)) {
        setTaxRegionCreateState({
          saving: false,
          error: 'Default tax rate must be a number.',
          success: ''
        });
        return;
      }
      defaultTaxRate = {
        name: defaultRateName,
        code: defaultRateCode,
        ...(Number.isFinite(parsedRate) ? { rate: parsedRate } : {}),
        ...(defaultRateIsCombinable ? { is_combinable: true } : {}),
        ...(defaultRateMetadata && typeof defaultRateMetadata === 'object'
          ? { metadata: defaultRateMetadata }
          : {})
      };
    }

    setTaxRegionCreateState({ saving: true, error: '', success: '' });
    try {
      await request('/admin/tax-regions', {
        method: 'POST',
        body: {
          country_code: countryCode,
          province_code: provinceCode || undefined,
          provider_id: providerId || undefined,
          parent_id: parentId || undefined,
          ...(defaultTaxRate ? { default_tax_rate: defaultTaxRate } : {}),
          ...(metadata && typeof metadata === 'object' ? { metadata } : {})
        }
      });
      setTaxRegionDraft({
        country_code: '',
        province_code: '',
        provider_id: '',
        parent_id: '',
        default_tax_rate_name: '',
        default_tax_rate_code: '',
        default_tax_rate_rate: '',
        default_tax_rate_is_combinable: false,
        default_tax_rate_metadata: '',
        metadata: ''
      });
      setTaxRegionCreateState({
        saving: false,
        error: '',
        success: 'Tax region created.'
      });
      fetchList();
    } catch (err) {
      setTaxRegionCreateState({
        saving: false,
        error: err?.message || 'Unable to create tax region.',
        success: ''
      });
    }
  };

  const handleCreateTaxRate = async (event) => {
    event.preventDefault();
    const name = taxRateDraft.name.trim();
    const code = taxRateDraft.code.trim();
    const rateInput = taxRateDraft.rate.trim();
    const rateValue = rateInput ? Number(rateInput) : null;
    const taxRegionId = taxRateDraft.tax_region_id.trim();
    const { data: metadata, error: metadataError } = parseJsonInput(taxRateDraft.metadata);
    const rules = buildTaxRateRules(taxRateRuleDraft);

    if (!name || !code || !taxRegionId) {
      setTaxRateCreateState({
        saving: false,
        error: 'Name, code, and tax region are required.',
        success: ''
      });
      return;
    }

    if (rateInput && !Number.isFinite(rateValue)) {
      setTaxRateCreateState({
        saving: false,
        error: 'Rate must be a number.',
        success: ''
      });
      return;
    }

    if (metadataError) {
      setTaxRateCreateState({
        saving: false,
        error: `Metadata JSON error: ${metadataError}`,
        success: ''
      });
      return;
    }

    setTaxRateCreateState({ saving: true, error: '', success: '' });
    try {
      await request('/admin/tax-rates', {
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
      setTaxRateDraft({
        name: '',
        code: '',
        rate: '',
        tax_region_id: '',
        is_default: false,
        is_combinable: false,
        metadata: ''
      });
      setTaxRateRuleDraft({
        product_ids: [],
        product_type_ids: [],
        product_collection_ids: [],
        product_tag_ids: [],
        product_category_ids: [],
        shipping_option_ids: []
      });
      setTaxRateSelectedProducts([]);
      setTaxRateProductSearch({ query: '', results: [], loading: false, error: '' });
      setTaxRateCreateState({
        saving: false,
        error: '',
        success: 'Tax rate created.'
      });
      fetchList();
    } catch (err) {
      setTaxRateCreateState({
        saving: false,
        error: err?.message || 'Unable to create tax rate.',
        success: ''
      });
    }
  };

  const handleReturnReasonDraftChange = (field) => (event) => {
    const value = event.target.value;
    setReturnReasonCreateDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleCreateReturnReason = async (event) => {
    event.preventDefault();
    const value = returnReasonCreateDraft.value.trim();
    const label = returnReasonCreateDraft.label.trim();
    const description = returnReasonCreateDraft.description.trim();
    const parentId = returnReasonCreateDraft.parent_return_reason_id.trim();
    const { data: metadata, error: metadataError } = parseJsonInput(returnReasonCreateDraft.metadata);

    if (!value || !label) {
      setReturnReasonCreateState({
        saving: false,
        error: 'Value and label are required.',
        success: ''
      });
      return;
    }

    if (metadataError) {
      setReturnReasonCreateState({
        saving: false,
        error: `Metadata JSON error: ${metadataError}`,
        success: ''
      });
      return;
    }

    setReturnReasonCreateState({ saving: true, error: '', success: '' });
    try {
      await request('/admin/return-reasons', {
        method: 'POST',
        body: {
          value,
          label,
          description: description || null,
          parent_return_reason_id: parentId || null,
          ...(metadata && typeof metadata === 'object' ? { metadata } : {})
        }
      });
      setReturnReasonCreateDraft({
        value: '',
        label: '',
        description: '',
        parent_return_reason_id: '',
        metadata: ''
      });
      setReturnReasonCreateState({
        saving: false,
        error: '',
        success: 'Return reason created.'
      });
      fetchList();
    } catch (err) {
      setReturnReasonCreateState({
        saving: false,
        error: err?.message || 'Unable to create return reason.',
        success: ''
      });
    }
  };

  const handleRefundReasonDraftChange = (field) => (event) => {
    const value = event.target.value;
    setRefundReasonCreateDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleCreateRefundReason = async (event) => {
    event.preventDefault();
    const label = refundReasonCreateDraft.label.trim();
    const code = refundReasonCreateDraft.code.trim();
    const description = refundReasonCreateDraft.description.trim();

    if (!label || !code) {
      setRefundReasonCreateState({
        saving: false,
        error: 'Label and code are required.',
        success: ''
      });
      return;
    }

    setRefundReasonCreateState({ saving: true, error: '', success: '' });
    try {
      await request('/admin/refund-reasons', {
        method: 'POST',
        body: {
          label,
          code,
          description: description || null
        }
      });
      setRefundReasonCreateDraft({ label: '', code: '', description: '' });
      setRefundReasonCreateState({
        saving: false,
        error: '',
        success: 'Refund reason created.'
      });
      fetchList();
    } catch (err) {
      setRefundReasonCreateState({
        saving: false,
        error: err?.message || 'Unable to create refund reason.',
        success: ''
      });
    }
  };

  const handlePromotionDraftChange = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setPromotionDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleCampaignDraftChange = (field) => (event) => {
    const value = event.target.value;
    setCampaignDraft((prev) => ({ ...prev, [field]: value }));
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

  const handleCreatePromotion = async (event) => {
    event.preventDefault();
    const code = promotionDraft.code.trim();
    const description = promotionDraft.description.trim();
    const status = promotionDraft.status.trim();
    const campaignId = promotionDraft.campaign_id.trim();
    const type = promotionDraft.type.trim();
    const startsAt = parseDateTimeInput(promotionDraft.starts_at);
    const endsAt = parseDateTimeInput(promotionDraft.ends_at);
    const applicationMethodType = promotionDraft.application_method_type.trim();
    const applicationMethodValue = promotionDraft.application_method_value.trim();
    const applicationMethodCurrency = promotionDraft.application_method_currency.trim();
    const applicationMethodTarget = promotionDraft.application_method_target.trim();
    const applicationMethodAllocation = promotionDraft.application_method_allocation.trim();
    const { data: extra, error: extraError } = parseJsonInput(promotionDraft.extra);

    if (!code && !promotionDraft.is_automatic) {
      setPromotionCreateState({
        saving: false,
        error: 'Add a code or enable automatic promotion.',
        success: ''
      });
      return;
    }

    if (!type) {
      setPromotionCreateState({
        saving: false,
        error: 'Promotion type is required.',
        success: ''
      });
      return;
    }

    if (extraError) {
      setPromotionCreateState({
        saving: false,
        error: `Advanced JSON error: ${extraError}`,
        success: ''
      });
      return;
    }

    let applicationMethod = null;
    if (applicationMethodType || applicationMethodValue || applicationMethodCurrency) {
      const numericValue = applicationMethodValue ? Number(applicationMethodValue) : null;
      if (applicationMethodValue && !Number.isFinite(numericValue)) {
        setPromotionCreateState({
          saving: false,
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

    setPromotionCreateState({ saving: true, error: '', success: '' });
    try {
      await request('/admin/promotions', {
        method: 'POST',
        body: {
          code: code || undefined,
          description: description || undefined,
          status: status || undefined,
          is_automatic: promotionDraft.is_automatic,
          campaign_id: campaignId || undefined,
          starts_at: startsAt || undefined,
          ends_at: endsAt || undefined,
          type,
          ...(applicationMethod ? { application_method: applicationMethod } : {}),
          ...(extra && typeof extra === 'object' ? extra : {})
        }
      });
      setPromotionDraft({
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
      setPromotionCreateState({
        saving: false,
        error: '',
        success: 'Promotion created.'
      });
      fetchList();
    } catch (err) {
      setPromotionCreateState({
        saving: false,
        error: err?.message || 'Unable to create promotion.',
        success: ''
      });
    }
  };

  const handleCreateCampaign = async (event) => {
    event.preventDefault();
    const name = campaignDraft.name.trim();
    const description = campaignDraft.description.trim();
    const startsAt = parseDateTimeInput(campaignDraft.starts_at);
    const endsAt = parseDateTimeInput(campaignDraft.ends_at);
    const { data: extra, error: extraError } = parseJsonInput(campaignDraft.extra);

    if (!name) {
      setCampaignCreateState({
        saving: false,
        error: 'Campaign name is required.',
        success: ''
      });
      return;
    }

    if (extraError) {
      setCampaignCreateState({
        saving: false,
        error: `Advanced JSON error: ${extraError}`,
        success: ''
      });
      return;
    }

    setCampaignCreateState({ saving: true, error: '', success: '' });
    try {
      await request('/admin/campaigns', {
        method: 'POST',
        body: {
          name,
          description: description || undefined,
          starts_at: startsAt || undefined,
          ends_at: endsAt || undefined,
          ...(extra && typeof extra === 'object' ? extra : {})
        }
      });
      setCampaignDraft({
        name: '',
        description: '',
        starts_at: '',
        ends_at: '',
        extra: ''
      });
      setCampaignCreateState({
        saving: false,
        error: '',
        success: 'Campaign created.'
      });
      fetchList();
    } catch (err) {
      setCampaignCreateState({
        saving: false,
        error: err?.message || 'Unable to create campaign.',
        success: ''
      });
    }
  };

  const handleCreatePriceList = async (event) => {
    event.preventDefault();
    const title = priceListDraft.title.trim();
    const description = priceListDraft.description.trim();
    const status = priceListDraft.status.trim();
    const type = priceListDraft.type.trim();
    const startsAt = parseDateTimeInput(priceListDraft.starts_at);
    const endsAt = parseDateTimeInput(priceListDraft.ends_at);
    const { data: extra, error: extraError } = parseJsonInput(priceListDraft.extra);
    const rules = buildPriceListRules(priceListRuleDraft);

    if (!title || !type) {
      setPriceListCreateState({
        saving: false,
        error: 'Title and type are required.',
        success: ''
      });
      return;
    }

    if (extraError) {
      setPriceListCreateState({
        saving: false,
        error: `Advanced JSON error: ${extraError}`,
        success: ''
      });
      return;
    }

    setPriceListCreateState({ saving: true, error: '', success: '' });
    try {
      await request('/admin/price-lists', {
        method: 'POST',
        body: {
          title,
          description: description || undefined,
          status: status || undefined,
          type,
          starts_at: startsAt || undefined,
          ends_at: endsAt || undefined,
          rules,
          ...(extra && typeof extra === 'object' ? extra : {})
        }
      });
      setPriceListDraft({
        title: '',
        description: '',
        status: 'draft',
        type: 'sale',
        starts_at: '',
        ends_at: '',
        extra: ''
      });
      setPriceListRuleDraft({
        customer_group_ids: [],
        product_ids: [],
        collection_ids: [],
        category_ids: [],
        tag_ids: [],
        type_ids: []
      });
      setPriceListSelectedProducts([]);
      setPriceListProductSearch({ query: '', results: [], loading: false, error: '' });
      setPriceListCreateState({
        saving: false,
        error: '',
        success: 'Price list created.'
      });
      fetchList();
    } catch (err) {
      setPriceListCreateState({
        saving: false,
        error: err?.message || 'Unable to create price list.',
        success: ''
      });
    }
  };

  const handleCustomerCreateDraftChange = (field) => (event) => {
    const value = event.target.value;
    setCustomerCreateDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleCustomerGroupCreateDraftChange = (field) => (event) => {
    const value = event.target.value;
    setCustomerGroupCreateDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleCustomerCreateGroupToggle = (groupId) => {
    if (!groupId) return;
    setCustomerCreateGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return Array.from(next);
    });
  };

  const handleCreateCustomer = async (event) => {
    event.preventDefault();
    const email = customerCreateDraft.email.trim();
    const firstName = customerCreateDraft.first_name.trim();
    const lastName = customerCreateDraft.last_name.trim();
    const companyName = customerCreateDraft.company_name.trim();
    const phone = customerCreateDraft.phone.trim();
    const note = customerCreateDraft.note.trim();
    const { data: metadata, error: metadataError } = parseJsonInput(customerCreateDraft.metadata);

    if (!email) {
      setCustomerCreateState({
        saving: false,
        error: 'Email is required.',
        success: ''
      });
      return;
    }

    if (metadataError) {
      setCustomerCreateState({
        saving: false,
        error: `Metadata JSON error: ${metadataError}`,
        success: ''
      });
      return;
    }

    const metadataPayload = metadata && typeof metadata === 'object' ? { ...metadata } : {};
    if (note) {
      metadataPayload.note = note;
    }

    setCustomerCreateState({ saving: true, error: '', success: '' });
    try {
      const payload = await request('/admin/customers', {
        method: 'POST',
        body: {
          email,
          ...(firstName ? { first_name: firstName } : {}),
          ...(lastName ? { last_name: lastName } : {}),
          ...(companyName ? { company_name: companyName } : {}),
          ...(phone ? { phone } : {}),
          ...(Object.keys(metadataPayload).length ? { metadata: metadataPayload } : {})
        }
      });

      let groupError = null;
      const createdCustomer = payload?.customer || payload?.data?.customer;
      if (customerCreateGroupIds.length) {
        if (!createdCustomer?.id) {
          groupError = new Error('Customer created but missing ID for group assignment.');
        } else {
          try {
            await request(`/admin/customers/${createdCustomer.id}/customer-groups`, {
              method: 'POST',
              body: { customer_group_ids: { add: customerCreateGroupIds } }
            });
          } catch (err) {
            groupError = err;
          }
        }
      }

      setCustomerCreateDraft({
        email: '',
        first_name: '',
        last_name: '',
        company_name: '',
        phone: '',
        note: '',
        metadata: ''
      });
      setCustomerCreateGroupIds([]);
      fetchList();

      if (groupError) {
        setCustomerCreateState({
          saving: false,
          error: `Customer created, but group assignment failed: ${
            groupError?.message || 'Unable to assign groups.'
          }`,
          success: ''
        });
      } else {
        setCustomerCreateState({
          saving: false,
          error: '',
          success: 'Customer created.'
        });
      }
    } catch (err) {
      setCustomerCreateState({
        saving: false,
        error: err?.message || 'Unable to create customer.',
        success: ''
      });
    }
  };

  const handleCreateCustomerGroup = async (event) => {
    event.preventDefault();
    const name = customerGroupCreateDraft.name.trim();
    const note = customerGroupCreateDraft.note.trim();
    const { data: metadata, error: metadataError } = parseJsonInput(customerGroupCreateDraft.metadata);

    if (!name) {
      setCustomerGroupCreateState({
        saving: false,
        error: 'Group name is required.',
        success: ''
      });
      return;
    }

    if (metadataError) {
      setCustomerGroupCreateState({
        saving: false,
        error: `Metadata JSON error: ${metadataError}`,
        success: ''
      });
      return;
    }

    const metadataPayload = metadata && typeof metadata === 'object' ? { ...metadata } : {};
    if (note) {
      metadataPayload.note = note;
    }

    setCustomerGroupCreateState({ saving: true, error: '', success: '' });
    try {
      await request('/admin/customer-groups', {
        method: 'POST',
        body: {
          name,
          ...(Object.keys(metadataPayload).length ? { metadata: metadataPayload } : {})
        }
      });
      setCustomerGroupCreateDraft({ name: '', note: '', metadata: '' });
      setCustomerGroupCreateState({
        saving: false,
        error: '',
        success: 'Customer group created.'
      });
      fetchList();
    } catch (err) {
      setCustomerGroupCreateState({
        saving: false,
        error: err?.message || 'Unable to create customer group.',
        success: ''
      });
    }
  };

  const handleInventoryItemCreateDraftChange = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setInventoryItemCreateDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleCreateInventoryItem = async (event) => {
    event.preventDefault();
    const title = inventoryItemCreateDraft.title.trim();
    const sku = inventoryItemCreateDraft.sku.trim();
    const description = inventoryItemCreateDraft.description.trim();
    const material = inventoryItemCreateDraft.material.trim();
    const hsCode = inventoryItemCreateDraft.hs_code.trim();
    const originCountry = inventoryItemCreateDraft.origin_country.trim();
    const midCode = inventoryItemCreateDraft.mid_code.trim();
    const thumbnail = inventoryItemCreateDraft.thumbnail.trim();
    const weightResult = parseNullableNumberInput(inventoryItemCreateDraft.weight);
    const lengthResult = parseNullableNumberInput(inventoryItemCreateDraft.length);
    const heightResult = parseNullableNumberInput(inventoryItemCreateDraft.height);
    const widthResult = parseNullableNumberInput(inventoryItemCreateDraft.width);
    const { data: metadata, error: metadataError } = parseJsonInput(inventoryItemCreateDraft.metadata);
    const locationId = inventoryItemCreateDraft.location_id.trim();
    const stockedResult = parseNullableNumberInput(inventoryItemCreateDraft.stocked_quantity);
    const incomingResult = parseNullableNumberInput(inventoryItemCreateDraft.incoming_quantity);

    if (!title && !sku) {
      setInventoryItemCreateState({
        saving: false,
        error: 'Add at least a title or SKU.',
        success: ''
      });
      return;
    }

    if (
      weightResult.error ||
      lengthResult.error ||
      heightResult.error ||
      widthResult.error ||
      stockedResult.error ||
      incomingResult.error
    ) {
      setInventoryItemCreateState({
        saving: false,
        error: 'Numeric fields must be valid numbers.',
        success: ''
      });
      return;
    }

    if (metadataError) {
      setInventoryItemCreateState({
        saving: false,
        error: `Metadata JSON error: ${metadataError}`,
        success: ''
      });
      return;
    }

    const locationLevels = locationId
      ? [
          {
            location_id: locationId,
            ...(stockedResult.value != null ? { stocked_quantity: stockedResult.value } : {}),
            ...(incomingResult.value != null ? { incoming_quantity: incomingResult.value } : {})
          }
        ]
      : undefined;

    setInventoryItemCreateState({ saving: true, error: '', success: '' });
    try {
      await request('/admin/inventory-items', {
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
          requires_shipping: Boolean(inventoryItemCreateDraft.requires_shipping),
          ...(weightResult.value != null ? { weight: weightResult.value } : {}),
          ...(lengthResult.value != null ? { length: lengthResult.value } : {}),
          ...(heightResult.value != null ? { height: heightResult.value } : {}),
          ...(widthResult.value != null ? { width: widthResult.value } : {}),
          ...(metadata && typeof metadata === 'object' ? { metadata } : {}),
          ...(locationLevels ? { location_levels: locationLevels } : {})
        }
      });
      setInventoryItemCreateDraft({
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
        metadata: '',
        location_id: '',
        stocked_quantity: '',
        incoming_quantity: ''
      });
      setInventoryItemCreateState({
        saving: false,
        error: '',
        success: 'Inventory item created.'
      });
      fetchList();
    } catch (err) {
      setInventoryItemCreateState({
        saving: false,
        error: err?.message || 'Unable to create inventory item.',
        success: ''
      });
    }
  };

  const handleStockLocationCreateDraftChange = (field) => (event) => {
    const value = event.target.value;
    setStockLocationCreateDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleCreateStockLocation = async (event) => {
    event.preventDefault();
    const name = stockLocationCreateDraft.name.trim();
    const address1 = stockLocationCreateDraft.address_1.trim();
    const address2 = stockLocationCreateDraft.address_2.trim();
    const city = stockLocationCreateDraft.city.trim();
    const province = stockLocationCreateDraft.province.trim();
    const postalCode = stockLocationCreateDraft.postal_code.trim();
    const countryCode = stockLocationCreateDraft.country_code.trim();
    const phone = stockLocationCreateDraft.phone.trim();
    const { data: metadata, error: metadataError } = parseJsonInput(stockLocationCreateDraft.metadata);

    if (!name) {
      setStockLocationCreateState({
        saving: false,
        error: 'Location name is required.',
        success: ''
      });
      return;
    }

    if (metadataError) {
      setStockLocationCreateState({
        saving: false,
        error: `Metadata JSON error: ${metadataError}`,
        success: ''
      });
      return;
    }

    const hasAddressFields =
      address1 || address2 || city || province || postalCode || countryCode || phone;
    if (hasAddressFields && (!address1 || !countryCode)) {
      setStockLocationCreateState({
        saving: false,
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

    setStockLocationCreateState({ saving: true, error: '', success: '' });
    try {
      await request('/admin/stock-locations', {
        method: 'POST',
        body: {
          name,
          ...(addressPayload ? { address: addressPayload } : {}),
          ...(metadata && typeof metadata === 'object' ? { metadata } : {})
        }
      });
      setStockLocationCreateDraft({
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
      setStockLocationCreateState({
        saving: false,
        error: '',
        success: 'Stock location created.'
      });
      fetchList();
    } catch (err) {
      setStockLocationCreateState({
        saving: false,
        error: err?.message || 'Unable to create stock location.',
        success: ''
      });
    }
  };

  const handleCollectionCreateDraftChange = (field) => (event) => {
    const value = event.target.value;
    setCollectionCreateDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleCreateCollection = async (event) => {
    event.preventDefault();
    const title = collectionCreateDraft.title.trim();
    const handleValue = collectionCreateDraft.handle.trim();
    const description = collectionCreateDraft.description.trim();
    const thumbnail = collectionCreateDraft.thumbnail.trim();
    const { data: metadata, error: metadataError } = parseJsonInput(collectionCreateDraft.metadata);

    if (!title) {
      setCollectionCreateState({
        saving: false,
        error: 'Collection title is required.',
        success: ''
      });
      return;
    }

    if (metadataError) {
      setCollectionCreateState({
        saving: false,
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

    setCollectionCreateState({ saving: true, error: '', success: '' });
    try {
      await request('/admin/collections', {
        method: 'POST',
        body: {
          title,
          ...(handleValue ? { handle: handleValue } : {}),
          ...(description ? { description } : {}),
          ...(nextMetadata && typeof nextMetadata === 'object' ? { metadata: nextMetadata } : {})
        }
      });
      setCollectionCreateDraft({
        title: '',
        handle: '',
        description: '',
        thumbnail: '',
        metadata: ''
      });
      setCollectionCreateUploadState({ uploading: false, error: '', success: '' });
      setCollectionCreateState({
        saving: false,
        error: '',
        success: 'Collection created.'
      });
      fetchList();
    } catch (err) {
      setCollectionCreateState({
        saving: false,
        error: err?.message || 'Unable to create collection.',
        success: ''
      });
    }
  };

  const handleCollectionCreateThumbnailUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setCollectionCreateUploadState({ uploading: true, error: '', success: '' });
    try {
      const payload = await uploadFiles(file);
      const files = getArrayFromPayload(payload, 'files');
      const uploaded = files[0] || payload?.file;
      const url = uploaded?.url || uploaded?.id;
      if (!url) {
        throw new Error('Upload response missing file URL.');
      }
      setCollectionCreateDraft((prev) => ({ ...prev, thumbnail: url }));
      setCollectionCreateUploadState({
        uploading: false,
        error: '',
        success: 'Thumbnail uploaded.'
      });
    } catch (err) {
      setCollectionCreateUploadState({
        uploading: false,
        error: err?.message || 'Unable to upload thumbnail.',
        success: ''
      });
    } finally {
      event.target.value = '';
    }
  };

  const handleCategoryCreateDraftChange = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setCategoryCreateDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleCategoryCreateThumbnailUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setCategoryCreateUploadState({ uploading: true, error: '', success: '' });
    try {
      const payload = await uploadFiles(file);
      const files = getArrayFromPayload(payload, 'files');
      const uploaded = files[0] || payload?.file;
      const url = uploaded?.url || uploaded?.id;
      if (!url) {
        throw new Error('Upload response missing file URL.');
      }
      setCategoryCreateDraft((prev) => ({ ...prev, thumbnail: url }));
      setCategoryCreateUploadState({
        uploading: false,
        error: '',
        success: 'Thumbnail uploaded.'
      });
    } catch (err) {
      setCategoryCreateUploadState({
        uploading: false,
        error: err?.message || 'Unable to upload thumbnail.',
        success: ''
      });
    } finally {
      event.target.value = '';
    }
  };

  const handleCreateCategory = async (event) => {
    event.preventDefault();
    const name = categoryCreateDraft.name.trim();
    const handleValue = categoryCreateDraft.handle.trim();
    const description = categoryCreateDraft.description.trim();
    const parentId = categoryCreateDraft.parent_category_id.trim();
    const thumbnail = categoryCreateDraft.thumbnail.trim();
    const { data: metadata, error: metadataError } = parseJsonInput(categoryCreateDraft.metadata);

    if (!name) {
      setCategoryCreateState({
        saving: false,
        error: 'Category name is required.',
        success: ''
      });
      return;
    }

    if (metadataError) {
      setCategoryCreateState({
        saving: false,
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

    setCategoryCreateState({ saving: true, error: '', success: '' });
    try {
      await request('/admin/product-categories', {
        method: 'POST',
        body: {
          name,
          ...(handleValue ? { handle: handleValue } : {}),
          ...(description ? { description } : {}),
          is_active: Boolean(categoryCreateDraft.is_active),
          is_internal: Boolean(categoryCreateDraft.is_internal),
          ...(parentId ? { parent_category_id: parentId } : {}),
          ...(nextMetadata && typeof nextMetadata === 'object' ? { metadata: nextMetadata } : {})
        }
      });
      setCategoryCreateDraft({
        name: '',
        handle: '',
        description: '',
        parent_category_id: '',
        is_active: true,
        is_internal: false,
        thumbnail: '',
        metadata: ''
      });
      setCategoryCreateUploadState({ uploading: false, error: '', success: '' });
      setCategoryCreateState({
        saving: false,
        error: '',
        success: 'Category created.'
      });
      fetchList();
    } catch (err) {
      setCategoryCreateState({
        saving: false,
        error: err?.message || 'Unable to create category.',
        success: ''
      });
    }
  };

  const handleProductTypeCreateDraftChange = (field) => (event) => {
    const value = event.target.value;
    setProductTypeCreateDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleCreateProductType = async (event) => {
    event.preventDefault();
    const value = productTypeCreateDraft.value.trim();
    const { data: metadata, error: metadataError } = parseJsonInput(
      productTypeCreateDraft.metadata
    );

    if (!value) {
      setProductTypeCreateState({
        saving: false,
        error: 'Value is required.',
        success: ''
      });
      return;
    }

    if (metadataError) {
      setProductTypeCreateState({
        saving: false,
        error: `Metadata JSON error: ${metadataError}`,
        success: ''
      });
      return;
    }

    setProductTypeCreateState({ saving: true, error: '', success: '' });
    try {
      await request('/admin/product-types', {
        method: 'POST',
        body: {
          value,
          ...(metadata && typeof metadata === 'object' ? { metadata } : {})
        }
      });
      setProductTypeCreateDraft({ value: '', metadata: '' });
      setProductTypeCreateState({
        saving: false,
        error: '',
        success: 'Product type created.'
      });
      fetchList();
    } catch (err) {
      setProductTypeCreateState({
        saving: false,
        error: err?.message || 'Unable to create product type.',
        success: ''
      });
    }
  };

  const handleProductTagCreateDraftChange = (field) => (event) => {
    const value = event.target.value;
    setProductTagCreateDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleCreateProductTag = async (event) => {
    event.preventDefault();
    const value = productTagCreateDraft.value.trim();
    const { data: metadata, error: metadataError } = parseJsonInput(productTagCreateDraft.metadata);

    if (!value) {
      setProductTagCreateState({
        saving: false,
        error: 'Value is required.',
        success: ''
      });
      return;
    }

    if (metadataError) {
      setProductTagCreateState({
        saving: false,
        error: `Metadata JSON error: ${metadataError}`,
        success: ''
      });
      return;
    }

    setProductTagCreateState({ saving: true, error: '', success: '' });
    try {
      await request('/admin/product-tags', {
        method: 'POST',
        body: {
          value,
          ...(metadata && typeof metadata === 'object' ? { metadata } : {})
        }
      });
      setProductTagCreateDraft({ value: '', metadata: '' });
      setProductTagCreateState({
        saving: false,
        error: '',
        success: 'Product tag created.'
      });
      fetchList();
    } catch (err) {
      setProductTagCreateState({
        saving: false,
        error: err?.message || 'Unable to create product tag.',
        success: ''
      });
    }
  };

  const handleSalesChannelCreateDraftChange = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setSalesChannelCreateDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleCreateSalesChannel = async (event) => {
    event.preventDefault();
    const name = salesChannelCreateDraft.name.trim();
    const description = salesChannelCreateDraft.description.trim();
    const { data: metadata, error: metadataError } = parseJsonInput(
      salesChannelCreateDraft.metadata
    );

    if (!name) {
      setSalesChannelCreateState({
        saving: false,
        error: 'Sales channel name is required.',
        success: ''
      });
      return;
    }

    if (metadataError) {
      setSalesChannelCreateState({
        saving: false,
        error: `Metadata JSON error: ${metadataError}`,
        success: ''
      });
      return;
    }

    setSalesChannelCreateState({ saving: true, error: '', success: '' });
    try {
      await request('/admin/sales-channels', {
        method: 'POST',
        body: {
          name,
          ...(description ? { description } : {}),
          is_disabled: Boolean(salesChannelCreateDraft.is_disabled),
          ...(metadata && typeof metadata === 'object' ? { metadata } : {})
        }
      });
      setSalesChannelCreateDraft({
        name: '',
        description: '',
        is_disabled: false,
        metadata: ''
      });
      setSalesChannelCreateState({
        saving: false,
        error: '',
        success: 'Sales channel created.'
      });
      fetchList();
    } catch (err) {
      setSalesChannelCreateState({
        saving: false,
        error: err?.message || 'Unable to create sales channel.',
        success: ''
      });
    }
  };

  const handleInviteCreateDraftChange = (field) => (event) => {
    const value = event.target.value;
    setInviteCreateDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleCreateInvite = async (event) => {
    event.preventDefault();
    const email = inviteCreateDraft.email.trim();
    const { data: metadata, error: metadataError } = parseJsonInput(inviteCreateDraft.metadata);

    if (!email) {
      setInviteCreateState({
        saving: false,
        error: 'Email is required.',
        success: ''
      });
      return;
    }

    if (metadataError) {
      setInviteCreateState({
        saving: false,
        error: `Metadata JSON error: ${metadataError}`,
        success: ''
      });
      return;
    }

    setInviteCreateState({ saving: true, error: '', success: '' });
    try {
      await request('/admin/invites', {
        method: 'POST',
        body: {
          email,
          ...(metadata && typeof metadata === 'object' ? { metadata } : {})
        }
      });
      setInviteCreateDraft({ email: '', metadata: '' });
      setInviteCreateState({
        saving: false,
        error: '',
        success: 'Invite sent.'
      });
      fetchList();
    } catch (err) {
      setInviteCreateState({
        saving: false,
        error: err?.message || 'Unable to send invite.',
        success: ''
      });
    }
  };

  const handleApiKeyCreateDraftChange = (field) => (event) => {
    const value = event.target.value;
    setApiKeyCreateDraft((prev) => ({ ...prev, [field]: value }));
  };

  const handleCreateApiKey = async (event) => {
    event.preventDefault();
    const title = apiKeyCreateDraft.title.trim();
    const type = apiKeyCreateDraft.type.trim();

    if (!title || !type) {
      setApiKeyCreateState({
        saving: false,
        error: 'Title and type are required.',
        success: ''
      });
      return;
    }

    setApiKeyCreateState({ saving: true, error: '', success: '' });
    setApiKeyCreateSecret('');
    try {
      const payload = await request('/admin/api-keys', {
        method: 'POST',
        body: { title, type }
      });
      const createdKey = payload?.api_key || payload?.apiKey || null;
      setApiKeyCreateDraft({ title: '', type: apiKeyCreateDraft.type || 'secret' });
      setApiKeyCreateState({
        saving: false,
        error: '',
        success: 'API key created. Copy the secret now.'
      });
      if (createdKey?.token) {
        setApiKeyCreateSecret(createdKey.token);
      }
      fetchList();
    } catch (err) {
      setApiKeyCreateState({
        saving: false,
        error: err?.message || 'Unable to create API key.',
        success: ''
      });
    }
  };

  const hasActiveFilters =
    statusFilters.length > 0 ||
    collectionId ||
    categoryId ||
    salesChannelId ||
    typeId ||
    tagId;
  const displayRows = isUploadList ? uploadRows : rows;

  return (
    <div>
      <PageHeader
        eyebrow="Collection"
        title={resource.label}
        subtitle={`Manage ${resource.label.toLowerCase()} with the LDC workflow.`}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {isDraftOrderList ? (
              <button
                className="ldc-button-primary"
                type="button"
                onClick={() => navigate('/draft-orders/new')}
              >
                Create Draft Order
              </button>
            ) : null}
            {!isUploadList ? (
              <form className="flex items-center gap-2" onSubmit={handleSearch}>
                <input
                  className="ldc-input h-11 w-48"
                  name="q"
                  placeholder={`Search ${resource.label.toLowerCase()}...`}
                  defaultValue={query}
                />
                <button className="ldc-button-secondary" type="submit">
                  Search
                </button>
              </form>
            ) : null}
            {isProductList ? (
              <div className="flex items-center gap-2">
                <select
                  className="ldc-input h-11 w-44"
                  value={order}
                  onChange={handleOrderChange}
                  aria-label="Sort products"
                >
                  {PRODUCT_ORDER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <select
                  className="ldc-input h-11 w-28"
                  value={String(limit)}
                  onChange={handleLimitChange}
                  aria-label="Products per page"
                >
                  {PRODUCT_PAGE_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size} / page
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
        }
      />

      {isProductList ? (
        <div className="mb-6 ldc-card p-4">
          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-[220px]">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                Status
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {PRODUCT_STATUS_OPTIONS.map((status) => (
                  <label
                    key={status.value}
                    className="flex items-center gap-2 rounded-full border border-white/70 bg-white/70 px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/70"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-ldc-plum"
                      checked={statusFilters.includes(status.value)}
                      onChange={() => handleStatusToggle(status.value)}
                    />
                    {status.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="min-w-[200px]">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                Collection
              </div>
              <select
                className="ldc-input mt-2"
                value={collectionId}
                onChange={handleSelectChange('collection_id')}
              >
                <option value="">All collections</option>
                {productFilters.collections.map((collection) => (
                  <option key={collection.id} value={collection.id}>
                    {collection.title || collection.handle || collection.id}
                  </option>
                ))}
              </select>
            </div>

            <div className="min-w-[200px]">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                Category
              </div>
              <select
                className="ldc-input mt-2"
                value={categoryId}
                onChange={handleSelectChange('category_id')}
              >
                <option value="">All categories</option>
                {productFilters.categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name || category.handle || category.id}
                  </option>
                ))}
              </select>
            </div>

            <div className="min-w-[200px]">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                Sales channel
              </div>
              <select
                className="ldc-input mt-2"
                value={salesChannelId}
                onChange={handleSelectChange('sales_channel_id')}
              >
                <option value="">All channels</option>
                {productFilters.salesChannels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.name || channel.id}
                  </option>
                ))}
              </select>
            </div>

            <div className="min-w-[200px]">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                Type
              </div>
              <select
                className="ldc-input mt-2"
                value={typeId}
                onChange={handleSelectChange('type_id')}
              >
                <option value="">All types</option>
                {productFilters.types.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.value || type.name || type.id}
                  </option>
                ))}
              </select>
            </div>

            <div className="min-w-[200px]">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                Tag
              </div>
              <select
                className="ldc-input mt-2"
                value={tagId}
                onChange={handleSelectChange('tag_id')}
              >
                <option value="">All tags</option>
                {productFilters.tags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.value || tag.id}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-ldc-ink/70">
            <div>
              {filtersLoading ? 'Loading filters...' : null}
              {!filtersLoading && filtersError ? (
                <span className="text-rose-600">{filtersError}</span>
              ) : null}
            </div>
            <button
              className="ldc-button-secondary"
              type="button"
              onClick={clearFilters}
              disabled={!hasActiveFilters}
            >
              Clear filters
            </button>
          </div>
        </div>
      ) : null}

      {isRegionList ? (
        <div className="mb-6 ldc-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-heading text-lg text-ldc-ink">Create region</h3>
            {listMetaLoading ? (
              <span className="text-xs text-ldc-ink/60">Loading providers...</span>
            ) : null}
          </div>
          <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={handleCreateRegion}>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Name
              <input
                className="ldc-input mt-2"
                value={regionDraft.name}
                onChange={handleRegionDraftChange('name')}
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Currency code (ISO)
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
              {listMeta.paymentProviders.length ? (
                <div className="mt-2 max-h-40 space-y-2 overflow-y-auto rounded-2xl bg-white/70 p-3">
                  {listMeta.paymentProviders.map((provider) => {
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
                  placeholder="pp_system_default"
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
            {listMetaError ? (
              <div className="md:col-span-2 text-sm text-rose-600">{listMetaError}</div>
            ) : null}
            {renderListMetaFailures('md:col-span-2 text-xs text-ldc-ink/60')}
            {regionCreateState.error ? (
              <div className="md:col-span-2 text-sm text-rose-600">{regionCreateState.error}</div>
            ) : null}
            {regionCreateState.success ? (
              <div className="md:col-span-2 text-sm text-emerald-700">
                {regionCreateState.success}
              </div>
            ) : null}
            <button
              className="ldc-button-primary md:col-span-2"
              type="submit"
              disabled={regionCreateState.saving}
            >
              {regionCreateState.saving ? 'Creating...' : 'Create region'}
            </button>
          </form>
        </div>
      ) : null}

      {isShippingProfileList ? (
        <div className="mb-6 ldc-card p-4">
          <h3 className="font-heading text-lg text-ldc-ink">Create shipping profile</h3>
          <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={handleCreateShippingProfile}>
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
                placeholder="default"
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
            {shippingProfileCreateState.error ? (
              <div className="md:col-span-2 text-sm text-rose-600">
                {shippingProfileCreateState.error}
              </div>
            ) : null}
            {shippingProfileCreateState.success ? (
              <div className="md:col-span-2 text-sm text-emerald-700">
                {shippingProfileCreateState.success}
              </div>
            ) : null}
            <button
              className="ldc-button-primary md:col-span-2"
              type="submit"
              disabled={shippingProfileCreateState.saving}
            >
              {shippingProfileCreateState.saving ? 'Creating...' : 'Create profile'}
            </button>
          </form>
        </div>
      ) : null}

      {isShippingOptionList ? (
        <div className="mb-6 ldc-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-heading text-lg text-ldc-ink">Create shipping option</h3>
            {listMetaLoading ? (
              <span className="text-xs text-ldc-ink/60">Loading settings...</span>
            ) : null}
          </div>
          <form className="mt-4 space-y-4" onSubmit={handleCreateShippingOption}>
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
                {listMeta.fulfillmentProviders.length ? (
                  <select
                    className="ldc-input mt-2"
                    value={shippingOptionDraft.provider_id}
                    onChange={handleShippingOptionDraftChange('provider_id')}
                  >
                    <option value="">Select provider</option>
                    {listMeta.fulfillmentProviders.map((provider) => (
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
                    placeholder="manual_manual"
                  />
                )}
              </label>
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                Shipping profile
                {listMeta.shippingProfiles.length ? (
                  <select
                    className="ldc-input mt-2"
                    value={shippingOptionDraft.shipping_profile_id}
                    onChange={handleShippingOptionDraftChange('shipping_profile_id')}
                  >
                    <option value="">Select profile</option>
                    {listMeta.shippingProfiles.map((profile) => (
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
                    placeholder="profile id"
                  />
                )}
              </label>
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                Service zone
                {listMeta.serviceZones.length ? (
                  <select
                    className="ldc-input mt-2"
                    value={shippingOptionDraft.service_zone_id}
                    onChange={handleShippingOptionDraftChange('service_zone_id')}
                  >
                    <option value="">Select zone</option>
                    {listMeta.serviceZones.map((zone) => (
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
                    placeholder="service zone id"
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
                    {listMeta.regions.length ? (
                      <select
                        className="ldc-input h-10"
                        value={price.region_id}
                        onChange={handleShippingOptionPriceChange(index, 'region_id')}
                      >
                        <option value="">Region</option>
                        {listMeta.regions.map((region) => (
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

            {listMetaError ? (
              <div className="text-sm text-rose-600">{listMetaError}</div>
            ) : null}
            {renderListMetaFailures('text-xs text-ldc-ink/60')}
            {shippingOptionCreateState.error ? (
              <div className="text-sm text-rose-600">{shippingOptionCreateState.error}</div>
            ) : null}
            {shippingOptionCreateState.success ? (
              <div className="text-sm text-emerald-700">{shippingOptionCreateState.success}</div>
            ) : null}

            <button
              className="ldc-button-primary"
              type="submit"
              disabled={shippingOptionCreateState.saving}
            >
              {shippingOptionCreateState.saving ? 'Creating...' : 'Create shipping option'}
            </button>
          </form>
        </div>
      ) : null}

      {isTaxRegionList ? (
        <div className="mb-6 ldc-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-heading text-lg text-ldc-ink">Create tax region</h3>
            {listMetaLoading ? (
              <span className="text-xs text-ldc-ink/60">Loading providers...</span>
            ) : null}
          </div>
          <form className="mt-4 grid gap-4 md:grid-cols-3" onSubmit={handleCreateTaxRegion}>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Country code
              <input
                className="ldc-input mt-2"
                value={taxRegionDraft.country_code}
                onChange={handleTaxRegionDraftChange('country_code')}
                placeholder="us"
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Province code (optional)
              <input
                className="ldc-input mt-2"
                value={taxRegionDraft.province_code}
                onChange={handleTaxRegionDraftChange('province_code')}
                placeholder="ca"
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Tax provider (optional)
              {listMeta.taxProviders.length ? (
                <select
                  className="ldc-input mt-2"
                  value={taxRegionDraft.provider_id}
                  onChange={handleTaxRegionDraftChange('provider_id')}
                >
                  <option value="">Select provider</option>
                  {listMeta.taxProviders.map((provider) => (
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
                  placeholder="tp_system"
                />
              )}
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Parent tax region (optional)
              {listMeta.taxRegions.length ? (
                <select
                  className="ldc-input mt-2"
                  value={taxRegionDraft.parent_id}
                  onChange={handleTaxRegionDraftChange('parent_id')}
                >
                  <option value="">No parent</option>
                  {listMeta.taxRegions.map((region) => (
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
                  placeholder="parent region id"
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

            <div className="md:col-span-3 rounded-2xl bg-white/70 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                Default tax rate (optional)
              </div>
              <div className="mt-3 grid gap-4 md:grid-cols-3">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Name
                  <input
                    className="ldc-input mt-2"
                    value={taxRegionDraft.default_tax_rate_name}
                    onChange={handleTaxRegionDraftChange('default_tax_rate_name')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Code
                  <input
                    className="ldc-input mt-2"
                    value={taxRegionDraft.default_tax_rate_code}
                    onChange={handleTaxRegionDraftChange('default_tax_rate_code')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Rate (%)
                  <input
                    className="ldc-input mt-2"
                    type="number"
                    min="0"
                    step="0.01"
                    value={taxRegionDraft.default_tax_rate_rate}
                    onChange={handleTaxRegionDraftChange('default_tax_rate_rate')}
                  />
                </label>
                <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-ldc-plum"
                    checked={taxRegionDraft.default_tax_rate_is_combinable}
                    onChange={handleTaxRegionDraftChange('default_tax_rate_is_combinable')}
                  />
                  Combinable
                </label>
                <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Default tax rate metadata (optional)
                  <textarea
                    className="ldc-input mt-2 min-h-[70px] font-mono text-xs"
                    value={taxRegionDraft.default_tax_rate_metadata}
                    onChange={handleTaxRegionDraftChange('default_tax_rate_metadata')}
                    placeholder='{"source":"manual"}'
                  />
                </label>
              </div>
            </div>
            {listMetaError ? (
              <div className="md:col-span-3 text-sm text-rose-600">{listMetaError}</div>
            ) : null}
            {renderListMetaFailures('md:col-span-3 text-xs text-ldc-ink/60')}
            {taxRegionCreateState.error ? (
              <div className="md:col-span-3 text-sm text-rose-600">
                {taxRegionCreateState.error}
              </div>
            ) : null}
            {taxRegionCreateState.success ? (
              <div className="md:col-span-3 text-sm text-emerald-700">
                {taxRegionCreateState.success}
              </div>
            ) : null}
            <button
              className="ldc-button-primary md:col-span-3"
              type="submit"
              disabled={taxRegionCreateState.saving}
            >
              {taxRegionCreateState.saving ? 'Creating...' : 'Create tax region'}
            </button>
          </form>
        </div>
      ) : null}

      {isTaxRateList ? (
        <div className="mb-6 ldc-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-heading text-lg text-ldc-ink">Create tax rate</h3>
            {listMetaLoading ? (
              <span className="text-xs text-ldc-ink/60">Loading tax regions...</span>
            ) : null}
          </div>
          <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={handleCreateTaxRate}>
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
              {listMeta.taxRegions.length ? (
                <select
                  className="ldc-input mt-2"
                  value={taxRateDraft.tax_region_id}
                  onChange={handleTaxRateDraftChange('tax_region_id')}
                >
                  <option value="">Select tax region</option>
                  {listMeta.taxRegions.map((region) => (
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
                  placeholder="tax region id"
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
                        <label key={category.id} className="flex items-center gap-2 text-xs text-ldc-ink/80">
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
                        <label key={option.id} className="flex items-center gap-2 text-xs text-ldc-ink/80">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-ldc-plum"
                            checked={taxRateRuleDraft.shipping_option_ids.includes(option.id)}
                            onChange={() => handleTaxRateRuleToggle('shipping_option_ids', option.id)}
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
            {listMetaError ? (
              <div className="md:col-span-2 text-sm text-rose-600">{listMetaError}</div>
            ) : null}
            {renderListMetaFailures('md:col-span-2 text-xs text-ldc-ink/60')}
            {taxRateCreateState.error ? (
              <div className="md:col-span-2 text-sm text-rose-600">
                {taxRateCreateState.error}
              </div>
            ) : null}
            {taxRateCreateState.success ? (
              <div className="md:col-span-2 text-sm text-emerald-700">
                {taxRateCreateState.success}
              </div>
            ) : null}
            <button
              className="ldc-button-primary md:col-span-2"
              type="submit"
              disabled={taxRateCreateState.saving}
            >
              {taxRateCreateState.saving ? 'Creating...' : 'Create tax rate'}
            </button>
          </form>
        </div>
      ) : null}

      {isReturnReasonList ? (
        <div className="mb-6 ldc-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-heading text-lg text-ldc-ink">Create return reason</h3>
            {returnReasonMetaLoading ? (
              <span className="text-xs text-ldc-ink/60">Loading existing reasons...</span>
            ) : null}
          </div>
          <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={handleCreateReturnReason}>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Label
              <input
                className="ldc-input mt-2"
                value={returnReasonCreateDraft.label}
                onChange={handleReturnReasonDraftChange('label')}
                placeholder="Damaged item"
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Value
              <input
                className="ldc-input mt-2"
                value={returnReasonCreateDraft.value}
                onChange={handleReturnReasonDraftChange('value')}
                placeholder="damaged"
              />
            </label>
            <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Description (optional)
              <textarea
                className="ldc-input mt-2 min-h-[90px]"
                value={returnReasonCreateDraft.description}
                onChange={handleReturnReasonDraftChange('description')}
                placeholder="Describe when to use this return reason."
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Parent reason (optional)
              {returnReasonMeta.reasons.length ? (
                <select
                  className="ldc-input mt-2"
                  value={returnReasonCreateDraft.parent_return_reason_id}
                  onChange={handleReturnReasonDraftChange('parent_return_reason_id')}
                >
                  <option value="">No parent</option>
                  {returnReasonMeta.reasons.map((reason) => (
                    <option key={reason.id} value={reason.id}>
                      {reason.label || reason.value || reason.id}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="ldc-input mt-2"
                  value={returnReasonCreateDraft.parent_return_reason_id}
                  onChange={handleReturnReasonDraftChange('parent_return_reason_id')}
                  placeholder="rr_..."
                />
              )}
            </label>
            <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Metadata (optional)
              <textarea
                className="ldc-input mt-2 min-h-[90px] font-mono text-xs"
                value={returnReasonCreateDraft.metadata}
                onChange={handleReturnReasonDraftChange('metadata')}
                placeholder='{"priority":"high"}'
              />
            </label>
            {returnReasonMetaError ? (
              <div className="md:col-span-2 text-sm text-rose-600">{returnReasonMetaError}</div>
            ) : null}
            {returnReasonCreateState.error ? (
              <div className="md:col-span-2 text-sm text-rose-600">
                {returnReasonCreateState.error}
              </div>
            ) : null}
            {returnReasonCreateState.success ? (
              <div className="md:col-span-2 text-sm text-emerald-700">
                {returnReasonCreateState.success}
              </div>
            ) : null}
            <button
              className="ldc-button-primary md:col-span-2"
              type="submit"
              disabled={returnReasonCreateState.saving}
            >
              {returnReasonCreateState.saving ? 'Creating...' : 'Create return reason'}
            </button>
          </form>
        </div>
      ) : null}

      {isRefundReasonList ? (
        <div className="mb-6 ldc-card p-4">
          <h3 className="font-heading text-lg text-ldc-ink">Create refund reason</h3>
          <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={handleCreateRefundReason}>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Label
              <input
                className="ldc-input mt-2"
                value={refundReasonCreateDraft.label}
                onChange={handleRefundReasonDraftChange('label')}
                placeholder="Customer complaint"
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Code
              <input
                className="ldc-input mt-2"
                value={refundReasonCreateDraft.code}
                onChange={handleRefundReasonDraftChange('code')}
                placeholder="complaint"
              />
            </label>
            <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Description (optional)
              <textarea
                className="ldc-input mt-2 min-h-[90px]"
                value={refundReasonCreateDraft.description}
                onChange={handleRefundReasonDraftChange('description')}
                placeholder="Describe when to use this refund reason."
              />
            </label>
            {refundReasonCreateState.error ? (
              <div className="md:col-span-2 text-sm text-rose-600">
                {refundReasonCreateState.error}
              </div>
            ) : null}
            {refundReasonCreateState.success ? (
              <div className="md:col-span-2 text-sm text-emerald-700">
                {refundReasonCreateState.success}
              </div>
            ) : null}
            <button
              className="ldc-button-primary md:col-span-2"
              type="submit"
              disabled={refundReasonCreateState.saving}
            >
              {refundReasonCreateState.saving ? 'Creating...' : 'Create refund reason'}
            </button>
          </form>
        </div>
      ) : null}

      {isPromotionList ? (
        <div className="mb-6 ldc-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-heading text-lg text-ldc-ink">Create promotion</h3>
            {listMetaLoading ? (
              <span className="text-xs text-ldc-ink/60">Loading campaigns...</span>
            ) : null}
          </div>
          <form className="mt-4 space-y-4" onSubmit={handleCreatePromotion}>
            <div className="grid gap-4 md:grid-cols-3">
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                Code (optional for auto)
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
                {listMeta.campaigns.length ? (
                  <select
                    className="ldc-input mt-2"
                    value={promotionDraft.campaign_id}
                    onChange={handlePromotionDraftChange('campaign_id')}
                  >
                    <option value="">No campaign</option>
                    {listMeta.campaigns.map((campaign) => (
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
              Automatic promotion (no code required)
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
                placeholder='{"application_method":{"type":"percentage","value":10,"target_type":"items"}}'
              />
            </label>

            {listMetaError ? (
              <div className="text-sm text-rose-600">{listMetaError}</div>
            ) : null}
            {renderListMetaFailures('text-xs text-ldc-ink/60')}
            {promotionCreateState.error ? (
              <div className="text-sm text-rose-600">{promotionCreateState.error}</div>
            ) : null}
            {promotionCreateState.success ? (
              <div className="text-sm text-emerald-700">{promotionCreateState.success}</div>
            ) : null}

            <button
              className="ldc-button-primary"
              type="submit"
              disabled={promotionCreateState.saving}
            >
              {promotionCreateState.saving ? 'Creating...' : 'Create promotion'}
            </button>
          </form>
        </div>
      ) : null}

      {isCampaignList ? (
        <div className="mb-6 ldc-card p-4">
          <h3 className="font-heading text-lg text-ldc-ink">Create campaign</h3>
          <form className="mt-4 space-y-4" onSubmit={handleCreateCampaign}>
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

            {campaignCreateState.error ? (
              <div className="text-sm text-rose-600">{campaignCreateState.error}</div>
            ) : null}
            {campaignCreateState.success ? (
              <div className="text-sm text-emerald-700">{campaignCreateState.success}</div>
            ) : null}
            <button
              className="ldc-button-primary"
              type="submit"
              disabled={campaignCreateState.saving}
            >
              {campaignCreateState.saving ? 'Creating...' : 'Create campaign'}
            </button>
          </form>
        </div>
      ) : null}

      {isPriceListList ? (
        <div className="mb-6 ldc-card p-4">
          <h3 className="font-heading text-lg text-ldc-ink">Create price list</h3>
          <form className="mt-4 space-y-4" onSubmit={handleCreatePriceList}>
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
                    <div className="mt-2 text-sm text-rose-600">{priceListProductSearch.error}</div>
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
                          <div className="text-ldc-ink/60">Handle {product.handle || '-'}</div>
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {priceListRuleDraft.product_ids.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {priceListRuleDraft.product_ids.map((productId) => {
                        const product =
                          priceListSelectedProducts.find((item) => item.id === productId) || null;
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

            {priceListCreateState.error ? (
              <div className="text-sm text-rose-600">{priceListCreateState.error}</div>
            ) : null}
            {priceListCreateState.success ? (
              <div className="text-sm text-emerald-700">{priceListCreateState.success}</div>
            ) : null}
            <button
              className="ldc-button-primary"
              type="submit"
              disabled={priceListCreateState.saving}
            >
              {priceListCreateState.saving ? 'Creating...' : 'Create price list'}
            </button>
          </form>
        </div>
      ) : null}

      {isCollectionList ? (
        <div className="mb-6 ldc-card p-4">
          <h3 className="font-heading text-lg text-ldc-ink">Create collection</h3>
          <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={handleCreateCollection}>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Title
              <input
                className="ldc-input mt-2"
                value={collectionCreateDraft.title}
                onChange={handleCollectionCreateDraftChange('title')}
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Handle
              <input
                className="ldc-input mt-2"
                value={collectionCreateDraft.handle}
                onChange={handleCollectionCreateDraftChange('handle')}
                placeholder="summer-sale"
              />
            </label>
            <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Description (optional)
              <textarea
                className="ldc-input mt-2 min-h-[90px]"
                value={collectionCreateDraft.description}
                onChange={handleCollectionCreateDraftChange('description')}
              />
            </label>
            <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Thumbnail URL (optional)
              <input
                className="ldc-input mt-2"
                value={collectionCreateDraft.thumbnail}
                onChange={handleCollectionCreateDraftChange('thumbnail')}
                placeholder="https://..."
              />
            </label>
            <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Upload thumbnail
              <input
                className="ldc-input mt-2"
                type="file"
                accept="image/*"
                onChange={handleCollectionCreateThumbnailUpload}
                disabled={collectionCreateUploadState.uploading}
              />
            </label>
            <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Metadata (optional)
              <textarea
                className="ldc-input mt-2 min-h-[90px] font-mono text-xs"
                value={collectionCreateDraft.metadata}
                onChange={handleCollectionCreateDraftChange('metadata')}
                placeholder='{"hero":"..."}'
              />
            </label>
            {collectionCreateState.error ? (
              <div className="md:col-span-2 text-sm text-rose-600">
                {collectionCreateState.error}
              </div>
            ) : null}
            {collectionCreateUploadState.error ? (
              <div className="md:col-span-2 text-sm text-rose-600">
                {collectionCreateUploadState.error}
              </div>
            ) : null}
            {collectionCreateState.success ? (
              <div className="md:col-span-2 text-sm text-emerald-700">
                {collectionCreateState.success}
              </div>
            ) : null}
            {collectionCreateUploadState.success ? (
              <div className="md:col-span-2 text-sm text-emerald-700">
                {collectionCreateUploadState.success}
              </div>
            ) : null}
            <button
              className="ldc-button-primary md:col-span-2"
              type="submit"
              disabled={collectionCreateState.saving}
            >
              {collectionCreateState.saving ? 'Creating...' : 'Create collection'}
            </button>
          </form>
        </div>
      ) : null}

      {isCategoryList ? (
        <div className="mb-6 ldc-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-heading text-lg text-ldc-ink">Create category</h3>
            {categoryCreateMetaLoading ? (
              <span className="text-xs text-ldc-ink/60">Loading categories...</span>
            ) : null}
          </div>
          <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={handleCreateCategory}>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Name
              <input
                className="ldc-input mt-2"
                value={categoryCreateDraft.name}
                onChange={handleCategoryCreateDraftChange('name')}
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Handle
              <input
                className="ldc-input mt-2"
                value={categoryCreateDraft.handle}
                onChange={handleCategoryCreateDraftChange('handle')}
                placeholder="drinkware"
              />
            </label>
            <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Description (optional)
              <textarea
                className="ldc-input mt-2 min-h-[90px]"
                value={categoryCreateDraft.description}
                onChange={handleCategoryCreateDraftChange('description')}
              />
            </label>
            <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Thumbnail URL (optional)
              <input
                className="ldc-input mt-2"
                value={categoryCreateDraft.thumbnail}
                onChange={handleCategoryCreateDraftChange('thumbnail')}
                placeholder="https://..."
              />
            </label>
            <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Upload thumbnail
              <input
                className="ldc-input mt-2"
                type="file"
                accept="image/*"
                onChange={handleCategoryCreateThumbnailUpload}
                disabled={categoryCreateUploadState.uploading}
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Parent category
              {categoryCreateMeta.categories.length ? (
                <select
                  className="ldc-input mt-2"
                  value={categoryCreateDraft.parent_category_id}
                  onChange={handleCategoryCreateDraftChange('parent_category_id')}
                >
                  <option value="">No parent</option>
                  {categoryCreateMeta.categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name || category.handle || category.id}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="ldc-input mt-2"
                  value={categoryCreateDraft.parent_category_id}
                  onChange={handleCategoryCreateDraftChange('parent_category_id')}
                  placeholder="pcat_..."
                />
              )}
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              <input
                type="checkbox"
                className="h-4 w-4 accent-ldc-plum"
                checked={categoryCreateDraft.is_active}
                onChange={handleCategoryCreateDraftChange('is_active')}
              />
              Active category
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              <input
                type="checkbox"
                className="h-4 w-4 accent-ldc-plum"
                checked={categoryCreateDraft.is_internal}
                onChange={handleCategoryCreateDraftChange('is_internal')}
              />
              Internal-only category
            </label>
            <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Metadata (optional)
              <textarea
                className="ldc-input mt-2 min-h-[90px] font-mono text-xs"
                value={categoryCreateDraft.metadata}
                onChange={handleCategoryCreateDraftChange('metadata')}
                placeholder='{"theme":"featured"}'
              />
            </label>
            {categoryCreateMetaError ? (
              <div className="md:col-span-2 text-sm text-rose-600">
                {categoryCreateMetaError}
              </div>
            ) : null}
            {categoryCreateState.error ? (
              <div className="md:col-span-2 text-sm text-rose-600">
                {categoryCreateState.error}
              </div>
            ) : null}
            {categoryCreateUploadState.error ? (
              <div className="md:col-span-2 text-sm text-rose-600">
                {categoryCreateUploadState.error}
              </div>
            ) : null}
            {categoryCreateState.success ? (
              <div className="md:col-span-2 text-sm text-emerald-700">
                {categoryCreateState.success}
              </div>
            ) : null}
            {categoryCreateUploadState.success ? (
              <div className="md:col-span-2 text-sm text-emerald-700">
                {categoryCreateUploadState.success}
              </div>
            ) : null}
            <button
              className="ldc-button-primary md:col-span-2"
              type="submit"
              disabled={categoryCreateState.saving}
            >
              {categoryCreateState.saving ? 'Creating...' : 'Create category'}
            </button>
          </form>
        </div>
      ) : null}

      {isProductTypeList ? (
        <div className="mb-6 ldc-card p-4">
          <h3 className="font-heading text-lg text-ldc-ink">Create product type</h3>
          <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={handleCreateProductType}>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Value
              <input
                className="ldc-input mt-2"
                value={productTypeCreateDraft.value}
                onChange={handleProductTypeCreateDraftChange('value')}
                placeholder="Drinkware"
              />
            </label>
            <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Metadata (optional)
              <textarea
                className="ldc-input mt-2 min-h-[90px] font-mono text-xs"
                value={productTypeCreateDraft.metadata}
                onChange={handleProductTypeCreateDraftChange('metadata')}
                placeholder='{"priority":"high"}'
              />
            </label>
            {productTypeCreateState.error ? (
              <div className="md:col-span-2 text-sm text-rose-600">
                {productTypeCreateState.error}
              </div>
            ) : null}
            {productTypeCreateState.success ? (
              <div className="md:col-span-2 text-sm text-emerald-700">
                {productTypeCreateState.success}
              </div>
            ) : null}
            <button
              className="ldc-button-primary md:col-span-2"
              type="submit"
              disabled={productTypeCreateState.saving}
            >
              {productTypeCreateState.saving ? 'Creating...' : 'Create product type'}
            </button>
          </form>
        </div>
      ) : null}

      {isProductTagList ? (
        <div className="mb-6 ldc-card p-4">
          <h3 className="font-heading text-lg text-ldc-ink">Create product tag</h3>
          <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={handleCreateProductTag}>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Value
              <input
                className="ldc-input mt-2"
                value={productTagCreateDraft.value}
                onChange={handleProductTagCreateDraftChange('value')}
                placeholder="Bestseller"
              />
            </label>
            <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Metadata (optional)
              <textarea
                className="ldc-input mt-2 min-h-[90px] font-mono text-xs"
                value={productTagCreateDraft.metadata}
                onChange={handleProductTagCreateDraftChange('metadata')}
                placeholder='{"badge":"top"}'
              />
            </label>
            {productTagCreateState.error ? (
              <div className="md:col-span-2 text-sm text-rose-600">
                {productTagCreateState.error}
              </div>
            ) : null}
            {productTagCreateState.success ? (
              <div className="md:col-span-2 text-sm text-emerald-700">
                {productTagCreateState.success}
              </div>
            ) : null}
            <button
              className="ldc-button-primary md:col-span-2"
              type="submit"
              disabled={productTagCreateState.saving}
            >
              {productTagCreateState.saving ? 'Creating...' : 'Create product tag'}
            </button>
          </form>
        </div>
      ) : null}

      {isSalesChannelList ? (
        <div className="mb-6 ldc-card p-4">
          <h3 className="font-heading text-lg text-ldc-ink">Create sales channel</h3>
          <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={handleCreateSalesChannel}>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Name
              <input
                className="ldc-input mt-2"
                value={salesChannelCreateDraft.name}
                onChange={handleSalesChannelCreateDraftChange('name')}
              />
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              <input
                type="checkbox"
                className="h-4 w-4 accent-ldc-plum"
                checked={salesChannelCreateDraft.is_disabled}
                onChange={handleSalesChannelCreateDraftChange('is_disabled')}
              />
              Disabled
            </label>
            <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Description (optional)
              <textarea
                className="ldc-input mt-2 min-h-[90px]"
                value={salesChannelCreateDraft.description}
                onChange={handleSalesChannelCreateDraftChange('description')}
              />
            </label>
            <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Metadata (optional)
              <textarea
                className="ldc-input mt-2 min-h-[90px] font-mono text-xs"
                value={salesChannelCreateDraft.metadata}
                onChange={handleSalesChannelCreateDraftChange('metadata')}
                placeholder='{"region":"US"}'
              />
            </label>
            {salesChannelCreateState.error ? (
              <div className="md:col-span-2 text-sm text-rose-600">
                {salesChannelCreateState.error}
              </div>
            ) : null}
            {salesChannelCreateState.success ? (
              <div className="md:col-span-2 text-sm text-emerald-700">
                {salesChannelCreateState.success}
              </div>
            ) : null}
            <button
              className="ldc-button-primary md:col-span-2"
              type="submit"
              disabled={salesChannelCreateState.saving}
            >
              {salesChannelCreateState.saving ? 'Creating...' : 'Create sales channel'}
            </button>
          </form>
        </div>
      ) : null}

      {isCustomerList ? (
        <div className="mb-6 ldc-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-heading text-lg text-ldc-ink">Create customer</h3>
            {customerCreateMetaLoading ? (
              <span className="text-xs text-ldc-ink/60">Loading groups...</span>
            ) : null}
          </div>
          <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={handleCreateCustomer}>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Email
              <input
                className="ldc-input mt-2"
                type="email"
                value={customerCreateDraft.email}
                onChange={handleCustomerCreateDraftChange('email')}
                placeholder="name@example.com"
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Phone
              <input
                className="ldc-input mt-2"
                value={customerCreateDraft.phone}
                onChange={handleCustomerCreateDraftChange('phone')}
                placeholder="+1 555 000 0000"
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              First name
              <input
                className="ldc-input mt-2"
                value={customerCreateDraft.first_name}
                onChange={handleCustomerCreateDraftChange('first_name')}
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Last name
              <input
                className="ldc-input mt-2"
                value={customerCreateDraft.last_name}
                onChange={handleCustomerCreateDraftChange('last_name')}
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Company name
              <input
                className="ldc-input mt-2"
                value={customerCreateDraft.company_name}
                onChange={handleCustomerCreateDraftChange('company_name')}
              />
            </label>
            <div className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Customer groups
              {customerCreateMeta.groups.length ? (
                <div className="mt-2 max-h-40 space-y-2 overflow-y-auto rounded-2xl bg-white/70 p-3">
                  {customerCreateMeta.groups.map((group) => {
                    if (!group?.id) return null;
                    return (
                      <label
                        key={group.id}
                        className="flex items-center gap-2 text-xs text-ldc-ink/80"
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-ldc-plum"
                          checked={customerCreateGroupIds.includes(group.id)}
                          onChange={() => handleCustomerCreateGroupToggle(group.id)}
                        />
                        <span>{group.name || group.id}</span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-2 text-xs text-ldc-ink/60">No customer groups found.</div>
              )}
            </div>
            <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Notes (optional)
              <textarea
                className="ldc-input mt-2 min-h-[90px]"
                value={customerCreateDraft.note}
                onChange={handleCustomerCreateDraftChange('note')}
                placeholder="Add private notes for this customer."
              />
            </label>
            <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Metadata (optional)
              <textarea
                className="ldc-input mt-2 min-h-[90px] font-mono text-xs"
                value={customerCreateDraft.metadata}
                onChange={handleCustomerCreateDraftChange('metadata')}
                placeholder='{"vip":true}'
              />
            </label>
            {customerCreateMetaError ? (
              <div className="md:col-span-2 text-sm text-rose-600">
                {customerCreateMetaError}
              </div>
            ) : null}
            {customerCreateState.error ? (
              <div className="md:col-span-2 text-sm text-rose-600">
                {customerCreateState.error}
              </div>
            ) : null}
            {customerCreateState.success ? (
              <div className="md:col-span-2 text-sm text-emerald-700">
                {customerCreateState.success}
              </div>
            ) : null}
            <button
              className="ldc-button-primary md:col-span-2"
              type="submit"
              disabled={customerCreateState.saving}
            >
              {customerCreateState.saving ? 'Creating...' : 'Create customer'}
            </button>
          </form>
        </div>
      ) : null}

      {isCustomerGroupList ? (
        <div className="mb-6 ldc-card p-4">
          <h3 className="font-heading text-lg text-ldc-ink">Create customer group</h3>
          <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={handleCreateCustomerGroup}>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Group name
              <input
                className="ldc-input mt-2"
                value={customerGroupCreateDraft.name}
                onChange={handleCustomerGroupCreateDraftChange('name')}
              />
            </label>
            <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Notes (optional)
              <textarea
                className="ldc-input mt-2 min-h-[90px]"
                value={customerGroupCreateDraft.note}
                onChange={handleCustomerGroupCreateDraftChange('note')}
                placeholder="Add internal notes for this group."
              />
            </label>
            <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Metadata (optional)
              <textarea
                className="ldc-input mt-2 min-h-[90px] font-mono text-xs"
                value={customerGroupCreateDraft.metadata}
                onChange={handleCustomerGroupCreateDraftChange('metadata')}
                placeholder='{"segment":"wholesale"}'
              />
            </label>
            {customerGroupCreateState.error ? (
              <div className="md:col-span-2 text-sm text-rose-600">
                {customerGroupCreateState.error}
              </div>
            ) : null}
            {customerGroupCreateState.success ? (
              <div className="md:col-span-2 text-sm text-emerald-700">
                {customerGroupCreateState.success}
              </div>
            ) : null}
            <button
              className="ldc-button-primary md:col-span-2"
              type="submit"
              disabled={customerGroupCreateState.saving}
            >
              {customerGroupCreateState.saving ? 'Creating...' : 'Create customer group'}
            </button>
          </form>
        </div>
      ) : null}

      {isInventoryItemList ? (
        <div className="mb-6 ldc-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-heading text-lg text-ldc-ink">Create inventory item</h3>
            {inventoryItemMetaLoading ? (
              <span className="text-xs text-ldc-ink/60">Loading locations...</span>
            ) : null}
          </div>
          <form className="mt-4 space-y-4" onSubmit={handleCreateInventoryItem}>
            <div className="grid gap-4 md:grid-cols-3">
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                Title
                <input
                  className="ldc-input mt-2"
                  value={inventoryItemCreateDraft.title}
                  onChange={handleInventoryItemCreateDraftChange('title')}
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                SKU
                <input
                  className="ldc-input mt-2"
                  value={inventoryItemCreateDraft.sku}
                  onChange={handleInventoryItemCreateDraftChange('sku')}
                />
              </label>
              <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-ldc-plum"
                  checked={inventoryItemCreateDraft.requires_shipping}
                  onChange={handleInventoryItemCreateDraftChange('requires_shipping')}
                />
                Requires shipping
              </label>
              <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                Thumbnail URL
                <input
                  className="ldc-input mt-2"
                  value={inventoryItemCreateDraft.thumbnail}
                  onChange={handleInventoryItemCreateDraftChange('thumbnail')}
                />
              </label>
            </div>

            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Description (optional)
              <textarea
                className="ldc-input mt-2 min-h-[80px]"
                value={inventoryItemCreateDraft.description}
                onChange={handleInventoryItemCreateDraftChange('description')}
              />
            </label>

            <div className="grid gap-4 md:grid-cols-4">
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                Material
                <input
                  className="ldc-input mt-2"
                  value={inventoryItemCreateDraft.material}
                  onChange={handleInventoryItemCreateDraftChange('material')}
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                HS code
                <input
                  className="ldc-input mt-2"
                  value={inventoryItemCreateDraft.hs_code}
                  onChange={handleInventoryItemCreateDraftChange('hs_code')}
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                Origin country
                <input
                  className="ldc-input mt-2"
                  value={inventoryItemCreateDraft.origin_country}
                  onChange={handleInventoryItemCreateDraftChange('origin_country')}
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                MID code
                <input
                  className="ldc-input mt-2"
                  value={inventoryItemCreateDraft.mid_code}
                  onChange={handleInventoryItemCreateDraftChange('mid_code')}
                />
              </label>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                Weight
                <input
                  className="ldc-input mt-2"
                  type="number"
                  step="0.01"
                  value={inventoryItemCreateDraft.weight}
                  onChange={handleInventoryItemCreateDraftChange('weight')}
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                Length
                <input
                  className="ldc-input mt-2"
                  type="number"
                  step="0.01"
                  value={inventoryItemCreateDraft.length}
                  onChange={handleInventoryItemCreateDraftChange('length')}
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                Height
                <input
                  className="ldc-input mt-2"
                  type="number"
                  step="0.01"
                  value={inventoryItemCreateDraft.height}
                  onChange={handleInventoryItemCreateDraftChange('height')}
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                Width
                <input
                  className="ldc-input mt-2"
                  type="number"
                  step="0.01"
                  value={inventoryItemCreateDraft.width}
                  onChange={handleInventoryItemCreateDraftChange('width')}
                />
              </label>
            </div>

            <div className="rounded-2xl bg-white/70 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                Initial stock level (optional)
              </div>
              <div className="mt-3 grid gap-4 md:grid-cols-3">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Location
                  {inventoryItemMeta.locations.length ? (
                    <select
                      className="ldc-input mt-2"
                      value={inventoryItemCreateDraft.location_id}
                      onChange={handleInventoryItemCreateDraftChange('location_id')}
                    >
                      <option value="">Select location</option>
                      {inventoryItemMeta.locations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.name || location.id}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="ldc-input mt-2"
                      value={inventoryItemCreateDraft.location_id}
                      onChange={handleInventoryItemCreateDraftChange('location_id')}
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
                    value={inventoryItemCreateDraft.stocked_quantity}
                    onChange={handleInventoryItemCreateDraftChange('stocked_quantity')}
                  />
                </label>
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Incoming quantity
                  <input
                    className="ldc-input mt-2"
                    type="number"
                    step="1"
                    value={inventoryItemCreateDraft.incoming_quantity}
                    onChange={handleInventoryItemCreateDraftChange('incoming_quantity')}
                  />
                </label>
              </div>
            </div>

            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Metadata (optional)
              <textarea
                className="ldc-input mt-2 min-h-[90px] font-mono text-xs"
                value={inventoryItemCreateDraft.metadata}
                onChange={handleInventoryItemCreateDraftChange('metadata')}
                placeholder='{"tag":"fragile"}'
              />
            </label>

            {inventoryItemMetaError ? (
              <div className="text-sm text-rose-600">{inventoryItemMetaError}</div>
            ) : null}
            {inventoryItemCreateState.error ? (
              <div className="text-sm text-rose-600">{inventoryItemCreateState.error}</div>
            ) : null}
            {inventoryItemCreateState.success ? (
              <div className="text-sm text-emerald-700">{inventoryItemCreateState.success}</div>
            ) : null}
            <button
              className="ldc-button-primary"
              type="submit"
              disabled={inventoryItemCreateState.saving}
            >
              {inventoryItemCreateState.saving ? 'Creating...' : 'Create inventory item'}
            </button>
          </form>
        </div>
      ) : null}

      {isStockLocationList ? (
        <div className="mb-6 ldc-card p-4">
          <h3 className="font-heading text-lg text-ldc-ink">Create stock location</h3>
          <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={handleCreateStockLocation}>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Name
              <input
                className="ldc-input mt-2"
                value={stockLocationCreateDraft.name}
                onChange={handleStockLocationCreateDraftChange('name')}
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Address line 1
              <input
                className="ldc-input mt-2"
                value={stockLocationCreateDraft.address_1}
                onChange={handleStockLocationCreateDraftChange('address_1')}
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Address line 2
              <input
                className="ldc-input mt-2"
                value={stockLocationCreateDraft.address_2}
                onChange={handleStockLocationCreateDraftChange('address_2')}
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              City
              <input
                className="ldc-input mt-2"
                value={stockLocationCreateDraft.city}
                onChange={handleStockLocationCreateDraftChange('city')}
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Province
              <input
                className="ldc-input mt-2"
                value={stockLocationCreateDraft.province}
                onChange={handleStockLocationCreateDraftChange('province')}
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Postal code
              <input
                className="ldc-input mt-2"
                value={stockLocationCreateDraft.postal_code}
                onChange={handleStockLocationCreateDraftChange('postal_code')}
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Country code
              <input
                className="ldc-input mt-2"
                value={stockLocationCreateDraft.country_code}
                onChange={handleStockLocationCreateDraftChange('country_code')}
                placeholder="US"
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Phone
              <input
                className="ldc-input mt-2"
                value={stockLocationCreateDraft.phone}
                onChange={handleStockLocationCreateDraftChange('phone')}
              />
            </label>
            <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Metadata (optional)
              <textarea
                className="ldc-input mt-2 min-h-[90px] font-mono text-xs"
                value={stockLocationCreateDraft.metadata}
                onChange={handleStockLocationCreateDraftChange('metadata')}
              />
            </label>
            {stockLocationCreateState.error ? (
              <div className="md:col-span-2 text-sm text-rose-600">
                {stockLocationCreateState.error}
              </div>
            ) : null}
            {stockLocationCreateState.success ? (
              <div className="md:col-span-2 text-sm text-emerald-700">
                {stockLocationCreateState.success}
              </div>
            ) : null}
            <button
              className="ldc-button-primary md:col-span-2"
              type="submit"
              disabled={stockLocationCreateState.saving}
            >
              {stockLocationCreateState.saving ? 'Creating...' : 'Create stock location'}
            </button>
          </form>
        </div>
      ) : null}

      {isInviteList ? (
        <div className="mb-6 ldc-card p-4">
          <h3 className="font-heading text-lg text-ldc-ink">Invite team member</h3>
          <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={handleCreateInvite}>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Email
              <input
                className="ldc-input mt-2"
                type="email"
                value={inviteCreateDraft.email}
                onChange={handleInviteCreateDraftChange('email')}
                placeholder="name@example.com"
              />
            </label>
            <label className="md:col-span-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Metadata (optional)
              <textarea
                className="ldc-input mt-2 min-h-[80px] font-mono text-xs"
                value={inviteCreateDraft.metadata}
                onChange={handleInviteCreateDraftChange('metadata')}
                placeholder='{"role":"admin"}'
              />
            </label>
            {inviteCreateState.error ? (
              <div className="md:col-span-2 text-sm text-rose-600">{inviteCreateState.error}</div>
            ) : null}
            {inviteCreateState.success ? (
              <div className="md:col-span-2 text-sm text-emerald-700">
                {inviteCreateState.success}
              </div>
            ) : null}
            <button
              className="ldc-button-primary md:col-span-2"
              type="submit"
              disabled={inviteCreateState.saving}
            >
              {inviteCreateState.saving ? 'Sending...' : 'Send invite'}
            </button>
          </form>
        </div>
      ) : null}

      {isApiKeyList ? (
        <div className="mb-6 ldc-card p-4">
          <h3 className="font-heading text-lg text-ldc-ink">Create API key</h3>
          <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={handleCreateApiKey}>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Title
              <input
                className="ldc-input mt-2"
                value={apiKeyCreateDraft.title}
                onChange={handleApiKeyCreateDraftChange('title')}
              />
            </label>
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Type
              <select
                className="ldc-input mt-2"
                value={apiKeyCreateDraft.type}
                onChange={handleApiKeyCreateDraftChange('type')}
              >
                <option value="secret">Secret</option>
                <option value="publishable">Publishable</option>
              </select>
            </label>
            {apiKeyCreateState.error ? (
              <div className="md:col-span-2 text-sm text-rose-600">{apiKeyCreateState.error}</div>
            ) : null}
            {apiKeyCreateState.success ? (
              <div className="md:col-span-2 text-sm text-emerald-700">
                {apiKeyCreateState.success}
              </div>
            ) : null}
            {apiKeyCreateSecret ? (
              <div className="md:col-span-2 rounded-2xl bg-white/70 p-3 text-xs text-ldc-ink">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                  Secret token (copy now)
                </div>
                <div className="mt-2 break-all font-mono">{apiKeyCreateSecret}</div>
              </div>
            ) : null}
            <button
              className="ldc-button-primary md:col-span-2"
              type="submit"
              disabled={apiKeyCreateState.saving}
            >
              {apiKeyCreateState.saving ? 'Creating...' : 'Create API key'}
            </button>
          </form>
        </div>
      ) : null}

      {error ? <div className="mb-4 text-sm text-rose-600">{error}</div> : null}

      {isUploadList ? (
        <div className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          <div className="ldc-card p-4">
            <h3 className="font-heading text-lg text-ldc-ink">Upload media</h3>
            <p className="mt-1 text-sm text-ldc-ink/70">
              Add new images, labels, and assets to reuse across the catalog.
            </p>
            <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
              Choose files
              <input
                className="ldc-input mt-2"
                type="file"
                multiple
                onChange={handleUploadLibraryChange}
                disabled={uploadState.uploading}
              />
            </label>
            {uploadState.uploading ? (
              <div className="mt-3 text-sm text-ldc-ink/60">Uploading...</div>
            ) : null}
            {uploadState.error ? (
              <div className="mt-3 text-sm text-rose-600">{uploadState.error}</div>
            ) : null}
            {uploadState.success ? (
              <div className="mt-3 text-sm text-emerald-700">{uploadState.success}</div>
            ) : null}
            <div className="mt-3 text-xs text-ldc-ink/60">
              Uploaded files are instantly available for thumbnails and labels.
            </div>
          </div>

          <div className="ldc-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-heading text-lg text-ldc-ink">Media library</h3>
                <p className="mt-1 text-sm text-ldc-ink/70">
                  Browse files, copy URLs, or delete unused assets.
                </p>
              </div>
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
                Search library
                <input
                  className="ldc-input mt-2 h-10"
                  value={uploadSearch}
                  onChange={handleUploadSearchChange}
                  placeholder="Search by name or type..."
                />
              </label>
            </div>
            {uploadDeleteState.error ? (
              <div className="mt-3 text-sm text-rose-600">{uploadDeleteState.error}</div>
            ) : null}
            {uploadDeleteState.success ? (
              <div className="mt-3 text-sm text-emerald-700">{uploadDeleteState.success}</div>
            ) : null}
            {loading ? (
              <div className="mt-4 text-sm text-ldc-ink/60">Loading media...</div>
            ) : displayRows.length ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {displayRows.map((file) => {
                  const fileId = file?.id || getUploadUrl(file) || getUploadName(file);
                  const url = resolveUploadUrl(file);
                  const name = getUploadName(file);
                  const type = formatUploadLabel(file);
                  const canOpen = Boolean(url);
                  return (
                    <div
                      key={fileId}
                      className="flex h-full flex-col rounded-2xl border border-white/70 bg-white/70 p-3"
                    >
                      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl bg-white/80">
                        {isImageFile(file) && url ? (
                          <img src={url} alt={name} className="h-full w-full object-cover" />
                        ) : (
                          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/50">
                            {type}
                          </div>
                        )}
                      </div>
                      <div className="mt-3">
                        <div className="truncate text-sm font-semibold text-ldc-ink">{name}</div>
                        <div className="mt-1 text-xs text-ldc-ink/60">{type}</div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <a
                          className="ldc-button-secondary px-3 py-2 text-xs"
                          href={canOpen ? url : undefined}
                          target="_blank"
                          rel="noreferrer"
                          aria-disabled={!canOpen}
                          onClick={(event) => {
                            if (!canOpen) event.preventDefault();
                          }}
                        >
                          Open
                        </a>
                        <button
                          className="ldc-button-secondary px-3 py-2 text-xs"
                          type="button"
                          onClick={() => handleCopyUploadUrl(file)}
                          disabled={!url}
                        >
                          {uploadCopyId === fileId ? 'Copied' : 'Copy URL'}
                        </button>
                        <button
                          className="ldc-button-secondary px-3 py-2 text-xs text-rose-600"
                          type="button"
                          onClick={() => handleDeleteUpload(file)}
                          disabled={uploadDeleteState.deletingId === fileId}
                        >
                          {uploadDeleteState.deletingId === fileId ? 'Deleting...' : 'Delete'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-4 text-sm text-ldc-ink/60">No uploads found.</div>
            )}
          </div>
        </div>
      ) : null}

      {!isUploadList ? (
        <DataTable
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          onRowClick={handleRowClick}
          isLoading={loading}
          emptyText={`No ${resource.label.toLowerCase()} found.`}
        />
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-ldc-ink/70">
        <div>
          Showing {displayRows.length} of {count} records
        </div>
        <div className="flex items-center gap-2">
          <button
            className="ldc-button-secondary"
            type="button"
            onClick={() => goToPage(Math.max(1, page - 1))}
            disabled={page <= 1}
          >
            Previous
          </button>
          <span className="px-2">
            Page {page} of {totalPages}
          </span>
          <button
            className="ldc-button-secondary"
            type="button"
            onClick={() => goToPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
};

export default ResourceList;
