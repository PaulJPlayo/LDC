const API_BASE = (import.meta.env.VITE_MEDUSA_BACKEND_URL || 'https://api.lovettsldc.com')
  .replace(/\/$/, '');

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

export const logout = async () => {
  await request('/auth/session', { method: 'DELETE' });
};

export const getCurrentUser = async () => {
  try {
    const payload = await request('/admin/users/me');
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

export const getList = async (endpoint, params = {}) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    query.set(key, String(value));
  });
  const suffix = query.toString();
  return request(`${endpoint}${suffix ? `?${suffix}` : ''}`);
};

export const getDetail = async (endpoint, id, params = {}) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    query.set(key, String(value));
  });
  const suffix = query.toString();
  return request(`${endpoint}/${id}${suffix ? `?${suffix}` : ''}`);
};
