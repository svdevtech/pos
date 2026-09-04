/**
 * Photographing a payment slip.
 *
 * The cashier either points the tablet/phone camera at the customer's phone screen, or picks a
 * file (a screenshot the customer sent, or a webcam capture on a desktop till). Either way the
 * image is shrunk here, in the browser, so a 4 MB phone photo never travels over the shop's
 * connection and never reaches the 3 MB the API accepts.
 */

import { ScanError, openCameraInto } from '@/lib/pos/barcodeCamera';

/** Longest edge of a stored slip. A bank slip stays readable well below this. */
export const SLIP_MAX_EDGE = 1280;
export const SLIP_QUALITY = 0.82;

export interface CapturedPhoto {
  /** `data:image/jpeg;base64,…` — what both the preview and the upload use. */
  dataUrl: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
}

export interface PhotoCameraControls {
  stop: () => void;
  setTorch: ((on: boolean) => Promise<void>) | null;
  /** Grabs the current frame. Returns null before the first frame has arrived. */
  capture: () => CapturedPhoto | null;
}

/** Opens the back camera as a live preview the cashier can aim before taking the picture. */
export async function startPhotoCamera(video: HTMLVideoElement, deviceId?: string): Promise<PhotoCameraControls> {
  const { setTorch, stopStream } = await openCameraInto(video, deviceId);
  return {
    stop: stopStream,
    setTorch,
    capture: () => {
      if (video.readyState < 2 || !video.videoWidth) return null;
      return drawToJpeg(video, video.videoWidth, video.videoHeight);
    },
  };
}

/** Shrinks whatever the file picker returned; also used for images dropped in from a desktop. */
export async function shrinkImageFile(file: File | Blob): Promise<CapturedPhoto> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    return drawToJpeg(img, img.naturalWidth, img.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new ScanError('unknown'));
    img.src = src;
  });
}

/** Draws a source at most SLIP_MAX_EDGE across and encodes it as JPEG. */
function drawToJpeg(source: CanvasImageSource, srcW: number, srcH: number): CapturedPhoto {
  const scale = Math.min(1, SLIP_MAX_EDGE / Math.max(srcW, srcH));
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ScanError('unknown');
  ctx.drawImage(source, 0, 0, width, height);
  const dataUrl = canvas.toDataURL('image/jpeg', SLIP_QUALITY);
  return { dataUrl, mime: 'image/jpeg', bytes: base64Bytes(dataUrl), width, height };
}

/** Byte size of the encoded image, so the UI can warn before the API refuses it. */
export function base64Bytes(dataUrl: string): number {
  const i = dataUrl.indexOf(',');
  const b64 = i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}
