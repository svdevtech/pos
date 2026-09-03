'use client';

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import LockIcon from '@mui/icons-material/Lock';
import LoginIcon from '@mui/icons-material/Login';
import LogoutIcon from '@mui/icons-material/Logout';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import Pagination from '@mui/material/Pagination';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { useToast } from '@/components/Toast';
import { GlassButton, GlassCard, GlassDialog, GlassInput, GlassTable, type GlassColumn } from '@/components/glass';
import ShiftOpenDialog from '@/components/pos/ShiftOpenDialog';
import { resolveLocale } from '@/i18n/config';
import { useApiErrorMessage } from '@/lib/api/errors';
import { formatDateTime, formatMoney } from '@/lib/format';
import { posApi, posKeys } from '@/lib/pos/api';
import { dec, money, shiftExpectedCash, type DrawerReason, type Shift, type ShiftReport } from '@/lib/pos/types';

function Stat({ label, value, color }: { label: ReactNode; value: ReactNode; color?: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Typography variant="h6" fontWeight={700} color={color} sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
    </Box>
  );
}

function VarianceText({ value }: { value: number }) {
  const t = useTranslations('pos');
  const locale = resolveLocale(useLocale());
  const color = value === 0 ? 'success.main' : value > 0 ? 'info.main' : 'error.main';
  return (
    <Typography variant="h5" fontWeight={800} color={color} sx={{ fontVariantNumeric: 'tabular-nums' }} data-testid="variance">
      {value > 0 ? '+' : ''}
      {formatMoney(value, locale)}
      <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
        {value === 0 ? t('varianceOk') : value > 0 ? t('varianceOver') : t('varianceShort')}
      </Typography>
    </Typography>
  );
}

function ShiftSummary({ report }: { report: ShiftReport }) {
  const t = useTranslations('pos');
  const locale = resolveLocale(useLocale());
  const sh = report.shift;
  const sum = report.summary;
  const byMethod = sum?.by_method ?? {};
  return (
    <Stack spacing={2}>
      <Grid container spacing={2}>
        <Grid item xs={6} sm={3}>
          <Stat label={t('openedAt')} value={formatDateTime(sh.opened_at, locale)} />
        </Grid>
        <Grid item xs={6} sm={3}>
          <Stat label={t('closedAt')} value={sh.closed_at ? formatDateTime(sh.closed_at, locale) : '-'} />
        </Grid>
        <Grid item xs={6} sm={3}>
          <Stat label={t('cashier')} value={sh.cashier_name ?? '-'} />
        </Grid>
        <Grid item xs={6} sm={3}>
          <Stat label={t('terminal')} value={sh.terminal} />
        </Grid>
      </Grid>
      <Divider />
      <Grid container spacing={2}>
        <Grid item xs={6} sm={3}>
          <Stat label={t('openingCash')} value={formatMoney(sh.opening_float, locale)} />
        </Grid>
        <Grid item xs={6} sm={3}>
          <Stat label={t('cashSales')} value={formatMoney(sh.cash_sales, locale)} />
        </Grid>
        <Grid item xs={6} sm={3}>
          <Stat label={t('paidIn')} value={formatMoney(sh.cash_in, locale)} />
        </Grid>
        <Grid item xs={6} sm={3}>
          <Stat label={t('paidOut')} value={formatMoney(sh.cash_out, locale)} />
        </Grid>
        <Grid item xs={6} sm={3}>
          <Stat label={t('expectedCash')} value={formatMoney(shiftExpectedCash(sh), locale)} />
        </Grid>
        <Grid item xs={6} sm={3}>
          <Stat label={t('countedCash')} value={sh.counted_cash != null ? formatMoney(sh.counted_cash, locale) : '-'} />
        </Grid>
        <Grid item xs={12} sm={6}>
          <Typography variant="caption" color="text.secondary" display="block">
            {t('difference')}
          </Typography>
          {sh.variance != null ? <VarianceText value={dec(sh.variance)} /> : <Typography>-</Typography>}
        </Grid>
      </Grid>
      {sum && (
        <>
          <Divider />
          <Grid container spacing={2}>
            <Grid item xs={6} sm={3}>
              <Stat label={t('bills')} value={sum.bills} />
            </Grid>
            <Grid item xs={6} sm={3}>
              <Stat label={t('net')} value={formatMoney(sum.net, locale)} />
            </Grid>
            <Grid item xs={6} sm={3}>
              <Stat label={t('discount')} value={formatMoney(sum.discount, locale)} />
            </Grid>
            <Grid item xs={6} sm={3}>
              <Stat label={t('cancelledBills')} value={sum.cancelled} />
            </Grid>
            {Object.entries(byMethod).map(([m, v]) => (
              <Grid item xs={6} sm={3} key={m}>
                <Stat label={t.has(`methods.${m}`) ? t(`methods.${m}`) : m} value={formatMoney(v, locale)} />
              </Grid>
            ))}
          </Grid>
        </>
      )}
      {sh.note && (
        <Typography variant="body2" color="text.secondary">
          {t('note')}: {sh.note}
        </Typography>
      )}
    </Stack>
  );
}

export default function ShiftPage() {
  const t = useTranslations('pos');
  const locale = resolveLocale(useLocale());
  const toast = useToast();
  const errorMessage = useApiErrorMessage();
  const qc = useQueryClient();

  const [openDialog, setOpenDialog] = useState(false);
  const [countedText, setCountedText] = useState('');
  const [closeNote, setCloseNote] = useState('');
  const [drawerOp, setDrawerOp] = useState<DrawerReason | null>(null);
  const [drawerAmount, setDrawerAmount] = useState('');
  const [drawerNote, setDrawerNote] = useState('');
  const [closed, setClosed] = useState<ShiftReport | null>(null);
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);

  const shift = useQuery({ queryKey: posKeys.shift, queryFn: posApi.currentShift, staleTime: 15_000, refetchInterval: 60_000 });
  const shifts = useQuery({ queryKey: posKeys.shifts(page), queryFn: () => posApi.listShifts(page, 20), placeholderData: (prev) => prev });
  const detail = useQuery({ queryKey: posKeys.shiftDetail(detailId ?? ''), queryFn: () => posApi.shiftReport(detailId as string), enabled: Boolean(detailId) });

  const current = shift.data ?? null;
  const expected = current ? shiftExpectedCash(current) : 0;
  const counted = Number(countedText);
  const countedValid = countedText !== '' && Number.isFinite(counted) && counted >= 0;
  const variance = countedValid ? money(counted - expected) : null;

  useEffect(() => {
    if (current) setClosed(null);
  }, [current]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: posKeys.shift });
    void qc.invalidateQueries({ queryKey: ['pos', 'shifts'] });
  };

  const close = useMutation({
    mutationFn: () => posApi.closeShift(current!.id, { counted_cash: counted, note: closeNote.trim() || undefined }),
    onSuccess: (report) => {
      setClosed(report);
      setCountedText('');
      setCloseNote('');
      qc.setQueryData(posKeys.shift, null);
      invalidate();
      toast.success(t('shiftClosedToast'));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const drawer = useMutation({
    mutationFn: () => posApi.drawer({ reason: drawerOp as DrawerReason, amount: Number(drawerAmount) || 0, note: drawerNote.trim() }),
    onSuccess: () => {
      toast.success(drawerOp === 'paid_in' ? t('paidInDone') : t('paidOutDone'));
      setDrawerOp(null);
      setDrawerAmount('');
      setDrawerNote('');
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const columns: GlassColumn<Shift>[] = [
    { key: 'opened_at', label: t('openedAt'), render: (r) => formatDateTime(r.opened_at, locale) },
    { key: 'closed_at', label: t('closedAt'), render: (r) => (r.closed_at ? formatDateTime(r.closed_at, locale) : '-') },
    { key: 'cashier_name', label: t('cashier') },
    { key: 'terminal', label: t('terminal') },
    { key: 'opening_float', label: t('openingCash'), align: 'right', render: (r) => formatMoney(r.opening_float, locale) },
    { key: 'cash_sales', label: t('cashSales'), align: 'right', render: (r) => formatMoney(r.cash_sales, locale) },
    { key: 'expected', label: t('expectedCash'), align: 'right', render: (r) => formatMoney(shiftExpectedCash(r), locale) },
    { key: 'counted_cash', label: t('countedCash'), align: 'right', render: (r) => (r.counted_cash != null ? formatMoney(r.counted_cash, locale) : '-') },
    {
      key: 'variance',
      label: t('difference'),
      align: 'right',
      render: (r) =>
        r.variance != null ? (
          <Typography variant="body2" color={dec(r.variance) === 0 ? 'success.main' : dec(r.variance) > 0 ? 'info.main' : 'error.main'}>
            {formatMoney(r.variance, locale)}
          </Typography>
        ) : (
          '-'
        ),
    },
    {
      key: 'status',
      label: t('statusLabel'),
      render: (r) => <Chip size="small" color={r.status === 'open' ? 'success' : 'default'} label={r.status === 'open' ? t('shiftOpen') : t('shiftStatusClosed')} />,
    },
  ];

  const total = shifts.data?.total ?? 0;
  const pageSize = shifts.data?.page_size ?? 20;

  return (
    <Stack spacing={2.5} sx={{ maxWidth: 1200, mx: 'auto' }}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <GlassButton component={Link} href="/pos" variant="text" startIcon={<ArrowBackIcon />}>
          {t('backToPos')}
        </GlassButton>
        <Typography variant="h5" fontWeight={700} sx={{ flex: 1 }}>
          {t('shiftTitle')}
        </Typography>
      </Stack>

      {closed && (
        <Alert severity="success" onClose={() => setClosed(null)}>
          <Typography fontWeight={700}>{t('shiftClosedToast')}</Typography>
          <Box sx={{ mt: 1 }}>
            <ShiftSummary report={closed} />
          </Box>
        </Alert>
      )}

      {current ? (
        <Grid container spacing={2.5}>
          <Grid item xs={12} md={7}>
            <GlassCard title={t('currentShift')} action={<Chip color="success" size="small" label={t('shiftOpen')} />}>
              <Grid container spacing={2}>
                <Grid item xs={6} sm={4}>
                  <Stat label={t('openedAt')} value={formatDateTime(current.opened_at, locale)} />
                </Grid>
                <Grid item xs={6} sm={4}>
                  <Stat label={t('cashier')} value={current.cashier_name ?? '-'} />
                </Grid>
                <Grid item xs={6} sm={4}>
                  <Stat label={t('terminal')} value={current.terminal} />
                </Grid>
                <Grid item xs={6} sm={4}>
                  <Stat label={t('openingCash')} value={formatMoney(current.opening_float, locale)} />
                </Grid>
                <Grid item xs={6} sm={4}>
                  <Stat label={t('cashSales')} value={formatMoney(current.cash_sales, locale)} />
                </Grid>
                <Grid item xs={6} sm={4}>
                  <Stat label={t('paidIn')} value={formatMoney(current.cash_in, locale)} color="success.main" />
                </Grid>
                <Grid item xs={6} sm={4}>
                  <Stat label={t('paidOut')} value={formatMoney(current.cash_out, locale)} color="error.main" />
                </Grid>
                <Grid item xs={6} sm={4}>
                  <Stat label={t('expectedCash')} value={formatMoney(expected, locale)} />
                </Grid>
              </Grid>
              <Divider sx={{ my: 2 }} />
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <GlassButton variant="outlined" color="success" startIcon={<LoginIcon />} onClick={() => setDrawerOp('paid_in')}>
                  {t('paidIn')}
                </GlassButton>
                <GlassButton variant="outlined" color="error" startIcon={<LogoutIcon />} onClick={() => setDrawerOp('paid_out')}>
                  {t('paidOut')}
                </GlassButton>
              </Stack>
            </GlassCard>
          </Grid>
          <Grid item xs={12} md={5}>
            <GlassCard title={t('closeShift')} strong>
              <Stack spacing={2}>
                <GlassInput
                  label={t('countedCash')}
                  type="number"
                  value={countedText}
                  onChange={(e) => setCountedText(e.target.value)}
                  inputProps={{ min: 0, step: 1, inputMode: 'decimal', 'data-testid': 'counted-cash' }}
                  helperText={`${t('expectedCash')}: ${formatMoney(expected, locale)}`}
                />
                {variance !== null && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      {t('difference')}
                    </Typography>
                    <VarianceText value={variance} />
                  </Box>
                )}
                <GlassInput label={t('note')} value={closeNote} onChange={(e) => setCloseNote(e.target.value)} multiline minRows={2} />
                <GlassButton color="error" startIcon={<LockIcon />} disabled={!countedValid} loading={close.isPending} onClick={() => close.mutate()} data-testid="close-shift">
                  {t('closeShift')}
                </GlassButton>
              </Stack>
            </GlassCard>
          </Grid>
        </Grid>
      ) : (
        <GlassCard>
          <Stack spacing={2} alignItems="flex-start">
            <Typography color="text.secondary">{shift.isPending ? t('loading') : t('shiftClosed')}</Typography>
            <GlassButton startIcon={<LoginIcon />} onClick={() => setOpenDialog(true)} disabled={shift.isPending} data-testid="open-shift">
              {t('openShift')}
            </GlassButton>
          </Stack>
        </GlassCard>
      )}

      <GlassCard title={t('pastShifts')}>
        <GlassTable
          columns={columns}
          rows={shifts.data?.items ?? []}
          rowKey={(r) => r.id}
          loading={shifts.isPending}
          emptyText={t('noShifts')}
          onRowClick={(r) => setDetailId(r.id)}
          maxHeight={480}
        />
        {total > pageSize && (
          <Stack alignItems="center" sx={{ mt: 2 }}>
            <Pagination count={Math.ceil(total / pageSize)} page={page} onChange={(_, p) => setPage(p)} />
          </Stack>
        )}
      </GlassCard>

      <ShiftOpenDialog open={openDialog} onClose={() => setOpenDialog(false)} />

      <GlassDialog
        open={Boolean(drawerOp)}
        onClose={() => setDrawerOp(null)}
        busy={drawer.isPending}
        title={drawerOp === 'paid_in' ? t('paidIn') : t('paidOut')}
        maxWidth="xs"
        actions={
          <>
            <GlassButton variant="text" onClick={() => setDrawerOp(null)} disabled={drawer.isPending}>
              {t('cancelAction')}
            </GlassButton>
            <GlassButton
              onClick={() => drawer.mutate()}
              loading={drawer.isPending}
              disabled={!(Number(drawerAmount) > 0)}
              color={drawerOp === 'paid_in' ? 'success' : 'error'}
            >
              {t('confirm')}
            </GlassButton>
          </>
        }
      >
        <Stack spacing={2} sx={{ pt: 1 }}>
          <GlassInput
            autoFocus
            label={t('amount')}
            type="number"
            value={drawerAmount}
            onChange={(e) => setDrawerAmount(e.target.value)}
            inputProps={{ min: 0, step: 1, inputMode: 'decimal' }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && Number(drawerAmount) > 0) drawer.mutate();
            }}
          />
          <GlassInput label={t('note')} value={drawerNote} onChange={(e) => setDrawerNote(e.target.value)} />
        </Stack>
      </GlassDialog>

      <GlassDialog open={Boolean(detailId)} onClose={() => setDetailId(null)} title={t('shiftDetail')} maxWidth="md" actions={<GlassButton onClick={() => setDetailId(null)}>{t('close')}</GlassButton>}>
        {detail.isPending && <Typography color="text.secondary">{t('loading')}</Typography>}
        {detail.isError && <Alert severity="error">{errorMessage(detail.error)}</Alert>}
        {detail.data && <ShiftSummary report={detail.data} />}
      </GlassDialog>
    </Stack>
  );
}
