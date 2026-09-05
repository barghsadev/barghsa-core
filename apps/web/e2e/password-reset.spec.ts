import { test, expect } from '@playwright/test'

for (const locale of ['fa', 'en'] as const) {
  test(`password recovery submits the issued challenge and clears secrets (${locale})`, async ({ page }) => {
    const challengeId = '00000000-0000-4000-8000-000000000001'
    await page.route('**/api/auth/forgot-password', route => route.fulfill({ json: { sent: true, challengeId } }))
    await page.route('**/api/auth/reset-password', route => route.fulfill({ json: { message: 'ok' } }))
    await page.goto('/forgot-password')
    await page.evaluate(value => { document.documentElement.lang = value }, locale)
    await page.locator('#username').fill('Recovery@Example.test')
    const issued = page.waitForRequest('**/api/auth/forgot-password')
    await page.locator('button[type="submit"]').click()
    expect((await issued).postDataJSON()).toEqual({ username: 'recovery@example.test' })
    await page.locator('#reset-otp').fill(locale === 'fa' ? '۱۲۳۴۵۶' : '123456')
    await page.locator('#new-password').fill('New-browser-password-123!')
    await page.locator('#confirm-password').fill('Does-not-match-123!')
    await page.locator('button[type="submit"]').click()
    await expect(page.getByRole('alert')).toContainText(locale === 'fa' ? 'یکسان نیستند' : 'do not match')
    await page.locator('#confirm-password').fill('New-browser-password-123!')
    const reset = page.waitForRequest('**/api/auth/reset-password')
    await page.locator('button[type="submit"]').click()
    expect((await reset).postDataJSON()).toEqual({ challengeId, otp: '123456', newPassword: 'New-browser-password-123!' })
    await expect(page.getByRole('status')).toContainText(locale === 'fa' ? 'وارد شوید' : 'Sign in')
    await expect(page.locator('#reset-otp')).toHaveCount(0)
    expect(page.url()).not.toContain('123456')
    expect(await page.evaluate(() => JSON.stringify(sessionStorage))).not.toContain('123456')
  })
}

test('rejected reset leaves the form usable and does not claim success', async ({ page }) => {
  await page.route('**/api/auth/forgot-password', route => route.fulfill({ json: { sent: true, challengeId: '00000000-0000-4000-8000-000000000001' } }))
  await page.route('**/api/auth/reset-password', route => route.fulfill({ status: 401, json: { error: { code: 'AUTH:OTP:INVALID' } } }))
  await page.goto('/forgot-password')
  await page.locator('#username').fill('recovery@example.test')
  await page.locator('button[type="submit"]').click()
  await page.locator('#reset-otp').fill('123456')
  await page.locator('#new-password').fill('New-browser-password-123!')
  await page.locator('#confirm-password').fill('New-browser-password-123!')
  await page.locator('button[type="submit"]').click()
  await expect(page.getByRole('alert')).toContainText('نامعتبر')
  await expect(page.locator('#reset-otp')).toBeEnabled()
})
