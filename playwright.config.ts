import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './src/test/e2e',
  // Failure screenshots and traces land beside the specs rather than in a
  // generated folder at the repo root. Dot-prefixed so editors and tools treat
  // it as the build output it is.
  outputDir: './src/test/e2e/.results',
  // Every spec drives real Electron processes that bind real TCP and UDP ports
  // and render on a real GPU. Running them concurrently makes window focus and
  // port allocation race, so the suite trades wall time for a signal that means
  // something when it goes red.
  workers: 1,
  fullyParallel: false,
  // A launch, a TLS handshake, and a password round trip do not fit in the
  // 30s default on a cold machine.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // A flake here is a bug report, not something to paper over. CI retries once
  // to distinguish "broken" from "flaky"; locally it never retries.
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  globalSetup: './src/test/e2e/globalSetup.ts',
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: './src/test/e2e/.report' }]]
    : [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
