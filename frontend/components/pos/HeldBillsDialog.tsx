'use client';

import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import RestoreIcon from '@mui/icons-material/Restore';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { GlassButton, GlassDialog } from '@/components/glass';
import { resolveLocale } from '@/i18n/config';
import { useApiErrorMessage } from '@/lib/api/errors';
import { formatDateTime, formatMoney } from '@/lib/format';
import { cartGross, type HeldCart } from '@/lib/pos/cart';
import { posApi, posKeys } from '@/lib/pos/api';
import type { HeldBill } from '@/lib/pos/types';
import { useToast } from '@/components/Toast';

interface Props {
  open: boolean;
  onClose: () => void;
  onRecall: (bill: HeldBill) => void;
}

function summarize(cart: unknown): { count: number; gross: number } {
  const c = cart as Partial<HeldCart> | null;
  if (!c || !Array.isArray(c.lines)) return { count: 0, gross: 0 };
  return { count: c.lines.length, gross: cartGross(c.lines) };
}

export default function HeldBillsDialog({ open, onClose, onRecall }: Props) {
  const t = useTranslations('pos');
  const locale = resolveLocale(useLocale());
  const toast = useToast();
  const errorMessage = useApiErrorMessage();
  const qc = useQueryClient();

  const held = useQuery({ queryKey: posKeys.held, queryFn: posApi.heldBills, enabled: open, staleTime: 0 });

  const remove = useMutation({
    mutationFn: (id: string) => posApi.deleteHeld(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: posKeys.held });
      toast.success(t('heldDeleted'));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const bills = held.data ?? [];

  return (
    <GlassDialog
      open={open}
      onClose={onClose}
      title={`${t('recallBill')} (F4)`}
      maxWidth="sm"
      actions={
        <GlassButton variant="text" onClick={onClose}>
          {t('close')}
        </GlassButton>
      }
    >
      {held.isPending && (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}>
          <CircularProgress size={24} />
        </Box>
      )}
      {held.isSuccess && bills.length === 0 && (
        <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
          {t('noHeldBills')}
        </Typography>
      )}
      {bills.length > 0 && (
        <List disablePadding>
          {bills.map((b) => {
            const s = summarize(b.cart);
            return (
              <ListItem
                key={b.id}
                disablePadding
                secondaryAction={
                  <IconButton edge="end" aria-label={t('remove')} onClick={() => remove.mutate(b.id)} disabled={remove.isPending}>
                    <DeleteOutlineIcon />
                  </IconButton>
                }
              >
                <ListItemButton onClick={() => onRecall(b)} sx={{ borderRadius: 2 }} data-testid="held-bill">
                  <RestoreIcon sx={{ mr: 1.5, color: 'text.secondary' }} />
                  <ListItemText
                    primary={b.label || t('heldUnlabeled')}
                    secondary={`${formatDateTime(b.created_at, locale)} · ${t('itemsCount', { count: s.count })} · ${formatMoney(s.gross, locale)}`}
                  />
                </ListItemButton>
              </ListItem>
            );
          })}
        </List>
      )}
    </GlassDialog>
  );
}
