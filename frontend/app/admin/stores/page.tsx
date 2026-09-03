'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import AddIcon from '@mui/icons-material/Add';
import LoginIcon from '@mui/icons-material/Login';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { useSession } from '@/components/Providers';
import { GlassButton, GlassDialog, GlassInput, GlassTable, type GlassColumn } from '@/components/glass';
import { locales, resolveLocale, type Locale } from '@/i18n/config';
import { api, isApiError, unwrapList, type Page } from '@/lib/api/client';
import { useApiErrorMessage } from '@/lib/api/errors';
import type { SessionStore } from '@/lib/auth/session';
import { formatDateTime } from '@/lib/format';

interface CreateValues {
  code: string;
  name: string;
  name_en: string;
  default_locale: Locale;
  owner_username: string;
  owner_password: string;
  owner_name: string;
}

const STORES_KEY = ['admin-stores'] as const;
const MIN_PASSWORD = 8;

function CreateStoreDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const tv = useTranslations('validation');
  const errorMessage = useApiErrorMessage();
  const [formError, setFormError] = useState<string | null>(null);

  const schema = useMemo(
    () =>
      z.object({
        code: z
          .string()
          .trim()
          .min(1, tv('required'))
          .regex(/^[A-Za-z0-9_-]+$/, tv('invalid')),
        name: z.string().trim().min(1, tv('required')),
        name_en: z.string().trim(),
        default_locale: z.enum(locales),
        owner_username: z.string().trim().min(1, tv('required')),
        owner_password: z.string().min(MIN_PASSWORD, tv('minLength', { min: MIN_PASSWORD })),
        owner_name: z.string().trim().min(1, tv('required')),
      }),
    [tv],
  );

  const {
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<CreateValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      code: '',
      name: '',
      name_en: '',
      default_locale: 'th',
      owner_username: '',
      owner_password: '',
      owner_name: '',
    },
  });

  useEffect(() => {
    if (open) {
      setFormError(null);
      reset();
    }
  }, [open, reset]);

  const create = useMutation({
    mutationFn: (v: CreateValues) =>
      api.post<SessionStore>('/admin/stores', {
        store: { code: v.code.toUpperCase(), name: v.name, name_en: v.name_en, default_locale: v.default_locale },
        owner_username: v.owner_username,
        owner_password: v.owner_password,
        owner_name: v.owner_name,
      }),
    onSuccess: () => onCreated(),
    onError: (err) => {
      if (isApiError(err) && err.hasFields) {
        let matched = false;
        for (const [rawField, msg] of Object.entries(err.fields)) {
          // Backend may report nested fields as "store.code".
          const field = rawField.replace(/^store\./, '') as keyof CreateValues;
          if (field in ({ code: 1, name: 1, name_en: 1, default_locale: 1, owner_username: 1, owner_password: 1, owner_name: 1 } as Record<string, number>)) {
            matched = true;
            setError(field, { type: 'server', message: tv.has(msg) ? tv(msg) : msg });
          }
        }
        if (!matched) setFormError(errorMessage(err));
      } else {
        setFormError(errorMessage(err));
      }
    },
  });

  const text = (name: keyof CreateValues, label: string, extra: Record<string, unknown> = {}) => (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <GlassInput {...field} label={label} error={Boolean(errors[name])} helperText={errors[name]?.message} {...extra} />
      )}
    />
  );

  return (
    <GlassDialog
      open={open}
      onClose={onClose}
      busy={create.isPending}
      title={t('addStore')}
      actions={
        <>
          <GlassButton variant="outlined" onClick={onClose} disabled={create.isPending}>
            {tc('cancel')}
          </GlassButton>
          <GlassButton form="create-store-form" type="submit" loading={create.isPending}>
            {tc('create')}
          </GlassButton>
        </>
      }
    >
      <Stack
        spacing={2}
        component="form"
        id="create-store-form"
        onSubmit={handleSubmit((v) => create.mutate(v))}
        noValidate
        sx={{ pt: 1 }}
      >
        {formError && <Alert severity="error">{formError}</Alert>}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          {text('code', t('storeCode'), { inputProps: { style: { textTransform: 'uppercase' } } })}
          <Controller
            name="default_locale"
            control={control}
            render={({ field }) => (
              <GlassInput {...field} select label={t('defaultLocale')}>
                {locales.map((l) => (
                  <MenuItem key={l} value={l}>
                    {l === 'th' ? tc('thai') : tc('english')}
                  </MenuItem>
                ))}
              </GlassInput>
            )}
          />
        </Stack>
        {text('name', t('storeName'))}
        {text('name_en', t('storeNameEn'))}
        <Typography variant="subtitle2" sx={{ pt: 1 }}>
          {t('owner')}
        </Typography>
        {text('owner_name', t('ownerName'))}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          {text('owner_username', t('ownerUsername'), { autoComplete: 'off' })}
          {text('owner_password', t('ownerPassword'), { type: 'password', autoComplete: 'new-password' })}
        </Stack>
      </Stack>
    </GlassDialog>
  );
}

export default function AdminStoresPage() {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const locale = resolveLocale(useLocale());
  const router = useRouter();
  const queryClient = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const { store: selected, selectStore } = useSession();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const stores = useQuery({
    queryKey: STORES_KEY,
    queryFn: async () => unwrapList(await api.get<SessionStore[] | Page<SessionStore>>('/admin/stores', { storeId: null })),
  });

  const enter = (store: SessionStore) => {
    selectStore(store);
    router.push('/dashboard');
  };

  const columns: GlassColumn<SessionStore>[] = [
    { key: 'code', label: t('storeCode'), width: 120 },
    { key: 'name', label: t('storeName'), render: (s) => (locale === 'en' && s.name_en ? s.name_en : s.name) },
    { key: 'name_en', label: t('storeNameEn') },
    { key: 'default_locale', label: t('defaultLocale'), render: (s) => s.default_locale?.toUpperCase() ?? '' },
    {
      key: 'is_active',
      label: tc('status'),
      render: (s) =>
        s.is_active === undefined ? (
          ''
        ) : (
          <Chip size="small" color={s.is_active ? 'success' : 'default'} label={s.is_active ? tc('active') : tc('inactive')} />
        ),
    },
    { key: 'created_at', label: t('createdAt'), render: (s) => formatDateTime(s.created_at, locale) },
    {
      key: 'actions',
      label: tc('actions'),
      align: 'right',
      width: 160,
      render: (s) => (
        <GlassButton
          size="small"
          variant={selected?.id === s.id ? 'contained' : 'outlined'}
          startIcon={<LoginIcon />}
          onClick={(e) => {
            e.stopPropagation();
            enter(s);
          }}
        >
          {t('enterStore')}
        </GlassButton>
      ),
    },
  ];

  return (
    <Stack spacing={3}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2}>
        <Typography variant="h4" component="h1" fontWeight={700}>
          {t('stores')}
        </Typography>
        <GlassButton startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>
          {t('addStore')}
        </GlassButton>
      </Stack>

      {selected && (
        <Alert severity="info" onClose={() => selectStore(null)}>
          {t('selectedStore')}: {selected.code} · {selected.name}
        </Alert>
      )}

      {stores.isError && (
        <Alert
          severity="error"
          action={
            <GlassButton size="small" variant="text" onClick={() => stores.refetch()}>
              {tc('retry')}
            </GlassButton>
          }
        >
          {errorMessage(stores.error)}
        </Alert>
      )}

      <GlassTable
        columns={columns}
        rows={stores.data ?? []}
        rowKey={(s) => s.id}
        loading={stores.isPending}
        emptyText={t('noStores')}
        isSelected={(s) => s.id === selected?.id}
        onRowClick={enter}
      />

      <CreateStoreDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={() => {
          setDialogOpen(false);
          setToast(t('created'));
          void queryClient.invalidateQueries({ queryKey: STORES_KEY });
        }}
      />

      <Snackbar open={Boolean(toast)} autoHideDuration={3000} onClose={() => setToast(null)} message={toast} />
    </Stack>
  );
}
