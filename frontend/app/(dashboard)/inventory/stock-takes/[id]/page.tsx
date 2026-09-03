'use client';

import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import SaveIcon from '@mui/icons-material/Save';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import MoneyField from '@/components/MoneyField';
import PageHeader from '@/components/PageHeader';
import { useSession } from '@/components/Providers';
import QueryError from '@/components/QueryError';
import StatTile from '@/components/StatTile';
import { useToast } from '@/components/Toast';
import { GlassButton, GlassInput, GlassTable, type GlassColumn } from '@/components/glass';
import { resolveLocale } from '@/i18n/config';
import { useApiErrorMessage } from '@/lib/api/errors';
import { decStr, num } from '@/lib/api/hooks/common';
import { useFinalizeStockTake, useSaveCounts, useStockTake, type StockTakeLine } from '@/lib/api/hooks/inventory';
import { MUTATING_ROLES } from '@/lib/auth/session';
import { formatDateTime, formatMoney, formatQty } from '@/lib/format';

interface Draft {
  counted: string;
  note: string;
}

const STATUS_COLOR: Record<string, 'success' | 'default' | 'error' | 'info'> = {
  open: 'info',
  finalized: 'success',
  cancelled: 'error',
};

export default function StockTakeDetailPage() {
  const t = useTranslations('inventory');
  const locale = resolveLocale(useLocale());
  const toast = useToast();
  const errorMessage = useApiErrorMessage();
  const { hasRole } = useSession();
  const canMutate = hasRole(...MUTATING_ROLES);
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';

  const take = useStockTake(id);
  const save = useSaveCounts(id);
  const finalize = useFinalizeStockTake(id);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [search, setSearch] = useState('');
  const [onlyUncounted, setOnlyUncounted] = useState(false);
  const [onlyDiffering, setOnlyDiffering] = useState(false);
  const [confirmFinalize, setConfirmFinalize] = useState(false);

  const st = take.data;
  const editable = Boolean(st && st.status === 'open' && canMutate);

  const draftOf = (l: StockTakeLine): Draft =>
    drafts[l.product_id] ?? { counted: l.counted_qty == null ? '' : String(num(l.counted_qty)), note: l.note ?? '' };
  const isDirty = (l: StockTakeLine) => {
    const d = drafts[l.product_id];
    if (!d) return false;
    const orig = l.counted_qty == null ? '' : String(num(l.counted_qty));
    return d.counted !== orig || d.note !== (l.note ?? '');
  };
  const dirtyLines = useMemo(() => (st?.lines ?? []).filter(isDirty), [st?.lines, drafts]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (st?.lines ?? []).filter((l) => {
      if (q && !`${l.sku ?? ''} ${l.product_name ?? ''}`.toLowerCase().includes(q)) return false;
      if (onlyUncounted && l.counted_qty != null) return false;
      if (onlyDiffering && (l.counted_qty == null || num(l.variance) === 0)) return false;
      return true;
    });
  }, [st?.lines, search, onlyUncounted, onlyDiffering]);

  const saveCounts = () => {
    const lines = dirtyLines
      .map((l) => ({ line: l, d: draftOf(l) }))
      .filter(({ d }) => d.counted !== '')
      .map(({ line, d }) => ({ product_id: line.product_id, counted_qty: decStr(d.counted, 3), note: d.note.trim() }));
    if (lines.length === 0) return;
    save.mutate(lines, {
      onSuccess: () => {
        setDrafts({});
        toast.success(t('countsSaved', { count: lines.length }));
      },
      onError: (err) => toast.error(errorMessage(err)),
    });
  };

  const columns: GlassColumn<StockTakeLine>[] = [
    { key: 'sku', label: t('sku'), width: 120 },
    { key: 'product_name', label: t('product') },
    { key: 'system_qty', label: t('systemQty'), width: 110, align: 'right', render: (l) => formatQty(l.system_qty, locale) },
    {
      key: 'counted_qty',
      label: t('countQty'),
      width: 150,
      align: 'right',
      render: (l) =>
        editable ? (
          <MoneyField
            size="small"
            value={draftOf(l).counted}
            onChange={(v) => setDrafts((prev) => ({ ...prev, [l.product_id]: { ...draftOf(l), counted: v } }))}
            currency={false}
            decimals={3}
            fullWidth={false}
            sx={{ width: 130 }}
            color={isDirty(l) ? 'warning' : undefined}
            focused={isDirty(l) || undefined}
          />
        ) : l.counted_qty == null ? (
          <Typography variant="body2" color="text.secondary">
            {t('notCounted')}
          </Typography>
        ) : (
          formatQty(l.counted_qty, locale)
        ),
    },
    {
      key: 'variance',
      label: t('variance'),
      width: 110,
      align: 'right',
      render: (l) => {
        const d = draftOf(l);
        const counted = editable && d.counted !== '' ? num(d.counted) : l.counted_qty == null ? null : num(l.counted_qty);
        if (counted === null) return '-';
        const v = counted - num(l.system_qty);
        return (
          <Typography variant="body2" fontWeight={600} color={v < 0 ? 'error.main' : v > 0 ? 'success.main' : 'text.secondary'}>
            {v > 0 ? '+' : ''}
            {formatQty(v, locale)}
          </Typography>
        );
      },
    },
    { key: 'cost_avg', label: t('costAvg'), width: 110, align: 'right', render: (l) => formatMoney(l.cost_avg, locale) },
    {
      key: 'note',
      label: t('lineNote'),
      width: 200,
      render: (l) =>
        editable ? (
          <GlassInput
            size="small"
            value={draftOf(l).note}
            onChange={(e) => setDrafts((prev) => ({ ...prev, [l.product_id]: { ...draftOf(l), note: e.target.value } }))}
          />
        ) : (
          l.note ?? ''
        ),
    },
  ];

  const summary = st?.summary;

  return (
    <Stack spacing={3}>
      <PageHeader
        title={st ? st.doc_no : t('stockTake')}
        subtitle={st ? `${t('startedAt')} ${formatDateTime(st.started_at, locale)}${st.note ? ` · ${st.note}` : ''}` : undefined}
        backHref="/inventory/stock-takes"
        loading={take.isPending}
        actions={
          editable ? (
            <>
              <GlassButton variant="outlined" startIcon={<SaveIcon />} loading={save.isPending} disabled={dirtyLines.length === 0} onClick={saveCounts}>
                {t('saveCounts')} {dirtyLines.length > 0 ? `(${dirtyLines.length})` : ''}
              </GlassButton>
              <GlassButton startIcon={<CheckCircleIcon />} onClick={() => setConfirmFinalize(true)} disabled={save.isPending}>
                {t('finalize')}
              </GlassButton>
            </>
          ) : undefined
        }
      />
      <QueryError error={take.error} onRetry={() => take.refetch()} />
      {take.isPending && <Skeleton variant="rounded" height={320} />}

      {st && (
        <>
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip size="small" color={STATUS_COLOR[st.status] ?? 'default'} label={t.has(`statuses.${st.status}`) ? t(`statuses.${st.status}`) : st.status} />
            {st.finalized_at && (
              <Typography variant="body2" color="text.secondary">
                {t('finalizedAt')} {formatDateTime(st.finalized_at, locale)}
              </Typography>
            )}
          </Stack>
          {st.status === 'open' && !canMutate && <Alert severity="info">{t('readOnlyNotice')}</Alert>}
          {summary && (
            <Grid container spacing={2}>
              <Grid item xs={6} sm={4} md={2}>
                <StatTile label={t('lineCount')} value={summary.lines} />
              </Grid>
              <Grid item xs={6} sm={4} md={2}>
                <StatTile label={t('counted')} value={summary.counted} hint={`${t('uncounted')}: ${summary.lines - summary.counted}`} />
              </Grid>
              <Grid item xs={6} sm={4} md={2}>
                <StatTile label={t('differing')} value={summary.differing} />
              </Grid>
              <Grid item xs={6} sm={4} md={2}>
                <StatTile label={t('qtyOver')} value={formatQty(summary.qty_over, locale)} color="success.main" />
              </Grid>
              <Grid item xs={6} sm={4} md={2}>
                <StatTile label={t('qtyShort')} value={formatQty(summary.qty_short, locale)} color="error.main" />
              </Grid>
              <Grid item xs={6} sm={4} md={2}>
                <StatTile label={t('valueDiff')} value={formatMoney(summary.value_diff, locale)} color={num(summary.value_diff) < 0 ? 'error.main' : 'success.main'} />
              </Grid>
            </Grid>
          )}

          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
            <GlassInput size="small" label={t('searchLines')} value={search} onChange={(e) => setSearch(e.target.value)} sx={{ minWidth: 260 }} fullWidth={false} />
            <FormControlLabel control={<Switch checked={onlyUncounted} onChange={(e) => setOnlyUncounted(e.target.checked)} />} label={t('onlyUncounted')} />
            <FormControlLabel control={<Switch checked={onlyDiffering} onChange={(e) => setOnlyDiffering(e.target.checked)} />} label={t('onlyDiffering')} />
            <Typography variant="body2" color="text.secondary">
              {visible.length} / {st.lines?.length ?? 0}
            </Typography>
          </Stack>

          <GlassTable columns={columns} rows={visible} rowKey={(l) => l.id} emptyText={t('noLines')} maxHeight="65vh" />
        </>
      )}

      <ConfirmDialog
        open={confirmFinalize}
        title={t('finalize')}
        message={
          summary
            ? t('finalizeConfirm', { counted: summary.counted, lines: summary.lines, uncounted: summary.lines - summary.counted })
            : ''
        }
        color="warning"
        loading={finalize.isPending}
        onClose={() => setConfirmFinalize(false)}
        onConfirm={() =>
          finalize.mutate(undefined, {
            onSuccess: () => {
              toast.success(t('finalized'));
              setConfirmFinalize(false);
            },
            onError: (err) => toast.error(errorMessage(err)),
          })
        }
      />
    </Stack>
  );
}
