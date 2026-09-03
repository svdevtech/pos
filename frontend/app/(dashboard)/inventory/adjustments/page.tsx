'use client';

import AddIcon from '@mui/icons-material/Add';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { GridColDef } from '@mui/x-data-grid';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import PageHeader from '@/components/PageHeader';
import { useSession } from '@/components/Providers';
import QueryError from '@/components/QueryError';
import ServerDataGrid from '@/components/ServerDataGrid';
import { GlassButton, GlassDialog, GlassTable, type GlassColumn } from '@/components/glass';
import { resolveLocale } from '@/i18n/config';
import { num } from '@/lib/api/hooks/common';
import { useAdjustment, useAdjustments, type AdjustmentLine, type StockAdjustment } from '@/lib/api/hooks/inventory';
import { MUTATING_ROLES } from '@/lib/auth/session';
import { formatDateTime, formatMoney, formatQty } from '@/lib/format';

function AdjustmentDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const locale = resolveLocale(useLocale());
  const adj = useAdjustment(id);
  const a = adj.data;

  const columns: GlassColumn<AdjustmentLine>[] = [
    { key: 'sku', label: t('sku'), width: 120 },
    { key: 'product_name', label: t('product') },
    {
      key: 'qty_delta',
      label: t('qtyDelta'),
      width: 110,
      align: 'right',
      render: (l) => {
        const n = num(l.qty_delta);
        return (
          <Typography variant="body2" fontWeight={600} color={n < 0 ? 'error.main' : 'success.main'}>
            {n > 0 ? '+' : ''}
            {formatQty(n, locale)}
          </Typography>
        );
      },
    },
    { key: 'unit_cost', label: t('unitCost'), width: 120, align: 'right', render: (l) => (l.unit_cost == null ? '-' : formatMoney(l.unit_cost, locale)) },
    { key: 'note', label: t('note') },
  ];

  return (
    <GlassDialog
      open={Boolean(id)}
      onClose={onClose}
      maxWidth="md"
      title={a ? `${a.doc_no} · ${t.has(`reasons.${a.reason}`) ? t(`reasons.${a.reason}`) : a.reason}` : t('adjustmentDetail')}
      actions={
        <GlassButton variant="outlined" onClick={onClose}>
          {tc('close')}
        </GlassButton>
      }
    >
      <Stack spacing={2}>
        <QueryError error={adj.error} onRetry={() => adj.refetch()} />
        {a && (
          <Typography variant="body2" color="text.secondary">
            {formatDateTime(a.adjusted_at, locale)}
            {a.note ? ` · ${a.note}` : ''}
          </Typography>
        )}
        <GlassTable columns={columns} rows={a?.lines ?? []} rowKey={(l) => l.id} loading={adj.isPending} emptyText={t('noLines')} />
      </Stack>
    </GlassDialog>
  );
}

export default function AdjustmentsPage() {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const locale = resolveLocale(useLocale());
  const { hasRole } = useSession();
  const canMutate = hasRole(...MUTATING_ROLES);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [selected, setSelected] = useState<string | null>(null);

  const params = useMemo(() => ({ page, page_size: pageSize }), [page, pageSize]);
  const adjustments = useAdjustments(params);

  const columns = useMemo<GridColDef<StockAdjustment>[]>(
    () => [
      { field: 'doc_no', headerName: t('docNo'), width: 150 },
      { field: 'adjusted_at', headerName: t('adjustedAt'), width: 160, valueFormatter: (v) => formatDateTime(v as string, locale) },
      {
        field: 'reason',
        headerName: t('reason'),
        width: 160,
        valueFormatter: (v) => (t.has(`reasons.${v as string}`) ? t(`reasons.${v as string}`) : (v as string)),
      },
      { field: 'note', headerName: tc('notes'), flex: 1, minWidth: 200, sortable: false },
    ],
    [t, tc, locale],
  );

  return (
    <Stack spacing={3}>
      <PageHeader
        title={t('adjustments')}
        subtitle={t('adjustmentsDesc')}
        backHref="/inventory"
        actions={
          canMutate ? (
            <GlassButton startIcon={<AddIcon />} component={Link} href="/inventory/adjustments/new">
              {t('newAdjustment')}
            </GlassButton>
          ) : undefined
        }
      />
      <QueryError error={adjustments.error} onRetry={() => adjustments.refetch()} />
      <ServerDataGrid<StockAdjustment>
        rows={adjustments.data?.items ?? []}
        columns={columns}
        rowCount={adjustments.data?.total ?? 0}
        loading={adjustments.isPending || adjustments.isFetching}
        page={page}
        pageSize={pageSize}
        onPageChange={(p, s) => {
          setPage(p);
          setPageSize(s);
        }}
        emptyText={t('noAdjustments')}
        getRowClassName={() => 'row-clickable'}
        onRowClick={({ row }) => setSelected(row.id)}
      />
      <AdjustmentDialog id={selected} onClose={() => setSelected(null)} />
    </Stack>
  );
}
