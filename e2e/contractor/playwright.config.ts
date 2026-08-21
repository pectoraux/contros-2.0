import { defineConfig } from '@playwright/test'

/**
 * E2E config for the Contractor GenOffice browser app.
 * Tests run against a real browser + real HTTP host + real PostgreSQL.
 * NOT the Electron shell — this is the web browser slice.
 */
export default defineConfig({
  testDir: '.',
  outputDir: './test-results',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5178',
    headless: true,
  },
})
