'use client';

import Typography from '@mui/material/Typography';
import { useLocale } from 'next-intl';
import { useEffect, useState } from 'react';
import { resolveLocale } from '@/i18n/config';
import { formatDate, formatTime } from '@/lib/format';

/** Live clock; renders nothing on the server to avoid hydration mismatches. */
export default function Clock({ showDate = true }: { showDate?: boolean }) {
  const locale = resolveLocale(useLocale());
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!now) return <Typography variant="body2" sx={{ minWidth: 72 }} />;

  return (
    <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
      {showDate && (
        <Typography component="span" variant="body2" color="text.secondary" sx={{ mr: 1 }}>
          {formatDate(now, locale)}
        </Typography>
      )}
      {formatTime(now, locale)}
    </Typography>
  );
}
