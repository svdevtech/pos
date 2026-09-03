'use client';

import PrintIcon from '@mui/icons-material/Print';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GlassButton, GlassDialog } from '@/components/glass';
import { resolveLocale, type Locale } from '@/i18n/config';
import { formatDateTime, formatMoney, formatQty } from '@/lib/format';
import { posApi, posKeys } from '@/lib/pos/api';
import { dec, type PaymentMethod, type ReceiptData } from '@/lib/pos/types';

export const AUTO_PRINT_KEY = 'pos.autoPrint';

export function readAutoPrint(): boolean {
  try {
    const v = window.localStorage.getItem(AUTO_PRINT_KEY);
    return v === null ? true : v === '1';
  } catch {
    return true;
  }
}

export function writeAutoPrint(on: boolean): void {
  try {
    window.localStorage.setItem(AUTO_PRINT_KEY, on ? '1' : '0');
  } catch {
    // ignore
  }
}

export interface ReceiptLabels {
  title: string;
  docNo: string;
  date: string;
  cashier: string;
  member: string;
  walkIn: string;
  qty: string;
  discount: string;
  gross: string;
  totalDiscount: string;
  net: string;
  tendered: string;
  change: string;
  arBalance: string;
  creditThisBill: string;
  cancelled: string;
  taxId: string;
  tel: string;
  free: string;
  methods: Record<PaymentMethod, string>;
  copy: string;
}

export function useReceiptLabels(): ReceiptLabels {
  const t = useTranslations('receipt');
  return useMemo(
    () => ({
      title: t('title'),
      docNo: t('docNo'),
      date: t('date'),
      cashier: t('cashier'),
      member: t('member'),
      walkIn: t('walkIn'),
      qty: t('qty'),
      discount: t('discount'),
      gross: t('gross'),
      totalDiscount: t('totalDiscount'),
      net: t('net'),
      tendered: t('tendered'),
      change: t('change'),
      arBalance: t('arBalance'),
      creditThisBill: t('creditThisBill'),
      cancelled: t('cancelled'),
      taxId: t('taxId'),
      tel: t('tel'),
      free: t('free'),
      copy: t('copy'),
      methods: {
        cash: t('methods.cash'),
        credit: t('methods.credit'),
        transfer: t('methods.transfer'),
        card: t('methods.card'),
        qr: t('methods.qr'),
        other: t('methods.other'),
      },
    }),
    [t],
  );
}

function esc(s: string | number | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nl2br(s: string): string {
  return esc(s).replace(/\r?\n/g, '<br>');
}

export function paperWidthMm(settings: ReceiptData['settings']): 58 | 80 {
  const w = Number(settings?.paper_width);
  return w === 58 ? 58 : 80;
}

/** Builds the receipt body HTML (no <html>/<body>); used both for preview and printing. */
export function buildReceiptHtml(data: ReceiptData, labels: ReceiptLabels, locale: Locale, opts: { copy?: boolean } = {}): string {
  const { store, settings, sale } = data;
  const width = paperWidthMm(settings);
  const fm = (v: string | number | null | undefined) => formatMoney(v, locale).replace('฿ ', '');
  const storeName = store ? (locale === 'en' && store.name_en ? store.name_en : store.name) : '';
  const lines = sale.lines ?? [];
  const payments = sale.payments ?? [];
  const isCancelled = sale.status === 'cancelled';
  const lineDiscount = money2(dec(sale.discount) - dec(sale.bill_discount));

  const row = (l: string, r: string, cls = '') => `<div class="r ${cls}"><span>${l}</span><span>${r}</span></div>`;

  const linesHtml = lines
    .map((l) => {
      const disc = dec(l.discount);
      return `<div class="ln">
  <div class="n">${esc(l.description)}${l.is_free ? ` <i>(${esc(labels.free)})</i>` : ''}${l.serial_no ? `<br><small>S/N ${esc(l.serial_no)}</small>` : ''}</div>
  <div class="r"><span>${esc(formatQty(l.qty, locale))}${l.unit_name ? ` ${esc(l.unit_name)}` : ''} × ${fm(l.unit_price)}</span><span>${l.is_free ? '0.00' : fm(l.line_total)}</span></div>
  ${disc > 0 && !l.is_free ? `<div class="r d"><span>&nbsp;&nbsp;${esc(labels.discount)}</span><span>-${fm(disc)}</span></div>` : ''}
</div>`;
    })
    .join('');

  const paymentsHtml = payments
    .map((p) => row(`${esc(labels.methods[p.method] ?? p.method)}${p.reference ? ` <small>${esc(p.reference)}</small>` : ''}`, fm(p.amount)))
    .join('');

  const credit = payments.filter((p) => p.method === 'credit').reduce((s, p) => s + dec(p.amount), 0);
  const cashTendered = dec(sale.tendered);

  return `<div class="rc w${width}">
  ${opts.copy ? `<div class="c copy">** ${esc(labels.copy)} **</div>` : ''}
  ${isCancelled ? `<div class="c cancelled">*** ${esc(labels.cancelled)} ***</div>` : ''}
  <div class="c hd">
    <div class="sn">${esc(storeName)}</div>
    ${store?.address ? `<div>${nl2br(store.address)}</div>` : ''}
    ${store?.phone ? `<div>${esc(labels.tel)} ${esc(store.phone)}</div>` : ''}
    ${store?.tax_id ? `<div>${esc(labels.taxId)} ${esc(store.tax_id)}</div>` : ''}
    ${store?.receipt_header ? `<div class="hh">${nl2br(store.receipt_header)}</div>` : ''}
  </div>
  <div class="c t">${esc(labels.title)}</div>
  <hr>
  ${row(esc(labels.docNo), `<b>${esc(sale.doc_no)}</b>`)}
  ${row(esc(labels.date), esc(formatDateTime(sale.sold_at, locale, true)))}
  ${row(esc(labels.cashier), esc(sale.cashier_name ?? '-'))}
  ${row(esc(labels.member), sale.member_id ? `${esc(sale.member_code)} ${esc(sale.member_name)}` : esc(labels.walkIn))}
  <hr>
  ${linesHtml}
  <hr>
  ${row(esc(labels.gross), fm(sale.gross))}
  ${lineDiscount > 0 ? row(esc(labels.discount), `-${fm(lineDiscount)}`) : ''}
  ${dec(sale.bill_discount) > 0 ? row(esc(labels.totalDiscount), `-${fm(sale.bill_discount)}`) : ''}
  ${row(`<b>${esc(labels.net)}</b>`, `<b>${fm(sale.net)}</b>`, 'net')}
  <hr>
  ${paymentsHtml}
  ${row(esc(labels.tendered), fm(cashTendered))}
  ${row(esc(labels.change), fm(sale.change_amount))}
  ${credit > 0 ? `<hr>${row(esc(labels.creditThisBill), fm(credit))}${row(esc(labels.arBalance), fm(sale.ar_balance))}` : ''}
  <hr>
  ${store?.receipt_footer ? `<div class="c ft">${nl2br(store.receipt_footer)}</div>` : ''}
  <div class="c bc">*${esc(sale.doc_no)}*</div>
</div>`;
}

function money2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function receiptCss(width: 58 | 80): string {
  const w = width === 58 ? '48mm' : '72mm';
  const fs = width === 58 ? '10.5px' : '12px';
  return `
.rc{font-family:"Sarabun","Noto Sans Thai","Courier New",monospace;font-size:${fs};line-height:1.35;color:#000;background:#fff;width:${w};padding:2mm;box-sizing:border-box;margin:0 auto}
.rc .c{text-align:center}.rc .sn{font-weight:700;font-size:1.25em}.rc .t{font-weight:700;margin:2px 0}.rc .hh,.rc .ft{margin-top:2px;white-space:pre-wrap}
.rc hr{border:0;border-top:1px dashed #000;margin:3px 0}
.rc .r{display:flex;justify-content:space-between;gap:6px}.rc .r span:last-child{white-space:nowrap;font-variant-numeric:tabular-nums}
.rc .ln{margin:2px 0}.rc .n{word-break:break-word}.rc .d{font-size:0.92em}.rc .net{font-size:1.15em;margin:2px 0}
.rc .bc{font-family:"Libre Barcode 39","Courier New",monospace;letter-spacing:2px;margin-top:4px}
.rc .cancelled{font-weight:700;font-size:1.2em;border:2px solid #000;margin-bottom:4px}.rc .copy{font-weight:700}
.rc small{font-size:0.85em}
@page{size:${width}mm auto;margin:0}
@media print{html,body{margin:0;padding:0;background:#fff}.rc{width:${w}}}
`;
}

/** Prints an HTML fragment through a hidden iframe (does not disturb the app's own print styles). */
export function printHtml(body: string, css: string): void {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  if (!doc) return;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>receipt</title><style>${css}</style></head><body>${body}</body></html>`);
  doc.close();
  const win = iframe.contentWindow;
  const cleanup = () => window.setTimeout(() => iframe.remove(), 1000);
  if (!win) return;
  win.onafterprint = cleanup;
  window.setTimeout(() => {
    try {
      win.focus();
      win.print();
    } finally {
      // Fallback removal for browsers that never fire afterprint.
      window.setTimeout(cleanup, 60_000);
    }
  }, 150);
}

export function printReceipt(data: ReceiptData, labels: ReceiptLabels, locale: Locale, opts: { copy?: boolean } = {}): void {
  const width = paperWidthMm(data.settings);
  printHtml(buildReceiptHtml(data, labels, locale, opts), receiptCss(width));
}

interface DialogProps {
  open: boolean;
  saleId: string | null;
  onClose: () => void;
  /** Shown as the primary action after a sale ("new sale"). */
  onNewSale?: () => void;
  /** Print immediately when the receipt loads (first open only). */
  autoPrint?: boolean;
  /** Mark the print-out as a reprint. */
  copy?: boolean;
  change?: number | null;
}

/** Fetches `/sales/{id}/receipt`, previews it and prints. */
export default function ReceiptDialog({ open, saleId, onClose, onNewSale, autoPrint = false, copy = false, change }: DialogProps) {
  const t = useTranslations('pos');
  const labels = useReceiptLabels();
  const locale = resolveLocale(useLocale());
  const [auto, setAuto] = useState(true);
  const printedFor = useRef<string | null>(null);

  useEffect(() => setAuto(readAutoPrint()), []);

  const receipt = useQuery({
    queryKey: posKeys.receipt(saleId ?? ''),
    queryFn: () => posApi.receipt(saleId as string),
    enabled: open && Boolean(saleId),
    staleTime: 60_000,
  });

  const html = useMemo(() => (receipt.data ? buildReceiptHtml(receipt.data, labels, locale, { copy }) : ''), [receipt.data, labels, locale, copy]);
  const width = paperWidthMm(receipt.data?.settings ?? null);

  const doPrint = useCallback(() => {
    if (receipt.data) printReceipt(receipt.data, labels, locale, { copy });
  }, [receipt.data, labels, locale, copy]);

  useEffect(() => {
    if (!open || !receipt.data || !autoPrint || !auto) return;
    if (printedFor.current === receipt.data.sale.id) return;
    printedFor.current = receipt.data.sale.id;
    doPrint();
  }, [open, receipt.data, autoPrint, auto, doPrint]);

  useEffect(() => {
    if (!open) printedFor.current = null;
  }, [open]);

  return (
    <GlassDialog
      open={open}
      onClose={onClose}
      title={copy ? t('reprint') : t('receipt')}
      maxWidth="sm"
      data-testid="receipt-dialog"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onNewSale) {
          e.preventDefault();
          onNewSale();
        }
      }}
      actions={
        <>
          <FormControlLabel
            control={
              <Checkbox
                checked={auto}
                onChange={(e) => {
                  setAuto(e.target.checked);
                  writeAutoPrint(e.target.checked);
                }}
                size="small"
              />
            }
            label={t('autoPrint')}
            sx={{ mr: 'auto' }}
          />
          <GlassButton variant="outlined" startIcon={<PrintIcon />} onClick={doPrint} disabled={!receipt.data} data-testid="receipt-print">
            {t('printReceipt')}
          </GlassButton>
          {onNewSale ? (
            <GlassButton onClick={onNewSale} data-testid="receipt-new-sale">
              {t('newSale')} (Enter)
            </GlassButton>
          ) : (
            <GlassButton onClick={onClose}>{t('close')}</GlassButton>
          )}
        </>
      }
    >
      {typeof change === 'number' && change > 0 && (
        <Box sx={{ textAlign: 'center', mb: 2 }}>
          <Typography variant="body2" color="text.secondary">
            {t('change')}
          </Typography>
          <Typography variant="h3" fontWeight={800} color="success.main" data-testid="receipt-change">
            {formatMoney(change, locale)}
          </Typography>
        </Box>
      )}
      {receipt.isPending && (
        <Stack alignItems="center" sx={{ py: 4 }}>
          <CircularProgress />
        </Stack>
      )}
      {receipt.isError && <Typography color="error">{t('receiptLoadFailed')}</Typography>}
      {receipt.data && (
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <Box
            sx={{ background: '#fff', color: '#000', borderRadius: 1, boxShadow: 3, overflow: 'hidden', maxWidth: '100%' }}
            data-testid="receipt-preview"
          >
            <style>{receiptCss(width)}</style>
            <div dangerouslySetInnerHTML={{ __html: html }} />
          </Box>
        </Box>
      )}
    </GlassDialog>
  );
}
