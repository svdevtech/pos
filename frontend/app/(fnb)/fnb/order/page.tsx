'use client';

import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import RemoveIcon from '@mui/icons-material/Remove';
import SendIcon from '@mui/icons-material/Send';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { AnimatePresence, motion } from 'framer-motion';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { useToast } from '@/components/Toast';
import { GlassButton } from '@/components/glass';
import ReceiptDialog from '@/components/pos/ReceiptPrint';
import TenderDialog from '@/components/pos/TenderDialog';
import { STATUS_COLOR } from '@/components/fnb/floorStatus';
import ModifierDialog from '@/components/fnb/ModifierDialog';
import { resolveLocale } from '@/i18n/config';
import { formatMoney } from '@/lib/format';
import { useFnb, type CartLine } from '@/lib/fnb/store';
import type { Channel, MenuItem } from '@/lib/fnb/types';
import { dec } from '@/lib/pos/types';

const MotionBox = motion(Box);

/**
 * The counter screen. A drink is one tap on the tile, a few taps on its options, one tap on
 * "add"; the running order sits on the right and never scrolls out of reach. The same screen
 * serves takeaway and, from the floor plan, a table — only the channel differs.
 */
export default function OrderPage() {
  const t = useTranslations('fnb');
  const locale = resolveLocale(useLocale());
  const toast = useToast();
  const { menu: m, floor, orders, placeOrder, quote, checkout, lineTotal, nextQueue, tableStatus, orderTotal } = useFnb();
  const { categories, items: menu, modifierById } = m;
  const [tableId, setTableId] = useState('');
  // paying at the counter: a counter or takeaway order is paid the moment it is sent
  const [tender, setTender] = useState<{ ids: string[]; net: number } | null>(null);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ saleId: string; change: number; autoPrint: boolean } | null>(null);
  const unpaid = orders.filter((o) => o.status === 'open' && !o.tableId);
  const startCheckout = async (ids: string[]) => {
    try {
      const q = await quote(ids);
      setPayError(null);
      setTender({ ids, net: dec(q.net) });
    } catch (e) {
      toast.error(String((e as Error)?.message ?? e));
    }
  };

  const [category, setCategory] = useState<string>('');
  // the first category once the menu is in, unless the cashier already picked one
  const activeCategory = category || categories[0]?.id || '';
  const [channel, setChannel] = useState<Channel>('counter');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [picking, setPicking] = useState<MenuItem | null>(null);
  const [lastQueue, setLastQueue] = useState<number | null>(null);

  const items = useMemo(() => menu.filter((x) => x.categoryId === activeCategory && x.channels.includes(channel)), [menu, activeCategory, channel]);
  const total = cart.reduce((s, l) => s + lineTotal(l), 0);

  const addLine = (line: CartLine) => {
    setCart((c) => {
      // the same item with the same options merges into one line, like a till does
      const key = (l: CartLine) => `${l.menuItemId}|${[...l.modifierIds].sort().join(',')}|${l.note ?? ''}`;
      const i = c.findIndex((l) => key(l) === key(line));
      if (i === -1) return [...c, line];
      const next = [...c];
      next[i] = { ...next[i], qty: next[i].qty + line.qty };
      return next;
    });
  };

  const tapTile = (m: MenuItem) => {
    // an item with nothing to choose goes straight in — a pastry should never open a dialog
    if (m.modifierGroupIds.length === 0) {
      addLine({ menuItemId: m.id, qty: 1, modifierIds: [] });
      return;
    }
    setPicking(m);
  };

  const [sending, setSending] = useState(false);
  const send = async () => {
    if (cart.length === 0 || sending) return;
    if (channel === 'dine_in' && !tableId) {
      toast.error(t('pickTable'));
      return;
    }
    setSending(true);
    try {
      const order = await placeOrder(cart, channel, channel === 'dine_in' ? { tableId, guests: floor.tableById[tableId]?.seats } : undefined);
      setCart([]);
      setLastQueue(order.queueNo);
      toast.success(`${t('queue')} ${order.queueNo}`);
      if (channel !== 'dine_in') await startCheckout([order.id]);
    } catch (e) {
      toast.error(String((e as Error)?.message ?? e));
    } finally {
      setSending(false);
    }
  };

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 360px' }, gap: 1.5, p: 1.5 }}>
      {/* ------------------------------------------------------------------ menu */}
      <Box sx={{ minHeight: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <ToggleButtonGroup size="small" exclusive value={channel} onChange={(_, v) => v && setChannel(v)} data-testid="channel">
            <ToggleButton value="counter">{t('counter')}</ToggleButton>
            <ToggleButton value="takeaway">{t('takeaway')}</ToggleButton>
            <ToggleButton value="dine_in">{t('dineIn')}</ToggleButton>
          </ToggleButtonGroup>
          {channel === 'dine_in' &&
            floor.tables.map((tb) => {
              const st = tableStatus(tb.id);
              const on = tb.id === tableId;
              return <Chip key={tb.id} size="small" label={tb.name} clickable onClick={() => setTableId(tb.id)} variant={on ? 'filled' : 'outlined'} sx={{ fontWeight: 700, ...(on ? { bgcolor: STATUS_COLOR[st], color: '#fff' } : { borderColor: STATUS_COLOR[st], color: STATUS_COLOR[st] }) }} data-testid={`pick-table-${tb.name}`} />;
            })}
          {unpaid.map((o) => (
            <Chip key={o.id} size="small" color="warning" label={`${t('unpaid')} #${o.queueNo} · ${formatMoney(orderTotal(o), locale)}`} clickable onClick={() => void startCheckout([o.id])} data-testid={`unpaid-${o.queueNo}`} />
          ))}
          <Box sx={{ flex: 1 }} />
          <Chip size="small" label={`${t('queue')} ${nextQueue}`} variant="outlined" />
        </Stack>

        <Stack direction="row" spacing={1} sx={{ overflowX: 'auto', pb: 0.5, flexShrink: 0 }}>
          {categories.map((c) => (
            <Chip
              key={c.id}
              label={`${c.emoji} ${c.name}`}
              clickable
              color={c.id === activeCategory ? 'primary' : 'default'}
              variant={c.id === activeCategory ? 'filled' : 'outlined'}
              onClick={() => setCategory(c.id)}
              sx={{ fontWeight: 600, fontSize: 15, py: 2.2 }}
              data-testid={`cat-${c.id}`}
            />
          ))}
        </Stack>

        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
            gap: 1.5,
            alignContent: 'start',
            pr: 0.5,
          }}
        >
          <AnimatePresence mode="popLayout">
            {items.map((m) => (
              <MotionBox
                key={m.id}
                layout
                initial={{ opacity: 0, y: 12, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.94 }}
                whileTap={{ scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 420, damping: 30 }}
                onClick={() => tapTile(m)}
                data-testid={`tile-${m.id}`}
                sx={{
                  cursor: 'pointer',
                  userSelect: 'none',
                  borderRadius: 3,
                  p: 1.5,
                  minHeight: 132,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  background: (th) => (th.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.7)'),
                  border: '1px solid',
                  borderColor: 'divider',
                  boxShadow: '0 10px 30px -18px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.12)',
                  transition: 'box-shadow .2s, transform .2s',
                  '&:hover': { boxShadow: '0 18px 40px -16px rgba(30,136,229,0.55)', transform: 'translateY(-2px)' },
                }}
              >
                <Typography sx={{ fontSize: 40, lineHeight: 1 }}>{m.emoji}</Typography>
                <Box>
                  <Typography fontWeight={700} lineHeight={1.2}>
                    {m.name}
                  </Typography>
                  <Typography variant="body2" color={m.promoName ? 'warning.main' : 'primary.main'} fontWeight={700}>
                    {formatMoney(m.price, locale)}
                    {m.listPrice !== undefined && (
                      <Typography component="span" variant="caption" color="text.secondary" sx={{ textDecoration: 'line-through', ml: 0.5 }}>
                        {formatMoney(m.listPrice, locale)}
                      </Typography>
                    )}
                  </Typography>
                  {m.promoName && <Chip size="small" color="warning" label={m.promoName} sx={{ mt: 0.5, height: 20, fontSize: 11, fontWeight: 700 }} data-testid={`promo-${m.id}`} />}
                </Box>
              </MotionBox>
            ))}
          </AnimatePresence>
        </Box>
      </Box>

      {/* ------------------------------------------------------------------ cart */}
      <Box
        sx={{
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 3,
          border: '1px solid',
          borderColor: 'divider',
          background: (th) => (th.palette.mode === 'dark' ? 'rgba(10,18,30,0.5)' : 'rgba(255,255,255,0.6)'),
          backdropFilter: 'blur(16px)',
        }}
        data-testid="cart"
      >
        <Box sx={{ p: 1.5, pb: 1 }}>
          <Typography variant="subtitle1" fontWeight={800}>
            {t('cart')}
          </Typography>
          {lastQueue !== null && cart.length === 0 && (
            <Typography variant="body2" color="success.main" fontWeight={700} data-testid="last-queue">
              {t('queue')} {lastQueue} · {t('sendToKitchen')} ✓
            </Typography>
          )}
        </Box>
        <Divider />
        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 1 }}>
          {cart.length === 0 ? (
            <Typography color="text.secondary" align="center" sx={{ py: 6 }}>
              {t('cartEmpty')}
            </Typography>
          ) : (
            <AnimatePresence initial={false}>
              {cart.map((l, i) => {
                const m = menu.find((x) => x.id === l.menuItemId);
                return (
                  <MotionBox
                    key={`${l.menuItemId}-${l.modifierIds.join('.')}-${l.note ?? ''}`}
                    layout
                    initial={{ opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 24, height: 0 }}
                    sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', py: 1, px: 0.5, borderBottom: '1px dashed', borderColor: 'divider' }}
                    data-testid="cart-line"
                  >
                    <Typography sx={{ fontSize: 24, lineHeight: 1.2 }}>{m?.emoji}</Typography>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography fontWeight={700} noWrap>
                        {m?.name}
                      </Typography>
                      {l.modifierIds.length > 0 && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          {l.modifierIds.map((id) => modifierById[id]?.name).join(' · ')}
                        </Typography>
                      )}
                      {l.note && (
                        <Typography variant="caption" color="warning.main" display="block">
                          {l.note}
                        </Typography>
                      )}
                      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mt: 0.5 }}>
                        <IconButton size="small" onClick={() => setCart((c) => c.map((x, j) => (j === i ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))}>
                          <RemoveIcon fontSize="small" />
                        </IconButton>
                        <Typography fontWeight={700} sx={{ minWidth: 20, textAlign: 'center' }} data-testid="line-qty">
                          {l.qty}
                        </Typography>
                        <IconButton size="small" onClick={() => setCart((c) => c.map((x, j) => (j === i ? { ...x, qty: x.qty + 1 } : x)))}>
                          <AddIcon fontSize="small" />
                        </IconButton>
                        <Box sx={{ flex: 1 }} />
                        <Typography fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>
                          {formatMoney(lineTotal(l), locale)}
                        </Typography>
                        <IconButton size="small" color="error" onClick={() => setCart((c) => c.filter((_, j) => j !== i))}>
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    </Box>
                  </MotionBox>
                );
              })}
            </AnimatePresence>
          )}
        </Box>
        <Divider />
        <Box sx={{ p: 1.5 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 1.5 }}>
            <Typography color="text.secondary">{t('total')}</Typography>
            <Typography variant="h4" fontWeight={800} sx={{ fontVariantNumeric: 'tabular-nums' }} data-testid="cart-total">
              {formatMoney(total, locale)}
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1}>
            <GlassButton variant="outlined" color="inherit" onClick={() => setCart([])} disabled={cart.length === 0}>
              {t('clear')}
            </GlassButton>
            <GlassButton fullWidth size="large" startIcon={<SendIcon />} onClick={() => void send()} disabled={cart.length === 0} loading={sending} data-testid="send-order">
              {channel === 'dine_in' ? t('sendToKitchen') : t('payAndSend')}
            </GlassButton>
          </Stack>
        </Box>
      </Box>

      {picking && <ModifierDialog item={picking} groups={m.modifierGroupById} price={(line) => lineTotal(line)} onClose={() => setPicking(null)} onAdd={(line) => { addLine(line); setPicking(null); }} />}

      <TenderDialog
        open={Boolean(tender)}
        onClose={() => setTender(null)}
        net={tender?.net ?? 0}
        member={null}
        busy={paying}
        error={payError}
        onConfirm={async (payments, print) => {
          if (!tender) return;
          setPaying(true);
          setPayError(null);
          try {
            const sale = await checkout(tender.ids, payments);
            setTender(null);
            setReceipt({ saleId: sale.id, change: dec(sale.change_amount), autoPrint: print });
          } catch (e) {
            setPayError(String((e as Error)?.message ?? e));
          } finally {
            setPaying(false);
          }
        }}
      />
      <ReceiptDialog open={Boolean(receipt)} saleId={receipt?.saleId ?? null} change={receipt?.change ?? null} autoPrint={receipt?.autoPrint} onClose={() => setReceipt(null)} />
    </Box>
  );
}
