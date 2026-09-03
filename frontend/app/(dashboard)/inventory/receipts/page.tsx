'use client';

import AddIcon from '@mui/icons-material/Add';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import type { GridColDef } from '@mui/x-data-grid';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import DateRangeFilter, { type DateRange } from '@/components/DateRangeFilter';
import PageHeader from '@/components/PageHeader';
import { useSession } from '@/components/Providers';
import QueryError from '@/components/QueryError';
import ServerDataGrid from '@/components/ServerDataGrid';
import { GlassButton, GlassInput } from '@/components/glass';
import { resolveLocale } from '@/i18n/config';
import { useReceipts, type PurchaseReceipt, type ReceiptParams } from '@/lib/api/hooks/inventory';
import { useSuppliers } from '@/lib/api/hooks/products';
import { MUTATING_ROLES } from '@/lib/auth/session';
import { nextDay } from '@/lib/dates';
import { formatDateTime, formatMoney } from '@/lib/format';

const STATUS_COLOR: Record<string, 'success' | 'default' | 'error' | 'warning'> = {
  posted: 'success',
  draft: 'warning',
  cancelled: 'error',
};

export default function ReceiptsPage() {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const locale = resolveLocale(useLocale());
  const router = useRouter();
  const { hasRole } = useSession();
  const canMutate = hasRole(...MUTATING_ROLES);

  const [range, setRange] = useState<DateRange>({ from: '', to: '' });
  const [supplierId, setSupplierId] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const params = useMemo<ReceiptParams>(
    () => ({ from: range.from || undefined, to: nextDay(range.to) || undefined, supplier_id: supplierId || undefined, page, page_size: pageSize }),
    [range, supplierId, page, pageSize],
  );
  const receipts = useReceipts(params);
  const suppliers = useSuppliers();

  const columns = useMemo<GridColDef<PurchaseReceipt>[]>(
    () => [
      { field: 'doc_no', headerName: t('docNo'), width: 150 },
      { field: 'received_at', headerName: t('receivedAt'), width: 160, valueFormatter: (v) => formatDateTime(v as string, locale) },
      { field: 'supplier_name', headerName: t('supplier'), flex: 1, minWidth: 160 },
      { field: 'supplier_ref', headerName: t('supplierRef'), width: 140 },
      { field: 'received_by_name', headerName: t('receivedBy'), width: 140 },
      {
        field: 'total',
        headerName: tc('total'),
        width: 130,
        align: 'right',
        headerAlign: 'right',
        valueFormatter: (v) => formatMoney(v as string, locale),
      },
      {
        field: 'status',
        headerName: tc('status'),
        width: 120,
        renderCell: ({ value }) => (
          <Chip size="small" color={STATUS_COLOR[value as string] ?? 'default'} label={t.has(`statuses.${value}`) ? t(`statuses.${value}`) : String(value)} />
        ),
      },
    ],
    [t, tc, locale],
  );

  return (
    <Stack spacing={3}>
      <PageHeader
        title={t('receipts')}
        subtitle={t('receiptsDesc')}
        backHref="/inventory"
        actions={
          canMutate ? (
            <GlassButton startIcon={<AddIcon />} component={Link} href="/inventory/receipts/new">
              {t('newReceipt')}
            </GlassButton>
          ) : undefined
        }
      />

      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
        <GlassInput
          select
          size="small"
          label={t('supplier')}
          value={supplierId}
          onChange={(e) => {
            setSupplierId(e.target.value);
            setPage(1);
          }}
          sx={{ minWidth: 200 }}
          fullWidth={false}
          SelectProps={{ displayEmpty: true }}
          InputLabelProps={{ shrink: true }}
        >
          <MenuItem value="">{tc('all')}</MenuItem>
          {(suppliers.data ?? []).map((s) => (
            <MenuItem key={s.id} value={s.id}>
              {s.name}
            </MenuItem>
          ))}
        </GlassInput>
        <DateRangeFilter
          value={range}
          onChange={(r) => {
            setRange(r);
            setPage(1);
          }}
        />
      </Stack>

      <QueryError error={receipts.error} onRetry={() => receipts.refetch()} />
      <ServerDataGrid<PurchaseReceipt>
        rows={receipts.data?.items ?? []}
        columns={columns}
        rowCount={receipts.data?.total ?? 0}
        loading={receipts.isPending || receipts.isFetching}
        page={page}
        pageSize={pageSize}
        onPageChange={(p, s) => {
          setPage(p);
          setPageSize(s);
        }}
        emptyText={t('noReceipts')}
        getRowClassName={() => 'row-clickable'}
        onRowClick={({ row }) => router.push(`/inventory/receipts/${row.id}`)}
      />
    </Stack>
  );
}
