'use client';

import DownloadIcon from '@mui/icons-material/Download';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import DateRangeFilter, { monthRange, type DateRange } from '@/components/DateRangeFilter';
import { GlassButton, GlassTable } from '@/components/glass';
import { useSession } from '@/components/Providers';
import StatTile from '@/components/StatTile';
import { resolveLocale } from '@/i18n/config';
import { MUTATING_ROLES, getAccessToken } from '@/lib/auth/session';
import { fnbApi, type HoursReport, type IngredientReport, type MenuLine, type MenuReport } from '@/lib/fnb/api';
import { formatMoney } from '@/lib/format';
import { dec } from '@/lib/pos/types';

const CLASS_COLOR: Record<string, 'success' | 'warning' | 'info' | 'default'> = { star: 'success', plowhorse: 'warning', puzzle: 'info', dog: 'default' };
const TABS = ['menu', 'ingredients', 'hours'] as const;

/** What sold and what it earned (menu engineering), what the kitchen used and wasted, and when the day is busiest. */
export default function FnbReportsPage() {
  const t = useTranslations('fnb.rep');
  const locale = resolveLocale(useLocale());
  const { hasRole } = useSession();
  const [tab, setTab] = useState<(typeof TABS)[number]>('menu');
  const [range, setRange] = useState<DateRange>(monthRange());
  const menu = useQuery({ queryKey: ['fnb', 'rep', 'menu', range], queryFn: () => fnbApi.reportMenu(range.from, range.to), enabled: tab === 'menu' });
  const ing = useQuery({ queryKey: ['fnb', 'rep', 'ingredients', range], queryFn: () => fnbApi.reportIngredients(range.from, range.to), enabled: tab === 'ingredients' });
  const hours = useQuery({ queryKey: ['fnb', 'rep', 'hours', range], queryFn: () => fnbApi.reportHours(range.from, range.to), enabled: tab === 'hours' });

  if (!hasRole(...MUTATING_ROLES)) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="text.secondary">{t('noAccess')}</Typography>
      </Box>
    );
  }
  const csv = async () => {
    const url = `/api/v1/fnb/reports/${tab}?from=${range.from}&to=${range.to}&format=csv`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` } });
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fnb-${tab}-${range.from}-${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const money = (v: string | number) => formatMoney(dec(v), locale);

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 1.5 }}>
      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" allowScrollButtonsMobile sx={{ flex: 1 }} data-testid="rep-tabs">
          {TABS.map((k) => (
            <Tab key={k} value={k} label={t(`tab_${k}`)} data-testid={`rep-tab-${k}`} />
          ))}
        </Tabs>
        <DateRangeFilter value={range} onChange={setRange} />
        <GlassButton size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={() => void csv()}>
          CSV
        </GlassButton>
      </Stack>

      {tab === 'menu' && <MenuPanel data={menu.data} loading={menu.isPending} money={money} />}
      {tab === 'ingredients' && <IngredientPanel data={ing.data} loading={ing.isPending} money={money} />}
      {tab === 'hours' && <HoursPanel data={hours.data} loading={hours.isPending} money={money} />}
    </Box>
  );
}

function MenuPanel({ data, loading, money }: { data?: MenuReport; loading: boolean; money: (v: string | number) => string }) {
  const t = useTranslations('fnb.rep');
  return (
    <Stack spacing={2}>
      <Grid container spacing={1.5}>
        <Grid item xs={6} md={3}>
          <StatTile label={t('revenue')} value={money(data?.revenue ?? 0)} loading={loading} />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatTile label={t('cost')} value={money(data?.cost ?? 0)} loading={loading} />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatTile label={t('margin')} value={money(data?.margin ?? 0)} hint={data && dec(data.revenue) > 0 ? `${((dec(data.margin) / dec(data.revenue)) * 100).toFixed(1)}%` : undefined} loading={loading} color="#3ba55d" />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatTile label={t('qty')} value={String(dec(data?.qty ?? 0))} loading={loading} />
        </Grid>
      </Grid>
      <Typography variant="caption" color="text.secondary">
        {t('classHint')}
      </Typography>
      <GlassTable
        columns={[
          { key: 'name', label: t('item'), render: (l: MenuLine) => l.name },
          { key: 'cat', label: t('category'), render: (l: MenuLine) => l.category },
          { key: 'qty', label: t('qty'), align: 'right', render: (l: MenuLine) => String(dec(l.qty)) },
          { key: 'share', label: t('share'), align: 'right', render: (l: MenuLine) => `${dec(l.share_pct)}%` },
          { key: 'rev', label: t('revenue'), align: 'right', render: (l: MenuLine) => money(l.revenue) },
          { key: 'cost', label: t('cost'), align: 'right', render: (l: MenuLine) => money(l.cost) },
          { key: 'margin', label: t('margin'), align: 'right', render: (l: MenuLine) => `${money(l.margin)} (${dec(l.margin_pct)}%)` },
          { key: 'unit', label: t('unitMargin'), align: 'right', render: (l: MenuLine) => money(l.unit_margin) },
          { key: 'class', label: t('class'), render: (l: MenuLine) => <Chip size="small" label={t(`class_${l.class}`)} color={CLASS_COLOR[l.class] ?? 'default'} /> },
        ]}
        rows={data?.lines ?? []}
        rowKey={(l) => l.menu_item_id ?? l.name}
        loading={loading}
        emptyText={t('empty')}
        size="small"
      />
    </Stack>
  );
}

function IngredientPanel({ data, loading, money }: { data?: IngredientReport; loading: boolean; money: (v: string | number) => string }) {
  const t = useTranslations('fnb.rep');
  return (
    <Stack spacing={2}>
      <Grid container spacing={1.5}>
        <Grid item xs={6} md={3}>
          <StatTile label={t('usedCost')} value={money(data?.used_cost ?? 0)} loading={loading} />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatTile label={t('wasteCost')} value={money(data?.waste_cost ?? 0)} loading={loading} color="#E53935" />
        </Grid>
      </Grid>
      <GlassTable
        columns={[
          { key: 'name', label: t('ingredient'), render: (l: IngredientReport['lines'][number]) => l.name },
          { key: 'used', label: t('used'), align: 'right', render: (l: IngredientReport['lines'][number]) => `${dec(l.used)} ${l.unit}` },
          { key: 'usedCost', label: t('usedCost'), align: 'right', render: (l: IngredientReport['lines'][number]) => money(l.used_cost) },
          { key: 'waste', label: t('waste'), align: 'right', render: (l: IngredientReport['lines'][number]) => (dec(l.waste) ? `${dec(l.waste)} ${l.unit}` : '—') },
          { key: 'wasteCost', label: t('wasteCost'), align: 'right', render: (l: IngredientReport['lines'][number]) => (dec(l.waste_cost) ? money(l.waste_cost) : '—') },
          { key: 'onHand', label: t('onHand'), align: 'right', render: (l: IngredientReport['lines'][number]) => `${dec(l.on_hand)} ${l.unit}` },
        ]}
        rows={data?.lines ?? []}
        rowKey={(l) => l.product_id}
        loading={loading}
        emptyText={t('empty')}
        size="small"
      />
    </Stack>
  );
}

function HoursPanel({ data, loading, money }: { data?: HoursReport; loading: boolean; money: (v: string | number) => string }) {
  const t = useTranslations('fnb.rep');
  const max = Math.max(1, ...(data?.lines ?? []).map((l) => dec(l.revenue)));
  return (
    <Stack spacing={2}>
      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5, height: 180, px: 1 }} data-testid="rep-hours-chart">
        {Array.from({ length: 24 }, (_, h) => {
          const l = data?.lines.find((x) => x.hour === h);
          const v = l ? dec(l.revenue) : 0;
          return (
            <Box key={h} sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }} title={`${h}:00 · ${money(v)}`}>
              <Box sx={{ width: '100%', height: `${(v / max) * 100}%`, minHeight: v ? 3 : 0, bgcolor: v ? 'primary.main' : 'divider', borderRadius: 1 }} />
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                {h}
              </Typography>
            </Box>
          );
        })}
      </Box>
      <GlassTable
        columns={[
          { key: 'hour', label: t('hour'), render: (l: HoursReport['lines'][number]) => `${String(l.hour).padStart(2, '0')}:00` },
          { key: 'orders', label: t('orders'), align: 'right', render: (l: HoursReport['lines'][number]) => l.orders },
          { key: 'items', label: t('qty'), align: 'right', render: (l: HoursReport['lines'][number]) => String(dec(l.items)) },
          { key: 'rev', label: t('revenue'), align: 'right', render: (l: HoursReport['lines'][number]) => money(l.revenue) },
          { key: 'avg', label: t('perDay'), align: 'right', render: (l: HoursReport['lines'][number]) => money(dec(l.revenue) / Math.max(1, data?.days ?? 1)) },
        ]}
        rows={data?.lines ?? []}
        rowKey={(l) => String(l.hour)}
        loading={loading}
        emptyText={t('empty')}
        size="small"
      />
    </Stack>
  );
}
