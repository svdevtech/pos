'use client';

import Alert from '@mui/material/Alert';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import PageHeader from '@/components/PageHeader';
import RequireAuth from '@/components/RequireAuth';
import { useToast } from '@/components/Toast';
import { GlassButton, GlassCard, GlassInput } from '@/components/glass';
import { locales } from '@/i18n/config';
import { useApiErrorMessage } from '@/lib/api/errors';
import { useSaveStoreSettings, useStoreSettings, type StoreSettings } from '@/lib/api/hooks/store';
import { MUTATING_ROLES } from '@/lib/auth/session';

interface Values {
  paper_width: '58' | '80';
  receipt_locale: 'th' | 'en';
  show_logo: boolean;
  auto_print_receipt: boolean;
  allow_price_edit: boolean;
  require_shift: boolean;
  allow_negative_stock: boolean;
  keypad_mode: 'auto' | 'always' | 'off';
  drawer_port: string;
  display_port: string;
  rounding: string;
}

const ROUNDING_OPTIONS = ['0', '0.25', '0.5', '1'] as const;

function fromSettings(s: StoreSettings): Values {
  const paper = String(s.paper_width ?? '80');
  return {
    paper_width: paper === '58' ? '58' : '80',
    receipt_locale: s.receipt_locale === 'en' ? 'en' : 'th',
    show_logo: s.show_logo ?? true,
    auto_print_receipt: s.auto_print_receipt ?? true,
    allow_price_edit: s.allow_price_edit ?? false,
    require_shift: s.require_shift ?? true,
    allow_negative_stock: s.allow_negative_stock ?? false,
    keypad_mode: s.keypad_mode === 'always' || s.keypad_mode === 'off' ? s.keypad_mode : 'auto',
    drawer_port: s.drawer_port ?? '',
    display_port: s.display_port ?? '',
    rounding: s.rounding === undefined || s.rounding === null ? '0' : String(s.rounding),
  };
}

function toSettings(current: StoreSettings, v: Values): StoreSettings {
  return {
    ...current,
    paper_width: Number(v.paper_width),
    receipt_locale: v.receipt_locale,
    show_logo: v.show_logo,
    auto_print_receipt: v.auto_print_receipt,
    allow_price_edit: v.allow_price_edit,
    require_shift: v.require_shift,
    allow_negative_stock: v.allow_negative_stock,
    keypad_mode: v.keypad_mode,
    drawer_port: v.drawer_port.trim(),
    display_port: v.display_port.trim(),
    rounding: Number(v.rounding),
  };
}

function ReceiptSettingsContent() {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const toast = useToast();
  const errorMessage = useApiErrorMessage();
  const settings = useStoreSettings();
  const save = useSaveStoreSettings();
  const [values, setValues] = useState<Values | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (settings.data && !values) setValues(fromSettings(settings.data));
  }, [settings.data, values]);

  const set = <K extends keyof Values>(key: K, value: Values[K]) => setValues((v) => (v ? { ...v, [key]: value } : v));

  const submit = () => {
    if (!values) return;
    setFormError(null);
    // PUT replaces the whole map: merge with the latest server copy so unrelated keys survive.
    save.mutate(toSettings(settings.data ?? {}, values), {
      onSuccess: (data) => {
        setValues(fromSettings(data ?? {}));
        toast.success(t('settingsSaved'));
      },
      onError: (err) => setFormError(errorMessage(err)),
    });
  };

  const toggle = (key: 'show_logo' | 'auto_print_receipt' | 'allow_price_edit' | 'require_shift' | 'allow_negative_stock', hint: string) =>
    values && (
      <FormControlLabel
        control={<Switch checked={values[key]} onChange={(e) => set(key, e.target.checked)} />}
        label={
          <Stack>
            <Typography variant="body2">{t(key)}</Typography>
            <Typography variant="caption" color="text.secondary">
              {hint}
            </Typography>
          </Stack>
        }
        sx={{ alignItems: 'flex-start', ml: 0 }}
      />
    );

  return (
    <Stack spacing={3} sx={{ maxWidth: 980 }}>
      <PageHeader title={t('receipt')} subtitle={t('receiptSettingsDesc')} backHref="/settings" />
      {settings.isError && (
        <Alert
          severity="error"
          action={
            <GlassButton size="small" variant="text" onClick={() => settings.refetch()}>
              {tc('retry')}
            </GlassButton>
          }
        >
          {errorMessage(settings.error)}
        </Alert>
      )}
      {formError && <Alert severity="error">{formError}</Alert>}
      {!values && !settings.isError && <Skeleton variant="rounded" height={360} />}

      {values && (
        <>
          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <GlassCard title={t('receiptLayout')}>
                <Stack spacing={2}>
                  <GlassInput select label={t('paperWidth')} value={values.paper_width} onChange={(e) => set('paper_width', e.target.value as Values['paper_width'])}>
                    <MenuItem value="58">58 {t('mm')}</MenuItem>
                    <MenuItem value="80">80 {t('mm')}</MenuItem>
                  </GlassInput>
                  <GlassInput select label={t('receiptLocale')} value={values.receipt_locale} onChange={(e) => set('receipt_locale', e.target.value as Values['receipt_locale'])}>
                    {locales.map((l) => (
                      <MenuItem key={l} value={l}>
                        {l === 'th' ? tc('thai') : tc('english')}
                      </MenuItem>
                    ))}
                  </GlassInput>
                  {toggle('show_logo', t('showLogoHint'))}
                  {toggle('auto_print_receipt', t('autoPrintReceiptHint'))}
                  <GlassInput select label={t('rounding')} value={values.rounding} onChange={(e) => set('rounding', e.target.value)} helperText={t('roundingHint')}>
                    {ROUNDING_OPTIONS.map((r) => (
                      <MenuItem key={r} value={r}>
                        {r === '0' ? t('noRounding') : `฿ ${r}`}
                      </MenuItem>
                    ))}
                  </GlassInput>
                </Stack>
              </GlassCard>
            </Grid>
            <Grid item xs={12} md={6}>
              <Stack spacing={3}>
                <GlassCard title={t('posBehaviour')}>
                  <Stack spacing={2}>
                    {toggle('require_shift', t('requireShiftHint'))}
                    {toggle('allow_price_edit', t('allowPriceEditHint'))}
                    {toggle('allow_negative_stock', t('allowNegativeStockHint'))}
                    <GlassInput
                      select
                      label={t('keypadMode')}
                      value={values.keypad_mode}
                      onChange={(e) => set('keypad_mode', e.target.value as Values['keypad_mode'])}
                      helperText={t('keypadModeHint')}
                    >
                      <MenuItem value="auto">{t('keypadAuto')}</MenuItem>
                      <MenuItem value="always">{t('keypadAlways')}</MenuItem>
                      <MenuItem value="off">{t('keypadOff')}</MenuItem>
                    </GlassInput>
                  </Stack>
                </GlassCard>
                <GlassCard title={t('hardware')} subtitle={t('portHint')}>
                  <Stack spacing={2}>
                    <GlassInput label={t('drawerPort')} value={values.drawer_port} onChange={(e) => set('drawer_port', e.target.value)} placeholder="COM3" />
                    <GlassInput label={t('displayPort')} value={values.display_port} onChange={(e) => set('display_port', e.target.value)} placeholder="COM4" />
                  </Stack>
                </GlassCard>
              </Stack>
            </Grid>
          </Grid>
          <Stack direction="row" justifyContent="flex-end" spacing={1.5}>
            <GlassButton variant="outlined" onClick={() => settings.data && setValues(fromSettings(settings.data))} disabled={save.isPending}>
              {tc('cancel')}
            </GlassButton>
            <GlassButton onClick={submit} loading={save.isPending}>
              {tc('save')}
            </GlassButton>
          </Stack>
        </>
      )}
    </Stack>
  );
}

export default function ReceiptSettingsPage() {
  return (
    <RequireAuth roles={MUTATING_ROLES}>
      <ReceiptSettingsContent />
    </RequireAuth>
  );
}
