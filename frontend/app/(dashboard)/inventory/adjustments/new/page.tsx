'use client';

import DeleteIcon from '@mui/icons-material/Delete';
import Alert from '@mui/material/Alert';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import MoneyField from '@/components/MoneyField';
import PageHeader from '@/components/PageHeader';
import ProductAutocomplete from '@/components/ProductAutocomplete';
import RequireAuth from '@/components/RequireAuth';
import { useToast } from '@/components/Toast';
import { GlassButton, GlassCard, GlassInput, GlassTable, type GlassColumn } from '@/components/glass';
import { resolveLocale } from '@/i18n/config';
import { useApiErrorMessage } from '@/lib/api/errors';
import { decStr, num } from '@/lib/api/hooks/common';
import { ADJUSTMENT_REASONS, usePostAdjustment } from '@/lib/api/hooks/inventory';
import type { Product } from '@/lib/api/hooks/products';
import { MUTATING_ROLES } from '@/lib/auth/session';
import { formatQty } from '@/lib/format';

interface Line {
  product: Product;
  qty_delta: string;
  note: string;
}

function NewAdjustmentContent() {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const locale = resolveLocale(useLocale());
  const router = useRouter();
  const toast = useToast();
  const errorMessage = useApiErrorMessage();
  const post = usePostAdjustment();

  const [reason, setReason] = useState<string>('correction');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [pick, setPick] = useState<Product | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const displayName = (p: Product) => (locale === 'en' && p.name_en ? p.name_en : p.name);
  const addLine = (p: Product | null) => {
    if (!p) return;
    setLines((prev) => (prev.some((l) => l.product.id === p.id) ? prev : [...prev, { product: p, qty_delta: '', note: '' }]));
    setPick(null);
  };
  const updateLine = (id: string, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.product.id === id ? { ...l, ...patch } : l)));

  const valid = lines.length > 0 && lines.every((l) => num(l.qty_delta) !== 0);

  const submit = () => {
    setFormError(null);
    post.mutate(
      {
        reason,
        note: note.trim(),
        lines: lines.map((l) => ({ product_id: l.product.id, qty_delta: decStr(l.qty_delta, 3), note: l.note.trim() })),
      },
      {
        onSuccess: (a) => {
          toast.success(t('adjustmentPosted', { docNo: a.doc_no }));
          router.replace('/inventory/adjustments');
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
            {l.product.sku} · {t('onHand')} {formatQty(l.product.stock_on_hand, locale)}
            {l.product.unit_name ? ` ${l.product.unit_name}` : ''}
          </Typography>
        </Stack>
      ),
    },
    {
      key: 'qty_delta',
      label: t('qtyDelta'),
      width: 150,
      align: 'right',
      render: (l) => (
        <MoneyField
          size="small"
          value={l.qty_delta}
          onChange={(v) => updateLine(l.product.id, { qty_delta: v })}
          currency={false}
          allowNegative
          decimals={3}
          fullWidth={false}
          sx={{ width: 130 }}
          error={l.qty_delta !== '' && num(l.qty_delta) === 0}
        />
      ),
    },
    {
      key: 'after',
      label: t('qtyAfter'),
      width: 110,
      align: 'right',
      render: (l) => {
        const after = num(l.product.stock_on_hand) + num(l.qty_delta);
        return (
          <Typography variant="body2" color={after < 0 ? 'error.main' : 'text.primary'}>
            {formatQty(after, locale)}
          </Typography>
        );
      },
    },
    {
      key: 'note',
      label: t('lineNote'),
      width: 220,
      render: (l) => <GlassInput size="small" value={l.note} onChange={(e) => updateLine(l.product.id, { note: e.target.value })} />,
    },
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
      <PageHeader title={t('newAdjustment')} subtitle={t('adjustmentHint')} backHref="/inventory/adjustments" />
      {formError && <Alert severity="error">{formError}</Alert>}
      <Grid container spacing={3}>
        <Grid item xs={12} md={4}>
          <GlassCard title={t('adjustmentDetail')}>
            <Stack spacing={2}>
              <GlassInput select label={t('reason')} value={reason} onChange={(e) => setReason(e.target.value)}>
                {ADJUSTMENT_REASONS.map((r) => (
                  <MenuItem key={r} value={r}>
                    {t(`reasons.${r}`)}
                  </MenuItem>
                ))}
              </GlassInput>
              <GlassInput label={tc('notes')} value={note} onChange={(e) => setNote(e.target.value)} multiline minRows={3} />
            </Stack>
          </GlassCard>
        </Grid>
        <Grid item xs={12} md={8}>
          <GlassCard title={t('lines')} subtitle={t('qtyDeltaHint')}>
            <Stack spacing={2}>
              <ProductAutocomplete value={pick} onChange={addLine} clearOnSelect excludeIds={lines.map((l) => l.product.id)} label={t('addLine')} autoFocus />
              <GlassTable columns={columns} rows={lines} rowKey={(l) => l.product.id} emptyText={t('noLines')} maxHeight={480} />
            </Stack>
          </GlassCard>
        </Grid>
      </Grid>
      <Stack direction="row" justifyContent="flex-end" spacing={1.5}>
        <GlassButton variant="outlined" onClick={() => router.push('/inventory/adjustments')} disabled={post.isPending}>
          {tc('cancel')}
        </GlassButton>
        <GlassButton onClick={submit} loading={post.isPending} disabled={!valid}>
          {t('postAdjustment')}
        </GlassButton>
      </Stack>
    </Stack>
  );
}

export default function NewAdjustmentPage() {
  return (
    <RequireAuth roles={MUTATING_ROLES}>
      <NewAdjustmentContent />
    </RequireAuth>
  );
}
