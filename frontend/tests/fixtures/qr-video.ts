import { writeFileSync } from 'node:fs';
import { BarcodeFormat, EncodeHintType, MultiFormatWriter } from '@zxing/library';

/**
 * Writes a Y4M video whose every frame shows one QR code, for Chromium's
 * `--use-file-for-fake-video-capture`. Used by tests/e2e/camera.spec.ts to check that the app
 * really decodes a symbol off the camera instead of a stubbed detector.
 */
export function makeQrVideo(path: string, text: string, opts: { width?: number; height?: number; frames?: number } = {}): string {
  const { width = 640, height = 480, frames = 4 } = opts;
  const hints = new Map<EncodeHintType, unknown>();
  hints.set(EncodeHintType.MARGIN, 2);
  const size = 320; // QR square inside the frame
  const matrix = new MultiFormatWriter().encode(text, BarcodeFormat.QR_CODE, size, size, hints as never);

  const luma = Buffer.alloc(width * height, 235); // white paper
  const offX = Math.floor((width - size) / 2);
  const offY = Math.floor((height - size) / 2);
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (matrix.get(col, row)) luma[(offY + row) * width + (offX + col)] = 16; // black module
    }
  }
  const chroma = Buffer.alloc((width / 2) * (height / 2), 128); // greyscale

  const parts: Buffer[] = [Buffer.from(`YUV4MPEG2 W${width} H${height} F30:1 Ip A1:1 C420mpeg2\n`)];
  for (let i = 0; i < frames; i++) parts.push(Buffer.from('FRAME\n'), luma, chroma, chroma);
  writeFileSync(path, Buffer.concat(parts));
  return path;
}
