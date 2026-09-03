'use client';

import AssessmentIcon from '@mui/icons-material/Assessment';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import PageHeader from '@/components/PageHeader';
import QueryError from '@/components/QueryError';
import StatTile from '@/components/StatTile';
import { GlassButton, GlassInput, GlassTable, type GlassColumn } from '@/components/glass';
import { resolveLocale } from '@/i18n/config';
import { useAging, type AgingBucket } from '@/lib/api/hooks/ar';
import { today } from '@/lib/dates';
import { formatDate, formatMoney } from '@/lib/format';

export default function ARAgingPage() {
  const t = useTranslations('ar');
  const locale = resolveLocale(useLocale());
  const [asOf, setAsOf] = useState(today());
  const aging = useAging(asOf);

  const columns: GlassColumn<AgingBucket>[] = [
    { key: 'bucket', label: t('bucket'), render: (b) => (t.has(`buckets.${b.bucket}`) ? t(`buckets.${b.bucket}`) : b.bucket) },
    { key: 'bills', label: t('bills'), width: 120, align: 'right' },
    { key: 'balance', label: t('balance'), width: 160, align: 'right', render: (b) => <strong>{formatMoney(b.balance, locale)}</strong> },
  ];

  return (
    <Stack spacing={3} sx={{ maxWidth: 900 }}>
      <PageHeader
        title={t('aging')}
        subtitle={aging.data ? `${t('asOf')} ${formatDate(aging.data.as_of, locale)}` : undefined}
        backHref="/ar"
        actions={
          <GlassButton variant="outlined" startIcon={<AssessmentIcon />} component={Link} href="/reports?tab=ar-aging">
            {t('agingByMember')}
          </GlassButton>
        }
      />
      <GlassInput type="date" size="small" label={t('asOf')} value={asOf} onChange={(e) => setAsOf(e.target.value)} InputLabelProps={{ shrink: true }} sx={{ width: 200 }} fullWidth={false} />
      <QueryError error={aging.error} onRetry={() => aging.refetch()} />
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6}>
          <StatTile label={t('totalOutstanding')} value={formatMoney(aging.data?.total, locale)} loading={aging.isPending} color="warning.main" />
        </Grid>
        <Grid item xs={12} sm={6}>
          <StatTile
            label={t('openBills')}
            value={(aging.data?.buckets ?? []).reduce((s, b) => s + Number(b.bills || 0), 0)}
            loading={aging.isPending}
          />
        </Grid>
      </Grid>
      <GlassTable columns={columns} rows={aging.data?.buckets ?? []} rowKey={(b) => b.bucket} loading={aging.isPending} emptyText={t('noAccounts')} />
    </Stack>
  );
}
