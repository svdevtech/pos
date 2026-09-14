/**
 * The shop logo, prepared for a thermal printer.
 *
 * Two things stop the stored image from going straight onto the receipt:
 *
 *   - printing happens inside a detached iframe that is torn down as soon as print() returns, so a
 *     logo referenced by URL is usually still loading when the paper comes out. It has to be a
 *     data URI, embedded in the markup.
 *   - a thermal head has one ink and no greys. Left to the driver, a colour or antialiased logo is
 *     dithered into a grey mush at 203 dpi. Thresholding it to pure black and white first is what
 *     makes it come out looking like the logo.
 *
 * The result is cached for the page's lifetime: it is the same image on every bill, and a till
 * prints hundreds a day.
 */

import { api } from '@/lib/api/client';
import type { StoreInfo, StoreSettings } from '@/lib/pos/types';

/** Widest the logo may print, in device pixels at 203 dpi (~40 mm on 58 mm paper). */
const MAX_WIDTH = 320;
/** Pixels at or above this luminance become paper, the rest become ink. */
const THRESHOLD = 176;

let cached: Promise<string | null> | null = null;

/** ตั้งค่า → ใบเสร็จ → แสดงโลโก้บนใบเสร็จ, and only when a logo was actually uploaded. */
export function logoWanted(store: StoreInfo | null | undefined, settings: StoreSettings | null | undefined): boolean {
  return Boolean(store?.has_logo) && settings?.show_logo !== false;
}

function toMonochromeDataUrl(bitmap: HTMLImageElement): string | null {
  const scale = Math.min(1, MAX_WIDTH / (bitmap.naturalWidth || MAX_WIDTH));
  const w = Math.max(1, Math.round((bitmap.naturalWidth || MAX_WIDTH) * scale));
  const h = Math.max(1, Math.round((bitmap.naturalHeight || MAX_WIDTH) * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // transparent logos are common; paint paper underneath so they do not threshold to solid black
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    const v = lum >= THRESHOLD ? 255 : 0;
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

function decode(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      let out: string | null = null;
      try {
        out = toMonochromeDataUrl(img);
      } catch {
        out = null;
      }
      URL.revokeObjectURL(url);
      resolve(out);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

/**
 * The logo as a print-ready data URI, or null when the shop has none, the fetch failed, or the
 * browser gave us no canvas. Never throws: a missing logo must not stop a receipt from printing.
 */
export function loadReceiptLogo(): Promise<string | null> {
  if (!cached) {
    cached = api
      .get<Blob>('/store/logo', { responseType: 'blob' })
      .then((blob) => (blob && blob.size > 0 ? decode(blob) : null))
      .catch(() => null);
  }
  return cached;
}

/** Drops the cache so a freshly uploaded logo is picked up without a reload. */
export function forgetReceiptLogo(): void {
  cached = null;
}
