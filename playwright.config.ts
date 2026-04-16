import { defineConfig, devices } from '@playwright/test';

/**
 * E2E tests against the Vite dev server (http://localhost:5433) which proxies
 * /admin/api/* to the wrangler dev Worker (http://localhost:9321).
 *
 * Start both before running:
 *   pnpm dev          → wrangler + vite
 *
 * Or let Playwright start them via webServer (see below).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: process.env['CI'] ? 2 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5433',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
