'use client';

import CancelIcon from '@mui/icons-material/Cancel';
import CloseIcon from '@mui/icons-material/Close';
import PrintIcon from '@mui/icons-material/Print';
import RefreshIcon from '@mui/icons-material/Refresh';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { useSession } from '@/components/Providers';
import { GlassButton } from '@/components/glass';
import { resolveLocale } from '@/i18n/config';
import { MUTATING_ROLES } from '@/lib/auth/session';
import { formatMoney, formatTime } from '@/lib/format';
import { posApi, posKeys } from '@/lib/pos/api';
import type { Sale } from '@/lib/pos/types';
import SaleDetailDialog, { SaleStatusChip } from './SaleDetailDialog';

interface Props {
  open: boolean;
  onClose: () => void;
  onReprint: (sale: Sale) => void;
  onCancel: (sale: Sale) => void;
}

/** Right-hand drawer listing today's bills with reprint / cancel shortcuts. */
export default function BillHistoryDrawer({ open, onClose, onReprint, onCancel }: Props) {
  const t = useTranslations('pos');
  const locale = resolveLocale(useLocale());
  const { hasRole } = useSession();
  const canCancel = hasRole(...MUTATING_ROLES);
  const [detailId, setDetailId] = useState<string | null>(null);

  const sales = useQuery({
    queryKey: posKeys.sales({ scope: 'today' }),
    queryFn: () => posApi.listSales({ page: 1, page_size: 100 }),
    enabled: open,
    staleTime: 10_000,
  });

  const items = sales.data?.items ?? [];

  return (
    <>
      <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 420 } } }}>
        <Stack direction="row" alignItems="center" sx={{ p: 2, pb: 1 }} spacing={1}>
          <Typography variant="h6" fontWeight={700} sx={{ flex: 1 }}>
            {t('todayBills')}
          </Typography>
          <Tooltip title={t('refresh')}>
            <IconButton onClick={() => void sales.refetch()} aria-label={t('refresh')}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
          <IconButton onClick={onClose} aria-label={t('close')}>
            <CloseIcon />
          </IconButton>
        </Stack>
        <Box sx={{ px: 2, pb: 1 }}>
          <GlassButton component={Link} href="/pos/history" variant="text" size="small" onClick={onClose}>
            {t('fullHistory')}
          </GlassButton>
        </Box>
        <Box sx={{ flex: 1, overflow: 'auto', px: 1 }}>
          {sales.isPending && (
            <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}>
              <CircularProgress size={24} />
            </Box>
          )}
          {sales.isSuccess && items.length === 0 && (
            <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
              {t('noSalesToday')}
            </Typography>
          )}
          <List disablePadding>
            {items.map((s) => (
              <ListItem
                key={s.id}
                disablePadding
                secondaryAction={
                  <Stack direction="row">
                    <Tooltip title={t('reprint')}>
                      <IconButton size="small" aria-label={t('reprint')} onClick={() => onReprint(s)}>
                        <PrintIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    {canCancel && s.status === 'completed' && (
                      <Tooltip title={t('cancelSale')}>
                        <IconButton size="small" color="error" aria-label={t('cancelSale')} onClick={() => onCancel(s)}>
                          <CancelIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Stack>
                }
              >
                <ListItemButton onClick={() => setDetailId(s.id)} sx={{ borderRadius: 2, pr: 10 }}>
                  <ListItemText
                    primary={
                      <Stack direction="row" spacing={1} alignItems="center" component="span">
                        <b>{s.doc_no}</b>
                        <SaleStatusChip status={s.status} arStatus={s.ar_status} />
                      </Stack>
                    }
                    secondary={`${formatTime(s.sold_at, locale, false)} · ${s.member_id ? s.member_name : t('walkIn')} · ${formatMoney(s.net, locale)}`}
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        </Box>
      </Drawer>
      <SaleDetailDialog
        saleId={detailId}
        open={Boolean(detailId)}
        onClose={() => setDetailId(null)}
        onReprint={(s) => {
          setDetailId(null);
          onReprint(s);
        }}
        onCancel={(s) => {
          setDetailId(null);
          onCancel(s);
        }}
      />
    </>
  );
}
