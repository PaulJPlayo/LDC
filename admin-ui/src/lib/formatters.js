export const formatMoney = (amount, currency = 'USD') => {
  const normalized = Number(amount || 0) / 100;
  const code = String(currency || 'USD').toUpperCase();
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: code
  }).format(Number.isFinite(normalized) ? normalized : 0);
};

export const formatDate = (value) => {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
};

export const formatDateTime = (value) => {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
};

export const formatStatus = (value) => {
  if (!value) return '-';
  return String(value).replace(/_/g, ' ');
};
