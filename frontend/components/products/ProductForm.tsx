'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import DeleteIcon from '@mui/icons-material/Delete';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import LookupSelect from '@/components/LookupSelect';
import MoneyField from '@/components/MoneyField';
import { GlassButton, GlassCard, GlassInput } from '@/components/glass';
import { isApiError } from '@/lib/api/client';
import { useApiErrorMessage } from '@/lib/api/errors';
import { num } from '@/lib/api/hooks/common';
import {
  useCategories,
  useCreateCategory,
  useCreateUnit,
  useUnits,
  type Product,
  type ProductInput,
} from '@/lib/api/hooks/products';

export interface ProductFormValues {
  sku: string;
  name: string;
  name_en: string;
  category_id: string | null;
  unit_id: string | null;
  cost_last: string;
  cost_avg: string;
  sell_price: string;
  min_level1: string;
  min_level2: string;
  is_serial: boolean;
  is_active: boolean;
  note: string;
  tier1: string;
  tier2: string;
  tier3: string;
  tier4: string;
  barcodes: string[];
  opening_stock: string;
}

const EMPTY: ProductFormValues = {
  sku: '',
  name: '',
  name_en: '',
  category_id: null,
  unit_id: null,
  cost_last: '',
  cost_avg: '',
  sell_price: '',
  min_level1: '',
  min_level2: '',
  is_serial: false,
  is_active: true,
  note: '',
  tier1: '',
  tier2: '',
  tier3: '',
  tier4: '',
  barcodes: [],
  opening_stock: '',
};

const TIER_FIELDS = ['tier1', 'tier2', 'tier3', 'tier4'] as const;

function fromProduct(p: Product): ProductFormValues {
  const tiers = p.price_tiers ?? {};
  const tier = (k: string) => (tiers[k] !== undefined && tiers[k] !== null ? String(num(tiers[k])) : '');
  return {
    sku: p.sku,
    name: p.name,
    name_en: p.name_en ?? '',
    category_id: p.category_id ?? null,
    unit_id: p.unit_id ?? null,
    cost_last: String(num(p.cost_last)),
    cost_avg: String(num(p.cost_avg)),
    sell_price: String(num(p.sell_price)),
    min_level1: String(num(p.min_level1)),
    min_level2: String(num(p.min_level2)),
    is_serial: p.is_serial,
    is_active: p.is_active,
    note: p.note ?? '',
    tier1: tier('1'),
    tier2: tier('2'),
    tier3: tier('3'),
    tier4: tier('4'),
    barcodes: [],
    opening_stock: '',
  };
}

/** Maps form values to the API body; create-only fields are dropped when editing. */
export function toProductInput(v: ProductFormValues, mode: 'create' | 'edit'): ProductInput {
  const dec = (s: string, dp: number) => (s === '' ? '0' : num(s).toFixed(dp));
  const tiers: Record<string, string> = {};
  TIER_FIELDS.forEach((f, i) => {
    if (v[f] !== '') tiers[String(i + 1)] = dec(v[f], 2);
  });
  const body: ProductInput = {
    sku: v.sku.trim(),
    name: v.name.trim(),
    name_en: v.name_en.trim(),
    category_id: v.category_id || null,
    unit_id: v.unit_id || null,
    cost_last: dec(v.cost_last, 2),
    cost_avg: dec(v.cost_avg, 2),
    sell_price: dec(v.sell_price, 2),
    min_level1: dec(v.min_level1, 3),
    min_level2: dec(v.min_level2, 3),
    is_serial: v.is_serial,
    is_active: v.is_active,
    note: v.note.trim(),
    price_tiers: tiers,
  };
  if (mode === 'create') {
    if (v.barcodes.length) body.barcodes = v.barcodes;
    if (v.opening_stock !== '' && num(v.opening_stock) > 0) body.opening_stock = dec(v.opening_stock, 3);
  }
  return body;
}

export interface ProductFormProps {
  mode: 'create' | 'edit';
  product?: Product | null;
  submitting: boolean;
  /** Server error to show at the top (fields are mapped automatically). */
  error?: unknown;
  onSubmit: (values: ProductFormValues) => void;
  onCancel?: () => void;
  readOnly?: boolean;
}

export default function ProductForm({ mode, product, submitting, error, onSubmit, onCancel, readOnly }: ProductFormProps) {
  const t = useTranslations('products');
  const tc = useTranslations('common');
  const tv = useTranslations('validation');
  const errorMessage = useApiErrorMessage();
  const categories = useCategories();
  const units = useUnits();
  const createCategory = useCreateCategory();
  const createUnit = useCreateUnit();
  const [barcodeInput, setBarcodeInput] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const numeric = useMemo(
    () => (allowEmpty = true) =>
      z.string().refine((s) => (s === '' ? allowEmpty : !Number.isNaN(Number(s)) && Number(s) >= 0), tv('number')),
    [tv],
  );

  const schema = useMemo(
    () =>
      z.object({
        sku: z.string().trim().min(1, tv('required')),
        name: z.string().trim().min(1, tv('required')),
        name_en: z.string(),
        category_id: z.string().nullable(),
        unit_id: z.string().nullable(),
        cost_last: numeric(),
        cost_avg: numeric(),
        sell_price: z.string().min(1, tv('required')).pipe(numeric(false)),
        min_level1: numeric(),
        min_level2: numeric(),
        is_serial: z.boolean(),
        is_active: z.boolean(),
        note: z.string(),
        tier1: numeric(),
        tier2: numeric(),
        tier3: numeric(),
        tier4: numeric(),
        barcodes: z.array(z.string()),
        opening_stock: numeric(),
      }),
    [tv, numeric],
  );

  const {
    control,
    handleSubmit,
    reset,
    setError,
    watch,
    setValue,
    formState: { errors, isDirty },
  } = useForm<ProductFormValues>({ resolver: zodResolver(schema), defaultValues: EMPTY });

  useEffect(() => {
    reset(product ? fromProduct(product) : EMPTY);
  }, [product, reset]);

  useEffect(() => {
    if (!error) {
      setFormError(null);
      return;
    }
    if (isApiError(error) && error.hasFields) {
      let matched = false;
      for (const [field, msg] of Object.entries(error.fields)) {
        if (field in EMPTY) {
          matched = true;
          setError(field as keyof ProductFormValues, { type: 'server', message: tv.has(msg) ? tv(msg) : msg });
        }
      }
      setFormError(matched ? null : errorMessage(error));
    } else if (isApiError(error) && error.params?.field && error.params.field in EMPTY) {
      setError(error.params.field as keyof ProductFormValues, { type: 'server', message: error.message || tv('invalid') });
      setFormError(error.message || null);
    } else {
      setFormError(errorMessage(error));
    }
  }, [error, setError, tv, errorMessage]);

  const barcodes = watch('barcodes');
  const addBarcode = () => {
    const code = barcodeInput.trim();
    if (!code || barcodes.includes(code)) return;
    setValue('barcodes', [...barcodes, code], { shouldDirty: true });
    setBarcodeInput('');
  };

  const text = (name: keyof ProductFormValues, label: string, extra: Record<string, unknown> = {}) => (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <GlassInput
          {...field}
          value={field.value as string}
          label={label}
          disabled={readOnly}
          error={Boolean(errors[name])}
          helperText={errors[name]?.message as string | undefined}
          {...extra}
        />
      )}
    />
  );

  const money = (name: keyof ProductFormValues, label: string, extra: Record<string, unknown> = {}) => (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <MoneyField
          value={field.value as string}
          onChange={field.onChange}
          onBlur={field.onBlur}
          label={label}
          disabled={readOnly}
          error={Boolean(errors[name])}
          helperText={errors[name]?.message as string | undefined}
          {...extra}
        />
      )}
    />
  );

  return (
    <Stack component="form" spacing={3} onSubmit={handleSubmit(onSubmit)} noValidate>
      {formError && <Alert severity="error">{formError}</Alert>}

      <GlassCard title={t('details')}>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={4}>
            {text('sku', t('sku'), { autoComplete: 'off', autoFocus: mode === 'create' })}
          </Grid>
          <Grid item xs={12} sm={8}>
            {text('name', t('name'))}
          </Grid>
          <Grid item xs={12} sm={4}>
            <Controller
              name="category_id"
              control={control}
              render={({ field }) => (
                <LookupSelect
                  label={t('category')}
                  value={field.value}
                  onChange={field.onChange}
                  options={categories.data ?? []}
                  loading={categories.isPending}
                  disabled={readOnly}
                  createTitle={t('addCategory')}
                  onCreate={readOnly ? undefined : (input) => createCategory.mutateAsync(input)}
                />
              )}
            />
          </Grid>
          <Grid item xs={12} sm={8}>
            {text('name_en', t('nameEn'))}
          </Grid>
          <Grid item xs={12} sm={4}>
            <Controller
              name="unit_id"
              control={control}
              render={({ field }) => (
                <LookupSelect
                  label={t('unit')}
                  value={field.value}
                  onChange={field.onChange}
                  // switched-off units stay on the products that already use them, but are not offered
                  options={(units.data ?? []).filter((u) => u.is_active || u.id === field.value)}
                  loading={units.isPending}
                  disabled={readOnly}
                  createTitle={t('addUnit')}
                  onCreate={readOnly ? undefined : (input) => createUnit.mutateAsync(input)}
                />
              )}
            />
          </Grid>
          <Grid item xs={12} sm={8}>
            {text('note', tc('notes'), { multiline: true, minRows: 1 })}
          </Grid>
          <Grid item xs={12}>
            <Stack direction="row" spacing={3} flexWrap="wrap">
              <Controller
                name="is_active"
                control={control}
                render={({ field }) => (
                  <FormControlLabel
                    control={<Switch checked={field.value} onChange={(e) => field.onChange(e.target.checked)} disabled={readOnly} />}
                    label={t('isActive')}
                  />
                )}
              />
              <Controller
                name="is_serial"
                control={control}
                render={({ field }) => (
                  <FormControlLabel
                    control={<Switch checked={field.value} onChange={(e) => field.onChange(e.target.checked)} disabled={readOnly} />}
                    label={t('isSerial')}
                  />
                )}
              />
            </Stack>
          </Grid>
        </Grid>
      </GlassCard>

      <GlassCard title={t('pricing')}>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={4}>
            {money('sell_price', t('price'))}
          </Grid>
          <Grid item xs={6} sm={4}>
            {money('cost_last', t('costLast'))}
          </Grid>
          <Grid item xs={6} sm={4}>
            {money('cost_avg', t('costAvg'), { helperText: mode === 'edit' ? t('costAvgHint') : undefined })}
          </Grid>
          <Grid item xs={12}>
            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle2" gutterBottom>
              {t('priceTiers')}
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
              {t('priceTiersHint')}
            </Typography>
            <Grid container spacing={2}>
              {TIER_FIELDS.map((f, i) => (
                <Grid item xs={6} sm={3} key={f}>
                  {money(f, t('tier', { n: i + 1 }))}
                </Grid>
              ))}
            </Grid>
          </Grid>
        </Grid>
      </GlassCard>

      <GlassCard title={t('stockSettings')}>
        <Grid container spacing={2}>
          <Grid item xs={6} sm={4}>
            {money('min_level1', t('minLevel1'), { currency: false, decimals: 3, helperText: t('minLevel1Hint') })}
          </Grid>
          <Grid item xs={6} sm={4}>
            {money('min_level2', t('minLevel2'), { currency: false, decimals: 3, helperText: t('minLevel2Hint') })}
          </Grid>
          {mode === 'create' && (
            <Grid item xs={12} sm={4}>
              {money('opening_stock', t('openingStock'), { currency: false, decimals: 3, helperText: t('openingStockHint') })}
            </Grid>
          )}
        </Grid>
      </GlassCard>

      {mode === 'create' && (
        <GlassCard title={t('barcodes')} subtitle={t('barcodesCreateHint')}>
          <Stack spacing={2}>
            <Stack direction="row" spacing={1}>
              <GlassInput
                size="small"
                label={t('barcode')}
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addBarcode();
                  }
                }}
                inputProps={{ inputMode: 'numeric' }}
              />
              <GlassButton variant="outlined" onClick={addBarcode} disabled={!barcodeInput.trim()}>
                {tc('add')}
              </GlassButton>
            </Stack>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {barcodes.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  {t('noBarcodes')}
                </Typography>
              )}
              {barcodes.map((b, i) => (
                <Chip
                  key={b}
                  label={i === 0 ? `${b} · ${t('primary')}` : b}
                  color={i === 0 ? 'primary' : 'default'}
                  deleteIcon={<DeleteIcon />}
                  onDelete={() =>
                    setValue(
                      'barcodes',
                      barcodes.filter((x) => x !== b),
                      { shouldDirty: true },
                    )
                  }
                />
              ))}
            </Stack>
          </Stack>
        </GlassCard>
      )}

      {!readOnly && (
        <Stack direction="row" spacing={1.5} justifyContent="flex-end">
          {onCancel && (
            <GlassButton variant="outlined" onClick={onCancel} disabled={submitting}>
              {tc('cancel')}
            </GlassButton>
          )}
          <GlassButton type="submit" loading={submitting} disabled={mode === 'edit' && !isDirty}>
            {mode === 'create' ? tc('create') : tc('save')}
          </GlassButton>
        </Stack>
      )}
    </Stack>
  );
}
