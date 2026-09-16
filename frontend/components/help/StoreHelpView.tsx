'use client';

import HelpView, { type HelpDoc } from '@/components/help/HelpView';
import { useStoreSettings, type BusinessType } from '@/lib/api/hooks/store';

/** Which manuals a shop is given: a restaurant is not handed the grocery's. */
const FOR_KIND: Record<BusinessType, (id: string) => boolean> = {
  retail: (id) => id !== 'fnb-user-guide',
  restaurant: (id) => id === 'fnb-user-guide',
  both: () => true,
};

/**
 * The manual inside the app. It shows the manuals that match what the shop sells, so a café is
 * not asked to read about dividends and a grocery is not asked to read about table service.
 */
export default function StoreHelpView({ docs }: { docs: HelpDoc[] }) {
  const settings = useStoreSettings();
  const kind = (settings.data?.business_type as BusinessType | undefined) ?? 'retail';
  const keep = FOR_KIND[kind] ?? FOR_KIND.retail;
  const mine = docs.filter((d) => keep(d.id));
  return <HelpView docs={mine.length ? mine : docs} />;
}
