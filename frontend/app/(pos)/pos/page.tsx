'use client';

import CancelIcon from '@mui/icons-material/Cancel';
import HistoryIcon from '@mui/icons-material/History';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline';
import PaymentsIcon from '@mui/icons-material/Payments';
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import PrintIcon from '@mui/icons-material/Print';
import RestoreIcon from '@mui/icons-material/Restore';
import ScheduleIcon from '@mui/icons-material/Schedule';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import InputAdornment from '@mui/material/InputAdornment';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSession } from '@/components/Providers';
import { useToast } from '@/components/Toast';
import { GlassButton, GlassDialog, GlassInput } from '@/components/glass';
import BillHistoryDrawer from '@/components/pos/BillHistoryDrawer';
import CancelSaleDialog from '@/components/pos/CancelSaleDialog';
import CartGrid from '@/components/pos/CartGrid';
import HeldBillsDialog from '@/components/pos/HeldBillsDialog';
import MemberPicker, { MemberChip } from '@/components/pos/MemberPicker';
import ProductSearchDialog from '@/components/pos/ProductSearchDialog';
import ReceiptDialog, { readPrintReceiptOverride, writePrintReceipt } from '@/components/pos/ReceiptPrint';
import ScanInput, { type ScanInputHandle } from '@/components/pos/ScanInput';
import ShiftOpenDialog, { readTerminal } from '@/components/pos/ShiftOpenDialog';
import TenderDialog from '@/components/pos/TenderDialog';
import { resolveLocale } from '@/i18n/config';
import { isApiError } from '@/lib/api/client';
import { useApiErrorMessage } from '@/lib/api/errors';
import { MUTATING_ROLES } from '@/lib/auth/session';
import { formatMoney, formatQty, formatTime } from '@/lib/format';
import { posApi, posKeys } from '@/lib/pos/api';
import {
  addProduct,
  cartGross,
  cartItemCount,
  emptyCart,
  fromHeldCart,
  toHeldCart,
  toQuoteInput,
  toSaleInput,
  type CartLine,
  type CartState,
} from '@/lib/pos/cart';
import { dec, type HeldBill, type Member, type ProductView, type Sale, type TenderInput } from '@/lib/pos/types';

type DiscountMode = 'amount' | 'pct';

interface ReceiptState {
  saleId: string;
  change: number | null;
  copy: boolean;
  autoPrint: boolean;
  afterSale: boolean;
}

function useDebouncedValue<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

function TotalRow({ label, value, strong, color }: { label: ReactNode; value: string; strong?: boolean; color?: string }) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="baseline">
      <Typography variant={strong ? 'subtitle1' : 'body2'} color={strong ? 'text.primary' : 'text.secondary'} fontWeight={strong ? 700 : 400}>
        {label}
      </Typography>
      <Typography
        variant={strong ? 'h4' : 'body2'}
        fontWeight={strong ? 800 : 500}
        color={color}
        sx={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </Typography>
    </Stack>
  );
}

export default function PosPage() {
  const t = useTranslations('pos');
  const locale = resolveLocale(useLocale());
  const toast = useToast();
  const errorMessage = useApiErrorMessage();
  const qc = useQueryClient();
  const { hasRole } = useSession();
  const canCancel = hasRole(...MUTATING_ROLES);

  // ----- cart state --------------------------------------------------------
  const [cart, setCart] = useState<CartState>(emptyCart);
  const [member, setMember] = useState<Member | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [discountMode, setDiscountMode] = useState<DiscountMode>('amount');
  const [discountText, setDiscountText] = useState('');
  const [lastSale, setLastSale] = useState<Sale | null>(null);

  // ----- dialogs -----------------------------------------------------------
  const [search, setSearch] = useState<{ open: boolean; q: string; qty: number }>({ open: false, q: '', qty: 1 });
  const [memberOpen, setMemberOpen] = useState(false);
  const [tenderOpen, setTenderOpen] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptState | null>(null);
  const [heldOpen, setHeldOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [holdLabel, setHoldLabel] = useState('');
  const [shiftOpen, setShiftOpen] = useState(false);
  const [shiftDismissed, setShiftDismissed] = useState(false);
  const [cancelSale, setCancelSale] = useState<Sale | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const scanRef = useRef<ScanInputHandle>(null);

  const anyDialogOpen =
    search.open || memberOpen || tenderOpen || Boolean(receipt) || heldOpen || holdOpen || shiftOpen || Boolean(cancelSale) || historyOpen;

  // ----- server state ------------------------------------------------------
  const settings = useQuery({ queryKey: posKeys.settings, queryFn: posApi.settings, staleTime: 5 * 60_000 });
  const shift = useQuery({ queryKey: posKeys.shift, queryFn: posApi.currentShift, staleTime: 60_000 });
  const requireShift = Boolean(settings.data?.require_shift);
  // printing default: the cashier's own choice on this device wins, otherwise the store setting
  const [printOverride, setPrintOverride] = useState<boolean | null>(null);
  useEffect(() => setPrintOverride(readPrintReceiptOverride()), []);
  const printReceiptDefault = printOverride ?? (settings.data?.auto_print_receipt ?? true);
  const allowPriceEdit = Boolean(settings.data?.allow_price_edit);

  useEffect(() => {
    if (shift.isSuccess && shift.data === null && !shiftDismissed) setShiftOpen(true);
  }, [shift.isSuccess, shift.data, shiftDismissed]);

  const quoteInput = useMemo(() => toQuoteInput(cart), [cart]);
  const debouncedInput = useDebouncedValue(quoteInput, 300);
  const quote = useQuery({
    queryKey: ['pos', 'quote', debouncedInput],
    queryFn: ({ signal }) => posApi.quote(debouncedInput, signal),
    enabled: debouncedInput.lines.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 0,
    retry: false,
  });

  const localGross = cartGross(cart.lines);
  const totals = useMemo(() => {
    if (cart.lines.length === 0) return { gross: 0, lineDiscount: 0, promo: 0, billDiscount: 0, net: 0, fromServer: true };
    const q = quote.data;
    if (!q) {
      const manual = cart.lines.reduce((s, l) => (l.is_free ? s : s + l.discount), 0);
      const sub = Math.max(0, localGross - manual);
      const bill = Math.min(sub, cart.bill_discount + (sub * cart.bill_discount_pct) / 100);
      return { gross: localGross, lineDiscount: manual, promo: 0, billDiscount: bill, net: Math.max(0, sub - bill), fromServer: false };
    }
    const promo = (q.lines ?? []).reduce((s, l) => s + dec(l.promo_discount), 0);
    return {
      gross: dec(q.gross),
      lineDiscount: dec(q.line_discount) - promo,
      promo,
      billDiscount: dec(q.bill_discount),
      net: dec(q.net),
      fromServer: true,
    };
  }, [cart, quote.data, localGross]);

  const quoteError = quote.error && cart.lines.length > 0 ? errorMessage(quote.error) : null;

  // ----- cart operations ---------------------------------------------------
  const resetCart = useCallback(() => {
    setCart(emptyCart());
    setMember(null);
    setSelectedKey(null);
    setDiscountText('');
    scanRef.current?.focus();
  }, []);

  const addToCart = useCallback((p: ProductView, qty: number) => {
    if (p.is_archived || p.is_active === false) {
      toast.warning(t('productInactive', { name: p.name }));
      return;
    }
    setCart((c) => {
      const { lines, key } = addProduct(c.lines, p, qty);
      setSelectedKey(key);
      return { ...c, lines };
    });
  }, [t, toast]);

  const updateLine = useCallback((key: string, patch: Partial<CartLine>) => {
    setCart((c) => ({ ...c, lines: c.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  }, []);

  const removeLine = useCallback((key: string) => {
    setCart((c) => ({ ...c, lines: c.lines.filter((l) => l.key !== key) }));
    setSelectedKey((k) => (k === key ? null : k));
  }, []);

  const changeMember = (m: Member | null) => {
    setMember(m);
    setCart((c) => ({ ...c, member_id: m ? m.id : null }));
  };

  const applyDiscountText = (text: string, mode: DiscountMode) => {
    const n = Number(text);
    const v = Number.isFinite(n) && n > 0 ? n : 0;
    setCart((c) => ({ ...c, bill_discount: mode === 'amount' ? v : 0, bill_discount_pct: mode === 'pct' ? Math.min(v, 100) : 0 }));
  };

  // ----- scanning ----------------------------------------------------------
  const onScan = async (code: string, qty: number) => {
    setScanBusy(true);
    try {
      const p = await posApi.byBarcode(code);
      const pack = dec(p.pack_qty);
      addToCart(p, qty * (pack > 0 ? pack : 1));
    } catch (e) {
      if (isApiError(e) && e.status === 404) toast.error(t('barcodeNotFound', { code }));
      else toast.error(errorMessage(e));
      setSearch({ open: true, q: code, qty });
    } finally {
      setScanBusy(false);
    }
  };

  const onSearch = (q: string, qty: number) => setSearch({ open: true, q, qty });

  // ----- mutations ---------------------------------------------------------
  const createSale = useMutation({
    mutationFn: ({ payments }: { payments: TenderInput[]; print: boolean }) =>
      posApi.createSale(toSaleInput(cart, payments, readTerminal(settings.data?.default_terminal as string | undefined))),
    onSuccess: (sale, { print }) => {
      setTenderOpen(false);
      setLastSale(sale);
      qc.setQueryData(posKeys.sale(sale.id), sale);
      void qc.invalidateQueries({ queryKey: ['pos', 'sales'] });
      void qc.invalidateQueries({ queryKey: ['pos', 'summary'] });
      void qc.invalidateQueries({ queryKey: posKeys.shift });
      if (cart.held_bill_id) void qc.invalidateQueries({ queryKey: posKeys.held });
      toast.success(t('saleCompleted', { docNo: sale.doc_no }));
      // the receipt window only opens when this bill should be printed; otherwise the cashier
      // goes straight to the next customer and can still use "พิมพ์ซ้ำ" for the last bill
      if (print) setReceipt({ saleId: sale.id, change: dec(sale.change_amount), copy: false, autoPrint: true, afterSale: true });
      resetCart();
    },
  });

  const hold = useMutation({
    mutationFn: () => posApi.holdBill({ label: holdLabel.trim(), member_id: cart.member_id, cart: toHeldCart(cart) }),
    onSuccess: () => {
      setHoldOpen(false);
      setHoldLabel('');
      void qc.invalidateQueries({ queryKey: posKeys.held });
      toast.success(t('billHeld'));
      resetCart();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const openDrawer = useMutation({
    mutationFn: () => posApi.drawer({ reason: 'no_sale' }),
    onSuccess: () => toast.info(t('drawerOpened')),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const recall = async (bill: HeldBill) => {
    const restored = fromHeldCart(bill.cart, bill.id, bill.member_id);
    if (!restored) {
      toast.error(t('heldCorrupt'));
      return;
    }
    setHeldOpen(false);
    setCart(restored);
    setDiscountMode(restored.bill_discount_pct > 0 ? 'pct' : 'amount');
    setDiscountText(restored.bill_discount_pct > 0 ? String(restored.bill_discount_pct) : restored.bill_discount > 0 ? String(restored.bill_discount) : '');
    if (restored.member_id) {
      try {
        setMember(await posApi.member(restored.member_id));
      } catch {
        setMember(null);
        setCart((c) => ({ ...c, member_id: null }));
      }
    } else {
      setMember(null);
    }
    toast.info(t('billRecalled'));
  };

  const startTender = useCallback(() => {
    if (cart.lines.length === 0) {
      toast.warning(t('emptyCart'));
      return;
    }
    const missingSerial = cart.lines.find((l) => l.is_serial && !l.is_free && !l.serial_no?.trim());
    if (missingSerial) {
      toast.warning(t('serialMissing', { name: missingSerial.name }));
      return;
    }
    if (requireShift && shift.data === null) {
      setShiftOpen(true);
      return;
    }
    createSale.reset();
    setTenderOpen(true);
  }, [cart.lines, requireShift, shift.data, t, toast, createSale]);

  const cancelLast = useCallback(() => {
    if (!canCancel) return;
    if (!lastSale) {
      toast.info(t('noLastSale'));
      return;
    }
    setCancelSale(lastSale);
  }, [canCancel, lastSale, t, toast]);

  const reprintLast = useCallback(() => {
    if (!lastSale) {
      toast.info(t('noLastSale'));
      return;
    }
    setReceipt({ saleId: lastSale.id, change: null, copy: true, autoPrint: true, afterSale: false });
  }, [lastSale, t, toast]);

  // ----- hotkeys -----------------------------------------------------------
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.key.startsWith('F')) return;
      switch (e.key) {
        case 'F1':
          e.preventDefault();
          if (!anyDialogOpen) setSearch({ open: true, q: '', qty: 1 });
          break;
        case 'F2':
          e.preventDefault();
          if (!anyDialogOpen && cart.lines.length > 0) setHoldOpen(true);
          break;
        case 'F3':
          e.preventDefault();
          if (!anyDialogOpen) setMemberOpen(true);
          break;
        case 'F4':
          e.preventDefault();
          if (!anyDialogOpen) setHeldOpen(true);
          break;
        case 'F7':
          e.preventDefault();
          if (!anyDialogOpen) setHistoryOpen(true);
          break;
        case 'F8':
          e.preventDefault();
          if (!anyDialogOpen) cancelLast();
          break;
        case 'F9':
          e.preventDefault();
          if (!anyDialogOpen) startTender();
          break;
        case 'F10':
          e.preventDefault();
          if (!anyDialogOpen) openDrawer.mutate();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [anyDialogOpen, cart.lines.length, cancelLast, startTender, openDrawer]);

  // ----- render ------------------------------------------------------------
  const itemCount = cartItemCount(cart.lines);
  const shiftBanner = shift.data ? (
    <Chip
      size="small"
      color="success"
      icon={<ScheduleIcon />}
      component={Link}
      href="/pos/shift"
      clickable
      label={`${t('shiftOpen')} · ${shift.data.terminal} · ${formatTime(shift.data.opened_at, locale, false)}`}
    />
  ) : shift.isSuccess ? (
    <Chip size="small" color={requireShift ? 'error' : 'warning'} icon={<ScheduleIcon />} clickable onClick={() => setShiftOpen(true)} label={t('shiftClosed')} />
  ) : null;

  const totalsCard = (
    <Stack spacing={0.75} sx={{ p: 2, borderRadius: 3, background: (th) => th.glass.surfaceStrong, border: (th) => `1px solid ${th.glass.border}` }} data-testid="totals">
      <TotalRow label={`${t('items')} (${formatQty(itemCount, locale)})`} value={formatMoney(totals.gross, locale)} />
      {totals.lineDiscount > 0 && <TotalRow label={t('lineDiscount')} value={`-${formatMoney(totals.lineDiscount, locale)}`} />}
      {totals.promo > 0 && <TotalRow label={t('promoDiscount')} value={`-${formatMoney(totals.promo, locale)}`} color="secondary.main" />}
      {totals.billDiscount > 0 && <TotalRow label={t('billDiscount')} value={`-${formatMoney(totals.billDiscount, locale)}`} />}
      <Divider sx={{ my: 0.5 }} />
      <TotalRow label={t('net')} value={formatMoney(totals.net, locale)} strong />
      {!totals.fromServer && cart.lines.length > 0 && (
        <Typography variant="caption" color="text.secondary">
          {t('quoting')}
        </Typography>
      )}
      {quoteError && (
        <Typography variant="caption" color="error">
          {quoteError}
        </Typography>
      )}
    </Stack>
  );

  const payButton = (
    <GlassButton
      size="large"
      startIcon={<PaymentsIcon />}
      onClick={startTender}
      disabled={cart.lines.length === 0}
      data-testid="pay-button"
      sx={{ minHeight: 56, fontSize: 18, fontWeight: 700 }}
      fullWidth
    >
      {t('pay')} (F9)
    </GlassButton>
  );

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, gap: 1.5 }}>
      {/* Top bar: member / shift / quick actions */}
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <MemberChip member={member} onClick={() => setMemberOpen(true)} onClear={member ? () => changeMember(null) : undefined} />
        {shiftBanner}
        {cart.held_bill_id && <Chip size="small" variant="outlined" icon={<RestoreIcon />} label={t('recalledBill')} />}
        <Box sx={{ flex: 1 }} />
        <Tooltip title={`${t('holdBill')} (F2)`}>
          <span>
            <GlassButton variant="outlined" size="small" startIcon={<PauseCircleOutlineIcon />} disabled={cart.lines.length === 0} onClick={() => setHoldOpen(true)}>
              {t('holdBill')}
            </GlassButton>
          </span>
        </Tooltip>
        <Tooltip title={`${t('recallBill')} (F4)`}>
          <GlassButton variant="outlined" size="small" startIcon={<RestoreIcon />} onClick={() => setHeldOpen(true)}>
            {t('recallBill')}
          </GlassButton>
        </Tooltip>
        <Tooltip title={`${t('todayBills')} (F7)`}>
          <GlassButton variant="outlined" size="small" startIcon={<HistoryIcon />} onClick={() => setHistoryOpen(true)}>
            {t('bills')}
          </GlassButton>
        </Tooltip>
        <Tooltip title={t('reprintLast')}>
          <span>
            <GlassButton variant="outlined" size="small" startIcon={<PrintIcon />} onClick={reprintLast} disabled={!lastSale}>
              {t('reprint')}
            </GlassButton>
          </span>
        </Tooltip>
        {canCancel && (
          <Tooltip title={`${t('cancelLastBill')} (F8)`}>
            <span>
              <GlassButton variant="outlined" color="error" size="small" startIcon={<CancelIcon />} onClick={cancelLast} disabled={!lastSale}>
                {t('cancelSale')}
              </GlassButton>
            </span>
          </Tooltip>
        )}
        <Tooltip title={`${t('openDrawer')} (F10)`}>
          <GlassButton variant="outlined" size="small" startIcon={<PointOfSaleIcon />} onClick={() => openDrawer.mutate()} loading={openDrawer.isPending}>
            {t('openDrawer')}
          </GlassButton>
        </Tooltip>
      </Stack>

      {/* Main two-column area */}
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gap: 1.5,
          gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) 360px', lg: 'minmax(0, 1fr) 400px' },
          gridTemplateRows: { xs: 'auto minmax(240px, 1fr)', md: 'minmax(0, 1fr)' },
        }}
      >
        {/* Right column (rendered first on mobile so the scan box is on top) */}
        <Stack spacing={1.5} sx={{ order: { xs: 0, md: 1 }, minHeight: 0, overflow: { md: 'auto' } }}>
          <ScanInput ref={scanRef} onScan={onScan} onSearch={onSearch} suspended={anyDialogOpen} busy={scanBusy} />
          <Box sx={{ display: { xs: 'none', md: 'block' } }}>
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1} alignItems="center">
                <GlassInput
                  size="small"
                  type="number"
                  label={t('billDiscount')}
                  value={discountText}
                  onChange={(e) => {
                    setDiscountText(e.target.value);
                    applyDiscountText(e.target.value, discountMode);
                  }}
                  inputProps={{ min: 0, step: discountMode === 'pct' ? 1 : 0.25, inputMode: 'decimal', 'data-testid': 'bill-discount' }}
                  InputProps={{ endAdornment: <InputAdornment position="end">{discountMode === 'pct' ? '%' : '฿'}</InputAdornment> }}
                />
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={discountMode}
                  onChange={(_, v: DiscountMode | null) => {
                    if (!v) return;
                    setDiscountMode(v);
                    applyDiscountText(discountText, v);
                  }}
                >
                  <ToggleButton value="amount">฿</ToggleButton>
                  <ToggleButton value="pct">%</ToggleButton>
                </ToggleButtonGroup>
              </Stack>
              <GlassInput
                size="small"
                label={t('note')}
                value={cart.note}
                onChange={(e) => setCart((c) => ({ ...c, note: e.target.value }))}
                inputProps={{ maxLength: 200 }}
              />
              {totalsCard}
              {payButton}
              <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
                {t('hotkeysHint')}
              </Typography>
            </Stack>
          </Box>
        </Stack>

        {/* Left column: cart */}
        <Box sx={{ order: { xs: 1, md: 0 }, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <CartGrid
            lines={cart.lines}
            quoteLines={quote.data?.lines}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
            onChange={updateLine}
            onRemove={removeLine}
            hotkeys={!anyDialogOpen}
            allowPriceEdit={allowPriceEdit}
          />
        </Box>
      </Box>

      {/* Mobile bottom totals bar */}
      <Box
        sx={{
          display: { xs: 'flex', md: 'none' },
          position: 'sticky',
          bottom: 0,
          alignItems: 'center',
          gap: 1.5,
          p: 1.5,
          borderRadius: 3,
          background: (th) => th.glass.surfaceStrong,
          border: (th) => `1px solid ${th.glass.border}`,
          backdropFilter: 'blur(12px)',
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary">
            {t('net')} · {formatQty(itemCount, locale)} {t('items')}
            {totals.billDiscount + totals.promo + totals.lineDiscount > 0 ? ` · -${formatMoney(totals.billDiscount + totals.promo + totals.lineDiscount, locale)}` : ''}
          </Typography>
          <Typography variant="h5" fontWeight={800} noWrap sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {formatMoney(totals.net, locale)}
          </Typography>
        </Box>
        <Box sx={{ width: 180 }}>{payButton}</Box>
      </Box>

      {/* Dialogs */}
      <ProductSearchDialog
        open={search.open}
        initialQuery={search.q}
        qty={search.qty}
        onClose={() => {
          setSearch((s) => ({ ...s, open: false }));
          scanRef.current?.focus();
        }}
        onPick={addToCart}
      />
      <MemberPicker member={member} onChange={changeMember} open={memberOpen} onOpenChange={setMemberOpen} />
      <TenderDialog
        open={tenderOpen}
        onClose={() => setTenderOpen(false)}
        net={totals.net}
        member={member}
        busy={createSale.isPending}
        error={createSale.error ? errorMessage(createSale.error) : null}
        onConfirm={(payments, print) => createSale.mutate({ payments, print })}
        defaultPrintReceipt={printReceiptDefault}
        onPrintReceiptChange={(on) => {
          writePrintReceipt(on);
          setPrintOverride(on);
        }}
      />
      <ReceiptDialog
        open={Boolean(receipt)}
        saleId={receipt?.saleId ?? null}
        change={receipt?.change ?? null}
        copy={receipt?.copy}
        autoPrint={receipt?.autoPrint}
        onClose={() => {
          setReceipt(null);
          scanRef.current?.focus();
        }}
        onNewSale={
          receipt?.afterSale
            ? () => {
                setReceipt(null);
                scanRef.current?.focus();
              }
            : undefined
        }
      />
      <HeldBillsDialog open={heldOpen} onClose={() => setHeldOpen(false)} onRecall={(b) => void recall(b)} />
      <GlassDialog
        open={holdOpen}
        onClose={() => setHoldOpen(false)}
        busy={hold.isPending}
        title={`${t('holdBill')} (F2)`}
        maxWidth="xs"
        actions={
          <>
            <GlassButton variant="text" onClick={() => setHoldOpen(false)} disabled={hold.isPending}>
              {t('cancelAction')}
            </GlassButton>
            <GlassButton onClick={() => hold.mutate()} loading={hold.isPending} data-testid="hold-confirm">
              {t('holdBill')}
            </GlassButton>
          </>
        }
      >
        <Box sx={{ pt: 1 }}>
          <GlassInput
            autoFocus
            label={t('holdLabel')}
            placeholder={member ? member.name : t('holdLabelPlaceholder')}
            value={holdLabel}
            onChange={(e) => setHoldLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') hold.mutate();
            }}
          />
          <Typography variant="caption" color="text.secondary">
            {t('holdHint', { count: cart.lines.length, total: formatMoney(totals.net, locale) })}
          </Typography>
        </Box>
      </GlassDialog>
      <ShiftOpenDialog
        open={shiftOpen}
        required={requireShift}
        defaultTerminal={settings.data?.default_terminal as string | undefined}
        onClose={() => {
          setShiftOpen(false);
          setShiftDismissed(true);
        }}
      />
      <CancelSaleDialog
        sale={cancelSale}
        open={Boolean(cancelSale)}
        onClose={() => setCancelSale(null)}
        onCancelled={(s) => {
          if (lastSale?.id === s.id) setLastSale(s);
        }}
      />
      <BillHistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onReprint={(s) => {
          setHistoryOpen(false);
          setReceipt({ saleId: s.id, change: null, copy: true, autoPrint: true, afterSale: false });
        }}
        onCancel={(s) => {
          setHistoryOpen(false);
          setCancelSale(s);
        }}
      />
    </Box>
  );
}
