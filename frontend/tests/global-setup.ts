import { resolve } from 'node:path';
import { makeQrVideo } from './fixtures/qr-video';

/** The QR code the fake camera shows in camera.spec.ts. */
export const QR_CODE = 'QR-TESTCODE-001';
export const QR_VIDEO = resolve(__dirname, 'fixtures/qr-scan.y4m');

/** Renders the fake-camera video once per run. */
export default function globalSetup(): void {
  makeQrVideo(QR_VIDEO, QR_CODE);
}
