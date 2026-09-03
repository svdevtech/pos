'use client';

import AddIcon from '@mui/icons-material/Add';
import CalculateIcon from '@mui/icons-material/Calculate';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import LockIcon from '@mui/icons-material/Lock';
import PaidIcon from '@mui/icons-material/Paid';
import PaymentsIcon from '@mui/icons-material/Payments';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useMutation } from '@tanstack/react-query';
import type { GridColDef } from '@mui/x-data-grid';
import { useLocale, useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import MoneyField from '@/components/MoneyField';
import PageHeader from '@/components/PageHeader';
import { useSession } from '@/components/Providers';
import QueryError from '@/components/QueryError';
import ServerDataGrid from '@/components/ServerDataGrid';
import StatTile from '@/components/StatTile';
import { useToast } from '@/components/Toast';
import PayoutDialog from '@/components/dividends/PayoutDialog';
import { DIVIDEND_STATUS_COLOR as STATUS_COLOR } from '@/components/dividends/status';
import { GlassButton, GlassCard, GlassInput, GlassTable, type GlassColumn } from '@/components/glass';
import { resolveLocale } from '@/i18n/config';
import { useApiErrorMessage } from '@/lib/api/errors';
import { decStr, num } from '@/lib/api/hooks/common';
import {
  DIVIDEND_POOLS,
  exportRunCsv,
  usePeriod,
  usePutCriteria,
  useSimulate,
  useStatements,
  useTransitionPeriod,
  useUpdatePeriod,
  type CriterionInput,
  type DividendCriterion,
  type DividendRun,
  type DividendStatement,
  type DividendTotals,
  type PeriodTransition,
} from '@/lib/api/hooks/dividends';
import { ADMIN_ROLES, MUTATING_ROLES } from '@/lib/auth/session';
import { formatDate, formatDateTime, formatMoney, formatNumber, formatQty } from '@/lib/format';
import { useDebounce } from '@/lib/useDebounce';

// ---------------------------------------------------------------------------
// Criteria editor
// ---------------------------------------------------------------------------

interface CriterionDraft {
  key: string;
  kind: 'share_rule' | 'allocation';
  name: string;
  name_en: string;
  percent: string;
  baht_per_share: string;
  max_shares: string;
  apply_cap: boolean;
  pool_code: 'HUN' | 'AVG' | 'OTHER';
  is_locked: boolean;
}

let seq = 0;
const nextKey = () => `c${++seq}`;

function fromCriteria(list: DividendCriterion[]): CriterionDraft[] {
  return list.map((c) => ({
    key: c.id || nextKey(),
    kind: c.kind === 'share_rule' ? 'share_rule' : 'allocation',
    name: c.name,
    name_en: c.name_en ?? '',
    percent: String(num(c.percent)),
    baht_per_share: c.baht_per_share == null ? '' : String(num(c.baht_per_share)),
    max_shares: c.max_shares == null ? '' : String(num(c.max_shares)),
    apply_cap: c.apply_cap,
    pool_code: c.pool_code === 'HUN' || c.pool_code === 'AVG' ? c.pool_code : 'OTHER',
    is_locked: c.is_locked,
  }));
}

function toInputs(list: CriterionDraft[]): CriterionInput[] {
  return list.map((c, i) => ({
    kind: c.kind,
    name: c.name.trim(),
    name_en: c.name_en.trim(),
    percent: decStr(c.percent, 4),
    baht_per_share: c.kind === 'share_rule' && c.baht_per_share !== '' ? decStr(c.baht_per_share, 4) : null,
    max_shares: c.kind === 'share_rule' && c.max_shares !== '' ? decStr(c.max_shares, 4) : null,
    apply_cap: c.kind === 'share_rule' ? c.apply_cap : false,
    pool_code: c.kind === 'share_rule' ? 'HUN' : c.pool_code,
    sort_order: i,
  }));
}

function CriteriaEditor({ periodId, criteria, editable }: { periodId: string; criteria: DividendCriterion[]; editable: boolean }) {
  const t = useTranslations('dividends');
  const tc = useTranslations('common');
  const toast = useToast();
  const errorMessage = useApiErrorMessage();
  const save = usePutCriteria(periodId);
  const [rows, setRows] = useState<CriterionDraft[]>(() => fromCriteria(criteria));
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setRows(fromCriteria(criteria));
    setDirty(false);
  }, [criteria]);

  const update = (key: string, patch: Partial<CriterionDraft>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const remove = (key: string) => {
    setRows((prev) => prev.filter((r) => r.key !== key));
    setDirty(true);
  };
  const addAllocation = () => {
    setRows((prev) => [...prev, { key: nextKey(), kind: 'allocation', name: '', name_en: '', percent: '0', baht_per_share: '', max_shares: '', apply_cap: false, pool_code: 'OTHER', is_locked: false }]);
    setDirty(true);
  };
  const addShareRule = () => {
    setRows((prev) => [{ key: nextKey(), kind: 'share_rule', name: t('kinds.share_rule'), name_en: 'Share dividend', percent: '0', baht_per_share: '', max_shares: '', apply_cap: false, pool_code: 'HUN', is_locked: false }, ...prev]);
    setDirty(true);
  };

  const shareRules = rows.filter((r) => r.kind === 'share_rule').length;
  const percentSum = rows.filter((r) => r.kind === 'allocation').reduce((s, r) => s + num(r.percent), 0);
  const valid = shareRules === 1 && rows.every((r) => r.name.trim() !== '');

  const submit = () =>
    save.mutate(toInputs(rows), {
      onSuccess: () => toast.success(t('criteriaSaved')),
      onError: (err) => toast.error(errorMessage(err)),
    });

  const ro = !editable;
  const columns: GlassColumn<CriterionDraft>[] = [
    {
      key: 'kind',
      label: t('kind'),
      width: 150,
      render: (r) => <Chip size="small" color={r.kind === 'share_rule' ? 'primary' : 'default'} label={t(`kinds.${r.kind}`)} icon={r.is_locked ? <LockIcon /> : undefined} />,
    },
    {
      key: 'name',
      label: t('name'),
      render: (r) => (ro ? r.name : <GlassInput size="small" value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} error={!r.name.trim()} />),
    },
    { key: 'name_en', label: t('nameEn'), width: 180, render: (r) => (ro ? r.name_en : <GlassInput size="small" value={r.name_en} onChange={(e) => update(r.key, { name_en: e.target.value })} />) },
    {
      key: 'percent',
      label: t('percent'),
      width: 130,
      align: 'right',
      render: (r) =>
        r.kind === 'share_rule' ? (
          ''
        ) : ro ? (
          `${formatNumber(r.percent, 'en', 2)}%`
        ) : (
          <MoneyField size="small" value={r.percent} onChange={(v) => update(r.key, { percent: v })} currency={false} decimals={4} suffix="%" fullWidth={false} sx={{ width: 120 }} />
        ),
    },
    {
      key: 'baht_per_share',
      label: t('bahtPerShare'),
      width: 140,
      align: 'right',
      render: (r) =>
        r.kind !== 'share_rule' ? (
          ''
        ) : ro ? (
          r.baht_per_share === '' ? '-' : formatNumber(r.baht_per_share, 'en', 4)
        ) : (
          <MoneyField size="small" value={r.baht_per_share} onChange={(v) => update(r.key, { baht_per_share: v })} decimals={4} fullWidth={false} sx={{ width: 130 }} />
        ),
    },
    {
      key: 'max_shares',
      label: t('maxShares'),
      width: 190,
      align: 'right',
      render: (r) =>
        r.kind !== 'share_rule' ? (
          ''
        ) : (
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end">
            {ro ? (
              <span>{r.max_shares === '' ? '-' : formatQty(r.max_shares, 'en')}</span>
            ) : (
              <MoneyField size="small" value={r.max_shares} onChange={(v) => update(r.key, { max_shares: v })} currency={false} decimals={4} fullWidth={false} sx={{ width: 110 }} />
            )}
            <Tooltip title={t('applyCap')}>
              <Switch size="small" checked={r.apply_cap} disabled={ro} onChange={(e) => update(r.key, { apply_cap: e.target.checked })} />
            </Tooltip>
          </Stack>
        ),
    },
    {
      key: 'pool_code',
      label: t('pool'),
      width: 150,
      render: (r) =>
        r.kind === 'share_rule' || ro ? (
          t(`pools.${r.pool_code}`)
        ) : (
          <GlassInput select size="small" value={r.pool_code} onChange={(e) => update(r.key, { pool_code: e.target.value as CriterionDraft['pool_code'] })}>
            {DIVIDEND_POOLS.map((p) => (
              <MenuItem key={p} value={p}>
                {t(`pools.${p}`)}
              </MenuItem>
            ))}
          </GlassInput>
        ),
    },
    ...(ro
      ? []
      : [
          {
            key: 'actions',
            label: '',
            width: 50,
            align: 'right' as const,
            render: (r: CriterionDraft) => (
              <IconButton size="small" aria-label={tc('delete')} onClick={() => remove(r.key)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            ),
          },
        ]),
  ];

  return (
    <GlassCard
      title={t('criteria')}
      subtitle={t('criteriaHint')}
      action={
        !ro ? (
          <Stack direction="row" spacing={1}>
            {shareRules === 0 && (
              <GlassButton size="small" variant="outlined" startIcon={<AddIcon />} onClick={addShareRule}>
                {t('kinds.share_rule')}
              </GlassButton>
            )}
            <GlassButton size="small" variant="outlined" startIcon={<AddIcon />} onClick={addAllocation}>
              {t('addAllocation')}
            </GlassButton>
            <GlassButton size="small" onClick={submit} loading={save.isPending} disabled={!dirty || !valid}>
              {t('saveCriteria')}
            </GlassButton>
          </Stack>
        ) : undefined
      }
    >
      <Stack spacing={1.5}>
        {shareRules !== 1 && !ro && <Alert severity="warning">{t('shareRuleRequired')}</Alert>}
        <GlassTable columns={columns} rows={rows} rowKey={(r) => r.key} emptyText={t('noCriteria')} />
        <Typography variant="body2" color={Math.abs(percentSum - 100) > 0.0001 ? 'warning.main' : 'text.secondary'} textAlign="right">
          {t('percentSum')}: {formatNumber(percentSum, 'en', 2)}%
        </Typography>
      </Stack>
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// Totals banner
// ---------------------------------------------------------------------------

function TotalsBanner({ totals, locale }: { totals: DividendTotals; locale: 'th' | 'en' }) {
  const t = useTranslations('dividends');
  return (
    <Stack spacing={2}>
      <Grid container spacing={2}>
        <Grid item xs={6} md={3}>
          <StatTile label={t('netProfit')} value={formatMoney(totals.net_profit, locale)} />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatTile label={t('ratePerShare')} value={formatNumber(totals.rate_per_share, locale, 4)} hint={`${t('totalShares')}: ${formatQty(totals.total_shares_effective, locale)}`} />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatTile label={t('rebateRate')} value={`${formatNumber(num(totals.rebate_rate) * 100, locale, 4)}%`} hint={`${t('totalPurchases')}: ${formatMoney(totals.total_purchases, locale)}`} />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatTile label={t('members')} value={totals.member_count} />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatTile label={t('totalDividend')} value={formatMoney(totals.sum_share_dividend, locale)} hint={`${t('poolHun')}: ${formatMoney(totals.pool_hun, locale)}`} />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatTile label={t('totalRebate')} value={formatMoney(totals.sum_rebate, locale)} hint={`${t('poolAvg')}: ${formatMoney(totals.pool_avg, locale)}`} />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatTile label={t('sumTotal')} value={formatMoney(totals.sum_total, locale)} color="success.main" />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatTile label={t('walkinRebate')} value={formatMoney(totals.walkin_rebate, locale)} hint={`${t('purchases')}: ${formatMoney(totals.walkin_purchases, locale)}`} />
        </Grid>
      </Grid>
      {totals.allocations && totals.allocations.length > 0 && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {totals.allocations.map((a, i) => (
            <Chip key={a.criterion_id ?? i} variant="outlined" label={`${locale === 'en' && a.name_en ? a.name_en : a.name} ${formatNumber(a.percent, locale)}% = ${formatMoney(a.amount, locale)}`} />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Statements grid
// ---------------------------------------------------------------------------

function StatementsGrid({ run, canPay, locale }: { run: DividendRun; canPay: boolean; locale: 'th' | 'en' }) {
  const t = useTranslations('dividends');
  const [q, setQ] = useState('');
  const debouncedQ = useDebounce(q);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selected, setSelected] = useState<string | null>(null);
  const params = useMemo(() => ({ q: debouncedQ.trim(), page, page_size: pageSize }), [debouncedQ, page, pageSize]);
  const statements = useStatements(run.id, params);

  const columns = useMemo<GridColDef<DividendStatement>[]>(() => {
    const money = (v: unknown) => formatMoney(v as string, locale);
    return [
      { field: 'seq_no', headerName: '#', width: 70, align: 'right', headerAlign: 'right' },
      { field: 'member_code', headerName: t('memberCode'), width: 110 },
      {
        field: 'member_name',
        headerName: t('memberName'),
        flex: 1,
        minWidth: 180,
        renderCell: ({ row }) => (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
            <Typography variant="body2" noWrap>
              {row.member_name}
            </Typography>
            {row.is_walkin && <Chip size="small" label={t('walkin')} sx={{ height: 18, fontSize: 11 }} />}
          </Stack>
        ),
      },
      { field: 'shares_effective', headerName: t('shares'), width: 100, align: 'right', headerAlign: 'right', valueFormatter: (v) => formatQty(v as string, locale) },
      { field: 'purchases', headerName: t('purchases'), width: 130, align: 'right', headerAlign: 'right', valueFormatter: money },
      { field: 'share_dividend', headerName: t('shareDividend'), width: 130, align: 'right', headerAlign: 'right', valueFormatter: money },
      { field: 'rebate', headerName: t('rebate'), width: 130, align: 'right', headerAlign: 'right', valueFormatter: money },
      {
        field: 'total',
        headerName: t('totalDividend'),
        width: 140,
        align: 'right',
        headerAlign: 'right',
        renderCell: ({ value }) => (
          <Typography variant="body2" fontWeight={700}>
            {money(value)}
          </Typography>
        ),
      },
      {
        field: 'paid_total',
        headerName: t('paidTotal'),
        width: 130,
        align: 'right',
        headerAlign: 'right',
        renderCell: ({ row }) => {
          const paid = num(row.paid_total);
          const total = num(row.total);
          return (
            <Typography variant="body2" color={paid >= total && total > 0 ? 'success.main' : paid > 0 ? 'warning.main' : 'text.secondary'}>
              {formatMoney(paid, locale)}
            </Typography>
          );
        },
      },
      {
        field: 'actions',
        headerName: '',
        width: 60,
        sortable: false,
        align: 'right',
        renderCell: ({ row }) => (
          <Tooltip title={canPay ? t('payout') : t('viewStatement')}>
            <IconButton
              size="small"
              aria-label={t('payout')}
              onClick={(e) => {
                e.stopPropagation();
                setSelected(row.id);
              }}
            >
              <PaymentsIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ),
      },
    ];
  }, [t, locale, canPay]);

  return (
    <Stack spacing={2}>
      <GlassInput
        size="small"
        label={t('searchStatements')}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPage(1);
        }}
        sx={{ maxWidth: 360 }}
      />
      <QueryError error={statements.error} onRetry={() => statements.refetch()} />
      <ServerDataGrid<DividendStatement>
        rows={statements.data?.items ?? []}
        columns={columns}
        rowCount={statements.data?.total ?? 0}
        loading={statements.isPending || statements.isFetching}
        page={page}
        pageSize={pageSize}
        onPageChange={(p, s) => {
          setPage(p);
          setPageSize(s);
        }}
        emptyText={t('noStatements')}
        getRowClassName={() => 'row-clickable'}
        onRowClick={({ row }) => setSelected(row.id)}
      />
      <PayoutDialog statementId={selected} canPay={canPay} onClose={() => setSelected(null)} onSaved={() => setSelected(null)} />
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DividendPeriodPage() {
  const t = useTranslations('dividends');
  const tc = useTranslations('common');
  const locale = resolveLocale(useLocale());
  const toast = useToast();
  const errorMessage = useApiErrorMessage();
  const { hasRole } = useSession();
  const canManage = hasRole(...MUTATING_ROLES);
  const isOwner = hasRole(...ADMIN_ROLES);
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';

  const period = usePeriod(id);
  const update = useUpdatePeriod(id);
  const simulate = useSimulate(id);
  const transition = useTransitionPeriod(id);
  const exportCsv = useMutation({ mutationFn: (runId: string) => exportRunCsv(runId, period.data?.be_year), onError: (err) => toast.error(errorMessage(err)) });

  const [netProfit, setNetProfit] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [note, setNote] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<PeriodTransition | null>(null);

  const p = period.data;
  useEffect(() => {
    if (!p) return;
    setNetProfit(String(num(p.net_profit)));
    setStartsOn(p.starts_on ?? '');
    setEndsOn(p.ends_on ?? '');
    setNote(p.note ?? '');
  }, [p]);

  const runs = useMemo(() => p?.runs ?? [], [p]);
  const activeRun = useMemo(() => runs.find((r) => r.id === runId) ?? p?.latest_run ?? runs[0] ?? null, [runs, runId, p]);

  const editable = Boolean(p && (p.status === 'draft' || p.status === 'simulated') && canManage);
  const periodDirty = p ? netProfit !== String(num(p.net_profit)) || startsOn !== (p.starts_on ?? '') || endsOn !== (p.ends_on ?? '') || note !== (p.note ?? '') : false;
  const canPay = Boolean(isOwner && p && (p.status === 'approved' || p.status === 'paid') && activeRun?.is_final);

  const savePeriod = () =>
    update.mutate(
      { net_profit: decStr(netProfit), starts_on: startsOn || null, ends_on: endsOn || null, note: note.trim() },
      { onSuccess: () => toast.success(t('periodSaved')), onError: (err) => toast.error(errorMessage(err)) },
    );

  const runSimulate = () =>
    simulate.mutate(undefined, {
      onSuccess: (r) => {
        setRunId(r.id);
        toast.success(t('simulated', { run: r.run_no }));
      },
      onError: (err) => toast.error(errorMessage(err)),
    });

  const doTransition = () => {
    if (!confirm) return;
    transition.mutate(confirm, {
      onSuccess: () => {
        toast.success(t('transitioned'));
        setConfirm(null);
      },
      onError: (err) => toast.error(errorMessage(err)),
    });
  };

  const runCols: GlassColumn<DividendRun>[] = [
    { key: 'run_no', label: t('runNo'), width: 70, render: (r) => `#${r.run_no}` },
    { key: 'computed_at', label: t('computedAt'), width: 160, render: (r) => formatDateTime(r.computed_at, locale) },
    { key: 'source', label: t('source'), width: 130, render: (r) => (t.has(`sources.${r.source}`) ? t(`sources.${r.source}`) : r.source) },
    { key: 'member_count', label: t('members'), width: 90, align: 'right' },
    { key: 'sum_total', label: t('sumTotal'), width: 150, align: 'right', render: (r) => formatMoney(r.totals?.sum_total, locale) },
    { key: 'is_final', label: '', width: 90, render: (r) => (r.is_final ? <Chip size="small" color="success" label={t('final')} /> : null) },
  ];

  const statusLabel = (s: string) => (t.has(`statuses.${s}`) ? t(`statuses.${s}`) : s);

  return (
    <Stack spacing={3}>
      <PageHeader
        title={p ? `${t('dividendPeriod')} ${p.be_year}` : t('dividendPeriod')}
        subtitle={p ? `${formatDate(p.starts_on, locale)} – ${formatDate(p.ends_on, locale)}` : undefined}
        backHref="/dividends"
        loading={period.isPending}
        actions={
          p ? (
            <>
              <Chip color={STATUS_COLOR[p.status] ?? 'default'} label={statusLabel(p.status)} sx={{ height: 40, fontWeight: 600 }} />
              {activeRun && (
                <GlassButton variant="outlined" startIcon={<DownloadIcon />} loading={exportCsv.isPending} onClick={() => exportCsv.mutate(activeRun.id)}>
                  {t('exportCsv')}
                </GlassButton>
              )}
              {editable && (
                <GlassButton startIcon={<CalculateIcon />} loading={simulate.isPending} onClick={runSimulate} disabled={periodDirty}>
                  {t('simulate')}
                </GlassButton>
              )}
              {isOwner && p.status === 'simulated' && (
                <GlassButton color="warning" startIcon={<CheckCircleIcon />} onClick={() => setConfirm('approve')}>
                  {t('approve')}
                </GlassButton>
              )}
              {isOwner && p.status === 'approved' && (
                <GlassButton color="success" startIcon={<PaidIcon />} onClick={() => setConfirm('mark-paid')}>
                  {t('markPaid')}
                </GlassButton>
              )}
              {isOwner && p.status === 'paid' && (
                <GlassButton startIcon={<LockIcon />} onClick={() => setConfirm('close')}>
                  {t('close')}
                </GlassButton>
              )}
            </>
          ) : undefined
        }
      />
      <QueryError error={period.error} onRetry={() => period.refetch()} />
      {period.isPending && <Skeleton variant="rounded" height={360} />}

      {p && (
        <>
          {p.status === 'simulated' && editable && <Alert severity="info">{t('simulatedNotice')}</Alert>}
          {periodDirty && editable && <Alert severity="warning">{t('unsavedNotice')}</Alert>}

          <Grid container spacing={3}>
            <Grid item xs={12} md={4}>
              <GlassCard
                title={t('dividendPeriod')}
                action={
                  editable ? (
                    <GlassButton size="small" onClick={savePeriod} loading={update.isPending} disabled={!periodDirty}>
                      {tc('save')}
                    </GlassButton>
                  ) : undefined
                }
              >
                <Stack spacing={2}>
                  <MoneyField label={t('netProfit')} value={netProfit} onChange={setNetProfit} disabled={!editable} helperText={t('netProfitHint')} />
                  <Stack direction="row" spacing={2}>
                    <GlassInput type="date" label={t('periodStart')} value={startsOn} onChange={(e) => setStartsOn(e.target.value)} InputLabelProps={{ shrink: true }} disabled={!editable} />
                    <GlassInput type="date" label={t('periodEnd')} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} InputLabelProps={{ shrink: true }} disabled={!editable} />
                  </Stack>
                  <GlassInput label={t('note')} value={note} onChange={(e) => setNote(e.target.value)} multiline minRows={2} disabled={!editable} />
                  {p.approved_at && (
                    <Typography variant="caption" color="text.secondary">
                      {t('approvedAt')}: {formatDateTime(p.approved_at, locale)}
                    </Typography>
                  )}
                </Stack>
              </GlassCard>
            </Grid>
            <Grid item xs={12} md={8}>
              <CriteriaEditor periodId={id} criteria={p.criteria ?? []} editable={editable} />
            </Grid>
          </Grid>

          <GlassCard title={t('runs')} subtitle={t('runsHint')}>
            <GlassTable columns={runCols} rows={runs} rowKey={(r) => r.id} emptyText={t('noRuns')} onRowClick={(r) => setRunId(r.id)} isSelected={(r) => r.id === activeRun?.id} maxHeight={260} />
          </GlassCard>

          {activeRun && (
            <>
              <Typography variant="h6" fontWeight={600}>
                {t('runNo')} #{activeRun.run_no} · {formatDateTime(activeRun.computed_at, locale)}
                {activeRun.is_final ? ` · ${t('final')}` : ''}
              </Typography>
              <TotalsBanner totals={activeRun.totals} locale={locale} />
              <Typography variant="h6" fontWeight={600}>
                {t('statements')}
              </Typography>
              <StatementsGrid run={activeRun} canPay={canPay} locale={locale} />
            </>
          )}
        </>
      )}

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm === 'approve' ? t('approve') : confirm === 'mark-paid' ? t('markPaid') : t('close')}
        message={confirm === 'approve' ? t('approveConfirm') : confirm === 'mark-paid' ? t('markPaidConfirm') : t('closeConfirm')}
        color={confirm === 'close' ? 'error' : 'warning'}
        loading={transition.isPending}
        onClose={() => setConfirm(null)}
        onConfirm={doTransition}
      />
    </Stack>
  );
}
