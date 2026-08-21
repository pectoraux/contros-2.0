import { test, expect, type Page } from '@playwright/test'

async function loginAsOwner(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Owner' })).toBeVisible({ timeout: 5000 })
  await page.getByRole('button', { name: 'Owner' }).click()
  // Wait for tenant selection screen
  await expect(page.getByText('Select a workspace')).toBeVisible({ timeout: 5000 })
  await page.locator('button:has-text("Enter")').first().click()
  // Wait for the Projects heading to appear in the main content area
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible({ timeout: 15000 })
}

test.describe('Contractor GenOffice browser E2E', () => {
  test('login → tenant → projects', async ({ page }) => {
    await loginAsOwner(page)
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  })

  test('create project + BOQ + estimate + finalize + bid + submit + outcome', async ({ page }) => {
    await loginAsOwner(page)
    await page.getByPlaceholder('New project name').fill('E2E Browser Test')
    await page.getByRole('button', { name: 'Create project' }).click()
    // Wait for the Open button to appear (project was created + list refreshed)
    await expect(page.getByRole('button', { name: 'Open' }).first()).toBeVisible({ timeout: 10000 })
    await page.getByRole('button', { name: 'Open' }).first().click()
    await expect(page.getByRole('button', { name: 'Overview' })).toBeVisible({ timeout: 5000 })
    await page.getByRole('button', { name: 'BOQ' }).click()
    await page.getByPlaceholder('BOQ name (optional)').fill('Test BOQ')
    await page.getByRole('button', { name: 'Create BOQ' }).click()
    // Wait for BOQ to appear in list, then click to select it
    await page.waitForTimeout(3000)
    // The BOQ buttons show last 8 chars of boqId (not "Create BOQ")
    // Click any button in the BOQs card that's not "Create BOQ"
    const allButtons = page.getByRole('button')
    const count = await allButtons.count()
    for (let i = 0; i < count; i++) {
      const text = await allButtons.nth(i).textContent()
      if (text && text !== 'Create BOQ' && text !== 'Open' && text !== 'Projects' && text !== 'BOQ' && text !== 'Estimate' && text !== 'Bids' && text !== 'Overview' && text !== 'Sign out' && text.length < 20) {
        await allButtons.nth(i).click()
        break
      }
    }
    await page.waitForTimeout(2000)
    // Wait for the BOQ item form to appear
    await expect(page.getByPlaceholder('Code')).toBeVisible({ timeout: 10000 })
    await page.getByPlaceholder('Code').fill('1.1')
    await page.getByPlaceholder('Description').fill('Concrete')
    await page.getByPlaceholder('Unit').fill('m2')
    await page.getByPlaceholder('Qty').fill('100')
    await page.getByRole('button', { name: 'Add item' }).click()
    await expect(page.getByText('Concrete')).toBeVisible({ timeout: 5000 })
    await page.getByRole('button', { name: 'Estimate' }).click()
    await page.getByRole('button', { name: 'Create draft' }).click()
    await expect(page.getByText(/Revision \d+/)).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Authoritative totals')).toBeVisible({ timeout: 5000 })
    await page.getByRole('button', { name: 'Finalize estimate' }).click()
    await page.getByRole('button', { name: 'Confirm finalize' }).click()
    await expect(page.getByText('finalized')).toBeVisible({ timeout: 5000 })
    await page.getByRole('button', { name: 'Bids' }).click()
    await page.getByPlaceholder('Final price (minor)').fill('70000')
    await page.getByRole('button', { name: 'Create draft bid' }).click()
    await expect(page.getByText('draft')).toBeVisible({ timeout: 5000 })
    await page.getByRole('button', { name: 'Submit' }).click()
    await expect(page.getByText('submitted')).toBeVisible({ timeout: 5000 })
    await page.getByRole('button', { name: 'Won' }).click()
    await page.getByRole('button', { name: 'Confirm' }).click()
    await expect(page.getByText('won')).toBeVisible({ timeout: 5000 })
  })

  test('unauthenticated shows login', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Contractor GenOffice' })).toBeVisible({ timeout: 5000 })
  })

  test('logout clears session', async ({ page }) => {
    await loginAsOwner(page)
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page.getByRole('heading', { name: 'Contractor GenOffice' })).toBeVisible({ timeout: 5000 })
  })
})
