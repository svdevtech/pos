/**
 * Shapes returned by the sales / products / members / shifts endpoints.
 * Money and quantity values arrive as JSON strings (Go decimal); use `dec()`.
 */

export type PaymentMethod = 'cash' | 'credit' | 'transfer' | 'card' | 'qr' | 'other';
export const PAYMENT_METHODS: readonly PaymentMethod[] = ['cash', 'transfer', 'card', 'qr', 'credit'];

export type Money = string | number;

/** Parses a Go-decimal string (or number) into a JS number; `0` for anything unparsable. */
export function dec(value: Money | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Rounds half away from zero to 2 dp, matching `domain.Money` on the backend. */
export function money(n: number): number {
  const sign = n < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(n) * 100 + Number.EPSILON)) / 100;
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export interface ProductBarcode {
  id: string;
  product_id: string;
  barcode: string;
  is_primary: boolean;
  pack_qty: Money;
}

export interface ProductView {
  id: string;
  sku: string;
  name: string;
  name_en?: string;
  category_id?: string | null;
  unit_id?: string | null;
  sell_price: Money;
  stock_on_hand: Money;
  is_serial: boolean;
  is_active: boolean;
  is_archived: boolean;
  image_url?: string;
  category_name?: string;
  unit_name?: string;
  primary_barcode?: string;
  barcodes?: ProductBarcode[];
  price_tiers?: Record<string, Money>;
  stock_level?: 'ok' | 'warning' | 'critical' | string;
}

export interface BarcodeLookup extends ProductView {
  scanned_barcode: string;
  pack_qty: Money;
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export interface Member {
  id: string;
  member_code: string;
  name: string;
  phone?: string;
  share_capital: Money;
  price_tier: number;
  is_walkin: boolean;
  status: string;
  /** Present on list/detail responses, absent on the quick search. */
  ar_balance?: Money;
  ytd_purchases?: Money;
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

export interface SaleLineInput {
  product_id: string;
  qty: number;
  unit_price?: number;
  discount: number;
  is_free: boolean;
  serial_no?: string;
}

export interface TenderInput {
  method: PaymentMethod;
  amount: number;
  reference?: string;
}

export interface CreateSaleInput {
  member_id?: string;
  lines: SaleLineInput[];
  payments: TenderInput[];
  bill_discount: number;
  bill_discount_pct: number;
  note?: string;
  terminal?: string;
  held_bill_id?: string;
}

export interface QuoteLine {
  product_id: string;
  description: string;
  qty: Money;
  unit_price: Money;
  discount: Money;
  promo_discount: Money;
  line_total: Money;
  is_free: boolean;
}

export interface QuoteResponse {
  gross: Money;
  line_discount: Money;
  bill_discount: Money;
  net: Money;
  lines: QuoteLine[];
}

export type SaleStatus = 'completed' | 'cancelled' | 'refunded' | 'partial_refund' | string;
export type ARStatus = 'none' | 'unpaid' | 'partial' | 'paid' | string;

export interface SaleLine {
  id: string;
  sale_id: string;
  line_no: number;
  product_id?: string | null;
  sku?: string;
  description: string;
  qty: Money;
  unit_price: Money;
  discount: Money;
  line_total: Money;
  is_free: boolean;
  serial_no?: string;
  unit_name?: string;
  returned_qty?: Money;
}

export interface SalePayment {
  id: string;
  sale_id: string;
  method: PaymentMethod;
  amount: Money;
  reference?: string;
}

export interface Sale {
  id: string;
  store_id: string;
  doc_no: string;
  sold_at: string;
  cashier_id?: string | null;
  cashier_name?: string;
  member_id?: string | null;
  member_code?: string;
  member_name?: string;
  shift_id?: string | null;
  gross: Money;
  discount: Money;
  bill_discount: Money;
  vat: Money;
  net: Money;
  tendered: Money;
  change_amount: Money;
  status: SaleStatus;
  cancelled_by_name?: string;
  cancelled_at?: string | null;
  cancel_reason?: string;
  ar_status: ARStatus;
  ar_total: Money;
  ar_paid: Money;
  ar_balance: Money;
  note?: string;
  created_at?: string;
  lines?: SaleLine[];
  payments?: SalePayment[];
}

export interface SaleReturn {
  id: string;
  doc_no: string;
  sale_id: string;
  returned_at: string;
  refund_method: PaymentMethod;
  refund_amount: Money;
  reason?: string;
}

export interface SalesSummary {
  bills: number;
  gross: Money;
  discount: Money;
  net: Money;
  cancelled: number;
  by_method?: Record<string, Money>;
}

// ---------------------------------------------------------------------------
// Store / receipt
// ---------------------------------------------------------------------------

export interface StoreInfo {
  id: string;
  code: string;
  name: string;
  name_en?: string;
  address?: string;
  phone?: string;
  tax_id?: string;
  receipt_header?: string;
  receipt_footer?: string;
  has_logo?: boolean;
  default_locale?: string;
}

/** Free-form settings map; only the keys the POS cares about are typed. */
export interface StoreSettings {
  paper_width?: number | string;
  require_shift?: boolean;
  allow_price_edit?: boolean;
  allow_negative_stock?: boolean;
  show_tax?: boolean;
  vat_type?: string;
  default_terminal?: string;
  [key: string]: unknown;
}

export interface ReceiptData {
  store: StoreInfo | null;
  settings: StoreSettings | null;
  sale: Sale;
  returns?: SaleReturn[] | null;
}

// ---------------------------------------------------------------------------
// Held bills, shifts, drawer
// ---------------------------------------------------------------------------

export interface HeldBill<TCart = unknown> {
  id: string;
  cashier_id: string;
  label?: string;
  member_id?: string | null;
  cart: TCart;
  created_at: string;
  expires_at: string;
}

export interface Shift {
  id: string;
  store_id: string;
  cashier_id: string;
  cashier_name?: string;
  terminal: string;
  opened_at: string;
  closed_at?: string | null;
  closed_by?: string | null;
  opening_float: Money;
  cash_sales: Money;
  cash_in: Money;
  cash_out: Money;
  expected_cash?: Money | null;
  counted_cash?: Money | null;
  variance?: Money | null;
  status: 'open' | 'closed' | string;
  note?: string;
}

export interface ShiftReport {
  shift: Shift;
  summary: SalesSummary | null;
}

export type DrawerReason = 'no_sale' | 'paid_in' | 'paid_out';

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/** Compact open-shift summary embedded in the dashboard payload (`reportuc.OpenShift`). */
export interface DashboardOpenShift {
  id?: string;
  opened_at?: string;
  cashier?: string;
  terminal?: string;
}

export interface DashboardResponse {
  date?: string;
  today?: {
    bills?: number;
    net?: Money;
    cash?: Money;
    credit?: Money;
    avg_bill?: Money;
    cancelled?: number;
  };
  month_to_date_net?: Money;
  month_to_date_bills?: number;
  low_stock_count?: number;
  ar_outstanding_total?: Money;
  open_shift?: DashboardOpenShift | null;
  top_products?: Array<{ product_id?: string | null; sku?: string; name?: string; category?: string; unit?: string; qty?: Money; net?: Money }> | null;
  hourly?: Array<{ hour?: number; bills?: number; net?: Money }> | null;
}

/** Computes expected cash for a shift the same way the backend does on close. */
export function shiftExpectedCash(shift: Shift): number {
  if (shift.expected_cash !== null && shift.expected_cash !== undefined) return dec(shift.expected_cash);
  return money(dec(shift.opening_float) + dec(shift.cash_sales) + dec(shift.cash_in) - dec(shift.cash_out));
}
