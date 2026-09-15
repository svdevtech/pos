'use client';

import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import SendIcon from '@mui/icons-material/Send';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { GlassButton, GlassDialog } from '@/components/glass';
import { resolveLocale } from '@/i18n/config';
import { formatMoney } from '@/lib/format';
import type { LineInput, MenuItem, ModifierGroup, Order, OrderEvent } from '@/lib/fnb/api';
import { tableApi, tableUrl, type TableView } from '@/lib/fnb/publicApi';
import { qrPath } from '@/lib/pos/qrPayload';
import { dec } from '@/lib/pos/types';

/**
 * The page behind a table's QR. Two ways in, one page:
 *   - a customer's own phone after scanning: the menu, a basket, "send", and the status of what
 *     they ordered, kept live by the table's event stream
 *   - the tablet fixed to the table, opened with its own permanent kiosk token: a large QR for
 *     phones plus a button that opens the same ordering screen right there
 * No sign-in: the token in the URL says which shop and which table, and nothing more. The
 * customers' code is replaced every time the table is closed — the tablet hears the new one over
 * the stream and redraws the QR; a phone still holding the old one is told its session ended.
 */
export default function TablePage() {
  const t = useTranslations('fnb');
  const locale = resolveLocale(useLocale());
  const { token } = useParams<{ token: string }>();

  const [view, setView] = useState<TableView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordering, setOrdering] = useState(false);
  const kiosk = view?.kiosk ?? false;
  const [cart, setCart] = useState<LineInput[]>([]);
  const [picking, setPicking] = useState<MenuItem | null>(null);
  const [sending, setSending] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [category, setCategory] = useState('');

  useEffect(() => {
    tableApi
      .view(token)
      .then((v) => {
        setView(v);
        setOrders(v.orders);
      })
      .catch((e) => setError(String((e as Error)?.message ?? e)));
  }, [token]);

  // the table's own events: a dish going from preparing to ready shows without a refresh, and
  // the table closing ends the session (the tablet gets the next party's code instead)
  const loaded = !!view;
  useEffect(() => {
    if (!loaded) return;
    const es = new EventSource(tableApi.streamUrl(token));
    es.addEventListener('order', (e) => {
      try {
        const ev = JSON.parse((e as MessageEvent).data) as OrderEvent;
        if (ev.kind === 'table') {
          const fresh = ev.table?.token;
          if (fresh) {
            setView((v) => (v ? { ...v, guest_token: fresh, open: false } : v));
            setOrders([]);
            setCart([]);
            setSentAt(null);
            setOrdering(false);
          } else {
            setEnded(true);
            es.close();
          }
          return;
        }
        const order = ev.order;
        if (!order) return;
        // any order on the table means staff opened it (or someone ordered): the menu unlocks
        if (order.status === 'open' || order.status === 'paid') setView((v) => (v && !v.open ? { ...v, open: true } : v));
        setOrders((cur) => {
          const i = cur.findIndex((o) => o.id === order.id);
          const keep = order.status === 'open' || order.status === 'paid';
          if (i === -1) return keep ? [...cur, order] : cur;
          const next = [...cur];
          if (keep) next[i] = order;
          else next.splice(i, 1);
          return next;
        });
      } catch {
        /* ignore a bad frame */
      }
    });
    // a phone that reconnects after its code was replaced is refused outright (no retry)
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) setEnded(true);
    };
    return () => es.close();
  }, [token, loaded]);

  const menu = view?.menu;
  const groupById = useMemo(() => Object.fromEntries((menu?.modifier_groups ?? []).map((g) => [g.id, g])), [menu]);
  const modById = useMemo(() => Object.fromEntries((menu?.modifier_groups ?? []).flatMap((g) => g.modifiers.map((m) => [m.id, m]))), [menu]);
  const itemById = useMemo(() => Object.fromEntries((menu?.items ?? []).map((m) => [m.id, m])), [menu]);
  const activeCategory = category || menu?.categories[0]?.id || '';
  const items = (menu?.items ?? []).filter((m) => m.category_id === activeCategory);

  const linePrice = useCallback(
    (l: LineInput) => (dec(itemById[l.menu_item_id]?.price) + l.modifier_ids.reduce((s, id) => s + dec(modById[id]?.price_delta), 0)) * l.qty,
    [itemById, modById],
  );
  const total = cart.reduce((s, l) => s + linePrice(l), 0);

  const add = (line: LineInput) =>
    setCart((c) => {
      const key = (x: LineInput) => `${x.menu_item_id}|${[...x.modifier_ids].sort().join(',')}|${x.note ?? ''}`;
      const i = c.findIndex((x) => key(x) === key(line));
      if (i === -1) return [...c, line];
      const next = [...c];
      next[i] = { ...next[i], qty: next[i].qty + line.qty };
      return next;
    });

  const send = async () => {
    if (cart.length === 0 || sending) return;
    setSending(true);
    try {
      const o = await tableApi.order(token, cart);
      setOrders((cur) => [...cur.filter((x) => x.id !== o.id), o]);
      setCart([]);
      setSentAt(Date.now());
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setSending(false);
    }
  };

  if (ended && !kiosk) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 3 }}>
        <Box sx={{ textAlign: 'center' }} data-testid="t-ended">
          <Typography variant="h5" fontWeight={800} gutterBottom>
            {t('sessionEnded')}
          </Typography>
          <Typography color="text.secondary">{t('sessionEndedHint')}</Typography>
        </Box>
      </Box>
    );
  }
  const locked = Boolean(view?.requires_open && !view?.open);
  if (locked && view && !view.kiosk) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 3 }}>
        <Box sx={{ textAlign: 'center' }} data-testid="t-locked">
          <Typography variant="h5" fontWeight={800} gutterBottom>
            {view.store_name} · {t('table')} {view.table_code}
          </Typography>
          <Typography variant="h6" fontWeight={700} gutterBottom>
            {t('tableNotOpen')}
          </Typography>
          <Typography color="text.secondary">{t('tableNotOpenHint')}</Typography>
        </Box>
      </Box>
    );
  }
  if (error && !view) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 3 }}>
        <Typography color="error" align="center">
          {t('tableNotFound')}
        </Typography>
      </Box>
    );
  }
  if (!view || !menu) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  // ------------------------------------------------------------- kiosk: the QR screen
  if (kiosk && !ordering) {
    const url = tableUrl(view.guest_token ?? token);
    const m = qrPath(url, 1);
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, p: 3, textAlign: 'center' }} data-testid="kiosk">
        <Typography variant="h4" fontWeight={900}>
          {view.store_name}
        </Typography>
        <Typography variant="h5" fontWeight={700} color="text.secondary">
          {t('yourTable')} {view.table_code}
        </Typography>
        <Box sx={{ background: '#fff', p: 2, borderRadius: 3, boxShadow: '0 30px 60px -30px rgba(0,0,0,0.8)' }}>
          <svg viewBox={`0 0 ${m.size} ${m.size}`} width={280} height={280} shapeRendering="crispEdges" style={{ display: 'block' }}>
            <path d={m.path} fill="#000" />
          </svg>
        </Box>
        <Typography variant="h5" fontWeight={800}>
          {t('scanToOrder')}
        </Typography>
        <GlassButton size="large" variant="outlined" onClick={() => setOrdering(true)} disabled={locked} data-testid="kiosk-order">
          {locked ? t('waitingStaff') : t('orderHere')}
        </GlassButton>
        {orders.length > 0 && <OrderStatus orders={orders} t={t} locale={locale} />}
      </Box>
    );
  }

  // ------------------------------------------------------------- ordering
  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ p: 2, pb: 1 }}>
        <Stack direction="row" alignItems="baseline" spacing={1}>
          <Typography variant="h6" fontWeight={900} sx={{ flex: 1 }} noWrap>
            {view.store_name}
          </Typography>
          <Chip size="small" label={`${t('table')} ${view.table_code}`} color="primary" />
          {kiosk && (
            <GlassButton size="small" variant="text" onClick={() => setOrdering(false)}>
              {t('backToQr')}
            </GlassButton>
          )}
        </Stack>
      </Box>
      <Stack direction="row" spacing={1} sx={{ overflowX: 'auto', px: 2, pb: 1, flexShrink: 0 }}>
        {menu.categories.map((c) => (
          <Chip key={c.id} label={c.name} clickable color={c.id === activeCategory ? 'primary' : 'default'} variant={c.id === activeCategory ? 'filled' : 'outlined'} onClick={() => setCategory(c.id)} sx={{ fontWeight: 600 }} data-testid={`t-cat-${c.id}`} />
        ))}
      </Stack>
      <Box sx={{ flex: 1, px: 2, pb: 14 }}>
        {items.map((m) => (
          <Stack key={m.id} direction="row" alignItems="center" spacing={1.5} sx={{ py: 1.25, borderBottom: '1px dashed', borderColor: 'divider' }} data-testid={`t-item-${m.id}`}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography fontWeight={700}>{m.name}</Typography>
              <Typography variant="body2" color="primary.main" fontWeight={700}>
                {formatMoney(dec(m.price), locale)}
              </Typography>
            </Box>
            <GlassButton size="small" onClick={() => (m.modifier_group_ids.length ? setPicking(m) : add({ menu_item_id: m.id, qty: 1, modifier_ids: [] }))}>
              <AddIcon fontSize="small" />
            </GlassButton>
          </Stack>
        ))}
        {orders.length > 0 && (
          <Box sx={{ mt: 3 }}>
            <OrderStatus orders={orders} t={t} locale={locale} />
          </Box>
        )}
      </Box>

      {/* basket, pinned to the bottom of the phone */}
      <Box sx={{ position: 'fixed', left: 0, right: 0, bottom: 0, p: 1.5, backdropFilter: 'blur(14px)', background: 'rgba(10,18,30,0.75)', borderTop: '1px solid', borderColor: 'divider' }} data-testid="t-basket">
        {sentAt && cart.length === 0 && (
          <Typography variant="body2" color="success.main" fontWeight={700} align="center" sx={{ mb: 1 }}>
            {t('orderSent')}
          </Typography>
        )}
        {cart.map((l, i) => (
          <Stack key={i} direction="row" alignItems="center" spacing={1} sx={{ py: 0.25 }}>
            <IconButton size="small" onClick={() => setCart((c) => c.map((x, j) => (j === i ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))}>
              <RemoveIcon fontSize="small" />
            </IconButton>
            <Typography fontWeight={800} sx={{ minWidth: 18, textAlign: 'center' }}>
              {l.qty}
            </Typography>
            <IconButton size="small" onClick={() => setCart((c) => c.map((x, j) => (j === i ? { ...x, qty: x.qty + 1 } : x)))}>
              <AddIcon fontSize="small" />
            </IconButton>
            <Typography sx={{ flex: 1 }} noWrap variant="body2">
              {itemById[l.menu_item_id]?.name}
              {l.modifier_ids.length > 0 && (
                <Typography component="span" variant="caption" color="text.secondary">
                  {' · '}
                  {l.modifier_ids.map((id) => modById[id]?.name).join(' · ')}
                </Typography>
              )}
            </Typography>
            <Typography fontWeight={700} variant="body2">
              {formatMoney(linePrice(l), locale)}
            </Typography>
          </Stack>
        ))}
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mt: 1 }}>
          <Typography variant="h6" fontWeight={900} sx={{ flex: 1 }}>
            {formatMoney(total, locale)}
          </Typography>
          <GlassButton size="large" startIcon={<SendIcon />} onClick={() => void send()} disabled={cart.length === 0} loading={sending} data-testid="t-send">
            {t('placeOrder')} · {t('itemsInCart', { n: cart.reduce((s, l) => s + l.qty, 0) })}
          </GlassButton>
        </Stack>
      </Box>

      {picking && (
        <OptionDialog item={picking} groups={groupById} price={(l) => linePrice(l)} onClose={() => setPicking(null)} onAdd={(l) => { add(l); setPicking(null); }} />
      )}
    </Box>
  );
}

function OrderStatus({ orders, t, locale }: { orders: Order[]; t: ReturnType<typeof useTranslations<'fnb'>>; locale: ReturnType<typeof resolveLocale> }) {
  return (
    <Box data-testid="t-orders">
      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
        {t('yourOrders')}
      </Typography>
      {orders.map((o) => (
        <Box key={o.id} sx={{ mb: 1 }}>
          {o.items
            .filter((it) => it.status !== 'void')
            .map((it) => (
              <Stack key={it.id} direction="row" alignItems="center" spacing={1} sx={{ py: 0.4 }}>
                <Typography fontWeight={800} sx={{ minWidth: 26 }}>
                  {dec(it.qty)}×
                </Typography>
                <Typography sx={{ flex: 1 }} noWrap variant="body2">
                  {it.name}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {formatMoney((dec(it.unit_price) + it.modifiers.reduce((s, m) => s + dec(m.price_delta), 0)) * dec(it.qty), locale)}
                </Typography>
                <Chip size="small" label={t(it.status)} color={it.status === 'ready' ? 'success' : it.status === 'preparing' ? 'warning' : it.status === 'served' ? 'default' : 'info'} />
              </Stack>
            ))}
        </Box>
      ))}
      <Divider sx={{ my: 1 }} />
    </Box>
  );
}

/** Size, sweetness, milk…: the same questions the counter asks, answered by tapping chips. */
function OptionDialog({ item, groups: groupById, price, onClose, onAdd }: { item: MenuItem; groups: Record<string, ModifierGroup>; price: (l: LineInput) => number; onClose: () => void; onAdd: (l: LineInput) => void }) {
  const t = useTranslations('fnb');
  const locale = resolveLocale(useLocale());
  const groups = item.modifier_group_ids.map((id) => groupById[id]).filter(Boolean);
  const [chosen, setChosen] = useState<Record<string, string[]>>(() => Object.fromEntries(groups.map((g) => [g.id, g.modifiers.filter((m) => m.is_default).map((m) => m.id)])));
  const [qty, setQty] = useState(1);
  const toggle = (gid: string, mid: string) => {
    const g = groupById[gid];
    setChosen((c) => {
      const cur = c[gid] ?? [];
      if (cur.includes(mid)) return { ...c, [gid]: cur.filter((x) => x !== mid) };
      if (g.max_select === 1) return { ...c, [gid]: [mid] };
      if (cur.length >= g.max_select) return c;
      return { ...c, [gid]: [...cur, mid] };
    });
  };
  const modifier_ids = Object.values(chosen).flat();
  const valid = groups.every((g) => (chosen[g.id]?.length ?? 0) >= g.min_select);
  return (
    <GlassDialog
      open
      onClose={onClose}
      title={item.name}
      maxWidth="sm"
      data-testid="t-option-dialog"
      actions={
        <>
          <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mr: 'auto' }}>
            <IconButton onClick={() => setQty((q) => Math.max(1, q - 1))}>
              <RemoveIcon />
            </IconButton>
            <Typography variant="h6" fontWeight={800} sx={{ minWidth: 28, textAlign: 'center' }}>
              {qty}
            </Typography>
            <IconButton onClick={() => setQty((q) => q + 1)}>
              <AddIcon />
            </IconButton>
          </Stack>
          <GlassButton size="large" disabled={!valid} onClick={() => onAdd({ menu_item_id: item.id, qty, modifier_ids })} data-testid="t-option-add">
            {t('add')} · {formatMoney(price({ menu_item_id: item.id, qty, modifier_ids }), locale)}
          </GlassButton>
        </>
      }
    >
      <Stack spacing={2.5}>
        {groups.map((g) => (
          <Box key={g.id}>
            <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mb: 1 }}>
              <Typography fontWeight={700}>{g.name}</Typography>
              <Typography variant="caption" color={g.min_select > 0 ? 'error.main' : 'text.secondary'}>
                {g.min_select > 0 ? t('required') : t('chooseUpTo', { n: g.max_select })}
              </Typography>
            </Stack>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {g.modifiers.map((m) => {
                const on = chosen[g.id]?.includes(m.id);
                return <Chip key={m.id} label={dec(m.price_delta) ? `${m.name} +${dec(m.price_delta)}` : m.name} clickable color={on ? 'primary' : 'default'} variant={on ? 'filled' : 'outlined'} onClick={() => toggle(g.id, m.id)} sx={{ fontSize: 15, py: 2.4 }} data-testid={`t-mod-${m.id}`} />;
              })}
            </Stack>
          </Box>
        ))}
      </Stack>
    </GlassDialog>
  );
}
