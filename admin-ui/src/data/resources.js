import { formatDate, formatDateTime, formatMoney, formatStatus } from '../lib/formatters.js';

const formatCountryCodes = (countries) => {
  if (!Array.isArray(countries) || !countries.length) return '-';
  const codes = countries
    .map((country) => {
      if (!country) return null;
      if (typeof country === 'string') return country;
      return country.iso_2 || country.iso2 || country.code || country.id;
    })
    .filter(Boolean)
    .map((code) => String(code).toUpperCase());
  return codes.length ? codes.join(', ') : '-';
};

const formatProviderLabel = (value, row) =>
  row?.provider_id || row?.provider?.id || row?.provider?.code || row?.provider?.name || value || '-';

const formatProfileLabel = (value, row) =>
  row?.shipping_profile?.name || row?.shipping_profile_id || row?.shipping_profile?.id || value || '-';

const formatServiceZoneLabel = (value, row) =>
  row?.service_zone?.name || row?.service_zone_id || value || '-';

const formatGiftCardStatus = (_value, row) => {
  if (!row) return '-';
  if (row?.is_disabled || row?.disabled_at) return 'Disabled';
  const endsAt = row?.ends_at || row?.expires_at;
  if (endsAt) {
    const time = new Date(endsAt).getTime();
    if (Number.isFinite(time) && time < Date.now()) return 'Expired';
  }
  return 'Active';
};

const formatTaxRegionLabel = (region) => {
  if (!region) return '-';
  if (typeof region === 'string') return region;
  const code = region.country_code || region.code || region.id;
  return code ? String(code).toUpperCase() : region.name || region.id || '-';
};

const normalizeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const sumLocationLevels = (levels, key) =>
  levels.reduce((total, level) => total + (normalizeNumber(level?.[key]) || 0), 0);

const getInventoryTotals = (row) => {
  const levels = Array.isArray(row?.location_levels) ? row.location_levels : [];
  const hasLevels = levels.length > 0;
  const inventoryFallback = normalizeNumber(row?.inventory_quantity);
  const stocked =
    normalizeNumber(row?.stocked_quantity) ??
    (hasLevels ? sumLocationLevels(levels, 'stocked_quantity') : inventoryFallback);
  const reserved =
    normalizeNumber(row?.reserved_quantity) ??
    (hasLevels ? sumLocationLevels(levels, 'reserved_quantity') : null);
  const incoming =
    normalizeNumber(row?.incoming_quantity) ??
    (hasLevels ? sumLocationLevels(levels, 'incoming_quantity') : null);
  let available =
    normalizeNumber(row?.available_quantity) ??
    (hasLevels ? sumLocationLevels(levels, 'available_quantity') : null);
  if (available == null && stocked != null && reserved != null) {
    available = stocked - reserved;
  }
  const locations =
    normalizeNumber(row?.location_levels_count) ??
    normalizeNumber(row?.locations_count) ??
    (hasLevels ? levels.length : null);
  return { stocked, reserved, incoming, available, locations };
};

const formatInventoryTotal = (metric) => (_value, row) => {
  const totals = getInventoryTotals(row);
  const value = totals[metric];
  return value == null ? '-' : value;
};

const formatCount = (value) => (Array.isArray(value) ? value.length : '-');

export const resources = [
  {
    id: 'orders',
    label: 'Orders',
    path: '/orders',
    endpoint: '/admin/orders',
    listKey: 'orders',
    detailKey: 'order',
    columns: [
      { key: 'display_id', label: 'Order', format: (value) => (value ? `#${value}` : '-') },
      { key: 'email', label: 'Customer' },
      { key: 'status', label: 'Status', badge: true },
      { key: 'payment_status', label: 'Payment', badge: true },
      { key: 'total', label: 'Total', format: (value, row) => formatMoney(value, row?.currency_code) },
      { key: 'created_at', label: 'Placed', format: formatDateTime }
    ]
  },
  {
    id: 'draft-orders',
    label: 'Draft Orders',
    path: '/draft-orders',
    endpoint: '/admin/draft-orders',
    listKey: 'draft_orders',
    detailKey: 'draft_order',
    columns: [
      { key: 'display_id', label: 'Draft', format: (value) => (value ? `#${value}` : '-') },
      { key: 'email', label: 'Customer' },
      { key: 'status', label: 'Status', badge: true },
      { key: 'total', label: 'Total', format: (value, row) => formatMoney(value, row?.currency_code) },
      { key: 'created_at', label: 'Created', format: formatDateTime }
    ]
  },
  {
    id: 'returns',
    label: 'Returns',
    path: '/returns',
    endpoint: '/admin/returns',
    listKey: 'returns',
    detailKey: 'return',
    columns: [
      { key: 'display_id', label: 'Return', format: (value) => (value ? `#${value}` : '-') },
      { key: 'status', label: 'Status', badge: true },
      { key: 'refund_amount', label: 'Refund', format: (value, row) => formatMoney(value, row?.currency_code) },
      { key: 'created_at', label: 'Created', format: formatDateTime }
    ]
  },
  {
    id: 'exchanges',
    label: 'Exchanges',
    path: '/exchanges',
    endpoint: '/admin/exchanges',
    listKey: 'exchanges',
    detailKey: 'exchange',
    columns: [
      { key: 'display_id', label: 'Exchange', format: (value) => (value ? `#${value}` : '-') },
      { key: 'status', label: 'Status', badge: true },
      { key: 'created_at', label: 'Created', format: formatDateTime }
    ]
  },
  {
    id: 'gift-cards',
    label: 'Gift Cards',
    path: '/gift-cards',
    endpoint: '/admin/gift-cards',
    listKey: 'gift_cards',
    detailKey: 'gift_card',
    listParams: {
      fields: '+region'
    },
    columns: [
      { key: 'code', label: 'Code' },
      {
        key: 'value',
        label: 'Value',
        format: (value, row) =>
          formatMoney(
            value,
            row?.region?.currency_code || row?.region?.currency?.code || row?.currency_code
          )
      },
      {
        key: 'balance',
        label: 'Balance',
        format: (value, row) =>
          formatMoney(
            value,
            row?.region?.currency_code || row?.region?.currency?.code || row?.currency_code
          )
      },
      {
        key: 'region',
        label: 'Region',
        format: (_value, row) =>
          row?.region?.name ||
          row?.region?.currency_code?.toUpperCase() ||
          row?.region_id ||
          '-'
      },
      { key: 'is_disabled', label: 'Status', format: formatGiftCardStatus },
      { key: 'created_at', label: 'Created', format: formatDateTime }
    ]
  },
  {
    id: 'return-reasons',
    label: 'Return Reasons',
    path: '/return-reasons',
    endpoint: '/admin/return-reasons',
    listKey: 'return_reasons',
    detailKey: 'return_reason',
    columns: [
      { key: 'label', label: 'Label' },
      { key: 'value', label: 'Value' },
      { key: 'description', label: 'Description' },
      { key: 'updated_at', label: 'Updated', format: formatDate }
    ]
  },
  {
    id: 'refund-reasons',
    label: 'Refund Reasons',
    path: '/refund-reasons',
    endpoint: '/admin/refund-reasons',
    listKey: 'refund_reasons',
    detailKey: 'refund_reason',
    columns: [
      { key: 'label', label: 'Label' },
      { key: 'code', label: 'Code' },
      { key: 'description', label: 'Description' },
      { key: 'updated_at', label: 'Updated', format: formatDate }
    ]
  },
  {
    id: 'products',
    label: 'Products',
    path: '/products',
    endpoint: '/admin/products',
    listKey: 'products',
    detailKey: 'product',
    columns: [
      { key: 'thumbnail', label: 'Image', type: 'thumbnail' },
      { key: 'title', label: 'Product' },
      { key: 'handle', label: 'Handle' },
      { key: 'status', label: 'Status', badge: true },
      { key: 'created_at', label: 'Created', format: formatDate }
    ]
  },
  {
    id: 'product-variants',
    label: 'Variants',
    path: '/variants',
    endpoint: '/admin/product-variants',
    listKey: 'variants',
    detailKey: 'variant',
    listParams: {
      fields: '+inventory_quantity'
    },
    columns: [
      {
        key: 'thumbnail',
        label: 'Image',
        type: 'thumbnail',
        format: (value, row) =>
          row?.thumbnail ||
          row?.image ||
          row?.cover_image ||
          row?.images?.[0]?.url ||
          row?.images?.[0] ||
          row?.product?.thumbnail ||
          row?.product?.images?.[0]?.url ||
          row?.product?.images?.[0] ||
          value ||
          ''
      },
      { key: 'title', label: 'Variant' },
      { key: 'sku', label: 'SKU' },
      {
        key: 'inventory_quantity',
        label: 'Inventory',
        format: (value, row) => {
          if (row?.manage_inventory === false) return 'Not managed';
          return typeof value === 'number' ? value : '-';
        }
      },
      { key: 'created_at', label: 'Created', format: formatDate }
    ]
  },
  {
    id: 'collections',
    label: 'Collections',
    path: '/collections',
    endpoint: '/admin/collections',
    listKey: 'collections',
    detailKey: 'collection',
    columns: [
      {
        key: 'thumbnail',
        label: 'Image',
        type: 'thumbnail',
        format: (value, row) =>
          row?.metadata?.thumbnail ||
          row?.metadata?.image ||
          row?.metadata?.images?.[0]?.url ||
          row?.metadata?.images?.[0] ||
          row?.thumbnail ||
          row?.image ||
          row?.cover_image ||
          row?.images?.[0]?.url ||
          row?.images?.[0] ||
          value ||
          ''
      },
      { key: 'title', label: 'Collection' },
      { key: 'handle', label: 'Handle' },
      { key: 'updated_at', label: 'Updated', format: formatDate }
    ]
  },
  {
    id: 'product-categories',
    label: 'Categories',
    path: '/categories',
    endpoint: '/admin/product-categories',
    listKey: 'product_categories',
    detailKey: 'product_category',
    columns: [
      { key: 'name', label: 'Category' },
      { key: 'handle', label: 'Handle' },
      { key: 'updated_at', label: 'Updated', format: formatDate }
    ]
  },
  {
    id: 'product-types',
    label: 'Product Types',
    path: '/product-types',
    endpoint: '/admin/product-types',
    listKey: 'product_types',
    detailKey: 'product_type',
    columns: [
      { key: 'value', label: 'Value' },
      { key: 'updated_at', label: 'Updated', format: formatDate }
    ]
  },
  {
    id: 'product-tags',
    label: 'Product Tags',
    path: '/product-tags',
    endpoint: '/admin/product-tags',
    listKey: 'product_tags',
    detailKey: 'product_tag',
    columns: [
      { key: 'value', label: 'Value' },
      { key: 'updated_at', label: 'Updated', format: formatDate }
    ]
  },
  {
    id: 'price-lists',
    label: 'Price Lists',
    path: '/price-lists',
    endpoint: '/admin/price-lists',
    listKey: 'price_lists',
    detailKey: 'price_list',
    columns: [
      { key: 'title', label: 'Price List' },
      { key: 'status', label: 'Status', badge: true },
      { key: 'starts_at', label: 'Start', format: formatDate },
      { key: 'ends_at', label: 'End', format: formatDate }
    ]
  },
  {
    id: 'customers',
    label: 'Customers',
    path: '/customers',
    endpoint: '/admin/customers',
    listKey: 'customers',
    detailKey: 'customer',
    columns: [
      { key: 'first_name', label: 'First name' },
      { key: 'last_name', label: 'Last name' },
      { key: 'email', label: 'Email' },
      { key: 'created_at', label: 'Created', format: formatDate }
    ]
  },
  {
    id: 'customer-groups',
    label: 'Customer Groups',
    path: '/customer-groups',
    endpoint: '/admin/customer-groups',
    listKey: 'customer_groups',
    detailKey: 'customer_group',
    columns: [
      { key: 'name', label: 'Group' },
      { key: 'created_at', label: 'Created', format: formatDate }
    ]
  },
  {
    id: 'inventory-items',
    label: 'Inventory Items',
    path: '/inventory',
    endpoint: '/admin/inventory-items',
    listKey: 'inventory_items',
    detailKey: 'inventory_item',
    columns: [
      { key: 'sku', label: 'SKU' },
      { key: 'title', label: 'Title' },
      { key: 'stocked_quantity', label: 'Stocked', format: formatInventoryTotal('stocked') },
      { key: 'reserved_quantity', label: 'Reserved', format: formatInventoryTotal('reserved') },
      { key: 'available_quantity', label: 'Available', format: formatInventoryTotal('available') },
      { key: 'location_levels', label: 'Locations', format: formatInventoryTotal('locations') },
      { key: 'updated_at', label: 'Updated', format: formatDate }
    ]
  },
  {
    id: 'stock-locations',
    label: 'Stock Locations',
    path: '/stock-locations',
    endpoint: '/admin/stock-locations',
    listKey: 'stock_locations',
    detailKey: 'stock_location',
    columns: [
      { key: 'name', label: 'Location' },
      { key: 'address', label: 'Address', format: (value) => value?.city || '-' },
      { key: 'sales_channels', label: 'Channels', format: formatCount },
      { key: 'fulfillment_sets', label: 'Fulfillment Sets', format: formatCount },
      { key: 'created_at', label: 'Created', format: formatDate }
    ]
  },
  {
    id: 'promotions',
    label: 'Promotions',
    path: '/promotions',
    endpoint: '/admin/promotions',
    listKey: 'promotions',
    detailKey: 'promotion',
    columns: [
      { key: 'code', label: 'Code' },
      { key: 'description', label: 'Description' },
      { key: 'status', label: 'Status', badge: true },
      { key: 'updated_at', label: 'Updated', format: formatDate }
    ]
  },
  {
    id: 'campaigns',
    label: 'Campaigns',
    path: '/campaigns',
    endpoint: '/admin/campaigns',
    listKey: 'campaigns',
    detailKey: 'campaign',
    columns: [
      { key: 'name', label: 'Campaign' },
      { key: 'description', label: 'Description' },
      { key: 'starts_at', label: 'Start', format: formatDate },
      { key: 'ends_at', label: 'End', format: formatDate }
    ]
  },
  {
    id: 'regions',
    label: 'Regions',
    path: '/regions',
    endpoint: '/admin/regions',
    listKey: 'regions',
    detailKey: 'region',
    listParams: {
      fields: '+countries'
    },
    columns: [
      { key: 'name', label: 'Region' },
      { key: 'currency_code', label: 'Currency', format: (value) => value?.toUpperCase() || '-' },
      {
        key: 'countries',
        label: 'Countries',
        format: (value, row) => formatCountryCodes(row?.countries || value)
      },
      { key: 'created_at', label: 'Created', format: formatDate }
    ]
  },
  {
    id: 'shipping-profiles',
    label: 'Shipping Profiles',
    path: '/shipping-profiles',
    endpoint: '/admin/shipping-profiles',
    listKey: 'shipping_profiles',
    detailKey: 'shipping_profile',
    columns: [
      { key: 'name', label: 'Profile' },
      { key: 'type', label: 'Type' },
      { key: 'created_at', label: 'Created', format: formatDate }
    ]
  },
  {
    id: 'shipping-options',
    label: 'Shipping Options',
    path: '/shipping-options',
    endpoint: '/admin/shipping-options',
    listKey: 'shipping_options',
    detailKey: 'shipping_option',
    listParams: {
      fields: '+shipping_profile,+service_zone,+provider'
    },
    columns: [
      { key: 'name', label: 'Option' },
      { key: 'shipping_profile', label: 'Profile', format: formatProfileLabel },
      { key: 'provider', label: 'Provider', format: formatProviderLabel },
      { key: 'service_zone', label: 'Service zone', format: formatServiceZoneLabel },
      { key: 'price_type', label: 'Pricing' },
      { key: 'created_at', label: 'Created', format: formatDate }
    ]
  },
  {
    id: 'tax-regions',
    label: 'Tax Regions',
    path: '/tax-regions',
    endpoint: '/admin/tax-regions',
    listKey: 'tax_regions',
    detailKey: 'tax_region',
    listParams: {
      fields: '+parent'
    },
    columns: [
      { key: 'country_code', label: 'Country', format: (value) => value?.toUpperCase() || '-' },
      { key: 'province_code', label: 'Province', format: (value) => value?.toUpperCase() || '-' },
      {
        key: 'parent',
        label: 'Parent',
        format: (value, row) => formatTaxRegionLabel(row?.parent || row?.parent_id)
      },
      { key: 'created_at', label: 'Created', format: formatDate }
    ]
  },
  {
    id: 'tax-rates',
    label: 'Tax Rates',
    path: '/tax-rates',
    endpoint: '/admin/tax-rates',
    listKey: 'tax_rates',
    detailKey: 'tax_rate',
    listParams: {
      fields: '+tax_region'
    },
    columns: [
      { key: 'name', label: 'Tax Rate' },
      { key: 'rate', label: 'Rate', format: (value) => (typeof value === 'number' ? `${value}%` : '-') },
      {
        key: 'tax_region',
        label: 'Tax region',
        format: (value, row) => formatTaxRegionLabel(row?.tax_region || row?.tax_region_id)
      },
      { key: 'is_default', label: 'Default', format: (value) => (value ? 'Yes' : 'No') },
      { key: 'created_at', label: 'Created', format: formatDate }
    ]
  },
  {
    id: 'users',
    label: 'Team Members',
    path: '/users',
    endpoint: '/admin/users',
    listKey: 'users',
    detailKey: 'user',
    columns: [
      { key: 'email', label: 'Email' },
      { key: 'first_name', label: 'First name' },
      { key: 'last_name', label: 'Last name' },
      { key: 'created_at', label: 'Created', format: formatDate }
    ]
  },
  {
    id: 'invites',
    label: 'Invites',
    path: '/invites',
    endpoint: '/admin/invites',
    listKey: 'invites',
    detailKey: 'invite',
    columns: [
      { key: 'email', label: 'Email' },
      { key: 'accepted', label: 'Accepted', format: (value) => (value ? 'Yes' : 'No') },
      { key: 'expires_at', label: 'Expires', format: formatDateTime },
      { key: 'created_at', label: 'Created', format: formatDate }
    ]
  },
  {
    id: 'api-keys',
    label: 'API Keys',
    path: '/api-keys',
    endpoint: '/admin/api-keys',
    listKey: 'api_keys',
    detailKey: 'api_key',
    columns: [
      { key: 'title', label: 'Key' },
      { key: 'type', label: 'Type', format: formatStatus },
      { key: 'created_at', label: 'Created', format: formatDate }
    ]
  },
  {
    id: 'notifications',
    label: 'Notifications',
    path: '/notifications',
    endpoint: '/admin/notifications',
    listKey: 'notifications',
    detailKey: 'notification',
    listParams: {
      order: '-created_at',
      channel: 'feed',
      fields: '+status,+data'
    },
    columns: [
      {
        key: 'title',
        label: 'Title',
        format: (_, row) => row?.data?.title || row?.template || 'Notification'
      },
      {
        key: 'description',
        label: 'Message',
        format: (_, row) => row?.data?.description || row?.data?.message || '-'
      },
      { key: 'channel', label: 'Channel' },
      { key: 'status', label: 'Status', badge: true },
      { key: 'created_at', label: 'Created', format: formatDateTime }
    ]
  },
  {
    id: 'stores',
    label: 'Store Settings',
    path: '/stores',
    endpoint: '/admin/stores',
    listKey: 'stores',
    detailKey: 'store',
    columns: [
      { key: 'name', label: 'Store' },
      { key: 'default_currency_code', label: 'Currency', format: (value) => value?.toUpperCase() || '-' },
      { key: 'created_at', label: 'Created', format: formatDate }
    ]
  },
  {
    id: 'sales-channels',
    label: 'Sales Channels',
    path: '/sales-channels',
    endpoint: '/admin/sales-channels',
    listKey: 'sales_channels',
    detailKey: 'sales_channel',
    columns: [
      { key: 'name', label: 'Channel' },
      { key: 'is_disabled', label: 'Status', format: (value) => (value ? 'Disabled' : 'Active') },
      { key: 'description', label: 'Description' },
      { key: 'created_at', label: 'Created', format: formatDate }
    ]
  },
  {
    id: 'uploads',
    label: 'Uploads',
    path: '/uploads',
    endpoint: '/admin/files',
    listKey: 'files',
    detailKey: 'upload',
    columns: [
      { key: 'filename', label: 'File' },
      { key: 'mime_type', label: 'Type' },
      { key: 'created_at', label: 'Created', format: formatDate }
    ]
  }
];

export const resourceMap = resources.reduce((acc, resource) => {
  acc[resource.id] = resource;
  return acc;
}, {});

export const resourceGroups = [
  {
    label: 'Commerce',
    items: ['orders', 'draft-orders', 'returns', 'exchanges', 'gift-cards']
  },
  {
    label: 'Catalog',
    items: [
      'products',
      'product-variants',
      'collections',
      'product-categories',
      'product-types',
      'product-tags',
      'price-lists'
    ]
  },
  {
    label: 'Customers',
    items: ['customers', 'customer-groups']
  },
  {
    label: 'Inventory',
    items: ['inventory-items', 'stock-locations']
  },
  {
    label: 'Marketing',
    items: ['promotions', 'campaigns']
  },
  {
    label: 'Operations',
    items: [
      'regions',
      'shipping-profiles',
      'shipping-options',
      'tax-regions',
      'tax-rates',
      'return-reasons',
      'refund-reasons'
    ]
  },
  {
    label: 'Settings',
    items: ['stores', 'sales-channels', 'users', 'invites', 'api-keys', 'notifications', 'uploads']
  }
];
