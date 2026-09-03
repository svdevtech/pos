'use client';

import CancelIcon from '@mui/icons-material/Cancel';
import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import PageHeader from '@/components/PageHeader';
import { useSession } from '@/components/Providers';
import QueryError from '@/components/QueryError';
import { useToast } from '@/components/Toast';
import { GlassButton, GlassCard, GlassInput, GlassTable, type GlassColumn } from '@/components/glass';
import { resolveLocale } from '@/i18n/config';
import { useApiErrorMessage } from '@/lib/api/errors';
import { useCancelReceipt, useReceipt, type ReceiptLine } from '@/lib/api/hooks/inventory';
import { MUTATING_ROLES } from '@/lib/auth/session';
import { formatDateTime, formatMoney, formatQty } from '@/lib/format';

const STATUS_COLOR: Record<string, 'success' | 'default' | 'error' | 'warning'> = {
  posted: 'success',
  draft: 'warning',
  cancelled: 'error',
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Stack>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2">{value || '-'}</Typography>
    </Stack>
  );
}

export default function ReceiptDetailPage() {
  const t = useTranslations('inventory');
  const tc = useTranslations('common');
  const locale = resolveLocale(useLocale());
  const toast = useToast();
  const errorMessage = useApiErrorMessage();
  const { hasRole } = useSession();
  const canMutate = hasRole(...MUTATING_ROLES);
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';

  const receipt = useReceipt(id);
  const cancel = useCancelReceipt();
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState('');

  const r = receipt.data;

  const columns: GlassColumn<ReceiptLine>[] = [
    { key: 'line_no', label: '#', width: 50, align: 'right' },
    { key: 'sku', label: t('sku'), width: 130 },
    { key: 'description', label: t('product') },
    { key: 'qty', label: t('qty'), width: 110, align: 'right', render: (l) => formatQty(l.qty, locale) },
    { key: 'unit_cost', label: t('unitCost'), width: 130, align: 'right', render: (l) => formatMoney(l.unit_cost, locale) },
    { key: 'total', label: tc('total'), width: 130, align: 'right', render: (l) => formatMoney(l.total, locale) },
  ];

  return (
    <Stack spacing={3}>
      <PageHeader
        title={r ? r.doc_no : t('receiptDetail')}
        subtitle={r ? formatDateTime(r.received_at, locale) : undefined}
        backHref="/inventory/receipts"
        loading={receipt.isPending}
        actions={
          canMutate && r && r.status === 'posted' ? (
            <GlassButton variant="outlined" color="error" startIcon={<CancelIcon />} onClick={() => setConfirm(true)}>
              {t('cancelReceipt')}
            </GlassButton>
          ) : undefined
        }
      />
      <QueryError error={receipt.error} onRetry={() => receipt.refetch()} />
      {receipt.isPending && <Skeleton variant="rounded" height={280} />}

      {r && (
        <>
          {r.status === 'cancelled' && <Alert severity="warning">{t('receiptCancelledNotice')}</Alert>}
          <Grid container spacing={3}>
            <Grid item xs={12} md={4}>
              <GlassCard
                title={t('receiptDetail')}
                action={
                  <Chip
                    size="small"
                    color={STATUS_COLOR[r.status] ?? 'default'}
                    label={t.has(`statuses.${r.status}`) ? t(`statuses.${r.status}`) : r.status}
                  />
                }
              >
                <Stack spacing={1.5}>
                  <Field label={t('supplier')} value={r.supplier_name} />
                  <Field label={t('supplierRef')} value={r.supplier_ref} />
                  <Field label={t('receivedAt')} value={formatDateTime(r.received_at, locale)} />
                  <Field label={t('receivedBy')} value={r.received_by_name} />
                  <Field label={tc('notes')} value={r.note} />
                </Stack>
              </GlassCard>
            </Grid>
            <Grid item xs={12} md={8}>
              <GlassCard title={t('lines')}>
                <Stack spacing={2}>
                  <GlassTable columns={columns} rows={r.lines ?? []} rowKey={(l) => l.id} emptyText={t('noLines')} />
                  <Stack alignItems="flex-end" spacing={0.5}>
                    <Typography variant="body2" color="text.secondary">
                      {t('subtotal')}: {formatMoney(r.subtotal, locale)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {t('vat')}: {formatMoney(r.vat, locale)}
                    </Typography>
                    <Typography variant="h6" fontWeight={700}>
                      {tc('total')}: {formatMoney(r.total, locale)}
                    </Typography>
                  </Stack>
                </Stack>
              </GlassCard>
            </Grid>
          </Grid>
        </>
      )}

      <ConfirmDialog
        open={confirm}
        title={t('cancelReceipt')}
        color="error"
        loading={cancel.isPending}
        onClose={() => setConfirm(false)}
        message={
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2">{r ? t('cancelReceiptConfirm', { docNo: r.doc_no }) : ''}</Typography>
            <GlassInput label={t('cancelReason')} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus multiline minRows={2} />
          </Stack>
        }
        onConfirm={() =>
          cancel.mutate(
            { id, reason: reason.trim() },
            {
              onSuccess: () => {
                toast.success(t('receiptCancelled'));
                setConfirm(false);
                setReason('');
              },
              onError: (err) => toast.error(errorMessage(err)),
            },
          )
        }
      />
    </Stack>
  );
}
