import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e/dashboard',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'node tests/e2e/dashboard/serve-dashboard.mjs',
    url: 'http://127.0.0.1:4173/dashboard',
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
});
