/**
 * Contractor GenOffice — Browser E2E Tests (Phase 2C.5)
 *
 * Tests the full vertical slice through a real browser:
 *   login → tenant → projects → BOQ → estimate → finalize → bid → submit → outcome
 *
 * Runs against the real HTTP host (localhost:5179) + real PostgreSQL (Neon).
 * The browser dev server (localhost:5178) proxies /api/* to the host.
 * NO MOCKS — real CoreApi, real services, real repositories, real database.
 *
 * Prerequisites:
 *   1. Start the HTTP host: bun packages/web-host/src/dev-server.ts
 *   2. Start the browser dev server: cd apps/web && bun run dev
 *   3. Run: npx playwright test --config e2e/contractor/playwright.config.ts
 */

import { test, expect, type Page } from '@playwright/test'

/**
 * Helper: login as demo owner + select tenant.
 * Returns the page with the projects screen visible.
 */
async function loginAsOwner(page: Page): Promise<void> {
  await page.goto('/')
  // Wait for login screen
  await expect(page.locator('h1')).toContainText('Contractor GenOffice')
  // Click the Owner demo button
  await page.getByRole('button', { name: 'Owner' }).click()
  // Wait for tenant selection
  await expect(page.locator('h1')).toContainText('Select a workspace')
  // Click the first workspace
  await page.getByRole('button').filter({ hasText: 'Enter' }).first().click()
  // Wait for projects screen
  await expect(page.locator('h1')).toContainText('Projects')
}

test.describe('Contractor GenOffice browser E2E', () => {
  test('login → tenant → projects', async ({ page }) => {
    await loginAsOwner(page)
    // Verify projects screen is visible
    await expect(page.locator('h1')).toContainText('Projects')
  })

  test('create project + BOQ + estimate + finalize + bid + submit + outcome', async ({ page }) => {
    await loginAsOwner(page)

    // Create a project
    await page.getByPlaceholder('New project name').fill('E2E Browser Test')
    await page.getByRole('button', { name: 'Create project' }).click()
    await expect(page.getByText('E2E Browser Test')).toBeVisible()

    // Open the project
    await page.getByRole('button', { name: 'Open' }).click()
    await expect(page.locator('h1')).toContainText('Project')

    // Go to BOQ tab
    await page.getByRole('button', { name: 'BOQ' }).click()
    await page.getByPlaceholder('BOQ name (optional)').fill('Test BOQ')
    await page.getByRole('button', { name: 'Create BOQ' }).click()

    // Add a BOQ item
    await page.getByPlaceholder('Code').fill('1.1')
    await page.getByPlaceholder('Description').fill('Concrete')
    await page.getByPlaceholder('Unit').fill('m2')
    await page.getByPlaceholder('Qty').fill('100')
    await page.getByRole('button', { name: 'Add item' }).click()
    await expect(page.getByText('Concrete')).toBeVisible()

    // Go to Estimate tab
    await page.getByRole('button', { name: 'Estimate' }).click()
    await page.getByRole('button', { name: 'Create draft' }).click()
    await expect(page.getByText(/Revision \d+/)).toBeVisible()

    // Verify replay totals are displayed (from the server, NOT computed in browser)
    await expect(page.getByText('Authoritative totals')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Line cost')).toBeVisible()
    await expect(page.getByText('Sell price')).toBeVisible()

    // Finalize the estimate
    await page.getByRole('button', { name: 'Finalize estimate' }).click()
    await page.getByRole('button', { name: 'Confirm finalize' }).click()
    await expect(page.getByText('finalized')).toBeVisible({ timeout: 5000 })

    // Verify editing is disabled after finalization
    await expect(page.getByText('immutable')).toBeVisible()

    // Go to Bids tab
    await page.getByRole('button', { name: 'Bids' }).click()
    await page.getByPlaceholder('Final price (minor)').fill('70000')
    await page.getByRole('button', { name: 'Create draft bid' }).click()
    await expect(page.getByText('draft')).toBeVisible()

    // Submit the bid
    await page.getByRole('button', { name: 'Submit' }).click()
    await expect(page.getByText('submitted')).toBeVisible({ timeout: 5000 })

    // Record outcome
    await page.getByRole('button', { name: 'Won' }).click()
    await page.getByRole('button', { name: 'Confirm' }).click()
    await expect(page.getByText('won')).toBeVisible({ timeout: 5000 })
  })

  test('unauthenticated access redirects to login', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('h1')).toContainText('Contractor GenOffice')
    await expect(page.getByText('Development Environment')).toBeVisible()
  })

  test('logout clears session', async ({ page }) => {
    await loginAsOwner(page)
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page.locator('h1')).toContainText('Contractor GenOffice')
  })
})
