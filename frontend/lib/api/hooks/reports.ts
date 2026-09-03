'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, qs } from '@/lib/api/client';
import { downloadFile } from '@/lib/api/download';
import type { Dec } from './common';

// ---------------------------------------------------------------------------
// Types (mirror backend/internal/usecase/reportuc + repository/postgres/reports.go)
// ---------------------------------------------------------------------------

export interface ReportRange {
  from: string;
  to: string;
  group?: 'day' | 'month' | string;
}

export interface PeriodSalesRow {
  date: string;
  bills: number;
  gross: Dec;
  discount: Dec;
  net: Dec;
  cancelled: number;
  cash: Dec;
  credit: Dec;
  transfer: Dec;
  card: Dec;
  qr: Dec;
  other: Dec;
  cost: Dec;
  margin: Dec;
  margin_pct: Dec;
}

export interface DailySales extends ReportRange {
  rows: PeriodSalesRow[] | null;
  total: PeriodSalesRow;
}

export interface ProductSalesRow {
  product_id?: string | null;
  sku: string;
  name: string;
  category: string;
  unit: string;
  qty: Dec;
  gross: Dec;
  discount: Dec;
  net: Dec;
  cost: Dec;
  margin: Dec;
}

export interface ProductSales extends ReportRange {
  sort: string;
  limit: number;
  rows: ProductSalesRow[] | null;
  total: ProductSalesRow;
}

export interface CategorySalesRow {
  category_id?: string | null;
  category: string;
  bills: number;
  qty: Dec;
  gross: Dec;
  discount: Dec;
  net: Dec;
  cost: Dec;
  margin: Dec;
  margin_pct: Dec;
}

export interface CategorySales extends ReportRange {
  rows: CategorySalesRow[] | null;
  total: CategorySalesRow;
}

export interface CashierSalesRow {
  cashier_id?: string | null;
  cashier: string;
  bills: number;
  net: Dec;
  cancelled: number;
  avg_bill: Dec;
}

export interface CashierSales extends ReportRange {
  rows: CashierSalesRow[] | null;
  total: CashierSalesRow;
}

export interface HourSalesRow {
  hour: number;
  bills: number;
  net: Dec;
}

export interface HourlySales extends ReportRange {
  rows: HourSalesRow[] | null;
}

export interface ProductBrief {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  stock: Dec;
  cost_avg: Dec;
}

export interface MovementRow {
  id: number;
  at: string;
  type: string;
  qty_delta: Dec;
  unit_cost?: Dec | null;
  balance_after: Dec;
  balance: Dec;
  ref_type?: string;
  ref_id?: string | null;
  doc_no?: string;
  note?: string;
  by?: string;
}

export interface ProductMovement extends ReportRange {
  product: ProductBrief;
  opening_balance: Dec;
  in: Dec;
  out: Dec;
  closing_balance: Dec;
  rows: MovementRow[] | null;
}

export interface InventoryTotals {
  products: number;
  units: Dec;
  cost_value: Dec;
  retail_value: Dec;
}

export interface InventoryRow {
  product_id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  stock: Dec;
  min_level1: Dec;
  min_level2: Dec;
  cost_avg: Dec;
  sell_price: Dec;
  stock_value: Dec;
  last_sold_at?: string | null;
  last_received_at?: string | null;
}

export interface InventoryStatus {
  as_of: string;
  rows: InventoryRow[] | null;
  total: InventoryTotals;
}

export interface DeadStockRow {
  product_id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  stock: Dec;
  cost_avg: Dec;
  stock_value: Dec;
  last_sold_at?: string | null;
}

export interface DeadStock {
  as_of: string;
  days: number;
  since: string;
  rows: DeadStockRow[] | null;
  total: InventoryTotals;
}

export interface ARAgingRow {
  member_id: string;
  member_code: string;
  name: string;
  phone: string;
  bills: number;
  balance: Dec;
  b0_30: Dec;
  b31_60: Dec;
  b61_90: Dec;
  b90_plus: Dec;
  oldest_due?: string | null;
}

export interface ARAgingReport {
  as_of: string;
  rows: ARAgingRow[] | null;
  total: ARAgingRow;
}

export interface MemberBrief {
  id: string;
  member_code: string;
  name: string;
  phone: string;
}

export interface ARStatementRow {
  kind: 'sale' | 'payment' | string;
  id: string;
  doc_no: string;
  at: string;
  sale_doc_no?: string;
  net: Dec;
  debit: Dec;
  credit: Dec;
  method?: string;
  note?: string;
  balance: Dec;
}

export interface ARStatement extends ReportRange {
  member: MemberBrief;
  opening_balance: Dec;
  charges: Dec;
  payments: Dec;
  closing_balance: Dec;
  rows: ARStatementRow[] | null;
}

export interface SupplierPurchaseRow {
  supplier_id?: string | null;
  supplier: string;
  receipts: number;
  total: Dec;
}

export interface SupplierPurchases extends ReportRange {
  rows: SupplierPurchaseRow[] | null;
  total: SupplierPurchaseRow;
}

export interface PurchaseRow {
  id: string;
  doc_no: string;
  supplier_id?: string | null;
  supplier: string;
  supplier_ref?: string;
  received_at: string;
  received_by?: string;
  status: string;
  lines: number;
  qty: Dec;
  subtotal: Dec;
  vat: Dec;
  total: Dec;
}

export interface Purchases extends ReportRange {
  supplier_id?: string | null;
  rows: PurchaseRow[] | null;
  total: PurchaseRow;
}

export interface ExpensePeriodRow {
  period?: string;
  type_id?: string | null;
  type: string;
  count: number;
  amount: Dec;
}

export interface ExpensesSummary extends ReportRange {
  rows: ExpensePeriodRow[] | null;
  by_type: ExpensePeriodRow[] | null;
  count: number;
  total: Dec;
}

export interface ProfitLoss extends ReportRange {
  bills: number;
  gross_sales: Dec;
  discounts: Dec;
  net_sales: Dec;
  returns_count: number;
  returns_refunded: Dec;
  net_revenue: Dec;
  cost_of_goods: Dec;
  gross_profit: Dec;
  expenses: ExpensePeriodRow[] | null;
  expenses_total: Dec;
  net_profit: Dec;
  margin_pct: Dec;
}

export interface MonthChartRow {
  month_index: number;
  month_name_th: string;
  month_name_en: string;
  bills: number;
  net: Dec;
}

export interface MonthlyChart {
  year: number;
  year_be: number;
  source: string;
  rows: MonthChartRow[] | null;
  bills: number;
  net: Dec;
}

export type ReportParams = Record<string, string | number | boolean | null | undefined>;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const reportKeys = {
  report: (name: string, params: ReportParams) => ['reports', name, params] as const,
};

/** Generic `GET /reports/<name>?…` query. */
export function useReport<T>(name: string, params: ReportParams, enabled = true) {
  return useQuery({
    queryKey: reportKeys.report(name, params),
    queryFn: () => api.get<T>(`/reports/${name}${qs(params)}`),
    enabled,
    placeholderData: keepPreviousData,
  });
}

/** Downloads the CSV rendering of a report (`?format=csv`) through the authenticated client. */
export function downloadReportCsv(name: string, params: ReportParams): Promise<void> {
  const from = (params.from as string) || '';
  const to = (params.to as string) || '';
  const suffix = from || to ? `-${from || 'start'}-${to || 'end'}` : '';
  return downloadFile(`/reports/${name}${qs({ ...params, format: 'csv' })}`, `${name}${suffix}.csv`);
}
