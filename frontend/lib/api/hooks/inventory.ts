'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs, type Page } from '@/lib/api/client';
import type { Dec, ListParams } from './common';

// ---------------------------------------------------------------------------
// Types (mirror backend/internal/domain/inventory.go + repository StockMove)
// ---------------------------------------------------------------------------

export type MoveType =
  | 'opening'
  | 'sale'
  | 'sale_cancel'
  | 'return'
  | 'receipt'
  | 'receipt_cancel'
  | 'adjustment'
  | 'stocktake'
  | 'transfer_in'
  | 'transfer_out';

export const MOVE_TYPES: readonly MoveType[] = [
  'opening',
  'sale',
  'sale_cancel',
  'return',
  'receipt',
  'receipt_cancel',
  'adjustment',
  'stocktake',
  'transfer_in',
  'transfer_out',
];

export interface StockMove {
  id: number;
  product_id: string;
  sku: string;
  product_name: string;
  move_type: MoveType | string;
  qty_delta: Dec;
  unit_cost?: Dec | null;
  balance_after: Dec;
  ref_type?: string;
  ref_id?: string | null;
  note?: string;
  created_by?: string | null;
  occurred_at: string;
}

export interface Valuation {
  units: Dec;
  cost_value: Dec;
  retail_value: Dec;
}

export interface ReceiptLine {
  id: string;
  receipt_id: string;
  line_no: number;
  product_id?: string | null;
  sku?: string;
  description?: string;
  qty: Dec;
  unit_cost: Dec;
  total: Dec;
}

export type ReceiptStatus = 'draft' | 'posted' | 'cancelled';

export interface PurchaseReceipt {
  id: string;
  doc_no: string;
  supplier_id?: string | null;
  supplier_name?: string;
  supplier_ref?: string;
  received_at: string;
  received_by?: string | null;
  received_by_name?: string;
  subtotal: Dec;
  vat: Dec;
  total: Dec;
  status: ReceiptStatus | string;
  note?: string;
  created_at?: string;
  updated_at?: string;
  lines?: ReceiptLine[] | null;
}

export interface ReceiptInput {
  supplier_id?: string | null;
  supplier_ref?: string;
  received_at?: string | null;
  vat?: string;
  note?: string;
  lines: { product_id: string; qty: string; unit_cost: string }[];
}

export interface AdjustmentLine {
  id: string;
  product_id: string;
  sku?: string;
  product_name?: string;
  qty_delta: Dec;
  unit_cost?: Dec | null;
  note?: string;
}

export interface StockAdjustment {
  id: string;
  doc_no: string;
  reason: string;
  note?: string;
  adjusted_at: string;
  created_by?: string | null;
  lines?: AdjustmentLine[] | null;
}

export interface AdjustmentInput {
  reason: string;
  note?: string;
  lines: { product_id: string; qty_delta: string; note?: string }[];
}

export const ADJUSTMENT_REASONS = ['damaged', 'expired', 'lost', 'found', 'correction', 'sample', 'other'] as const;

export type StockTakeStatus = 'open' | 'finalized' | 'cancelled';

export interface StockTakeLine {
  id: string;
  product_id: string;
  sku?: string;
  product_name?: string;
  cost_avg: Dec;
  system_qty: Dec;
  counted_qty: Dec | null;
  variance: Dec;
  note?: string;
}

export interface StockTake {
  id: string;
  doc_no: string;
  status: StockTakeStatus | string;
  note?: string;
  started_at: string;
  finalized_at?: string | null;
  created_by?: string | null;
  line_count: number;
  lines?: StockTakeLine[] | null;
}

export interface VarianceSummary {
  lines: number;
  counted: number;
  differing: number;
  qty_over: Dec;
  qty_short: Dec;
  value_diff: Dec;
}

export interface StockTakeView extends StockTake {
  summary: VarianceSummary;
}

export interface MovementParams extends ListParams {
  product_id?: string;
  type?: string;
  from?: string;
  to?: string;
}

export interface ReceiptParams extends ListParams {
  from?: string;
  to?: string;
  supplier_id?: string;
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

export const inventoryKeys = {
  movements: (p: MovementParams) => ['inventory', 'movements', p] as const,
  valuation: ['inventory', 'valuation'] as const,
  receipts: (p: ReceiptParams) => ['inventory', 'receipts', p] as const,
  receipt: (id: string) => ['inventory', 'receipt', id] as const,
  adjustments: (p: ListParams) => ['inventory', 'adjustments', p] as const,
  adjustment: (id: string) => ['inventory', 'adjustment', id] as const,
  stockTakes: (p: ListParams) => ['inventory', 'stock-takes', p] as const,
  stockTake: (id: string) => ['inventory', 'stock-take', id] as const,
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useMovements(params: MovementParams) {
  return useQuery({
    queryKey: inventoryKeys.movements(params),
    queryFn: () =>
      api.get<Page<StockMove>>(
        `/inventory/movements${qs({ ...params, page: params.page ?? 1, page_size: params.page_size ?? 50 })}`,
      ),
    placeholderData: keepPreviousData,
  });
}

export function useValuation() {
  return useQuery({
    queryKey: inventoryKeys.valuation,
    queryFn: () => api.get<Valuation>('/inventory/valuation'),
  });
}

export function useReceipts(params: ReceiptParams) {
  return useQuery({
    queryKey: inventoryKeys.receipts(params),
    queryFn: () =>
      api.get<Page<PurchaseReceipt>>(
        `/inventory/receipts${qs({ ...params, page: params.page ?? 1, page_size: params.page_size ?? 50 })}`,
      ),
    placeholderData: keepPreviousData,
  });
}

export function useReceipt(id: string | null | undefined) {
  return useQuery({
    queryKey: inventoryKeys.receipt(id ?? ''),
    queryFn: () => api.get<PurchaseReceipt>(`/inventory/receipts/${id}`),
    enabled: Boolean(id),
  });
}

export function useAdjustments(params: ListParams) {
  return useQuery({
    queryKey: inventoryKeys.adjustments(params),
    queryFn: () =>
      api.get<Page<StockAdjustment>>(
        `/inventory/adjustments${qs({ page: params.page ?? 1, page_size: params.page_size ?? 50 })}`,
      ),
    placeholderData: keepPreviousData,
  });
}

export function useAdjustment(id: string | null | undefined) {
  return useQuery({
    queryKey: inventoryKeys.adjustment(id ?? ''),
    queryFn: () => api.get<StockAdjustment>(`/inventory/adjustments/${id}`),
    enabled: Boolean(id),
  });
}

export function useStockTakes(params: ListParams) {
  return useQuery({
    queryKey: inventoryKeys.stockTakes(params),
    queryFn: () =>
      api.get<Page<StockTake>>(`/inventory/stock-takes${qs({ page: params.page ?? 1, page_size: params.page_size ?? 50 })}`),
    placeholderData: keepPreviousData,
  });
}

export function useStockTake(id: string | null | undefined) {
  return useQuery({
    queryKey: inventoryKeys.stockTake(id ?? ''),
    queryFn: () => api.get<StockTakeView>(`/inventory/stock-takes/${id}`),
    enabled: Boolean(id),
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

function useInvalidateInventory() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['inventory'] });
    void qc.invalidateQueries({ queryKey: ['products'] });
  };
}

export function usePostReceipt() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: (input: ReceiptInput) => api.post<PurchaseReceipt>('/inventory/receipts', input),
    onSuccess: invalidate,
  });
}

export function useCancelReceipt() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post<PurchaseReceipt>(`/inventory/receipts/${id}/cancel`, { reason }),
    onSuccess: invalidate,
  });
}

export function usePostAdjustment() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: (input: AdjustmentInput) => api.post<StockAdjustment>('/inventory/adjustments', input),
    onSuccess: invalidate,
  });
}

export function useCreateStockTake() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    // `empty: true` opens a sheet with no lines — the phone stock-check page fills it in by scanning
    mutationFn: (input: { note?: string; product_ids?: string[]; empty?: boolean }) =>
      api.post<StockTakeView>('/inventory/stock-takes', input),
    onSuccess: invalidate,
  });
}

export function useSaveCounts(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lines: { product_id: string; counted_qty: string; note?: string }[]) =>
      api.put<StockTakeView>(`/inventory/stock-takes/${id}/lines`, lines),
    onSuccess: (data) => qc.setQueryData(inventoryKeys.stockTake(id), data),
  });
}

export function useFinalizeStockTake(id: string) {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: () => api.post<StockTakeView>(`/inventory/stock-takes/${id}/finalize`),
    onSuccess: invalidate,
  });
}
