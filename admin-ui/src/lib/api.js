const API_BASE = (import.meta.env.VITE_MEDUSA_BACKEND_URL || 'https://api.lovettsldc.com')
  .replace(/\/$/, '');
const PUBLISHABLE_KEY = import.meta.env.VITE_MEDUSA_PUBLISHABLE_KEY || '';
const API_ORIGIN = (() => {
  try {
    return new URL(API_BASE).origin;
  } catch (error) {
    return '';
  }
})();

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const parseResponse = async (response) => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    return text;
  }
};

const LOCAL_UPLOAD_ORIGINS = new Set(['http://localhost:9000', 'http://127.0.0.1:9000']);

const normalizeUploadedUrl = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return raw;

  const withOrigin = (path, search = '', hash = '') => {
    if (!API_ORIGIN) return `${path}${search}${hash}`;
    return `${API_ORIGIN}${path}${search}${hash}`;
  };

  if (raw.startsWith('/static/') || raw.startsWith('static/')) {
    const path = raw.startsWith('/') ? raw : `/${raw}`;
    return withOrigin(path);
  }

  try {
    const parsed = new URL(raw);
    if (LOCAL_UPLOAD_ORIGINS.has(parsed.origin)) {
      return withOrigin(parsed.pathname, parsed.search, parsed.hash);
    }
  } catch (error) {
    return raw;
  }

  return raw;
};

const normalizeUploadPayload = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeUploadPayload(entry));
  }
  if (value && typeof value === 'object') {
    const next = {};
    Object.entries(value).forEach(([key, entryValue]) => {
      if (key === 'url' && typeof entryValue === 'string') {
        next[key] = normalizeUploadedUrl(entryValue);
      } else {
        next[key] = normalizeUploadPayload(entryValue);
      }
    });
    return next;
  }
  return value;
};

export const request = async (path, options = {}) => {
  const url = `${API_BASE}${path}`;
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    credentials: 'include',
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const payload = await parseResponse(response);
  if (!response.ok) {
    const message =
      typeof payload === 'string'
        ? payload
        : payload?.message || `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return payload;
};

export const storeRequest = async (path, options = {}) => {
  const url = `${API_BASE}${path}`;
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(PUBLISHABLE_KEY ? { 'x-publishable-api-key': PUBLISHABLE_KEY } : {}),
      ...(options.headers || {})
    },
    credentials: 'include',
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const payload = await parseResponse(response);
  if (!response.ok) {
    const message =
      typeof payload === 'string'
        ? payload
        : payload?.message || `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return payload;
};

export const uploadFiles = async (files, path = '/admin/uploads') => {
  const url = `${API_BASE}${path}`;
  const form = new FormData();

  if (!files) {
    throw new ApiError('No file selected.', 400);
  }

  if (files instanceof FileList) {
    Array.from(files).forEach((file) => {
      form.append('files', file);
    });
  } else if (Array.isArray(files)) {
    files.forEach((file) => {
      form.append('files', file);
    });
  } else {
    form.append('files', files);
  }

  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    body: form
  });

  const payload = await parseResponse(response);
  if (!response.ok) {
    const message =
      typeof payload === 'string'
        ? payload
        : payload?.message || `Upload failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return normalizeUploadPayload(payload);
};

export const login = async (email, password) => {
  const tokenRes = await fetch(`${API_BASE}/auth/user/emailpass`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const tokenPayload = await parseResponse(tokenRes);
  if (!tokenRes.ok) {
    throw new ApiError(tokenPayload?.message || 'Unable to sign in.', tokenRes.status);
  }
  const token = tokenPayload?.token;
  if (!token) {
    throw new ApiError('Authentication token missing.', 401);
  }

  const sessionRes = await fetch(`${API_BASE}/auth/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    credentials: 'include'
  });
  const sessionPayload = await parseResponse(sessionRes);
  if (!sessionRes.ok) {
    throw new ApiError(sessionPayload?.message || 'Unable to start session.', sessionRes.status);
  }
  return sessionPayload?.user || null;
};

export const registerUser = async (email, password) => {
  const response = await fetch(`${API_BASE}/auth/user/emailpass/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const payload = await parseResponse(response);
  if (!response.ok) {
    const message =
      typeof payload === 'string'
        ? payload
        : payload?.message || `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  const token = payload?.token;
  if (!token) {
    throw new ApiError('Registration token missing.', response.status);
  }
  return token;
};

export const acceptInvite = async ({ token, authToken, email, first_name, last_name }) => {
  const response = await fetch(
    `${API_BASE}/admin/invites/accept?token=${encodeURIComponent(token)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`
      },
      body: JSON.stringify({ email, first_name, last_name })
    }
  );
  const payload = await parseResponse(response);
  if (!response.ok) {
    const message =
      typeof payload === 'string'
        ? payload
        : payload?.message || `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return payload;
};

export const validateInvite = async (token) => {
  const cleaned = String(token || '').trim();
  if (!cleaned) {
    throw new ApiError('Invite token missing.', 400);
  }
  const response = await fetch(
    `${API_BASE}/store/invites/validate?token=${encodeURIComponent(cleaned)}`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(PUBLISHABLE_KEY ? { 'x-publishable-api-key': PUBLISHABLE_KEY } : {})
      }
    }
  );
  const payload = await parseResponse(response);
  return {
    ok: response.ok,
    status: response.status,
    payload
  };
};

export const logout = async () => {
  await request('/auth/session', { method: 'DELETE' });
};

export const getCurrentUser = async () => {
  try {
    const payload = await request('/admin/users/me?fields=+metadata');
    return payload?.user || null;
  } catch (error) {
    if (error instanceof ApiError && [401, 403].includes(error.status)) {
      return null;
    }
    throw error;
  }
};

export const getCount = async (endpoint) => {
  const payload = await request(`${endpoint}?limit=1`);
  return Number(payload?.count || 0);
};

const appendQueryParam = (query, key, value) => {
  if (Array.isArray(value)) {
    value.forEach((entry) => {
      if (entry === undefined || entry === null || entry === '') return;
      query.append(key, String(entry));
    });
    return;
  }
  if (value === undefined || value === null || value === '') return;
  query.set(key, String(value));
};

export const getList = async (endpoint, params = {}) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => appendQueryParam(query, key, value));
  const suffix = query.toString();
  return request(`${endpoint}${suffix ? `?${suffix}` : ''}`);
};

export const getDetail = async (endpoint, id, params = {}) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => appendQueryParam(query, key, value));
  const suffix = query.toString();
  return request(`${endpoint}/${id}${suffix ? `?${suffix}` : ''}`);
};

export const formatApiError = (error, fallback = 'Something went wrong.') => {
  if (!error) return fallback;
  if (error instanceof ApiError) {
    if ([401, 403].includes(error.status)) {
      return 'Your session expired or you do not have access. Please sign in again.';
    }
    return error.message || fallback;
  }
  const message = error?.message || fallback;
  if (message === 'Failed to fetch' || message.includes('NetworkError')) {
    return 'Unable to reach the backend API. Check the server URL and status.';
  }
  return message;
};
