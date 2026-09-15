'use client';

import Box from '@mui/material/Box';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItemOption from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { GlassButton, GlassCard, GlassInput } from '@/components/glass';
import { useToast } from '@/components/Toast';
import { useApiErrorMessage } from '@/lib/api/errors';
import { useSaveStoreSettings, useStoreSettings } from '@/lib/api/hooks/store';
import { fnbKeys } from '@/lib/fnb/api';
import { posKeys } from '@/lib/pos/api';

interface FnbSettings {
  deduct_on: 'on_send' | 'on_ready' | 'on_pay';
  service_charge_pct: string;
  vat_mode: 'none' | 'included' | 'excluded';
  vat_pct: string;
  /** QR orders only from a table staff opened, so a photographed QR cannot order at an empty table. */
  qr_requires_open_table: boolean;
}

const read = (raw: unknown): FnbSettings => {
  const v = (raw ?? {}) as Record<string, unknown>;
  const num = (x: unknown, d: string) => (x === undefined || x === null || x === '' ? d : String(x));
  const deduct = v.deduct_on;
  const vat = v.vat_mode;
  return {
    deduct_on: deduct === 'on_ready' || deduct === 'on_pay' ? deduct : 'on_send',
    service_charge_pct: num(v.service_charge_pct, '0'),
    vat_mode: vat === 'included' || vat === 'excluded' ? vat : 'none',
    vat_pct: num(v.vat_pct, '7'),
    qr_requires_open_table: v.qr_requires_open_table === true,
  };
};

/** The money and stock rules of the F&B side, kept under settings.fnb of the store. */
export default function ShopSettings() {
  const t = useTranslations('fnb.cfg');
  const toast = useToast();
  const qc = useQueryClient();
  const errorMessage = useApiErrorMessage();
  const settings = useStoreSettings();
  const save = useSaveStoreSettings();
  const [form, setForm] = useState<FnbSettings>(() => read(undefined));
  useEffect(() => {
    if (settings.data) setForm(read(settings.data.fnb));
  }, [settings.data]);

  const submit = () => {
    const cur = settings.data ?? {};
    const fnb = { ...((cur.fnb as Record<string, unknown> | undefined) ?? {}), deduct_on: form.deduct_on, service_charge_pct: Number(form.service_charge_pct) || 0, vat_mode: form.vat_mode, vat_pct: Number(form.vat_pct) || 0, qr_requires_open_table: form.qr_requires_open_table };
    save.mutate(
      { ...cur, fnb },
      {
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: posKeys.settings });
          void qc.invalidateQueries({ queryKey: fnbKeys.menu });
          toast.success(t('saved'));
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };

  return (
    <Box sx={{ maxWidth: 720 }}>
      <Stack spacing={2}>
        <GlassCard title={t('stockRules')}>
          <Stack spacing={1.5}>
            <GlassInput select label={t('deductOn')} value={form.deduct_on} onChange={(e) => setForm({ ...form, deduct_on: e.target.value as FnbSettings['deduct_on'] })} data-testid="cfg-deduct-on">
              <MenuItemOption value="on_send">{t('deductOnSend')}</MenuItemOption>
              <MenuItemOption value="on_ready">{t('deductOnReady')}</MenuItemOption>
              <MenuItemOption value="on_pay">{t('deductOnPay')}</MenuItemOption>
            </GlassInput>
            <Typography variant="caption" color="text.secondary">
              {t('deductHint')}
            </Typography>
          </Stack>
        </GlassCard>
        <GlassCard title={t('moneyRules')}>
          <Stack spacing={1.5}>
            <GlassInput label={t('serviceCharge')} type="number" value={form.service_charge_pct} onChange={(e) => setForm({ ...form, service_charge_pct: e.target.value })} inputProps={{ step: 'any', min: 0, max: 100 }} helperText={t('serviceChargeHint')} sx={{ maxWidth: 240 }} data-testid="cfg-service-pct" />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <GlassInput select label={t('vatMode')} value={form.vat_mode} onChange={(e) => setForm({ ...form, vat_mode: e.target.value as FnbSettings['vat_mode'] })} sx={{ minWidth: 260 }} data-testid="cfg-vat-mode">
                <MenuItemOption value="none">{t('vatNone')}</MenuItemOption>
                <MenuItemOption value="included">{t('vatIncluded')}</MenuItemOption>
                <MenuItemOption value="excluded">{t('vatExcluded')}</MenuItemOption>
              </GlassInput>
              <GlassInput label={t('vatPct')} type="number" value={form.vat_pct} onChange={(e) => setForm({ ...form, vat_pct: e.target.value })} inputProps={{ step: 'any', min: 0, max: 100 }} disabled={form.vat_mode === 'none'} sx={{ maxWidth: 160 }} />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {t('vatHint')}
            </Typography>
          </Stack>
        </GlassCard>
        <GlassCard title={t('qrRules')}>
          <FormControlLabel control={<Switch checked={form.qr_requires_open_table} onChange={(_, on) => setForm({ ...form, qr_requires_open_table: on })} data-testid="cfg-qr-gate" />} label={t('qrRequiresOpen')} />
          <Typography variant="caption" color="text.secondary" display="block">
            {t('qrRequiresOpenHint')}
          </Typography>
        </GlassCard>
        <Box>
          <GlassButton onClick={submit} loading={save.isPending} disabled={settings.isPending} data-testid="cfg-save-shop">
            {t('save')}
          </GlassButton>
        </Box>
      </Stack>
    </Box>
  );
}
