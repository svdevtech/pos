/**
 * Opening the cash drawer without a sale.
 *
 * Most shops wire the drawer into the receipt printer's DK socket with the driver set to open it
 * on each job (see docs/INSTALL_ONSITE.md §4), so "open the drawer" prints one short slip: the
 * drawer pops, and the paper doubles as the record of who opened it.
 *
 * Printers without a DK socket drive the drawer through a USB-serial kicker box instead. Those
 * shops pick "serial" and the browser pulses the box directly (lib/pos/serialDrawer.ts) — nothing
 * is printed. Shops with no drawer at all pick "off" and only the event is recorded.
 */

import type { Locale } from '@/i18n/config';
import { receiptCss } from '@/components/pos/ReceiptPrint';
import { formatDateTime, formatMoney } from '@/lib/format';
import { printHtml } from '@/lib/print/printHtml';
import { pulseDrawer, type SerialTrigger } from '@/lib/pos/serialDrawer';
import type { DrawerReason, StoreInfo, StoreSettings } from '@/lib/pos/types';

/** ตั้งค่า → ใบเสร็จ → เปิดลิ้นชัก: print a slip, pulse the serial box, or only record the event. */
export type DrawerKickMode = 'print' | 'serial' | 'off';

export function drawerKickMode(settings: StoreSettings | null | undefined): DrawerKickMode {
  const mode = settings?.drawer_kick;
  if (mode === 'off') return 'off';
  return mode === 'serial' ? 'serial' : 'print';
}

/** Port settings for the kicker box, defaulted for a shop that never touched them. */
export function serialDrawerOptions(settings: StoreSettings | null | undefined): { trigger: SerialTrigger; baudRate: number } {
  const t = settings?.drawer_serial_trigger;
  const baud = Number(settings?.drawer_serial_baud);
  return {
    trigger: t === 'escpos' || t === 'dtr' || t === 'rts' ? t : 'auto',
    baudRate: Number.isFinite(baud) && baud > 0 ? baud : 9600,
  };
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

/**
 * Opens the drawer the way this shop is wired, and resolves once it has been asked to.
 *
 * Only the serial path can fail in a way the cashier can act on (no port picked yet, box
 * unplugged), so that is the only one that rejects; printing and "off" always resolve.
 */
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
  serial?: { trigger: SerialTrigger; baudRate: number },
): Promise<void> {
  if (mode === 'off') return Promise.resolve();
  if (mode === 'serial') return pulseDrawer(serial);
  printHtml(buildDrawerSlipHtml(reason, labels, store, cashier, locale, amount, note), receiptCss(paperWidth));
  return Promise.resolve();
}
