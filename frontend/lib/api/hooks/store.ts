'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

/** Free-form per-store settings map (domain.StoreSettings). Only known keys are typed. */
export interface StoreSettings {
  paper_width?: number | string;
  receipt_locale?: 'th' | 'en' | string;
  show_logo?: boolean;
  auto_print_receipt?: boolean;
  allow_price_edit?: boolean;
  require_shift?: boolean;
  allow_negative_stock?: boolean;
  drawer_port?: string;
  display_port?: string;
  rounding?: number | string;
  [key: string]: unknown;
}

export const storeSettingsKey = ['store-settings'] as const;

export function useStoreSettings() {
  return useQuery({
    queryKey: storeSettingsKey,
    queryFn: async () => (await api.get<StoreSettings | null>('/store/settings')) ?? {},
  });
}

/** PUT replaces the whole map, so callers must merge with the current value first. */
export function useSaveStoreSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (settings: StoreSettings) => api.put<StoreSettings>('/store/settings', settings),
    onSuccess: (data) => qc.setQueryData(storeSettingsKey, data ?? {}),
  });
}
