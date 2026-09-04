'use client';

import CameraAltIcon from '@mui/icons-material/CameraAlt';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import LinkIcon from '@mui/icons-material/Link';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import Grid from '@mui/material/Grid';
import Pagination from '@mui/material/Pagination';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import PageHeader from '@/components/PageHeader';
import RequireAuth from '@/components/RequireAuth';
import { useToast } from '@/components/Toast';
import { GlassButton, GlassCard } from '@/components/glass';
import SlipCaptureDialog from '@/components/pos/SlipCaptureDialog';
import SlipImage from '@/components/pos/SlipImage';
import SlipMatchDialog from '@/components/pos/SlipMatchDialog';
import { resolveLocale } from '@/i18n/config';
import { useApiErrorMessage } from '@/lib/api/errors';
import { MUTATING_ROLES } from '@/lib/auth/session';
import { formatDateTime, formatMoney } from '@/lib/format';
import { posApi, posKeys } from '@/lib/pos/api';
import type { PaymentSlip, SlipCandidate } from '@/lib/pos/types';

type Scope = 'pending' | 'unassigned';

/**
 * Slips the shop still has to deal with.
 *
 * Two queues, because they need different actions: photographs nobody has matched to a record yet
 * (usually shot on a phone away from the till), and matched slips nobody has compared with the
 * bank account. The "photograph a slip" button starts at the camera and ends at a matched record,
 * which is the whole job in one go.
 */
function SlipsContent() {
  const t = useTranslations('pos');
  const tc = useTranslations('common');
  const locale = resolveLocale(useLocale());
  const qc = useQueryClient();
  const toast = useToast();
  const errorMessage = useApiErrorMessage();

  const [scope, setScope] = useState<Scope>('pending');
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState<PaymentSlip | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [matching, setMatching] = useState<PaymentSlip | null>(null);

  const list = useQuery({
    queryKey: posKeys.slipList(scope, page),
    queryFn: () => posApi.slips(scope, page),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['pos', 'slips'] });
  };

  // a photo taken here has no record yet; the match dialog opens on top of it straight away
  const upload = useMutation({
    mutationFn: (photo: { dataUrl: string; mime: string }) => posApi.uploadLooseSlip({ image: photo.dataUrl, mime: photo.mime }),
    onSuccess: (slip) => {
      toast.info(t('slipSavedUnassigned'));
      refresh();
      setMatching(slip);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const assign = useMutation({
    mutationFn: ({ id, candidate }: { id: string; candidate: SlipCandidate }) =>
      posApi.assignSlip(id, candidate.ref_type === 'sale' ? { sale_id: candidate.ref_id } : { ar_payment_id: candidate.ref_id }),
    onSuccess: (_slip, { candidate }) => {
      toast.success(t('slipMatched', { docNo: candidate.doc_no }));
      setMatching(null);
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

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

  const refLabel = (slip: PaymentSlip) => {
    if (slip.ref_type === 'sale') return `${t('slipRefSale')} ${slip.ref_doc_no ?? ''}`;
    if (slip.ref_type === 'ar_payment') return `${t('slipRefAR')} ${slip.ref_doc_no ?? ''}`;
    return t('slipRefUnassigned');
  };

  return (
    <Stack spacing={3}>
      <PageHeader
        title={t('slipsPending')}
        subtitle={t('slipsPendingDesc')}
        backHref="/dashboard"
        actions={
          <GlassButton startIcon={<CameraAltIcon />} onClick={() => setCaptureOpen(true)} data-testid="slip-new-photo">
            {t('slipNewPhoto')}
          </GlassButton>
        }
      />

      <Tabs
        value={scope}
        onChange={(_, v: Scope) => {
          setScope(v);
          setPage(1);
        }}
      >
        <Tab value="pending" label={t('slipPendingTab')} data-testid="tab-pending" />
        <Tab value="unassigned" label={t('slipUnassignedTab')} data-testid="tab-unassigned" />
      </Tabs>

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
              <Stack spacing={1} data-testid="pending-slip" data-ref-type={slip.ref_type}>
                <SlipImage slipId={slip.id} height={180} alt={t('slipCaptureTitle')} onClick={() => setZoom(slip)} />
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="subtitle2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                    {refLabel(slip)}
                  </Typography>
                  <Typography variant="subtitle2">{formatMoney(slip.amount, locale)}</Typography>
                </Stack>
                {slip.member_name && (
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {slip.member_name}
                  </Typography>
                )}
                <Typography variant="caption" color="text.secondary">
                  {formatDateTime(slip.captured_at, locale, true)} · {t('slipCapturedBy', { name: slip.captured_by_name || '-' })}
                </Typography>
                {slip.ref_type === 'unassigned' && <Chip size="small" color="warning" variant="outlined" label={t('slipRefUnassigned')} sx={{ alignSelf: 'flex-start' }} />}
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {slip.ref_type === 'unassigned' ? (
                    <GlassButton size="small" startIcon={<LinkIcon />} onClick={() => setMatching(slip)} data-testid="slip-match-open">
                      {t('slipMatch')}
                    </GlassButton>
                  ) : (
                    <GlassButton size="small" startIcon={<CheckCircleIcon />} onClick={() => verify.mutate(slip.id)} data-testid="pending-slip-verify">
                      {t('slipVerify')}
                    </GlassButton>
                  )}
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

      <SlipCaptureDialog open={captureOpen} onClose={() => setCaptureOpen(false)} onCapture={(photo) => upload.mutate({ dataUrl: photo.dataUrl, mime: photo.mime })} />

      <SlipMatchDialog
        open={Boolean(matching)}
        slip={matching}
        busy={assign.isPending}
        onClose={() => setMatching(null)}
        onMatched={(candidate) => matching && assign.mutate({ id: matching.id, candidate })}
      />

      <Dialog open={Boolean(zoom)} onClose={() => setZoom(null)} maxWidth="md">
        {zoom && <SlipImage slipId={zoom.id} height={720} alt={t('slipOpenImage')} />}
      </Dialog>
    </Stack>
  );
}

export default function SlipsPage() {
  return (
    <RequireAuth roles={MUTATING_ROLES}>
      <SlipsContent />
    </RequireAuth>
  );
}
