'use client';

import Alert from '@mui/material/Alert';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import MoneyField from '@/components/MoneyField';
import { GlassButton, GlassDialog, GlassInput } from '@/components/glass';
import { resolveLocale } from '@/i18n/config';
import { useApiErrorMessage } from '@/lib/api/errors';
import { decStr, num } from '@/lib/api/hooks/common';
import { usePostShare, type ShareInput } from '@/lib/api/hooks/members';
import { localDateTimeToRfc3339 } from '@/lib/dates';
import { formatMoney } from '@/lib/format';

type ShareType = ShareInput['type'];
const TYPES: readonly ShareType[] = ['deposit', 'withdraw', 'adjust'];

export interface ShareDialogProps {
  open: boolean;
  memberId: string;
  balance: string | number;
  onClose: () => void;
  onSaved: () => void;
}

/** Deposit / withdraw / adjust a member's share capital (`POST /members/{id}/shares`). */
export default function ShareDialog({ open, memberId, balance, onClose, onSaved }: ShareDialogProps) {
  const t = useTranslations('members');
  const tc = useTranslations('common');
  const locale = resolveLocale(useLocale());
  const errorMessage = useApiErrorMessage();
  const post = usePostShare(memberId);
  const [type, setType] = useState<ShareType>('deposit');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [occurredAt, setOccurredAt] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setType('deposit');
    setAmount('');
    setNote('');
    setOccurredAt('');
    setFormError(null);
  }, [open]);

  const n = num(amount);
  const after = type === 'deposit' ? num(balance) + n : type === 'withdraw' ? num(balance) - n : num(balance) + n;
  const valid = amount !== '' && n !== 0 && (type === 'adjust' || n > 0) && after >= 0;

  const submit = () => {
    setFormError(null);
    post.mutate(
      { type, amount: decStr(amount), note: note.trim(), occurred_at: localDateTimeToRfc3339(occurredAt) },
      { onSuccess: () => onSaved(), onError: (err) => setFormError(errorMessage(err)) },
    );
  };

  return (
    <GlassDialog
      open={open}
      onClose={onClose}
      busy={post.isPending}
      maxWidth="xs"
      title={t('shareTx')}
      actions={
        <>
          <GlassButton variant="outlined" onClick={onClose} disabled={post.isPending}>
            {tc('cancel')}
          </GlassButton>
          <GlassButton onClick={submit} loading={post.isPending} disabled={!valid}>
            {tc('save')}
          </GlassButton>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        {formError && <Alert severity="error">{formError}</Alert>}
        <GlassInput select label={t('txType')} value={type} onChange={(e) => setType(e.target.value as ShareType)}>
          {TYPES.map((x) => (
            <MenuItem key={x} value={x}>
              {t(`txTypes.${x}`)}
            </MenuItem>
          ))}
        </GlassInput>
        <MoneyField
          label={t('amount')}
          value={amount}
          onChange={setAmount}
          allowNegative={type === 'adjust'}
          autoFocus
          helperText={type === 'adjust' ? t('adjustHint') : undefined}
          error={amount !== '' && !valid}
        />
        <GlassInput
          type="datetime-local"
          label={t('occurredAt')}
          value={occurredAt}
          onChange={(e) => setOccurredAt(e.target.value)}
          InputLabelProps={{ shrink: true }}
          helperText={t('occurredAtHint')}
        />
        <GlassInput label={tc('notes')} value={note} onChange={(e) => setNote(e.target.value)} multiline minRows={2} />
        <Typography variant="body2" color="text.secondary">
          {t('shareBalance')}: {formatMoney(balance, locale)} → <strong>{formatMoney(after, locale)}</strong>
        </Typography>
      </Stack>
    </GlassDialog>
  );
}
