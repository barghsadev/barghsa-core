import { test, expect, type Page } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import { giftCode } from '../src/test/gift-code-fixtures';
import { tGift } from '@barghsa/i18n/gifts';
import { t } from '@barghsa/i18n/admin-ui';
import AxeBuilder from '@axe-core/playwright';
async function setup(page: Page, locale: 'en' | 'fa') {
  await crmShell(page, locale);
  await page.route('**/api/public/branding/config', (route) =>
    route.fulfill({
      json: {
        appTitle: 'Barghsa',
        appTitleFa: 'برق‌آسا',
        supportEmail: 'support@example.test',
        supportPhone: '+982112345678',
        supportMobile: '+989121234567',
        slogan: '',
        primaryColor: '#2563eb',
        secondaryColor: '#64748b',
        accentColor: '#f59e0b',
        backgroundColor: '#f6f7f4',
        darkBackgroundColor: '#15201c',
        fontFamily: 'vazirmatn',
        borderRadiusRem: 0.75,
        spacingScale: 1,
        numberStyle: 'locale',
        logoUrl: null,
        faviconUrl: null,
        darkMode: locale === 'fa',
      },
    })
  );
  let current = giftCode(),
    failed = false;
  await page.route('**/api/admin/promotions/gift-codes**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') return route.fallback();
    if (path.endsWith('/profiles'))
      return route.fulfill({
        json: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            title: 'Customer One',
            profileType: 'LEGAL',
            archived: false,
          },
        ],
      });
    return route.fulfill({
      status: failed ? 503 : 200,
      json: path.endsWith('/stats')
        ? { code: current, perProfile: [], recentRedemptions: [] }
        : [current],
    });
  });
  const word = (key: string) => tGift(`admin.gifts.${key}`, locale);
  const confirm = () =>
    page.getByRole('dialog').getByRole('button', { name: t('team.confirm', locale), exact: true });
  await page.goto('/admin/gift-codes');
  await expect(
    page.getByRole('button', { name: `${word('edit')} CODE00`, exact: true })
  ).toBeVisible();
  return {
    word,
    confirm,
    save: (value: typeof current) => {
      current = value;
    },
    fail: (value: boolean) => {
      failed = value;
    },
  };
}
async function inspect(page: Page, locale: string, project: string, name: string) {
  expect((await new AxeBuilder({ page }).include('main > div').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (locale === 'fa' && project === 'chromium') {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page
      .getByRole('heading', { name: tGift('admin.gifts.title', 'fa'), exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `/Users/majid/.local/state/barghsa-manual-batches/gift-code-authoring/${name}-fa.png`,
      fullPage: true,
    });
  }
}
for (const locale of ['en', 'fa'] as const) {
  test(`gift creation validates raw input and captures exact IRR once (${locale})`, async ({
    page,
  }, info) => {
    const { word, confirm, save } = await setup(page, locale);
    const writes: Record<string, unknown>[] = [];
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(
      (url) => url.pathname === '/api/admin/promotions/gift-codes',
      async (route) => {
        if (route.request().method() === 'GET') return route.fallback();
        const body = route.request().postDataJSON();
        writes.push(body);
        await pending;
        const result = { ...giftCode(), ...body };
        save(result);
        await route.fulfill({ status: 201, json: result });
      }
    );
    await page.getByRole('button', { name: word('add'), exact: true }).click();
    const form = page.getByRole('form', { name: word('editor'), exact: true });
    const code = page.locator('#gift-code'),
      value = page.locator('#gift-value');
    await code.fill('   ');
    await value.fill('-1');
    await form.getByRole('button', { name: word('save'), exact: true }).click();
    await expect(code).toHaveAttribute('aria-invalid', 'true');
    await expect(value).toHaveAttribute('aria-invalid', 'true');
    await expect(code).toBeFocused();
    expect(writes).toHaveLength(0);
    await inspect(page, locale, info.project.name, 'validation');
    for (const invalidCode of ['A', '-SALE', 'SALE%']) {
      await code.fill(invalidCode);
      await form.getByRole('button', { name: word('save'), exact: true }).click();
      await expect(code).toHaveAttribute('aria-invalid', 'true');
      await expect(code).toBeFocused();
      expect(writes).toHaveLength(0);
    }
    await code.fill('  exact  ');
    await value.fill('۹۰۰۷۱۹۹۲۵۴۷۴۰۹۹۳');
    await page.locator('#gift-totalLimit').fill('٢');
    await page.locator('#gift-minimum').fill('۰۰');
    await form.evaluate((node) => {
      node.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      node.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await expect(page.getByRole('dialog')).toContainText('EXACT');
    await confirm().click();
    await expect.poll(() => writes.length).toBe(1);
    await expect(code).toBeDisabled();
    const refreshButtons = page.getByRole('button', {
      name: word('refresh'),
      exact: true,
      includeHidden: true,
    });
    await expect(refreshButtons).toHaveCount(2);
    for (const button of await refreshButtons.all()) await expect(button).toBeDisabled();
    await page
      .getByRole('dialog')
      .locator('form')
      .evaluate((node) =>
        node.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      );
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      code: 'EXACT',
      discountValue: '9007199254740993',
      totalLimit: 2,
      minOrderAmount: '0',
    });
    release();
    await expect(page.getByText(word('saved'), { exact: true })).toBeVisible();
    await expect(form).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: `${word('edit')} EXACT`, exact: true })
    ).toBeEnabled();
    await inspect(page, locale, info.project.name, 'creation');
  });
  test(`gift editing rejects percentage rounding and preserves an unconfirmed draft (${locale})`, async ({
    page,
  }, info) => {
    const { word, confirm, save, fail } = await setup(page, locale);
    await page.getByRole('button', { name: `${word('edit')} CODE00`, exact: true }).click();
    const form = page.getByRole('form', { name: word('editor'), exact: true });
    await page.locator('#gift-type').selectOption('percentage');
    const value = page.locator('#gift-value'),
      cap = page.locator('#gift-cap');
    await value.fill('1.005');
    await cap.fill('1000');
    await form.getByRole('button', { name: word('save'), exact: true }).click();
    await expect(value).toHaveAttribute('aria-invalid', 'true');
    await expect(value).toBeFocused();
    await value.fill('۱۲٫۳۴');
    await cap.fill('۹۰۰۷۱۹۹۲۵۴۷۴۰۹۹۳');
    await page.locator('#gift-eligibility').selectOption('profile');
    await form.getByRole('button', { name: word('save'), exact: true }).click();
    const profiles = page.locator('#gift-profileIds');
    await expect(profiles).toHaveAttribute('aria-invalid', 'true');
    await expect(profiles).toBeFocused();
    await form.getByRole('checkbox', { name: /Customer One/ }).check();
    await expect(profiles).not.toHaveAttribute('aria-invalid', 'true');
    const writes: Record<string, unknown>[] = [];
    await page.route(`**/api/admin/promotions/gift-codes/${giftCode().id}`, async (route) => {
      const body = route.request().postDataJSON();
      writes.push(body);
      if (writes.length === 1)
        return route.fulfill({
          status: 400,
          json: {
            error: {
              code: 'VALIDATION:INPUT:INVALID',
              fields: ['discountValue', 'privateUnknown'],
            },
          },
        });
      if (writes.length === 2) {
        fail(true);
        return route.fulfill({ json: { ...giftCode(), ...body, discountValue: '1235' } });
      }
      const result = { ...giftCode(), ...body };
      save(result);
      return route.fulfill({ json: result });
    });
    await form.getByRole('button', { name: word('save'), exact: true }).click();
    await confirm().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(value).toHaveValue('۱۲٫۳۴');
    await expect(cap).toHaveValue('۹۰۰۷۱۹۹۲۵۴۷۴۰۹۹۳');
    await expect(value).toHaveAttribute('aria-invalid', 'true');
    await expect(value).toBeFocused();
    await value.fill(' 12.34 ');
    await form.getByRole('button', { name: word('save'), exact: true }).click();
    await confirm().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText(word('uncertain'), { exact: true })).toBeVisible();
    const resume = page.getByRole('button', { name: word('resumeEditing'), exact: true });
    await expect(resume).toBeDisabled();
    await expect(value).toHaveValue(' 12.34 ');
    await expect(value).toBeDisabled();
    expect(writes).toHaveLength(2);
    fail(false);
    await page.getByRole('button', { name: word('refresh'), exact: true }).click();
    await expect(resume).toBeEnabled();
    expect(writes).toHaveLength(2);
    await resume.click();
    await expect(value).toBeEnabled();
    await form.getByRole('button', { name: word('save'), exact: true }).click();
    await confirm().click();
    await expect(page.getByText(word('saved'), { exact: true })).toBeVisible();
    expect(writes).toHaveLength(3);
    expect(writes[2]).toMatchObject({
      discountType: 'percentage',
      discountValue: '1234',
      maxCapIrr: '9007199254740993',
    });
    await inspect(page, locale, info.project.name, 'editing');
  });
}
