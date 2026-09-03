'use client';

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CancelIcon from '@mui/icons-material/Cancel';
import PrintIcon from '@mui/icons-material/Print';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Pagination from '@mui/material/Pagination';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { useSession } from '@/components/Providers';
import { GlassButton, GlassCard, GlassInput, GlassTable, type GlassColumn } from '@/components/glass';
import CancelSaleDialog from '@/components/pos/CancelSaleDialog';
import ReceiptDialog from '@/components/pos/ReceiptPrint';
import SaleDetailDialog, { SaleStatusChip } from '@/components/pos/SaleDetailDialog';
import { resolveLocale } from '@/i18n/config';
import { MUTATING_ROLES } from '@/lib/auth/session';
import { formatMoney, formatQty, formatTime } from '@/lib/format';
import { posApi, posKeys } from '@/lib/pos/api';
import type { Sale } from '@/lib/pos/types';

const STATUSES = ['', 'completed', 'cancelled', 'refunded', 'partial_refund'] as const;

function Stat({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Typography variant="h6" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
    </Box>
  );
}

export default function SalesHistoryPage() {
  const t = useTranslations('pos');
  const locale = resolveLocale(useLocale());
  const { hasRole } = useSession();
  const canCancel = hasRole(...MUTATING_ROLES);

  const today = dayjs().format('YYYY-MM-DD');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [status, setStatus] = useState<string>('');
  const [docNo, setDocNo] = useState('');
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [reprint, setReprint] = useState<Sale | null>(null);
  const [cancel, setCancel] = useState<Sale | null>(null);

  const params = { from, to, status: status || undefined, doc_no: docNo.trim() || undefined, page, page_size: 50 };
  const sales = useQuery({
    queryKey: posKeys.sales(params),
    queryFn: () => posApi.listSales(params),
    placeholderData: (prev) => prev,
  });
  const summary = useQuery({ queryKey: posKeys.summary(from, to), queryFn: () => posApi.summary(from, to) });

  const columns: GlassColumn<Sale>[] = [
    { key: 'doc_no', label: t('saleNo'), render: (r) => <b>{r.doc_no}</b> },
    { key: 'sold_at', label: t('time'), render: (r) => `${dayjs(r.sold_at).format('DD/MM')} ${formatTime(r.sold_at, locale, false)}` },
    { key: 'cashier_name', label: t('cashier') },
    { key: 'member', label: t('member'), render: (r) => (r.member_id ? `${r.member_code ?? ''} ${r.member_name ?? ''}` : t('walkIn')) },
    { key: 'lines', label: t('items'), align: 'right', render: (r) => (r.lines ? formatQty(r.lines.length, locale) : '-') },
    { key: 'net', label: t('net'), align: 'right', render: (r) => formatMoney(r.net, locale) },
    { key: 'status', label: t('statusLabel'), render: (r) => <SaleStatusChip status={r.status} arStatus={r.ar_status} /> },
    {
      key: 'actions',
      label: '',
      align: 'right',
      width: 96,
      render: (r) => (
        <Stack direction="row" justifyContent="flex-end" onClick={(e) => e.stopPropagation()}>
          <Tooltip title={t('reprint')}>
            <IconButton size="small" aria-label={t('reprint')} onClick={() => setReprint(r)}>
              <PrintIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {canCancel && r.status === 'completed' && (
            <Tooltip title={t('cancelSale')}>
              <IconButton size="small" color="error" aria-label={t('cancelSale')} onClick={() => setCancel(r)}>
                <CancelIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
      ),
    },
  ];

  const total = sales.data?.total ?? 0;
  const pageSize = sales.data?.page_size ?? 50;
  const s = summary.data;

  return (
    <Stack spacing={2.5} sx={{ maxWidth: 1300, mx: 'auto' }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <GlassButton component={Link} href="/pos" variant="text" startIcon={<ArrowBackIcon />}>
          {t('backToPos')}
        </GlassButton>
        <Typography variant="h5" fontWeight={700} sx={{ flex: 1 }}>
          {t('historyTitle')}
        </Typography>
      </Stack>

      <GlassCard>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={6} sm={3} md={2}>
            <GlassInput
              size="small"
              type="date"
              label={t('fromDate')}
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={6} sm={3} md={2}>
            <GlassInput
              size="small"
              type="date"
              label={t('toDate')}
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={6} sm={3} md={2}>
            <GlassInput
              size="small"
              select
              label={t('statusLabel')}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              {STATUSES.map((st) => (
                <MenuItem key={st} value={st}>
                  {st === '' ? t('allStatuses') : t(`status.${st}`)}
                </MenuItem>
              ))}
            </GlassInput>
          </Grid>
          <Grid item xs={6} sm={3} md={2}>
            <GlassInput
              size="small"
              label={t('saleNo')}
              value={docNo}
              onChange={(e) => {
                setDocNo(e.target.value);
                setPage(1);
              }}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <Stack direction="row" spacing={1}>
              <GlassButton
                variant="outlined"
                size="small"
                onClick={() => {
                  setFrom(today);
                  setTo(today);
                  setPage(1);
                }}
              >
                {t('today')}
              </GlassButton>
              <GlassButton
                variant="outlined"
                size="small"
                onClick={() => {
                  const y = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
                  setFrom(y);
                  setTo(y);
                  setPage(1);
                }}
              >
                {t('yesterday')}
              </GlassButton>
              <GlassButton
                variant="outlined"
                size="small"
                onClick={() => {
                  setFrom(dayjs().startOf('month').format('YYYY-MM-DD'));
                  setTo(today);
                  setPage(1);
                }}
              >
                {t('thisMonth')}
              </GlassButton>
            </Stack>
          </Grid>
        </Grid>
      </GlassCard>

      <Grid container spacing={2}>
        <Grid item xs={6} sm={3}>
          <GlassCard>
            <Stat label={t('bills')} value={s ? formatQty(s.bills, locale) : '-'} />
          </GlassCard>
        </Grid>
        <Grid item xs={6} sm={3}>
          <GlassCard>
            <Stat label={t('net')} value={s ? formatMoney(s.net, locale) : '-'} />
          </GlassCard>
        </Grid>
        <Grid item xs={6} sm={3}>
          <GlassCard>
            <Stat label={t('methods.cash')} value={s ? formatMoney(s.by_method?.cash ?? 0, locale) : '-'} />
          </GlassCard>
        </Grid>
        <Grid item xs={6} sm={3}>
          <GlassCard>
            <Stat label={t('cancelledBills')} value={s ? formatQty(s.cancelled, locale) : '-'} />
          </GlassCard>
        </Grid>
      </Grid>

      <GlassCard title={t('salesList')} subtitle={total > 0 ? t('resultCount', { count: total }) : undefined}>
        <GlassTable
          columns={columns}
          rows={sales.data?.items ?? []}
          rowKey={(r) => r.id}
          loading={sales.isPending}
          emptyText={t('noSales')}
          onRowClick={(r) => setDetailId(r.id)}
          maxHeight={600}
        />
        {total > pageSize && (
          <Stack alignItems="center" sx={{ mt: 2 }}>
            <Pagination count={Math.ceil(total / pageSize)} page={page} onChange={(_, p) => setPage(p)} />
          </Stack>
        )}
      </GlassCard>

      <SaleDetailDialog
        saleId={detailId}
        open={Boolean(detailId)}
        onClose={() => setDetailId(null)}
        onReprint={(r) => {
          setDetailId(null);
          setReprint(r);
        }}
        onCancel={(r) => {
          setDetailId(null);
          setCancel(r);
        }}
      />
      <ReceiptDialog open={Boolean(reprint)} saleId={reprint?.id ?? null} copy autoPrint onClose={() => setReprint(null)} />
      <CancelSaleDialog sale={cancel} open={Boolean(cancel)} onClose={() => setCancel(null)} />
    </Stack>
  );
}
