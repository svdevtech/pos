'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Alert from '@mui/material/Alert';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import MoneyField from '@/components/MoneyField';
import { GlassButton, GlassCard, GlassInput } from '@/components/glass';
import { isApiError } from '@/lib/api/client';
import { useApiErrorMessage } from '@/lib/api/errors';
import { decStr } from '@/lib/api/hooks/common';
import type { Member, MemberInput, MemberPatch } from '@/lib/api/hooks/members';

export interface MemberFormValues {
  member_code: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  national_id: string;
  joined_at: string;
  price_tier: string;
  note: string;
  opening_share: string;
}

const EMPTY: MemberFormValues = {
  member_code: '',
  name: '',
  address: '',
  phone: '',
  email: '',
  national_id: '',
  joined_at: '',
  price_tier: '0',
  note: '',
  opening_share: '',
};

export function toMemberInput(v: MemberFormValues): MemberInput {
  return {
    member_code: v.member_code.trim(),
    name: v.name.trim(),
    address: v.address.trim(),
    phone: v.phone.trim(),
    email: v.email.trim(),
    national_id: v.national_id.trim(),
    joined_at: v.joined_at || null,
    price_tier: Number(v.price_tier || 0),
    note: v.note.trim(),
    opening_share: decStr(v.opening_share),
  };
}

export function toMemberPatch(v: MemberFormValues): MemberPatch {
  return {
    member_code: v.member_code.trim(),
    name: v.name.trim(),
    address: v.address.trim(),
    phone: v.phone.trim(),
    email: v.email.trim(),
    national_id: v.national_id.trim(),
    joined_at: v.joined_at || null,
    price_tier: Number(v.price_tier || 0),
    note: v.note.trim(),
  };
}

function fromMember(m: Member): MemberFormValues {
  return {
    member_code: m.member_code ?? '',
    name: m.name ?? '',
    address: m.address ?? '',
    phone: m.phone ?? '',
    email: m.email ?? '',
    national_id: m.national_id ?? '',
    joined_at: m.joined_at ? m.joined_at.slice(0, 10) : '',
    price_tier: String(m.price_tier ?? 0),
    note: m.note ?? '',
    opening_share: '',
  };
}

export interface MemberFormProps {
  mode: 'create' | 'edit';
  member?: Member | null;
  readOnly?: boolean;
  submitting?: boolean;
  error?: unknown;
  onSubmit: (values: MemberFormValues) => void;
  onCancel?: () => void;
}

const FIELD_NAMES: (keyof MemberFormValues)[] = ['member_code', 'name', 'address', 'phone', 'email', 'national_id', 'joined_at', 'price_tier', 'note', 'opening_share'];

export default function MemberForm({ mode, member, readOnly = false, submitting = false, error, onSubmit, onCancel }: MemberFormProps) {
  const t = useTranslations('members');
  const tc = useTranslations('common');
  const tv = useTranslations('validation');
  const errorMessage = useApiErrorMessage();
  const [formError, setFormError] = useState<string | null>(null);

  const schema = useMemo(
    () =>
      z.object({
        member_code: z.string().trim(),
        name: z.string().trim().min(1, tv('required')),
        address: z.string(),
        phone: z.string().trim(),
        email: z.string().trim().refine((s) => s === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s), tv('email')),
        national_id: z.string().trim().refine((s) => s === '' || /^\d{13}$/.test(s), tv('invalid')),
        joined_at: z.string(),
        price_tier: z.string(),
        note: z.string(),
        opening_share: z.string().refine((s) => s === '' || Number(s) >= 0, tv('positive')),
      }),
    [tv],
  );

  const {
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<MemberFormValues>({ resolver: zodResolver(schema), defaultValues: member ? fromMember(member) : EMPTY });

  useEffect(() => {
    if (member) reset(fromMember(member));
  }, [member, reset]);

  useEffect(() => {
    if (!error) {
      setFormError(null);
      return;
    }
    if (isApiError(error) && error.hasFields) {
      let matched = false;
      for (const [field, msg] of Object.entries(error.fields)) {
        if ((FIELD_NAMES as string[]).includes(field)) {
          matched = true;
          setError(field as keyof MemberFormValues, { type: 'server', message: tv.has(msg) ? tv(msg) : msg });
        }
      }
      setFormError(matched ? null : errorMessage(error));
    } else {
      setFormError(errorMessage(error));
    }
  }, [error, setError, tv, errorMessage]);

  const text = (name: keyof MemberFormValues, label: string, extra: Record<string, unknown> = {}) => (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <GlassInput
          {...field}
          label={label}
          error={Boolean(errors[name])}
          helperText={errors[name]?.message}
          InputProps={{ readOnly }}
          disabled={readOnly && submitting}
          {...extra}
        />
      )}
    />
  );

  return (
    <Stack component="form" spacing={3} onSubmit={handleSubmit(onSubmit)} noValidate>
      {formError && <Alert severity="error">{formError}</Alert>}
      <GlassCard title={t('profile')}>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={4}>
            {text('member_code', t('memberCode'), { helperText: errors.member_code?.message ?? (mode === 'create' ? t('memberCodeHint') : undefined), autoComplete: 'off' })}
          </Grid>
          <Grid item xs={12} sm={8}>
            {text('name', t('name'), { autoFocus: mode === 'create' })}
          </Grid>
          <Grid item xs={12}>
            {text('address', t('address'), { multiline: true, minRows: 2 })}
          </Grid>
          <Grid item xs={12} sm={4}>
            {text('phone', t('phone'), { inputProps: { inputMode: 'tel' } })}
          </Grid>
          <Grid item xs={12} sm={4}>
            {text('email', t('email'), { type: 'email' })}
          </Grid>
          <Grid item xs={12} sm={4}>
            {text('national_id', t('idCard'), { inputProps: { inputMode: 'numeric', maxLength: 13 } })}
          </Grid>
          <Grid item xs={12} sm={4}>
            {text('joined_at', t('joinDate'), { type: 'date', InputLabelProps: { shrink: true } })}
          </Grid>
          <Grid item xs={12} sm={4}>
            <Controller
              name="price_tier"
              control={control}
              render={({ field }) => (
                <GlassInput {...field} select label={t('priceTier')} helperText={t('priceTierHint')} InputProps={{ readOnly }}>
                  <MenuItem value="0">{t('tierDefault')}</MenuItem>
                  {[1, 2, 3, 4].map((n) => (
                    <MenuItem key={n} value={String(n)}>
                      {t('tier', { n })}
                    </MenuItem>
                  ))}
                </GlassInput>
              )}
            />
          </Grid>
          {mode === 'create' && (
            <Grid item xs={12} sm={4}>
              <Controller
                name="opening_share"
                control={control}
                render={({ field }) => (
                  <MoneyField
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    label={t('openingShare')}
                    helperText={errors.opening_share?.message ?? t('openingShareHint')}
                    error={Boolean(errors.opening_share)}
                  />
                )}
              />
            </Grid>
          )}
          <Grid item xs={12}>
            {text('note', tc('notes'), { multiline: true, minRows: 2 })}
          </Grid>
        </Grid>
      </GlassCard>
      {!readOnly && (
        <Stack direction="row" justifyContent="flex-end" spacing={1.5}>
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
