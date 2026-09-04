'use client';

import ReceiptIcon from '@mui/icons-material/Receipt';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import ListItemButton from '@mui/material/ListItemButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import MoneyField from '@/components/MoneyField';
import { GlassButton, GlassDialog, GlassInput } from '@/components/glass';
import SlipImage from '@/components/pos/SlipImage';
import { resolveLocale } from '@/i18n/config';
import { num } from '@/lib/api/hooks/common';
import { formatDateTime, formatMoney } from '@/lib/format';
import { posApi, posKeys } from '@/lib/pos/api';
import { dec, type PaymentSlip, type SlipCandidate } from '@/lib/pos/types';

interface Props {
  open: boolean;
  /** The slip being matched; its own amount seeds the search. */
  slip: PaymentSlip | null;
  onClose: () => void;
  onMatched: (candidate: SlipCandidate) => void;
  busy?: boolean;
}

const DAY_OPTIONS = [1, 3, 7, 30] as const;

/**
 * Picking the record a photographed slip pays for.
 *
 * The cashier types the amount printed on the slip and the shop's transfer/QR payments come back
 * closest-amount-first, which is nearly always the right row — an exact match on a co-op's daily
 * handful of transfers is unambiguous. Records that already carry a slip stay in the list but are
 * marked, because a customer sometimes sends two slips for one bill.
 */
export default function SlipMatchDialog({ open, slip, onClose, onMatched, busy = false }: Props) {
  const t = useTranslations('pos');
  const tc = useTranslations('common');
  const locale = resolveLocale(useLocale());
  const [amount, setAmount] = useState('');
  const [days, setDays] = useState<number>(3);

  useEffect(() => {
    if (!open) return;
    const a = slip ? dec(slip.amount) : 0;
    setAmount(a > 0 ? String(a) : '');
    setDays(3);
  }, [open, slip]);

  const from = dayjs().subtract(days - 1, 'day').format('YYYY-MM-DD');
  const to = dayjs().format('YYYY-MM-DD');
  const n = num(amount);

  const candidates = useQuery({
    queryKey: [...posKeys.slipCandidates(n, from), days],
    queryFn: () => posApi.slipCandidates({ amount: n, from, to, limit: 60 }),
    enabled: open,
  });

  const rows = candidates.data ?? [];

  return (
    <GlassDialog open={open} onClose={onClose} busy={busy} maxWidth="sm" title={t('slipMatchTitle')} actions={<GlassButton onClick={onClose}>{tc('close')}</GlassButton>}>
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {t('slipMatchDesc')}
        </Typography>

        <Stack direction="row" spacing={2} alignItems="flex-start">
          {slip && <SlipImage slipId={slip.id} height={110} alt={t('slipCaptureTitle')} />}
          <Stack spacing={1.5} sx={{ flex: 1 }}>
            <MoneyField label={t('slipForAmount', { amount: '' })} value={amount} onChange={setAmount} helperText={t('slipAmountHint')} />
            <GlassInput select label={t('slipSearchDays')} value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
              {DAY_OPTIONS.map((d) => (
                <MenuItem key={d} value={String(d)}>
                  {t('slipDays', { days: d })}
                </MenuItem>
              ))}
            </GlassInput>
          </Stack>
        </Stack>

        {candidates.isPending && (
          <Stack alignItems="center" sx={{ py: 3 }}>
            <CircularProgress size={24} />
          </Stack>
        )}
        {!candidates.isPending && rows.length === 0 && <Alert severity="info">{t('slipCandidateNone')}</Alert>}

        <Stack spacing={0.5} sx={{ maxHeight: '40vh', overflowY: 'auto' }}>
          {rows.map((c) => (
            <ListItemButton
              key={`${c.ref_type}-${c.ref_id}`}
              onClick={() => onMatched(c)}
              disabled={busy}
              data-testid="slip-candidate"
              data-doc-no={c.doc_no}
              sx={{ borderRadius: 2, border: (th) => `1px solid ${th.glass.border}` }}
            >
              <Stack direction="row" spacing={1.5} alignItems="center" sx={{ width: '100%' }}>
                {c.ref_type === 'sale' ? <ReceiptIcon fontSize="small" /> : <ReceiptLongIcon fontSize="small" />}
                <Stack sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={600}>
                    {c.doc_no}
                    <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                      {c.ref_type === 'sale' ? t('slipRefSale') : t('slipRefAR')}
                    </Typography>
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {formatDateTime(c.at, locale, true)}
                    {c.member_name ? ` · ${c.member_name}` : ''}
                    {c.method ? ` · ${t.has(`methods.${c.method}`) ? t(`methods.${c.method}`) : c.method}` : ''}
                  </Typography>
                </Stack>
                {c.has_slip && <Chip size="small" variant="outlined" color="warning" label={t('slipCandidateHasSlip')} />}
                <Typography variant="body2" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatMoney(c.amount, locale)}
                </Typography>
              </Stack>
            </ListItemButton>
          ))}
        </Stack>
      </Stack>
    </GlassDialog>
  );
}
