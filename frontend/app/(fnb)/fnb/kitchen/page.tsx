'use client';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { GlassButton } from '@/components/glass';
import { menuById, modifierById, stations, tableById } from '@/lib/fnb/mock';
import { useFnb, type Order, type OrderItem } from '@/lib/fnb/store';

const MotionBox = motion(Box);

/**
 * The kitchen display. One column of tickets per station, oldest first; a ticket turns amber
 * then red as it outlives the dish's prep time. Everything is a big tap target: cooks have wet
 * hands, no mouse, and stand two metres from the screen.
 */
export default function KitchenPage() {
  const t = useTranslations('fnb');
  const { orders, setItemStatus, bumpOrder } = useFnb();
  const [stationId, setStationId] = useState<string>('all');
  const [now, setNow] = useState(() => Date.now());

  // the clock drives the late colours, nothing else re-renders on it
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(id);
  }, []);

  const shown = stationId === 'all' ? stations : stations.filter((s) => s.id === stationId);

  const tickets = useMemo(() => {
    const open = orders.filter((o) => o.status !== 'closed');
    return shown.map((s) => ({
      station: s,
      orders: open
        .map((o) => ({ order: o, items: o.items.filter((i) => i.stationId === s.id && i.status !== 'served' && i.status !== 'void') }))
        .filter((x) => x.items.length > 0)
        .sort((a, b) => a.order.createdAt - b.order.createdAt),
    }));
  }, [orders, shown]);

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', p: 1.5, gap: 1.5 }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Chip label={t('all')} clickable color={stationId === 'all' ? 'primary' : 'default'} variant={stationId === 'all' ? 'filled' : 'outlined'} onClick={() => setStationId('all')} />
        {stations.map((s) => (
          <Chip
            key={s.id}
            label={`${s.name} · ${s.output === 'kds' ? t('outputKds') : s.output === 'printer' ? t('outputPrinter') : t('outputBoth')}`}
            clickable
            onClick={() => setStationId(s.id)}
            variant={stationId === s.id ? 'filled' : 'outlined'}
            sx={{ fontWeight: 700, ...(stationId === s.id ? { bgcolor: s.color, color: '#fff' } : { borderColor: s.color, color: s.color }) }}
            data-testid={`station-${s.id}`}
          />
        ))}
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" color="text.secondary">
          {t('prototypeNote')}
        </Typography>
      </Stack>

      <Box sx={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))`, gap: 1.5 }}>
        {tickets.map(({ station, orders: list }) => (
          <Box key={station.id} sx={{ minHeight: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: station.color, boxShadow: `0 0 12px ${station.color}` }} />
              <Typography fontWeight={800}>{station.name}</Typography>
              <Chip size="small" label={list.length} />
            </Stack>
            <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1, pr: 0.5 }} data-testid={`lane-${station.id}`}>
              <AnimatePresence initial={false}>
                {list.length === 0 && (
                  <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
                    {t('noTickets')}
                  </Typography>
                )}
                {list.map(({ order, items }) => (
                  <Ticket
                    key={order.id}
                    order={order}
                    items={items}
                    now={now}
                    accent={station.color}
                    onItem={(it, status) => setItemStatus(order.id, it.id, status)}
                    onBump={() => bumpOrder(order.id, station.id, items.every((i) => i.status === 'ready') ? 'served' : 'ready')}
                  />
                ))}
              </AnimatePresence>
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function Ticket({
  order,
  items,
  now,
  accent,
  onItem,
  onBump,
}: {
  order: Order;
  items: OrderItem[];
  now: number;
  accent: string;
  onItem: (it: OrderItem, status: OrderItem['status']) => void;
  onBump: () => void;
}) {
  const t = useTranslations('fnb');
  const ageMin = Math.floor((now - order.createdAt) / 60_000);
  const budget = Math.max(...items.map((i) => menuById[i.menuItemId]?.prepMinutes ?? 5));
  const late = ageMin >= budget;
  const warn = !late && ageMin >= budget * 0.6;
  const allReady = items.every((i) => i.status === 'ready');
  const border = late ? '#E53935' : warn ? '#FB8C00' : accent;
  const where = order.tableId ? `${t('table')} ${tableById[order.tableId]?.name ?? ''}` : order.queueNo ? `${t('queue')} ${order.queueNo}` : t('takeaway');

  return (
    <MotionBox
      layout
      initial={{ opacity: 0, y: -16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 380, damping: 28 }}
      data-testid="ticket"
      data-late={late ? '1' : '0'}
      sx={{
        borderRadius: 2.5,
        overflow: 'hidden',
        border: '2px solid',
        borderColor: border,
        background: (th) => (th.palette.mode === 'dark' ? 'rgba(10,18,30,0.6)' : 'rgba(255,255,255,0.75)'),
        boxShadow: late ? '0 0 0 4px rgba(229,57,53,0.18), 0 14px 30px -14px rgba(229,57,53,0.7)' : '0 12px 28px -18px rgba(0,0,0,0.6)',
        ...(late ? { animation: 'fnbPulse 1.2s ease-in-out infinite' } : {}),
        '@keyframes fnbPulse': { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-2px)' } },
      }}
    >
      <Stack direction="row" alignItems="center" sx={{ px: 1.5, py: 0.75, bgcolor: border, color: '#fff' }}>
        <Typography fontWeight={900} sx={{ fontSize: 20 }}>
          {where}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography fontWeight={800} sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {ageMin} {t('min')}
          {late ? ` · ${t('late')}` : ''}
        </Typography>
      </Stack>
      <Box sx={{ p: 1 }}>
        {items.map((it) => (
          <Stack
            key={it.id}
            direction="row"
            alignItems="center"
            spacing={1}
            onClick={() => onItem(it, it.status === 'sent' ? 'preparing' : it.status === 'preparing' ? 'ready' : 'served')}
            data-testid={`kds-item-${it.status}`}
            sx={{
              cursor: 'pointer',
              px: 1,
              py: 0.75,
              borderRadius: 1.5,
              opacity: it.status === 'ready' ? 0.55 : 1,
              textDecoration: it.status === 'ready' ? 'line-through' : 'none',
              '&:active': { bgcolor: 'action.selected' },
            }}
          >
            <Typography sx={{ fontSize: 22, minWidth: 34, fontWeight: 900, textAlign: 'center' }}>{it.qty}×</Typography>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography fontWeight={800} sx={{ fontSize: 18, lineHeight: 1.15 }}>
                {it.emoji} {it.name}
              </Typography>
              {it.modifierIds.length > 0 && (
                <Typography variant="body2" color="text.secondary">
                  {it.modifierIds.map((id) => modifierById[id]?.name).join(' · ')}
                </Typography>
              )}
              {it.note && (
                <Typography variant="body2" color="warning.main" fontWeight={700}>
                  ⚠ {it.note}
                </Typography>
              )}
            </Box>
            <Chip
              size="small"
              label={t(it.status)}
              color={it.status === 'preparing' ? 'warning' : it.status === 'ready' ? 'success' : 'default'}
              sx={{ fontWeight: 700 }}
            />
          </Stack>
        ))}
        <GlassButton fullWidth size="large" color={allReady ? 'success' : 'primary'} onClick={onBump} sx={{ mt: 1, fontSize: 18, fontWeight: 800 }} data-testid="bump">
          {allReady ? t('serve') : t('bumpAll')}
        </GlassButton>
      </Box>
    </MotionBox>
  );
}
