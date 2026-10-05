import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { t } from '@barghsa/i18n/app';
import { t as crmText } from '@barghsa/i18n/crm';
import { tSettingsForms } from '@barghsa/i18n/settings-forms';
import { test, expect } from './coverage-fixture';
import {
  setupSettingsForms,
  profileId,
  otherProfileId,
  provinceId,
  cityId,
  privateText,
  type Command,
} from './profile-address-forms-fixture';

type Locale = 'en' | 'fa';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const form = (page: Page, surface: 'profile' | 'address') =>
  page.locator(`[data-slot=settings-${surface}-form]`);
const submit = (owner: Locator) => owner.locator('button[type=submit]');
const action = (page: Page, locale: Locale, key: string) =>
  page.getByRole('button', { name: tSettingsForms(key, locale), exact: true });
async function confirm(page: Page, locale: Locale) {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole('button', { name: crmText('settings.profile.save', locale), exact: true })
    .click();
}
async function linkedError(field: Locator, message: string) {
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAttribute('aria-describedby', /\S+/);
  expect(
    await field.evaluate((node) =>
      (node.getAttribute('aria-describedby') ?? '')
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
    )
  ).toContain(message);
}
async function quality(page: Page, owner: Locator, selector: string) {
  expect(
    (
      await new AxeBuilder({ page })
        .include(selector)
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze()
    ).violations
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const control of await owner.locator('input,textarea,select,button').all()) {
    const box = await control.boundingBox();
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
  // Original compact field/outcome pixels; not complete viewport or native-dialog coverage.
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
async function holdFirstSchema(page: Page) {
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
async function rotateCsrf(page: Page, value: string) {
  await page.context().addCookies([{ name: 'barghsa_csrf', value, url: 'http://127.0.0.1:4173' }]);
}
async function profileEpoch(page: Page) {
  await page.evaluate(() => {
    const channel = new BroadcastChannel('barghsa-profile-context');
    channel.postMessage({ type: 'profile-changed' });
    channel.close();
  });
}
function sameCapture(commands: Command[]) {
  const first = commands[0]!;
  expect(first.body.idempotencyKey).toMatch(uuidPattern);
  for (const next of commands.slice(1)) {
    expect(next.raw).toBe(first.raw);
    expect(next.path).toBe(first.path);
    expect(next.method).toBe(first.method);
    expect(next.body.idempotencyKey).toBe(first.body.idempotencyKey);
  }
}
async function profileCompanions(
  page: Page,
  locale: Locale,
  state: Awaited<ReturnType<typeof setupSettingsForms>>['state']
) {
  const before = {
    reads: state.reads.length,
    writes: state.writes.length,
    documents: state.documentReads,
    companions: state.companionWrites.length,
  };
  const defaults = page.locator('#settings-profile-switcher');
  await expect(defaults).toBeDisabled();
  await defaults.evaluate((node: HTMLSelectElement, value) => {
    node.value = value;
    node.dispatchEvent(new Event('change', { bubbles: true }));
  }, otherProfileId);
  const documents = page.getByRole('region', {
    name: t('onboarding.documents.title', locale),
    exact: true,
    includeHidden: true,
  });
  const refresh = documents.getByRole('button', {
    name: t('onboarding.documents.refresh', locale),
    exact: true,
    includeHidden: true,
  });
  await expect(refresh).toBeDisabled();
  await refresh.dispatchEvent('click');
  const profileRefresh = form(page, 'profile').getByRole('button', {
    name: tSettingsForms('refreshProfile', locale),
    exact: true,
    includeHidden: true,
  });
  await expect(profileRefresh).toBeDisabled();
  await profileRefresh.dispatchEvent('click');
  await form(page, 'profile').dispatchEvent('submit');
  expect({
    reads: state.reads.length,
    writes: state.writes.length,
    documents: state.documentReads,
    companions: state.companionWrites.length,
  }).toEqual(before);
}
async function addressCompanions(
  page: Page,
  locale: Locale,
  state: Awaited<ReturnType<typeof setupSettingsForms>>['state']
) {
  const before = {
    location: page.url(),
    reads: state.reads.length,
    writes: state.writes.length,
    companions: state.companionWrites.length,
  };
  for (const key of ['add', 'edit', 'setMain', 'delete']) {
    const buttons = page.getByRole('button', {
      name: t(`settings.addresses.${key}`, locale),
      exact: true,
      includeHidden: true,
    });
    await expect(buttons).toHaveCount(
      key === 'add'
        ? 1
        : key === 'setMain'
          ? state.addresses.filter((item) => !item.mainAddress).length
          : state.addresses.length
    );
    for (const button of await buttons.all()) {
      await expect(button).toBeDisabled();
      await button.dispatchEvent('click');
    }
  }
  const dialog = page.getByRole('dialog');
  const cancel = dialog.getByRole('button', {
    name: t('settings.addresses.form.cancel', locale),
    exact: true,
  });
  await expect(cancel).toHaveCount(2);
  for (const button of await cancel.all()) {
    await expect(button).toBeDisabled();
    await button.dispatchEvent('click');
  }
  await form(page, 'address').dispatchEvent('submit');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  const related = page.locator('a[href="/electricity/advanced"]');
  await related.dispatchEvent('click');
  await expect(page).toHaveURL(before.location);
  expect({
    location: page.url(),
    reads: state.reads.length,
    writes: state.writes.length,
    companions: state.companionWrites.length,
  }).toEqual(before);
}

for (const locale of ['en', 'fa'] as const) {
  test(`settings profile editor confirms actual legal/address values and original captured retries (${locale})`, async ({
    page,
  }) => {
    const fixture = await setupSettingsForms(page, locale, 'profile');
    const { state } = fixture;
    const releaseSchema = await holdFirstSchema(page);
    await page.goto('/settings/profile');
    await expect.poll(() => state.shellProfileReads).toBe(3);
    await expect
      .poll(() => page.locator('html').evaluate((root) => root.classList.contains('dark')))
      .toBe(locale === 'fa');
    const owner = form(page, 'profile');
    const title = page.locator('#profile-title'),
      legal = page.locator('#profile-legalName');
    const full = page.locator('#profile-address'),
      postal = page.locator('#profile-postal-code');
    await expect(legal).toHaveValue('Original Company');
    await expect(page.locator('#profile-city')).toHaveValue(cityId);
    await expect(page.locator('#profile-city')).toBeEnabled();
    await title.fill('  Captured profile  ');
    await legal.fill(' ');
    await full.fill('  Retained main address  ');
    await postal.fill('2345678901');
    await owner
      .getByRole('button', { name: tSettingsForms('refreshProfile', locale), exact: true })
      .click();
    await expect(title).toBeEnabled();
    await expect(title).toHaveValue('  Captured profile  ');
    await expect(legal).toHaveValue(' ');
    await expect(full).toHaveValue('  Retained main address  ');
    await title.press('Enter');
    await profileCompanions(page, locale, state);
    expect(state.writes).toHaveLength(0);
    releaseSchema();
    await linkedError(legal, tSettingsForms('legalNameInvalid', locale));
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(full).toHaveValue('  Retained main address  ');
    await quality(page, owner, '[data-slot=settings-profile-form]');
    await crop(
      page,
      page.locator('[data-slot=form-item]').filter({ has: legal }),
      test.info().outputPath(`settings-profile-field-${locale}.png`)
    );

    await legal.fill('  Captured Company  ');
    state.modes.profile = 'owned';
    await title.press('Enter');
    await confirm(page, locale);
    await expect.poll(() => state.writes.length).toBe(1);
    await linkedError(legal, tSettingsForms('legalNameInvalid', locale));
    await expect(full).toHaveValue('  Retained main address  ');
    await expect(page.locator('body')).not.toContainText(privateText);

    state.modes.profile = 'mixed';
    await title.press('Enter');
    await confirm(page, locale);
    await expect.poll(() => state.writes.length).toBe(2);
    await expect(action(page, locale, 'retryOriginal')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(privateText);
    await expect(full).toHaveValue('  Retained main address  ');
    state.modes.profile = 'hold';
    await rotateCsrf(page, 'settings-profile-retry-one');
    await action(page, locale, 'retryOriginal').click();
    await expect.poll(() => state.writes.length).toBe(3);
    await expect.poll(() => Boolean(state.held)).toBe(true);
    await profileCompanions(page, locale, state);
    const result = fixture.commitHeld();
    expect(result).not.toHaveProperty('legalInfo');
    expect(result).not.toHaveProperty('addresses');
    expect(result).not.toHaveProperty('idempotencyKey');
    await fixture.finishHeld(result, true);
    await expect(action(page, locale, 'retryOriginal')).toBeVisible();
    expect(state.effects).toEqual({ profile: 1, create: 0, edit: 0, history: 1, audit: 1 });

    state.modes.profile = 'success';
    state.detailMode = 'malformed';
    await rotateCsrf(page, 'settings-profile-retry-two');
    await action(page, locale, 'retryOriginal').click();
    await expect.poll(() => state.writes.length).toBe(4);
    await expect(action(page, locale, 'refreshConfirmation')).toBeVisible();
    await expect(full).toHaveValue('  Retained main address  ');
    await expect(legal).toHaveValue('  Captured Company  ');
    await expect(page.locator('body')).not.toContainText(privateText);
    sameCapture(state.writes.slice(1, 4));
    expect(state.writes[2]!.csrf).toBe('settings-profile-retry-one');
    expect(state.writes[3]!.csrf).toBe('settings-profile-retry-two');
    state.detailMode = 'success';
    const writesBeforeConfirmation = state.writes.length;
    await action(page, locale, 'refreshConfirmation').click();
    await expect(action(page, locale, 'refreshConfirmation')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(legal).toHaveValue('Captured Company');
    await expect(full).toHaveValue('Retained main address');
    expect(state.writes).toHaveLength(writesBeforeConfirmation);
    expect(state.effects).toEqual({ profile: 1, create: 0, edit: 0, history: 1, audit: 1 });
    expect(
      state.reads.filter((path) => path === `/api/profiles/${profileId}`).length
    ).toBeGreaterThanOrEqual(3);
    await crop(
      page,
      page.locator('[data-slot=form-item]').filter({ has: full }),
      test.info().outputPath(`settings-profile-outcome-${locale}.png`)
    );

    await title.fill(privateText);
    state.modes.profile = 'hold';
    await title.press('Enter');
    await confirm(page, locale);
    await expect.poll(() => Boolean(state.held)).toBe(true);
    const oldReceipt = fixture.commitHeld();
    state.actor = 'settings/new-customer:opaque';
    state.activeProfileId = otherProfileId;
    await profileEpoch(page);
    await expect(title).toHaveValue('Fresh profile');
    await expect(legal).toHaveCount(0);
    await fixture.finishHeld(oldReceipt);
    await expect(title).toHaveValue('Fresh profile');
    await expect(page.locator('body')).not.toContainText(privateText);
    await expect(action(page, locale, 'retryOriginal')).toHaveCount(0);
    expect(state.companionWrites).toEqual([]);
  });

  test(`settings saved address editor confirms original receipts and current privacy (${locale})`, async ({
    page,
  }) => {
    const fixture = await setupSettingsForms(page, locale, 'addresses');
    const { state } = fixture;
    const releaseSchema = await holdFirstSchema(page);
    await page.goto('/settings/addresses?returnTo=%2Felectricity%2Fadvanced');
    // Root guard, sidebar switcher and lazy default-profile modal each read once on mount.
    // Wait for all three without excluding any request from the later no-read guard.
    await expect.poll(() => state.shellProfileReads).toBe(3);
    await expect
      .poll(() => page.locator('html').evaluate((root) => root.classList.contains('dark')))
      .toBe(locale === 'fa');
    await page
      .getByRole('button', { name: t('settings.addresses.add', locale), exact: true })
      .click();
    const owner = form(page, 'address');
    const province = page.locator('#addresses-field-1'),
      city = page.locator('#addresses-field-2');
    const full = page.locator('#addresses-field-3'),
      postal = page.locator('#addresses-field-4');
    await province.selectOption(provinceId);
    await expect(city.locator(`option[value="${cityId}"]`)).toHaveCount(1);
    await city.selectOption(cityId);
    await full.fill(' ');
    await postal.fill('0000000000');
    await postal.press('Enter');
    await addressCompanions(page, locale, state);
    expect(state.writes).toHaveLength(0);
    releaseSchema();
    await linkedError(full, t('settings.addresses.validation.fullAddress', locale));
    await quality(page, owner, '[data-slot=settings-address-form]');
    await crop(
      page,
      page.locator('[data-slot=form-item]').filter({ has: full }),
      test.info().outputPath(`settings-address-field-${locale}.png`)
    );

    await full.fill('  First saved address  ');
    await postal.fill('2345678901');
    state.ownedFields = ['postalCode'];
    state.modes.create = 'owned';
    await submit(owner).click();
    await expect.poll(() => state.writes.length).toBe(1);
    await linkedError(postal, t('settings.addresses.validation.postalCode', locale));
    await expect(full).toHaveValue('  First saved address  ');
    await expect(page.getByRole('dialog')).not.toContainText(privateText);
    state.modes.create = 'mixed';
    await submit(owner).click();
    await expect.poll(() => state.writes.length).toBe(2);
    await expect(action(page, locale, 'retryOriginal')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(privateText);
    state.modes.create = 'hold';
    await rotateCsrf(page, 'settings-address-retry-one');
    await action(page, locale, 'retryOriginal').click();
    await expect.poll(() => state.writes.length).toBe(3);
    await expect.poll(() => Boolean(state.held)).toBe(true);
    await addressCompanions(page, locale, state);
    const created = fixture.commitHeld();
    expect(created.mainAddress).toBe(true);
    expect(created).not.toHaveProperty('idempotencyKey');
    await fixture.finishHeld(created, true);
    await expect(action(page, locale, 'retryOriginal')).toBeVisible();
    state.modes.create = 'success';
    await rotateCsrf(page, 'settings-address-retry-two');
    await action(page, locale, 'retryOriginal').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    sameCapture(state.writes.slice(1, 4));
    expect(state.writes[2]!.csrf).toBe('settings-address-retry-one');
    expect(state.writes[3]!.csrf).toBe('settings-address-retry-two');
    expect(state.effects).toEqual({ profile: 0, create: 1, edit: 0, history: 0, audit: 1 });
    const card = page.locator('[data-slot=card]').filter({ hasText: 'First saved address' });
    await expect(card).toContainText(t('settings.addresses.main', locale));
    expect(state.reads).not.toContain(`/api/profiles/${profileId}`); // Manager address editing never invents owner-only detail access.

    fixture.addConcurrentAddress();
    const shellReadsBeforeReload = state.shellProfileReads;
    await page.reload();
    await expect.poll(() => state.shellProfileReads).toBe(shellReadsBeforeReload + 3);
    await expect(page.locator('#profile-switcher')).toHaveValue(profileId);
    await card
      .getByRole('button', { name: t('settings.addresses.edit', locale), exact: true })
      .click();
    await expect(full).toHaveValue('First saved address');
    await full.fill('  Edited saved address  ');
    await postal.fill('3456789012');
    state.modes.edit = 'hold';
    await submit(owner).click();
    await expect.poll(() => state.writes.length).toBe(5);
    await addressCompanions(page, locale, state);
    expect(state.writes[4]!.body).not.toHaveProperty('provinceId');
    expect(state.writes[4]!.body).not.toHaveProperty('cityId');
    const edited = fixture.commitHeld();
    await fixture.finishHeld(edited, true);
    await expect(action(page, locale, 'retryOriginal')).toBeVisible();
    state.modes.edit = 'success';
    await rotateCsrf(page, 'settings-address-edit-retry');
    await action(page, locale, 'retryOriginal').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    sameCapture(state.writes.slice(4, 6));
    expect(state.writes[5]!.csrf).toBe('settings-address-edit-retry');
    expect(state.effects).toEqual({ profile: 0, create: 1, edit: 1, history: 0, audit: 2 });
    const outcome = page.locator('[data-slot=card]').filter({ hasText: 'Edited saved address' });
    await expect(outcome).toContainText('3456789012');
    await crop(page, outcome, test.info().outputPath(`settings-address-outcome-${locale}.png`));

    await outcome
      .getByRole('button', { name: t('settings.addresses.edit', locale), exact: true })
      .click();
    await full.fill(privateText);
    state.modes.edit = 'success';
    state.denied = true;
    await submit(owner).click();
    await expect.poll(() => state.writes.length).toBe(7);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(privateText);
    await expect(page.locator('body')).not.toContainText('Edited saved address');
    await expect(action(page, locale, 'retryOriginal')).toHaveCount(0);
    state.denied = false;
    state.actor = 'settings/new-customer:opaque';
    state.activeProfileId = otherProfileId;
    await profileEpoch(page);
    await expect(page.locator('body')).toContainText(t('settings.addresses.noAddresses', locale));
    expect(state.effects).toEqual({ profile: 0, create: 1, edit: 1, history: 0, audit: 2 });
    expect(state.companionWrites).toEqual([]);
  });
}
