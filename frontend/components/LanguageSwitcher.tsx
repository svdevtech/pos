'use client';

import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { LOCALE_COOKIE, isLocale, locales, type Locale } from '@/i18n/config';
import { api } from '@/lib/api/client';
import { loadSession, updateSession } from '@/lib/auth/session';

interface Props {
  size?: 'small' | 'medium';
  sx?: Record<string, unknown>;
}

export function setLocaleCookie(locale: Locale): void {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

export default function LanguageSwitcher({ size = 'small', sx }: Props) {
  const locale = useLocale();
  const t = useTranslations('common');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const handleChange = (_: unknown, next: string | null) => {
    if (!isLocale(next) || next === locale) return;
    setLocaleCookie(next);

    const session = loadSession();
    if (session) {
      updateSession({ user: { ...session.user, locale: next } });
      // Persist preference server-side; failures are non-fatal.
      api.put<void>('/auth/locale', { locale: next }, { responseType: 'void' }).catch(() => undefined);
    }

    startTransition(() => router.refresh());
  };

  return (
    <ToggleButtonGroup
      value={locale}
      exclusive
      size={size}
      onChange={handleChange}
      disabled={pending}
      aria-label={t('language')}
      sx={sx}
    >
      {locales.map((code) => (
        <ToggleButton key={code} value={code} aria-label={code === 'th' ? t('thai') : t('english')} data-testid={`lang-${code}`} sx={{ px: 1.5 }}>
          {code.toUpperCase()}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
