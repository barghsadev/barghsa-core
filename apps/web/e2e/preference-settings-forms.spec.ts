import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import type { Page, Route, Locator } from '@playwright/test';
import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { fullNavigation } from './navigation-fixture';
import { t } from '@barghsa/i18n/app';
import { timezoneText } from '@barghsa/i18n/timezone';
import { shellText } from '@barghsa/i18n/shell';
import { tPreferenceSettingsForms as copy } from '@barghsa/i18n/preference-settings-forms';
type Locale = 'en' | 'fa';
const profileId = '10000000-0000-4000-8000-000000000002';
const action = (page: Page, locale: Locale, key: string) =>
  page.getByRole('button', { name: copy(key, locale), exact: true });
async function setup(page: Page, locale: Locale) {
  await setupCatalogueForms(page, locale, locale === 'fa');
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: 'preference/customer:opaque',
        isStaff: false,
        operatingContext: 'customer',
        canSwitchContext: false,
        requiresTosAcceptance: false,
        navigation: { ...fullNavigation('customer', 'LEGAL'), profileId },
      },
    })
  );
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        profiles: [
          {
            id: profileId,
            profileType: 'LEGAL',
            title: 'Preferences',
            isDefault: true,
            status: 'ACTIVE',
          },
        ],
        activeProfileId: profileId,
        hasDefault: true,
      },
    })
  );
  await page.route('**/api/invitations/pending', (route) =>
    route.fulfill({ json: { invitations: [] } })
  );
  await page.route('**/api/v1/notifications**', (route) =>
    route.fulfill({ json: { data: [], next_cursor: null, unread_count: 0 } })
  );
  await page
    .context()
    .addCookies([
      { name: 'barghsa_csrf', value: 'preference-current', url: 'http://127.0.0.1:4173' },
    ]);
  const state = {
    notifications: { channels: ['IN_APP', 'EMAIL'], availableChannels: ['IN_APP', 'EMAIL'] },
    marketing: {
      channels: {
        email: { optedIn: false, lastChangedAt: null as string | null },
        sms: { optedIn: false, lastChangedAt: null as string | null },
      },
    },
    timezone: 'Asia/Tehran',
    readStatus: 200,
    reads: [] as string[],
    writes: [] as { path: string; body: Record<string, unknown>; csrf: string | undefined }[],
    mode: 'success' as 'success' | 'reject' | 'hold',
    held: null as { route: Route; path: string; body: Record<string, unknown> } | null,
  };
  let analytics = false;
  await page.route('**/api/user/analytics/consent', (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as { consent: boolean };
      state.writes.push({
        path: '/api/user/analytics/consent',
        body,
        csrf: route.request().headers()['x-csrf-token'],
      });
      analytics = body.consent;
    }
    return route.fulfill({ json: { consent: analytics } });
  });
  for (const family of ['notifications', 'marketing-consent', 'timezone'])
    await page.route('**/api/user/settings/' + family, (route) => {
      const path = '/api/user/settings/' + family,
        request = route.request();
      if (request.method() === 'GET') {
        state.reads.push(path);
        return route.fulfill({
          status: state.readStatus,
          json:
            family === 'notifications'
              ? state.notifications
              : family === 'marketing-consent'
                ? state.marketing
                : { timezone: state.timezone },
        });
      }
      const body = request.postDataJSON() as Record<string, unknown>;
      state.writes.push({ path, body, csrf: request.headers()['x-csrf-token'] });
      if (state.mode === 'reject')
        return route.fulfill({
          status: 400,
          json: { error: 'VALIDATION:INPUT:INVALID', message: 'PRIVATE-SERVER-TEXT' },
        });
      if (state.mode === 'hold') {
        state.held = { route, path, body };
        return;
      }
      if (family === 'notifications') {
        state.notifications = { ...state.notifications, channels: body.channels as string[] };
        return route.fulfill({ json: state.notifications });
      }
      if (family === 'timezone') {
        state.timezone = body.timezone as string;
        return route.fulfill({ json: { timezone: state.timezone } });
      }
      state.marketing = {
        channels: {
          email: { optedIn: body.email as boolean, lastChangedAt: '2026-10-05T00:00:00Z' },
          sms: { optedIn: body.sms as boolean, lastChangedAt: null },
        },
      };
      return route.fulfill({ json: state.marketing });
    });
  return state;
}
async function holdSchema(page: Page) {
  const manifest = JSON.parse(
    await readFile(new URL('../dist/.vite/manifest.json', import.meta.url), 'utf8')
  ) as Record<string, { file: string }>;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    '**/' + manifest['src/lib/contract-review-signature-form-schemas.ts']!.file,
    async (route) => {
      await held;
      await route.continue();
    }
  );
  return release;
}
async function checkView(page: Page) {
  const violations = (
    await new AxeBuilder({ page })
      .include('#dashboard-content')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze()
  ).violations;
  expect(violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false
  );
}
async function capture(
  owner: Locator,
  name: string,
  testInfo: { outputPath(name: string): string }
) {
  await owner.screenshot({ path: testInfo.outputPath(name) });
}
for (const locale of ['en', 'fa'] as const) {
  test(`notification and marketing native forms retain companion choices and prove saved settings (${locale})`, async ({
    page,
  }, testInfo) => {
    const state = await setup(page, locale),
      release = await holdSchema(page);
    await page.goto('/settings');
    const notifications = page.getByRole('form', {
        name: t('settings.notifications.title', locale),
        exact: true,
      }),
      marketing = page.getByRole('form', {
        name: t('settings.marketing.title', locale),
        exact: true,
      });
    const save = notifications.locator('button[type=submit]'),
      marketSave = marketing.locator('button[type=submit]');
    await expect(save).toBeEnabled();
    await expect(marketSave).toBeEnabled();
    await expect(notifications.locator('#notification-SMS')).toBeDisabled();
    await expect(notifications.locator('#notification-IN_APP')).toBeDisabled();
    await notifications.locator('#notification-EMAIL').click();
    await marketing.locator('#marketing-email').click();
    state.mode = 'reject';
    await save.click();
    await expect(marketSave).toBeDisabled();
    const analytics = page.getByRole('region', { name: shellText('analyticsTitle', locale) });
    await expect(
      analytics.getByRole('button', { name: shellText('analyticsAllow', locale) })
    ).toBeDisabled();
    const reads = state.reads.length;
    await marketing.evaluate((node) =>
      node.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
    await notifications.evaluate((node) =>
      node.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
    await action(page, locale, 'refresh')
      .first()
      .evaluate((node) => node.dispatchEvent(new Event('click', { bubbles: true })));
    expect(state.writes).toHaveLength(0);
    expect(state.reads).toHaveLength(reads);
    release();
    await expect(notifications.locator('#notification-EMAIL')).toBeEnabled();
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0]!.body).toEqual({ channels: ['IN_APP'] });
    expect(state.writes[0]!.csrf).toBe('preference-current');
    await expect(
      page
        .locator('[data-sonner-toast][data-type="error"]')
        .filter({ hasText: copy('rejectedToast', locale) })
    ).toHaveCount(1);
    await expect(notifications.locator('#notification-EMAIL')).toHaveAttribute(
      'aria-checked',
      'false'
    );
    await expect(marketing.locator('#marketing-email')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('PRIVATE-SERVER-TEXT')).toHaveCount(0);
    await checkView(page);
    await capture(notifications.locator('..'), `preference-choices-error-${locale}.png`, testInfo);
    state.mode = 'hold';
    await save.click();
    await expect.poll(() => state.held !== null).toBe(true);
    await expect(marketSave).toBeDisabled();
    const held = state.held!;
    state.notifications = { ...state.notifications, channels: held.body.channels as string[] };
    state.held = null;
    await held.route.fulfill({ json: { ok: true, message: 'PRIVATE-SERVER-TEXT' } });
    await expect(action(page, locale, 'confirm')).toBeEnabled();
    await expect(
      page
        .locator('[data-sonner-toast][data-type="error"]')
        .filter({ hasText: copy('uncertainToast', locale) })
    ).toHaveCount(1);
    await expect(page.locator('[data-sonner-toast][data-type="success"]')).toHaveCount(0);
    await expect(marketSave).toBeDisabled();
    await action(page, locale, 'confirm').click();
    await expect(save).toBeEnabled();
    expect(state.writes).toHaveLength(2);
    await expect(marketing.locator('#marketing-email')).toHaveAttribute('aria-checked', 'true');
    state.mode = 'success';
    await marketSave.click();
    await expect(marketing.locator('#marketing-email')).toBeEnabled();
    expect(state.writes).toHaveLength(3);
    expect(state.writes[2]!.body).toEqual({ email: true, sms: false });
    await expect(
      page
        .locator('[data-sonner-toast][data-type="success"]')
        .filter({ hasText: copy('savedToast', locale) })
    ).toHaveCount(1);
    await expect(marketing.locator('..')).not.toContainText('settings.marketing.');
    await expect(marketing.locator('..')).not.toContainText('{date}');
    await expect(notifications.locator('#notification-EMAIL')).toHaveAttribute(
      'aria-checked',
      'false'
    );
    await checkView(page);
    await capture(marketing.locator('..'), `preference-choices-outcome-${locale}.png`, testInfo);
    state.readStatus = 403;
    await action(page, locale, 'refresh').first().click();
    await expect(notifications).toHaveCount(0);
    await expect(marketing).toHaveCount(0);
    await expect(page.getByText(copy('forbidden', locale))).toBeVisible();
    expect(state.writes).toHaveLength(3);
  });
  test(`timezone native validation, retained search and uncertain confirmation (${locale})`, async ({
    page,
  }, testInfo) => {
    const state = await setup(page, locale),
      release = await holdSchema(page);
    await page.goto('/settings/timezone');
    const owner = page.getByRole('form', { name: timezoneText('title', locale), exact: true }),
      zones = owner.getByRole('listbox'),
      search = owner.getByRole('searchbox'),
      save = owner.locator('button[type=submit]');
    await expect(save).toBeEnabled();
    await search.fill('Europe/Istanbul');
    await zones.evaluate((node) =>
      (node as HTMLSelectElement).add(new Option('not/a-zone', 'not/a-zone'))
    );
    await zones.selectOption('not/a-zone');
    await save.click();
    await expect(zones).toBeDisabled();
    await expect(search).toBeDisabled();
    expect(state.writes).toHaveLength(0);
    release();
    await expect(zones).toBeEnabled();
    await expect(zones).toHaveAttribute('aria-invalid', 'true');
    await expect(zones).toBeFocused();
    await expect(owner.getByText(copy('timezoneInvalid', locale))).toBeVisible();
    expect(state.writes).toHaveLength(0);
    await checkView(page);
    await capture(owner, `preference-timezone-error-${locale}.png`, testInfo);
    await zones.selectOption('Europe/Istanbul');
    state.mode = 'hold';
    await save.click();
    await expect.poll(() => state.held !== null).toBe(true);
    await owner.evaluate((node) =>
      node.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0]!.body).toEqual({ timezone: 'Europe/Istanbul' });
    const held = state.held!;
    state.timezone = held.body.timezone as string;
    state.held = null;
    await held.route.fulfill({ json: { ok: true } });
    state.readStatus = 503;
    await action(page, locale, 'confirm').click();
    await expect(action(page, locale, 'confirm')).toBeEnabled();
    await expect(action(page, locale, 'restart')).toHaveCount(0);
    await expect(search).toHaveValue('Europe/Istanbul');
    await expect(zones).toHaveValue('Europe/Istanbul');
    state.readStatus = 200;
    await action(page, locale, 'confirm').click();
    await expect(save).toBeEnabled();
    expect(state.writes).toHaveLength(1);
    await expect(search).toHaveValue('Europe/Istanbul');
    await checkView(page);
    await capture(owner, `preference-timezone-outcome-${locale}.png`, testInfo);
    await search.fill('');
    await zones.selectOption('Asia/Tehran');
    await action(page, locale, 'refresh').click();
    await expect(save).toBeEnabled();
    await expect(zones).toHaveValue('Asia/Tehran');
    expect(state.writes).toHaveLength(1);
    state.readStatus = 401;
    await action(page, locale, 'refresh').click();
    await expect(owner).toHaveCount(0);
    await expect(page.getByText(copy('forbidden', locale))).toBeVisible();
    expect(state.writes).toHaveLength(1);
  });
}
