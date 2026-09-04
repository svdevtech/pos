/**
 * Opening the cash drawer without a sale.
 *
 * A browser cannot talk to a COM port, so it cannot pulse a drawer directly. What it can do is
 * print — and in every shop the drawer is wired to the receipt printer's DK socket, with the
 * printer driver set to open it on each job (see docs/INSTALL_ONSITE.md §4). So "open the drawer"
 * prints one short slip: the drawer pops, and the paper doubles as the record of who opened it.
 *
 * Shops without that wiring set ตั้งค่า → ใบเสร็จ → เปิดลิ้นชัก to "off" and nothing is printed.
 */

import type { Locale } from '@/i18n/config';
import { receiptCss } from '@/components/pos/ReceiptPrint';
import { formatDateTime, formatMoney } from '@/lib/format';
import { printHtml } from '@/lib/print/printHtml';
import type { DrawerReason, StoreInfo, StoreSettings } from '@/lib/pos/types';

/** ตั้งค่า → ใบเสร็จ → เปิดลิ้นชัก: print a slip to kick the drawer, or only record the event. */
export type DrawerKickMode = 'print' | 'off';

export function drawerKickMode(settings: StoreSettings | null | undefined): DrawerKickMode {
  return settings?.drawer_kick === 'off' ? 'off' : 'print';
}

export interface DrawerSlipLabels {
  /** Heading per reason: no_sale / paid_in / paid_out. */
  title: string;
  cashier: string;
  amount?: string;
  note?: string;
}

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

export function buildDrawerSlipHtml(
  reason: DrawerReason,
  labels: DrawerSlipLabels,
  store: StoreInfo | null,
  cashier: string,
  locale: Locale,
  amount = 0,
  note = '',
): string {
  const storeName = store ? (locale === 'en' && store.name_en ? store.name_en : store.name) : '';
  return `<div class="rc">
  ${storeName ? `<div class="c">${esc(storeName)}</div>` : ''}
  <div class="c t">${esc(labels.title)}</div>
  <hr>
  <div class="r"><span>${esc(labels.cashier)}</span><span>${esc(cashier)}</span></div>
  <div class="r"><span></span><span>${esc(formatDateTime(new Date().toISOString(), locale, true))}</span></div>
  ${reason !== 'no_sale' && labels.amount ? `<div class="r net"><span>${esc(labels.amount)}</span><span>${esc(formatMoney(amount, locale).replace('฿ ', ''))}</span></div>` : ''}
  ${note && labels.note ? `<div class="ft">${esc(labels.note)}: ${esc(note)}</div>` : ''}
</div>`;
}

/** Prints the slip that opens the drawer. Does nothing when the shop has turned the mode off. */
export function kickDrawer(
  mode: DrawerKickMode,
  reason: DrawerReason,
  labels: DrawerSlipLabels,
  store: StoreInfo | null,
  cashier: string,
  locale: Locale,
  paperWidth: 58 | 80,
  amount = 0,
  note = '',
): void {
  if (mode === 'off') return;
  printHtml(buildDrawerSlipHtml(reason, labels, store, cashier, locale, amount, note), receiptCss(paperWidth));
}
