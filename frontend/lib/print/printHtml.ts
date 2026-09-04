/**
 * Printing from the browser.
 *
 * Everything the shop prints — receipts, the shift slip, reports, the drawer-kick slip — goes
 * through one hidden iframe. The app's own stylesheet never applies to it, so a receipt cannot be
 * disturbed by the page it was printed from, and the page is not disturbed either.
 *
 * With Chrome started as `--kiosk-printing` (see docs/INSTALL_ONSITE.md) this prints straight to
 * the default printer with no dialog, which is what a till needs.
 */

/** Prints an HTML fragment. `onDone` runs once the browser reports the job finished. */
export function printHtml(body: string, css: string, onDone?: () => void): void {
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
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>print</title><style>${css}</style></head><body>${body}</body></html>`);
  doc.close();
  const win = iframe.contentWindow;
  let finished = false;
  const cleanup = () => {
    if (finished) return;
    finished = true;
    onDone?.();
    window.setTimeout(() => iframe.remove(), 1000);
  };
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
