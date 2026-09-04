/**
 * Turning a PromptPay payload string into something a customer can scan.
 *
 * ZXing is already a dependency (the camera scanner's fallback decoder), so its writer is reused
 * rather than adding a second QR library. The matrix is drawn as one SVG path: it scales to any
 * size without blurring and prints cleanly on a receipt.
 */

import { BarcodeFormat, EncodeHintType, MultiFormatWriter } from '@zxing/library';

export interface QrMatrix {
  size: number;
  /** SVG path of every dark module, in a 0..size coordinate space. */
  path: string;
}

/**
 * Encodes `text` as a QR code. Throws when the text is empty or too long for a QR symbol, which
 * the caller shows as an error rather than an unreadable code.
 */
export function qrPath(text: string, margin = 2): QrMatrix {
  if (!text) throw new Error('empty payload');
  const hints = new Map<EncodeHintType, unknown>();
  hints.set(EncodeHintType.MARGIN, margin);
  // Medium recovery: readable from a phone screen while keeping the modules large.
  hints.set(EncodeHintType.ERROR_CORRECTION, 'M');
  const matrix = new MultiFormatWriter().encode(text, BarcodeFormat.QR_CODE, 0, 0, hints);
  const w = matrix.getWidth();
  const h = matrix.getHeight();
  let path = '';
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (matrix.get(x, y)) path += `M${x} ${y}h1v1h-1z`;
    }
  }
  return { size: Math.max(w, h), path };
}
