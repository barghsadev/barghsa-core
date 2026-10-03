import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect } from './coverage-fixture';
import { fullNavigation } from './navigation-fixture';
import { tManualInvoice as manualText } from '../../../packages/i18n/src/manual-invoice';
import { tInvoiceCorrections as correctionText } from '../../../packages/i18n/src/invoice-corrections';
import {
  manualInvoiceReviewFixture,
  type ManualReviewCommand,
} from '../src/test/manual-invoice-review-fixture';

const profileId = '11111111-1111-4111-8111-111111111111';
const originalId = '22222222-2222-4222-8222-222222222222';
const nextId = '33333333-3333-4333-8333-333333333333';
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
}
function publicError(fields: string[]) {
  return { error: { code: 'VALIDATION:INPUT:INVALID', fields } };
}
for (const locale of ['fa', 'en'] as const)
  for (const darkMode of [false, true]) {
    const m = (key: string) => manualText('admin.manualInvoice.' + key, locale);
    const c = (key: string) => correctionText(key, locale)!;
    test(`invoice form: reordered feedback, retained drafts and corrected issuance (${locale}, dark=${darkMode})`, async ({
      page,
    }) => {
      await setup(page, locale, darkMode);
      let readStatus = 200,
        reviewStatus = 400,
        commitStatus = 400;
      const manifest = JSON.parse(
        await readFile(new URL('../dist/.vite/manifest.json', import.meta.url), 'utf8')
      ) as Record<string, { file: string }>;
      let editorLoads = 0;
      await page.route('**/' + manifest['src/components/ManualInvoiceForm.tsx']!.file, (route) => {
        editorLoads++;
        return route.continue();
      });
      const previews: ManualReviewCommand[] = [],
        commands: ManualReviewCommand[] = [];
      await page.route('**/api/admin/invoices/manual/profiles?*', (route) =>
        route.fulfill({
          status: readStatus,
          json: {
            items: [{ id: profileId, title: 'Customer', profileType: 'LEGAL' }],
            nextBefore: null,
          },
        })
      );
      await page.route('**/api/admin/invoices/manual/review', (route) => {
        const body = route.request().postDataJSON() as ManualReviewCommand;
        previews.push(body);
        return route.fulfill({
          status: reviewStatus,
          json:
            reviewStatus === 400
              ? publicError(['lineQuantity0'])
              : manualInvoiceReviewFixture(body),
        });
      });
      await page.route('**/api/admin/invoices/manual', (route) => {
        const body = route.request().postDataJSON() as ManualReviewCommand;
        commands.push(body);
        return route.fulfill({
          status: commitStatus,
          json:
            commitStatus === 400
              ? publicError(['lineUnitPrice0'])
              : {
                  invoiceId: nextId,
                  profileId,
                  state: 'Unpaid',
                  totalAmount: manualInvoiceReviewFixture(body).data.totals.total,
                },
        });
      });
      await page.goto('/admin/invoices');
      await expect(page.locator('html')).toHaveClass(darkMode ? /dark/ : /^(?!.*\bdark\b)/);
      const panel = page.locator('#manual-invoice-panel');
      await expect(panel.getByRole('button', { name: m('new'), exact: true })).toBeVisible();
      expect(editorLoads).toBe(0);
      await panel.getByRole('button', { name: m('new'), exact: true }).click();
      const customer = panel.getByRole('combobox'),
        issue = panel.getByRole('button', { name: m('issue'), exact: true });
      await expect(customer.locator('option[value="' + profileId + '"]')).toHaveCount(1);
      expect(editorLoads).toBe(1);
      await issue.click();
      await expect(customer).toBeFocused();
      await expect(customer).toHaveAttribute('aria-invalid', 'true');
      expect(previews).toHaveLength(0);
      await customer.selectOption(profileId);
      const description = panel.getByLabel(m('lineDescription'), { exact: true });
      const price = panel.getByLabel(m('unitPrice'), { exact: true });
      const quantity = panel.getByLabel(m('quantity'), { exact: true });
      await description.fill('  First line  ');
      await price.fill('۴۰');
      await panel.getByRole('button', { name: m('addLine'), exact: true }).click();
      await description.nth(1).fill('  Second line  ');
      await price.nth(1).fill('۵۰');
      const secondId = await quantity.nth(1).getAttribute('id');
      await panel.locator('[data-array-action=up]').nth(1).click();
      await issue.click();
      await expect(quantity.first()).toHaveAttribute('id', secondId!);
      await expect(quantity.first()).toBeFocused();
      await expect(quantity.first()).toHaveAttribute('aria-invalid', 'true');
      expect(previews[0]?.lines.map((line) => line.description)).toEqual([
        'Second line',
        'First line',
      ]);
      await expect(description.first()).toHaveValue('  Second line  ');
      await expect(price.first()).toHaveValue('۵۰');
      await quantity.first().fill('۲');
      readStatus = 503;
      await panel.getByRole('button', { name: m('search'), exact: true }).click();
      await expect(panel.getByRole('alert')).toContainText(m('lookup'));
      await expect(customer).toHaveValue(profileId);
      await expect(price.first()).toHaveValue('۵۰');
      await expect(issue).toBeDisabled();
      readStatus = 200;
      await panel.getByRole('button', { name: m('search'), exact: true }).click();
      await expect(issue).toBeEnabled();
      reviewStatus = 201;
      await issue.click();
      const review = page.getByRole('dialog', { name: m('manualReviewTitle') });
      await expect(review).toBeVisible();
      await review.getByRole('button', { name: m('manualReviewConfirm'), exact: true }).click();
      await expect(review).not.toBeVisible();
      await expect(price.first()).toHaveAttribute('aria-invalid', 'true');
      await expect(price.first()).toBeFocused();
      await expect(price.first()).toHaveValue('۵۰');
      await expect(price.nth(1)).toHaveValue('۴۰');
      await price.first().fill('۶۰');
      const scan = await new AxeBuilder({ page })
        .include('#manual-invoice-panel')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(scan.violations).toEqual([]);
      expect(scan.incomplete.filter((item) => item.id === 'color-contrast')).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      expect(await panel.evaluate((element) => getComputedStyle(element).direction)).toBe(
        locale === 'fa' ? 'rtl' : 'ltr'
      );
      commitStatus = 201;
      await issue.click();
      await expect(review).toBeVisible();
      await review.getByRole('button', { name: m('manualReviewConfirm'), exact: true }).click();
      await expect(panel.getByRole('status')).toContainText(nextId);
      expect(commands).toHaveLength(2);
      expect(commands[1]?.lines).toEqual([
        { description: 'Second line', quantity: 2, unitPrice: '60', vatRate: 0, isTaxable: false },
        { description: 'First line', quantity: 1, unitPrice: '40', vatRate: 0, isTaxable: false },
      ]);
    });
    test(`invoice correction form: failed reads, scope changes and denial (${locale}, dark=${darkMode})`, async ({
      page,
    }) => {
      await setup(page, locale, darkMode);
      let readStatus = 200,
        reviewStatus = 400,
        reads = 0;
      const previews: Array<Record<string, unknown>> = [];
      await page.route('**/api/admin/invoices/*/corrections', (route) => {
        expect(route.request().method()).toBe('GET');
        reads++;
        const id = route.request().url().split('/').at(-2)!;
        return route.fulfill({
          status: readStatus,
          json: {
            invoiceId: id,
            profileId,
            state: id === originalId ? 'Unpaid' : 'Paid',
            totalAmount: '1000',
            paidAmount: id === originalId ? '0' : '1000',
            lines: [
              {
                description: 'Original line',
                quantity: 1,
                unitPrice: '1000',
                vatRate: 0,
                isTaxable: false,
              },
            ],
          },
        });
      });
      await page.route('**/api/admin/invoices/*/corrections/review', (route) => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        previews.push(body);
        return route.fulfill({
          status: reviewStatus,
          json: publicError(
            body.kind === 'replacement' ? ['reason', 'lineUnitPrice0'] : ['amount']
          ),
        });
      });
      await page.goto('/admin/invoices');
      await expect(page.locator('html')).toHaveClass(darkMode ? /dark/ : /^(?!.*\bdark\b)/);
      const panel = page.locator('#invoice-corrections-panel'),
        lookup = panel.getByLabel(c('invoiceId'), { exact: true });
      const load = panel.getByRole('button', { name: c('load'), exact: true });
      await load.click();
      await expect(lookup).toBeFocused();
      await expect(lookup).toHaveAttribute('aria-invalid', 'true');
      expect(reads).toBe(0);
      await lookup.fill(originalId);
      await load.click();
      const reason = panel.getByLabel(c('reason'), { exact: true });
      await expect(reason).toBeVisible();
      const issue = panel.getByRole('button', { name: c('replacementIssue'), exact: true });
      await issue.click();
      await expect(reason).toBeFocused();
      expect(previews).toHaveLength(0);
      await reason.fill('  Retained explanation  ');
      const description = panel.getByLabel(m('lineDescription'), { exact: true }),
        price = panel.getByLabel(m('unitPrice'), { exact: true });
      await description.fill('  Retained line  ');
      await price.fill('۵۰');
      readStatus = 503;
      await load.click();
      await expect(panel.getByRole('alert')).toContainText(c('loadError'));
      await expect(reason).toHaveValue('  Retained explanation  ');
      await expect(price).toHaveValue('۵۰');
      await expect(issue).toBeDisabled();
      readStatus = 200;
      await load.click();
      await expect(issue).toBeEnabled();
      await expect(reason).toHaveValue('  Retained explanation  ');
      await issue.click();
      await expect(reason).toHaveAttribute('aria-invalid', 'true');
      await expect(price).toHaveAttribute('aria-invalid', 'true');
      await expect(price).toHaveValue('۵۰');
      await expect(description).toHaveValue('  Retained line  ');
      await lookup.fill(nextId);
      await load.click();
      await expect(reason).toHaveValue('');
      await expect(description).toHaveCount(0);
      const amount = panel.getByLabel(c('amount'), { exact: true }),
        adjust = panel.getByRole('button', { name: c('adjustmentIssue'), exact: true });
      await reason.fill('  Credit explanation  ');
      await amount.fill('-۲۵');
      await adjust.click();
      await expect(amount).toHaveAttribute('aria-invalid', 'true');
      await expect(amount).toBeFocused();
      await expect(amount).toHaveValue('-۲۵');
      await expect(reason).toHaveValue('  Credit explanation  ');
      expect(previews.at(-1)).toEqual({
        kind: 'adjustment',
        reason: 'Credit explanation',
        amount: '-25',
      });
      const scan = await new AxeBuilder({ page })
        .include('#invoice-corrections-panel')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(scan.violations).toEqual([]);
      expect(scan.incomplete.filter((item) => item.id === 'color-contrast')).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      if (locale === 'fa' && darkMode && test.info().project.name === 'mobile-safari')
        await page.screenshot({ path: '/tmp/barghsa-invoice-forms-fa-dark-mobile.png' });
      await amount.fill('-۳۰');
      reviewStatus = 403;
      await adjust.click();
      await expect(panel.getByRole('alert')).toContainText(c('denied'));
      await expect(reason).toHaveCount(0);
      await expect(amount).toHaveCount(0);
      await expect(lookup).toHaveValue('');
    });
  }
for (const locale of ['fa', 'en'] as const)
  test(`invoice forms: missing validator prevents review and lookup (${locale})`, async ({
    page,
  }) => {
    await setup(page, locale, false);
    let profileReads = 0,
      writes = 0,
      invoiceReads = 0,
      blocked = 0;
    const manifest = JSON.parse(
      await readFile(new URL('../dist/.vite/manifest.json', import.meta.url), 'utf8')
    ) as Record<string, { file: string }>;
    await page.route('**/' + manifest['src/lib/invoice-form-schemas.ts']!.file, (route) => {
      blocked++;
      return route.abort();
    });
    await page.route('**/api/admin/invoices/manual/profiles?*', (route) => {
      profileReads++;
      return route.fulfill({
        json: { items: [{ id: profileId, title: 'Customer', profileType: 'LEGAL' }] },
      });
    });
    await page.route('**/api/admin/invoices/manual/review', (route) => {
      writes++;
      return route.fulfill({ status: 500, json: {} });
    });
    await page.route('**/api/admin/invoices/*/corrections', (route) => {
      invoiceReads++;
      return route.fulfill({ status: 500, json: {} });
    });
    await page.goto('/admin/invoices');
    const m = (key: string) => manualText('admin.manualInvoice.' + key, locale);
    const manual = page.locator('#manual-invoice-panel');
    await manual.getByRole('button', { name: m('new'), exact: true }).click();
    const customer = manual.getByRole('combobox');
    await expect(customer.locator('option[value="' + profileId + '"]')).toHaveCount(1);
    await customer.selectOption(profileId);
    await manual.getByLabel(m('lineDescription'), { exact: true }).fill('  Retained line  ');
    const price = manual.getByLabel(m('unitPrice'), { exact: true });
    await price.fill('۴۰');
    await manual.getByRole('button', { name: m('issue'), exact: true }).click();
    await expect(manual.getByRole('alert')).toContainText(m('validationUnavailable'));
    await expect(price).toHaveValue('۴۰');
    await expect(customer).toHaveValue(profileId);
    const correction = page.locator('#invoice-corrections-panel');
    await correction
      .getByLabel(correctionText('invoiceId', locale)!, { exact: true })
      .fill(originalId);
    await correction
      .getByRole('button', { name: correctionText('load', locale)!, exact: true })
      .click();
    await expect(correction.getByRole('alert')).toContainText(m('validationUnavailable'));
    expect(blocked).toBeGreaterThan(0);
    expect(profileReads).toBe(1);
    expect(writes).toBe(0);
    expect(invoiceReads).toBe(0);
  });
