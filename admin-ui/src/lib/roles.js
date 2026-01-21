export const resolveRole = (record) => {
  if (!record) return '';
  const role =
    record.role ||
    record?.metadata?.role ||
    (Array.isArray(record?.roles) ? record.roles[0] : undefined) ||
    (Array.isArray(record?.metadata?.roles) ? record.metadata.roles[0] : undefined);
  return role ? String(role) : '';
};

export const isAdminRole = (role) => String(role || '').toLowerCase() === 'admin';

export const isAdminUser = (user) => isAdminRole(resolveRole(user));

export const ADMIN_ONLY_RESOURCE_IDS = new Set([
  'users',
  'invites',
  'api-keys',
  'stores',
  'regions',
  'shipping-profiles',
  'shipping-options',
  'tax-regions',
  'tax-rates',
  'return-reasons',
  'refund-reasons',
  'sales-channels'
]);

export const isResourceAdminOnly = (resourceId) =>
  resourceId ? ADMIN_ONLY_RESOURCE_IDS.has(resourceId) : false;
