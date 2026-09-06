import { test, expect, type Page } from '@playwright/test'

const profile = (id: string) => ({ id, profileType: 'LEGAL', isDefault: false, status: 'ACTIVE', title: id, firstName: null, lastName: null, nationalId: null })
async function shell(page: Page) {
  await page.route('**/api/**', route => route.fulfill({ status: 404, json: {} }))
  await page.route('**/api/invitations/pending', route => route.fulfill({ json: { invitations: [] } }))
  await page.route('**/api/v1/notifications**', route => route.fulfill({ json: { data: [], unread_count: 0 } }))
}
for (const locale of ['fa', 'en'] as const) {
  test(`selecting the only remaining profile clears old page data (${locale})`, async ({ page }) => {
    await shell(page)
    await page.addInitScript(value => {
      new MutationObserver(() => { if (document.documentElement) document.documentElement.lang = value }).observe(document, { childList: true })
    }, locale)
    let active: string | null = null
    let dashboardReads = 0
    await page.route('**/api/profiles', route => route.fulfill({ json: { profiles: [profile('remaining')], activeProfileId: active, hasDefault: active !== null } }))
    await page.route('**/api/dashboard', route => {
      dashboardReads++
      return route.fulfill({ json: { wallet: { balance: active ? 987654 : 123456, currency: 'IRR', lowBalanceWarning: false }, activeOrders: 0, pendingInvoices: 0, openTickets: 0, contracts: { active: 0, total: 0 } } })
    })
    await page.route('**/api/profiles/switch/remaining', route => {
      expect(route.request().method()).toBe('POST')
      active = 'remaining'
      return route.fulfill({ json: { activeProfileId: active } })
    })
    await page.goto('/dashboard')
    const selector = page.getByRole('combobox', { name: locale === 'fa' ? 'تغییر پروفایل فعال' : 'Switch active profile' })
    await expect(selector).toHaveValue('')
    await expect(page.locator('main')).toContainText('۱۲۳٬۴۵۶')
    await page.evaluate(() => { (window as unknown as Record<string,unknown>).profileSwitchDocument = 'preserved' })
    let documentRequests = 0
    page.on('request', request => { if (request.resourceType() === 'document') documentRequests++ })
    await selector.selectOption('remaining')
    await expect(page.locator('main')).toContainText('۹۸۷٬۶۵۴')
    await expect(page.locator('main')).not.toContainText('۱۲۳٬۴۵۶')
    await expect(page.getByRole('combobox')).toHaveCount(0)
    expect(dashboardReads).toBeGreaterThanOrEqual(2)
    expect(documentRequests).toBe(0)
    expect(await page.evaluate(() => (window as unknown as Record<string,unknown>).profileSwitchDocument)).toBe('preserved')
  })
}

test('a failed switch keeps the existing selection and reports the error', async ({ page }) => {
  await shell(page)
  await page.route('**/api/profiles', route => route.fulfill({ json: { profiles: [profile('first'), profile('second')], activeProfileId: 'first', hasDefault: true } }))
  await page.route('**/api/profiles/switch/second', route => route.fulfill({ status: 403, json: { error: 'forbidden' } }))
  await page.goto('/dashboard')
  await page.getByRole('combobox').selectOption('second')
  await expect(page.getByRole('combobox')).toHaveValue('first')
  await expect(page.getByRole('alert')).toBeVisible()
})

test('the initial radio selection submits from the required profile dialog', async ({ page }) => {
  await shell(page)
  let active: string | null = null
  await page.route('**/api/profiles', route => route.fulfill({ json: { profiles: [profile('first'), profile('second')], activeProfileId: active, hasDefault: active !== null } }))
  await page.route('**/api/profiles/switch/first', route => {
    active = 'first'
    return route.fulfill({ json: { activeProfileId: active } })
  })
  await page.goto('/dashboard')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const switched = page.waitForRequest('**/api/profiles/switch/first')
  await dialog.getByRole('button').click()
  await switched
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('combobox')).toHaveValue('first')
})

test('switching refreshes another open tab without reloading either document', async ({ context }) => {
  let active = 'first'
  const pages = await Promise.all([context.newPage(), context.newPage()])
  for (const page of pages) {
    await shell(page)
    await page.route('**/api/profiles', route => route.fulfill({ json: { profiles: [profile('first'), profile('second')], activeProfileId: active, hasDefault: true } }))
    await page.route('**/api/dashboard', route => route.fulfill({ json: { wallet: { balance: active === 'first' ? 123456 : 987654, currency: 'IRR', lowBalanceWarning: false }, activeOrders: 0, pendingInvoices: 0, openTickets: 0, contracts: { active: 0, total: 0 } } }))
    await page.goto('/dashboard')
    await expect(page.locator('main')).toContainText('۱۲۳٬۴۵۶')
    await page.evaluate(() => { (window as unknown as Record<string,unknown>).profileSwitchDocument = 'preserved' })
  }
  await pages[0]!.route('**/api/profiles/switch/second', route => {
    active = 'second'
    return route.fulfill({ json: { activeProfileId: active } })
  })
  await pages[0]!.getByRole('combobox').selectOption('second')
  for (const page of pages) {
    await expect(page.getByRole('combobox')).toHaveValue('second')
    await expect(page.locator('main')).toContainText('۹۸۷٬۶۵۴')
    await expect(page.locator('main')).not.toContainText('۱۲۳٬۴۵۶')
    expect(await page.evaluate(() => (window as unknown as Record<string,unknown>).profileSwitchDocument)).toBe('preserved')
  }
})

test('late old-profile responses cannot overwrite the switched page or notification count', async ({ page }) => {
  await shell(page)
  let active = 'first'
  let releaseOld!: () => void
  const oldReleased = new Promise<void>(resolve => { releaseOld = resolve })
  let oldReads = 0
  await page.route('**/api/profiles', route => route.fulfill({ json: { profiles: [profile('first'), profile('second')], activeProfileId: active, hasDefault: true } }))
  await page.route('**/api/dashboard', async route => {
    const requestedProfile = active
    if (requestedProfile === 'first') { oldReads++; await oldReleased }
    await route.fulfill({ json: { wallet: { balance: requestedProfile === 'first' ? 123456 : 987654, currency: 'IRR', lowBalanceWarning: false }, activeOrders: 0, pendingInvoices: 0, openTickets: 0, contracts: { active: 0, total: 0 } } })
  })
  await page.route('**/api/v1/notifications**', async route => {
    const requestedProfile = active
    if (requestedProfile === 'first') { oldReads++; await oldReleased }
    await route.fulfill({ json: { data: [], unread_count: requestedProfile === 'first' ? 19 : 3 } })
  })
  await page.route('**/api/profiles/switch/second', route => {
    active = 'second'
    return route.fulfill({ json: { activeProfileId: active } })
  })
  try {
    await page.goto('/dashboard')
    await expect.poll(() => oldReads).toBeGreaterThanOrEqual(3)
    await page.getByRole('combobox').selectOption('second')
    await expect(page.locator('main')).toContainText('۹۸۷٬۶۵۴')
    await expect(page.getByTestId('notification-bell').getByRole('status')).toHaveText('3')
    const settled = page.waitForResponse(response => response.url().endsWith('/api/dashboard'))
    releaseOld()
    await settled
    await expect(page.locator('main')).toContainText('۹۸۷٬۶۵۴')
    await expect(page.locator('main')).not.toContainText('۱۲۳٬۴۵۶')
    await expect(page.getByTestId('notification-bell').getByRole('status')).toHaveText('3')
  } finally { releaseOld() }
})
