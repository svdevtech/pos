'use client';

import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import dayjs from 'dayjs';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import MoneyField from '@/components/MoneyField';
import PageHeader from '@/components/PageHeader';
import ProductAutocomplete from '@/components/ProductAutocomplete';
import { useSession } from '@/components/Providers';
import QueryError from '@/components/QueryError';
import { useToast } from '@/components/Toast';
import { GlassButton, GlassDialog, GlassInput, GlassTable, type GlassColumn } from '@/components/glass';
import { resolveLocale } from '@/i18n/config';
import { useApiErrorMessage } from '@/lib/api/errors';
import { decStr, num } from '@/lib/api/hooks/common';
import type { Product } from '@/lib/api/hooks/products';
import {
  useCreatePromotion,
  useDeletePromotion,
  usePromotions,
  useUpdatePromotion,
  type DiscountType,
  type PromoScope,
  type Promotion,
  type PromotionInput,
} from '@/lib/api/hooks/promotions';
import { MUTATING_ROLES } from '@/lib/auth/session';
import { localDateTimeToRfc3339 } from '@/lib/dates';
import { formatDateTime, formatMoney, formatQty } from '@/lib/format';

const toLocalInput = (iso: string | null | undefined) => (iso ? dayjs(iso).format('YYYY-MM-DDTHH:mm') : '');

function PromotionDialog({ open, promotion, onClose, onSaved }: { open: boolean; promotion: Promotion | null; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations('promotions');
  const tc = useTranslations('common');
  const errorMessage = useApiErrorMessage();
  const create = useCreatePromotion();
  const update = useUpdatePromotion();
  const [name, setName] = useState('');
  const [scope, setScope] = useState<PromoScope>('bill');
  const [product, setProduct] = useState<Product | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [minQty, setMinQty] = useState('0');
  const [minAmount, setMinAmount] = useState('0');
  const [discountType, setDiscountType] = useState<DiscountType>('amount');
  const [discountValue, setDiscountValue] = useState('0');
  const [freeQty, setFreeQty] = useState('0');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setName(promotion?.name ?? '');
    setScope((promotion?.scope as PromoScope) ?? 'bill');
    setProduct(null);
    setProductId(promotion?.product_id ?? null);
    setMinQty(String(num(promotion?.min_qty)));
    setMinAmount(String(num(promotion?.min_amount)));
    setDiscountType((promotion?.discount_type as DiscountType) ?? 'amount');
    setDiscountValue(String(num(promotion?.discount_value)));
    setFreeQty(String(num(promotion?.free_qty)));
    setStartsAt(toLocalInput(promotion?.starts_at));
    setEndsAt(toLocalInput(promotion?.ends_at));
    setIsActive(promotion?.is_active ?? true);
  }, [open, promotion]);

  const pending = create.isPending || update.isPending;
  const effectiveProductId = product?.id ?? productId;
  const valid = name.trim() !== '' && (scope === 'bill' || Boolean(effectiveProductId)) && (num(discountValue) > 0 || num(freeQty) > 0);

  const submit = () => {
    setFormError(null);
    const body: PromotionInput = {
      name: name.trim(),
      scope,
      product_id: scope === 'product' ? effectiveProductId : null,
      min_qty: decStr(minQty, 3),
      min_amount: decStr(minAmount),
      discount_type: discountType,
      discount_value: decStr(discountValue),
      free_qty: decStr(freeQty, 3),
      starts_at: localDateTimeToRfc3339(startsAt),
      ends_at: localDateTimeToRfc3339(endsAt),
      is_active: isActive,
    };
    const opts = { onSuccess: () => onSaved(), onError: (err: unknown) => setFormError(errorMessage(err)) };
    if (promotion) update.mutate({ id: promotion.id, ...body }, opts);
    else create.mutate(body, opts);
  };

  return (
    <GlassDialog
      open={open}
      onClose={onClose}
      busy={pending}
      title={promotion ? t('editPromotion') : t('addPromotion')}
      actions={
        <>
          <GlassButton variant="outlined" onClick={onClose} disabled={pending}>
            {tc('cancel')}
          </GlassButton>
          <GlassButton onClick={submit} loading={pending} disabled={!valid}>
            {tc('save')}
          </GlassButton>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        {formError && <Alert severity="error">{formError}</Alert>}
        <GlassInput label={t('name')} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <GlassInput select label={t('scope')} value={scope} onChange={(e) => setScope(e.target.value as PromoScope)}>
            <MenuItem value="bill">{t('scopes.bill')}</MenuItem>
            <MenuItem value="product">{t('scopes.product')}</MenuItem>
          </GlassInput>
          <FormControlLabel control={<Switch checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />} label={t('isActive')} sx={{ whiteSpace: 'nowrap' }} />
        </Stack>
        {scope === 'product' && (
          <Stack spacing={0.5}>
            <ProductAutocomplete value={product} onChange={setProduct} label={t('product')} error={!effectiveProductId} helperText={!effectiveProductId ? t('productRequired') : undefined} />
            {!product && promotion?.product_name && (
              <Typography variant="caption" color="text.secondary">
                {t('currentProduct')}: {promotion.product_name}
              </Typography>
            )}
          </Stack>
        )}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <MoneyField label={t('minQty')} value={minQty} onChange={setMinQty} currency={false} decimals={3} />
          <MoneyField label={t('minAmount')} value={minAmount} onChange={setMinAmount} />
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <GlassInput select label={t('discountType')} value={discountType} onChange={(e) => setDiscountType(e.target.value as DiscountType)}>
            <MenuItem value="amount">{t('discountTypes.amount')}</MenuItem>
            <MenuItem value="percent">{t('discountTypes.percent')}</MenuItem>
          </GlassInput>
          <MoneyField label={t('discountValue')} value={discountValue} onChange={setDiscountValue} currency={discountType === 'amount'} suffix={discountType === 'percent' ? '%' : undefined} />
          <MoneyField label={t('freeQty')} value={freeQty} onChange={setFreeQty} currency={false} decimals={3} />
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <GlassInput type="datetime-local" label={t('startsAt')} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} InputLabelProps={{ shrink: true }} />
          <GlassInput type="datetime-local" label={t('endsAt')} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} InputLabelProps={{ shrink: true }} />
        </Stack>
      </Stack>
    </GlassDialog>
  );
}

export default function PromotionsPage() {
  const t = useTranslations('promotions');
  const tc = useTranslations('common');
  const locale = resolveLocale(useLocale());
  const toast = useToast();
  const errorMessage = useApiErrorMessage();
  const { hasRole } = useSession();
  const canMutate = hasRole(...MUTATING_ROLES);
  const [activeOnly, setActiveOnly] = useState(false);
  const promotions = usePromotions(activeOnly);
  const remove = useDeletePromotion();
  const [dialog, setDialog] = useState<{ open: boolean; promotion: Promotion | null }>({ open: false, promotion: null });
  const [deleting, setDeleting] = useState<Promotion | null>(null);

  const describe = (p: Promotion) => {
    const parts: string[] = [];
    if (num(p.discount_value) > 0) parts.push(p.discount_type === 'percent' ? `-${formatQty(p.discount_value, locale)}%` : `-${formatMoney(p.discount_value, locale)}`);
    if (num(p.free_qty) > 0) parts.push(`${t('freeQty')} ${formatQty(p.free_qty, locale)}`);
    return parts.join(' · ');
  };
  const condition = (p: Promotion) => {
    const parts: string[] = [];
    if (num(p.min_qty) > 0) parts.push(`${t('minQty')} ≥ ${formatQty(p.min_qty, locale)}`);
    if (num(p.min_amount) > 0) parts.push(`${t('minAmount')} ≥ ${formatMoney(p.min_amount, locale)}`);
    return parts.join(' · ') || '-';
  };

  const columns: GlassColumn<Promotion>[] = [
    {
      key: 'name',
      label: t('name'),
      render: (p) => (
        <Stack sx={{ minWidth: 0 }}>
          <Typography variant="body2" fontWeight={600} noWrap>
            {p.name}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            {p.scope === 'product' ? p.product_name || t('scopes.product') : t('scopes.bill')}
          </Typography>
        </Stack>
      ),
    },
    { key: 'condition', label: t('condition'), render: condition },
    { key: 'discount', label: t('discount'), width: 180, render: describe },
    {
      key: 'period',
      label: t('period'),
      width: 260,
      render: (p) => (p.starts_at || p.ends_at ? `${p.starts_at ? formatDateTime(p.starts_at, locale) : '…'} – ${p.ends_at ? formatDateTime(p.ends_at, locale) : '…'}` : t('noPeriod')),
    },
    {
      key: 'is_active',
      label: tc('status'),
      width: 110,
      render: (p) => <Chip size="small" color={p.is_active ? 'success' : 'default'} label={p.is_active ? tc('active') : tc('inactive')} />,
    },
    ...(canMutate
      ? [
          {
            key: 'actions',
            label: tc('actions'),
            align: 'right' as const,
            width: 100,
            render: (p: Promotion) => (
              <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                <IconButton size="small" aria-label={tc('edit')} onClick={() => setDialog({ open: true, promotion: p })}>
                  <EditIcon fontSize="small" />
                </IconButton>
                <IconButton size="small" aria-label={tc('delete')} onClick={() => setDeleting(p)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Stack>
            ),
          },
        ]
      : []),
  ];

  return (
    <Stack spacing={3}>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          canMutate ? (
            <GlassButton startIcon={<AddIcon />} onClick={() => setDialog({ open: true, promotion: null })}>
              {t('addPromotion')}
            </GlassButton>
          ) : undefined
        }
      />
      <FormControlLabel control={<Switch checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />} label={t('activeOnly')} />
      <QueryError error={promotions.error} onRetry={() => promotions.refetch()} />
      <GlassTable columns={columns} rows={promotions.data ?? []} rowKey={(p) => p.id} loading={promotions.isPending} emptyText={t('noPromotions')} />
      <PromotionDialog
        open={dialog.open}
        promotion={dialog.promotion}
        onClose={() => setDialog((d) => ({ ...d, open: false }))}
        onSaved={() => {
          setDialog((d) => ({ ...d, open: false }));
          toast.success(tc('saved'));
        }}
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        title={tc('delete')}
        message={deleting ? t('deleteConfirm', { name: deleting.name }) : ''}
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
