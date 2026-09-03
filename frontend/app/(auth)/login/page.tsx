'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import Alert from '@mui/material/Alert';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { useSession } from '@/components/Providers';
import { GlassButton, GlassCard, GlassInput } from '@/components/glass';
import { api, isApiError } from '@/lib/api/client';
import { useApiErrorMessage } from '@/lib/api/errors';
import type { AuthResponse, Role } from '@/lib/auth/session';

interface LoginValues {
  store_code: string;
  username: string;
  password: string;
  platform_admin: boolean;
}

function homeFor(role: Role): string {
  if (role === 'platform_admin') return '/admin/stores';
  if (role === 'cashier') return '/pos';
  return '/dashboard';
}

function safeNext(next: string | null): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/login')) return null;
  return next;
}

function LoginForm() {
  const t = useTranslations('auth');
  const tc = useTranslations('common');
  const tv = useTranslations('validation');
  const router = useRouter();
  const params = useSearchParams();
  const { session, ready, login } = useSession();
  const errorMessage = useApiErrorMessage();

  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const expired = params.get('expired') === '1';
  const next = safeNext(params.get('next'));

  // Already logged in: skip the form.
  useEffect(() => {
    if (ready && session && !expired) router.replace(next ?? homeFor(session.user.role));
  }, [ready, session, expired, next, router]);

  const schema = useMemo(
    () =>
      z
        .object({
          store_code: z.string().trim(),
          username: z.string().trim().min(1, tv('required')),
          password: z.string().min(1, tv('required')),
          platform_admin: z.boolean(),
        })
        .superRefine((v, ctx) => {
          if (!v.platform_admin && !v.store_code) {
            ctx.addIssue({ code: 'custom', path: ['store_code'], message: tv('required') });
          }
        }),
    [tv],
  );

  const {
    control,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(schema),
    defaultValues: { store_code: '', username: '', password: '', platform_admin: false },
  });
  const isPlatformAdmin = watch('platform_admin');

  const onSubmit = async (values: LoginValues) => {
    setFormError(null);
    try {
      const auth = await api.post<AuthResponse>(
        '/auth/login',
        {
          store_code: values.platform_admin ? '' : values.store_code,
          username: values.username,
          password: values.password,
        },
        { noAuth: true },
      );
      login(auth);
      if (auth.user.must_reset_password) router.replace('/settings/password');
      else router.replace(next ?? homeFor(auth.user.role));
    } catch (err) {
      if (isApiError(err) && err.hasFields) {
        let matched = false;
        for (const [field, msg] of Object.entries(err.fields)) {
          if (field === 'store_code' || field === 'username' || field === 'password') {
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
    <GlassCard strong sx={{ width: '100%', maxWidth: 420, p: { xs: 3, sm: 4 } }}>
      <Stack spacing={2.5} component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Avatar sx={{ bgcolor: 'transparent', backgroundImage: (th) => th.glass.gradient, width: 48, height: 48 }}>
            <LockOutlinedIcon />
          </Avatar>
          <LanguageSwitcher />
        </Box>

        <Box>
          <Typography variant="h5" component="h1" fontWeight={700}>
            {t('title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {tc('appName')} · {t('subtitle')}
          </Typography>
        </Box>

        {expired && <Alert severity="warning">{t('sessionExpired')}</Alert>}
        {formError && <Alert severity="error">{formError}</Alert>}

        {!isPlatformAdmin && (
          <Controller
            name="store_code"
            control={control}
            render={({ field }) => (
              <GlassInput
                {...field}
                id="store_code"
                label={t('storeCode')}
                autoComplete="organization"
                autoFocus
                error={Boolean(errors.store_code)}
                helperText={errors.store_code?.message}
                inputProps={{ style: { textTransform: 'uppercase' } }}
              />
            )}
          />
        )}

        <Controller
          name="username"
          control={control}
          render={({ field }) => (
            <GlassInput
              {...field}
              id="username"
              label={t('username')}
              autoComplete="username"
              error={Boolean(errors.username)}
              helperText={errors.username?.message}
            />
          )}
        />

        <Controller
          name="password"
          control={control}
          render={({ field }) => (
            <GlassInput
              {...field}
              id="password"
              type={showPassword ? 'text' : 'password'}
              label={t('password')}
              autoComplete="current-password"
              error={Boolean(errors.password)}
              helperText={errors.password?.message}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label={showPassword ? 'hide password' : 'show password'}
                      onClick={() => setShowPassword((v) => !v)}
                      edge="end"
                      size="small"
                    >
                      {showPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
          )}
        />

        <Controller
          name="platform_admin"
          control={control}
          render={({ field }) => (
            <FormControlLabel
              control={<Checkbox checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />}
              label={<Typography variant="body2">{t('platformAdmin')}</Typography>}
            />
          )}
        />

        <GlassButton type="submit" size="large" loading={isSubmitting} fullWidth>
          {isSubmitting ? t('signingIn') : t('signIn')}
        </GlassButton>

        <Typography variant="caption" color="text.secondary" textAlign="center">
          {t('forgot')}
        </Typography>
      </Stack>
    </GlassCard>
  );
}

export default function LoginPage() {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 2,
      }}
    >
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </Box>
  );
}
