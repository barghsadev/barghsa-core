import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from './coverage-fixture';
import { t } from '@barghsa/i18n/app';
import { fullNavigation } from './navigation-fixture';

type Mode = 'simple' | 'advanced';
type Locale = 'en' | 'fa';
const profileId = '11111111-1111-4111-8111-111111111111';
const receipt = {
  orderId: '66666666-6666-4666-8666-666666666666',
  contractId: '77777777-7777-4777-8777-777777777777',
  invoiceId: '88888888-8888-4888-8888-888888888888',
};
const address = {
  id: '22222222-2222-4222-8222-222222222222',
  profileId,
  provinceId: '33333333-3333-4333-8333-333333333333',
  cityId: '44444444-4444-4444-8444-444444444444',
  fullAddress: 'Saved Power Street',
  postalCode: '1234567890',
  mainAddress: true,
};
const products = (['thermal', 'green', 'free_market', 'energy_saving'] as const).map(
  (systemKey, index) => ({
    id: `${index + 5}5555555-5555-4555-8555-555555555555`,
    systemKey,
    title: { en: systemKey, fa: `برق ${systemKey}` },
    description: null,
    status: 'active',
    price: '100000',
    orderable: true,
    simpleOrderable: index === 0,
    simpleOrderBlockReasons: [],
    limits: { minKwh: '0', maxKwh: '10000' },
  })
);
const startAt = '2026-10-04T10:00:00.000Z';
const endAt = '2026-10-11T10:00:00.000Z';
const path = (mode: Mode) => (mode === 'simple' ? '/electricity/order' : '/electricity/advanced');
const field = (page: Page, mode: Mode) =>
  page.locator(mode === 'simple' ? '#electricity-kwh' : '#advanced-thermal');

for (const locale of ['en', 'fa'] as const)
  test(`simple electricity dependent address recovery keeps the draft city (${locale})`, async ({
    page,
  }) => {
    const state = await fixture(page, 'simple', locale, 4);
    const provinceId = '99999999-9999-4999-8999-999999999999';
    const cityId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    let valid = false;
    const writes: Record<string, unknown>[] = [];
    await page.route('**/api/geography/provinces', (route) =>
      route.fulfill({ json: [{ id: provinceId, nameFa: 'فارس', nameEn: 'Fars' }] })
    );
    await page.route(`**/api/geography/provinces/${provinceId}/cities`, (route) =>
      route.fulfill({
        status: valid ? 200 : 503,
        json: [{ id: cityId, provinceId, nameFa: 'شیراز', nameEn: 'Shiraz' }],
      })
    );
    await page.route(`**/api/profiles/${profileId}/addresses`, (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      const body = route.request().postDataJSON();
      writes.push(body);
      return route.fulfill({
        json: { id: receipt.invoiceId, profileId, ...body, mainAddress: false },
      });
    });
    await page.goto('/electricity/order?step=4');
    await page
      .getByRole('button', { name: t('electricity.order.addNewAddress', locale), exact: true })
      .click();
    await page.locator('#order-address-province').selectOption(provinceId);
    const city = page.locator('#order-address-city');
    await expect(city).toBeDisabled();
    const error = page
      .getByRole('alert')
      .filter({ hasText: t('electricity.order.cityLoadFailed', locale) });
    await expect(error).toBeVisible();
    await page.locator('#order-address-fullAddress').fill('Retained power address');
    await page.locator('#order-address-postalCode').fill('2345678901');
    valid = true;
    await error.getByRole('button').click();
    await city.selectOption(cityId);
    await expect(page.locator('#order-address-fullAddress')).toHaveValue('Retained power address');
    await page
      .getByRole('button', { name: t('electricity.order.saveAndUse', locale), exact: true })
      .click();
    await expect(city).toHaveCount(0);
    expect(writes).toEqual([
      { provinceId, cityId, fullAddress: 'Retained power address', postalCode: '2345678901' },
    ]);
    expect(state.orders).toHaveLength(0);
  });

async function fixture(page: Page, mode: Mode, locale: Locale, step = 2) {
  const state = {
    draft: {
      currentStep: step,
      data:
        mode === 'simple'
          ? { period: 'next_week', totalKwh: '100', addressId: address.id }
          : {
              startAt,
              endAt,
              quantities: { thermal: '100', green: '0', free_market: '0', energy_saving: '0' },
              addressId: address.id,
            },
    } as { currentStep: number; data: Record<string, unknown> },
    saves: [] as Array<{ currentStep: number; data: Record<string, unknown> }>,
    orders: [] as Record<string, unknown>[],
    saveMismatch: false,
    saveStatus: 200,
    saveGate: null as Promise<void> | null,
    orderGate: null as Promise<void> | null,
    invalidOrder: false,
  };
  await page.clock.setFixedTime(new Date('2026-10-02T10:00:00.000Z'));
  await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
  await page.route('**/api/**', (r) => r.fulfill({ status: 404, json: {} }));
  await page.route('**/api/public/branding/config', (r) =>
    r.fulfill({
      json: {
        appTitle: 'Barghsa',
        appTitleFa: 'برق‌آسا',
        supportEmail: 'support@example.test',
        supportPhone: '+982112345678',
        supportMobile: '+989121234567',
        backgroundColor: '#f6f7f4',
        darkBackgroundColor: '#15201c',
        fontFamily: 'vazirmatn',
        borderRadiusRem: 0.75,
        spacingScale: 1,
        numberStyle: 'locale',
        slogan: '',
        primaryColor: '#0d6d48',
        secondaryColor: '#64748b',
        accentColor: '#f59e0b',
        logoUrl: null,
        faviconUrl: null,
        darkMode: locale === 'fa',
      },
    })
  );
  await page.route('**/api/auth/user', (r) =>
    r.fulfill({
      json: {
        isStaff: false,
        userId: 'buyer',
        requiresTosAcceptance: false,
        navigation: { ...fullNavigation('customer', 'LEGAL'), profileId },
      },
    })
  );
  await page.route('**/api/invitations/pending', (r) => r.fulfill({ json: { invitations: [] } }));
  await page.route('**/api/user/settings/timezone', (r) =>
    r.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
  await page.route('**/api/profiles', (r) =>
    r.fulfill({
      json: {
        profiles: [
          {
            id: profileId,
            profileType: 'LEGAL',
            title: 'Buyer',
            status: 'ACTIVE',
            isDefault: true,
          },
        ],
        activeProfileId: profileId,
        hasDefault: true,
      },
    })
  );
  await page.route('**/api/profiles/verification-status', (r) =>
    r.fulfill({
      json: {
        activeProfileId: profileId,
        profileStatus: 'ACTIVE',
        verificationRequired: true,
        isVerified: true,
      },
    })
  );
  await page.route('**/api/products/electricity', (r) => r.fulfill({ json: products }));
  await page.route(`**/api/profiles/${profileId}/addresses`, (r) =>
    r.fulfill({ json: { addresses: [address] } })
  );
  await page.route('**/api/geography/provinces', (r) =>
    r.fulfill({ json: [{ id: address.provinceId, nameFa: 'تهران', nameEn: 'Tehran' }] })
  );
  await page.route(`**/api/geography/provinces/${address.provinceId}/cities`, (r) =>
    r.fulfill({
      json: [
        { id: address.cityId, provinceId: address.provinceId, nameFa: 'تهران', nameEn: 'Tehran' },
      ],
    })
  );
  await page.route('**/api/electricity/periods/simple', (r) =>
    r.fulfill({
      json: {
        periods: [
          'current_month',
          'next_month',
          'current_week',
          'next_week',
          'week_after_next',
        ].map((key) => ({ key, start: startAt, end: endAt })),
      },
    })
  );
  await page.route('**/api/electricity/periods/advanced', (r) =>
    r.fulfill({
      json: { limits: { leadTimeDays: 0, maxContractDuration: 24 }, mandatoryGreenEnabled: true },
    })
  );
  await page.route(`**/api/electricity/bill-data/${profileId}?*`, (r) =>
    r.fulfill({ json: { available: false, reason: 'unconfigured', manualEntryAllowed: true } })
  );
  await page.route(`**/api/wallet/${profileId}`, (r) =>
    r.fulfill({ json: { balance: '20000000', currency: 'IRR' } })
  );
  await page.route(`**/api/electricity/drafts/${mode}?*`, (r) => {
    if (r.request().method() === 'DELETE') {
      state.draft = {
        currentStep: 1,
        data:
          mode === 'simple'
            ? { period: 'next_week', totalKwh: '', addressId: '' }
            : { startAt, endAt, quantities: {}, addressId: '' },
      };
      return r.fulfill({ json: { discarded: true, profileId, mode } });
    }
    return r.fulfill({ json: state.draft });
  });
  await page.route(`**/api/electricity/drafts/${mode}`, async (r) => {
    const input = r.request().postDataJSON();
    state.saves.push(input);
    await state.saveGate;
    if (state.saveStatus !== 200) return r.fulfill({ status: state.saveStatus, json: {} });
    if (state.saveMismatch)
      return r.fulfill({ json: { currentStep: input.currentStep, data: {} } });
    state.draft = input;
    return r.fulfill({
      json: {
        currentStep: input.currentStep,
        data: input.data,
        updatedAt: '2026-10-02T10:00:00.000Z',
      },
    });
  });
  await page.route(`**/api/electricity/preview/${mode}`, (r) => {
    const input = r.request().postDataJSON();
    const quantity = input.totalKwh ?? input.quantities.thermal;
    return r.fulfill({
      json: {
        reviewDigest: 'a'.repeat(64),
        periodStart: startAt,
        periodEnd: endAt,
        durationHours: '168',
        totalKwh: quantity,
        averagePowerKw: '0.6',
        greenRuleApplies: false,
        mandatoryGreenEnabled: true,
        walletBalanceIrR: '20000000',
        lines: [
          {
            productId: products[0]!.id,
            systemKey: 'thermal',
            quantityKwh: quantity,
            unitPriceIrR: '100000',
            subtotalIrR: '10000000',
            discountIrR: '0',
            vatIrR: '0',
            totalIrR: '10000000',
          },
        ],
        subtotalIrR: '10000000',
        discountIrR: '0',
        vatIrR: '0',
        totalIrR: '10000000',
      },
    });
  });
  await page.route(`**/api/electricity/orders/${mode}`, async (r) => {
    state.orders.push(r.request().postDataJSON());
    await state.orderGate;
    return r.fulfill({
      status: 201,
      json: state.invalidOrder ? { orderId: receipt.orderId } : receipt,
    });
  });
  return state;
}
const button = (page: Page, key: Parameters<typeof t>[0], locale: Locale) =>
  page.getByRole('button', { name: t(key, locale), exact: true });
async function leave(page: Page, locale: Locale) {
  const menu = page.getByRole('button', { name: locale === 'fa' ? 'فهرست' : 'Menu', exact: true });
  if ((await menu.isVisible()) && (await menu.getAttribute('aria-expanded')) === 'false')
    await menu.click();
  await page.locator('#dashboard-navigation a[href="/electricity"]').click();
}
function controls(page: Page, locale: Locale) {
  const dialog = page.getByRole('dialog');
  const action = (key: Parameters<typeof t>[0]) =>
    dialog.getByRole('button', { name: t(key, locale), exact: true });
  return {
    dialog,
    save: action('electricity.order.unsaved.saveAndLeave'),
    stay: action('electricity.order.unsaved.stay'),
    discard: action('electricity.order.unsaved.leave'),
  };
}

for (const locale of ['en', 'fa'] as const)
  for (const mode of ['simple', 'advanced'] as const) {
    test(`${mode} validates blurred quantities with linked localized feedback and preserves corrections (${locale})`, async ({
      page,
    }) => {
      const state = await fixture(page, mode, locale);
      await page.goto(`${path(mode)}?step=2`);
      const quantity = field(page, mode);
      await expect(quantity).toHaveValue('100');
      await quantity.fill('0');
      await quantity.blur();
      await expect(quantity).toHaveAttribute('aria-invalid', 'true');
      const errorId = await quantity.getAttribute('aria-describedby');
      expect(errorId).toBeTruthy();
      await expect(
        page
          .locator('[id]')
          .filter({ hasText: t('electricity.order.quantityInvalid', locale) })
          .first()
      ).toBeVisible();
      const feedback = page
        .locator('[id]')
        .filter({ hasText: t('electricity.order.quantityInvalid', locale) });
      expect(
        await feedback.evaluateAll(
          (nodes, ids) => nodes.some((node) => ids.split(' ').includes(node.id)),
          errorId!
        )
      ).toBe(true);
      await expect(button(page, 'electricity.order.next', locale)).toBeDisabled();
      await quantity.fill('120');
      await expect(quantity).not.toHaveAttribute('aria-invalid', 'true');
      await button(page, 'electricity.order.next', locale).click();
      await expect(page).toHaveURL(/step=3$/);
      expect(state.saves.at(-1)?.data[mode === 'simple' ? 'totalKwh' : 'quantities']).toEqual(
        mode === 'simple' ? '120' : expect.objectContaining({ thermal: '120' })
      );
      await button(page, 'electricity.order.back', locale).click();
      await expect(quantity).toHaveValue('120');
    });

    test(`${mode} restores safe steps and browser history without dropping fields (${locale})`, async ({
      page,
    }) => {
      const state = await fixture(page, mode, locale);
      await page.goto(`${path(mode)}?step=2`);
      await expect(field(page, mode)).toHaveValue('100');
      await field(page, mode).fill('120');
      await button(page, 'electricity.order.next', locale).click();
      await expect(page).toHaveURL(new RegExp(`${path(mode)}\\?step=3$`));
      await page.goBack();
      await expect(field(page, mode)).toHaveValue('120');
      await page.goForward();
      await expect(page).toHaveURL(/\?step=3$/);
      await page.reload();
      await expect(page.locator('li[aria-current="step"]')).toContainText(
        t(mode === 'simple' ? 'electricity.order.step3' : 'electricity.advanced.stepPrice', locale)
      );
      await page.goto(`${path(mode)}?step=5`);
      await expect(page).toHaveURL(/\?step=3$/);
      state.saveStatus = 503;
      await button(page, 'electricity.order.back', locale).click();
      await expect(page).toHaveURL(/\?step=3$/);
      await expect(
        page.getByText(t('electricity.order.draftSaveFailed', locale), { exact: true })
      ).toBeVisible();
      await page.goto(`${path(mode)}?step=garbage`);
      await expect(page).toHaveURL(/\?step=1$/);
      await expect(page.locator('li[aria-current="step"]')).toContainText(
        t(mode === 'simple' ? 'electricity.order.step1' : 'electricity.advanced.stepDates', locale)
      );
      await page.goto(`${path(mode)}?step=2`);
      await expect(field(page, mode)).toHaveValue('120');
    });

    test(`${mode} leaves only after a confirmed save and supports explicit discard (${locale})`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      const state = await fixture(page, mode, locale);
      await page.goto(`${path(mode)}?step=2`);
      await expect(field(page, mode)).toHaveValue('100');
      await field(page, mode).fill('120');
      await leave(page, locale);
      const actions = controls(page, locale);
      await expect(actions.dialog).toBeVisible();
      await expect(actions.dialog).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
      await expect(page.locator('html')).toHaveClass(locale === 'fa' ? /dark/ : /^(?!.*dark)/);
      if (locale === 'fa')
        await page.screenshot({
          path: `/tmp/barghsa-electricity-${mode}-fa-dialog.png`,
          fullPage: true,
        });

      expect(
        (await new AxeBuilder({ page }).include('[data-slot="dialog-content"]').analyze())
          .violations
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      await actions.stay.click();
      await expect(field(page, mode)).toHaveValue('120');
      state.saveMismatch = true;
      await leave(page, locale);
      await actions.save.click();
      await expect(actions.dialog.getByRole('alert')).toBeVisible();
      await expect(page).toHaveURL(/\?step=2$/);
      state.saveMismatch = false;
      let finish!: () => void;
      state.saveGate = new Promise((resolve) => {
        finish = resolve;
      });
      await context.addCookies([
        { name: 'barghsa_csrf', value: 'current-draft-token', url: 'http://127.0.0.1:4173' },
      ]);
      const request = page.waitForRequest(
        (r) => r.method() === 'PUT' && r.url().includes(`/electricity/drafts/${mode}`)
      );
      await actions.save.click();
      expect((await request).headers()['x-csrf-token']).toBe('current-draft-token');
      await expect(actions.save).toBeDisabled();
      await expect(actions.discard).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(actions.dialog).toBeVisible();
      expect(state.saves).toHaveLength(2);
      finish();
      await expect(page).toHaveURL(/\/electricity$/);
      expect(
        mode === 'simple'
          ? state.draft.data.totalKwh
          : (state.draft.data.quantities as Record<string, string>).thermal
      ).toBe('120');
      await page.goto(`${path(mode)}?step=2`);
      await expect(field(page, mode)).toHaveValue('120');
      await field(page, mode).fill('140');
      await leave(page, locale);
      await actions.discard.click();
      await expect(page).toHaveURL(/\/electricity$/);
      expect(state.saves).toHaveLength(2);
      await page.goto(`${path(mode)}?step=2`);
      await expect(field(page, mode)).toHaveValue('120');
    });

    test(`${mode} protects a clean draft during submission and retries the same order (${locale})`, async ({
      page,
    }) => {
      const state = await fixture(page, mode, locale, 5);
      state.invalidOrder = true;
      let finish!: () => void;
      state.orderGate = new Promise((resolve) => {
        finish = resolve;
      });
      await page.goto(`${path(mode)}?step=5`);
      const submit = button(page, 'electricity.order.submit', locale);
      await expect(submit).toBeEnabled();
      await submit.click();
      await leave(page, locale);
      const actions = controls(page, locale);
      await expect(actions.dialog).toBeVisible();
      await expect(actions.save).toBeDisabled();
      await expect(actions.discard).toBeDisabled();
      await actions.stay.click();
      expect(state.orders).toHaveLength(1);
      finish();
      await expect(submit).toBeEnabled();
      await expect(page).toHaveURL(/\?step=5$/);
      state.invalidOrder = false;
      await submit.click();
      await expect(page).toHaveURL(new RegExp(`/electricity/orders/${receipt.orderId}$`));
      expect(state.orders).toHaveLength(2);
      expect(state.orders[1]!.idempotencyKey).toBe(state.orders[0]!.idempotencyKey);
      await expect(page.getByRole('dialog')).not.toBeVisible();
    });
  }

for (const locale of ['en', 'fa'] as const)
  test(`simple ordering protects an unfinished new address (${locale})`, async ({ page }) => {
    const state = await fixture(page, 'simple', locale, 4);
    await page.goto('/electricity/order?step=4');
    await button(page, 'electricity.order.addAddress', locale).click();
    await page.locator('#order-address-fullAddress').fill('Unfinished address');
    await leave(page, locale);
    const actions = controls(page, locale);
    await expect(actions.dialog).toBeVisible();
    await expect(actions.save).toBeDisabled();
    await expect(actions.dialog.getByRole('alert')).toHaveText(
      t('electricity.order.unsaved.address', locale)
    );
    await actions.stay.click();
    await expect(page.locator('#order-address-fullAddress')).toHaveValue('Unfinished address');
    await leave(page, locale);
    await actions.discard.click();
    await expect(page).toHaveURL(/\/electricity$/);
    expect(state.saves).toHaveLength(0);
  });

test('simple order submission waits for the financial review code to load', async ({ page }) => {
  await fixture(page, 'simple', 'en', 5);
  const output = process.env['BARGHSA_BROWSER_COVERAGE'] === '1' ? 'dist-coverage' : 'dist';
  const manifest = JSON.parse(
    readFileSync(new URL(`../${output}/.vite/manifest.json`, import.meta.url), 'utf8')
  ) as Record<string, { file: string }>;
  const asset = manifest['src/components/SimpleElectricityReview.tsx']!.file;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = 0;
  await page.route(`**/${asset}`, async (r) => {
    requested++;
    await gate;
    await r.continue();
  });
  try {
    await page.goto('/electricity/order?step=5', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => requested).toBe(1);
    await expect(button(page, 'electricity.order.submit', 'en')).not.toBeVisible();
    await expect(
      page.getByRole('status').filter({ hasText: t('electricity.order.previewLoading', 'en') })
    ).toBeVisible();
  } finally {
    release();
  }
  await expect(page.getByRole('region', { name: 'Review Order', exact: true })).toBeVisible();
  await expect(button(page, 'electricity.order.submit', 'en')).toBeEnabled();
});

for (const locale of ['en', 'fa'] as const)
  for (const mode of ['simple', 'advanced'] as const) {
    test(`${mode} final review keeps inputs read-only and preserves review on failed edits (${locale})`, async ({
      page,
    }) => {
      const state = await fixture(page, mode, locale, 5);
      await page.goto(`${path(mode)}?step=5`);
      const sections = page.locator('[data-review-section]');
      await expect(sections).toHaveCount(7);
      await expect(sections.locator('input,select,textarea')).toHaveCount(0);
      await expect(page.locator('[data-review-section=address]')).toContainText(
        address.fullAddress
      );
      const quantity = page.locator(
        `[data-review-section=${mode === 'simple' ? 'quantity' : 'products'}]`
      );
      state.saveStatus = 503;
      await quantity.getByRole('button').click();
      await expect(
        page.getByText(t('electricity.order.draftSaveFailed', locale), { exact: true })
      ).toBeVisible();
      await expect(page).toHaveURL(/step=5$/);
      await expect(quantity).toBeVisible();
      state.saveStatus = 200;
      await quantity.getByRole('button').click();
      await expect(page).toHaveURL(/step=2$/);
      await expect(field(page, mode)).toHaveValue('100');
      await field(page, mode).fill('120');
      await button(page, 'electricity.order.next', locale).click();
      await button(page, 'electricity.order.next', locale).click();
      await expect(
        page.locator(mode === 'simple' ? `#order-address-${address.id}` : 'input[name="addressId"]')
      ).toBeChecked();
      await button(page, 'electricity.order.next', locale).click();
      await expect(page).toHaveURL(/step=5$/);
      await expect(
        page.locator(`[data-review-section=${mode === 'simple' ? 'quantity' : 'products'}]`)
      ).toContainText(locale === 'fa' ? '۱۲۰' : '120');
      expect(state.orders).toHaveLength(0);
      expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true);
      await page.locator('[data-review-section=address]').getByRole('button').click();
      await expect(page).toHaveURL(/step=4$/);
      await expect(
        page.locator(mode === 'simple' ? `#order-address-${address.id}` : 'input[name="addressId"]')
      ).toBeChecked();
    });
  }

for (const locale of ['en', 'fa'] as const)
  for (const mode of ['simple', 'advanced'] as const) {
    test(`${mode} explicitly deletes persisted private progress only after server confirmation (${locale})`, async ({
      page,
      context,
    }) => {
      const state = await fixture(page, mode, locale);
      await page.goto(`${path(mode)}?step=2`);
      await field(page, mode).fill('130');
      await leave(page, locale);
      const action = page.getByRole('button', {
        name: t('electricity.order.unsaved.discardSaved', locale),
        exact: true,
      });
      await context.addCookies([
        { name: 'barghsa_csrf', value: 'discard-token', url: 'http://127.0.0.1:4173' },
      ]);
      let fail = true;
      await page.route(`**/api/electricity/drafts/${mode}?*`, (r) =>
        r.request().method() === 'DELETE' && fail
          ? r.fulfill({ status: 503, json: {} })
          : r.fallback()
      );
      await action.click();
      await expect(controls(page, locale).dialog.getByRole('alert')).toBeVisible();
      await expect(field(page, mode)).toHaveValue('130');
      expect(state.orders).toHaveLength(0);
      fail = false;
      const request = page.waitForRequest(
        (r) =>
          r.method() === 'DELETE' &&
          r.url().includes(`/electricity/drafts/${mode}?profileId=${profileId}`)
      );
      await action.click();
      expect((await request).headers()['x-csrf-token']).toBe('discard-token');
      await expect(page).toHaveURL(/\/electricity$/);
      expect(state.draft.currentStep).toBe(1);
      expect(state.saves).toHaveLength(0);
      expect(state.orders).toHaveLength(0);
    });
  }
