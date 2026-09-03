'use client';

import CancelIcon from '@mui/icons-material/Cancel';
import PrintIcon from '@mui/icons-material/Print';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useSession } from '@/components/Providers';
import { GlassButton, GlassDialog } from '@/components/glass';
import { resolveLocale } from '@/i18n/config';
import { MUTATING_ROLES } from '@/lib/auth/session';
import { formatDateTime, formatMoney, formatQty } from '@/lib/format';
import { posApi, posKeys } from '@/lib/pos/api';
import { dec, type Sale, type SaleStatus } from '@/lib/pos/types';

interface Props {
  saleId: string | null;
  open: boolean;
  onClose: () => void;
  onReprint: (sale: Sale) => void;
  onCancel: (sale: Sale) => void;
}

export function SaleStatusChip({ status, arStatus }: { status: SaleStatus; arStatus?: string }) {
  const t = useTranslations('pos');
  const color = status === 'completed' ? 'success' : status === 'cancelled' ? 'error' : 'warning';
  return (
    <Stack direction="row" spacing={0.5} component="span">
      <Chip size="small" color={color} label={t.has(`status.${status}`) ? t(`status.${status}`) : status} />
      {arStatus && arStatus !== 'none' && (
        <Chip size="small" variant="outlined" color={arStatus === 'paid' ? 'success' : 'warning'} label={t.has(`arStatus.${arStatus}`) ? t(`arStatus.${arStatus}`) : arStatus} />
      )}
    </Stack>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Typography variant="body2">{value ?? '-'}</Typography>
    </Box>
  );
}

export default function SaleDetailDialog({ saleId, open, onClose, onReprint, onCancel }: Props) {
  const t = useTranslations('pos');
  const locale = resolveLocale(useLocale());
  const { hasRole } = useSession();
  const canCancel = hasRole(...MUTATING_ROLES);

  const sale = useQuery({
    queryKey: posKeys.sale(saleId ?? ''),
    queryFn: () => posApi.sale(saleId as string),
    enabled: open && Boolean(saleId),
  });
  const s = sale.data;

  return (
    <GlassDialog
      open={open}
      onClose={onClose}
      title={s ? `${t('saleNo')} ${s.doc_no}` : t('saleDetail')}
      maxWidth="md"
      actions={
        <>
          {s && canCancel && s.status === 'completed' && (
            <GlassButton variant="outlined" color="error" startIcon={<CancelIcon />} onClick={() => onCancel(s)} sx={{ mr: 'auto' }}>
              {t('cancelSale')}
            </GlassButton>
          )}
          {s && (
            <GlassButton variant="outlined" startIcon={<PrintIcon />} onClick={() => onReprint(s)}>
              {t('reprint')}
            </GlassButton>
          )}
          <GlassButton onClick={onClose}>{t('close')}</GlassButton>
        </>
      }
    >
      {sale.isPending && (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      )}
      {s && (
        <Stack spacing={2}>
          <Grid container spacing={2}>
            <Grid item xs={6} sm={3}>
              <Field label={t('date')} value={formatDateTime(s.sold_at, locale, true)} />
            </Grid>
            <Grid item xs={6} sm={3}>
              <Field label={t('cashier')} value={s.cashier_name} />
            </Grid>
            <Grid item xs={6} sm={3}>
              <Field label={t('member')} value={s.member_id ? `${s.member_code ?? ''} ${s.member_name ?? ''}` : t('walkIn')} />
            </Grid>
            <Grid item xs={6} sm={3}>
              <Field label={t('statusLabel')} value={<SaleStatusChip status={s.status} arStatus={s.ar_status} />} />
            </Grid>
            {s.status === 'cancelled' && (
              <Grid item xs={12}>
                <Field
                  label={t('cancelledBy')}
                  value={`${s.cancelled_by_name ?? '-'} · ${formatDateTime(s.cancelled_at, locale)}${s.cancel_reason ? ` · ${s.cancel_reason}` : ''}`}
                />
              </Grid>
            )}
            {s.note && (
              <Grid item xs={12}>
                <Field label={t('note')} value={s.note} />
              </Grid>
            )}
          </Grid>
          <Divider />
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>{t('item')}</TableCell>
                  <TableCell align="right">{t('qty')}</TableCell>
                  <TableCell align="right">{t('price')}</TableCell>
                  <TableCell align="right">{t('discount')}</TableCell>
                  <TableCell align="right">{t('lineTotal')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(s.lines ?? []).map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>{l.line_no}</TableCell>
                    <TableCell>
                      {l.description}
                      {l.is_free && <Chip size="small" color="success" label={t('free')} sx={{ ml: 1, height: 18 }} />}
                      {l.serial_no && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          S/N {l.serial_no}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {formatQty(l.qty, locale)} {l.unit_name ?? ''}
                    </TableCell>
                    <TableCell align="right">{formatQty(l.unit_price, locale, 2)}</TableCell>
                    <TableCell align="right">{dec(l.discount) > 0 ? formatQty(l.discount, locale, 2) : '-'}</TableCell>
                    <TableCell align="right">{formatQty(l.line_total, locale, 2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <Typography variant="subtitle2" gutterBottom>
                {t('payments')}
              </Typography>
              <Stack spacing={0.5}>
                {(s.payments ?? []).map((p) => (
                  <Stack key={p.id} direction="row" justifyContent="space-between">
                    <Typography variant="body2">
                      {t.has(`methods.${p.method}`) ? t(`methods.${p.method}`) : p.method}
                      {p.reference ? ` · ${p.reference}` : ''}
                    </Typography>
                    <Typography variant="body2">{formatMoney(p.amount, locale)}</Typography>
                  </Stack>
                ))}
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="body2" color="text.secondary">
                    {t('tendered')}
                  </Typography>
                  <Typography variant="body2">{formatMoney(s.tendered, locale)}</Typography>
                </Stack>
                <Stack direction="row" justifyContent="space-between">
                  <Typography variant="body2" color="text.secondary">
                    {t('change')}
                  </Typography>
                  <Typography variant="body2">{formatMoney(s.change_amount, locale)}</Typography>
                </Stack>
                {dec(s.ar_total) > 0 && (
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="body2" color="warning.main">
                      {t('arBalance')}
                    </Typography>
                    <Typography variant="body2" color="warning.main">
                      {formatMoney(s.ar_balance, locale)} / {formatMoney(s.ar_total, locale)}
                    </Typography>
                  </Stack>
                )}
              </Stack>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Stack spacing={0.5} alignItems="flex-end">
                <Typography variant="body2" color="text.secondary">
                  {t('gross')} {formatMoney(s.gross, locale)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('discount')} -{formatMoney(s.discount, locale)}
                </Typography>
                <Typography variant="h5" fontWeight={800}>
                  {t('net')} {formatMoney(s.net, locale)}
                </Typography>
              </Stack>
            </Grid>
          </Grid>
        </Stack>
      )}
    </GlassDialog>
  );
}
