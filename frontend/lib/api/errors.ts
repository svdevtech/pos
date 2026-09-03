'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { isApiError } from './client';

/**
 * Returns a function that turns any thrown value into a user-facing string:
 * localized backend message when present, otherwise a fallback keyed by code
 * from the `errors` namespace.
 */
export function useApiErrorMessage(): (err: unknown) => string {
  const t = useTranslations('errors');
  return useCallback(
    (err: unknown) => {
      if (isApiError(err)) {
        if (err.message) return err.message;
        return t.has(err.code) ? t(err.code) : t('UNKNOWN');
      }
      if (err instanceof Error && err.message) return err.message;
      return t('UNKNOWN');
    },
    [t],
  );
}

/** Field-level errors from an ApiError (`fields: {username: "required"}`), empty otherwise. */
export function fieldErrors(err: unknown): Record<string, string> {
  return isApiError(err) ? err.fields : {};
}
