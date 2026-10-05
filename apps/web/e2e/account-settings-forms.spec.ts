import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page, Route } from '@playwright/test';
import { t } from '@barghsa/i18n/app';
import { tAccountSettingsForms as copy } from '@barghsa/i18n/account-settings-forms';
import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { fullNavigation } from './navigation-fixture';
type Locale = 'en' | 'fa';
const challengeId = '10000000-0000-4000-8000-000000000001';
const profileId = '10000000-0000-4000-8000-000000000002';
const privateText = 'PRIVATE-OLD-ACCOUNT-SOURCE';
const form = (page: Page, family: 'username' | 'contact') =>
  page.locator(`[data-slot=account-${family}-form]`);
const submit = (owner: Locator) => owner.locator('button[type=submit]');
const action = (page: Page, locale: Locale, key: string) =>
  page.getByRole('button', { name: copy(key, locale), exact: true });
async function setup(page: Page, locale: Locale, type: 'email' | 'mobile' = 'mobile') {
  await setupCatalogueForms(page, locale, locale === 'fa');
  const state = {
    user: {
      userId: 'account/customer:opaque',
      username: type === 'mobile' ? 'old@example.test' : '+989120000001',
      email: type === 'mobile' ? 'old@example.test' : (null as string | null),
      mobile: type === 'mobile' ? null : ('+989120000001' as string | null),
      emailVerified: type === 'mobile',
      mobileVerified: type === 'email',
    },
    reads: 0,
    readStatus: 200,
    writes: [] as { path: string; body: Record<string, string>; csrf: string | null }[],
    sendMode: 'success' as 'success' | 'hold',
    verifyMode: 'success' as 'success' | 'hold' | 'otp',
    held: null as { route: Route; body: Record<string, string> } | null,
  };
  await page
    .context()
    .addCookies([{ name: 'barghsa_csrf', value: 'account-initial', url: 'http://127.0.0.1:4173' }]);
  await page.route('**/api/auth/user', (route) => {
    state.reads++;
    return route.fulfill({
      status: state.readStatus,
      json: {
        ...state.user,
        isStaff: false,
        operatingContext: 'customer',
        canSwitchContext: false,
        requiresTosAcceptance: false,
        navigation: { ...fullNavigation('customer', 'LEGAL'), profileId },
      },
    });
  });
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        profiles: [
          {
            id: profileId,
            profileType: 'LEGAL',
            title: 'Account forms',
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
  function receipt(body: Record<string, string>) {
    return {
      challengeId,
      destination: body.newUsername ?? body.contactValue,
      ...(body.newUsername ? { previousDestination: state.user.username } : {}),
    };
  }
  function commit(body: Record<string, string>) {
    if (body.newUsername)
      state.user = {
        ...state.user,
        username: body.newUsername,
        email: body.newUsername,
        emailVerified: true,
      };
    else
      state.user = {
        ...state.user,
        [body.contactType!]: body.contactValue,
        [body.contactType === 'email' ? 'emailVerified' : 'mobileVerified']: true,
      };
  }
  for (const base of ['/api/auth/change-username', '/api/auth/add-contact'])
    for (const suffix of ['', '/send-otp'])
      await page.route('**' + base + suffix, (route) => {
        const request = route.request(),
          body = request.postDataJSON() as Record<string, string>;
        state.writes.push({
          path: base + suffix,
          body,
          csrf: request.headers()['x-csrf-token'] ?? null,
        });
        if ((suffix && state.sendMode === 'hold') || (!suffix && state.verifyMode === 'hold')) {
          state.held = { route, body };
          return;
        }
        if (suffix) return route.fulfill({ json: receipt(body) });
        if (state.verifyMode === 'otp')
          return route.fulfill({
            status: 401,
            json: { error: 'AUTH:OTP:INVALID', message: privateText },
          });
        commit(body);
        return route.fulfill({ json: { message: 'verified' } });
      });
  async function finishHeld(value: unknown) {
    const held = state.held!;
    state.held = null;
    await held.route.fulfill({ json: value });
  }
  return { state, receipt, commit, finishHeld };
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
async function linkedError(field: Locator, message: string) {
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  expect(
    await field.evaluate((node) =>
      (node.getAttribute('aria-describedby') ?? '')
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
    )
  ).toContain(message);
}
async function quality(page: Page, family: 'username' | 'contact') {
  expect(
    (
      await new AxeBuilder({ page })
        .include(`[data-slot=account-${family}-form]`)
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze()
    ).violations
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const field of await form(page, family).locator('input,button').all()) {
    const box = await field.boundingBox();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    }
  }
}
async function crop(page: Page, owner: Locator, path: string) {
  await owner.scrollIntoViewIfNeeded();
  const box = await owner.boundingBox();
  expect(box).not.toBeNull();
  const x = Math.max(0, box!.x),
    y = Math.max(0, box!.y);
  await page.screenshot({
    path,
    clip: {
      x,
      y,
      width: Math.min(box!.width, page.viewportSize()!.width - x),
      height: Math.min(box!.height, page.viewportSize()!.height - y),
    },
  });
}
async function guards(
  page: Page,
  locale: Locale,
  state: Awaited<ReturnType<typeof setup>>['state']
) {
  const before = { reads: state.reads, writes: state.writes.length, url: page.url() };
  const surface = page
    .getByRole('heading', { name: t('settings.username.title', locale), exact: true })
    .locator('..')
    .locator('..');
  for (const control of await surface.locator('input,button').all()) {
    await expect(control).toBeDisabled();
    if (await control.evaluate((node) => node.tagName === 'BUTTON'))
      await control.dispatchEvent('click');
  }
  for (const family of ['username', 'contact'] as const)
    await form(page, family).dispatchEvent('submit');
  expect({ reads: state.reads, writes: state.writes.length, url: page.url() }).toEqual(before);
}
for (const locale of ['en', 'fa'] as const) {
  test(`account username forms preserve paired codes, companion drafts and uncertain confirmation (${locale})`, async ({
    page,
  }) => {
    const fixture = await setup(page, locale),
      { state } = fixture,
      release = await holdSchema(page);
    await page.goto('/settings/username');
    await page
      .getByRole('button', { name: t('settings.username.change', locale), exact: true })
      .click();
    await page
      .getByRole('button', { name: t('settings.contact.addMobile', locale), exact: true })
      .click();
    const owner = form(page, 'username'),
      destination = page.locator('#new-username'),
      companion = page.locator('#new-contact');
    await destination.fill('  invalid  ');
    await companion.fill(' 09120000003 ');
    await destination.press('Enter');
    await guards(page, locale, state);
    expect(state.writes).toHaveLength(0);
    release();
    await linkedError(destination, copy('usernameInvalid', locale));
    await quality(page, 'username');
    await crop(
      page,
      destination.locator('..'),
      test.info().outputPath(`account-username-field-${locale}.png`)
    );
    await destination.fill('  NEW@example.test  ');
    await submit(owner).click();
    await expect(page.locator('#previous-otp')).toBeVisible();
    expect(state.writes[0]!.body).toEqual({ newUsername: 'new@example.test' });
    await page.locator('#change-otp').fill('123456');
    await expect(submit(owner)).toBeDisabled();
    await page.locator('#previous-otp').fill('112233');
    state.verifyMode = 'otp';
    await submit(owner).click();
    await expect(submit(owner)).toBeEnabled();
    await expect(page.locator('#previous-otp')).toHaveValue('112233');
    await expect(page.locator('#change-otp')).toHaveValue('123456');
    await expect(companion).toHaveValue(' 09120000003 ');
    await expect(page.locator('body')).not.toContainText(privateText);
    state.verifyMode = 'hold';
    await page
      .context()
      .addCookies([
        { name: 'barghsa_csrf', value: 'account-current', url: 'http://127.0.0.1:4173' },
      ]);
    await submit(owner).click();
    await expect.poll(() => !!state.held).toBe(true);
    await guards(page, locale, state);
    expect(state.writes[2]!.body).toEqual(state.writes[1]!.body);
    expect(state.writes[2]!.csrf).toBe('account-current');
    expect(state.writes[2]!.body).not.toHaveProperty('idempotencyKey');
    fixture.commit(state.held!.body);
    await fixture.finishHeld({ message: 42 });
    await expect(action(page, locale, 'confirm')).toBeVisible();
    await owner.dispatchEvent('submit');
    expect(state.writes).toHaveLength(3);
    await action(page, locale, 'confirm').click();
    await expect(page.locator('#previous-otp')).toHaveCount(0);
    await expect(companion).toHaveValue(' 09120000003 ');
    expect(state.writes).toHaveLength(3);
    await crop(
      page,
      page.locator('section[aria-labelledby=username-section-title]'),
      test.info().outputPath(`account-username-outcome-${locale}.png`)
    );
    await page
      .getByRole('button', { name: t('settings.username.change', locale), exact: true })
      .click();
    await page.locator('#new-username').fill(privateText);
    state.readStatus = 401;
    await action(page, locale, 'refresh').click();
    await expect(form(page, 'username')).toHaveCount(0);
    await expect(form(page, 'contact')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(privateText);
  });
  test(`account contact forms require deliberate restart and actual verified account confirmation (${locale})`, async ({
    page,
  }) => {
    const type = locale === 'en' ? 'mobile' : 'email',
      fixture = await setup(page, locale, type),
      { state } = fixture,
      release = await holdSchema(page);
    await page.goto('/settings/username');
    await page
      .getByRole('button', { name: t('settings.username.change', locale), exact: true })
      .click();
    await page
      .getByRole('button', {
        name: t(
          type === 'mobile' ? 'settings.contact.addMobile' : 'settings.contact.addEmail',
          locale
        ),
        exact: true,
      })
      .click();
    const owner = form(page, 'contact'),
      destination = page.locator('#new-contact'),
      companion = page.locator('#new-username');
    await companion.fill('  Companion@example.test  ');
    await destination.fill('  invalid  ');
    await destination.press('Enter');
    await guards(page, locale, state);
    release();
    await linkedError(
      destination,
      copy(type === 'mobile' ? 'mobileInvalid' : 'emailInvalid', locale)
    );
    await quality(page, 'contact');
    await crop(
      page,
      destination.locator('..'),
      test.info().outputPath(`account-contact-field-${locale}.png`)
    );
    const raw = type === 'mobile' ? ' 09120000002 ' : '  NEW@EXAMPLE.TEST  ',
      canonical = type === 'mobile' ? '+989120000002' : 'new@example.test';
    await destination.fill(raw);
    state.sendMode = 'hold';
    await submit(owner).click();
    await expect.poll(() => !!state.held).toBe(true);
    await guards(page, locale, state);
    expect(state.writes[0]!.body).toEqual({ contactType: type, contactValue: canonical });
    await fixture.finishHeld({ challengeId, destination: privateText });
    await expect(action(page, locale, 'confirm')).toBeVisible();
    await expect(page.locator('#contact-otp')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(privateText);
    await owner.dispatchEvent('submit');
    expect(state.writes).toHaveLength(1);
    await action(page, locale, 'confirm').click();
    await action(page, locale, 'restart').click();
    await expect(destination).toHaveValue(raw);
    await expect(companion).toHaveValue('  Companion@example.test  ');
    state.sendMode = 'success';
    await submit(owner).click();
    await expect(page.locator('#contact-otp')).toBeVisible();
    await page.locator('#contact-otp').fill('abcdef');
    await submit(owner).click();
    await linkedError(page.locator('#contact-otp'), copy('otpInvalid', locale));
    expect(state.writes).toHaveLength(2);
    await page.locator('#contact-otp').fill('123456');
    state.verifyMode = 'hold';
    await submit(owner).click();
    await expect.poll(() => !!state.held).toBe(true);
    await guards(page, locale, state);
    expect(state.writes[2]!.body).toEqual({
      contactType: type,
      contactValue: canonical,
      otpChallengeId: challengeId,
      otp: '123456',
    });
    fixture.commit(state.held!.body);
    state.readStatus = 503;
    await fixture.finishHeld({ message: 'verified' });
    await expect(action(page, locale, 'confirm')).toBeVisible();
    await expect(page.locator('#contact-otp')).toHaveValue('123456');
    await owner.dispatchEvent('submit');
    expect(state.writes).toHaveLength(3);
    state.readStatus = 200;
    await action(page, locale, 'confirm').click();
    await expect(page.locator('#contact-otp')).toHaveCount(0);
    await expect(companion).toHaveValue('  Companion@example.test  ');
    expect(state.writes).toHaveLength(3);
    await expect(page.locator('section[aria-labelledby=contact-section-title]')).toContainText(
      canonical
    );
    await crop(
      page,
      page.locator('section[aria-labelledby=contact-section-title]'),
      test.info().outputPath(`account-contact-outcome-${locale}.png`)
    );
    await companion.fill(privateText);
    state.readStatus = 403;
    await action(page, locale, 'refresh').click();
    await expect(form(page, 'username')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(privateText);
  });
}
