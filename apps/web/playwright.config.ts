import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  outputDir: process.env.TRIPDOCK_BROWSER_BASELINE ? './test-results/baseline' : './test-results/current',
  use: { baseURL: 'http://127.0.0.1:3312', browserName: 'chromium', channel: 'chrome', locale: 'en-GB', reducedMotion: 'reduce', trace: 'retain-on-failure' },
  webServer: { command: 'node tests/browser/server.mjs', url: 'http://127.0.0.1:3312', reuseExistingServer: false },
});
