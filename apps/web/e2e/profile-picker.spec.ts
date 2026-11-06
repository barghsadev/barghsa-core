import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Route } from './coverage-fixture';
import { fullNavigation } from './navigation-fixture';
import { fulfillDashboard } from './dashboard-fixture';
import { t } from '@barghsa/i18n/workspace';

for (const locale of ['en', 'fa'] as const) {
  test(`rich profile selection confirms its target before replacing private workspace data (${locale})`, async ({
    page,
    baseURL,
  }, info) => {
    const first = '99111111-1111-4111-8111-111111111111',
      second = '99222222-2222-4222-8222-222222222222';
    const profiles = [
      { id: first, profileType: 'LEGAL', displayName: 'First company', status: 'VERIFIED' },
      { id: second, profileType: 'INDIVIDUAL', displayName: 'Second buyer', status: 'ACTIVE' },
    ].map((row) => ({
      ...row,
      isDefault: row.id === first,
      title: null,
      firstName: null,
      lastName: null,
      nationalId: null,
    }));
    let active = first,
      writes = 0,
      held: Route | null = null;
    await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
    await page
      .context()
      .addCookies([{ url: baseURL!, name: 'barghsa_csrf', value: 'picker-csrf' }]);
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({
        json: {
          userId: 'picker-owner',
          isStaff: false,
          operatingContext: 'customer',
          requiresTosAcceptance: false,
          navigation: {
            ...fullNavigation('customer', active === first ? 'LEGAL' : 'INDIVIDUAL'),
            profileId: active,
          },
        },
      })
    );
    await page.route('**/api/profiles', (route) =>
      route.fulfill({ json: { profiles, activeProfileId: active, hasDefault: true } })
    );
    await page.route('**/api/dashboard{,/**}', (route) =>
      fulfillDashboard(route, {
        json: {
          wallet: {
            balance: active === first ? 123456 : 987654,
            currency: 'IRR',
            lowBalanceWarning: false,
          },
          activeOrders: 0,
          pendingInvoices: 0,
          openTickets: 0,
          contracts: { active: 0, total: 0 },
        },
      })
    );
    await page.route('**/api/v1/notifications**', (route) =>
      route.fulfill({ json: { data: [], next_cursor: null, unread_count: 0 } })
    );
    await page.route('**/api/invitations/pending', (route) =>
      route.fulfill({ json: { invitations: [] } })
    );
    await page.route('**/api/profiles/switch/' + second, (route) => {
      expect(route.request().method()).toBe('POST');
      expect(route.request().headers()['x-csrf-token']).toBe('picker-csrf');
      expect(route.request().postData()).toBeNull();
      writes++;
      held = route;
    });
    const dist = process.env['BARGHSA_BROWSER_COVERAGE'] === '1' ? 'dist-coverage' : 'dist';
    const manifest = JSON.parse(readFileSync(resolve(dist, '.vite/manifest.json'), 'utf8'));
    const choicesChunk = '**/' + manifest['src/components/ProfileChoices.tsx'].file;
    await page.route(choicesChunk, (route) => route.abort('failed'));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app');
    await expect(page.locator('[data-slot=active-profile-badge]')).toContainText('First company');
    await page
      .getByRole('button', { name: locale === 'fa' ? 'فهرست' : 'Menu', exact: true })
      .click();
    await page.locator('#profile-switcher').click();
    await expect(page.locator('#profile-switcher [data-slot=avatar]')).toHaveCount(1);
    await expect(page.locator('#profile-switcher [data-slot=avatar-fallback]')).toHaveText('FC');
    const unavailable = page.locator('[data-slot=popover-content]');
    await expect(unavailable.getByRole('alert')).toBeVisible();
    expect(writes).toBe(0);
    await expect(page.locator('[data-slot=active-profile-badge]')).toContainText('First company');
    await page.unroute(choicesChunk);
    await unavailable
      .getByRole('button', { name: t('dashboard.profile.reloadWorkspace', locale) })
      .click();
    await expect(page.locator('[data-slot=active-profile-badge]')).toContainText('First company');
    await page
      .getByRole('button', { name: locale === 'fa' ? 'فهرست' : 'Menu', exact: true })
      .click();
    await page.locator('#profile-switcher').focus();
    await page.keyboard.press('Enter');
    const choices = page.getByRole('radiogroup', {
      name: t('dashboard.profile.switchLabel', locale),
    });
    await expect(choices.getByRole('radio')).toHaveCount(2);
    await expect(choices.locator('[data-slot=avatar]')).toHaveCount(2);
    await expect(choices.locator('[data-profile-id="' + first + '"]')).toHaveAttribute(
      'aria-checked',
      'true'
    );
    await expect(choices).toContainText(t('dashboard.profile.verified', locale));
    await expect(choices).toContainText(t('dashboard.profile.unverified', locale));
    await expect(
      page.getByRole('link', { name: t('dashboard.profile.manage', locale), exact: true })
    ).toHaveAttribute('href', '/settings/profile');
    expect(
      (await new AxeBuilder({ page }).include('[data-slot=popover-content]').analyze()).violations
    ).toEqual([]);
    await page.screenshot({ path: info.outputPath('profile-choices-' + locale + '.png') });
    await choices.locator('[data-profile-id="' + first + '"]').focus();
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => writes).toBe(1);
    const progress = page.getByRole('dialog', {
      name: t('dashboard.profile.switching', locale),
      exact: true,
    });
    await expect(progress).toBeVisible();
    const bounds = (await progress.boundingBox())!;
    expect(bounds.width).toBe(390);
    expect(bounds.height).toBe(844);
    await page.keyboard.press('Escape');
    await expect(progress).toBeVisible();
    active = second;
    await held!.fulfill({ json: { activeProfileId: first } });
    await expect(progress.getByRole('alert')).toBeVisible();
    expect(writes).toBe(1);
    await progress
      .getByRole('button', { name: t('dashboard.profile.recheck', locale), exact: true })
      .click();
    await expect(progress).toBeHidden();
    await expect(page.locator('[data-slot=active-profile-badge]')).toContainText('Second buyer');
    await expect(page.locator('main')).toContainText(locale === 'fa' ? '۹۸۷٬۶۵۴' : '987,654');
    await expect(page.locator('main')).not.toContainText(locale === 'fa' ? '۱۲۳٬۴۵۶' : '123,456');
    expect(writes).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
  });
}
