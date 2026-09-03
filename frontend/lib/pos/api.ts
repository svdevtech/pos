import { api, qs, unwrapList, type Page } from '@/lib/api/client';
import type {
  BarcodeLookup,
  CreateSaleInput,
  DashboardResponse,
  DrawerReason,
  HeldBill,
  Member,
  ProductView,
  QuoteResponse,
  ReceiptData,
  Sale,
  SalesSummary,
  Shift,
  ShiftReport,
  StoreInfo,
  StoreSettings,
} from './types';

export const posKeys = {
  shift: ['pos', 'shift', 'current'] as const,
  shifts: (page: number) => ['pos', 'shifts', page] as const,
  shiftDetail: (id: string) => ['pos', 'shifts', 'detail', id] as const,
  settings: ['pos', 'settings'] as const,
  store: ['pos', 'store'] as const,
  held: ['pos', 'held-bills'] as const,
  sales: (params: Record<string, string | number | undefined>) => ['pos', 'sales', params] as const,
  sale: (id: string) => ['pos', 'sale', id] as const,
  receipt: (id: string) => ['pos', 'receipt', id] as const,
  summary: (from: string, to: string) => ['pos', 'summary', from, to] as const,
  dashboard: ['dashboard'] as const,
};

export const posApi = {
  byBarcode: (code: string) => api.get<BarcodeLookup>(`/products/by-barcode/${encodeURIComponent(code)}`),
  searchProducts: (q: string, pageSize = 30) =>
    api.get<Page<ProductView> | ProductView[]>(`/products${qs({ q, page_size: pageSize, active: 'true' })}`).then(unwrapList),
  searchMembers: (q: string, limit = 10) => api.get<Member[] | Page<Member>>(`/members/search${qs({ q, limit })}`).then(unwrapList),
  member: (id: string) => api.get<Member>(`/members/${id}`),

  quote: (input: CreateSaleInput, signal?: AbortSignal) => api.post<QuoteResponse>('/sales/quote', input, { signal }),
  createSale: (input: CreateSaleInput) => api.post<Sale>('/sales', input),
  sale: (id: string) => api.get<Sale>(`/sales/${id}`),
  receipt: (id: string) => api.get<ReceiptData>(`/sales/${id}/receipt`),
  cancelSale: (id: string, reason: string) => api.post<Sale>(`/sales/${id}/cancel`, { reason }),
  listSales: (params: { from?: string; to?: string; page?: number; page_size?: number; status?: string; doc_no?: string; all?: string }) =>
    api.get<Page<Sale>>(`/sales${qs(params)}`),
  summary: (from: string, to: string) => api.get<SalesSummary>(`/sales/summary${qs({ from, to })}`),

  heldBills: () => api.get<HeldBill[] | Page<HeldBill>>('/held-bills').then(unwrapList),
  holdBill: (body: { label: string; member_id?: string | null; cart: unknown }) => api.post<HeldBill>('/held-bills', body),
  deleteHeld: (id: string) => api.delete<void>(`/held-bills/${id}`, undefined, { responseType: 'void' }),

  currentShift: () => api.get<{ shift: Shift | null }>('/shifts/current').then((r) => r?.shift ?? null),
  openShift: (body: { terminal: string; opening_float: number; note?: string }) => api.post<Shift>('/shifts/open', body),
  closeShift: (id: string, body: { counted_cash: number; note?: string }) => api.post<ShiftReport>(`/shifts/${id}/close`, body),
  listShifts: (page: number, pageSize = 20) => api.get<Page<Shift>>(`/shifts${qs({ page, page_size: pageSize })}`),
  shiftReport: (id: string) => api.get<ShiftReport>(`/shifts/${id}`),
  drawer: (body: { reason: DrawerReason; amount?: number; note?: string }) =>
    api.post<void>('/drawer', { reason: body.reason, amount: body.amount ?? 0, note: body.note ?? '' }, { responseType: 'void' }),

  store: () => api.get<StoreInfo>('/store'),
  settings: () => api.get<StoreSettings>('/store/settings').then((s) => s ?? {}),
  dashboard: () => api.get<DashboardResponse>('/reports/dashboard'),
};
