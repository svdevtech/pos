'use client';

import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import DateRangeFilter, { todayRange, type DateRange } from '@/components/DateRangeFilter';
import PageHeader from '@/components/PageHeader';
import StatTile from '@/components/StatTile';
import { GlassButton, GlassTable } from '@/components/glass';
import { resolveLocale } from '@/i18n/config';
import { api } from '@/lib/api/client';
import { formatMoney } from '@/lib/format';
import { dec, type Money } from '@/lib/pos/types';

interface StoreSummary {
  store_id: string;
  code: string;
  name: string;
  kind: 'retail' | 'fnb';
  bills: number;
  net: Money;
  open_orders: number;
}
interface HQ {
  from: string;
  to: string;
  stores: StoreSummary[];
  bills: number;
  net: Money;
}

/** Every store side by side — bills and takings over the period, and what is open right now. */
export default function HQPage() {
  const t = useTranslations('admin');
  const locale = resolveLocale(useLocale());
  const router = useRouter();
  const [range, setRange] = useState<DateRange>(todayRange());
  const hq = useQuery({ queryKey: ['admin', 'hq', range], queryFn: () => api.get<HQ>(`/admin/hq?from=${range.from}&to=${range.to}`), refetchInterval: 60_000 });
  const money = (v: Money) => formatMoney(dec(v), locale);

  return (
    <Stack spacing={2}>
      <PageHeader title={t('hq')} subtitle={t('hqDesc')} actions={<DateRangeFilter value={range} onChange={setRange} />} />
      <Grid container spacing={1.5}>
        <Grid item xs={6} md={3}>
          <StatTile label={t('hqNet')} value={money(hq.data?.net ?? 0)} loading={hq.isPending} color="#3ba55d" />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatTile label={t('hqBills')} value={String(hq.data?.bills ?? 0)} loading={hq.isPending} />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatTile label={t('hqStores')} value={String(hq.data?.stores.length ?? 0)} loading={hq.isPending} />
        </Grid>
      </Grid>
      <GlassTable
        columns={[
          { key: 'code', label: t('storeCode'), render: (s: StoreSummary) => s.code },
          { key: 'name', label: t('storeName'), render: (s: StoreSummary) => s.name },
          { key: 'kind', label: t('kind'), render: (s: StoreSummary) => <Chip size="small" label={t(`kind_${s.kind}`)} color={s.kind === 'fnb' ? 'secondary' : 'default'} /> },
          { key: 'bills', label: t('hqBills'), align: 'right', render: (s: StoreSummary) => s.bills },
          { key: 'net', label: t('hqNet'), align: 'right', render: (s: StoreSummary) => money(s.net) },
          { key: 'open', label: t('openOrders'), align: 'right', render: (s: StoreSummary) => (s.kind === 'fnb' ? s.open_orders : '—') },
          {
            key: 'go',
            label: '',
            align: 'right',
            width: 120,
            render: (s: StoreSummary) => (
              <GlassButton size="small" variant="text" onClick={() => router.push(`/admin/stores?enter=${encodeURIComponent(s.code)}`)}>
                {t('enterStore')}
              </GlassButton>
            ),
          },
        ]}
        rows={hq.data?.stores ?? []}
        rowKey={(s) => s.store_id}
        loading={hq.isPending}
        emptyText="—"
        size="small"
      />
    </Stack>
  );
}
