'use client';

import Alert from '@mui/material/Alert';
import { useTranslations } from 'next-intl';
import { GlassButton } from '@/components/glass';
import { useApiErrorMessage } from '@/lib/api/errors';

/** Error banner for a failed query with a retry button. Renders nothing when `error` is falsy. */
export default function QueryError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const tc = useTranslations('common');
  const errorMessage = useApiErrorMessage();
  if (!error) return null;
  return (
    <Alert
      severity="error"
      action={
        onRetry ? (
          <GlassButton size="small" variant="text" onClick={onRetry}>
            {tc('retry')}
          </GlassButton>
        ) : undefined
      }
    >
      {errorMessage(error)}
    </Alert>
  );
}
