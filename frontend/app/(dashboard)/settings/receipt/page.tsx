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
import { promptPayIdValid } from '@/lib/pos/promptpayId';
import {
  DEFAULT_SERIAL_BAUD,
  SERIAL_BAUD_RATES,
  SERIAL_TRIGGERS,
  chooseDrawerPort,
  forgetDrawerPort,
  pulsePort,
  rememberedDrawerPort,
  serialDrawerSupported,
  type SerialTrigger,
} from '@/lib/pos/serialDrawer';

interface Values {
  paper_width: '58' | '80';
  receipt_locale: 'th' | 'en';
  show_logo: boolean;
  auto_print_receipt: boolean;
  allow_price_edit: boolean;
  require_shift: boolean;
  allow_negative_stock: boolean;
  keypad_mode: 'auto' | 'always' | 'off';
  drawer_kick: 'print' | 'serial' | 'off';
  drawer_serial_trigger: SerialTrigger;
  drawer_serial_baud: string;
  drawer_port: string;
  display_port: string;
  rounding: string;
  promptpay_id: string;
  promptpay_name: string;
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
    drawer_kick: s.drawer_kick === 'off' ? 'off' : s.drawer_kick === 'serial' ? 'serial' : 'print',
    drawer_serial_trigger: (SERIAL_TRIGGERS as string[]).includes(String(s.drawer_serial_trigger)) ? (s.drawer_serial_trigger as SerialTrigger) : 'auto',
    drawer_serial_baud: String(s.drawer_serial_baud ?? DEFAULT_SERIAL_BAUD),
    drawer_port: s.drawer_port ?? '',
    display_port: s.display_port ?? '',
    rounding: s.rounding === undefined || s.rounding === null ? '0' : String(s.rounding),
    promptpay_id: s.promptpay_id ?? '',
    promptpay_name: s.promptpay_name ?? '',
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
    drawer_kick: v.drawer_kick,
    drawer_serial_trigger: v.drawer_serial_trigger,
    drawer_serial_baud: Number(v.drawer_serial_baud) || DEFAULT_SERIAL_BAUD,
    drawer_port: v.drawer_port.trim(),
    display_port: v.display_port.trim(),
    rounding: Number(v.rounding),
    promptpay_id: v.promptpay_id.trim(),
    promptpay_name: v.promptpay_name.trim(),
  };
}

/**
 * The kicker-box half of the cash-drawer settings.
 *
 * Chrome will only show its port chooser inside a click handler, and it only remembers the choice
 * per browser profile — so this lives on screen rather than in the saved settings: the shop picks
 * the port once on each till, and the test button proves the box fires before anyone relies on it.
 */
function SerialDrawerPanel({ trigger, baud, onTrigger, onBaud }: {
  trigger: SerialTrigger;
  baud: string;
  onTrigger: (v: SerialTrigger) => void;
  onBaud: (v: string) => void;
}) {
  const t = useTranslations('settings');
  const toast = useToast();
  const supported = serialDrawerSupported();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supported) return;
    void rememberedDrawerPort().then((p) => setConnected(p !== null));
  }, [supported]);

  const connect = async () => {
    setBusy(true);
    try {
      const port = await chooseDrawerPort();
      setConnected(true);
      await pulsePort(port, { trigger, baudRate: Number(baud) || DEFAULT_SERIAL_BAUD });
      toast.success(t('drawerSerialTested'));
    } catch (e) {
      // the cashier closing Chrome's chooser is not an error worth shouting about
      if ((e as Error)?.name !== 'NotFoundError') toast.error(t('drawerSerialFailed'));
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      const port = await rememberedDrawerPort();
      if (!port) {
        setConnected(false);
        toast.error(t('drawerSerialNoPort'));
        return;
      }
      await pulsePort(port, { trigger, baudRate: Number(baud) || DEFAULT_SERIAL_BAUD });
      toast.success(t('drawerSerialTested'));
    } catch {
      toast.error(t('drawerSerialFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (!supported) return <Alert severity="warning">{t('drawerSerialUnsupported')}</Alert>;

  return (
    <Stack spacing={2}>
      <Alert severity={connected ? 'success' : 'info'}>{connected ? t('drawerSerialConnected') : t('drawerSerialNotConnected')}</Alert>
      <GlassInput
        select
        label={t('drawerSerialTrigger')}
        value={trigger}
        onChange={(e) => onTrigger(e.target.value as SerialTrigger)}
        helperText={t('drawerSerialTriggerHint')}
        inputProps={{ 'data-testid': 'drawer-serial-trigger' }}
      >
        {SERIAL_TRIGGERS.map((v) => (
          <MenuItem key={v} value={v}>
            {t(`drawerTrigger_${v}` as 'drawerTrigger_auto')}
          </MenuItem>
        ))}
      </GlassInput>
      <GlassInput select label={t('drawerSerialBaud')} value={baud} onChange={(e) => onBaud(e.target.value)}>
        {SERIAL_BAUD_RATES.map((v) => (
          <MenuItem key={v} value={String(v)}>
            {v}
          </MenuItem>
        ))}
      </GlassInput>
      <Stack direction="row" spacing={1.5}>
        <GlassButton onClick={connect} loading={busy} data-testid="drawer-serial-connect">
          {connected ? t('drawerSerialReconnect') : t('drawerSerialConnect')}
        </GlassButton>
        <GlassButton variant="outlined" onClick={test} disabled={busy || !connected} data-testid="drawer-serial-test">
          {t('drawerSerialTest')}
        </GlassButton>
        {connected ? (
          <GlassButton
            variant="text"
            onClick={() => {
              forgetDrawerPort();
              setConnected(false);
            }}
          >
            {t('drawerSerialForget')}
          </GlassButton>
        ) : null}
      </Stack>
    </Stack>
  );
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

  const promptPayError = Boolean(values && !promptPayIdValid(values.promptpay_id));

  const submit = () => {
    if (!values) return;
    if (!promptPayIdValid(values.promptpay_id)) {
      setFormError(t('promptPayIdInvalid'));
      return;
    }
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
                <GlassCard title={t('cashDrawer')} subtitle={t('cashDrawerHint')}>
                  <Stack spacing={2}>
                    <GlassInput
                      select
                      label={t('drawerKick')}
                      value={values.drawer_kick}
                      onChange={(e) => set('drawer_kick', e.target.value as Values['drawer_kick'])}
                      helperText={t('drawerKickHint')}
                      inputProps={{ 'data-testid': 'drawer-kick' }}
                    >
                      <MenuItem value="print">{t('drawerKickPrint')}</MenuItem>
                      <MenuItem value="serial">{t('drawerKickSerial')}</MenuItem>
                      <MenuItem value="off">{t('drawerKickOff')}</MenuItem>
                    </GlassInput>
                    {values.drawer_kick === 'serial' ? (
                      <SerialDrawerPanel
                        trigger={values.drawer_serial_trigger}
                        baud={values.drawer_serial_baud}
                        onTrigger={(v) => set('drawer_serial_trigger', v)}
                        onBaud={(v) => set('drawer_serial_baud', v)}
                      />
                    ) : null}
                  </Stack>
                </GlassCard>
                <GlassCard title={t('promptPay')} subtitle={t('promptPayHint')}>
                  <Stack spacing={2}>
                    <GlassInput
                      label={t('promptPayId')}
                      value={values.promptpay_id}
                      onChange={(e) => set('promptpay_id', e.target.value)}
                      placeholder="081-234-5678"
                      helperText={promptPayError ? t('promptPayIdInvalid') : t('promptPayIdHint')}
                      error={promptPayError}
                      inputProps={{ inputMode: 'tel', 'data-testid': 'promptpay-id' }}
                    />
                    <GlassInput
                      label={t('promptPayName')}
                      value={values.promptpay_name}
                      onChange={(e) => set('promptpay_name', e.target.value)}
                      placeholder="Ban Kaen Community Shop"
                      helperText={t('promptPayNameHint')}
                      inputProps={{ maxLength: 25, 'data-testid': 'promptpay-name' }}
                    />
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
