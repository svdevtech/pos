import type { Locale } from '@/i18n/config';

export const SESSION_KEY = 'pos.session';

export const ROLES = ['platform_admin', 'store_owner', 'manager', 'cashier', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export interface SessionUser {
  id: string;
  store_id: string | null;
  username: string;
  display_name: string;
  role: Role;
  locale: Locale;
  must_reset_password: boolean;
}

export interface SessionStore {
  id: string;
  code: string;
  name: string;
  name_en: string;
  default_locale: Locale;
  address?: string | null;
  phone?: string | null;
  tax_id?: string | null;
  receipt_header?: string | null;
  receipt_footer?: string | null;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}

/** Shape returned by POST /auth/login and POST /auth/refresh. */
export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  user: SessionUser;
  store: SessionStore | null;
}

export interface Session extends AuthResponse {
  /**
   * Store chosen by a platform admin (sent as X-Store-Id). For store users this
   * mirrors `store` and is never changed.
   */
  selected_store: SessionStore | null;
}

type Listener = (session: Session | null) => void;

const listeners = new Set<Listener>();
let cached: Session | null | undefined;

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function notify(session: Session | null) {
  listeners.forEach((listener) => listener(session));
}

/** Reads the persisted session (memoised after first read). */
export function loadSession(): Session | null {
  if (cached !== undefined) return cached;
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    cached = raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    cached = null;
  }
  return cached;
}

export function saveSession(session: Session): Session {
  cached = session;
  if (isBrowser()) {
    try {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      // storage may be unavailable (private mode); keep in-memory copy
    }
  }
  notify(session);
  return session;
}

export function clearSession(): void {
  cached = null;
  if (isBrowser()) {
    try {
      window.localStorage.removeItem(SESSION_KEY);
    } catch {
      // ignore
    }
  }
  notify(null);
}

/** Builds a session from an auth response, keeping the selected store when appropriate. */
export function sessionFromAuth(auth: AuthResponse, previous?: Session | null): Session {
  const selected =
    auth.user.role === 'platform_admin'
      ? (previous?.selected_store ?? null)
      : (auth.store ?? previous?.store ?? null);
  return { ...auth, selected_store: selected };
}

export function updateSession(patch: Partial<Session>): Session | null {
  const current = loadSession();
  if (!current) return null;
  return saveSession({ ...current, ...patch });
}

export function setSelectedStore(store: SessionStore | null): Session | null {
  return updateSession({ selected_store: store });
}

export function subscribeSession(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Keeps tabs in sync: when another tab logs in/out, refresh the cache. */
if (isBrowser()) {
  window.addEventListener('storage', (event) => {
    if (event.key !== SESSION_KEY && event.key !== null) return;
    cached = undefined;
    notify(loadSession());
  });
}

export function getAccessToken(): string | null {
  return loadSession()?.access_token ?? null;
}

export function getRefreshToken(): string | null {
  return loadSession()?.refresh_token ?? null;
}

/** Store id to send as X-Store-Id (only meaningful for platform admins). */
export function getStoreIdHeader(): string | null {
  const session = loadSession();
  if (!session) return null;
  if (session.user.role === 'platform_admin') return session.selected_store?.id ?? null;
  return null;
}

/** The store the session is currently acting on (own store, or selected by platform admin). */
export function currentStore(session: Session | null): SessionStore | null {
  if (!session) return null;
  return session.user.role === 'platform_admin' ? session.selected_store : (session.store ?? session.selected_store);
}

export function hasAnyRole(session: Session | null, roles: readonly Role[]): boolean {
  if (!session) return false;
  if (roles.length === 0) return true;
  return roles.includes(session.user.role);
}

/** Roles allowed to mutate business data (viewer/cashier are read-only outside POS). */
export const MUTATING_ROLES: readonly Role[] = ['platform_admin', 'store_owner', 'manager'];
export const ADMIN_ROLES: readonly Role[] = ['platform_admin', 'store_owner'];
