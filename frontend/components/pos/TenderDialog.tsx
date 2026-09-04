'use client';

import AddIcon from '@mui/icons-material/Add';
import CameraAltIcon from '@mui/icons-material/CameraAlt';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DialpadIcon from '@mui/icons-material/Dialpad';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import FormControlLabel from '@mui/material/FormControlLabel';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { GlassButton, GlassDialog, GlassInput } from '@/components/glass';
import NumericKeypad, { applyKey, keypadDefault, readKeypadOverride, writeKeypad, type KeypadMode } from '@/components/pos/NumericKeypad';
import PromptPayQR from '@/components/pos/PromptPayQR';
import SlipCaptureDialog from '@/components/pos/SlipCaptureDialog';
import { resolveLocale } from '@/i18n/config';
import { isApiError } from '@/lib/api/client';
import { formatMoney } from '@/lib/format';
import { posApi, posKeys } from '@/lib/pos/api';
import type { CapturedPhoto } from '@/lib/pos/photoCapture';
import { PAYMENT_METHODS, money, type Member, type PaymentMethod, type TenderInput } from '@/lib/pos/types';

interface Row {
  id: number;
  method: PaymentMethod;
  amount: string;
  reference: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Amount due (server-quoted net). */
  net: number;
  member: Member | null;
  onConfirm: (payments: TenderInput[], printReceipt: boolean, slip?: CapturedPhoto | null) => Promise<void> | void;
  /** Default of the "print receipt" checkbox (store setting, overridden per device). */
  defaultPrintReceipt?: boolean;
  /** Persists the cashier's choice for the next bill. */
  onPrintReceiptChange?: (on: boolean) => void;
  /** Store setting: `auto` shows the numeric keypad on touch devices, `always`/`off` force it. */
  keypadMode?: KeypadMode;
  busy?: boolean;
  error?: string | null;
}

const QUICK_NOTES = [20, 50, 100, 500, 1000] as const;
const NEEDS_REFERENCE: readonly PaymentMethod[] = ['transfer', 'card', 'qr'];

let rowSeq = 0;
const newRow = (method: PaymentMethod, amount = ''): Row => ({ id: ++rowSeq, method, amount, reference: '' });

function num(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Settlement maths mirrored from salesuc.Settle (server is authoritative). */
export function settle(net: number, rows: Row[]) {
  let cash = 0;
  let nonCash = 0;
  let hasCredit = false;
  let creditReq = 0;
  for (const r of rows) {
    const a = num(r.amount);
    if (r.method === 'cash') cash += a;
    else if (r.method === 'credit') {
      hasCredit = true;
      creditReq += a;
    } else nonCash += a;
  }
  const nonCashExceeds = nonCash > net + 1e-9;
  let remaining = money(net - nonCash);
  let credit = 0;
  if (hasCredit) {
    credit = creditReq > 0 ? creditReq : Math.max(0, money(remaining - cash));
    if (credit > remaining) credit = remaining;
    remaining = money(remaining - credit);
  }
  const short = cash < remaining ? money(remaining - cash) : 0;
  const change = cash > remaining ? money(cash - remaining) : 0;
  return { cash, nonCash, credit, remaining, short, change, nonCashExceeds, valid: !nonCashExceeds && short === 0 && net >= 0 };
}

export default function TenderDialog({
  open,
  onClose,
  net,
  member,
  onConfirm,
  busy = false,
  error,
  defaultPrintReceipt = true,
  onPrintReceiptChange,
  keypadMode = 'auto',
}: Props) {
  const [printReceipt, setPrintReceipt] = useState(defaultPrintReceipt);
  // The built-in keypad replaces the OS keyboard, which would otherwise cover the dialog on a
  // tablet. The store setting decides whether it opens by itself; the button below overrides that
  // on this device.
  const [keypadOn, setKeypadOn] = useState(false);
  const [activeRow, setActiveRow] = useState<number | null>(null);
  // The slip photo is taken before the bill exists, so it is held here and uploaded by the POS
  // page once the sale has an id.
  const [slip, setSlip] = useState<CapturedPhoto | null>(null);
  const [slipOpen, setSlipOpen] = useState(false);
  const t = useTranslations('pos');
  const locale = resolveLocale(useLocale());
  const [rows, setRows] = useState<Row[]>([newRow('cash')]);

  useEffect(() => {
    if (open) {
      const first = newRow('cash', '');
      setRows([first]);
      setActiveRow(first.id);
      setPrintReceipt(defaultPrintReceipt);
      setKeypadOn(readKeypadOverride() ?? keypadDefault(keypadMode));
      setSlip(null);
    }
  }, [open, defaultPrintReceipt, keypadMode]);

  const creditAllowed = Boolean(member && !member.is_walkin);
  const s = useMemo(() => settle(net, rows), [net, rows]);

  // The QR only appears once the cashier picks that tender; the amount on the code is whatever
  // that row is set to, falling back to the whole bill while it is still empty.
  const qrRow = rows.find((r) => r.method === 'qr');
  const qrAmount = qrRow ? (num(qrRow.amount) > 0 ? money(num(qrRow.amount)) : money(net)) : 0;
  const qr = useQuery({
    queryKey: posKeys.paymentQR(qrAmount),
    queryFn: () => posApi.paymentQR(qrAmount),
    enabled: open && Boolean(qrRow) && qrAmount > 0,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const qrUnset = isApiError(qr.error) && qr.error.code === 'PROMPTPAY_NOT_SET';
  // transfers and card payments land in the bank too, so a slip is worth keeping for those
  const needsSlip = rows.some((r) => r.method === 'qr' || r.method === 'transfer');

  const update = (id: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id: number) => setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : rs));
  const addRow = () => {
    const used = new Set(rows.map((r) => r.method));
    const next = PAYMENT_METHODS.find((m) => !used.has(m) && (m !== 'credit' || creditAllowed)) ?? 'other';
    setRows((rs) => [...rs, newRow(next, '')]);
  };

  const cashRowId = () => {
    const r = rows.find((x) => x.method === 'cash');
    if (r) return r.id;
    const created = newRow('cash');
    setRows((rs) => [created, ...rs]);
    return created.id;
  };

  const setCash = (amount: number) => {
    const id = cashRowId();
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, amount: amount > 0 ? String(money(amount)) : '' } : r)));
  };
  const addCash = (amount: number) => {
    const id = cashRowId();
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, amount: String(money(num(r.amount) + amount)) } : r)));
  };

  const exact = () => {
    // cash covers whatever is left after non-cash / credit rows
    const others = rows.filter((r) => r.method !== 'cash');
    const s2 = settle(net, others);
    setCash(s2.remaining);
  };

  const payments = (): TenderInput[] =>
    rows
      .map((r) => ({
        method: r.method,
        amount: r.method === 'credit' ? money(s.credit) : money(num(r.amount)),
        reference: r.reference.trim() || undefined,
      }))
      .filter((p) => p.amount > 0 || p.method === 'cash');

  const confirm = () => {
    if (!s.valid || busy) return;
    void onConfirm(payments(), printReceipt, slip);
  };

  const methodLabel = (m: PaymentMethod) => t(`methods.${m}`);

  return (
    <GlassDialog
      open={open}
      onClose={busy ? undefined : onClose}
      busy={busy}
      title={t('tenderTitle')}
      maxWidth="md"
      actions={
        <>
          <GlassButton variant="text" onClick={onClose} disabled={busy}>
            {t('cancelAction')}
          </GlassButton>
          <GlassButton size="large" onClick={confirm} disabled={!s.valid} loading={busy} data-testid="tender-confirm" sx={{ minWidth: 200 }}>
            {t('confirmPayment')} (Enter)
          </GlassButton>
        </>
      }
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !(e.target as HTMLElement).closest('textarea')) {
          e.preventDefault();
          confirm();
        }
      }}
    >
      <Grid container spacing={3}>
        {/* tablets/phones: the full summary panel sits below the fold once the keyboard opens,
            so repeat the three numbers the cashier needs while typing as a sticky strip */}
        <Grid item xs={12} sx={{ display: { xs: 'block', md: 'none' } }}>
          <Stack
            direction="row"
            spacing={2}
            justifyContent="space-between"
            sx={{
              position: 'sticky',
              top: 0,
              zIndex: 2,
              py: 1,
              px: 1.5,
              borderRadius: 2,
              background: (th) => th.glass.surfaceStrong,
              border: (th) => `1px solid ${th.glass.border}`,
            }}
          >
            <Stack>
              <Typography variant="caption" color="text.secondary">
                {t('amountDue')}
              </Typography>
              <Typography variant="h6" fontWeight={800} sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatMoney(net, locale)}
              </Typography>
            </Stack>
            <Stack alignItems="flex-end">
              <Typography variant="caption" color="text.secondary">
                {s.short > 0 ? t('shortBy') : t('change')}
              </Typography>
              <Typography
                variant="h6"
                fontWeight={800}
                color={s.short > 0 ? 'error.main' : 'success.main'}
                sx={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {formatMoney(s.short > 0 ? s.short : s.change, locale)}
              </Typography>
            </Stack>
          </Stack>
        </Grid>

        <Grid item xs={12} md={7}>
          <Stack spacing={1.5}>
            {rows.map((r) => (
              <Stack key={r.id} direction="row" spacing={1} alignItems="flex-start">
                <GlassInput
                  select
                  size="small"
                  value={r.method}
                  onChange={(e) => update(r.id, { method: e.target.value as PaymentMethod, amount: e.target.value === 'credit' ? '' : r.amount })}
                  sx={{ width: 160, flexShrink: 0 }}
                  inputProps={{ 'aria-label': t('paymentMethod') }}
                >
                  {PAYMENT_METHODS.map((m) => (
                    <MenuItem key={m} value={m} disabled={m === 'credit' && !creditAllowed}>
                      {methodLabel(m)}
                    </MenuItem>
                  ))}
                  <MenuItem value="other">{methodLabel('other')}</MenuItem>
                </GlassInput>
                <GlassInput
                  size="small"
                  type={keypadOn ? 'text' : 'number'}
                  value={r.method === 'credit' ? String(s.credit) : r.amount}
                  onChange={(e) => update(r.id, { amount: e.target.value })}
                  onFocus={(e) => {
                    setActiveRow(r.id);
                    if (!keypadOn) e.target.select();
                  }}
                  onClick={() => setActiveRow(r.id)}
                  autoFocus={!keypadOn && r.method === 'cash' && rows.length === 1}
                  placeholder="0.00"
                  helperText={r.method === 'credit' ? t('creditRemainderHint') : undefined}
                  inputProps={{
                    min: 0,
                    step: 0.25,
                    // 'none' keeps the OS keyboard closed; the dialog's own keypad is used instead
                    inputMode: keypadOn ? 'none' : 'decimal',
                    readOnly: keypadOn,
                    'data-testid': `tender-amount-${r.method}`,
                    style: { textAlign: 'right', fontSize: 20 },
                  }}
                  sx={
                    keypadOn && activeRow === r.id
                      ? { '& .MuiOutlinedInput-notchedOutline': { borderColor: 'primary.main', borderWidth: 2 } }
                      : undefined
                  }
                  disabled={r.method === 'credit'}
                />
                {NEEDS_REFERENCE.includes(r.method) && (
                  <GlassInput
                    size="small"
                    value={r.reference}
                    onChange={(e) => update(r.id, { reference: e.target.value })}
                    placeholder={t('reference')}
                    inputProps={{ 'aria-label': t('reference') }}
                  />
                )}
                <IconButton aria-label={t('remove')} onClick={() => remove(r.id)} disabled={rows.length === 1} sx={{ mt: 0.5 }}>
                  <DeleteOutlineIcon />
                </IconButton>
              </Stack>
            ))}
            <Box>
              <GlassButton variant="text" size="small" startIcon={<AddIcon />} onClick={addRow}>
                {t('addTender')}
              </GlassButton>
              {!creditAllowed && (
                <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                  {t('creditNeedsMember')}
                </Typography>
              )}
            </Box>

            {/* PromptPay: the customer scans this, pays, and shows the confirmation slip */}
            {qrRow && (
              <Box
                sx={{
                  borderRadius: 3,
                  p: 2,
                  background: (th) => th.glass.surfaceStrong,
                  border: (th) => `1px solid ${th.glass.border}`,
                }}
                data-testid="qr-panel"
              >
                {qrUnset ? (
                  <Alert severity="info" data-testid="qr-not-configured">
                    {t('promptPayNotSet')}
                  </Alert>
                ) : qr.isError ? (
                  <Alert severity="warning">{t('promptPayFailed')}</Alert>
                ) : qr.data ? (
                  <Stack spacing={1} alignItems="center">
                    <Typography variant="subtitle2">{t('scanToPay', { amount: formatMoney(qrAmount, locale) })}</Typography>
                    <PromptPayQR payload={qr.data.payload} size={220} caption={t('promptPayTo', { id: qr.data.masked_id })} />
                  </Stack>
                ) : (
                  <Stack alignItems="center" sx={{ py: 3 }}>
                    <CircularProgress size={24} />
                  </Stack>
                )}
              </Box>
            )}

            {/* a slip belongs to any payment that arrives in the bank, not only to the QR */}
            {needsSlip && (
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <GlassButton
                  variant={slip ? 'outlined' : 'contained'}
                  size="small"
                  startIcon={slip ? <CheckCircleIcon /> : <CameraAltIcon />}
                  onClick={() => setSlipOpen(true)}
                  data-testid="slip-capture-open"
                >
                  {slip ? t('slipAttached') : t('slipCapture')}
                </GlassButton>
                {slip && (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={slip.dataUrl}
                      alt={t('slipCaptureTitle')}
                      style={{ height: 48, borderRadius: 6, border: '1px solid rgba(255,255,255,0.25)' }}
                      data-testid="slip-thumb"
                    />
                    <GlassButton variant="text" size="small" color="warning" onClick={() => setSlip(null)} data-testid="slip-clear">
                      {t('slipRemove')}
                    </GlassButton>
                  </>
                )}
              </Stack>
            )}

            <Divider />
            <Typography variant="subtitle2" color="text.secondary">
              {t('quickCash')}
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <GlassButton variant="outlined" onClick={exact} data-testid="quick-exact">
                {t('exactAmount')}
              </GlassButton>
              {QUICK_NOTES.map((n) => (
                <GlassButton key={n} variant="outlined" onClick={() => addCash(n)} data-testid={`quick-${n}`}>
                  +{n}
                </GlassButton>
              ))}
              <GlassButton variant="text" color="warning" onClick={() => setCash(0)}>
                {t('clearCash')}
              </GlassButton>
            </Stack>

            <Box>
              <GlassButton
                variant="text"
                size="small"
                startIcon={<DialpadIcon />}
                onClick={() => {
                  const next = !keypadOn;
                  setKeypadOn(next);
                  writeKeypad(next); // remember it for this device
                }}
                data-testid="keypad-toggle"
              >
                {keypadOn ? t('hideKeypad') : t('showKeypad')}
              </GlassButton>
            </Box>

            {keypadOn && (
              <NumericKeypad
                disabled={!activeRow || rows.find((r) => r.id === activeRow)?.method === 'credit'}
                onKey={(k) => {
                  const row = rows.find((r) => r.id === activeRow) ?? rows[0];
                  if (!row || row.method === 'credit') return;
                  update(row.id, { amount: applyKey(row.amount, k) });
                }}
              />
            )}

            <Divider />
            <FormControlLabel
              control={
                <Checkbox
                  checked={printReceipt}
                  onChange={(e) => {
                    setPrintReceipt(e.target.checked);
                    onPrintReceiptChange?.(e.target.checked);
                  }}
                  inputProps={{ 'aria-label': t('printReceipt'), 'data-testid': 'tender-print-receipt' } as React.InputHTMLAttributes<HTMLInputElement>}
                />
              }
              label={
                <Stack>
                  <Typography variant="body2">{t('printReceipt')}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('printReceiptHint')}
                  </Typography>
                </Stack>
              }
              sx={{ alignItems: 'flex-start', ml: 0 }}
            />
          </Stack>
        </Grid>

        <Grid item xs={12} md={5}>
          <Box
            sx={{
              borderRadius: 3,
              p: 2.5,
              background: (th) => th.glass.surfaceStrong,
              border: (th) => `1px solid ${th.glass.border}`,
            }}
          >
            {/* on tablets the sticky strip above already shows this, so don't spend the height twice */}
            <Box sx={{ display: { xs: 'none', md: 'block' } }}>
              <Typography variant="body2" color="text.secondary">
                {t('amountDue')}
              </Typography>
              <Typography variant="h3" fontWeight={800} sx={{ fontVariantNumeric: 'tabular-nums' }} data-testid="tender-net">
                {formatMoney(net, locale)}
              </Typography>
              <Divider sx={{ my: 1.5 }} />
            </Box>
            <Stack spacing={0.5}>
              <Row label={t('methods.cash')} value={formatMoney(s.cash, locale)} />
              {s.nonCash > 0 && <Row label={t('nonCash')} value={formatMoney(s.nonCash, locale)} />}
              {s.credit > 0 && <Row label={t('methods.credit')} value={formatMoney(s.credit, locale)} highlight="warning.main" />}
              {s.short > 0 && <Row label={t('shortBy')} value={formatMoney(s.short, locale)} highlight="error.main" />}
            </Stack>
            <Divider sx={{ my: 1.5 }} />
            <Typography variant="body2" color="text.secondary">
              {t('change')}
            </Typography>
            <Typography
              variant="h4"
              fontWeight={800}
              color={s.change > 0 ? 'success.main' : 'text.primary'}
              sx={{ fontVariantNumeric: 'tabular-nums' }}
              data-testid="tender-change"
            >
              {formatMoney(s.change, locale)}
            </Typography>
            {s.nonCashExceeds && (
              <Alert severity="error" sx={{ mt: 1.5 }}>
                {t('nonCashExceeds')}
              </Alert>
            )}
            {error && (
              <Alert severity="error" sx={{ mt: 1.5 }}>
                {error}
              </Alert>
            )}
          </Box>
        </Grid>
      </Grid>
      <SlipCaptureDialog
        open={slipOpen}
        onClose={() => setSlipOpen(false)}
        onCapture={setSlip}
        amountLabel={t('slipForAmount', { amount: formatMoney(qrAmount > 0 ? qrAmount : s.nonCash, locale) })}
      />
    </GlassDialog>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: string }) {
  return (
    <Stack direction="row" justifyContent="space-between">
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={600} color={highlight} sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
    </Stack>
  );
}
