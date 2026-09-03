'use client';

import AddIcon from '@mui/icons-material/Add';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import type { GridColDef } from '@mui/x-data-grid';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import PageHeader from '@/components/PageHeader';
import { useSession } from '@/components/Providers';
import QueryError from '@/components/QueryError';
import ServerDataGrid from '@/components/ServerDataGrid';
import { GlassButton } from '@/components/glass';
import { resolveLocale } from '@/i18n/config';
import { useStockTakes, type StockTake } from '@/lib/api/hooks/inventory';
import { MUTATING_ROLES } from '@/lib/auth/session';
import { formatDateTime } from '@/lib/format';

const STATUS_COLOR: Record<string, 'success' | 'default' | 'error' | 'warning' | 'info'> = {
  open: 'info',
  finalized: 'success',
  cancelled: 'error',
};

export default function StockTakesPage() {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const locale = resolveLocale(useLocale());
  const router = useRouter();
  const { hasRole } = useSession();
  const canMutate = hasRole(...MUTATING_ROLES);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const params = useMemo(() => ({ page, page_size: pageSize }), [page, pageSize]);
  const takes = useStockTakes(params);

  const columns = useMemo<GridColDef<StockTake>[]>(
    () => [
      { field: 'doc_no', headerName: t('docNo'), width: 150 },
      {
        field: 'status',
        headerName: tc('status'),
        width: 130,
        renderCell: ({ value }) => (
          <Chip size="small" color={STATUS_COLOR[value as string] ?? 'default'} label={t.has(`statuses.${value}`) ? t(`statuses.${value}`) : String(value)} />
        ),
      },
      { field: 'started_at', headerName: t('startedAt'), width: 160, valueFormatter: (v) => formatDateTime(v as string, locale) },
      { field: 'finalized_at', headerName: t('finalizedAt'), width: 160, valueFormatter: (v) => (v ? formatDateTime(v as string, locale) : '-') },
      { field: 'line_count', headerName: t('lineCount'), width: 110, align: 'right', headerAlign: 'right' },
      { field: 'note', headerName: tc('notes'), flex: 1, minWidth: 200, sortable: false },
    ],
    [t, tc, locale],
  );

  return (
    <Stack spacing={3}>
      <PageHeader
        title={t('stockTakes')}
        subtitle={t('stockTakesDesc')}
        backHref="/inventory"
        actions={
          canMutate ? (
            <GlassButton startIcon={<AddIcon />} component={Link} href="/inventory/stock-takes/new">
              {t('newStockTake')}
            </GlassButton>
          ) : undefined
        }
      />
      <QueryError error={takes.error} onRetry={() => takes.refetch()} />
      <ServerDataGrid<StockTake>
        rows={takes.data?.items ?? []}
        columns={columns}
        rowCount={takes.data?.total ?? 0}
        loading={takes.isPending || takes.isFetching}
        page={page}
        pageSize={pageSize}
        onPageChange={(p, s) => {
          setPage(p);
          setPageSize(s);
        }}
        emptyText={t('noStockTakes')}
        getRowClassName={() => 'row-clickable'}
        onRowClick={({ row }) => router.push(`/inventory/stock-takes/${row.id}`)}
      />
    </Stack>
  );
}
