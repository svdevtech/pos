'use client';

import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import Alert from '@mui/material/Alert';
import Dialog from '@mui/material/Dialog';
import Grid from '@mui/material/Grid';
import Pagination from '@mui/material/Pagination';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import PageHeader from '@/components/PageHeader';
import RequireAuth from '@/components/RequireAuth';
import { useToast } from '@/components/Toast';
import { GlassButton, GlassCard } from '@/components/glass';
import SlipImage from '@/components/pos/SlipImage';
import { resolveLocale } from '@/i18n/config';
import { useApiErrorMessage } from '@/lib/api/errors';
import { MUTATING_ROLES } from '@/lib/auth/session';
import { formatDateTime, formatMoney } from '@/lib/format';
import { posApi, posKeys } from '@/lib/pos/api';
import type { PaymentSlip } from '@/lib/pos/types';

/**
 * The manager's queue: every slip photograph the till captured that nobody has compared with the
 * shop's bank account yet. Confirming one takes it off this list for good.
 */
function PendingSlipsContent() {
  const t = useTranslations('pos');
  const tc = useTranslations('common');
  const locale = resolveLocale(useLocale());
  const qc = useQueryClient();
  const toast = useToast();
  const errorMessage = useApiErrorMessage();
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState<PaymentSlip | null>(null);

  const list = useQuery({
    queryKey: posKeys.pendingSlips(page),
    queryFn: () => posApi.pendingSlips(page),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['pos', 'slips'] });
  };

  const verify = useMutation({
    mutationFn: (id: string) => posApi.verifySlip(id, true),
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

  const items = list.data?.items ?? [];
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / (list.data?.page_size || 20)));

  return (
    <Stack spacing={3}>
      <PageHeader title={t('slipsPending')} subtitle={t('slipsPendingDesc')} backHref="/dashboard" />
      {list.isError && (
        <Alert
          severity="error"
          action={
            <GlassButton size="small" variant="text" onClick={() => list.refetch()}>
              {tc('retry')}
            </GlassButton>
          }
        >
          {errorMessage(list.error)}
        </Alert>
      )}
      {list.isPending && <Skeleton variant="rounded" height={220} />}
      {!list.isPending && items.length === 0 && <Alert severity="success">{t('slipsPendingEmpty')}</Alert>}

      <Grid container spacing={2}>
        {items.map((slip) => (
          <Grid item xs={12} sm={6} md={4} key={slip.id}>
            <GlassCard>
              <Stack spacing={1} data-testid="pending-slip">
                <SlipImage slipId={slip.id} height={180} alt={t('slipCaptureTitle')} onClick={() => setZoom(slip)} />
                <Typography variant="subtitle2">
                  {slip.sale_doc_no} · {formatMoney(slip.amount, locale)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatDateTime(slip.captured_at, locale, true)} · {t('slipCapturedBy', { name: slip.captured_by_name || '-' })}
                </Typography>
                <Stack direction="row" spacing={1}>
                  <GlassButton size="small" startIcon={<CheckCircleIcon />} onClick={() => verify.mutate(slip.id)} data-testid="pending-slip-verify">
                    {t('slipVerify')}
                  </GlassButton>
                  <GlassButton size="small" variant="text" color="error" startIcon={<DeleteOutlineIcon />} onClick={() => remove.mutate(slip.id)}>
                    {t('slipDelete')}
                  </GlassButton>
                </Stack>
              </Stack>
            </GlassCard>
          </Grid>
        ))}
      </Grid>

      {pages > 1 && (
        <Stack alignItems="center">
          <Pagination count={pages} page={page} onChange={(_, p) => setPage(p)} />
        </Stack>
      )}

      <Dialog open={Boolean(zoom)} onClose={() => setZoom(null)} maxWidth="md">
        {zoom && <SlipImage slipId={zoom.id} height={720} alt={t('slipOpenImage')} />}
      </Dialog>
    </Stack>
  );
}

export default function PendingSlipsPage() {
  return (
    <RequireAuth roles={MUTATING_ROLES}>
      <PendingSlipsContent />
    </RequireAuth>
  );
}
