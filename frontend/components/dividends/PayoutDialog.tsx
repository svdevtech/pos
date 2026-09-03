'use client';

import Alert from '@mui/material/Alert';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import dayjs from 'dayjs';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import MoneyField from '@/components/MoneyField';
import QueryError from '@/components/QueryError';
import { GlassButton, GlassDialog, GlassInput, GlassTable, type GlassColumn } from '@/components/glass';
import { resolveLocale } from '@/i18n/config';
import { useApiErrorMessage } from '@/lib/api/errors';
import { decStr, num } from '@/lib/api/hooks/common';
import { PAYOUT_METHODS, useAddPayout, useStatement, type DividendPayout, type PayoutMethod } from '@/lib/api/hooks/dividends';
import { localDateTimeToRfc3339 } from '@/lib/dates';
import { formatDateTime, formatMoney } from '@/lib/format';

export interface PayoutDialogProps {
  statementId: string | null;
  /** Whether the viewer may record payouts (owner + period approved/paid). */
  canPay: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

/** Statement detail with payout history and an "add payout" form (`POST /dividends/statements/{id}/payouts`). */
export default function PayoutDialog({ statementId, canPay, onClose, onSaved }: PayoutDialogProps) {
  const t = useTranslations('dividends');
  const tc = useTranslations('common');
  const locale = resolveLocale(useLocale());
  const errorMessage = useApiErrorMessage();
  const statement = useStatement(statementId);
  const add = useAddPayout();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PayoutMethod>('cash');
  const [paidAt, setPaidAt] = useState('');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const s = statement.data;
  const remaining = num(s?.remaining);

  useEffect(() => {
    if (!statementId) return;
    setMethod('cash');
    setPaidAt(dayjs().format('YYYY-MM-DDTHH:mm'));
    setNote('');
    setFormError(null);
  }, [statementId]);

  useEffect(() => {
    if (s) setAmount(remaining > 0 ? String(remaining) : '');
  }, [s, remaining]);

  const n = num(amount);
  const valid = n > 0 && n <= remaining + 0.005;

  const submit = () => {
    if (!statementId) return;
    setFormError(null);
    add.mutate(
      { statementId, amount: decStr(amount), method, note: note.trim(), paid_at: localDateTimeToRfc3339(paidAt) },
      { onSuccess: () => onSaved?.(), onError: (err) => setFormError(errorMessage(err)) },
    );
  };

  const columns: GlassColumn<DividendPayout>[] = [
    { key: 'paid_at', label: t('paidAt'), width: 160, render: (p) => formatDateTime(p.paid_at, locale) },
    { key: 'method', label: t('payoutMethod'), width: 140, render: (p) => (t.has(`methods.${p.method}`) ? t(`methods.${p.method}`) : p.method) },
    { key: 'amount', label: t('amount'), width: 140, align: 'right', render: (p) => <strong>{formatMoney(p.amount, locale)}</strong> },
    { key: 'note', label: t('note') },
  ];

  return (
    <GlassDialog
      open={Boolean(statementId)}
      onClose={onClose}
      busy={add.isPending}
      maxWidth="sm"
      title={s ? `${s.member_code} · ${s.member_name}` : t('statement')}
      actions={
        <>
          <GlassButton variant="outlined" onClick={onClose} disabled={add.isPending}>
            {tc('close')}
          </GlassButton>
          {canPay && s && remaining > 0 && (
            <GlassButton onClick={submit} loading={add.isPending} disabled={!valid}>
              {t('addPayout')}
            </GlassButton>
          )}
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <QueryError error={statement.error} onRetry={() => statement.refetch()} />
        {formError && <Alert severity="error">{formError}</Alert>}
        {s && (
          <>
            <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
              <Stack>
                <Typography variant="caption" color="text.secondary">
                  {t('shareDividend')}
                </Typography>
                <Typography variant="body2">{formatMoney(s.share_dividend, locale)}</Typography>
              </Stack>
              <Stack>
                <Typography variant="caption" color="text.secondary">
                  {t('rebate')}
                </Typography>
                <Typography variant="body2">{formatMoney(s.rebate, locale)}</Typography>
              </Stack>
              <Stack>
                <Typography variant="caption" color="text.secondary">
                  {t('totalDividend')}
                </Typography>
                <Typography variant="body2" fontWeight={700}>
                  {formatMoney(s.total, locale)}
                </Typography>
              </Stack>
              <Stack>
                <Typography variant="caption" color="text.secondary">
                  {t('paidTotal')}
                </Typography>
                <Typography variant="body2">{formatMoney(s.paid_total, locale)}</Typography>
              </Stack>
              <Stack>
                <Typography variant="caption" color="text.secondary">
                  {t('remaining')}
                </Typography>
                <Typography variant="body2" fontWeight={700} color={remaining > 0 ? 'warning.main' : 'success.main'}>
                  {formatMoney(s.remaining, locale)}
                </Typography>
              </Stack>
            </Stack>
            <Typography variant="subtitle2">{t('payoutHistory')}</Typography>
            <GlassTable columns={columns} rows={s.payouts ?? []} rowKey={(p) => p.id} emptyText={t('noPayouts')} maxHeight={240} />
            {canPay && remaining > 0 && (
              <>
                <Typography variant="subtitle2">{t('addPayout')}</Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <MoneyField label={t('amount')} value={amount} onChange={setAmount} error={amount !== '' && !valid} helperText={n > remaining + 0.005 ? t('payoutExceeds') : undefined} />
                  <GlassInput select label={t('payoutMethod')} value={method} onChange={(e) => setMethod(e.target.value as PayoutMethod)}>
                    {PAYOUT_METHODS.map((m) => (
                      <MenuItem key={m} value={m}>
                        {t(`methods.${m}`)}
                      </MenuItem>
                    ))}
                  </GlassInput>
                </Stack>
                <GlassInput type="datetime-local" label={t('paidAt')} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} InputLabelProps={{ shrink: true }} />
                <GlassInput label={t('note')} value={note} onChange={(e) => setNote(e.target.value)} />
              </>
            )}
          </>
        )}
      </Stack>
    </GlassDialog>
  );
}
