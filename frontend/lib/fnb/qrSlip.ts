/**
 * A table's QR on the receipt printer: shop name, table, the code, "scan to order". Printed when
 * a party is seated (or one slip per table at opening); the code stops working when the table is
 * closed, so the slip says so and a fresh one is printed for the next party.
 */

import { printHtml, receiptCss } from '@/components/pos/ReceiptPrint';
import { qrPath } from '@/lib/pos/qrPayload';

export interface QrSlipLabels {
  table: string;
  scan: string;
  validUntilClose: string;
}

export interface QrSlipEntry {
  code: string;
  url: string;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/** One `.rc` block per table; every block but the last ends its page so the printer cuts between them. */
export function buildQrSlipHtml(entries: QrSlipEntry[], storeName: string, labels: QrSlipLabels): string {
  return entries
    .map((e, i) => {
      const m = qrPath(e.url, 2);
      return `<div class="rc qs${i < entries.length - 1 ? ' pb' : ''}">
<div class="c sn">${esc(storeName)}</div>
<div class="c tb">${esc(labels.table)} ${esc(e.code)}</div>
<svg class="qr" viewBox="0 0 ${m.size} ${m.size}" shape-rendering="crispEdges"><path d="${m.path}" fill="#000"/></svg>
<div class="c t">${esc(labels.scan)}</div>
<div class="c"><small>${esc(labels.validUntilClose)}</small></div>
</div>`;
    })
    .join('');
}

export function printQrSlips(entries: QrSlipEntry[], storeName: string, labels: QrSlipLabels, width: 58 | 80): void {
  if (entries.length === 0) return;
  const css =
    receiptCss(width) +
    `.rc.qs .tb{font-weight:700;font-size:1.7em;margin:2px 0}
.rc.qs .qr{display:block;width:${width === 58 ? '40mm' : '56mm'};height:auto;margin:2mm auto}
.rc.pb{page-break-after:always}`;
  printHtml(buildQrSlipHtml(entries, storeName, labels), css);
}
