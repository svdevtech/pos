'use client';

import Typography from '@mui/material/Typography';
import type { GridColDef } from '@mui/x-data-grid';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import QueryError from '@/components/QueryError';
import ServerDataGrid from '@/components/ServerDataGrid';
import { resolveLocale } from '@/i18n/config';
import { num } from '@/lib/api/hooks/common';
import { useMovements, type MovementParams, type StockMove } from '@/lib/api/hooks/inventory';
import { formatDateTime, formatMoney, formatQty } from '@/lib/format';

export interface MovementsGridProps {
  /** Filters other than paging. */
  filter: Omit<MovementParams, 'page' | 'page_size'>;
  /** Hide the product columns when the grid is scoped to one product. */
  hideProduct?: boolean;
}

/** Paged stock-movement ledger (`GET /inventory/movements`). */
export default function MovementsGrid({ filter, hideProduct = false }: MovementsGridProps) {
  const t = useTranslations('inventory');
  const locale = resolveLocale(useLocale());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const params = useMemo<MovementParams>(() => ({ ...filter, page, page_size: pageSize }), [filter, page, pageSize]);
  const movements = useMovements(params);

  const columns = useMemo<GridColDef<StockMove>[]>(() => {
    const cols: GridColDef<StockMove>[] = [
      {
        field: 'occurred_at',
        headerName: t('occurredAt'),
        width: 160,
        valueFormatter: (v) => formatDateTime(v as string, locale),
      },
    ];
    if (!hideProduct) {
      cols.push(
        { field: 'sku', headerName: t('sku'), width: 120 },
        { field: 'product_name', headerName: t('product'), flex: 1, minWidth: 180 },
      );
    }
    cols.push(
      {
        field: 'move_type',
        headerName: t('type'),
        width: 140,
        valueFormatter: (v) => (t.has(`moveTypes.${v as string}`) ? t(`moveTypes.${v as string}`) : (v as string)),
      },
      {
        field: 'qty_delta',
        headerName: t('qtyDelta'),
        width: 110,
        align: 'right',
        headerAlign: 'right',
        renderCell: ({ value }) => {
          const n = num(value as string);
          return (
            <Typography variant="body2" color={n < 0 ? 'error.main' : n > 0 ? 'success.main' : 'text.primary'} fontWeight={600}>
              {n > 0 ? '+' : ''}
              {formatQty(n, locale)}
            </Typography>
          );
        },
      },
      {
        field: 'unit_cost',
        headerName: t('unitCost'),
        width: 110,
        align: 'right',
        headerAlign: 'right',
        valueFormatter: (v) => (v === null || v === undefined ? '-' : formatMoney(v as string, locale)),
      },
      {
        field: 'balance_after',
        headerName: t('balanceAfter'),
        width: 110,
        align: 'right',
        headerAlign: 'right',
        valueFormatter: (v) => formatQty(v as string, locale),
      },
      {
        field: 'ref_type',
        headerName: t('reference'),
        width: 150,
        valueFormatter: (v) => (v ? (t.has(`refTypes.${v as string}`) ? t(`refTypes.${v as string}`) : (v as string)) : ''),
      },
      { field: 'note', headerName: t('note'), flex: 1, minWidth: 160, sortable: false },
    );
    return cols;
  }, [t, locale, hideProduct]);

  return (
    <>
      <QueryError error={movements.error} onRetry={() => movements.refetch()} />
      <ServerDataGrid<StockMove>
        rows={movements.data?.items ?? []}
        columns={columns}
        rowCount={movements.data?.total ?? 0}
        loading={movements.isPending || movements.isFetching}
        page={page}
        pageSize={pageSize}
        onPageChange={(p, s) => {
          setPage(p);
          setPageSize(s);
        }}
        emptyText={t('noMovements')}
        getRowId={(r) => r.id}
      />
    </>
  );
}
