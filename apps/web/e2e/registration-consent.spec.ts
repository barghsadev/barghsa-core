import { test, expect } from '@playwright/test'

// Client contract checks; real publication/acceptance is covered by the API HTTP suite.
test('registration shows and submits the same terms version', async ({ page }) => {
  const id = '00000000-0000-4000-8000-000000000001'
  let reads = 0
  await page.route('**/api/tos/current?*', route => {
    reads++
    return route.fulfill({ json: { id, versionId: 'consent-v1', content: 'قوانین اول نمایش داده شده' } })
  })
  await page.route('**/api/auth/register', route => route.fulfill({ status: 400, json: { error: 'AUTH:REGISTER:TOS_NOT_ACCEPTED' } }))
  await page.goto('/register')
  await page.locator('#username').fill('consent@example.test')
  await page.locator('#username').press('Tab')
  await page.locator('#password').fill('Browser-consent-password-123!')
  const initialReads = reads
  await page.locator('#tos-label button').click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('قوانین اول نمایش داده شده')
  await expect(dialog).toContainText('consent-v1')
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(page.locator('#tos-label button')).toBeFocused()
  await page.getByRole('checkbox').click()
  const request = page.waitForRequest('**/api/auth/register')
  await page.locator('button[type="submit"]').click()
  expect((await request).postDataJSON().tosVersionId).toBe(id)
  expect(reads).toBe(initialReads)
})

test('unavailable terms prevent consent and registration', async ({ page }) => {
  await page.route('**/api/tos/current?*', route => route.fulfill({ status: 503, json: {} }))
  await page.goto('/register')
  await expect(page.getByRole('checkbox')).toBeDisabled()
  await expect(page.locator('button[type="submit"]')).toBeDisabled()
  await expect(page.getByRole('alert')).toBeVisible()
})
