'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs, type Page } from '@/lib/api/client';
import type { Dec, ListParams, PaymentMethod } from './common';

// ---------------------------------------------------------------------------
// Types (mirror handlers_ar.go / aruc)
// ---------------------------------------------------------------------------

export interface ARAccount {
  member_id: string;
  member_code: string;
  member_name: string;
  phone?: string;
  open_bills: number;
  balance: Dec;
  oldest_due?: string | null;
  last_paid_at?: string | null;
}

export interface ARPayment {
  id: string;
  doc_no?: string;
  member_id?: string | null;
  member_code?: string;
  member_name?: string;
  sale_id?: string | null;
  sale_doc_no?: string;
  legacy_bill_no?: string;
  bill_total: Dec;
  balance_before: Dec;
  amount: Dec;
  balance_after: Dec;
  method: PaymentMethod | string;
  paid_at: string;
  received_by?: string | null;
  received_by_name?: string;
  note?: string;
}

/** Subset of domain.Sale used by the AR bills view. */
export interface ARBill {
  id: string;
  doc_no: string;
  sold_at: string;
  member_id?: string | null;
  member_code?: string;
  member_name?: string;
  net: Dec;
  status: string;
  ar_status: 'none' | 'unpaid' | 'partial' | 'paid' | string;
  ar_total: Dec;
  ar_paid: Dec;
  ar_balance: Dec;
  note?: string;
}

export interface MemberBills {
  bills: ARBill[] | null;
  balance: Dec;
  payments: ARPayment[] | null;
}

export interface AgingBucket {
  bucket: '0-30' | '31-60' | '61-90' | '90+' | string;
  bills: number;
  balance: Dec;
}

export interface Aging {
  as_of: string;
  buckets: AgingBucket[] | null;
  total: Dec;
}

export interface PaymentInput {
  member_id: string;
  sale_id?: string | null;
  amount: string;
  method: PaymentMethod;
  note?: string;
  paid_at?: string | null;
}

export interface ARAccountsParams extends ListParams {
  q?: string;
}

export interface ARPaymentsParams extends ListParams {
  member_id?: string;
  sale_id?: string;
  from?: string;
  to?: string;
}

// ---------------------------------------------------------------------------
// Keys & queries
// ---------------------------------------------------------------------------

export const arKeys = {
  all: ['ar'] as const,
  accounts: (p: ARAccountsParams) => ['ar', 'accounts', p] as const,
  memberBills: (id: string) => ['ar', 'member-bills', id] as const,
  payments: (p: ARPaymentsParams) => ['ar', 'payments', p] as const,
  aging: (asOf: string) => ['ar', 'aging', asOf] as const,
};

export function useARAccounts(params: ARAccountsParams) {
  return useQuery({
    queryKey: arKeys.accounts(params),
    queryFn: () =>
      api.get<Page<ARAccount>>(`/ar/accounts${qs({ q: params.q, page: params.page ?? 1, page_size: params.page_size ?? 50 })}`),
    placeholderData: keepPreviousData,
  });
}

export function useMemberBills(memberId: string | null | undefined) {
  return useQuery({
    queryKey: arKeys.memberBills(memberId ?? ''),
    queryFn: () => api.get<MemberBills>(`/ar/members/${memberId}/bills`),
    enabled: Boolean(memberId),
  });
}

export function useARPayments(params: ARPaymentsParams) {
  return useQuery({
    queryKey: arKeys.payments(params),
    queryFn: () =>
      api.get<Page<ARPayment>>(`/ar/payments${qs({ ...params, page: params.page ?? 1, page_size: params.page_size ?? 50 })}`),
    placeholderData: keepPreviousData,
  });
}

export function useAging(asOf = '') {
  return useQuery({
    queryKey: arKeys.aging(asOf),
    queryFn: () => api.get<Aging>(`/ar/aging${qs({ as_of: asOf })}`),
  });
}

export function useReceivePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PaymentInput) => api.post<ARPayment[]>('/ar/payments', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: arKeys.all });
      void qc.invalidateQueries({ queryKey: ['members'] });
    },
  });
}
