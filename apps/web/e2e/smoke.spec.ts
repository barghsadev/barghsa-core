import { test, expect } from './fixtures'

test.describe('Application smoke tests', () => {
  test('home page loads and displays the app title', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Barghsa' })).toBeVisible()
    await expect(
      page.getByText('Iranian electricity market intelligence platform'),
    ).toBeVisible()
  })

  test('application has a valid HTML structure', async ({ page }) => {
    await page.goto('/')
    // Verify the RTL document direction
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(page.locator('html')).toHaveAttribute('lang', 'fa')

    // Root mounting point exists
    const root = page.locator('#root')
    await expect(root).toBeVisible()
    // The React app should have rendered content inside #root
    await expect(root.locator('h1')).toHaveCount(1)
  })

  test('fixture provides an isolated test identity', async ({ identity }) => {
    // The identity prefix must be unique per test run (used to scope seed data)
    expect(identity).toMatch(/^e2e-test-/)
    expect(identity.length).toBeGreaterThan('e2e-test-'.length)
  })
})