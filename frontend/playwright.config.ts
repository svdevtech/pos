import { defineConfig, devices } from '@playwright/test';
import { QR_VIDEO } from './tests/global-setup';

export default defineConfig({
  testDir: './tests/e2e',
  // renders the QR video the camera project plays into the browser
  globalSetup: './tests/global-setup.ts',
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3010',
    trace: 'on-first-retry',
    locale: 'th-TH',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /camera\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        // a fake camera so the barcode-scanner dialog can be exercised headlessly
        permissions: ['camera'],
        launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
      },
    },
    {
      // same browser, but the fake camera plays a real QR code instead of the rolling test pattern
      name: 'chromium-camera',
      testMatch: /camera\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['camera'],
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-video-capture=${QR_VIDEO}`,
          ],
        },
      },
    },
  ],
  webServer: {
    command: 'npm run dev -- -p 3010',
    url: 'http://localhost:3010/login',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
