'use client';

import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import CancelIcon from '@mui/icons-material/Cancel';
import CreditScoreIcon from '@mui/icons-material/CreditScore';
import PaymentsIcon from '@mui/icons-material/Payments';
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import ReceiptIcon from '@mui/icons-material/Receipt';
import ScheduleIcon from '@mui/icons-material/Schedule';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';
import { useSession } from '@/components/Providers';
import { GlassButton, GlassCard, GlassTable, type GlassColumn } from '@/components/glass';
import { resolveLocale } from '@/i18n/config';
import { isApiError } from '@/lib/api/client';
import { useApiErrorMessage } from '@/lib/api/errors';
import { formatMoney, formatQty, formatTime } from '@/lib/format';
import { posApi, posKeys } from '@/lib/pos/api';
import { dec, money, type DashboardOpenShift, type DashboardResponse } from '@/lib/pos/types';

function Kpi({ icon, label, value, hint, href }: { icon: ReactNode; label: string; value: ReactNode; hint?: ReactNode; href?: string }) {
  const card = (
    <GlassCard sx={{ height: '100%' }} hoverable={Boolean(href)}>
      <Stack direction="row" spacing={2} alignItems="center">
        <Box
          sx={{
            width: 48,
            height: 48,
            borderRadius: 3,
            display: 'grid',
            placeItems: 'center',
            backgroundImage: (th) => th.glass.gradient,
            color: '#fff',
            flexShrink: 0,
          }}
        >
          {icon}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" color="text.secondary" noWrap>
            {label}
          </Typography>
          <Typography variant="h5" fontWeight={700} noWrap sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {value}
          </Typography>
          {hint && (
            <Typography variant="caption" color="text.secondary" noWrap display="block">
              {hint}
            </Typography>
          )}
        </Box>
      </Stack>
    </GlassCard>
  );
  if (!href) return card;
  return (
    <Link href={href} style={{ textDecoration: 'none', color: 'inherit', display: 'block', height: '100%' }}>
      {card}
    </Link>
  );
}

interface HourPoint {
  hour: number;
  bills: number;
  net: number;
}

/** Simple SVG bar chart (no chart library). */
function HourlyChart({ points }: { points: HourPoint[] }) {
  const t = useTranslations('dashboard');
  const locale = resolveLocale(useLocale());
  const hours = useMemo(() => {
    const map = new Map(points.map((p) => [p.hour, p]));
    const out: HourPoint[] = [];
    for (let h = 6; h <= 22; h += 1) out.push(map.get(h) ?? { hour: h, bills: 0, net: 0 });
    // include any data outside the default window
    for (const p of points) if (p.hour < 6 || p.hour > 22) out.push(p);
    return out.sort((a, b) => a.hour - b.hour);
  }, [points]);
  const max = Math.max(1, ...hours.map((h) => h.net));
  const W = 720;
  const H = 200;
  const padL = 8;
  const padB = 24;
  const padT = 12;
  const bw = (W - padL * 2) / hours.length;
  const hasData = hours.some((h) => h.net > 0 || h.bills > 0);

  if (!hasData) {
    return (
      <Typography color="text.secondary" align="center" sx={{ py: 6 }}>
        {t('noHourly')}
      </Typography>
    );
  }

  return (
    <Box sx={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={t('hourlySales')} style={{ minWidth: 480 }}>
        <defs>
          <linearGradient id="dash-bar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4fc3f7" />
            <stop offset="100%" stopColor="#1e88e5" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={padL}
            x2={W - padL}
            y1={padT + (H - padT - padB) * (1 - f)}
            y2={padT + (H - padT - padB) * (1 - f)}
            stroke="currentColor"
            strokeOpacity={0.12}
            strokeDasharray="4 4"
          />
        ))}
        {hours.map((h, i) => {
          const bh = h.net > 0 ? Math.max(2, ((H - padT - padB) * h.net) / max) : 0;
          const x = padL + i * bw + bw * 0.15;
          const y = H - padB - bh;
          return (
            <g key={h.hour}>
              <title>{`${String(h.hour).padStart(2, '0')}:00 · ${formatMoney(h.net, locale)} · ${t('billsCount', { count: h.bills })}`}</title>
              <rect x={x} y={y} width={bw * 0.7} height={bh} rx={3} fill="url(#dash-bar)" opacity={0.9} />
              <text x={x + bw * 0.35} y={H - 6} fontSize={11} textAnchor="middle" fill="currentColor" opacity={0.7}>
                {String(h.hour).padStart(2, '0')}
              </text>
            </g>
          );
        })}
      </svg>
    </Box>
  );
}

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');
  const locale = resolveLocale(useLocale());
  const { session } = useSession();
  const errorMessage = useApiErrorMessage();

  const today = dayjs().format('YYYY-MM-DD');

  const dashboard = useQuery({
    queryKey: posKeys.dashboard,
    queryFn: async (): Promise<{ data: DashboardResponse; fallback: boolean }> => {
      try {
        const data = await posApi.dashboard();
        return { data: data ?? {}, fallback: false };
      } catch (err) {
        // The reports endpoint may not exist yet: build a minimal view from the sales summary.
        if (isApiError(err) && (err.status === 404 || err.status === 501)) {
          const s = await posApi.summary(today, today);
          const cash = s?.by_method?.cash ?? 0;
          const credit = s?.by_method?.credit ?? 0;
          const bills = s?.bills ?? 0;
          return {
            fallback: true,
            data: {
              today: { bills, net: s?.net ?? 0, cash, credit, avg_bill: bills > 0 ? money(dec(s?.net) / bills) : 0, cancelled: s?.cancelled ?? 0 },
            },
          };
        }
        throw err;
      }
    },
    refetchInterval: 60_000,
  });

  const shift = useQuery({ queryKey: posKeys.shift, queryFn: posApi.currentShift, staleTime: 60_000, enabled: dashboard.isSuccess && dashboard.data.fallback });

  const d = dashboard.data?.data;
  const today_ = d?.today;
  // `/reports/dashboard` embeds a compact {id, opened_at, cashier, terminal}; the fallback path has a full Shift.
  const openShift: DashboardOpenShift | null = d?.open_shift
    ? d.open_shift
    : dashboard.data?.fallback && shift.data
      ? { id: shift.data.id, opened_at: shift.data.opened_at, cashier: shift.data.cashier_name, terminal: shift.data.terminal }
      : null;
  const hourly: HourPoint[] = (d?.hourly ?? [])
    .filter((h) => typeof h?.hour === 'number')
    .map((h) => ({ hour: h.hour as number, bills: h.bills ?? 0, net: dec(h.net) }));
  const topProducts = d?.top_products ?? [];

  const topColumns: GlassColumn<NonNullable<DashboardResponse['top_products']>[number]>[] = [
    { key: 'name', label: tc('name'), render: (r) => r.name ?? r.sku ?? '-' },
    { key: 'qty', label: t('qtySold'), align: 'right', render: (r) => formatQty(r.qty ?? 0, locale) },
    { key: 'net', label: t('netSales'), align: 'right', render: (r) => formatMoney(r.net ?? 0, locale) },
  ];

  const v = (n: unknown) => (dashboard.isPending ? '…' : n === undefined || n === null ? '-' : String(n));

  return (
    <Stack spacing={3}>
      <Stack direction="row" alignItems="flex-start" spacing={2} flexWrap="wrap" useFlexGap>
        <Box sx={{ flex: 1, minWidth: 240 }}>
          <Typography variant="h4" component="h1" fontWeight={700}>
            {t('title')}
          </Typography>
          {session && <Typography color="text.secondary">{t('welcome', { name: session.user.display_name })}</Typography>}
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          {openShift ? (
            <Tooltip title={`${openShift.terminal ?? ''} · ${openShift.cashier ?? ''}`}>
              <Chip
                icon={<ScheduleIcon />}
                color="success"
                component={Link}
                href="/pos/shift"
                clickable
                label={t('openShift', { time: formatTime(openShift.opened_at ?? null, locale, false) })}
              />
            </Tooltip>
          ) : (
            !dashboard.isPending && <Chip icon={<ScheduleIcon />} variant="outlined" label={t('noOpenShift')} />
          )}
          <GlassButton component={Link} href="/pos" startIcon={<PointOfSaleIcon />}>
            {tc('pos')}
          </GlassButton>
        </Stack>
      </Stack>

      {dashboard.isError && <Alert severity="error">{errorMessage(dashboard.error)}</Alert>}
      {dashboard.data?.fallback && <Alert severity="info">{t('fallbackNotice')}</Alert>}

      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={4} xl={2}>
          <Kpi icon={<ReceiptIcon />} label={t('todayBills')} value={dashboard.isPending ? '…' : formatQty(today_?.bills ?? 0, locale)} href="/pos/history" />
        </Grid>
        <Grid item xs={12} sm={6} md={4} xl={2}>
          <Kpi
            icon={<PointOfSaleIcon />}
            label={t('todayNet')}
            value={dashboard.isPending ? '…' : formatMoney(today_?.net ?? 0, locale)}
            hint={d?.month_to_date_net !== undefined ? `${t('monthToDate')} ${formatMoney(d.month_to_date_net, locale)}` : undefined}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4} xl={2}>
          <Kpi icon={<PaymentsIcon />} label={t('todayCash')} value={dashboard.isPending ? '…' : formatMoney(today_?.cash ?? 0, locale)} />
        </Grid>
        <Grid item xs={12} sm={6} md={4} xl={2}>
          <Kpi icon={<CreditScoreIcon />} label={t('todayCredit')} value={dashboard.isPending ? '…' : formatMoney(today_?.credit ?? 0, locale)} />
        </Grid>
        <Grid item xs={12} sm={6} md={4} xl={2}>
          <Kpi icon={<ShowChartIcon />} label={t('avgBill')} value={dashboard.isPending ? '…' : formatMoney(today_?.avg_bill ?? 0, locale)} />
        </Grid>
        <Grid item xs={12} sm={6} md={4} xl={2}>
          <Kpi icon={<CancelIcon />} label={t('cancelledBills')} value={v(today_?.cancelled ?? 0)} />
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <Kpi
            icon={<WarningAmberIcon />}
            label={t('lowStock')}
            value={dashboard.isPending ? '…' : d?.low_stock_count === undefined ? '-' : formatQty(d.low_stock_count, locale)}
            hint={t('viewLowStock')}
            href="/inventory?low_stock=true"
          />
        </Grid>
        <Grid item xs={12} md={6}>
          <Kpi
            icon={<AccountBalanceWalletIcon />}
            label={t('arOutstanding')}
            value={dashboard.isPending ? '…' : d?.ar_outstanding_total === undefined ? '-' : formatMoney(d.ar_outstanding_total, locale)}
            hint={t('viewAr')}
            href="/ar"
          />
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid item xs={12} lg={8}>
          <GlassCard title={t('hourlySales')} subtitle={t('hourlySubtitle')}>
            {dashboard.isPending ? (
              <Typography color="text.secondary" sx={{ py: 6 }} align="center">
                {tc('loading')}
              </Typography>
            ) : (
              <HourlyChart points={hourly} />
            )}
          </GlassCard>
        </Grid>
        <Grid item xs={12} lg={4}>
          <GlassCard title={t('topProducts')}>
            <GlassTable
              columns={topColumns}
              rows={topProducts}
              rowKey={(r, i) => `${r.product_id ?? r.sku ?? ''}-${i}`}
              loading={dashboard.isPending}
              emptyText={t('noTopProducts')}
              maxHeight={320}
            />
          </GlassCard>
        </Grid>
      </Grid>
    </Stack>
  );
}
