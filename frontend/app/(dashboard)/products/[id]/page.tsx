'use client';

import ArchiveIcon from '@mui/icons-material/Archive';
import DeleteIcon from '@mui/icons-material/Delete';
import UnarchiveIcon from '@mui/icons-material/Unarchive';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import Barcode from '@/components/Barcode';
import ConfirmDialog from '@/components/ConfirmDialog';
import MoneyField from '@/components/MoneyField';
import PageHeader from '@/components/PageHeader';
import { useSession } from '@/components/Providers';
import QueryError from '@/components/QueryError';
import { useToast } from '@/components/Toast';
import { GlassButton, GlassCard, GlassInput, GlassTable, type GlassColumn } from '@/components/glass';
import MovementsGrid from '@/components/inventory/MovementsGrid';
import ProductForm, { toProductInput } from '@/components/products/ProductForm';
import { resolveLocale } from '@/i18n/config';
import { useApiErrorMessage } from '@/lib/api/errors';
import { num } from '@/lib/api/hooks/common';
import {
  useAddBarcode,
  useArchiveProduct,
  useDeleteBarcode,
  useProduct,
  useRestoreProduct,
  useUpdateProduct,
  type Product,
  type ProductBarcode,
} from '@/lib/api/hooks/products';
import { MUTATING_ROLES } from '@/lib/auth/session';
import { formatDateTime, formatMoney, formatQty } from '@/lib/format';

type TabKey = 'details' | 'barcodes' | 'movements';

function BarcodesPanel({ product, canMutate }: { product: Product; canMutate: boolean }) {
  const t = useTranslations('products');
  const tc = useTranslations('common');
  const locale = resolveLocale(useLocale());
  const toast = useToast();
  const errorMessage = useApiErrorMessage();
  const add = useAddBarcode(product.id);
  const remove = useDeleteBarcode(product.id);
  const [code, setCode] = useState('');
  const [packQty, setPackQty] = useState('1');
  const [isPrimary, setIsPrimary] = useState(false);
  const [deleting, setDeleting] = useState<ProductBarcode | null>(null);

  const submit = () => {
    const barcode = code.trim();
    if (!barcode) return;
    add.mutate(
      { barcode, is_primary: isPrimary, pack_qty: packQty === '' ? undefined : num(packQty).toFixed(3) },
      {
        onSuccess: () => {
          toast.success(t('barcodeAdded'));
          setCode('');
          setPackQty('1');
          setIsPrimary(false);
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  const columns: GlassColumn<ProductBarcode>[] = [
    {
      key: 'barcode',
      label: t('barcode'),
      render: (b) => (
        <Stack direction="row" spacing={2} alignItems="center">
          <Box sx={{ width: 140, bgcolor: '#fff', borderRadius: 1, p: 0.5 }}>
            <Barcode value={b.barcode} height={28} fontSize={9} />
          </Box>
          <Typography variant="body2" fontFamily="monospace">
            {b.barcode}
          </Typography>
          {b.is_primary && <Chip size="small" color="primary" label={t('primary')} />}
        </Stack>
      ),
    },
    { key: 'pack_qty', label: t('packQty'), align: 'right', width: 120, render: (b) => formatQty(b.pack_qty, locale) },
    { key: 'created_at', label: tc('createdAt'), width: 170, render: (b) => formatDateTime(b.created_at, locale) },
    ...(canMutate
      ? [
          {
            key: 'actions',
            label: tc('actions'),
            align: 'right' as const,
            width: 80,
            render: (b: ProductBarcode) => (
              <IconButton size="small" aria-label={tc('delete')} onClick={() => setDeleting(b)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            ),
          },
        ]
      : []),
  ];

  return (
    <Stack spacing={2}>
      {canMutate && (
        <GlassCard title={t('addBarcode')}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'flex-start' }}>
            <GlassInput
              label={t('barcode')}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submit();
                }
              }}
              inputProps={{ inputMode: 'numeric' }}
              autoComplete="off"
            />
            <MoneyField
              label={t('packQty')}
              value={packQty}
              onChange={setPackQty}
              currency={false}
              decimals={3}
              helperText={t('packQtyHint')}
              sx={{ maxWidth: { sm: 180 } }}
            />
            <FormControlLabel
              control={<Switch checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />}
              label={t('primary')}
              sx={{ whiteSpace: 'nowrap', pt: 1 }}
            />
            <GlassButton onClick={submit} loading={add.isPending} disabled={!code.trim()} sx={{ mt: { sm: 1 } }}>
              {tc('add')}
            </GlassButton>
          </Stack>
        </GlassCard>
      )}
      <GlassTable columns={columns} rows={product.barcodes ?? []} rowKey={(b) => b.id} emptyText={t('noBarcodes')} />
      <ConfirmDialog
        open={Boolean(deleting)}
        title={t('deleteBarcode')}
        message={deleting ? t('deleteBarcodeConfirm', { barcode: deleting.barcode }) : ''}
        color="error"
        loading={remove.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success(tc('deleted'));
              setDeleting(null);
            },
            onError: (err) => toast.error(errorMessage(err)),
          });
        }}
      />
    </Stack>
  );
}

export default function ProductDetailPage() {
  const t = useTranslations('products');
  const tc = useTranslations('common');
  const locale = resolveLocale(useLocale());
  const router = useRouter();
  const toast = useToast();
  const errorMessage = useApiErrorMessage();
  const { hasRole } = useSession();
  const canMutate = hasRole(...MUTATING_ROLES);
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';

  const product = useProduct(id);
  const update = useUpdateProduct(id);
  const archive = useArchiveProduct();
  const restore = useRestoreProduct();
  const [tab, setTab] = useState<TabKey>('details');
  const [confirmArchive, setConfirmArchive] = useState(false);

  const p = product.data;
  const displayName = p ? (locale === 'en' && p.name_en ? p.name_en : p.name) : '';
  const low = p ? num(p.stock_on_hand) <= num(p.min_level1) : false;
  const critical = p ? num(p.stock_on_hand) <= num(p.min_level2) : false;
  const movementFilter = useMemo(() => ({ product_id: id }), [id]);

  return (
    <Stack spacing={3}>
      <PageHeader
        title={p ? `${p.sku} · ${displayName}` : t('editProduct')}
        subtitle={p?.category_name}
        backHref="/products"
        loading={product.isPending}
        actions={
          canMutate && p ? (
            p.is_archived ? (
              <GlassButton
                variant="outlined"
                startIcon={<UnarchiveIcon />}
                loading={restore.isPending}
                onClick={() =>
                  restore.mutate(id, {
                    onSuccess: () => toast.success(t('restored')),
                    onError: (err) => toast.error(errorMessage(err)),
                  })
                }
              >
                {t('restore')}
              </GlassButton>
            ) : (
              <GlassButton variant="outlined" color="warning" startIcon={<ArchiveIcon />} onClick={() => setConfirmArchive(true)}>
                {t('archive')}
              </GlassButton>
            )
          ) : undefined
        }
      />

      <QueryError error={product.error} onRetry={() => product.refetch()} />

      {product.isPending && <Skeleton variant="rounded" height={320} />}

      {p && (
        <>
          {p.is_archived && (
            <Alert severity="warning">
              {t('archivedNotice', { at: formatDateTime(p.archived_at, locale) })}
            </Alert>
          )}
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
            <Chip
              label={`${t('stock')}: ${formatQty(p.stock_on_hand, locale)} ${p.unit_name ?? ''}`}
              color={critical ? 'error' : low ? 'warning' : 'success'}
              variant="outlined"
            />
            <Chip label={`${t('price')}: ${formatMoney(p.sell_price, locale)}`} variant="outlined" />
            <Chip label={`${t('costAvg')}: ${formatMoney(p.cost_avg, locale)}`} variant="outlined" />
            {p.primary_barcode && <Chip label={`${t('barcode')}: ${p.primary_barcode}`} variant="outlined" />}
            <Chip label={p.is_active ? tc('active') : tc('inactive')} color={p.is_active ? 'success' : 'default'} size="medium" />
          </Stack>

          <Tabs value={tab} onChange={(_, v: TabKey) => setTab(v)} variant="scrollable" allowScrollButtonsMobile>
            <Tab value="details" label={t('details')} />
            <Tab value="barcodes" label={`${t('barcodes')} (${p.barcodes?.length ?? 0})`} />
            <Tab value="movements" label={t('movements')} />
          </Tabs>

          {tab === 'details' && (
            <Box sx={{ maxWidth: 980 }}>
              <ProductForm
                mode="edit"
                product={p}
                readOnly={!canMutate || p.is_archived}
                submitting={update.isPending}
                error={update.error}
                onCancel={() => router.push('/products')}
                onSubmit={(values) =>
                  update.mutate(toProductInput(values, 'edit'), {
                    onSuccess: () => toast.success(tc('saved')),
                  })
                }
              />
            </Box>
          )}
          {tab === 'barcodes' && <BarcodesPanel product={p} canMutate={canMutate && !p.is_archived} />}
          {tab === 'movements' && <MovementsGrid filter={movementFilter} hideProduct />}
        </>
      )}

      <ConfirmDialog
        open={confirmArchive}
        title={t('archive')}
        message={p ? t('archiveConfirm', { name: p.name }) : ''}
        color="warning"
        loading={archive.isPending}
        onClose={() => setConfirmArchive(false)}
        onConfirm={() =>
          archive.mutate(id, {
            onSuccess: () => {
              toast.success(t('archived'));
              setConfirmArchive(false);
            },
            onError: (err) => toast.error(errorMessage(err)),
          })
        }
      />
    </Stack>
  );
}
