'use client';

import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { STATUS_COLOR } from '@/components/fnb/floorStatus';
import { GlassButton, GlassDialog } from '@/components/glass';
import { resolveLocale } from '@/i18n/config';
import { formatMoney } from '@/lib/format';
import type { Order, Table, TableStatus } from '@/lib/fnb/store';

/** Pick the table a party moves to; an occupied target merges the two tables' orders. */
export function MoveTableDialog({ from, tables, statusOf, busy, onClose, onMove }: { from: Table; tables: Table[]; statusOf: (id: string) => TableStatus; busy: boolean; onClose: () => void; onMove: (to: Table) => void }) {
  const t = useTranslations('fnb');
  const [to, setTo] = useState<Table | null>(null);
  return (
    <GlassDialog
      open
      onClose={onClose}
      title={`${t('moveTable')} · ${t('table')} ${from.name}`}
      maxWidth="sm"
      data-testid="move-dialog"
      actions={
        <>
          <GlassButton variant="text" onClick={onClose}>
            {t('cfg.cancel')}
          </GlassButton>
          <GlassButton onClick={() => to && onMove(to)} disabled={!to} loading={busy} data-testid="move-confirm">
            {to && statusOf(to.id) !== 'free' ? t('mergeInto', { table: to.name }) : t('moveTable')}
          </GlassButton>
        </>
      }
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {t('moveTableHint')}
      </Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {tables
          .filter((x) => x.id !== from.id)
          .map((x) => {
            const st = statusOf(x.id);
            const on = to?.id === x.id;
            return <Chip key={x.id} label={`${x.name} · ${t('seats', { n: x.seats })}`} clickable onClick={() => setTo(x)} variant={on ? 'filled' : 'outlined'} sx={{ fontWeight: 700, fontSize: 15, py: 2.2, ...(on ? { bgcolor: STATUS_COLOR[st], color: '#fff' } : { borderColor: STATUS_COLOR[st], color: STATUS_COLOR[st] }) }} data-testid={`move-to-${x.name}`} />;
          })}
      </Stack>
    </GlassDialog>
  );
}

/** Tick the dishes one part of the party pays for; they become their own bill. */
export function SplitBillDialog({ orders, busy, onClose, onSplit }: { orders: Order[]; busy: boolean; onClose: () => void; onSplit: (picked: Record<string, string[]>) => void }) {
  const t = useTranslations('fnb');
  const locale = resolveLocale(useLocale());
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const toggle = (orderId: string, itemId: string) =>
    setPicked((p) => {
      const cur = p[orderId] ?? [];
      return { ...p, [orderId]: cur.includes(itemId) ? cur.filter((x) => x !== itemId) : [...cur, itemId] };
    });
  const live = (o: Order) => o.items.filter((i) => i.status !== 'void');
  const chosen = Object.values(picked).flat();
  const total = orders.reduce((s, o) => s + live(o).filter((i) => (picked[o.id] ?? []).includes(i.id)).reduce((x, i) => x + i.unitPrice * i.qty, 0), 0);
  const all = orders.every((o) => live(o).every((i) => (picked[o.id] ?? []).includes(i.id)));
  return (
    <GlassDialog
      open
      onClose={onClose}
      title={t('splitBill')}
      maxWidth="sm"
      data-testid="split-dialog"
      actions={
        <>
          <GlassButton variant="text" onClick={onClose}>
            {t('cfg.cancel')}
          </GlassButton>
          <GlassButton onClick={() => onSplit(picked)} disabled={chosen.length === 0 || all} loading={busy} data-testid="split-confirm">
            {t('splitAndPay')} · {formatMoney(total, locale)}
          </GlassButton>
        </>
      }
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {t('splitBillHint')}
      </Typography>
      {orders.map((o) => (
        <Box key={o.id} sx={{ mb: 1.5 }}>
          <Typography variant="caption" color="text.secondary">
            {t('orderNo')} #{o.queueNo}
          </Typography>
          {live(o).map((it) => {
            const on = (picked[o.id] ?? []).includes(it.id);
            return (
              <Stack key={it.id} direction="row" alignItems="center" spacing={1} onClick={() => toggle(o.id, it.id)} sx={{ py: 0.5, cursor: 'pointer', borderRadius: 1.5, '&:hover': { bgcolor: 'action.hover' } }} data-testid={`split-item-${it.id}`}>
                <Checkbox checked={on} size="small" />
                <Typography fontWeight={800} sx={{ minWidth: 28 }}>
                  {it.qty}×
                </Typography>
                <Typography sx={{ flex: 1 }} noWrap>
                  {it.emoji} {it.name}
                  {it.modifierNames.length > 0 && (
                    <Typography component="span" variant="caption" color="text.secondary">
                      {' · '}
                      {it.modifierNames.join(' · ')}
                    </Typography>
                  )}
                </Typography>
                <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatMoney(it.unitPrice * it.qty, locale)}
                </Typography>
              </Stack>
            );
          })}
        </Box>
      ))}
    </GlassDialog>
  );
}
