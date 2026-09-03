'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs, unwrapList, type Page } from '@/lib/api/client';
import type { Dec, ListParams } from './common';

// ---------------------------------------------------------------------------
// Types (mirror backend/internal/domain/product.go)
// ---------------------------------------------------------------------------

export interface Category {
  id: string;
  name: string;
  name_en?: string;
  sort_order: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface Unit {
  id: string;
  name: string;
  name_en?: string;
  is_active: boolean;
  /** How many products still use this unit (shown before it is switched off). */
  product_count: number;
  created_at?: string;
}

export interface Supplier {
  id: string;
  code?: string;
  name: string;
  address?: string;
  phone?: string;
  fax?: string;
  email?: string;
  tax_id?: string;
  note?: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ProductBarcode {
  id: string;
  product_id: string;
  barcode: string;
  is_primary: boolean;
  pack_qty: Dec;
  created_at?: string;
}

export type StockLevel = 'ok' | 'warning' | 'critical';

export interface Product {
  id: string;
  sku: string;
  name: string;
  name_en?: string;
  category_id?: string | null;
  unit_id?: string | null;
  cost_last: Dec;
  cost_avg: Dec;
  sell_price: Dec;
  stock_on_hand: Dec;
  min_level1: Dec;
  min_level2: Dec;
  is_serial: boolean;
  is_active: boolean;
  is_archived: boolean;
  archived_reason?: string;
  archived_at?: string | null;
  image_url?: string;
  note?: string;
  created_at?: string;
  updated_at?: string;
  category_name?: string;
  unit_name?: string;
  primary_barcode?: string;
  barcodes: ProductBarcode[] | null;
  price_tiers: Record<string, Dec> | null;
  stock_level: StockLevel | string;
}

export interface ProductInput {
  sku?: string;
  name?: string;
  name_en?: string;
  category_id?: string | null;
  unit_id?: string | null;
  cost_last?: string;
  cost_avg?: string;
  sell_price?: string;
  min_level1?: string;
  min_level2?: string;
  is_serial?: boolean;
  is_active?: boolean;
  image_url?: string;
  note?: string;
  barcodes?: string[];
  price_tiers?: Record<string, string>;
  opening_stock?: string;
}

export interface LabelTemplate {
  id: string;
  code: string;
  name: string;
  paper: string;
  columns: number;
  rows: number;
  dims: Record<string, unknown> | null;
  fonts: Record<string, unknown> | null;
  visible: Record<string, unknown> | null;
  created_at?: string;
}

export interface Label {
  sku: string;
  barcode: string;
  name: string;
  price: Dec;
}

export interface LabelSheet {
  template_code: string;
  template: LabelTemplate | null;
  labels: Label[];
}

export interface ProductListParams extends ListParams {
  q?: string;
  category_id?: string;
  active?: 'true' | 'false' | 'all' | '';
  archived?: 'true' | 'false' | 'all' | '';
  low_stock?: boolean;
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const productKeys = {
  all: ['products'] as const,
  list: (params: ProductListParams) => ['products', 'list', params] as const,
  detail: (id: string) => ['products', 'detail', id] as const,
  search: (q: string) => ['products', 'search', q] as const,
  categories: ['categories'] as const,
  units: ['units'] as const,
  suppliers: (q = '') => ['suppliers', q] as const,
  labelTemplates: ['label-templates'] as const,
  labels: (ids: string[], template: string, copies: number) => ['labels', ids, template, copies] as const,
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useCategories() {
  return useQuery({
    queryKey: productKeys.categories,
    queryFn: async () => unwrapList(await api.get<Category[] | Page<Category>>('/categories')),
    staleTime: 5 * 60_000,
  });
}

export function useUnits() {
  return useQuery({
    queryKey: productKeys.units,
    queryFn: async () => unwrapList(await api.get<Unit[] | Page<Unit>>('/units')),
    staleTime: 5 * 60_000,
  });
}

export function useSuppliers(q = '') {
  return useQuery({
    queryKey: productKeys.suppliers(q),
    queryFn: async () => unwrapList(await api.get<Supplier[] | Page<Supplier>>(`/suppliers${qs({ q })}`)),
    staleTime: 60_000,
  });
}

export function useProducts(params: ProductListParams) {
  return useQuery({
    queryKey: productKeys.list(params),
    queryFn: () =>
      api.get<Page<Product>>(
        `/products${qs({
          q: params.q,
          category_id: params.category_id,
          active: params.active,
          archived: params.archived,
          low_stock: params.low_stock ? 'true' : '',
          page: params.page ?? 1,
          page_size: params.page_size ?? 50,
        })}`,
      ),
    placeholderData: keepPreviousData,
  });
}

export function useProduct(id: string | null | undefined) {
  return useQuery({
    queryKey: productKeys.detail(id ?? ''),
    queryFn: () => api.get<Product>(`/products/${id}`),
    enabled: Boolean(id),
  });
}

/** Lightweight search used by autocompletes. */
export function searchProducts(q: string, signal?: AbortSignal): Promise<Product[]> {
  return api
    .get<Page<Product>>(`/products${qs({ q, page_size: 20, active: 'true' })}`, { signal })
    .then((p) => p.items ?? []);
}

export function useLabelTemplates() {
  return useQuery({
    queryKey: productKeys.labelTemplates,
    queryFn: async () => unwrapList(await api.get<LabelTemplate[] | Page<LabelTemplate>>('/label-templates')),
    staleTime: 5 * 60_000,
  });
}

export function useLabelSheet(ids: string[], template: string, copies: number) {
  return useQuery({
    queryKey: productKeys.labels(ids, template, copies),
    queryFn: () => api.get<LabelSheet>(`/products/labels${qs({ ids: ids.join(','), template, copies })}`),
    enabled: ids.length > 0,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useInvalidateProducts() {
  const qc = useQueryClient();
  return (id?: string) => {
    void qc.invalidateQueries({ queryKey: productKeys.all });
    if (id) void qc.invalidateQueries({ queryKey: productKeys.detail(id) });
  };
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; name_en?: string; sort_order?: number; is_active?: boolean }) =>
      api.post<Category>('/categories', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: productKeys.categories }),
  });
}

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string; name?: string; name_en?: string; sort_order?: number; is_active?: boolean }) =>
      api.patch<Category>(`/categories/${id}`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: productKeys.categories }),
  });
}

export function useCreateUnit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; name_en?: string }) => api.post<Unit>('/units', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: productKeys.units }),
  });
}

/** Renames a unit or switches it off — units are never deleted, so old documents keep their unit. */
export function useUpdateUnit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string; name?: string; name_en?: string; is_active?: boolean }) =>
      api.patch<Unit>(`/units/${id}`, patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: productKeys.units }),
  });
}

export interface SupplierInput {
  code?: string;
  name?: string;
  address?: string;
  phone?: string;
  fax?: string;
  email?: string;
  tax_id?: string;
  note?: string;
  is_active?: boolean;
}

export function useCreateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SupplierInput) => api.post<Supplier>('/suppliers', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['suppliers'] }),
  });
}

export function useUpdateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: SupplierInput & { id: string }) => api.patch<Supplier>(`/suppliers/${id}`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['suppliers'] }),
  });
}

export function useCreateProduct() {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (input: ProductInput) => api.post<Product>('/products', input),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateProduct(id: string) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (input: ProductInput) => api.patch<Product>(`/products/${id}`, input),
    onSuccess: () => invalidate(id),
  });
}

export function useArchiveProduct() {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/products/${id}`, undefined, { responseType: 'void' }),
    onSuccess: (_d, id) => invalidate(id),
  });
}

export function useRestoreProduct() {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (id: string) => api.post<Product>(`/products/${id}/restore`),
    onSuccess: (_d, id) => invalidate(id),
  });
}

export function useAddBarcode(productId: string) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (input: { barcode: string; is_primary: boolean; pack_qty?: string }) =>
      api.post<Product>(`/products/${productId}/barcodes`, input),
    onSuccess: () => invalidate(productId),
  });
}

export function useDeleteBarcode(productId: string) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (barcodeId: string) =>
      api.delete<void>(`/products/${productId}/barcodes/${barcodeId}`, undefined, { responseType: 'void' }),
    onSuccess: () => invalidate(productId),
  });
}

export function useSetPrices(productId: string) {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (input: { sell_price?: string; price_tiers: Record<string, string> }) =>
      api.put<Product>(`/products/${productId}/prices`, input),
    onSuccess: () => invalidate(productId),
  });
}
