import { LOCALE_COOKIE, defaultLocale, isLocale, type Locale } from '@/i18n/config';
import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  getStoreIdHeader,
  loadSession,
  saveSession,
  sessionFromAuth,
  type AuthResponse,
} from '@/lib/auth/session';

export const API_BASE = '/api/v1';

export interface ApiErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    params?: Record<string, string>;
    fields?: Record<string, string>;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly params: Record<string, string>;
  readonly fields: Record<string, string>;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    params?: Record<string, string>;
    fields?: Record<string, string>;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.params = init.params ?? {};
    this.fields = init.fields ?? {};
  }

  get hasFields(): boolean {
    return Object.keys(this.fields).length > 0;
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

export type ResponseType = 'json' | 'blob' | 'text' | 'void';

export interface RequestOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Skip the Authorization header (login, health). */
  noAuth?: boolean;
  /** How to parse the body; defaults to JSON (or void on 204). */
  responseType?: ResponseType;
  /** Content-Type for raw (non-JSON) bodies such as file uploads. */
  contentType?: string;
  /** Override the X-Store-Id header (platform admin acting on a store). */
  storeId?: string | null;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type Body = unknown;

function isRawBody(body: Body): body is Blob | ArrayBuffer | FormData | URLSearchParams | string {
  return (
    typeof body === 'string' ||
    (typeof Blob !== 'undefined' && body instanceof Blob) ||
    (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) ||
    (typeof FormData !== 'undefined' && body instanceof FormData) ||
    (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams)
  );
}

export function readLocaleCookie(): Locale {
  if (typeof document === 'undefined') return defaultLocale;
  const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`));
  const value = match ? decodeURIComponent(match[1]) : undefined;
  return isLocale(value) ? value : defaultLocale;
}

function statusToCode(status: number): string {
  switch (status) {
    case 400:
      return 'VALIDATION';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 429:
      return 'RATE_LIMITED';
    default:
      return status >= 500 ? 'INTERNAL' : 'UNKNOWN';
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  let envelope: ApiErrorEnvelope | null = null;
  try {
    const text = await res.text();
    if (text) envelope = JSON.parse(text) as ApiErrorEnvelope;
  } catch {
    envelope = null;
  }
  const err = envelope?.error;
  return new ApiError({
    status: res.status,
    code: err?.code || statusToCode(res.status),
    message: err?.message || '',
    params: err?.params,
    fields: err?.fields,
  });
}

// ---------------------------------------------------------------------------
// Token refresh (single-flight)
// ---------------------------------------------------------------------------

let refreshInFlight: Promise<boolean> | null = null;

async function doRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Locale': readLocaleCookie() },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return false;
    const auth = (await res.json()) as AuthResponse;
    saveSession(sessionFromAuth(auth, loadSession()));
    return true;
  } catch {
    return false;
  }
}

/** Refreshes the access token; concurrent callers share one request. */
export function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

function redirectToLogin(): void {
  if (typeof window === 'undefined') return;
  if (window.location.pathname.startsWith('/login')) return;
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.assign(`/login?expired=1&next=${next}`);
}

// ---------------------------------------------------------------------------
// Core request
// ---------------------------------------------------------------------------

function buildHeaders(body: Body, opts: RequestOptions): Headers {
  const headers = new Headers(opts.headers);
  headers.set('Accept', 'application/json');
  headers.set('X-Locale', readLocaleCookie());

  if (body !== undefined && body !== null) {
    if (isRawBody(body)) {
      if (opts.contentType) headers.set('Content-Type', opts.contentType);
      else if (body instanceof Blob && body.type) headers.set('Content-Type', body.type);
      else if (typeof body === 'string') headers.set('Content-Type', 'text/plain;charset=UTF-8');
      // FormData / URLSearchParams: let fetch set the boundary/type.
    } else {
      headers.set('Content-Type', 'application/json');
    }
  }

  if (!opts.noAuth) {
    const token = getAccessToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const storeId = opts.storeId !== undefined ? opts.storeId : getStoreIdHeader();
    if (storeId) headers.set('X-Store-Id', storeId);
  }
  return headers;
}

async function parseResponse<T>(res: Response, type: ResponseType | undefined): Promise<T> {
  if (type === 'void' || res.status === 204) return undefined as T;
  if (type === 'blob') return (await res.blob()) as T;
  if (type === 'text') return (await res.text()) as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

async function request<T>(method: Method, path: string, body?: Body, opts: RequestOptions = {}): Promise<T> {
  const url = path.startsWith('http') ? path : `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;

  const send = (): Promise<Response> =>
    fetch(url, {
      method,
      headers: buildHeaders(body, opts),
      body: body === undefined || body === null ? undefined : isRawBody(body) ? body : JSON.stringify(body),
      signal: opts.signal,
      cache: 'no-store',
    });

  let res: Response;
  try {
    res = await send();
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError({ status: 0, code: 'NETWORK', message: '' });
  }

  const isAuthRoute = path.startsWith('/auth/login') || path.startsWith('/auth/refresh');
  if (res.status === 401 && !opts.noAuth && !isAuthRoute && getRefreshToken()) {
    const refreshed = await refreshSession();
    if (refreshed) {
      try {
        res = await send();
      } catch {
        throw new ApiError({ status: 0, code: 'NETWORK', message: '' });
      }
    }
    if (res.status === 401) {
      clearSession();
      redirectToLogin();
      throw await toApiError(res);
    }
  }

  if (!res.ok) throw await toApiError(res);
  return parseResponse<T>(res, opts.responseType);
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, undefined, opts),
  post: <T>(path: string, body?: Body, opts?: RequestOptions) => request<T>('POST', path, body, opts),
  put: <T>(path: string, body?: Body, opts?: RequestOptions) => request<T>('PUT', path, body, opts),
  patch: <T>(path: string, body?: Body, opts?: RequestOptions) => request<T>('PATCH', path, body, opts),
  delete: <T>(path: string, body?: Body, opts?: RequestOptions) => request<T>('DELETE', path, body, opts),
  request,
};

/** Paginated list shape used by the backend (`Page[T]`). */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

/** Accepts either a plain array or a `Page[T]` envelope. */
export function unwrapList<T>(data: T[] | Page<T> | null | undefined): T[] {
  if (!data) return [];
  return Array.isArray(data) ? data : (data.items ?? []);
}

/** Builds a query string, dropping empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}
