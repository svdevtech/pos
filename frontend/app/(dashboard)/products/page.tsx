'use client';

import AddIcon from '@mui/icons-material/Add';
import ArchiveIcon from '@mui/icons-material/Archive';
import CategoryIcon from '@mui/icons-material/Category';
import EditIcon from '@mui/icons-material/Edit';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import UnarchiveIcon from '@mui/icons-material/Unarchive';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { GridColDef } from '@mui/x-data-grid';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import PageHeader from '@/components/PageHeader';
import { useSession } from '@/components/Providers';
import QueryError from '@/components/QueryError';
import ServerDataGrid from '@/components/ServerDataGrid';
import { useToast } from '@/components/Toast';
import { GlassButton, GlassInput } from '@/components/glass';
import { resolveLocale } from '@/i18n/config';
import { useApiErrorMessage } from '@/lib/api/errors';
import { num } from '@/lib/api/hooks/common';
import {
  useArchiveProduct,
  useCategories,
  useProducts,
  useRestoreProduct,
  type Product,
  type ProductListParams,
} from '@/lib/api/hooks/products';
import { MUTATING_ROLES } from '@/lib/auth/session';
import { formatMoney, formatQty } from '@/lib/format';
import { useDebounce } from '@/lib/useDebounce';

type ActiveFilter = '' | 'true' | 'false';
type ArchivedFilter = 'false' | 'true' | 'all';

export default function ProductsPage() {
  const t = useTranslations('products');
  const tc = useTranslations('common');
  const locale = resolveLocale(useLocale());
  const router = useRouter();
  const toast = useToast();
  const errorMessage = useApiErrorMessage();
  const { hasRole } = useSession();
  const canMutate = hasRole(...MUTATING_ROLES);

  const [q, setQ] = useState('');
  const debouncedQ = useDebounce(q);
  const [categoryId, setCategoryId] = useState('');
  const [active, setActive] = useState<ActiveFilter>('');
  const [archived, setArchived] = useState<ArchivedFilter>('false');
  const [lowStock, setLowStock] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [archiving, setArchiving] = useState<Product | null>(null);

  const params: ProductListParams = useMemo(
    () => ({ q: debouncedQ, category_id: categoryId, active, archived, low_stock: lowStock, page, page_size: pageSize }),
    [debouncedQ, categoryId, active, archived, lowStock, page, pageSize],
  );
  const products = useProducts(params);
  const categories = useCategories();
  const archive = useArchiveProduct();
  const restore = useRestoreProduct();

  const categoryName = (c: { name: string; name_en?: string }) => (locale === 'en' && c.name_en ? c.name_en : c.name);

  const columns = useMemo<GridColDef<Product>[]>(() => {
    const cols: GridColDef<Product>[] = [
      { field: 'sku', headerName: t('sku'), width: 130 },
      {
        field: 'name',
        headerName: t('name'),
        flex: 1,
        minWidth: 200,
        renderCell: ({ row }) => (
          <Stack sx={{ minWidth: 0, py: 0.5 }}>
            <Typography variant="body2" noWrap>
              {locale === 'en' && row.name_en ? row.name_en : row.name}
            </Typography>
            {row.is_archived ? (
              <Chip size="small" label={t('archived')} sx={{ width: 'fit-content', height: 18, fontSize: 11 }} />
            ) : !row.is_active ? (
              <Chip size="small" label={tc('inactive')} sx={{ width: 'fit-content', height: 18, fontSize: 11 }} />
            ) : null}
          </Stack>
        ),
      },
      { field: 'category_name', headerName: t('category'), width: 150 },
      { field: 'unit_name', headerName: t('unit'), width: 100 },
      {
        field: 'sell_price',
        headerName: t('price'),
        width: 120,
        align: 'right',
        headerAlign: 'right',
        valueFormatter: (v) => formatMoney(v as string, locale),
      },
      {
        field: 'cost_avg',
        headerName: t('cost'),
        width: 120,
        align: 'right',
        headerAlign: 'right',
        valueFormatter: (v) => formatMoney(v as string, locale),
      },
      {
        field: 'stock_on_hand',
        headerName: t('stock'),
        width: 110,
        align: 'right',
        headerAlign: 'right',
        renderCell: ({ row }) => {
          const low = num(row.stock_on_hand) <= num(row.min_level1);
          return (
            <Typography variant="body2" fontWeight={low ? 700 : 400} color={low ? 'error.main' : 'text.primary'}>
              {formatQty(row.stock_on_hand, locale)}
            </Typography>
          );
        },
      },
      {
        field: 'barcodes',
        headerName: t('barcodes'),
        width: 100,
        align: 'center',
        headerAlign: 'center',
        sortable: false,
        valueGetter: (_v, row) => row.barcodes?.length ?? 0,
      },
    ];
    cols.push({
      field: 'actions',
      headerName: tc('actions'),
      width: canMutate ? 110 : 70,
      sortable: false,
      align: 'right',
      headerAlign: 'right',
      renderCell: ({ row }) => (
        <Stack direction="row" spacing={0.5} onClick={(e) => e.stopPropagation()}>
          <Tooltip title={canMutate ? tc('edit') : t('view')}>
            <IconButton size="small" component={Link} href={`/products/${row.id}`} aria-label={tc('edit')}>
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {canMutate &&
            (row.is_archived ? (
              <Tooltip title={t('restore')}>
                <IconButton
                  size="small"
                  aria-label={t('restore')}
                  onClick={() =>
                    restore.mutate(row.id, {
                      onSuccess: () => toast.success(t('restored')),
                      onError: (err) => toast.error(errorMessage(err)),
                    })
                  }
                >
                  <UnarchiveIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : (
              <Tooltip title={t('archive')}>
                <IconButton size="small" aria-label={t('archive')} onClick={() => setArchiving(row)}>
                  <ArchiveIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ))}
        </Stack>
      ),
    });
    return cols;
  }, [t, tc, locale, canMutate, restore, toast, errorMessage]);

  const resetPage = () => setPage(1);

  return (
    <Stack spacing={3}>
      <PageHeader
        title={t('title')}
        subtitle={products.data ? t('count', { count: products.data.total }) : undefined}
        actions={
          <>
            <GlassButton variant="outlined" startIcon={<CategoryIcon />} component={Link} href="/products/categories">
              {t('categories')}
            </GlassButton>
            <GlassButton variant="outlined" startIcon={<QrCode2Icon />} component={Link} href="/products/labels">
              {t('labels')}
            </GlassButton>
            {canMutate && (
              <GlassButton startIcon={<AddIcon />} component={Link} href="/products/new">
                {t('addProduct')}
              </GlassButton>
            )}
          </>
        }
      />

      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
        <GlassInput
          size="small"
          label={t('search')}
          placeholder={t('searchHint')}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            resetPage();
          }}
          sx={{ minWidth: 260, flex: 1 }}
          fullWidth={false}
        />
        <GlassInput
          select
          size="small"
          label={t('category')}
          value={categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value);
            resetPage();
          }}
          sx={{ minWidth: 180 }}
          fullWidth={false}
          SelectProps={{ displayEmpty: true }}
          InputLabelProps={{ shrink: true }}
        >
          <MenuItem value="">{tc('all')}</MenuItem>
          {(categories.data ?? []).map((c) => (
            <MenuItem key={c.id} value={c.id}>
              {categoryName(c)}
            </MenuItem>
          ))}
        </GlassInput>
        <GlassInput
          select
          size="small"
          label={tc('status')}
          value={active}
          onChange={(e) => {
            setActive(e.target.value as ActiveFilter);
            resetPage();
          }}
          sx={{ minWidth: 150 }}
          fullWidth={false}
          SelectProps={{ displayEmpty: true }}
          InputLabelProps={{ shrink: true }}
        >
          <MenuItem value="">{tc('all')}</MenuItem>
          <MenuItem value="true">{tc('active')}</MenuItem>
          <MenuItem value="false">{tc('inactive')}</MenuItem>
        </GlassInput>
        <GlassInput
          select
          size="small"
          label={t('archiveFilter')}
          value={archived}
          onChange={(e) => {
            setArchived(e.target.value as ArchivedFilter);
            resetPage();
          }}
          sx={{ minWidth: 150 }}
          fullWidth={false}
        >
          <MenuItem value="false">{t('current')}</MenuItem>
          <MenuItem value="true">{t('archived')}</MenuItem>
          <MenuItem value="all">{tc('all')}</MenuItem>
        </GlassInput>
        <FormControlLabel
          control={
            <Switch
              checked={lowStock}
              onChange={(e) => {
                setLowStock(e.target.checked);
                resetPage();
              }}
            />
          }
          label={t('lowStockOnly')}
        />
      </Stack>

      <QueryError error={products.error} onRetry={() => products.refetch()} />

      <ServerDataGrid<Product>
        rows={products.data?.items ?? []}
        columns={columns}
        rowCount={products.data?.total ?? 0}
        loading={products.isPending || products.isFetching}
        page={page}
        pageSize={pageSize}
        onPageChange={(p, s) => {
          setPage(p);
          setPageSize(s);
        }}
        emptyText={t('noProducts')}
        getRowClassName={() => 'row-clickable'}
        onRowClick={({ row }) => router.push(`/products/${row.id}`)}
      />

      <ConfirmDialog
        open={Boolean(archiving)}
        title={t('archive')}
        message={archiving ? t('archiveConfirm', { name: archiving.name }) : ''}
        color="warning"
        loading={archive.isPending}
        onClose={() => setArchiving(null)}
        onConfirm={() => {
          if (!archiving) return;
          archive.mutate(archiving.id, {
            onSuccess: () => {
              toast.success(t('archived'));
              setArchiving(null);
            },
            onError: (err) => toast.error(errorMessage(err)),
          });
        }}
      />
    </Stack>
  );
}
