import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect } from './coverage-fixture';
import { fullNavigation } from './navigation-fixture';
import { t } from '../../../packages/i18n/src/admin-ui';
import { tDuePeriods } from '../../../packages/i18n/src/invoice-due-periods';
const invoiceId = '11111111-1111-4111-8111-111111111111';
const source = {
  invoiceId,
  state: 'Unpaid',
  issuedAt: '2026-09-01T10:00:00.000Z',
  payableFrom: '2026-09-01T10:00:00.000Z',
  dueAt: '2026-09-12T10:00:00.000Z',
  canOverride: true,
  dueAtOverride: null,
};
const periods = ['electricity', 'saving_plan', 'consultation', 'manual'].map((serviceType) => ({
  serviceType,
  defaultDays: 7,
  periodId: null,
  effectiveFrom: null,
  effectiveUntil: null,
}));
async function setup(page: Page, locale: 'fa' | 'en', darkMode: boolean) {
  await page.addInitScript((locale) => localStorage.setItem('barghsa.locale', locale), locale);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        isStaff: true,
        operatingContext: 'staff',
        canSwitchContext: true,
        requiresTosAcceptance: false,
        navigation: fullNavigation('staff'),
      },
    })
  );
  await page.route('**/api/public/branding/config', (route) =>
    route.fulfill({
      json: {
        appTitle: 'Finance',
        appTitleFa: 'امور مالی',
        supportEmail: 'support@example.test',
        supportPhone: '+982112345678',
        supportMobile: '+989121234567',
        backgroundColor: '#f6f7f4',
        darkBackgroundColor: '#15201c',
        fontFamily: 'vazirmatn',
        borderRadiusRem: 0.75,
        spacingScale: 1,
        slogan: '',
        primaryColor: '#2563eb',
        secondaryColor: '#64748b',
        accentColor: '#f59e0b',
        logoUrl: null,
        faviconUrl: null,
        darkMode,
        numberStyle: locale === 'fa' ? 'persian' : 'western',
      },
    })
  );
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
  await page.route('**/api/admin/config/invoice-due-periods', (route) =>
    route.fulfill({ json: periods })
  );
}
for (const locale of ['fa', 'en'] as const)
  for (const darkMode of [false, true]) {
    const text = (key: string) => t('admin.invoices.' + key, locale),
      dueText = (key: Parameters<typeof tDuePeriods>[0]) => tDuePeriods(key, locale);
    test(`deadline forms: touched feedback, owned errors and unchanged recovery (${locale}, dark=${darkMode})`, async ({
      page,
    }) => {
      await setup(page, locale, darkMode);
      let readStatus = 200,
        deadlineWrites = 0,
        settingWrites = 0;
      await page.route(`**/api/admin/invoices/${invoiceId}/due-at`, (route) => {
        if (route.request().method() === 'GET')
          return route.fulfill({ status: readStatus, json: source });
        deadlineWrites++;
        return route.fulfill({
          status: 400,
          json: {
            error: {
              code: 'VALIDATION:INPUT:INVALID',
              fields: ['reason'],
              message: 'private backend text',
            },
          },
        });
      });
      await page.route('**/api/admin/config/invoice-due-periods', (route) => {
        if (route.request().method() === 'GET')
          return route.fulfill({ status: readStatus, json: periods });
        settingWrites++;
        return route.fulfill({
          status: 400,
          json: {
            error: {
              code: 'VALIDATION:INPUT:INVALID',
              fields: ['defaultDays'],
              message: 'private backend text',
            },
          },
        });
      });
      await page.goto('/admin/invoices');
      await expect(page.locator('html')).toHaveClass(darkMode ? /dark/ : /^(?!.*dark)/);
      const deadline = page.locator('#invoice-deadline-panel'),
        lookup = deadline.locator('#invoice-id');
      await lookup.fill('invalid');
      await lookup.blur();
      await expect(lookup).toHaveAttribute('aria-invalid', 'true');
      await deadline.getByRole('button', { name: text('load'), exact: true }).click();
      await expect(lookup).toBeFocused();
      await lookup.fill(invoiceId);
      await deadline.getByRole('button', { name: text('load'), exact: true }).click();
      const due = deadline.locator('#due-at'),
        reason = deadline.locator('#override-reason');
      await expect(due).toHaveValue('2026-09-12T13:30');
      await reason.fill(' raw reason ');
      const submit = deadline.getByRole('button', { name: text('submit'), exact: true });
      await submit.click();
      await expect(due).toBeFocused();
      expect(deadlineWrites).toBe(0);
      await due.fill('2026-09-20T13:30');
      await submit.click();
      await expect(reason).toBeFocused();
      await expect(reason).toHaveAttribute('aria-invalid', 'true');
      await expect(reason).toHaveValue(' raw reason ');
      await expect(deadline).not.toContainText('private backend text');
      readStatus = 503;
      await deadline.getByRole('button', { name: text('load'), exact: true }).click();
      await expect(deadline.getByText(text('error.load'), { exact: true })).toBeVisible();
      await expect(reason).toHaveValue(' raw reason ');
      await expect(submit).toBeDisabled();
      readStatus = 200;
      await deadline.getByRole('button', { name: text('load'), exact: true }).click();
      await expect(submit).toBeEnabled();
      await expect(reason).toHaveValue(' raw reason ');
      const panel = page.locator('#invoice-due-periods'),
        days = panel.locator('#due-period-days');
      await days.fill('0');
      await days.blur();
      await expect(days).toHaveAttribute('aria-invalid', 'true');
      const save = panel.getByRole('button', { name: dueText('save'), exact: true });
      await save.click();
      await expect(days).toBeFocused();
      expect(settingWrites).toBe(0);
      await days.fill(locale === 'fa' ? '۱۴' : '14');
      await save.click();
      await expect(days).toBeFocused();
      await expect(days).toHaveAttribute('aria-invalid', 'true');
      await expect(panel).not.toContainText('private backend text');
      readStatus = 503;
      await panel.getByRole('button', { name: dueText('load'), exact: true }).click();
      await expect(days).toBeDisabled();
      await expect(days).toHaveValue(locale === 'fa' ? '۱۴' : '14');
      readStatus = 200;
      await panel.getByRole('button', { name: dueText('load'), exact: true }).click();
      await expect(save).toBeEnabled();
      await expect(days).toHaveValue(locale === 'fa' ? '۱۴' : '14');
      expect(
        (
          await new AxeBuilder({ page })
            .include('#invoice-deadline-panel')
            .include('#invoice-due-periods')
            .analyze()
        ).violations
      ).toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true);
      if (locale === 'fa' && darkMode && test.info().project.name === 'mobile-safari') {
        await panel.scrollIntoViewIfNeeded();
        await page.screenshot({ path: '/tmp/barghsa-deadline-forms-fa-dark-mobile.png' });
      }
      readStatus = 403;
      await panel.getByRole('button', { name: dueText('load'), exact: true }).click();
      await expect(days).toHaveCount(0);
      await deadline.getByRole('button', { name: text('load'), exact: true }).click();
      await expect(reason).toHaveCount(0);
      readStatus = 200;
      await panel.getByRole('button', { name: dueText('load'), exact: true }).click();
      await expect(days).toHaveValue('7');
      await deadline.getByRole('button', { name: text('load'), exact: true }).click();
      await expect(reason).toHaveValue('');
    });
  }
for (const locale of ['fa', 'en'] as const)
  for (const darkMode of [false, true])
    test(`deadline forms return owned feedback after captured step-up (${locale}, dark=${darkMode})`, async ({
      page,
    }) => {
      await setup(page, locale, darkMode);
      const attempts: Record<string, unknown[]> = { deadline: [], period: [] };
      for (const [kind, path, result, fields] of [
        ['deadline', `/api/admin/invoices/${invoiceId}/due-at`, source, ['reason']],
        ['period', '/api/admin/config/invoice-due-periods', periods, ['defaultDays']],
      ] as const)
        await page.route('**' + path, (route) => {
          if (route.request().method() === 'GET') return route.fulfill({ json: result });
          attempts[kind]!.push(route.request().postDataJSON());
          return route.fulfill(
            attempts[kind]!.length === 1
              ? { status: 403, json: { error: { code: 'AUTHZ:STEP_UP_REQUIRED' } } }
              : {
                  status: 400,
                  json: {
                    error: {
                      code: 'VALIDATION:INPUT:INVALID',
                      fields,
                      message: 'private backend text',
                    },
                  },
                }
          );
        });
      await page.route('**/api/auth/step-up', (route) =>
        route.fulfill({ json: { success: true } })
      );
      await page.goto('/admin/invoices');
      await expect(page.locator('html')).toHaveClass(darkMode ? /dark/ : /^(?!.*dark)/);
      const deadline = page.locator('#invoice-deadline-panel');
      await deadline.locator('#invoice-id').fill(invoiceId);
      await deadline
        .getByRole('button', { name: t('admin.invoices.load', locale), exact: true })
        .click();
      await deadline.locator('#due-at').fill('2026-09-20T13:30');
      await deadline.locator('#override-reason').fill(' raw reason ');
      await deadline
        .getByRole('button', { name: t('admin.invoices.submit', locale), exact: true })
        .click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.locator('#team-step-up-password').fill('test-only');
      await dialog
        .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
        .click();
      await expect(dialog).toBeHidden();
      await expect(deadline.locator('#override-reason')).toBeFocused();
      await expect(deadline.locator('#override-reason')).toHaveValue(' raw reason ');
      expect(attempts.deadline).toEqual([
        { dueAt: '2026-09-20T10:00:00.000Z', reason: 'raw reason' },
        { dueAt: '2026-09-20T10:00:00.000Z', reason: 'raw reason' },
      ]);
      const panel = page.locator('#invoice-due-periods');
      await panel.locator('#due-period-days').fill(locale === 'fa' ? '۱۴' : '14');
      await panel.getByRole('button', { name: tDuePeriods('save', locale), exact: true }).click();
      await expect(dialog).toBeVisible();
      await dialog.locator('#team-step-up-password').fill('test-only');
      await dialog
        .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
        .click();
      await expect(dialog).toBeHidden();
      await expect(panel.locator('#due-period-days')).toBeFocused();
      await expect(panel.locator('#due-period-days')).toHaveValue(locale === 'fa' ? '۱۴' : '14');
      expect(attempts.period).toEqual([
        { serviceType: 'electricity', defaultDays: 14, expectedPeriodId: null },
        { serviceType: 'electricity', defaultDays: 14, expectedPeriodId: null },
      ]);
      await expect(page.locator('body')).not.toContainText('private backend text');
    });
for (const locale of ['fa', 'en'] as const)
  test(`deadline validators fail safely when their module is unavailable (${locale})`, async ({
    page,
  }) => {
    await setup(page, locale, false);
    const manifest = JSON.parse(
      await readFile(new URL('../dist/.vite/manifest.json', import.meta.url), 'utf8')
    ) as Record<string, { file: string }>;
    await page.route('**/' + manifest['src/lib/deadline-form-schemas.ts']!.file, (route) =>
      route.abort()
    );
    let writes = 0;
    await page.route(`**/api/admin/invoices/${invoiceId}/due-at`, (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: source });
      writes++;
      return route.fulfill({ json: {} });
    });
    await page.route('**/api/admin/config/invoice-due-periods', (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: periods });
      writes++;
      return route.fulfill({ json: [] });
    });
    await page.goto('/admin/invoices');
    const deadline = page.locator('#invoice-deadline-panel');
    await deadline.locator('#invoice-id').fill(invoiceId);
    await deadline
      .getByRole('button', { name: t('admin.invoices.load', locale), exact: true })
      .click();
    await deadline.locator('#due-at').fill('2026-09-20T13:30');
    await deadline.locator('#override-reason').fill(' kept reason ');
    await deadline
      .getByRole('button', { name: t('admin.invoices.submit', locale), exact: true })
      .click();
    await expect(
      deadline.getByText(t('admin.invoices.validationUnavailable', locale), { exact: true })
    ).toBeVisible();
    await expect(deadline.locator('#override-reason')).toHaveValue(' kept reason ');
    const period = page.locator('#invoice-due-periods');
    await period.locator('#due-period-days').fill('14');
    await period.getByRole('button', { name: tDuePeriods('save', locale), exact: true }).click();
    await expect(
      period.getByText(tDuePeriods('validationUnavailable', locale), { exact: true })
    ).toBeVisible();
    await expect(period.locator('#due-period-days')).toHaveValue('14');
    expect(writes).toBe(0);
  });
