import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { fullNavigation } from './navigation-fixture';
import { telegramText as copy } from '@barghsa/i18n/telegram';
const uuid = '0199f111-1111-7111-8111-111111111111';
const url = 'https://t.me/barghsa_dev_bot?start=' + 'a'.repeat(43);
async function setup(page: Page, locale: 'en' | 'fa') {
  await setupCatalogueForms(page, locale, locale === 'fa');
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: 'owned-telegram-customer',
        isStaff: false,
        operatingContext: 'customer',
        canSwitchContext: false,
        requiresTosAcceptance: false,
        navigation: fullNavigation('customer', 'LEGAL'),
      },
    })
  );
  await page.route('**/api/auth/sessions', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/auth/trusted-devices', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/invitations/pending', (route) =>
    route.fulfill({ json: { invitations: [] } })
  );
  await page.route('**/api/v1/notifications**', (route) =>
    route.fulfill({ json: { data: [], next_cursor: null, unread_count: 0 } })
  );
  await page
    .context()
    .addCookies([
      { name: 'barghsa_csrf', value: 'owned-csrf', url: test.info().project.use.baseURL! },
    ]);
  const state = {
    available: true,
    profileId: uuid,
    link: null as unknown,
    intent: null as unknown,
    latestDelivery: null as unknown,
  };
  const requests: Array<{ method: string; body: unknown }> = [];
  let failure = false,
    denied = false;
  await page.route('**/api/telegram/link{,/confirm}', async (route) => {
    const req = route.request(),
      method = req.method();
    requests.push({ method, body: method === 'POST' ? req.postDataJSON() : null });
    if (method === 'GET')
      return route.fulfill({ status: denied ? 401 : 200, json: denied ? {} : state });
    expect(req.headers()['x-csrf-token']).toBe('owned-csrf');
    if (failure) return route.fulfill({ status: 503, json: {} });
    if (new URL(req.url()).pathname.endsWith('/confirm')) {
      expect(req.postDataJSON()).toEqual({ id: uuid, code: '123456' });
      state.link = { id: uuid, profile_id: uuid, telegram_user_id: '123' };
      state.intent = null;
      return route.fulfill({ json: state.link });
    }
    if (method === 'DELETE') {
      state.link = null;
      state.intent = null;
      return route.fulfill({ json: { revoked: true } });
    }
    state.intent = {
      id: uuid,
      status: 'claimed',
      telegram_user_id: '123',
      expires_at: '2030-01-01T00:00:00Z',
    };
    return route.fulfill({ json: { id: uuid, url } });
  });
  return {
    state,
    requests,
    fail() {
      failure = true;
    },
    deny() {
      denied = true;
    },
  };
}
for (const locale of ['en', 'fa'] as const) {
  test(`private Telegram settings confirm normalized code and unlink (${locale})`, async ({
    page,
  }, info) => {
    const f = await setup(page, locale);
    await page.goto('/settings/security');
    const panel = page.getByRole('region', { name: copy('title', locale), exact: true });
    await panel.getByRole('button', { name: copy('connect', locale), exact: true }).click();
    const link = panel.getByRole('link', { name: copy('open', locale), exact: true });
    await expect(link).toHaveAttribute('href', url);
    await expect(link).toHaveAttribute('referrerpolicy', 'no-referrer');
    const code = panel.getByLabel(copy('code', locale), { exact: true });
    await panel.getByRole('button', { name: copy('confirm', locale), exact: true }).click();
    await expect(code).toBeFocused();
    await expect(code).toHaveAttribute('aria-invalid', 'true');
    expect(f.requests.filter((r) => r.method === 'POST')).toHaveLength(1);
    await code.fill(locale === 'fa' ? '۱۲٣۴۵٦' : '123456');
    await expect(code).toHaveValue('123456');
    expect(
      (
        await new AxeBuilder({ page })
          .include('section[aria-labelledby]')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze()
      ).violations
    ).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await panel.screenshot({
      path: `test-results/telegram-claimed-${locale}-${info.project.name}.png`,
    });
    await panel.getByRole('button', { name: copy('confirm', locale), exact: true }).click();
    await expect(panel.getByRole('status')).toContainText(copy('linked', locale));
    await expect(code).toHaveCount(0);
    await expect(link).toHaveCount(0);
    await panel.getByRole('button', { name: copy('revoke', locale), exact: true }).click();
    await expect(panel.getByRole('status')).toHaveCount(0);
    expect(f.requests.filter((r) => r.method === 'DELETE')).toHaveLength(1);
  });
  test(`private Telegram settings retain unknown outcomes and retire denied state (${locale})`, async ({
    page,
  }, info) => {
    const f = await setup(page, locale);
    await page.goto('/settings/security');
    const panel = page.getByRole('region', { name: copy('title', locale), exact: true });
    f.fail();
    await panel.getByRole('button', { name: copy('connect', locale), exact: true }).click();
    await expect(panel.getByRole('alert')).toHaveText(copy('requestUnknown', locale));
    await expect(
      panel.getByRole('button', { name: copy('connect', locale), exact: true })
    ).toBeDisabled();
    expect(f.requests.filter((r) => r.method === 'POST')).toHaveLength(1);
    await panel.screenshot({
      path: `test-results/telegram-uncertain-${locale}-${info.project.name}.png`,
    });
    f.deny();
    await panel.getByRole('button', { name: copy('refresh', locale), exact: true }).click();
    await expect(panel.getByRole('button')).toHaveCount(0);
    await expect(panel.locator('input,a')).toHaveCount(0);
    expect(f.requests.filter((r) => r.method === 'POST')).toHaveLength(1);
  });
}
