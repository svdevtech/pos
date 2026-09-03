'use client';

import Stack from '@mui/material/Stack';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/PageHeader';
import MovementsLedger from '@/components/inventory/MovementsLedger';

export default function MovementsPage() {
  const t = useTranslations('inventory');
  return (
    <Stack spacing={3}>
      <PageHeader title={t('movements')} subtitle={t('movementsDesc')} backHref="/inventory" />
      <MovementsLedger />
    </Stack>
  );
}
