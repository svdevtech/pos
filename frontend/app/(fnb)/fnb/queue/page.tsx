'use client';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { useFnb, type Order } from '@/lib/fnb/store';

const MotionBox = motion(Box);

/**
 * The screen customers watch at a café counter: on the left the numbers being made, on the
 * right the ones ready to collect, in a size readable from the far end of the room. Counter,
 * takeaway and delivery orders only — a table's food is carried to it.
 */
export default function QueuePage() {
  const t = useTranslations('fnb');
  const { orders, live } = useFnb();

  const { making, ready } = useMemo(() => {
    const making: Order[] = [];
    const ready: Order[] = [];
    for (const o of orders) {
      if (o.tableId || o.status === 'closed' || o.status === 'void') continue;
      const items = o.items.filter((i) => i.status !== 'void' && i.status !== 'served');
      if (items.length === 0) continue;
      (items.every((i) => i.status === 'ready') ? ready : making).push(o);
    }
    const byNo = (a: Order, b: Order) => a.queueNo - b.queueNo;
    return { making: making.sort(byNo), ready: ready.sort(byNo) };
  }, [orders]);

  const column = (title: string, list: Order[], color: string, testId: string) => (
    <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }} data-testid={testId}>
      <Typography variant="h4" fontWeight={900} align="center" sx={{ color, mb: 2, letterSpacing: 1 }}>
        {title}
      </Typography>
      <Box sx={{ flex: 1, display: 'flex', flexWrap: 'wrap', alignContent: 'flex-start', justifyContent: 'center', gap: 2 }}>
        <AnimatePresence initial={false}>
          {list.map((o) => (
            <MotionBox
              key={o.id}
              layout
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ type: 'spring', stiffness: 320, damping: 24 }}
              data-testid={`queue-${o.queueNo}`}
              sx={{
                minWidth: 150,
                px: 3,
                py: 1.5,
                borderRadius: 4,
                textAlign: 'center',
                bgcolor: color,
                color: '#fff',
                boxShadow: `0 18px 40px -18px ${color}`,
                ...(testId === 'queue-ready' ? { animation: 'queuePulse 1.6s ease-in-out infinite', '@keyframes queuePulse': { '0%,100%': { transform: 'scale(1)' }, '50%': { transform: 'scale(1.06)' } } } : {}),
              }}
            >
              <Typography sx={{ fontSize: 72, fontWeight: 900, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{o.queueNo}</Typography>
              <Typography variant="body2" sx={{ opacity: 0.85, fontWeight: 700 }}>
                {o.items.filter((i) => i.status !== 'void').length} {t('itemsShort')}
              </Typography>
            </MotionBox>
          ))}
        </AnimatePresence>
        {list.length === 0 && (
          <Typography color="text.secondary" sx={{ mt: 6 }}>
            —
          </Typography>
        )}
      </Box>
    </Box>
  );

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', p: 3, gap: 2 }}>
      <Stack direction="row" spacing={3} sx={{ flex: 1, minHeight: 0 }}>
        {column(t('nowServing'), making, '#FB8C00', 'queue-making')}
        <Box sx={{ width: 2, bgcolor: 'divider', borderRadius: 1 }} />
        {column(t('pickUp'), ready, '#3ba55d', 'queue-ready')}
      </Stack>
      <Typography variant="caption" color="text.secondary" align="center">
        {live ? t('live') : t('offline')}
      </Typography>
    </Box>
  );
}
