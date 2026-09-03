'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs, unwrapList, type Page } from '@/lib/api/client';
import type { Dec, ListParams } from './common';

// ---------------------------------------------------------------------------
// Types (mirror backend/internal/domain/member.go + memberuc views)
// ---------------------------------------------------------------------------

export type MemberStatus = 'active' | 'inactive' | 'suspended';
export const MEMBER_STATUSES: readonly MemberStatus[] = ['active', 'inactive', 'suspended'];

export type ShareTxType = 'opening' | 'deposit' | 'withdraw' | 'adjust' | 'dividend_reinvest';

export interface Member {
  id: string;
  store_id?: string;
  member_code: string;
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  national_id?: string;
  line_user_id?: string;
  line_display?: string;
  share_capital: Dec;
  joined_at?: string | null;
  price_tier: number;
  is_walkin: boolean;
  status: MemberStatus | string;
  note?: string;
  created_at?: string;
  updated_at?: string;
}

export interface MemberView extends Member {
  ar_balance: Dec;
  ytd_purchases: Dec;
}

export interface MemberDetail extends Member {
  ar_balance: Dec;
  ar_bills: number;
  ytd_purchases: Dec;
  ytd_bills: number;
  share_balance: Dec;
  share_transactions: ShareTx[] | null;
}

export interface ShareTx {
  id: string;
  member_id: string;
  type: ShareTxType | string;
  amount: Dec;
  balance_after: Dec;
  note?: string;
  ref_type?: string;
  ref_id?: string | null;
  created_by?: string | null;
  occurred_at: string;
  created_at?: string;
}

export interface MemberInput {
  member_code?: string;
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  national_id?: string;
  joined_at?: string | null;
  price_tier?: number;
  note?: string;
  opening_share?: string;
}

export interface MemberPatch {
  member_code?: string;
  name?: string;
  address?: string;
  phone?: string;
  email?: string;
  national_id?: string;
  joined_at?: string | null;
  price_tier?: number;
  note?: string;
}

export interface ShareInput {
  type: 'deposit' | 'withdraw' | 'adjust';
  amount: string;
  note?: string;
  occurred_at?: string | null;
}

export interface LinkCodeResult {
  code: string;
  expires_at: string;
}

export interface MonthTotal {
  month: number;
  total: Dec;
  bills: number;
}

export interface SaleBrief {
  id: string;
  doc_no: string;
  sold_at: string;
  net: Dec;
  status: string;
  ar_status: string;
  ar_balance: Dec;
}

export interface PurchaseSummary {
  year: number;
  total: Dec;
  bills: number;
  months: MonthTotal[] | null;
  recent: SaleBrief[] | null;
}

export interface MemberListParams extends ListParams {
  q?: string;
  status?: string;
  has_shares?: '' | 'true' | 'false';
}

// ---------------------------------------------------------------------------
// Keys & queries
// ---------------------------------------------------------------------------

export const memberKeys = {
  all: ['members'] as const,
  list: (p: MemberListParams) => ['members', 'list', p] as const,
  detail: (id: string) => ['members', 'detail', id] as const,
  shares: (id: string, p: ListParams) => ['members', 'shares', id, p] as const,
  purchases: (id: string, year: number) => ['members', 'purchases', id, year] as const,
};

export function useMembers(params: MemberListParams) {
  return useQuery({
    queryKey: memberKeys.list(params),
    queryFn: () =>
      api.get<Page<MemberView>>(`/members${qs({ ...params, page: params.page ?? 1, page_size: params.page_size ?? 50 })}`),
    placeholderData: keepPreviousData,
  });
}

export function useMember(id: string | null | undefined) {
  return useQuery({
    queryKey: memberKeys.detail(id ?? ''),
    queryFn: () => api.get<MemberDetail>(`/members/${id}`),
    enabled: Boolean(id),
  });
}

export function useMemberShares(id: string, params: ListParams) {
  return useQuery({
    queryKey: memberKeys.shares(id, params),
    queryFn: () =>
      api.get<Page<ShareTx>>(`/members/${id}/shares${qs({ page: params.page ?? 1, page_size: params.page_size ?? 50 })}`),
    placeholderData: keepPreviousData,
  });
}

export function useMemberPurchases(id: string, year: number) {
  return useQuery({
    queryKey: memberKeys.purchases(id, year),
    queryFn: () => api.get<PurchaseSummary>(`/members/${id}/purchases${qs({ year: year || '' })}`),
  });
}

/** Search used by autocompletes (`GET /members/search?q=`). */
export function searchMembers(q: string, signal?: AbortSignal): Promise<Member[]> {
  return api
    .get<Member[] | Page<Member>>(`/members/search${qs({ q, limit: 20 })}`, { signal })
    .then((r) => unwrapList(r));
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useCreateMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MemberInput) => api.post<Member>('/members', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: memberKeys.all }),
  });
}

export function useUpdateMember(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MemberPatch) => api.patch<Member>(`/members/${id}`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: memberKeys.all }),
  });
}

export function useSetMemberStatus(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: MemberStatus) => api.post<Member>(`/members/${id}/status`, { status }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: memberKeys.all }),
  });
}

export function usePostShare(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ShareInput) => api.post<ShareTx>(`/members/${id}/shares`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: memberKeys.all }),
  });
}

export function useCreateLinkCode(id: string) {
  return useMutation({
    mutationFn: () => api.post<LinkCodeResult>(`/members/${id}/link-code`),
  });
}

export function useUnlinkLine(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<void>(`/members/${id}/line`, undefined, { responseType: 'void' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: memberKeys.all }),
  });
}
