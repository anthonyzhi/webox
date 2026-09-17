/* api.js — single fetch wrapper for the WeBox REST API.
 * Every failure surfaces as an ApiError {code,message,status,fieldErrors,details}.
 */

import { getToken, clearAuth } from './store.js';
import { toast } from './utils.js';

export const API_BASE = '/api';
const AUTH_FREE = ['/auth/login', '/auth/register'];

export class ApiError extends Error {
  constructor({ code = 'ERROR', message = 'Something went wrong.', status = 0, fieldErrors = null, details = null }) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.fieldErrors = fieldErrors || null;
    this.details = details || null;
  }

  get isValidation() { return this.code === 'VALIDATION_ERROR' || this.status === 400; }
  get isAuth() { return this.status === 401; }
  get isForbidden() { return this.status === 403; }
}

export function buildQuery(params) {
  if (!params) return '';
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    if (Array.isArray(value)) {
      if (!value.length) return;
      search.append(key, value.join(','));
      return;
    }
    search.append(key, String(value));
  });
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

let redirecting = false;

function handleUnauthenticated() {
  clearAuth();
  if (redirecting) return;
  const current = window.location.hash || '';
  if (current.startsWith('#/login') || current.startsWith('#/register')) return;
  redirecting = true;
  toast('Your session expired. Please sign in again.', { type: 'warn', title: 'Signed out' });
  const next = current ? `?next=${encodeURIComponent(current)}` : '';
  window.location.hash = `#/login${next}`;
  setTimeout(() => { redirecting = false; }, 800);
}

async function toApiError(response) {
  let payload = null;
  const contentType = response.headers.get('content-type') || '';
  try {
    if (contentType.includes('application/json')) payload = await response.json();
    else {
      const text = await response.text();
      payload = text ? { message: text.slice(0, 300) } : null;
    }
  } catch (err) {
    payload = null;
  }
  const fallback = {
    400: 'The request could not be processed. Please check the highlighted fields.',
    401: 'You need to sign in to continue.',
    403: 'You do not have access to this area.',
    404: 'The requested resource was not found.',
    409: 'This action conflicts with the current state. Please retry.',
    500: 'Something went wrong on the server. Please try again.',
  }[response.status] || 'Something went wrong. Please try again.';

  return new ApiError({
    code: payload?.code || (response.status === 403 ? 'FORBIDDEN' : `HTTP_${response.status}`),
    message: payload?.message || fallback,
    status: response.status,
    fieldErrors: payload?.fieldErrors || null,
    details: payload?.details || null,
  });
}

/**
 * Core request. All methods return parsed JSON (or null for 204).
 */
export async function request(method, path, options = {}) {
  const {
    body,
    query,
    signal,
    formData,
    headers: extraHeaders,
    allow401 = false,
    auth = true,
  } = options;

  const headers = { Accept: 'application/json', ...(extraHeaders || {}) };
  const token = getToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let payload;
  if (formData) {
    payload = formData;
  } else if (body !== undefined && body !== null) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}${buildQuery(query)}`, {
      method,
      headers,
      body: payload,
      signal,
      credentials: 'same-origin',
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError({
      code: 'NETWORK_ERROR',
      message: 'Cannot reach the server. Please check your connection and try again.',
      status: 0,
    });
  }

  if (response.status === 401 && !allow401 && !AUTH_FREE.some((p) => path.startsWith(p))) {
    handleUnauthenticated();
    throw await toApiError(response);
  }

  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return null;

  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}

export const api = {
  get: (path, options) => request('GET', path, options),
  post: (path, body, options) => request('POST', path, { ...options, body }),
  put: (path, body, options) => request('PUT', path, { ...options, body }),
  patch: (path, body, options) => request('PATCH', path, { ...options, body }),
  del: (path, options) => request('DELETE', path, options),

  /** Multipart upload (jpeg/png/webp ≤ 5 MB) → { url }. */
  upload(path, file, options) {
    const form = new FormData();
    form.append('file', file, file.name);
    return request('POST', path, { ...options, formData: form });
  },

  /** EventSource URL with `?token=` because EventSource cannot send headers. */
  sseUrl(path, params = {}) {
    const token = getToken();
    return `${API_BASE}${path}${buildQuery({ ...params, ...(token ? { token } : {}) })}`;
  },
};

/* ------------------------------------------------------------ domain calls */

let enumsCache = null;

export async function getEnums() {
  if (enumsCache) return enumsCache;
  const data = await api.get('/meta/enums');
  enumsCache = {
    categories: data?.categories || [],
    spiceLevels: data?.spiceLevels || [],
    allergens: data?.allergens || [],
    tastes: data?.tastes || [],
    mealPeriods: data?.mealPeriods || [],
    orderStatuses: data?.orderStatuses || [],
    currencySymbol: data?.currencySymbol || '¥',
  };
  return enumsCache;
}

export async function loadSession() {
  const data = await api.get('/auth/me');
  return data || {};
}

export async function logout() {
  try {
    await api.post('/auth/logout', null, { allow401: true });
  } catch (err) {
    /* logging out locally is what matters */
  }
}

export function createIdempotencyKey() {
  let raw;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    raw = crypto.randomUUID().replace(/-/g, '');
  } else {
    raw = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }
  const safe = raw.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  return `ord_${safe}`;
}

/** Convert a paged response into a stable shape. */
export function normalizePage(data) {
  const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data?.content) ? data.content : []);
  const size = Number(data?.size) || (items.length || 12);
  const totalElements = Number.isFinite(Number(data?.totalElements)) ? Number(data.totalElements) : items.length;
  const totalPages = Number.isFinite(Number(data?.totalPages))
    ? Number(data.totalPages)
    : Math.max(1, Math.ceil(totalElements / size));
  const page = Number(data?.page) || 0;
  return { items, page, size, totalElements, totalPages, raw: data };
}

export function isAbort(err) { return err?.name === 'AbortError'; }
