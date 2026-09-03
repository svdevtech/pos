'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs, unwrapList, type Page } from '@/lib/api/client';
import type { Dec, ListParams, PaymentMethod } from './common';

// ---------------------------------------------------------------------------
// Types (mirror domain.Expense / expenseuc)
// ---------------------------------------------------------------------------

export interface ExpenseType {
  id: string;
  name: string;
  name_en?: string;
  is_active: boolean;
}

export interface Expense {
  id: string;
  type_id?: string | null;
  type_name?: string;
  expensed_at: string;
  amount: Dec;
  note?: string;
  paid_from: PaymentMethod | string;
  shift_id?: string | null;
  created_by?: string | null;
  created_by_name?: string;
  created_at?: string;
}

export interface ExpenseInput {
  type_id?: string | null;
  expensed_at: string; // YYYY-MM-DD
  amount: string;
  note?: string;
  paid_from: PaymentMethod;
  from_drawer: boolean;
}

export interface ExpenseList {
  items: Expense[] | null;
  total: number;
  sum: Dec;
  page: number;
  page_size: number;
}

export interface ExpenseParams extends ListParams {
  from?: string;
  to?: string;
  type_id?: string;
}

export const expenseKeys = {
  all: ['expenses'] as const,
  list: (p: ExpenseParams) => ['expenses', 'list', p] as const,
  types: ['expense-types'] as const,
};

export function useExpenseTypes() {
  return useQuery({
    queryKey: expenseKeys.types,
    queryFn: async () => unwrapList(await api.get<ExpenseType[] | Page<ExpenseType>>('/expenses/types')),
    staleTime: 5 * 60_000,
  });
}

export function useExpenses(params: ExpenseParams) {
  return useQuery({
    queryKey: expenseKeys.list(params),
    queryFn: () =>
      api.get<ExpenseList>(`/expenses${qs({ ...params, page: params.page ?? 1, page_size: params.page_size ?? 50 })}`),
    placeholderData: keepPreviousData,
  });
}

export function useSaveExpenseType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id?: string; name: string; name_en?: string; is_active: boolean }) => {
      const { id, ...body } = input;
      return id ? api.patch<ExpenseType>(`/expenses/types/${id}`, body) : api.post<ExpenseType>('/expenses/types', body);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: expenseKeys.types }),
  });
}

export function useCreateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ExpenseInput) => api.post<Expense>('/expenses', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: expenseKeys.all }),
  });
}

export function useUpdateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: ExpenseInput & { id: string }) => api.patch<Expense>(`/expenses/${id}`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: expenseKeys.all }),
  });
}

export function useDeleteExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/expenses/${id}`, undefined, { responseType: 'void' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: expenseKeys.all }),
  });
}
