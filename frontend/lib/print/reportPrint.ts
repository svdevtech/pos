/**
 * Reports on paper.
 *
 * The screen's report grid keeps only the visible rows in the DOM, so asking the browser to print
 * the page gives a sheet with a header and nothing under it. This builds a plain table from the
 * rows the page already holds and prints that instead — every row, in order, with the totals line.
 */

import { printHtml } from '@/lib/print/printHtml';

export interface PrintCell {
  /** Already formatted for the reader's locale. */
  text: string;
  align?: 'left' | 'right';
}

export interface PrintReportInput {
  storeName: string;
  /** Report name, e.g. "ยอดขายรายวัน". */
  title: string;
  /** Date range or filter description; printed under the title. */
  subtitle?: string;
  head: string[];
  aligns: Array<'left' | 'right'>;
  rows: string[][];
  /** Totals line, printed in bold at the end. */
  total?: string[] | null;
  /** "พิมพ์เมื่อ … โดย …" line at the foot of every page. */
  footNote: string;
  /** Landscape suits wide reports (daily sales has 14 columns). */
  landscape?: boolean;
}

const esc = (v: string): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

export function reportCss(landscape: boolean): string {
  return `
@page{size:A4 ${landscape ? 'landscape' : 'portrait'};margin:10mm 8mm 12mm}
body{margin:0;background:#fff;color:#000;font-family:"Sarabun","Noto Sans Thai",system-ui,sans-serif;font-size:10.5px}
h1{font-size:15px;margin:0 0 2px}
.sub{font-size:10.5px;color:#333;margin-bottom:6px}
.store{font-size:11px;font-weight:700}
table{width:100%;border-collapse:collapse;table-layout:auto}
thead{display:table-header-group}
th,td{border:1px solid #999;padding:3px 5px;vertical-align:top}
th{background:#eee;font-weight:700;text-align:left;white-space:nowrap}
td.r,th.r{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
tbody tr{break-inside:avoid}
tr.total td{font-weight:700;background:#f2f2f2}
.foot{margin-top:8px;font-size:9px;color:#444}
`;
}

export function buildReportHtml(input: PrintReportInput): string {
  const cls = (i: number) => (input.aligns[i] === 'right' ? ' class="r"' : '');
  const head = input.head.map((h, i) => `<th${cls(i)}>${esc(h)}</th>`).join('');
  const body = input.rows
    .map((r) => `<tr>${r.map((c, i) => `<td${cls(i)}>${esc(c)}</td>`).join('')}</tr>`)
    .join('');
  const total = input.total ? `<tr class="total">${input.total.map((c, i) => `<td${cls(i)}>${esc(c)}</td>`).join('')}</tr>` : '';
  return `
<div class="store">${esc(input.storeName)}</div>
<h1>${esc(input.title)}</h1>
${input.subtitle ? `<div class="sub">${esc(input.subtitle)}</div>` : ''}
<table><thead><tr>${head}</tr></thead><tbody>${body}${total}</tbody></table>
<div class="foot">${esc(input.footNote)}</div>
`;
}

export function printReport(input: PrintReportInput): void {
  // more than eight columns will not fit A4 upright at a readable size
  const landscape = input.landscape ?? input.head.length > 8;
  printHtml(buildReportHtml({ ...input, landscape }), reportCss(landscape));
}
