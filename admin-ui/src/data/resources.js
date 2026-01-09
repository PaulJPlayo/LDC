import { formatDate, formatDateTime, formatMoney, formatStatus } from '../lib/formatters.js';

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
    id: 'products',
    label: 'Products',
    path: '/products',
    endpoint: '/admin/products',
    listKey: 'products',
    detailKey: 'product',
    columns: [
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
    columns: [
      { key: 'title', label: 'Variant' },
      { key: 'sku', label: 'SKU' },
      { key: 'inventory_quantity', label: 'Inventory' },
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
      { key: 'inventory_quantity', label: 'In Stock' },
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
    columns: [
      { key: 'name', label: 'Region' },
      { key: 'currency_code', label: 'Currency', format: (value) => value?.toUpperCase() || '-' },
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
    columns: [
      { key: 'name', label: 'Option' },
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
    columns: [
      { key: 'country_code', label: 'Country', format: (value) => value?.toUpperCase() || '-' },
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
    columns: [
      { key: 'name', label: 'Tax Rate' },
      { key: 'rate', label: 'Rate', format: (value) => (typeof value === 'number' ? `${value}%` : '-') },
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
      { key: 'description', label: 'Description' },
      { key: 'created_at', label: 'Created', format: formatDate }
    ]
  },
  {
    id: 'uploads',
    label: 'Uploads',
    path: '/uploads',
    endpoint: '/admin/uploads',
    listKey: 'uploads',
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
    items: ['orders', 'draft-orders', 'returns', 'exchanges']
  },
  {
    label: 'Catalog',
    items: ['products', 'product-variants', 'collections', 'product-categories', 'price-lists']
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
    items: ['regions', 'shipping-profiles', 'shipping-options', 'tax-regions', 'tax-rates']
  },
  {
    label: 'Settings',
    items: ['stores', 'sales-channels', 'users', 'api-keys', 'uploads']
  }
];
