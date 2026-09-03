'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs, unwrapList, type Page } from '@/lib/api/client';
import { downloadFile } from '@/lib/api/download';
import type { Dec, ListParams } from './common';

// ---------------------------------------------------------------------------
// Types (mirror backend/internal/domain/dividend.go + dividenduc)
// ---------------------------------------------------------------------------

export type DividendStatus = 'draft' | 'simulated' | 'approved' | 'paid' | 'closed';
export const DIVIDEND_STATUSES: readonly DividendStatus[] = ['draft', 'simulated', 'approved', 'paid', 'closed'];

export type CriterionKind = 'share_rule' | 'allocation';
export type DividendPool = 'HUN' | 'AVG' | 'OTHER';
export const DIVIDEND_POOLS: readonly DividendPool[] = ['HUN', 'AVG', 'OTHER'];

export interface DividendPeriod {
  id: string;
  store_id?: string;
  be_year: number;
  starts_on: string | null;
  ends_on: string | null;
  net_profit: Dec;
  status: DividendStatus | string;
  approved_by?: string | null;
  approved_at?: string | null;
  note?: string;
  legacy_year?: string;
  created_at?: string;
  updated_at?: string;
}

export interface DividendCriterion {
  id: string;
  kind: CriterionKind | string;
  name: string;
  name_en?: string;
  percent: Dec;
  baht_per_share?: Dec | null;
  max_shares?: Dec | null;
  apply_cap: boolean;
  pool_code: DividendPool | string;
  is_locked: boolean;
  sort_order: number;
}

export interface CriterionInput {
  kind: CriterionKind;
  name: string;
  name_en?: string;
  percent: string;
  baht_per_share?: string | null;
  max_shares?: string | null;
  apply_cap: boolean;
  pool_code: DividendPool;
  sort_order?: number;
}

export interface DividendAllocation {
  criterion_id?: string;
  name: string;
  name_en?: string;
  pool_code: DividendPool | string;
  percent: Dec;
  amount: Dec;
}

export interface DividendTotals {
  net_profit: Dec;
  baht_per_share: Dec;
  max_shares?: Dec | null;
  apply_cap: boolean;
  total_shares: Dec;
  total_shares_effective: Dec;
  total_purchases: Dec;
  rate_per_share: Dec;
  rebate_rate: Dec;
  pool_hun: Dec;
  pool_avg: Dec;
  allocations: DividendAllocation[] | null;
  sum_share_dividend: Dec;
  sum_rebate: Dec;
  sum_total: Dec;
  member_count: number;
  walkin_purchases: Dec;
  walkin_rebate: Dec;
}

export interface DividendRun {
  id: string;
  period_id: string;
  run_no: number;
  totals: DividendTotals;
  member_count: number;
  is_final: boolean;
  computed_by?: string | null;
  computed_at: string;
  source: 'engine' | 'legacy_import' | string;
}

export interface PeriodSummary extends DividendPeriod {
  latest_run_id?: string | null;
  latest_run_no: number;
  latest_is_final: boolean;
  latest_source?: string;
  member_count: number;
  totals?: DividendTotals | null;
}

export interface PeriodDetail extends DividendPeriod {
  criteria: DividendCriterion[] | null;
  runs: DividendRun[] | null;
  latest_run?: DividendRun | null;
}

export interface DividendStatement {
  id: string;
  run_id: string;
  member_id?: string | null;
  member_code: string;
  member_name: string;
  member_address?: string;
  share_capital: Dec;
  shares: Dec;
  shares_effective: Dec;
  purchases: Dec;
  share_dividend: Dec;
  rebate: Dec;
  total: Dec;
  seq_no: number;
  is_walkin: boolean;
  paid_total: Dec;
}

export type PayoutMethod = 'cash' | 'transfer' | 'qr' | 'card' | 'other' | 'share_reinvest';
export const PAYOUT_METHODS: readonly PayoutMethod[] = ['cash', 'transfer', 'qr', 'card', 'other', 'share_reinvest'];

export interface DividendPayout {
  id: string;
  statement_id: string;
  amount: Dec;
  method: PayoutMethod | string;
  paid_at: string;
  paid_by?: string | null;
  note?: string;
}

export interface StatementDetail extends DividendStatement {
  payouts: DividendPayout[] | null;
  remaining: Dec;
  period_id: string;
  be_year: number;
  status: DividendStatus | string;
  run_no: number;
  is_final: boolean;
}

export interface MemberStatementRow extends DividendStatement {
  period_id: string;
  be_year: number;
  status: DividendStatus | string;
  run_no: number;
  source: string;
}

export interface CreatePeriodInput {
  be_year: number;
  starts_on?: string | null;
  ends_on?: string | null;
  net_profit: string;
  note?: string;
  copy_criteria_from_period_id?: string | null;
}

export interface UpdatePeriodInput {
  net_profit?: string;
  starts_on?: string | null;
  ends_on?: string | null;
  note?: string;
}

export interface PayoutInput {
  amount: string;
  method: PayoutMethod;
  note?: string;
  paid_at?: string | null;
}

export interface VerifyReport {
  ok: boolean;
  rows: number;
  mismatched: number;
  max_abs_diff: Record<string, Dec>;
  sum_diff: Record<string, Dec>;
  missing_codes?: string[];
  extra_codes?: string[];
  totals: DividendTotals;
}

export interface StatementParams extends ListParams {
  q?: string;
}

// ---------------------------------------------------------------------------
// Keys & queries
// ---------------------------------------------------------------------------

export const dividendKeys = {
  all: ['dividends'] as const,
  periods: ['dividends', 'periods'] as const,
  period: (id: string) => ['dividends', 'period', id] as const,
  run: (id: string) => ['dividends', 'run', id] as const,
  statements: (runId: string, p: StatementParams) => ['dividends', 'statements', runId, p] as const,
  statement: (id: string) => ['dividends', 'statement', id] as const,
  verify: (runId: string) => ['dividends', 'verify', runId] as const,
  history: (memberId: string) => ['dividends', 'history', memberId] as const,
};

export function usePeriods() {
  return useQuery({
    queryKey: dividendKeys.periods,
    queryFn: async () => unwrapList(await api.get<PeriodSummary[] | Page<PeriodSummary>>('/dividends/periods')),
  });
}

export function usePeriod(id: string | null | undefined) {
  return useQuery({
    queryKey: dividendKeys.period(id ?? ''),
    queryFn: () => api.get<PeriodDetail>(`/dividends/periods/${id}`),
    enabled: Boolean(id),
  });
}

export function useRun(runId: string | null | undefined) {
  return useQuery({
    queryKey: dividendKeys.run(runId ?? ''),
    queryFn: () => api.get<DividendRun>(`/dividends/runs/${runId}`),
    enabled: Boolean(runId),
  });
}

export function useStatements(runId: string | null | undefined, params: StatementParams) {
  return useQuery({
    queryKey: dividendKeys.statements(runId ?? '', params),
    queryFn: () =>
      api.get<Page<DividendStatement>>(
        `/dividends/runs/${runId}/statements${qs({ q: params.q, page: params.page ?? 1, page_size: params.page_size ?? 50 })}`,
      ),
    enabled: Boolean(runId),
    placeholderData: keepPreviousData,
  });
}

export function useStatement(id: string | null | undefined) {
  return useQuery({
    queryKey: dividendKeys.statement(id ?? ''),
    queryFn: () => api.get<StatementDetail>(`/dividends/statements/${id}`),
    enabled: Boolean(id),
  });
}

export function useVerifyRun(runId: string | null | undefined, enabled = false) {
  return useQuery({
    queryKey: dividendKeys.verify(runId ?? ''),
    queryFn: () => api.get<VerifyReport>(`/dividends/runs/${runId}/verify`),
    enabled: Boolean(runId) && enabled,
  });
}

export function useMemberDividendHistory(memberId: string | null | undefined) {
  return useQuery({
    queryKey: dividendKeys.history(memberId ?? ''),
    queryFn: async () =>
      unwrapList(await api.get<MemberStatementRow[] | Page<MemberStatementRow>>(`/dividends/members/${memberId}/history`)),
    enabled: Boolean(memberId),
  });
}

export function exportRunCsv(runId: string, beYear?: number): Promise<void> {
  return downloadFile(`/dividends/runs/${runId}/export.csv`, `dividend-${beYear ?? runId.slice(0, 8)}.csv`);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

function useInvalidateDividends() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: dividendKeys.all });
  };
}

export function useCreatePeriod() {
  const invalidate = useInvalidateDividends();
  return useMutation({
    mutationFn: (input: CreatePeriodInput) => api.post<PeriodDetail>('/dividends/periods', input),
    onSuccess: invalidate,
  });
}

export function useUpdatePeriod(id: string) {
  const invalidate = useInvalidateDividends();
  return useMutation({
    mutationFn: (input: UpdatePeriodInput) => api.patch<PeriodDetail>(`/dividends/periods/${id}`, input),
    onSuccess: invalidate,
  });
}

export function usePutCriteria(id: string) {
  const invalidate = useInvalidateDividends();
  return useMutation({
    mutationFn: (input: CriterionInput[]) => api.put<DividendCriterion[]>(`/dividends/periods/${id}/criteria`, input),
    onSuccess: invalidate,
  });
}

export function useSimulate(id: string) {
  const invalidate = useInvalidateDividends();
  return useMutation({
    mutationFn: () => api.post<DividendRun>(`/dividends/periods/${id}/simulate`),
    onSuccess: invalidate,
  });
}

export type PeriodTransition = 'approve' | 'mark-paid' | 'close';

export function useTransitionPeriod(id: string) {
  const invalidate = useInvalidateDividends();
  return useMutation({
    mutationFn: (action: PeriodTransition) => api.post<PeriodDetail>(`/dividends/periods/${id}/${action}`),
    onSuccess: invalidate,
  });
}

export function useAddPayout() {
  const invalidate = useInvalidateDividends();
  return useMutation({
    mutationFn: ({ statementId, ...input }: PayoutInput & { statementId: string }) =>
      api.post<StatementDetail>(`/dividends/statements/${statementId}/payouts`, input),
    onSuccess: invalidate,
  });
}
