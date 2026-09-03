'use client';

import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { GlassButton, GlassDialog, GlassInput } from '@/components/glass';
import { useToast } from '@/components/Toast';
import { useApiErrorMessage } from '@/lib/api/errors';
import { posApi, posKeys } from '@/lib/pos/api';
import type { Shift } from '@/lib/pos/types';

interface Props {
  open: boolean;
  onClose: () => void;
  onOpened?: (shift: Shift) => void;
  /** When the store requires a shift, the dialog cannot be dismissed without opening one. */
  required?: boolean;
  defaultTerminal?: string;
}

export const TERMINAL_KEY = 'pos.terminal';

export function readTerminal(fallback = 'POS1'): string {
  try {
    return window.localStorage.getItem(TERMINAL_KEY) || fallback;
  } catch {
    return fallback;
  }
}

export default function ShiftOpenDialog({ open, onClose, onOpened, required = false, defaultTerminal }: Props) {
  const t = useTranslations('pos');
  const toast = useToast();
  const errorMessage = useApiErrorMessage();
  const qc = useQueryClient();
  const [terminal, setTerminal] = useState('POS1');
  const [floatText, setFloatText] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (open) {
      setTerminal(readTerminal(defaultTerminal ?? 'POS1'));
      setFloatText('');
      setNote('');
    }
  }, [open, defaultTerminal]);

  const mutation = useMutation({
    mutationFn: () => posApi.openShift({ terminal: terminal.trim() || 'POS1', opening_float: Number(floatText) || 0, note: note.trim() || undefined }),
    onSuccess: (shift) => {
      try {
        window.localStorage.setItem(TERMINAL_KEY, terminal.trim() || 'POS1');
      } catch {
        // ignore
      }
      qc.setQueryData(posKeys.shift, shift);
      void qc.invalidateQueries({ queryKey: ['pos', 'shifts'] });
      toast.success(t('shiftOpened'));
      onOpened?.(shift);
      onClose();
    },
  });

  const floatValid = floatText === '' || (Number.isFinite(Number(floatText)) && Number(floatText) >= 0);

  return (
    <GlassDialog
      open={open}
      onClose={required ? undefined : onClose}
      busy={mutation.isPending}
      title={t('openShift')}
      maxWidth="xs"
      actions={
        <>
          {!required && (
            <GlassButton variant="text" onClick={onClose} disabled={mutation.isPending}>
              {t('later')}
            </GlassButton>
          )}
          <GlassButton onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!floatValid} data-testid="open-shift-confirm">
            {t('openShift')}
          </GlassButton>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Typography variant="body2" color="text.secondary">
          {required ? t('shiftRequiredHint') : t('openShiftHint')}
        </Typography>
        <GlassInput label={t('terminal')} value={terminal} onChange={(e) => setTerminal(e.target.value)} />
        <GlassInput
          autoFocus
          label={t('openingCash')}
          type="number"
          value={floatText}
          onChange={(e) => setFloatText(e.target.value)}
          error={!floatValid}
          inputProps={{ min: 0, step: 1, inputMode: 'decimal', 'data-testid': 'opening-float' }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && floatValid) mutation.mutate();
          }}
        />
        <GlassInput label={t('note')} value={note} onChange={(e) => setNote(e.target.value)} multiline minRows={2} />
        {mutation.isError && <Alert severity="error">{errorMessage(mutation.error)}</Alert>}
      </Stack>
    </GlassDialog>
  );
}
