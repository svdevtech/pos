'use client';

import CameraAltIcon from '@mui/icons-material/CameraAlt';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import UndoIcon from '@mui/icons-material/Undo';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useSession } from '@/components/Providers';
import { useToast } from '@/components/Toast';
import { GlassButton } from '@/components/glass';
import SlipCaptureDialog from '@/components/pos/SlipCaptureDialog';
import SlipImage from '@/components/pos/SlipImage';
import { resolveLocale } from '@/i18n/config';
import { useApiErrorMessage } from '@/lib/api/errors';
import { MUTATING_ROLES } from '@/lib/auth/session';
import { formatDateTime } from '@/lib/format';
import { posApi, posKeys } from '@/lib/pos/api';
import type { PaymentSlip } from '@/lib/pos/types';

interface Props {
  saleId: string;
  /** Lets the cashier photograph a slip that was missed at the till. */
  allowAdd?: boolean;
}

/**
 * The slips attached to one bill: who took each photo, whether a manager has checked it against
 * the bank account, and the picture itself.
 */
export default function SaleSlips({ saleId, allowAdd = true }: Props) {
  const t = useTranslations('pos');
  const locale = resolveLocale(useLocale());
  const qc = useQueryClient();
  const toast = useToast();
  const errorMessage = useApiErrorMessage();
  const { hasRole } = useSession();
  const canVerify = hasRole(...MUTATING_ROLES);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [zoom, setZoom] = useState<PaymentSlip | null>(null);

  const slips = useQuery({
    queryKey: posKeys.saleSlips(saleId),
    queryFn: () => posApi.saleSlips(saleId),
    enabled: Boolean(saleId),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: posKeys.saleSlips(saleId) });
    void qc.invalidateQueries({ queryKey: ['pos', 'slips', 'pending'] });
  };

  const attach = useMutation({
    mutationFn: (image: { dataUrl: string; mime: string }) => posApi.attachSlip(saleId, { image: image.dataUrl, mime: image.mime }),
    onSuccess: () => {
      toast.success(t('slipSaved'));
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const verify = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => posApi.verifySlip(id, on),
    onSuccess: refresh,
    onError: (e) => toast.error(errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => posApi.deleteSlip(id),
    onSuccess: () => {
      toast.info(t('slipDeleted'));
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const rows = slips.data ?? [];

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="subtitle2">{t('slips')}</Typography>
        {allowAdd && (
          <GlassButton variant="text" size="small" startIcon={<CameraAltIcon />} onClick={() => setCaptureOpen(true)} data-testid="sale-slip-add">
            {t('slipCapture')}
          </GlassButton>
        )}
      </Stack>

      {rows.length === 0 && !slips.isPending && (
        <Typography variant="caption" color="text.secondary">
          {t('slipNone')}
        </Typography>
      )}

      {rows.map((slip) => (
        <Stack key={slip.id} direction="row" spacing={1.5} alignItems="center" data-testid="sale-slip-row">
          <SlipImage slipId={slip.id} alt={t('slipCaptureTitle')} onClick={() => setZoom(slip)} />
          <Stack sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2">{formatDateTime(slip.captured_at, locale, true)}</Typography>
            <Typography variant="caption" color="text.secondary">
              {t('slipCapturedBy', { name: slip.captured_by_name || '-' })}
            </Typography>
            {slip.verified_at ? (
              <Chip
                size="small"
                color="success"
                icon={<CheckCircleIcon />}
                label={t('slipVerified', { name: slip.verified_by_name || '-' })}
                sx={{ alignSelf: 'flex-start', mt: 0.5 }}
                data-testid="slip-verified-chip"
              />
            ) : (
              <Chip size="small" variant="outlined" color="warning" label={t('slipUnverified')} sx={{ alignSelf: 'flex-start', mt: 0.5 }} />
            )}
          </Stack>
          {canVerify && (
            <Stack direction="row" spacing={0.5}>
              {slip.verified_at ? (
                <IconButton aria-label={t('slipUnverify')} onClick={() => verify.mutate({ id: slip.id, on: false })} data-testid="slip-unverify">
                  <UndoIcon />
                </IconButton>
              ) : (
                <IconButton color="success" aria-label={t('slipVerify')} onClick={() => verify.mutate({ id: slip.id, on: true })} data-testid="slip-verify">
                  <CheckCircleIcon />
                </IconButton>
              )}
              <IconButton color="error" aria-label={t('slipDelete')} onClick={() => remove.mutate(slip.id)} data-testid="slip-delete">
                <DeleteOutlineIcon />
              </IconButton>
            </Stack>
          )}
        </Stack>
      ))}

      <SlipCaptureDialog
        open={captureOpen}
        onClose={() => setCaptureOpen(false)}
        onCapture={(photo) => attach.mutate({ dataUrl: photo.dataUrl, mime: photo.mime })}
      />

      {/* full-size view: a bank slip's reference number is unreadable in a thumbnail */}
      <Dialog open={Boolean(zoom)} onClose={() => setZoom(null)} maxWidth="md">
        {zoom && <SlipImage slipId={zoom.id} height={720} alt={t('slipOpenImage')} />}
      </Dialog>
    </Stack>
  );
}
