'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { useSession } from '@/components/Providers';
import { GlassButton, GlassCard, GlassInput } from '@/components/glass';
import { api, isApiError } from '@/lib/api/client';
import { useApiErrorMessage } from '@/lib/api/errors';
import { updateSession } from '@/lib/auth/session';

interface Values {
  current_password: string;
  new_password: string;
  confirm_password: string;
}

const MIN_PASSWORD = 8;

export default function ChangePasswordPage() {
  const t = useTranslations('auth');
  const ts = useTranslations('settings');
  const tc = useTranslations('common');
  const tv = useTranslations('validation');
  const router = useRouter();
  const { session } = useSession();
  const errorMessage = useApiErrorMessage();
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const mustReset = session?.user.must_reset_password ?? false;

  const schema = useMemo(
    () =>
      z
        .object({
          current_password: z.string().min(1, tv('required')),
          new_password: z.string().min(MIN_PASSWORD, tv('minLength', { min: MIN_PASSWORD })),
          confirm_password: z.string().min(1, tv('required')),
        })
        .refine((v) => v.new_password === v.confirm_password, {
          path: ['confirm_password'],
          message: t('passwordMismatch'),
        }),
    [tv, t],
  );

  const {
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { current_password: '', new_password: '', confirm_password: '' },
  });

  const onSubmit = async (values: Values) => {
    setFormError(null);
    setDone(false);
    try {
      await api.post<void>(
        '/auth/password/change',
        { current_password: values.current_password, new_password: values.new_password },
        { responseType: 'void' },
      );
      const s = updateSession(session ? { user: { ...session.user, must_reset_password: false } } : {});
      reset();
      setDone(true);
      if (mustReset && s) {
        const role = s.user.role;
        router.replace(role === 'platform_admin' ? '/admin/stores' : role === 'cashier' ? '/pos' : '/dashboard');
      }
    } catch (err) {
      if (isApiError(err) && err.hasFields) {
        let matched = false;
        for (const [field, msg] of Object.entries(err.fields)) {
          if (field === 'current_password' || field === 'new_password') {
            matched = true;
            setError(field, { type: 'server', message: tv.has(msg) ? tv(msg) : msg });
          }
        }
        if (!matched) setFormError(errorMessage(err));
      } else {
        setFormError(errorMessage(err));
      }
    }
  };

  return (
    <Stack spacing={3} sx={{ maxWidth: 520 }}>
      <Typography variant="h4" component="h1" fontWeight={700}>
        {t('changePassword')}
      </Typography>

      <GlassCard>
        <Stack spacing={2.5} component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
          {mustReset && <Alert severity="warning">{t('mustReset')}</Alert>}
          {done && <Alert severity="success">{t('passwordChanged')}</Alert>}
          {formError && <Alert severity="error">{formError}</Alert>}

          <Controller
            name="current_password"
            control={control}
            render={({ field }) => (
              <GlassInput
                {...field}
                type="password"
                label={t('currentPassword')}
                autoComplete="current-password"
                error={Boolean(errors.current_password)}
                helperText={errors.current_password?.message}
              />
            )}
          />
          <Controller
            name="new_password"
            control={control}
            render={({ field }) => (
              <GlassInput
                {...field}
                type="password"
                label={t('newPassword')}
                autoComplete="new-password"
                error={Boolean(errors.new_password)}
                helperText={errors.new_password?.message ?? ts('passwordHint')}
              />
            )}
          />
          <Controller
            name="confirm_password"
            control={control}
            render={({ field }) => (
              <GlassInput
                {...field}
                type="password"
                label={t('confirmPassword')}
                autoComplete="new-password"
                error={Boolean(errors.confirm_password)}
                helperText={errors.confirm_password?.message}
              />
            )}
          />

          <Stack direction="row" spacing={1.5} justifyContent="flex-end">
            {!mustReset && (
              <GlassButton variant="outlined" onClick={() => router.back()}>
                {tc('back')}
              </GlassButton>
            )}
            <GlassButton type="submit" loading={isSubmitting}>
              {tc('save')}
            </GlassButton>
          </Stack>
        </Stack>
      </GlassCard>
    </Stack>
  );
}
