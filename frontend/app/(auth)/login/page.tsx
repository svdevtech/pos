'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Kanit, Prompt } from 'next/font/google';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { useSession } from '@/components/Providers';
import AppFooter from '@/components/AppFooter';
import AuroraCanvas from '@/components/auth/AuroraCanvas';
import LoginShowcase from '@/components/auth/LoginShowcase';
import { GlassButton, GlassCard, GlassInput } from '@/components/glass';

// the sign-in page's own display faces; the rest of the app stays on Sarabun
const kanit = Kanit({ subsets: ['thai', 'latin'], weight: ['400', '600', '800'], variable: '--font-kanit', display: 'swap' });
const prompt = Prompt({ subsets: ['thai', 'latin'], weight: ['500', '700', '800'], variable: '--font-prompt', display: 'swap' });

/** The card's running light border (needs @property for the angle) and the button's sheen. */
const PAGE_CSS = `@property --lg-ang{syntax:'<angle>';inherits:false;initial-value:0deg}
@keyframes lgSpin{to{--lg-ang:360deg}}
@keyframes lgSheen{to{background-position:220% 0}}
@keyframes lgGlint{0%,60%{transform:translateX(-120%)}100%{transform:translateX(120%)}}
@keyframes lgIn{from{opacity:0;transform:translateY(40px) rotateY(20deg)}}
@media (prefers-reduced-motion: reduce){.lg-card,.lg-card::before,.lg-btn,.lg-btn::after{animation:none!important}}`;
import { api, isApiError } from '@/lib/api/client';
import { useApiErrorMessage } from '@/lib/api/errors';
import type { AuthResponse, Role } from '@/lib/auth/session';
import { readDeviceStore, storeFromSearch, writeDeviceStore } from '@/lib/pos/storeParam';

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
  // `?store=CODE` comes from the shop's desktop shortcut; otherwise use what this device was set up
  // with. Either way it is only the starting value of an editable field.
  const [deviceStore, setDeviceStore] = useState('');
  const [storeResolved, setStoreResolved] = useState(false);
  const urlStore = storeFromSearch(params.toString());
  useEffect(() => {
    if (urlStore) writeDeviceStore(urlStore);
    setDeviceStore(urlStore || readDeviceStore());
    setStoreResolved(true);
  }, [urlStore]);

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
    setFocus,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(schema),
    defaultValues: { store_code: '', username: '', password: '', platform_admin: false },
  });
  const isPlatformAdmin = watch('platform_admin');

  // localStorage is only readable on the client, so the field is filled once it is known
  // localStorage is only readable on the client, so the field is filled — and the cursor placed —
  // once the device's store is known
  useEffect(() => {
    if (!storeResolved) return;
    if (deviceStore) {
      setValue('store_code', deviceStore, { shouldValidate: false });
      setFocus('username'); // the store is already known; the cashier types their name
    } else {
      setFocus('store_code');
    }
  }, [storeResolved, deviceStore, setValue, setFocus]);

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
    <GlassCard
      strong
      className="lg-card"
      sx={{
        position: 'relative',
        width: '100%',
        maxWidth: 440,
        p: { xs: 3, sm: 4 },
        borderRadius: '26px',
        color: '#eef2ff',
        background: 'linear-gradient(160deg, rgba(255,255,255,.16), rgba(255,255,255,.05))',
        border: '1px solid rgba(255,255,255,.2)',
        backdropFilter: 'blur(26px) saturate(140%)',
        WebkitBackdropFilter: 'blur(26px) saturate(140%)',
        boxShadow: '0 40px 100px -30px rgba(0,0,0,.95), inset 0 1px 0 rgba(255,255,255,.4)',
        transform: 'rotateY(var(--lg-ry, 6deg)) rotateX(var(--lg-rx, -2deg))',
        transition: 'transform .25s',
        animation: 'lgIn 1.1s cubic-bezier(.2,.8,.2,1) both',
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: -1,
          borderRadius: '26px',
          padding: '1.5px',
          background: 'conic-gradient(from var(--lg-ang, 0deg), #22d3ee, #8b5cf6, #f472b6, #22d3ee)',
          WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
          WebkitMaskComposite: 'xor',
          maskComposite: 'exclude',
          animation: 'lgSpin 6s linear infinite',
          pointerEvents: 'none',
        },
        '& .MuiInputBase-root': { background: 'rgba(4,8,22,.55)', color: '#fff' },
        '& .MuiInputLabel-root, & .MuiFormHelperText-root, & .MuiCheckbox-root, & .MuiIconButton-root': { color: '#a9b6d6' },
        '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(255,255,255,.14)' },
        '& .Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#22d3ee !important', boxShadow: '0 0 0 4px rgba(34,211,238,.18)' },
        '& .MuiInputLabel-root.Mui-focused': { color: '#22d3ee' },
      }}
    >
      {/* method="post" matters before React has hydrated: a form with no method submits as GET, so
          an early click would put the username and password in the URL — and from there into the
          server log, the browser history and any Referer header. */}
      <Stack spacing={2.5} component="form" method="post" onSubmit={handleSubmit(onSubmit)} noValidate>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
            <Box sx={{ width: 40, height: 40, borderRadius: '13px', background: 'linear-gradient(135deg,#22d3ee,#8b5cf6)', boxShadow: '0 10px 30px -8px #8b5cf6', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 18, color: '#fff', fontFamily: 'var(--font-kanit), var(--font-sarabun), sans-serif' }}>
              {tc('appName').slice(0, 1)}
            </Box>
            <Box>
              <Typography sx={{ fontWeight: 600, fontSize: 17, lineHeight: 1.2, fontFamily: 'var(--font-kanit), var(--font-sarabun), sans-serif' }}>{tc('appName')}</Typography>
              <Typography sx={{ fontSize: 11, letterSpacing: '.22em', color: '#9fb0d8', textTransform: 'uppercase' }}>{t('show.tag')}</Typography>
            </Box>
          </Box>
          <LanguageSwitcher />
        </Box>

        <Box>
          <Typography component="h1" sx={{ fontWeight: 800, fontSize: { xs: 28, sm: 32 }, lineHeight: 1.05, letterSpacing: -0.5, fontFamily: 'var(--font-prompt), var(--font-kanit), var(--font-sarabun), sans-serif' }}>
            {t('title')}
          </Typography>
          <Typography variant="body2" sx={{ color: '#a9b6d6', mt: 0.5 }}>
            {t('subtitle')}
          </Typography>
        </Box>

        {expired && <Alert severity="warning">{t('sessionExpired')}</Alert>}
        {formError && <Alert severity="error">{formError}</Alert>}

        {!isPlatformAdmin && (
          <Controller
            name="store_code"
            control={control}
            render={({ field: { ref, ...field } }) => (
              <GlassInput
                {...field}
                inputRef={ref}
                id="store_code"
                label={t('storeCode')}
                autoComplete="organization"
                error={Boolean(errors.store_code)}
                helperText={errors.store_code?.message ?? (deviceStore ? t('storeCodeFromDevice') : undefined)}
                inputProps={{ style: { textTransform: 'uppercase' }, 'data-testid': 'store-code' }}
              />
            )}
          />
        )}

        <Controller
          name="username"
          control={control}
          render={({ field: { ref, ...field } }) => (
            <GlassInput
              {...field}
              inputRef={ref}
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

        <GlassButton
          type="submit"
          size="large"
          loading={isSubmitting}
          fullWidth
          className="lg-btn"
          sx={{
            position: 'relative',
            overflow: 'hidden',
            py: 1.75,
            borderRadius: '14px',
            fontWeight: 700,
            fontSize: 16,
            fontFamily: 'var(--font-prompt), var(--font-kanit), var(--font-sarabun), sans-serif',
            color: '#fff',
            backgroundImage: 'linear-gradient(90deg, #22d3ee, #8b5cf6 55%, #f472b6)',
            backgroundSize: '220% 100%',
            boxShadow: '0 18px 44px -14px rgba(139,92,246,.95)',
            animation: 'lgSheen 5s linear infinite',
            '&::after': { content: '""', position: 'absolute', inset: 0, background: 'linear-gradient(110deg, transparent 40%, rgba(255,255,255,.5) 50%, transparent 60%)', transform: 'translateX(-120%)', animation: 'lgGlint 3.5s ease-in-out infinite', pointerEvents: 'none' },
          }}
        >
          {isSubmitting ? t('signingIn') : t('signIn')}
        </GlassButton>

        <Typography variant="caption" sx={{ color: '#a9b6d6' }} textAlign="center">
          {t('forgot')}
        </Typography>
        {/* the manual is public, so a new shop can read it before it has an account */}
        <Typography
          component={Link}
          href="/guide"
          variant="caption"
          textAlign="center"
          sx={{ color: '#9fd0ff', textDecoration: 'none', fontWeight: 600, '&:hover': { textDecoration: 'underline' } }}
        >
          {t('readGuide')}
        </Typography>
      </Stack>
    </GlassCard>
  );
}

/**
 * The sign-in page: an aurora (WebGL) behind a glass card whose border runs with light, and —
 * on a wide screen — the system's own screens floating beside it in 3D. A spotlight follows the
 * pointer and the card tilts with it, gently, with inertia.
 */
export default function LoginPage() {
  const t = useTranslations('auth');
  const page = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = page.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let tx = 0;
    let ty = 0;
    let px = 0;
    let py = 0;
    let raf = 0;
    const move = (e: PointerEvent) => {
      tx = e.clientX / window.innerWidth - 0.5;
      ty = e.clientY / window.innerHeight - 0.5;
      el.style.setProperty('--lg-mx', `${e.clientX}px`);
      el.style.setProperty('--lg-my', `${e.clientY}px`);
    };
    const loop = () => {
      px += (tx - px) * 0.06;
      py += (ty - py) * 0.06;
      el.style.setProperty('--lg-ry', `${6 + px * 10}deg`);
      el.style.setProperty('--lg-rx', `${-2 - py * 8}deg`);
      raf = requestAnimationFrame(loop);
    };
    window.addEventListener('pointermove', move);
    raf = requestAnimationFrame(loop);
    return () => {
      window.removeEventListener('pointermove', move);
      cancelAnimationFrame(raf);
    };
  }, []);
  return (
    <Box
      ref={page}
      className={`${kanit.variable} ${prompt.variable}`}
      sx={{
        position: 'relative',
        minHeight: '100vh',
        // iOS reports a taller 100vh than it actually shows; dvh tracks the visible area
        '@supports (min-height: 100dvh)': { minHeight: '100dvh' },
        display: 'flex',
        flexDirection: 'column',
        // the card, the showcase and the footer travel as one centred group, so on a tall
        // tablet the copyright line sits under the card instead of stranded at the bottom
        justifyContent: 'center',
        overflow: 'hidden',
        color: '#eef2ff',
        // the CSS gradient is what a device without WebGL sees
        background: 'radial-gradient(1200px 700px at 20% 20%, #17255a 0%, #0b1a4a 35%, #070b17 70%)',
      }}
    >
      {/* a constant string: React would escape the '<' in the @property syntax as text */}
      <style dangerouslySetInnerHTML={{ __html: PAGE_CSS }} />
      <AuroraCanvas />
      <Box aria-hidden sx={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(600px 600px at var(--lg-mx, 30%) var(--lg-my, 50%), rgba(99,179,255,.18), transparent 60%)', mixBlendMode: 'screen' }} />
      <Box
        sx={{
          position: 'relative',
                    display: 'grid',
          // the showcase needs real width: a portrait tablet gets the card and the aurora alone
          gridTemplateColumns: { xs: '1fr', lg: '440px 1fr' },
          alignItems: 'center',
          gap: 3,
          px: { xs: 2, md: '5vw' },
          py: { xs: 3, md: 2 },
          perspective: '1800px',
        }}
      >
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
        <Box sx={{ display: { xs: 'none', lg: 'block' }, minWidth: 0 }}>
          <LoginShowcase />
        </Box>
      </Box>
      <Box aria-hidden sx={{ position: 'absolute', right: '5vw', bottom: 64, textAlign: 'right', pointerEvents: 'none', display: { xs: 'none', md: 'block' } }}>
        <Typography component="p" sx={{ fontWeight: 800, fontSize: 'clamp(28px, 3.2vw, 46px)', lineHeight: 1.05, letterSpacing: -0.5, textShadow: '0 10px 40px rgba(0,0,0,.7)', fontFamily: 'var(--font-prompt), var(--font-kanit), var(--font-sarabun), sans-serif' }}>
          {t('show.tagline1')}
          <br />
          <Box component="span" sx={{ background: 'linear-gradient(90deg,#22d3ee,#a78bfa,#f472b6)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>
            {t('show.tagline2')}
          </Box>
        </Typography>
        <Typography sx={{ color: '#a9b6d6', mt: 1, fontSize: 15 }}>{t('show.taglineSub')}</Typography>
      </Box>
      <Box sx={{ position: 'relative', '& *': { color: '#8d9bbd' } }}>
        <AppFooter pinBottom={false} />
      </Box>
    </Box>
  );
}
