'use client';

import CameraAltIcon from '@mui/icons-material/CameraAlt';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import MemberAutocomplete from '@/components/MemberAutocomplete';
import MoneyField from '@/components/MoneyField';
import { useToast } from '@/components/Toast';
import { GlassButton, GlassDialog, GlassInput } from '@/components/glass';
import PromptPayQR from '@/components/pos/PromptPayQR';
import SlipCaptureDialog from '@/components/pos/SlipCaptureDialog';
import { resolveLocale } from '@/i18n/config';
import { isApiError } from '@/lib/api/client';
import { useApiErrorMessage } from '@/lib/api/errors';
import { useMemberBills, useReceivePayment } from '@/lib/api/hooks/ar';
import { RECEIVE_METHODS, decStr, num, type PaymentMethod } from '@/lib/api/hooks/common';
import type { Member } from '@/lib/api/hooks/members';
import { localDateTimeToRfc3339 } from '@/lib/dates';
import { formatMoney } from '@/lib/format';
import { posApi, posKeys } from '@/lib/pos/api';
import type { CapturedPhoto } from '@/lib/pos/photoCapture';

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
  const tp = useTranslations('pos');
  const tc = useTranslations('common');
  const locale = resolveLocale(useLocale());
  const errorMessage = useApiErrorMessage();
  const toast = useToast();
  const pay = useReceivePayment();

  const [picked, setPicked] = useState<Member | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [paidAt, setPaidAt] = useState('');
  // what the date field showed when the dialog opened: left alone, the payment is stamped by the
  // server's clock to the second, which is the clock a shift's opening time comes from too
  const [paidAtShown, setPaidAtShown] = useState('');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  // the slip is photographed while the customer is still standing there, and uploaded once the
  // receipt exists and has an id
  const [slip, setSlip] = useState<CapturedPhoto | null>(null);
  const [slipOpen, setSlipOpen] = useState(false);

  const memberId = member?.id ?? picked?.id ?? null;
  const bills = useMemberBills(open ? memberId : null);
  const outstanding = bill ? num(bill.ar_balance) : num(bills.data?.balance);

  useEffect(() => {
    if (!open) return;
    setPicked(null);
    setAmount(bill ? String(num(bill.ar_balance)) : '');
    setMethod('cash');
    const now = dayjs().format('YYYY-MM-DDTHH:mm');
    setPaidAt(now);
    setPaidAtShown(now);
    setNote('');
    setFormError(null);
    setSlip(null);
  }, [open, bill]);

  const n = num(amount);
  const valid = Boolean(memberId) && n > 0;

  // Money that arrives in the bank needs the same treatment as at the till: a code to scan and a
  // photograph of what the customer's app said.
  const showQR = method === 'qr';
  const needsSlip = method === 'qr' || method === 'transfer';
  const qr = useQuery({
    queryKey: posKeys.paymentQR(n),
    queryFn: () => posApi.paymentQR(n),
    enabled: open && showQR && n > 0,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const qrUnset = isApiError(qr.error) && qr.error.code === 'PROMPTPAY_NOT_SET';

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
        // only a date the cashier changed is sent (back-dating); otherwise "now" is the server's
        paid_at: paidAt && paidAt !== paidAtShown ? localDateTimeToRfc3339(paidAt) : undefined,
      },
      {
        onSuccess: async (rows) => {
          // one receipt can settle several bills; the photograph belongs to the receipt, so any of
          // its rows will do — the server files it under the document number
          const receipt = rows?.[0];
          if (slip && receipt) {
            try {
              await posApi.attachARSlip(receipt.id, { image: slip.dataUrl, mime: slip.mime, amount: n, method });
            } catch {
              toast.error(tp('slipUploadFailedAR'));
            }
          }
          onSaved?.();
        },
        onError: (err) => setFormError(errorMessage(err)),
      },
    );
  };

  return (
    <GlassDialog
      open={open}
      onClose={onClose}
      busy={pay.isPending}
      maxWidth="sm"
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
        {showQR && n > 0 && (
          <Box
            sx={{ borderRadius: 3, p: 2, background: (th) => th.glass.surfaceStrong, border: (th) => `1px solid ${th.glass.border}` }}
            data-testid="ar-qr-panel"
          >
            {qrUnset ? (
              <Alert severity="info" data-testid="qr-not-configured">
                {tp('promptPayNotSet')}
              </Alert>
            ) : qr.isError ? (
              <Alert severity="warning">{tp('promptPayFailed')}</Alert>
            ) : qr.data ? (
              <Stack spacing={1} alignItems="center">
                <Typography variant="subtitle2">{tp('scanToPay', { amount: formatMoney(n, locale) })}</Typography>
                <PromptPayQR payload={qr.data.payload} size={200} caption={tp('promptPayTo', { id: qr.data.masked_id })} />
              </Stack>
            ) : (
              <Stack alignItems="center" sx={{ py: 3 }}>
                <CircularProgress size={24} />
              </Stack>
            )}
          </Box>
        )}

        {needsSlip && (
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <GlassButton
              variant={slip ? 'outlined' : 'contained'}
              size="small"
              startIcon={slip ? <CheckCircleIcon /> : <CameraAltIcon />}
              onClick={() => setSlipOpen(true)}
              data-testid="ar-slip-capture-open"
            >
              {slip ? tp('slipAttached') : tp('slipCapture')}
            </GlassButton>
            {slip && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={slip.dataUrl}
                  alt={tp('slipCaptureTitle')}
                  style={{ height: 44, borderRadius: 6, border: '1px solid rgba(255,255,255,0.25)' }}
                  data-testid="ar-slip-thumb"
                />
                <GlassButton variant="text" size="small" color="warning" onClick={() => setSlip(null)} data-testid="ar-slip-clear">
                  {tp('slipRemove')}
                </GlassButton>
              </>
            )}
          </Stack>
        )}

        <GlassInput type="datetime-local" label={t('paymentDate')} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} InputLabelProps={{ shrink: true }} />
        <GlassInput label={tc('notes')} value={note} onChange={(e) => setNote(e.target.value)} multiline minRows={2} />
      </Stack>
      <SlipCaptureDialog
        open={slipOpen}
        onClose={() => setSlipOpen(false)}
        onCapture={setSlip}
        amountLabel={tp('slipForAmount', { amount: formatMoney(n, locale) })}
      />
    </GlassDialog>
  );
}
