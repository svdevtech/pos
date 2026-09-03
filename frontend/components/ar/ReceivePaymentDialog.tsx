'use client';

import Alert from '@mui/material/Alert';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import dayjs from 'dayjs';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import MemberAutocomplete from '@/components/MemberAutocomplete';
import MoneyField from '@/components/MoneyField';
import { GlassButton, GlassDialog, GlassInput } from '@/components/glass';
import { resolveLocale } from '@/i18n/config';
import { useApiErrorMessage } from '@/lib/api/errors';
import { useMemberBills, useReceivePayment } from '@/lib/api/hooks/ar';
import { RECEIVE_METHODS, decStr, num, type PaymentMethod } from '@/lib/api/hooks/common';
import type { Member } from '@/lib/api/hooks/members';
import { localDateTimeToRfc3339 } from '@/lib/dates';
import { formatMoney } from '@/lib/format';

export interface PaymentTarget {
  /** Member to receive from; when omitted the dialog asks for one. */
  member?: Pick<Member, 'id' | 'member_code' | 'name'> | null;
  /** Bill to settle; omitted = oldest-first allocation. */
  bill?: { id: string; doc_no: string; ar_balance: string | number } | null;
}

export interface ReceivePaymentDialogProps extends PaymentTarget {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

/** Records an AR payment (`POST /ar/payments`). */
export default function ReceivePaymentDialog({ open, member, bill, onClose, onSaved }: ReceivePaymentDialogProps) {
  const t = useTranslations('ar');
  const tc = useTranslations('common');
  const locale = resolveLocale(useLocale());
  const errorMessage = useApiErrorMessage();
  const pay = useReceivePayment();

  const [picked, setPicked] = useState<Member | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [paidAt, setPaidAt] = useState('');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const memberId = member?.id ?? picked?.id ?? null;
  const bills = useMemberBills(open ? memberId : null);
  const outstanding = bill ? num(bill.ar_balance) : num(bills.data?.balance);

  useEffect(() => {
    if (!open) return;
    setPicked(null);
    setAmount(bill ? String(num(bill.ar_balance)) : '');
    setMethod('cash');
    setPaidAt(dayjs().format('YYYY-MM-DDTHH:mm'));
    setNote('');
    setFormError(null);
  }, [open, bill]);

  const n = num(amount);
  const valid = Boolean(memberId) && n > 0;

  const submit = () => {
    if (!memberId) return;
    setFormError(null);
    pay.mutate(
      {
        member_id: memberId,
        sale_id: bill?.id ?? null,
        amount: decStr(amount),
        method,
        note: note.trim(),
        paid_at: localDateTimeToRfc3339(paidAt),
      },
      {
        onSuccess: () => onSaved?.(),
        onError: (err) => setFormError(errorMessage(err)),
      },
    );
  };

  return (
    <GlassDialog
      open={open}
      onClose={onClose}
      busy={pay.isPending}
      maxWidth="xs"
      title={t('receivePayment')}
      actions={
        <>
          <GlassButton variant="outlined" onClick={onClose} disabled={pay.isPending}>
            {tc('cancel')}
          </GlassButton>
          <GlassButton onClick={submit} loading={pay.isPending} disabled={!valid}>
            {t('receivePayment')}
          </GlassButton>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        {formError && <Alert severity="error">{formError}</Alert>}
        {member ? (
          <Typography variant="body2">
            {t('member')}: <strong>{member.member_code}</strong> · {member.name}
          </Typography>
        ) : (
          <MemberAutocomplete value={picked} onChange={setPicked} label={t('member')} autoFocus />
        )}
        {bill ? (
          <Typography variant="body2" color="text.secondary">
            {t('specificBill')}: <strong>{bill.doc_no}</strong> · {t('remaining')} {formatMoney(bill.ar_balance, locale)}
          </Typography>
        ) : (
          memberId && (
            <Typography variant="body2" color="text.secondary">
              {t('payOldestFirst')} · {t('outstanding')} {bills.isPending ? tc('loading') : formatMoney(outstanding, locale)}
            </Typography>
          )
        )}
        <MoneyField
          label={t('payAmount')}
          value={amount}
          onChange={setAmount}
          autoFocus={Boolean(member)}
          error={amount !== '' && n <= 0}
          helperText={n > outstanding && outstanding > 0 ? t('amountExceeds') : undefined}
        />
        <GlassInput select label={t('method')} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
          {RECEIVE_METHODS.map((m) => (
            <MenuItem key={m} value={m}>
              {t(`methods.${m}`)}
            </MenuItem>
          ))}
        </GlassInput>
        <GlassInput type="datetime-local" label={t('paymentDate')} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} InputLabelProps={{ shrink: true }} />
        <GlassInput label={tc('notes')} value={note} onChange={(e) => setNote(e.target.value)} multiline minRows={2} />
      </Stack>
    </GlassDialog>
  );
}
