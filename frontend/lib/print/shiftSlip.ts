/**
 * The shift slip (ใบสรุปกะ / X-Z report) on the receipt printer.
 *
 * What the cashier hands over with the cash: what the drawer should hold, what was counted, and
 * the difference — plus the day's takings split by tender so a manager can check it later without
 * opening the computer.
 */

import type { Locale } from '@/i18n/config';
import { formatDateTime, formatMoney } from '@/lib/format';
import { receiptCss } from '@/components/pos/ReceiptPrint';
import { printHtml } from '@/lib/print/printHtml';
import { shiftExpectedCash, type Shift, type SalesSummary, type StoreInfo } from '@/lib/pos/types';

export interface ShiftSlipLabels {
  title: string;
  terminal: string;
  cashier: string;
  openedAt: string;
  closedAt: string;
  openingFloat: string;
  cashSales: string;
  cashIn: string;
  cashOut: string;
  expectedCash: string;
  countedCash: string;
  variance: string;
  over: string;
  short: string;
  exact: string;
  bills: string;
  gross: string;
  discount: string;
  net: string;
  cancelled: string;
  byMethod: string;
  /** Heading for the tabs members paid off during the shift. */
  repayments: string;
  /** Says the cash ones are already inside "cash in" above, so nobody adds them twice. */
  repaymentsCashNote: string;
  note: string;
  printedAt: string;
  /** Payment method names, keyed by method code. */
  methods: Record<string, string>;
  /** Marks a slip taken while the shift is still running. */
  interim: string;
}

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const row = (label: string, value: string, cls = ''): string =>
  `<div class="r${cls ? ` ${cls}` : ''}"><span>${esc(label)}</span><span>${esc(value)}</span></div>`;

export function buildShiftSlipHtml(
  shift: Shift,
  summary: SalesSummary | null,
  store: StoreInfo | null,
  labels: ShiftSlipLabels,
  locale: Locale,
): string {
  const fm = (v: unknown) => formatMoney((v ?? 0) as string, locale).replace('฿ ', '');
  /** Money that is subtracted, without turning zero into "-0.00". */
  const neg = (v: unknown) => (Number(v ?? 0) === 0 ? fm(0) : `-${fm(v)}`);
  const variance = Number(shift.variance ?? 0);
  const varianceWord = shift.counted_cash === null || shift.counted_cash === undefined ? '' : variance > 0 ? labels.over : variance < 0 ? labels.short : labels.exact;
  const storeName = store ? (locale === 'en' && store.name_en ? store.name_en : store.name) : '';

  const methods = Object.entries(summary?.by_method ?? {})
    .filter(([, v]) => Number(v) !== 0)
    .map(([m, v]) => row(labels.methods[m] ?? m, fm(v)))
    .join('');
  const repaid = Object.entries(summary?.ar_by_method ?? {}).filter(([, v]) => Number(v) !== 0);
  const repayments = repaid.map(([m, v]) => row(labels.methods[m] ?? m, fm(v))).join('');
  const repaidCash = repaid.some(([m]) => m === 'cash');

  return `<div class="rc">
  ${storeName ? `<div class="c sn">${esc(storeName)}</div>` : ''}
  <div class="c t">${esc(labels.title)}</div>
  ${shift.status === 'open' ? `<div class="c copy">*** ${esc(labels.interim)} ***</div>` : ''}
  <hr>
  ${row(labels.terminal, shift.terminal || '-')}
  ${row(labels.cashier, shift.cashier_name || '-')}
  ${row(labels.openedAt, formatDateTime(shift.opened_at, locale, true))}
  ${shift.closed_at ? row(labels.closedAt, formatDateTime(shift.closed_at, locale, true)) : ''}
  <hr>
  ${row(labels.openingFloat, fm(shift.opening_float))}
  ${row(labels.cashSales, fm(shift.cash_sales))}
  ${row(labels.cashIn, fm(shift.cash_in))}
  ${row(labels.cashOut, neg(shift.cash_out))}
  ${row(labels.expectedCash, fm(shiftExpectedCash(shift)), 'net')}
  ${shift.counted_cash !== null && shift.counted_cash !== undefined ? row(labels.countedCash, fm(shift.counted_cash)) : ''}
  ${varianceWord ? row(`${labels.variance} (${varianceWord})`, fm(shift.variance), 'net') : ''}
  <hr>
  ${row(labels.bills, String(summary?.bills ?? 0))}
  ${row(labels.gross, fm(summary?.gross))}
  ${row(labels.discount, neg(summary?.discount))}
  ${row(labels.net, fm(summary?.net), 'net')}
  ${Number(summary?.cancelled ?? 0) > 0 ? row(labels.cancelled, String(summary?.cancelled)) : ''}
  ${methods ? `<hr><div class="t">${esc(labels.byMethod)}</div>${methods}` : ''}
  ${repayments ? `<hr><div class="t">${esc(labels.repayments)}</div>${repayments}${repaidCash ? `<div class="ft"><small>${esc(labels.repaymentsCashNote)}</small></div>` : ''}` : ''}
  ${shift.note ? `<hr><div class="ft">${esc(labels.note)}: ${esc(shift.note)}</div>` : ''}
  <hr>
  <div class="c ft"><small>${esc(labels.printedAt)}</small></div>
  <div class="c ft" style="margin-top:14px">.................................</div>
  <div class="c"><small>${esc(labels.cashier)}</small></div>
</div>`;
}

export function printShiftSlip(
  shift: Shift,
  summary: SalesSummary | null,
  store: StoreInfo | null,
  labels: ShiftSlipLabels,
  locale: Locale,
  paperWidth: 58 | 80,
): void {
  printHtml(buildShiftSlipHtml(shift, summary, store, labels, locale), receiptCss(paperWidth));
}
