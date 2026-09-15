'use client';

import AddIcon from '@mui/icons-material/Add';
import CallSplitIcon from '@mui/icons-material/CallSplit';
import CloseIcon from '@mui/icons-material/Close';
import EventSeatIcon from '@mui/icons-material/EventSeat';
import PaymentsIcon from '@mui/icons-material/Payments';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import RemoveIcon from '@mui/icons-material/Remove';
import SendIcon from '@mui/icons-material/Send';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import FloorPlan2D from '@/components/fnb/FloorPlan2D';
import FloorPlan3DFrame from '@/components/fnb/FloorPlan3DFrame';
import { STATUS_COLOR } from '@/components/fnb/floorStatus';
import { MoveTableDialog, SplitBillDialog } from '@/components/fnb/TableDialogs';
import { GlassButton, GlassDialog } from '@/components/glass';
import ReceiptDialog from '@/components/pos/ReceiptPrint';
import TenderDialog from '@/components/pos/TenderDialog';
import { useToast } from '@/components/Toast';
import { resolveLocale } from '@/i18n/config';
import { formatMoney } from '@/lib/format';
import { useFnb, type CartLine, type TableStatus } from '@/lib/fnb/store';
import type { Category, MenuItem } from '@/lib/fnb/types';
import { dec } from '@/lib/pos/types';


function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

const STATUS_KEY: Record<TableStatus, 'free' | 'seated' | 'waiting' | 'readyTable' | 'bill'> = {
  free: 'free',
  seated: 'seated',
  waiting: 'waiting',
  ready: 'readyTable',
  bill: 'bill',
};

/**
 * The floor. Tap a table and a side panel opens with what is on it; from there a waiter opens
 * the table, adds dishes and sends them, and the cashier closes it out. The 3D plan is the
 * default; the 2D one is a tap away and takes over by itself when the device cannot draw 3D.
 */
export default function FloorPage() {
  const t = useTranslations('fnb');
  const locale = resolveLocale(useLocale());
  const toast = useToast();
  const { menu, floor, tableStatus, ordersForTable, placeOrder, openTable, moveTable, splitOrder, quote, checkout, closeTable, orderTotal } = useFnb();
  const { tableById, zones } = floor;

  const [view, setView] = useState<'3d' | '2d'>('3d');
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [ordering, setOrdering] = useState(false);
  const [lowFps, setLowFps] = useState(0);
  // paying: the tender screen the till uses, then the receipt it prints
  const [tender, setTender] = useState<{ ids: string[]; net: number } | null>(null);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ saleId: string; change: number; autoPrint: boolean } | null>(null);
  const [moving, setMoving] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => setWebgl(hasWebGL()), []);
  // three consecutive seconds under 24 fps: this device is not going to manage 3D, stop trying
  const onFps = useCallback((fps: number) => setLowFps((n) => (fps < 24 ? n + 1 : 0)), []);
  useEffect(() => {
    if (lowFps >= 3) setView('2d');
  }, [lowFps]);

  const show3d = view === '3d' && webgl === true;
  const table = selected ? tableById[selected] : null;
  const status = selected ? tableStatus(selected) : 'free';
  const orders = selected ? ordersForTable(selected) : [];
  const total = orders.reduce((s, o) => s + orderTotal(o), 0);
  const unpaid = orders.filter((o) => o.status === 'open' && o.items.some((i) => i.status !== 'void'));
  const liveItems = unpaid.reduce((n, o) => n + o.items.filter((i) => i.status !== 'void').length, 0);
  const startCheckout = async (ids = unpaid.map((o) => o.id)) => {
    try {
      const q = await quote(ids);
      setPayError(null);
      setTender({ ids, net: dec(q.net) });
    } catch (e) {
      toast.error(String((e as Error)?.message ?? e));
    }
  };
  // split: the ticked lines of each order become an order of their own (an order whose every
  // line is ticked simply goes as it is), then those orders are paid together
  const split = async (picked: Record<string, string[]>) => {
    setWorking(true);
    try {
      const ids: string[] = [];
      for (const o of unpaid) {
        const chosen = picked[o.id] ?? [];
        if (chosen.length === 0) continue;
        const live = o.items.filter((i) => i.status !== 'void');
        if (chosen.length === live.length) ids.push(o.id);
        else ids.push((await splitOrder(o.id, chosen)).id);
      }
      setSplitting(false);
      await startCheckout(ids);
    } catch (e) {
      toast.error(String((e as Error)?.message ?? e));
    } finally {
      setWorking(false);
    }
  };
  const counts = useMemo(() => {
    const c: Record<TableStatus, number> = { free: 0, seated: 0, waiting: 0, ready: 0, bill: 0 };
    for (const id of Object.keys(tableById)) c[tableStatus(id)] += 1;
    return c;
  }, [tableStatus, tableById]);

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', p: 1.5, gap: 1 }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        {(Object.keys(STATUS_COLOR) as TableStatus[]).map((s) => (
          <Chip key={s} size="small" label={`${t(STATUS_KEY[s])} ${counts[s]}`} sx={{ bgcolor: STATUS_COLOR[s], color: '#fff', fontWeight: 700 }} data-testid={`legend-${s}`} />
        ))}
        <Box sx={{ flex: 1 }} />
        {webgl === false && (
          <Typography variant="caption" color="warning.main">
            {t('webglMissing')}
          </Typography>
        )}
        <ToggleButtonGroup size="small" exclusive value={show3d ? '3d' : '2d'} onChange={(_, v) => v && setView(v)} data-testid="view-toggle">
          <ToggleButton value="3d" disabled={webgl === false}>
            {t('view3d')}
          </ToggleButton>
          <ToggleButton value="2d">{t('view2d')}</ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      <Box sx={{ flex: 1, minHeight: 0, borderRadius: 3, overflow: 'hidden', border: '1px solid', borderColor: 'divider', position: 'relative' }}>
        {webgl === null ? null : show3d ? (
          <FloorPlan3DFrame floor={floor} statusOf={tableStatus} selectedId={selected} onSelect={setSelected} onFps={onFps} />
        ) : (
          <FloorPlan2D floor={floor} statusOf={tableStatus} selectedId={selected} onSelect={setSelected} />
        )}
      </Box>

      <Drawer anchor="right" open={Boolean(table)} onClose={() => setSelected(null)} PaperProps={{ sx: { width: { xs: '100%', sm: 400 } } }}>
        {table && (
          <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }} data-testid="table-panel">
            <Stack direction="row" alignItems="center" sx={{ p: 2, pb: 1 }} spacing={1}>
              <Box sx={{ width: 14, height: 14, borderRadius: '50%', bgcolor: STATUS_COLOR[status] }} />
              <Typography variant="h5" fontWeight={900}>
                {t('table')} {table.name}
              </Typography>
              <Chip size="small" label={t(STATUS_KEY[status])} sx={{ bgcolor: STATUS_COLOR[status], color: '#fff', fontWeight: 700 }} data-testid="panel-status" />
              <Box sx={{ flex: 1 }} />
              <IconButton onClick={() => setSelected(null)} aria-label="close">
                <CloseIcon />
              </IconButton>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ px: 2 }}>
              {zones.find((z) => z.id === table.zoneId)?.name} · {t('seats', { n: table.seats })}
            </Typography>
            <Divider sx={{ my: 1.5 }} />
            <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2 }}>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                {t('tableOrders')}
              </Typography>
              {orders.length === 0 ? (
                <Typography color="text.secondary" sx={{ py: 3 }} align="center">
                  {t('nothingYet')}
                </Typography>
              ) : (
                orders.map((o) => (
                  <Box key={o.id} sx={{ mb: 1.5 }}>
                    {o.items.map((it) => (
                      <Stack key={it.id} direction="row" spacing={1} alignItems="center" sx={{ py: 0.5 }}>
                        <Typography fontWeight={800} sx={{ minWidth: 28 }}>
                          {it.qty}×
                        </Typography>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography fontWeight={600} noWrap>
                            {it.emoji} {it.name}
                          </Typography>
                          {it.modifierNames.length > 0 && (
                            <Typography variant="caption" color="text.secondary">
                              {it.modifierNames.join(' · ')}
                            </Typography>
                          )}
                        </Box>
                        <Chip size="small" label={t(it.status)} color={it.status === 'ready' ? 'success' : it.status === 'preparing' ? 'warning' : 'default'} />
                      </Stack>
                    ))}
                    {o.status === 'paid' && (
                      <Chip size="small" color="secondary" label={t('paid')} sx={{ mt: 0.5 }} />
                    )}
                  </Box>
                ))
              )}
            </Box>
            <Divider />
            <Box sx={{ p: 2 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 1.5 }}>
                <Typography color="text.secondary">{t('total')}</Typography>
                <Typography variant="h4" fontWeight={800} sx={{ fontVariantNumeric: 'tabular-nums' }} data-testid="table-total">
                  {formatMoney(total, locale)}
                </Typography>
              </Stack>
              <Stack spacing={1}>
                {status === 'free' && (
                  <GlassButton size="large" variant="outlined" startIcon={<EventSeatIcon />} onClick={() => void openTable(table.id, table.seats).catch((e) => toast.error(String((e as Error)?.message ?? e)))} data-testid="table-seat">
                    {t('seatOnly')}
                  </GlassButton>
                )}
                <GlassButton size="large" startIcon={<AddIcon />} onClick={() => setOrdering(true)} data-testid="table-order">
                  {status === 'free' ? t('orderNow') : t('orderMore')}
                </GlassButton>
                {status !== 'free' && (
                  <Stack direction="row" spacing={1}>
                    <GlassButton fullWidth variant="outlined" startIcon={<SwapHorizIcon />} onClick={() => setMoving(true)} data-testid="table-move">
                      {t('moveTable')}
                    </GlassButton>
                    {liveItems >= 2 && (
                      <GlassButton fullWidth variant="outlined" startIcon={<CallSplitIcon />} onClick={() => setSplitting(true)} data-testid="table-split">
                        {t('splitBill')}
                      </GlassButton>
                    )}
                  </Stack>
                )}
                {unpaid.length > 0 && (
                  <GlassButton size="large" color="secondary" startIcon={<PaymentsIcon />} onClick={() => void startCheckout()} data-testid="table-checkout">
                    {t('checkout')} · {formatMoney(unpaid.reduce((s, o) => s + orderTotal(o), 0), locale)}
                  </GlassButton>
                )}
                {status === 'bill' && (
                  <GlassButton size="large" color="success" onClick={() => void closeTable(table.id).then(() => setSelected(null))} data-testid="table-close">
                    {t('closeTable')}
                  </GlassButton>
                )}
              </Stack>
            </Box>
          </Box>
        )}
      </Drawer>

      {table && moving && (
        <MoveTableDialog
          from={table}
          tables={floor.tables}
          statusOf={tableStatus}
          busy={working}
          onClose={() => setMoving(false)}
          onMove={(to) => {
            setWorking(true);
            moveTable(table.id, to.id)
              .then(() => {
                setMoving(false);
                setSelected(to.id);
              })
              .catch((e) => toast.error(String((e as Error)?.message ?? e)))
              .finally(() => setWorking(false));
          }}
        />
      )}
      {table && splitting && <SplitBillDialog orders={unpaid} busy={working} onClose={() => setSplitting(false)} onSplit={(picked) => void split(picked)} />}

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

      {table && ordering && (
        <TableOrderDialog
          categories={menu.categories}
          items={menu.items}
          onClose={() => setOrdering(false)}
          onSend={(lines) => void placeOrder(lines, 'dine_in', { tableId: table.id, guests: table.seats }).then(() => setOrdering(false))}
        />
      )}
    </Box>
  );
}

/** A compact menu for the waiter's phone: category tabs, tap to add, defaults for the options. */
function TableOrderDialog({
  categories,
  items: menu,
  onClose,
  onSend,
}: {
  categories: Category[];
  items: MenuItem[];
  onClose: () => void;
  onSend: (lines: CartLine[]) => void;
}) {
  const t = useTranslations('fnb');
  const locale = resolveLocale(useLocale());
  const { lineTotal } = useFnb();
  // open on the first food category: a waiter at a table is not there for coffee first
  const [category, setCategory] = useState<string>(categories.find((c) => /ข้าว|rice/i.test(c.name))?.id ?? categories[0]?.id ?? '');
  const [lines, setLines] = useState<CartLine[]>([]);
  const items = menu.filter((m) => m.categoryId === category && m.channels.includes('dine_in'));
  const total = lines.reduce((s, l) => s + lineTotal(l), 0);

  const add = (id: string) =>
    setLines((ls) => {
      const i = ls.findIndex((l) => l.menuItemId === id && l.modifierIds.length === 0);
      if (i === -1) return [...ls, { menuItemId: id, qty: 1, modifierIds: [] }];
      const next = [...ls];
      next[i] = { ...next[i], qty: next[i].qty + 1 };
      return next;
    });

  return (
    <GlassDialog
      open
      onClose={onClose}
      title={t('orderMore')}
      maxWidth="md"
      data-testid="table-order-dialog"
      actions={
        <>
          <Typography variant="h6" fontWeight={800} sx={{ mr: 'auto' }}>
            {formatMoney(total, locale)}
          </Typography>
          <GlassButton size="large" startIcon={<SendIcon />} disabled={lines.length === 0} onClick={() => onSend(lines)} data-testid="table-send">
            {t('sendToKitchen')}
          </GlassButton>
        </>
      }
    >
      <Stack direction="row" spacing={1} sx={{ overflowX: 'auto', pb: 1 }}>
        {categories.map((c) => (
          <Chip key={c.id} label={`${c.emoji} ${c.name}`} clickable color={c.id === category ? 'primary' : 'default'} variant={c.id === category ? 'filled' : 'outlined'} onClick={() => setCategory(c.id)} />
        ))}
      </Stack>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 1, mb: 2 }}>
        {items.map((m) => (
          <Box
            key={m.id}
            onClick={() => add(m.id)}
            data-testid={`table-tile-${m.id}`}
            sx={{ cursor: 'pointer', borderRadius: 2, p: 1.25, border: '1px solid', borderColor: 'divider', '&:active': { transform: 'scale(0.97)' } }}
          >
            <Typography sx={{ fontSize: 28, lineHeight: 1 }}>{m.emoji}</Typography>
            <Typography fontWeight={700} variant="body2" noWrap>
              {m.name}
            </Typography>
            <Typography variant="caption" color="primary.main" fontWeight={700}>
              {formatMoney(m.price, locale)}
            </Typography>
          </Box>
        ))}
      </Box>
      {lines.map((l, i) => {
        const m = menu.find((x) => x.id === l.menuItemId);
        return (
          <Stack key={i} direction="row" alignItems="center" spacing={1} sx={{ py: 0.5, borderTop: '1px dashed', borderColor: 'divider' }}>
            <IconButton size="small" onClick={() => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))}>
              <RemoveIcon fontSize="small" />
            </IconButton>
            <Typography fontWeight={800} sx={{ minWidth: 20, textAlign: 'center' }}>
              {l.qty}
            </Typography>
            <IconButton size="small" onClick={() => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: x.qty + 1 } : x)))}>
              <AddIcon fontSize="small" />
            </IconButton>
            <Typography sx={{ flex: 1 }} noWrap>
              {m?.emoji} {m?.name}
            </Typography>
            <Typography fontWeight={700}>{formatMoney(lineTotal(l), locale)}</Typography>
          </Stack>
        );
      })}
    </GlassDialog>
  );
}
