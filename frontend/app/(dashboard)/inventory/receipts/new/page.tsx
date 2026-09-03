'use client';

import DeleteIcon from '@mui/icons-material/Delete';
import Alert from '@mui/material/Alert';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import LookupSelect from '@/components/LookupSelect';
import MoneyField from '@/components/MoneyField';
import PageHeader from '@/components/PageHeader';
import ProductAutocomplete from '@/components/ProductAutocomplete';
import RequireAuth from '@/components/RequireAuth';
import { useToast } from '@/components/Toast';
import { GlassButton, GlassCard, GlassInput, GlassTable, type GlassColumn } from '@/components/glass';
import { resolveLocale } from '@/i18n/config';
import { useApiErrorMessage } from '@/lib/api/errors';
import { decStr, num } from '@/lib/api/hooks/common';
import { usePostReceipt } from '@/lib/api/hooks/inventory';
import { useCreateSupplier, useSuppliers, type Product } from '@/lib/api/hooks/products';
import { MUTATING_ROLES } from '@/lib/auth/session';
import { dateToRfc3339, today } from '@/lib/dates';
import { formatMoney } from '@/lib/format';

interface Line {
  product: Product;
  qty: string;
  unit_cost: string;
}

function NewReceiptContent() {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const ts = useTranslations('suppliers');
  const locale = resolveLocale(useLocale());
  const router = useRouter();
  const toast = useToast();
  const errorMessage = useApiErrorMessage();
  const post = usePostReceipt();
  const suppliers = useSuppliers();
  const createSupplier = useCreateSupplier();

  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [supplierRef, setSupplierRef] = useState('');
  const [receivedAt, setReceivedAt] = useState(today());
  const [vat, setVat] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [pick, setPick] = useState<Product | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const displayName = (p: Product) => (locale === 'en' && p.name_en ? p.name_en : p.name);

  const addLine = (p: Product | null) => {
    if (!p) return;
    setLines((prev) =>
      prev.some((l) => l.product.id === p.id) ? prev : [...prev, { product: p, qty: '1', unit_cost: String(num(p.cost_last) || num(p.cost_avg)) }],
    );
    setPick(null);
  };
  const updateLine = (id: string, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.product.id === id ? { ...l, ...patch } : l)));

  const subtotal = useMemo(() => lines.reduce((s, l) => s + num(l.qty) * num(l.unit_cost), 0), [lines]);
  const total = subtotal + num(vat);
  const valid = lines.length > 0 && lines.every((l) => num(l.qty) > 0 && num(l.unit_cost) >= 0);

  const submit = () => {
    setFormError(null);
    post.mutate(
      {
        supplier_id: supplierId,
        supplier_ref: supplierRef.trim(),
        received_at: dateToRfc3339(receivedAt),
        ...(vat !== '' ? { vat: decStr(vat) } : {}),
        note: note.trim(),
        lines: lines.map((l) => ({ product_id: l.product.id, qty: decStr(l.qty, 3), unit_cost: decStr(l.unit_cost) })),
      },
      {
        onSuccess: (r) => {
          toast.success(t('receiptPosted', { docNo: r.doc_no }));
          router.replace(`/inventory/receipts/${r.id}`);
        },
        onError: (err) => setFormError(errorMessage(err)),
      },
    );
  };

  const columns: GlassColumn<Line>[] = [
    {
      key: 'product',
      label: t('product'),
      render: (l) => (
        <Stack sx={{ minWidth: 0 }}>
          <Typography variant="body2" noWrap>
            {displayName(l.product)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {l.product.sku}
            {l.product.unit_name ? ` · ${l.product.unit_name}` : ''}
          </Typography>
        </Stack>
      ),
    },
    {
      key: 'qty',
      label: t('qty'),
      width: 140,
      align: 'right',
      render: (l) => (
        <MoneyField
          size="small"
          value={l.qty}
          onChange={(v) => updateLine(l.product.id, { qty: v })}
          currency={false}
          decimals={3}
          fullWidth={false}
          sx={{ width: 120 }}
          inputProps={{ 'aria-label': `${t('qty')} ${l.product.name}`, 'data-testid': 'receipt-qty' }}
        />
      ),
    },
    {
      key: 'unit_cost',
      label: t('unitCost'),
      width: 160,
      align: 'right',
      render: (l) => (
        <MoneyField
          size="small"
          value={l.unit_cost}
          onChange={(v) => updateLine(l.product.id, { unit_cost: v })}
          fullWidth={false}
          sx={{ width: 140 }}
          inputProps={{ 'aria-label': `${t('unitCost')} ${l.product.name}`, 'data-testid': 'receipt-cost' }}
        />
      ),
    },
    { key: 'total', label: tc('total'), width: 130, align: 'right', render: (l) => formatMoney(num(l.qty) * num(l.unit_cost), locale) },
    {
      key: 'actions',
      label: '',
      width: 56,
      align: 'right',
      render: (l) => (
        <IconButton size="small" aria-label={tc('delete')} onClick={() => setLines((prev) => prev.filter((x) => x.product.id !== l.product.id))}>
          <DeleteIcon fontSize="small" />
        </IconButton>
      ),
    },
  ];

  return (
    <Stack spacing={3}>
      <PageHeader title={t('newReceipt')} backHref="/inventory/receipts" />
      {formError && <Alert severity="error">{formError}</Alert>}

      <Grid container spacing={3}>
        <Grid item xs={12} md={4}>
          <GlassCard title={t('receiptDetail')}>
            <Stack spacing={2}>
              <LookupSelect
                label={t('supplier')}
                value={supplierId}
                onChange={setSupplierId}
                options={suppliers.data ?? []}
                loading={suppliers.isPending}
                createTitle={ts('addSupplier')}
                withNameEn={false}
                onCreate={async ({ name }) => createSupplier.mutateAsync({ name, is_active: true })}
              />
              <GlassInput label={t('supplierRef')} value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} />
              <GlassInput type="date" label={t('receivedAt')} value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} InputLabelProps={{ shrink: true }} />
              <MoneyField label={t('vat')} value={vat} onChange={setVat} helperText={t('vatHint')} />
              <GlassInput label={tc('notes')} value={note} onChange={(e) => setNote(e.target.value)} multiline minRows={2} />
            </Stack>
          </GlassCard>
        </Grid>
        <Grid item xs={12} md={8}>
          <GlassCard title={t('lines')} subtitle={t('addLineHint')}>
            <Stack spacing={2}>
              <ProductAutocomplete value={pick} onChange={addLine} clearOnSelect excludeIds={lines.map((l) => l.product.id)} label={t('addLine')} autoFocus />
              <GlassTable columns={columns} rows={lines} rowKey={(l) => l.product.id} emptyText={t('noLines')} maxHeight={480} />
              <Stack alignItems="flex-end" spacing={0.5}>
                <Typography variant="body2" color="text.secondary">
                  {t('subtotal')}: {formatMoney(subtotal, locale)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('vat')}: {formatMoney(num(vat), locale)}
                </Typography>
                <Typography variant="h6" fontWeight={700}>
                  {tc('total')}: {formatMoney(total, locale)}
                </Typography>
              </Stack>
            </Stack>
          </GlassCard>
        </Grid>
      </Grid>

      <Stack direction="row" justifyContent="flex-end" spacing={1.5}>
        <GlassButton variant="outlined" onClick={() => router.push('/inventory/receipts')} disabled={post.isPending}>
          {tc('cancel')}
        </GlassButton>
        <GlassButton onClick={submit} loading={post.isPending} disabled={!valid}>
          {t('postReceipt')}
        </GlassButton>
      </Stack>
    </Stack>
  );
}

export default function NewReceiptPage() {
  return (
    <RequireAuth roles={MUTATING_ROLES}>
      <NewReceiptContent />
    </RequireAuth>
  );
}
