import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from './coverage-fixture';
import { t } from '@barghsa/i18n/app';
import { tSaving } from '@barghsa/i18n/saving';
import { tSolar } from '@barghsa/i18n/solar';
import { fullNavigation } from './navigation-fixture';

type Mode = 'saving' | 'solar';
type Locale = 'en' | 'fa';
const profileId = '11111111-1111-4111-8111-111111111111';
const planId = '22222222-2222-4222-8222-222222222222';
const hardwareId = '33333333-3333-4333-8333-333333333333';
const address = {
  id: '44444444-4444-4444-8444-444444444444',
  fullAddress: 'Saved Site Street',
  postalCode: '1234567890',
  mainAddress: true,
};
const receiptId = '66666666-6666-4666-8666-666666666666';
const path = (mode: Mode) => (mode === 'saving' ? '/savings/order' : '/solar/requests/new');
const solarData = {
  buildingType: 'non_household',
  propertyForm: 'apartment',
  structuralFrame: 'concrete',
  buildingCompletionDate: '',
  totalUnits: '',
  siteCategory: 'industrial',
  installationSurface: 'rooftop',
  usableAreaSqm: '250',
  siteAddressId: address.id,
  siteRelationship: 'owner',
  siteDescription: 'Survey pending',
  gridType: 'off_grid',
  billIdentifier: '',
};
const savingData = {
  planId,
  hardwareId,
  billIdentifier: '1234567890123',
  addressId: address.id,
  giftCode: '',
};
const button = (page: Page, key: Parameters<typeof t>[0], locale: Locale) =>
  page.getByRole('button', { name: t(key, locale), exact: true });

async function fixture(page: Page, mode: Mode, locale: Locale, savedStep = 1) {
  const state = {
    draft: { currentStep: savedStep, data: mode === 'solar' ? solarData : savingData } as {
      currentStep: number;
      data: Record<string, unknown>;
    },
    saves: [] as Record<string, unknown>[],
    orders: [] as Record<string, unknown>[],
    reviews: [] as Record<string, unknown>[],
    mismatch: false,
    saveStatus: 200,
    saveGate: null as Promise<void> | null,
    orderGate: null as Promise<void> | null,
    reviewGate: null as Promise<void> | null,
    badReview: false,
    invalidOrder: false,
  };
  await page.clock.setFixedTime(new Date('2026-10-02T10:00:00Z'));
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
        navigation: { ...fullNavigation('customer', 'INDIVIDUAL'), profileId },
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
            profileType: 'INDIVIDUAL',
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

  await page.route(`**/api/profiles/${profileId}/addresses`, (r) =>
    r.fulfill({ json: { addresses: [address] } })
  );
  await page.route('**/api/saving/plans', (r) =>
    r.fulfill({
      json: {
        plans: [
          {
            id: planId,
            title: { en: 'Home plan', fa: 'طرح خانه' },
            description: null,
            price: '100000',
            status: 'active',
            available: true,
            hardware: [
              {
                id: hardwareId,
                title: { en: 'Device', fa: 'دستگاه' },
                description: null,
                price: '200000',
                status: 'active',
              },
            ],
            agreement: {
              versionId: '55555555-5555-4555-8555-555555555555',
              title: 'Terms',
              body: 'Plan terms',
            },
          },
        ],
      },
    })
  );
  const endpoint = mode === 'saving' ? '/api/saving/orders/draft' : '/api/solar/requests/draft';
  await page.route(`**${endpoint}?*`, async (r) => {
    if (r.request().method() !== 'PUT') return r.fulfill({ json: state.draft });
    const input = r.request().postDataJSON();
    state.saves.push(input);
    await state.saveGate;
    if (state.saveStatus !== 200) return r.fulfill({ status: state.saveStatus, json: {} });
    if (state.mismatch) return r.fulfill({ json: { ...input, data: {} } });
    state.draft = input;
    return r.fulfill({ json: { ...input, updatedAt: '2026-10-02T10:00:00Z' } });
  });
  await page.route('**/api/saving/orders/duplicate', (r) =>
    r.fulfill({ json: { duplicate: false, existingOrderId: null } })
  );
  await page.route('**/api/saving/orders/verify-bill', (r) =>
    r.fulfill({ json: { status: 'verified' } })
  );
  await page.route('**/api/saving/orders/quote', (r) =>
    r.fulfill({
      json: {
        reviewDigest: 'a'.repeat(64),
        subtotalIrR: '300000',
        discountIrR: '0',
        vatIrR: '0',
        totalIrR: '300000',
        lines: [
          {
            type: 'plan',
            title: { en: 'Plan', fa: 'طرح' },
            amountIrR: '100000',
            discountIrR: '0',
            vatIrR: '0',
          },
        ],
      },
    })
  );
  await page.route(`**/api/wallet/${profileId}`, (r) =>
    r.fulfill({ json: { availableBalance: '500000' } })
  );
  await page.route('**/api/solar/requests/review', async (r) => {
    const input = r.request().postDataJSON();
    state.reviews.push(input);
    await state.reviewGate;
    return r.fulfill({
      json: {
        hash: 'b'.repeat(64),
        data: {
          submission: state.badReview ? { ...input, profileId: receiptId } : input,
          siteAddress: address.fullAddress,
          agreementVersion: 'solar-construction-request-v1',
          agreementText: 'شرایط ثبت قرارداد را می‌پذیرم.',
          createsContract: false,
          createsInvoice: false,
        },
      },
    });
  });
  await page.route(
    mode === 'saving' ? '**/api/saving/orders' : '**/api/solar/requests',
    async (r) => {
      if (r.request().method() !== 'POST') return r.fulfill({ json: { requests: [] } });
      state.orders.push(r.request().postDataJSON());
      await state.orderGate;
      return r.fulfill({
        status: 201,
        json:
          mode === 'saving'
            ? { savingOrderId: state.invalidOrder ? 'invalid' : receiptId }
            : { requestId: state.invalidOrder ? 'invalid' : receiptId },
      });
    }
  );
  return state;
}
const input = (page: Page, mode: Mode, locale: Locale) =>
  mode === 'solar'
    ? page.locator('#solar-area')
    : page.getByLabel(tSaving('billIdentifier', locale), { exact: true });
async function open(page: Page, mode: Mode, locale: Locale) {
  await page.goto(path(mode));
  if (mode === 'saving') {
    await button(page, 'electricity.order.next', locale).click();
    await page.getByLabel(tSaving('confirmHardware', locale), { exact: true }).check();
    await button(page, 'electricity.order.next', locale).click();
  }
  await expect(input(page, mode, locale)).toBeVisible();
}
async function leave(page: Page, mode: Mode) {
  await page
    .locator(`main a[href="${mode === 'saving' ? '/savings' : '/solar/requests'}"]`)
    .last()
    .click();
}
const dialogButton = (page: Page, key: Parameters<typeof t>[0], locale: Locale) =>
  page.getByRole('dialog').getByRole('button', { name: t(key, locale), exact: true });
async function review(page: Page, mode: Mode, locale: Locale) {
  await open(page, mode, locale);
  await button(page, 'electricity.order.next', locale).click();
  if (mode === 'saving') {
    await button(page, 'electricity.order.next', locale).click();
    await page.getByLabel(tSaving('acceptAgreement', locale), { exact: true }).check();
    await button(page, 'electricity.order.next', locale).click();
    await page.getByLabel(tSaving('submitForReview', locale), { exact: true }).check();
  } else {
    await button(page, 'electricity.order.next', locale).click();
    await page.getByLabel(tSolar('agreement', locale), { exact: true }).check();
    await button(page, 'electricity.order.next', locale).click();
  }
}

for (const mode of ['saving', 'solar'] as const)
  for (const locale of ['en', 'fa'] as const) {
    test(`${mode} keeps saved values across history and renews consent on reload (${locale})`, async ({
      page,
    }) => {
      const state = await fixture(page, mode, locale, mode === 'saving' ? 6 : 4);
      await page.goto(`${path(mode)}?step=${mode === 'saving' ? 6 : 4}`);
      await expect(page).toHaveURL(new RegExp(`step=${mode === 'saving' ? 2 : 3}$`));
      const consent = page.getByLabel(
        mode === 'saving' ? tSaving('confirmHardware', locale) : tSolar('agreement', locale),
        { exact: true }
      );
      await expect(consent).not.toBeChecked();
      await button(page, 'electricity.order.back', locale).click();
      await expect(page).toHaveURL(new RegExp(`step=${mode === 'saving' ? 1 : 2}$`));
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`step=${mode === 'saving' ? 2 : 3}$`));
      await page.goForward();
      await page.reload();
      await expect(page).toHaveURL(new RegExp(`step=${mode === 'saving' ? 1 : 2}$`));
      expect(state.saves.at(-1)?.currentStep).toBe(mode === 'saving' ? 1 : 2);
      await page.goto(`${path(mode)}?step=4.5`);
      await expect(page).toHaveURL(/step=1$/);
    });
    test(`${mode} refuses mismatched Save and leave receipts and preserves edits (${locale})`, async ({
      page,
      context,
    }) => {
      const state = await fixture(page, mode, locale);
      await open(page, mode, locale);
      state.mismatch = true;
      const value = mode === 'saving' ? '9876543210123' : '275';
      await input(page, mode, locale).fill(value);
      await leave(page, mode);
      await expect(page.getByRole('dialog')).toBeVisible();
      await context.addCookies([
        { name: 'barghsa_csrf', value: 'rotated', url: 'http://127.0.0.1:4173' },
      ]);
      const saving = page.waitForRequest((r) => r.method() === 'PUT');
      await dialogButton(page, 'electricity.order.unsaved.saveAndLeave', locale).click();
      expect((await saving).headers()['x-csrf-token']).toBe('rotated');
      await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
      await expect(page).toHaveURL(new RegExp(path(mode)));
      await dialogButton(page, 'electricity.order.unsaved.stay', locale).click();
      await expect(input(page, mode, locale)).toHaveValue(value);
      state.mismatch = false;
      await leave(page, mode);
      await dialogButton(page, 'electricity.order.unsaved.saveAndLeave', locale).click();
      await expect(page).toHaveURL(
        new RegExp(`${mode === 'saving' ? '/savings' : '/solar/requests'}$`)
      );
      expect(state.draft.data[mode === 'saving' ? 'billIdentifier' : 'usableAreaSqm']).toBe(value);
    });
    test(`${mode} locks Save and leave until its single write completes (${locale})`, async ({
      page,
    }) => {
      const state = await fixture(page, mode, locale);
      await open(page, mode, locale);
      await input(page, mode, locale).fill(mode === 'saving' ? '9876543210123' : '275');
      await leave(page, mode);
      let finish!: () => void;
      state.saveGate = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const before = state.saves.length;
      await dialogButton(page, 'electricity.order.unsaved.saveAndLeave', locale).click();
      await expect.poll(() => state.saves.length).toBe(before + 1);
      await expect(
        dialogButton(page, 'electricity.order.unsaved.saveAndLeave', locale)
      ).toBeDisabled();
      await expect(dialogButton(page, 'electricity.order.unsaved.stay', locale)).toBeDisabled();
      await expect(dialogButton(page, 'electricity.order.unsaved.leave', locale)).toBeDisabled();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeVisible();
      finish();
      await expect(page).toHaveURL(
        new RegExp(`${mode === 'saving' ? '/savings' : '/solar/requests'}$`)
      );
      expect(state.saves.length).toBe(before + 1);
    });
    test(`${mode} validates final receipts and keeps the retry key (${locale})`, async ({
      page,
    }) => {
      const state = await fixture(page, mode, locale);
      await review(page, mode, locale);
      await expect(page.locator('li[aria-current="step"]')).toContainText(
        mode === 'saving' ? (locale === 'fa' ? '۶.' : '6.') : '4.'
      );
      const submit = page.getByRole('button', {
        name: mode === 'saving' ? tSaving('submit', locale) : tSolar('submit', locale),
        exact: true,
      });
      state.invalidOrder = true;
      await submit.click();
      await expect(page.getByRole('alert')).toContainText(
        mode === 'saving' ? tSaving('orderError', locale) : tSolar('submitError', locale)
      );
      state.invalidOrder = false;
      await submit.click();
      await expect(page).toHaveURL(
        new RegExp(`${mode === 'saving' ? '/savings/orders' : '/solar/requests'}/${receiptId}$`)
      );
      expect(state.orders).toHaveLength(2);
      expect(state.orders[1]).toEqual(state.orders[0]);
    });
    test(`${mode} fits the mobile viewport and has no serious accessibility findings (${locale})`, async ({
      page,
    }, testInfo) => {
      await fixture(page, mode, locale);
      await open(page, mode, locale);
      await expect(page.locator('main [dir]').first()).toHaveAttribute(
        'dir',
        locale === 'fa' ? 'rtl' : 'ltr'
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true);
      const results = await new AxeBuilder({ page }).include('main').analyze();
      expect(
        results.violations.filter((item) => ['serious', 'critical'].includes(item.impact ?? ''))
      ).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`${mode}-${locale}.png`), fullPage: true });
    });
  }

test('solar rejects an authoritative review for another profile', async ({ page }) => {
  const state = await fixture(page, 'solar', 'en');
  state.badReview = true;
  await open(page, 'solar', 'en');
  await button(page, 'electricity.order.next', 'en').click();
  await button(page, 'electricity.order.next', 'en').click();
  await page.getByLabel(tSolar('agreement', 'en'), { exact: true }).check();
  await button(page, 'electricity.order.next', 'en').click();
  await expect(page.getByRole('alert')).toContainText(tSolar('submitError', 'en'));
  await expect(page).toHaveURL(/step=3$/);
  expect(state.orders).toHaveLength(0);
});

test('saving does not claim an unfinished new address was saved', async ({ page }) => {
  await fixture(page, 'saving', 'en');
  await open(page, 'saving', 'en');
  await button(page, 'electricity.order.next', 'en').click();
  await page.getByRole('button', { name: tSaving('newAddress', 'en'), exact: true }).click();
  await page.getByLabel(tSaving('fullAddress', 'en'), { exact: true }).fill('Unfinished address');
  await leave(page, 'saving');
  await expect(dialogButton(page, 'electricity.order.unsaved.saveAndLeave', 'en')).toBeDisabled();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    t('electricity.order.unsaved.address', 'en')
  );
  await dialogButton(page, 'electricity.order.unsaved.stay', 'en').click();
  await expect(page.getByLabel(tSaving('fullAddress', 'en'), { exact: true })).toHaveValue(
    'Unfinished address'
  );
  await page.evaluate(() => window.history.back());
  await expect(page).toHaveURL(/step=3$/);
  await expect(
    page.getByRole('alert').filter({ hasText: t('electricity.order.unsaved.address', 'en') })
  ).toBeVisible();
  await page.getByRole('button', { name: tSaving('stepAddress', 'en'), exact: true }).click();
  await expect(page).toHaveURL(/step=4$/);
  await expect(page.getByLabel(tSaving('fullAddress', 'en'), { exact: true })).toHaveValue(
    'Unfinished address'
  );
  await button(page, 'electricity.order.cancel', 'en').click();
  await button(page, 'electricity.order.next', 'en').click();
  await expect(page).toHaveURL(/step=5$/);
});

for (const mode of ['saving', 'solar'] as const)
  test(`${mode} protects browser Back while the final command is pending`, async ({ page }) => {
    const state = await fixture(page, mode, 'en');
    await review(page, mode, 'en');
    let finish!: () => void;
    state.orderGate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    await page
      .getByRole('button', {
        name: mode === 'saving' ? tSaving('submit', 'en') : tSolar('submit', 'en'),
        exact: true,
      })
      .click();
    await expect.poll(() => state.orders.length).toBe(1);
    await page.evaluate(() => window.history.back());
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(dialogButton(page, 'electricity.order.unsaved.leave', 'en')).toBeDisabled();
    await expect(dialogButton(page, 'electricity.order.unsaved.saveAndLeave', 'en')).toBeDisabled();
    finish();
    await expect(page).toHaveURL(
      new RegExp(`${mode === 'saving' ? '/savings/orders' : '/solar/requests'}/${receiptId}$`)
    );
    expect(state.orders).toHaveLength(1);
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

test('solar keeps departure blocked while its authoritative review is pending', async ({
  page,
}) => {
  const state = await fixture(page, 'solar', 'en');
  await open(page, 'solar', 'en');
  await button(page, 'electricity.order.next', 'en').click();
  await button(page, 'electricity.order.next', 'en').click();
  await page.getByLabel(tSolar('agreement', 'en'), { exact: true }).check();
  let finish!: () => void;
  state.reviewGate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await button(page, 'electricity.order.next', 'en').click();
  await expect.poll(() => state.reviews.length).toBe(1);
  await leave(page, 'solar');
  await expect(dialogButton(page, 'electricity.order.unsaved.leave', 'en')).toBeDisabled();
  await dialogButton(page, 'electricity.order.unsaved.stay', 'en').click();
  finish();
  await expect(page).toHaveURL(/step=4$/);
  await expect(
    page.getByRole('button', { name: tSolar('submit', 'en'), exact: true })
  ).toBeEnabled();
  expect(state.orders).toHaveLength(0);
});

for (const locale of ['en', 'fa'] as const)
  for (const mode of ['saving', 'solar'] as const) {
    test(`${mode} final sections save before editing and refresh the reviewed input (${locale})`, async ({
      page,
    }) => {
      const state = await fixture(page, mode, locale);
      await review(page, mode, locale);
      const final = mode === 'saving' ? 6 : 4;
      const sections = page.locator('[data-review-section]');
      await expect(sections).toHaveCount(mode === 'saving' ? 7 : 3);
      await expect(sections.locator('input,select,textarea')).toHaveCount(0);
      const section = page.locator(
        `[data-review-section=${mode === 'saving' ? 'bill' : 'property'}]`
      );
      state.saveStatus = 503;
      await section.getByRole('button').click();
      await expect(page).toHaveURL(new RegExp(`step=${final}$`));
      await expect(
        page
          .getByRole('alert')
          .filter({
            hasText:
              mode === 'saving'
                ? tSaving('draftSaveError', locale)
                : tSolar('draftSaveError', locale),
          })
          .first()
      ).toBeVisible();
      state.saveStatus = 200;
      await section.getByRole('button').click();
      if (mode === 'saving') {
        await expect(page).toHaveURL(/step=3$/);
        await input(page, mode, locale).fill('1234567890999');
        await button(page, 'electricity.order.next', locale).click();
        await button(page, 'electricity.order.next', locale).click();
        const gift = page.getByLabel(tSaving('giftCode', locale), { exact: true });
        await gift.fill('SAVED');
        await expect(button(page, 'electricity.order.next', locale)).toBeDisabled();
        await page.getByRole('button', { name: tSaving('apply', locale), exact: true }).click();
        await button(page, 'electricity.order.next', locale).click();
        await expect(page.locator('[data-review-section=bill]')).toContainText('1234567890999');
        await expect(page.locator('[data-review-section=gift]')).toContainText('SAVED');
        await expect(
          page.getByRole('textbox', { name: tSaving('giftCode', locale), exact: true })
        ).not.toBeVisible();
      } else {
        await expect(page).toHaveURL(/step=1$/);
        await page
          .getByRole('textbox', { name: tSolar('description', locale), exact: true })
          .fill('Updated survey');
        await button(page, 'electricity.order.next', locale).click();
        await button(page, 'electricity.order.next', locale).click();
        await button(page, 'electricity.order.next', locale).click();
        await expect(page.locator('[data-review-section=property]')).toContainText(
          'Updated survey'
        );
        expect(state.reviews).toHaveLength(2);
      }
      expect(state.orders).toHaveLength(0);
      expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true);
      if (mode === 'saving' && locale === 'fa')
        await page.screenshot({
          path: `/tmp/barghsa-wizard-review-saving-fa-${test.info().project.name}.png`,
          fullPage: true,
        });
    });
  }
