/**
 * Camera barcode scanning for tablets/phones that have no laser scanner.
 *
 * Uses the browser's native `BarcodeDetector` when it exists (Android Chrome, Edge) and falls back
 * to ZXing, which is imported lazily so the ~200 kB decoder never lands in the POS bundle for the
 * cashiers who scan with a USB/PDA gun.
 */

/** Symbologies the co-op actually uses: EAN/UPC on goods, Code 39/128 on shelf and member labels. */
export const SCAN_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'codabar', 'qr_code'] as const;

interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
}
interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

function nativeDetector(): BarcodeDetectorCtor | null {
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return typeof ctor === 'function' ? ctor : null;
}

/** getUserMedia exists (it does not tell whether a camera is actually attached). */
export function cameraSupported(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
}

/** Browsers only hand out the camera on https (or localhost) — a plain LAN http:// URL cannot scan. */
export function cameraAllowedHere(): boolean {
  if (typeof window === 'undefined') return true;
  return window.isSecureContext || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
}

export type ScanErrorKind = 'permission' | 'notfound' | 'insecure' | 'unknown';

export class ScanError extends Error {
  constructor(readonly kind: ScanErrorKind, cause?: unknown) {
    super(`camera scan failed: ${kind}`);
    this.cause = cause;
  }
}

function classify(err: unknown): ScanErrorKind {
  const name = (err as { name?: string } | null)?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'permission';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'notfound';
  return 'unknown';
}

export interface CameraOption {
  deviceId: string;
  label: string;
}

/** Cameras the browser is willing to name. Labels stay empty until permission has been granted once. */
export async function listCameras(): Promise<CameraOption[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'videoinput')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
}

export interface ScannerControls {
  stop: () => void;
  /** Null when the camera has no torch (all iPads, most front cameras). */
  setTorch: ((on: boolean) => Promise<void>) | null;
  /** "native" = BarcodeDetector, "zxing" = the bundled fallback decoder. */
  engine: 'native' | 'zxing';
}

export interface StartOptions {
  deviceId?: string;
  /** Called for every decoded symbol; the caller decides what to do with repeats. */
  onCode: (code: string) => void;
  onError?: (err: ScanError) => void;
}

/** Opens the camera into `video` and decodes continuously until `stop()`. */
export async function startCameraScan(video: HTMLVideoElement, opts: StartOptions): Promise<ScannerControls> {
  if (!cameraAllowedHere()) throw new ScanError('insecure');
  if (!cameraSupported()) throw new ScanError('notfound');

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: opts.deviceId
        ? { deviceId: { exact: opts.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch (err) {
    throw new ScanError(classify(err), err);
  }

  video.srcObject = stream;
  video.setAttribute('playsinline', 'true'); // iOS would otherwise open the native full-screen player
  video.muted = true;
  try {
    await video.play();
  } catch {
    /* autoplay can be refused until the user taps; the frame loop simply waits */
  }

  const track = stream.getVideoTracks()[0];
  const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
  const setTorch = caps.torch
    ? async (on: boolean) => {
        await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
      }
    : null;

  const stopStream = () => {
    stream.getTracks().forEach((tr) => tr.stop());
    // only detach our own stream: React 18 mounts effects twice in dev, and the first run's
    // cleanup must not blank the element the second run just attached
    if (video.srcObject === stream) video.srcObject = null;
  };

  const Detector = nativeDetector();
  if (Detector) {
    const detector = new Detector({ formats: [...SCAN_FORMATS] });
    let raf = 0;
    let running = true;
    const tick = async () => {
      if (!running) return;
      try {
        if (video.readyState >= 2) {
          const found = await detector.detect(video);
          for (const b of found) if (b.rawValue) opts.onCode(b.rawValue);
        }
      } catch (err) {
        // a transient decode error must not kill the loop; a broken detector is reported once
        if ((err as { name?: string })?.name === 'InvalidStateError') {
          running = false;
          opts.onError?.(new ScanError('unknown', err));
          return;
        }
      }
      raf = window.requestAnimationFrame(() => void tick());
    };
    void tick();
    return {
      engine: 'native',
      setTorch,
      stop: () => {
        running = false;
        window.cancelAnimationFrame(raf);
        stopStream();
      },
    };
  }

  // ---- ZXing fallback (iPadOS/Safari, Firefox) ----
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
    import('@zxing/browser'),
    import('@zxing/library'),
  ]);
  const hints = new Map<number, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.EAN_13,
    BarcodeFormat.EAN_8,
    BarcodeFormat.UPC_A,
    BarcodeFormat.UPC_E,
    BarcodeFormat.CODE_128,
    BarcodeFormat.CODE_39,
    BarcodeFormat.ITF,
    BarcodeFormat.CODABAR,
    BarcodeFormat.QR_CODE,
  ]);
  const reader = new BrowserMultiFormatReader(hints as never, { delayBetweenScanAttempts: 120 });
  const controls = await reader.decodeFromStream(stream, video, (result) => {
    const text = result?.getText();
    if (text) opts.onCode(text);
  });

  return {
    engine: 'zxing',
    setTorch,
    stop: () => {
      controls.stop();
      stopStream();
    },
  };
}

/** Short confirmation beep — cashiers scan without looking at the screen. */
export function beep(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 1180;
    gain.gain.value = 0.06;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
    osc.onended = () => void ctx.close();
  } catch {
    /* audio is a nicety, never a failure */
  }
  try {
    navigator.vibrate?.(40);
  } catch {
    /* ignore */
  }
}
