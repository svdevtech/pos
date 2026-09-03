'use client';

import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { GlassCard } from '@/components/glass';

// Placeholder: the member-facing LIFF screens are implemented separately.
export default function LiffPage() {
  const t = useTranslations('liff');
  const mock = process.env.NEXT_PUBLIC_LINE_MOCK === 'true';
  return (
    <GlassCard>
      <Stack spacing={1.5}>
        <Typography variant="h4" component="h1" fontWeight={700}>
          {t('title')}
        </Typography>
        <Typography color="text.secondary">{t('placeholder')}</Typography>
        {mock && <Chip size="small" color="warning" label={t('mockMode')} sx={{ alignSelf: 'flex-start' }} />}
      </Stack>
    </GlassCard>
  );
}
