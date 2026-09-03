'use client';

import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { GlassButton, GlassDialog, GlassInput } from '@/components/glass';
import { useToast } from '@/components/Toast';
import { resolveLocale } from '@/i18n/config';
import { useApiErrorMessage } from '@/lib/api/errors';
import { formatMoney } from '@/lib/format';
import { posApi } from '@/lib/pos/api';
import type { Sale } from '@/lib/pos/types';

interface Props {
  sale: Sale | null;
  open: boolean;
  onClose: () => void;
  onCancelled?: (sale: Sale) => void;
}

export default function CancelSaleDialog({ sale, open, onClose, onCancelled }: Props) {
  const t = useTranslations('pos');
  const locale = resolveLocale(useLocale());
  const toast = useToast();
  const errorMessage = useApiErrorMessage();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => posApi.cancelSale(sale!.id, reason.trim()),
    onSuccess: (updated) => {
      toast.success(t('saleCancelled', { docNo: updated.doc_no }));
      void qc.invalidateQueries({ queryKey: ['pos', 'sales'] });
      void qc.invalidateQueries({ queryKey: ['pos', 'sale', updated.id] });
      void qc.invalidateQueries({ queryKey: ['pos', 'receipt', updated.id] });
      void qc.invalidateQueries({ queryKey: ['pos', 'summary'] });
      void qc.invalidateQueries({ queryKey: ['pos', 'shift'] });
      onCancelled?.(updated);
      onClose();
    },
  });

  return (
    <GlassDialog
      open={open}
      onClose={onClose}
      busy={mutation.isPending}
      title={t('cancelSale')}
      maxWidth="xs"
      actions={
        <>
          <GlassButton variant="text" onClick={onClose} disabled={mutation.isPending}>
            {t('cancelAction')}
          </GlassButton>
          <GlassButton color="error" onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!sale || reason.trim().length < 2} data-testid="cancel-sale-confirm">
            {t('confirmCancel')}
          </GlassButton>
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        {sale && (
          <Typography>
            {t('cancelSaleConfirm', { docNo: sale.doc_no, net: formatMoney(sale.net, locale) })}
          </Typography>
        )}
        <Alert severity="warning">{t('cancelSaleWarning')}</Alert>
        <GlassInput
          autoFocus
          label={t('cancelReason')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          multiline
          minRows={2}
          inputProps={{ 'data-testid': 'cancel-reason' }}
        />
        {mutation.isError && <Alert severity="error">{errorMessage(mutation.error)}</Alert>}
      </Stack>
    </GlassDialog>
  );
}
