'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

/** Free-form per-store settings map (domain.StoreSettings). Only known keys are typed. */
/** What the shop sells, which decides the menu it is given. */
export type BusinessType = 'retail' | 'restaurant' | 'both';
export const BUSINESS_TYPES: readonly BusinessType[] = ['retail', 'restaurant', 'both'];

export interface StoreSettings {
  /** retail = ร้านค้า, restaurant = ร้านอาหาร/กาแฟ, both = ทั้งสองอย่าง. Unset behaves as retail. */
  business_type?: BusinessType | string;
  paper_width?: number | string;
  receipt_locale?: 'th' | 'en' | string;
  show_logo?: boolean;
  auto_print_receipt?: boolean;
  allow_price_edit?: boolean;
  require_shift?: boolean;
  allow_negative_stock?: boolean;
  /** POS payment dialog keypad: auto (touch devices), always, off. */
  keypad_mode?: 'auto' | 'always' | 'off' | string;
  /** "open the drawer" prints a short slip (the printer pops the drawer), or only records it. */
  drawer_kick?: 'print' | 'off' | string;
  drawer_port?: string;
  display_port?: string;
  rounding?: number | string;
  /** PromptPay account the till builds payment QR codes for; empty turns the feature off. */
  promptpay_id?: string;
  /** ASCII payee name shown in the customer's banking app (max 25 characters). */
  promptpay_name?: string;
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
