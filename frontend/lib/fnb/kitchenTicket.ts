/**
 * Kitchen tickets on paper.
 *
 * A station whose output is "printer" (or "both") gets a slip for every order that has something
 * for it: the station, the order number or table, the time, and the dishes in a font a cook can
 * read from the pass. Which device prints for which station is a choice made on that device
 * (kitchen screen → printer button) and kept in its localStorage: the PC wired to the hot
 * kitchen's printer ticks "hot kitchen", the counter ticks nothing — or everything, when one
 * receipt printer serves the whole shop and the tickets are carried through.
 */

import { printHtml, receiptCss } from '@/components/pos/ReceiptPrint';

const KEY = 'fnb.printStations';

/** Station ids this device prints tickets for. */
export function readPrintStations(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function writePrintStations(ids: string[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* private mode: the choice lasts the session */
  }
}

export interface TicketLine {
  qty: number;
  name: string;
  modifiers: string[];
  note?: string;
}

export interface KitchenTicket {
  station: string;
  /** "Table 5" or "Queue 12" — already worded by the caller. */
  where: string;
  orderNo: number;
  channel: string;
  at: Date;
  lines: TicketLine[];
  /** A second print of the same ticket says so. */
  reprint?: boolean;
}

export interface TicketLabels {
  order: string;
  reprint: string;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export function buildKitchenTicketHtml(tickets: KitchenTicket[], labels: TicketLabels): string {
  return tickets
    .map(
      (tk, i) => `<div class="rc kt${i < tickets.length - 1 ? ' pb' : ''}">
<div class="c st">${esc(tk.station)}</div>
<div class="c wh">${esc(tk.where)}</div>
<div class="r"><span>${esc(labels.order)} #${tk.orderNo} · ${esc(tk.channel)}</span><span>${hhmm(tk.at)}</span></div>
${tk.reprint ? `<div class="c rp">${esc(labels.reprint)}</div>` : ''}
<hr>
${tk.lines
  .map(
    (l) => `<div class="li"><span class="q">${l.qty}×</span><span class="n">${esc(l.name)}${l.modifiers.length ? `<div class="m">${esc(l.modifiers.join(' · '))}</div>` : ''}${l.note ? `<div class="nt">⚠ ${esc(l.note)}</div>` : ''}</span></div>`,
  )
  .join('')}
<hr>
</div>`,
    )
    .join('');
}

export function printKitchenTickets(tickets: KitchenTicket[], labels: TicketLabels, width: 58 | 80): void {
  if (tickets.length === 0) return;
  const css =
    receiptCss(width) +
    `.rc.kt .st{font-weight:900;font-size:1.3em;background:#000;color:#fff;padding:2px 0;margin-bottom:2px}
.rc.kt .wh{font-weight:900;font-size:2em;line-height:1.1;margin:2px 0}
.rc.kt .rp{font-weight:700;border:1px solid #000;margin:2px 0}
.rc.kt .li{display:flex;gap:6px;align-items:flex-start;margin:3px 0;font-size:1.35em;line-height:1.2}
.rc.kt .q{font-weight:900;min-width:2.2em}.rc.kt .n{font-weight:700;flex:1}
.rc.kt .m{font-size:0.8em;font-weight:400}.rc.kt .nt{font-size:0.8em;font-weight:700}
.rc.pb{page-break-after:always}`;
  printHtml(buildKitchenTicketHtml(tickets, labels), css);
}
