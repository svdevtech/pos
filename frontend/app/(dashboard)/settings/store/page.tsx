'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import UploadIcon from '@mui/icons-material/Upload';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { useSession } from '@/components/Providers';
import RequireAuth from '@/components/RequireAuth';
import { GlassButton, GlassCard, GlassInput } from '@/components/glass';
import { locales, type Locale } from '@/i18n/config';
import { api, isApiError } from '@/lib/api/client';
import { useApiErrorMessage } from '@/lib/api/errors';
import { MUTATING_ROLES, loadSession, updateSession, type SessionStore } from '@/lib/auth/session';

interface StoreValues {
  name: string;
  name_en: string;
  address: string;
  phone: string;
  tax_id: string;
  receipt_header: string;
  receipt_footer: string;
  default_locale: Locale;
}

const STORE_KEY = ['store'] as const;
const LOGO_KEY = ['store-logo'] as const;
const MAX_LOGO_BYTES = 1024 * 1024;

function toValues(s: SessionStore): StoreValues {
  return {
    name: s.name ?? '',
    name_en: s.name_en ?? '',
    address: s.address ?? '',
    phone: s.phone ?? '',
    tax_id: s.tax_id ?? '',
    receipt_header: s.receipt_header ?? '',
    receipt_footer: s.receipt_footer ?? '',
    default_locale: s.default_locale ?? 'th',
  };
}

function LogoPanel() {
  const t = useTranslations('settings');
  const errorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const logo = useQuery({
    queryKey: LOGO_KEY,
    queryFn: async () => {
      try {
        return await api.get<Blob>('/store/logo', { responseType: 'blob' });
      } catch (err) {
        if (isApiError(err) && err.status === 404) return null;
        throw err;
      }
    },
    staleTime: Infinity,
  });

  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!logo.data || logo.data.size === 0) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(logo.data);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [logo.data]);

  const upload = useMutation({
    mutationFn: (file: File) =>
      api.put<void>('/store/logo', file, { contentType: file.type || 'application/octet-stream', responseType: 'void' }),
    onSuccess: () => {
      setToast(t('logoUploaded'));
      void queryClient.invalidateQueries({ queryKey: LOGO_KEY });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const onPick = (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (file.size > MAX_LOGO_BYTES) {
      setError(t('logoHint'));
      return;
    }
    upload.mutate(file);
  };

  return (
    <GlassCard title={t('logo')} subtitle={t('logoHint')}>
      <Stack spacing={2} alignItems="flex-start">
        <Box
          sx={{
            width: 160,
            height: 160,
            borderRadius: 3,
            border: (th) => `1px dashed ${th.glass.border}`,
            display: 'grid',
            placeItems: 'center',
            overflow: 'hidden',
            background: 'rgba(255,255,255,0.06)',
          }}
        >
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={t('logo')} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
          ) : (
            <Typography variant="caption" color="text.secondary">
              {t('noLogo')}
            </Typography>
          )}
        </Box>
        {error && <Alert severity="error">{error}</Alert>}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg"
          hidden
          onChange={(e) => {
            onPick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <GlassButton variant="outlined" startIcon={<UploadIcon />} loading={upload.isPending} onClick={() => inputRef.current?.click()}>
          {t('uploadLogo')}
        </GlassButton>
      </Stack>
      <Snackbar open={Boolean(toast)} autoHideDuration={3000} onClose={() => setToast(null)} message={toast} />
    </GlassCard>
  );
}

function StoreContent() {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const tv = useTranslations('validation');
  const errorMessage = useApiErrorMessage();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const store = useQuery({ queryKey: STORE_KEY, queryFn: () => api.get<SessionStore>('/store') });

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, tv('required')),
        name_en: z.string().trim(),
        address: z.string().trim(),
        phone: z.string().trim(),
        tax_id: z.string().trim(),
        receipt_header: z.string(),
        receipt_footer: z.string(),
        default_locale: z.enum(locales),
      }),
    [tv],
  );

  const {
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<StoreValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      name_en: '',
      address: '',
      phone: '',
      tax_id: '',
      receipt_header: '',
      receipt_footer: '',
      default_locale: 'th',
    },
  });

  useEffect(() => {
    if (store.data) reset(toValues(store.data));
  }, [store.data, reset]);

  const save = useMutation({
    mutationFn: (values: StoreValues) => api.patch<SessionStore>('/store', values),
    onSuccess: (updated) => {
      setToast(t('storeSaved'));
      queryClient.setQueryData(STORE_KEY, updated);
      // Keep the cached session store in sync so the shell shows the new name.
      const current = loadSession();
      if (current && session) {
        const merged = { ...(current.store ?? {}), ...updated } as SessionStore;
        updateSession(
          current.user.role === 'platform_admin' ? { selected_store: merged } : { store: merged, selected_store: merged },
        );
      }
    },
    onError: (err) => {
      if (isApiError(err) && err.hasFields) {
        let matched = false;
        for (const [field, msg] of Object.entries(err.fields)) {
          if (field in ({ name: 1, name_en: 1, address: 1, phone: 1, tax_id: 1, receipt_header: 1, receipt_footer: 1, default_locale: 1 } as Record<string, number>)) {
            matched = true;
            setError(field as keyof StoreValues, { type: 'server', message: tv.has(msg) ? tv(msg) : msg });
          }
        }
        if (!matched) setFormError(errorMessage(err));
      } else {
        setFormError(errorMessage(err));
      }
    },
  });

  const field = (name: keyof StoreValues, label: string, extra: Record<string, unknown> = {}) => (
    <Controller
      name={name}
      control={control}
      render={({ field: f }) => (
        <GlassInput {...f} label={label} error={Boolean(errors[name])} helperText={errors[name]?.message} {...extra} />
      )}
    />
  );

  return (
    <Stack spacing={3}>
      <Typography variant="h4" component="h1" fontWeight={700}>
        {t('store')}
      </Typography>

      {store.isError && (
        <Alert
          severity="error"
          action={
            <GlassButton size="small" variant="text" onClick={() => store.refetch()}>
              {tc('retry')}
            </GlassButton>
          }
        >
          {errorMessage(store.error)}
        </Alert>
      )}

      <Grid container spacing={3}>
        <Grid item xs={12} md={8}>
          <GlassCard
            title={store.data ? `${store.data.code}` : t('store')}
            subtitle={store.isPending ? tc('loading') : undefined}
            component="form"
            onSubmit={handleSubmit((v) => {
              setFormError(null);
              save.mutate(v);
            })}
          >
            <Stack spacing={2}>
              {formError && <Alert severity="error">{formError}</Alert>}
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                {field('name', t('storeName'))}
                {field('name_en', t('storeNameEn'))}
              </Stack>
              {field('address', t('address'), { multiline: true, minRows: 2 })}
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                {field('phone', t('phone'))}
                {field('tax_id', t('taxId'))}
                <Controller
                  name="default_locale"
                  control={control}
                  render={({ field: f }) => (
                    <GlassInput {...f} select label={t('defaultLocale')}>
                      {locales.map((l) => (
                        <MenuItem key={l} value={l}>
                          {l === 'th' ? tc('thai') : tc('english')}
                        </MenuItem>
                      ))}
                    </GlassInput>
                  )}
                />
              </Stack>

              <Typography id="receipt" variant="subtitle1" fontWeight={600} sx={{ pt: 1 }}>
                {t('receipt')}
              </Typography>
              {field('receipt_header', t('receiptHeader'), { multiline: true, minRows: 2 })}
              {field('receipt_footer', t('receiptFooter'), { multiline: true, minRows: 2 })}

              <Stack direction="row" justifyContent="flex-end" spacing={1.5}>
                <GlassButton variant="outlined" disabled={!isDirty || save.isPending} onClick={() => store.data && reset(toValues(store.data))}>
                  {tc('cancel')}
                </GlassButton>
                <GlassButton type="submit" loading={save.isPending} disabled={store.isPending}>
                  {tc('save')}
                </GlassButton>
              </Stack>
            </Stack>
          </GlassCard>
        </Grid>
        <Grid item xs={12} md={4}>
          <LogoPanel />
        </Grid>
      </Grid>

      <Snackbar open={Boolean(toast)} autoHideDuration={3000} onClose={() => setToast(null)} message={toast} />
    </Stack>
  );
}

export default function StoreSettingsPage() {
  return (
    <RequireAuth roles={MUTATING_ROLES}>
      <StoreContent />
    </RequireAuth>
  );
}
