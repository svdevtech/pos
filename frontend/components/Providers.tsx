'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { TIME_ZONE, type Locale } from '@/i18n/config';
import { api } from '@/lib/api/client';
import { getQueryClient } from '@/lib/api/queryClient';
import {
  clearSession,
  currentStore,
  hasAnyRole,
  loadSession,
  saveSession,
  sessionFromAuth,
  setSelectedStore,
  subscribeSession,
  type AuthResponse,
  type Role,
  type Session,
  type SessionStore,
} from '@/lib/auth/session';
import ThemeRegistry from './ThemeRegistry';
import { ToastProvider } from './Toast';

// ---------------------------------------------------------------------------
// Session context
// ---------------------------------------------------------------------------

export interface SessionContextValue {
  /** Current session, `null` when logged out. */
  session: Session | null;
  /** False until localStorage has been read on the client. */
  ready: boolean;
  /** Store the session is acting on (own store or platform-admin selection). */
  store: SessionStore | null;
  login: (auth: AuthResponse) => Session;
  logout: () => Promise<void>;
  hasRole: (...roles: Role[]) => boolean;
  isPlatformAdmin: boolean;
  selectStore: (store: SessionStore | null) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSession(loadSession());
    setReady(true);
    return subscribeSession(setSession);
  }, []);

  const login = useCallback((auth: AuthResponse) => saveSession(sessionFromAuth(auth, loadSession())), []);

  const logout = useCallback(async () => {
    try {
      if (loadSession()) await api.post<void>('/auth/logout', undefined, { responseType: 'void' });
    } catch {
      // best effort; the local session is cleared regardless
    } finally {
      clearSession();
      getQueryClient().clear();
      router.replace('/login');
    }
  }, [router]);

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      ready,
      store: currentStore(session),
      login,
      logout,
      hasRole: (...roles: Role[]) => hasAnyRole(session, roles),
      isPlatformAdmin: session?.user.role === 'platform_admin',
      selectStore: (store) => {
        setSelectedStore(store);
        getQueryClient().clear();
      },
    }),
    [session, ready, login, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <Providers>');
  return ctx;
}

// ---------------------------------------------------------------------------
// Root providers
// ---------------------------------------------------------------------------

interface ProvidersProps {
  children: ReactNode;
  locale: Locale;
  messages: AbstractIntlMessages;
}

export default function Providers({ children, locale, messages }: ProvidersProps) {
  const [queryClient] = useState(() => getQueryClient());
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone={TIME_ZONE}>
      <ThemeRegistry mode="dark">
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <SessionProvider>{children}</SessionProvider>
          </ToastProvider>
        </QueryClientProvider>
      </ThemeRegistry>
    </NextIntlClientProvider>
  );
}
