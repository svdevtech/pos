'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs, unwrapList, type Page } from '@/lib/api/client';
import type { Dec } from './common';

// ---------------------------------------------------------------------------
// Types (mirror domain.Promotion)
// ---------------------------------------------------------------------------

export type PromoScope = 'bill' | 'product';
export type DiscountType = 'amount' | 'percent';

export interface Promotion {
  id: string;
  name: string;
  scope: PromoScope | string;
  product_id?: string | null;
  product_name?: string;
  min_qty: Dec;
  min_amount: Dec;
  discount_type: DiscountType | string;
  discount_value: Dec;
  free_qty: Dec;
  starts_at?: string | null;
  ends_at?: string | null;
  is_active: boolean;
}

/** Body accepted by POST/PUT /promotions (decode disallows unknown fields). */
export interface PromotionInput {
  name: string;
  scope: PromoScope;
  product_id: string | null;
  min_qty: string;
  min_amount: string;
  discount_type: DiscountType;
  discount_value: string;
  free_qty: string;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
}

export const promotionKeys = {
  all: ['promotions'] as const,
  list: (activeOnly: boolean) => ['promotions', 'list', activeOnly] as const,
};

export function usePromotions(activeOnly = false) {
  return useQuery({
    queryKey: promotionKeys.list(activeOnly),
    queryFn: async () =>
      unwrapList(await api.get<Promotion[] | Page<Promotion>>(`/promotions${qs({ active: activeOnly ? '1' : '' })}`)),
  });
}

export function useCreatePromotion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PromotionInput) => api.post<Promotion>('/promotions', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: promotionKeys.all }),
  });
}

export function useUpdatePromotion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: PromotionInput & { id: string }) => api.put<Promotion>(`/promotions/${id}`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: promotionKeys.all }),
  });
}

export function useDeletePromotion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/promotions/${id}`, undefined, { responseType: 'void' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: promotionKeys.all }),
  });
}
