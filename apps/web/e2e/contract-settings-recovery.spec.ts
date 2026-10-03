import AxeBuilder from '@axe-core/playwright';
import { contractTemplatesText } from '@barghsa/i18n/contract-templates';
import { t as limitsText } from '@barghsa/i18n/admin-ui';
import { t as appText } from '@barghsa/i18n/app';
import { test, expect, type Page } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import {
  contractTemplate,
  contractTemplateDetail,
  templateVersion,
  templateId,
  electricityLimits,
} from '../src/test/contract-settings-fixtures';
test.use({ viewport: { width: 390, height: 844 } });
async function inspect(page: Page, name: string, locale: string, project: string) {
  expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (locale === 'fa' && project === 'mobile-safari')
    await page.screenshot({
      path: `/tmp/barghsa-contract-settings-${name}-fa-mobile-safari.png`,
      fullPage: true,
    });
}
for (const [locale, darkMode] of [
  ['en', false],
  ['fa', false],
  ['en', true],
  ['fa', true],
] as const) {
  const word = (key: string) => contractTemplatesText(`admin.templates.${key}`, locale),
    limit = (key: string) => limitsText(`admin.contractLimits.${key}`, locale);
  test(`template metadata and prepared upload recover independently (${locale}, dark=${darkMode})`, async ({
    page,
  }, info) => {
    await crmShell(page, locale);
    await page.route('**/api/public/branding/config', (route) =>
      route.fulfill({
        json: {
          appTitle: 'Contract settings',
          appTitleFa: 'تنظیمات قرارداد',
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
          primaryColor: '#2563eb',
          secondaryColor: '#64748b',
          accentColor: '#f59e0b',
          logoUrl: null,
          faviconUrl: null,
          darkMode,
        },
      })
    );
    let failList = false,
      failDetail = false,
      listReads = 0,
      detailReads = 0;
    await page.route('**/api/admin/contract-templates', (route) => {
      listReads++;
      return route.fulfill({ status: failList ? 503 : 200, json: [contractTemplate] });
    });
    await page.route(`**/api/admin/contract-templates/${templateId}`, (route) => {
      detailReads++;
      return route.fulfill({ status: failDetail ? 503 : 200, json: contractTemplateDetail });
    });
    await page.goto('/admin/contract-templates');
    await page
      .getByRole('button', { name: `${word('open')} ${contractTemplate.name}`, exact: true })
      .click();
    await page.locator('#template-name').fill('Keep metadata');
    await page.locator('#template-description').fill('Keep explanation');
    const picker = page.getByRole('button', { name: word('chooseFile'), exact: true });
    await picker.focus();
    const chooserPromise = page.waitForEvent('filechooser');
    await picker.press('Enter');
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: 'terms.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('{{customer}}'),
    });
    await expect(page.getByRole('button', { name: word('upload'), exact: true })).toBeEnabled();
    const before = listReads;
    await page
      .getByRole('button', { name: `${word('open')} ${contractTemplate.name}`, exact: true })
      .click();
    expect(listReads).toBe(before);
    failList = true;
    await page.getByRole('button', { name: word('refresh'), exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.locator('#template-name')).toHaveValue('Keep metadata');
    await expect(page.getByText('terms.txt', { exact: true })).toBeVisible();
    await inspect(page, `template-${darkMode ? 'dark' : 'light'}`, locale, info.project.name);
    failList = false;
    const detailBefore = detailReads;
    await page.getByRole('button', { name: word('listRetry'), exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(detailReads).toBe(detailBefore);
    failDetail = true;
    await page.getByRole('button', { name: word('refresh'), exact: true }).click();
    await expect(page.getByRole('button', { name: word('upload'), exact: true })).toBeDisabled();
    await expect(page.locator('#template-description')).toHaveValue('Keep explanation');
    failDetail = false;
    const listBefore = listReads;
    await page.getByRole('button', { name: word('detailRetry'), exact: true }).click();
    await expect(page.getByRole('button', { name: word('upload'), exact: true })).toBeEnabled();
    expect(listReads).toBe(listBefore);
  });
  test(`template confirmation preserves prepared version and rejects changed history (${locale}, dark=${darkMode})`, async ({
    page,
  }) => {
    await crmShell(page, locale);
    await page.route('**/api/public/branding/config', (route) =>
      route.fulfill({
        json: {
          appTitle: 'Contract settings',
          appTitleFa: 'تنظیمات قرارداد',
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
          primaryColor: '#2563eb',
          secondaryColor: '#64748b',
          accentColor: '#f59e0b',
          logoUrl: null,
          faviconUrl: null,
          darkMode,
        },
      })
    );
    let failDetail = false,
      changed = false,
      denied = false;
    await page.route('**/api/admin/contract-templates', (route) =>
      route.fulfill({ status: denied ? 403 : 200, json: [contractTemplate] })
    );
    await page.route(`**/api/admin/contract-templates/${templateId}`, (route) =>
      route.fulfill({
        status: failDetail ? 503 : 200,
        json: changed
          ? {
              ...contractTemplateDetail,
              versionCount: 1,
              latestVersion: templateVersion,
              versions: [templateVersion],
            }
          : contractTemplateDetail,
      })
    );
    await page.goto('/admin/contract-templates');
    await page
      .getByRole('button', { name: `${word('open')} ${contractTemplate.name}`, exact: true })
      .click();
    await page.locator('#template-name').fill('Keep draft');
    await page
      .locator('#template-file')
      .setInputFiles({ name: 'new.txt', mimeType: 'text/plain', buffer: Buffer.from('new terms') });
    await page.getByRole('button', { name: word('upload'), exact: true }).click();
    const dialog = page.getByRole('dialog'),
      confirm = dialog.getByRole('button', { name: appText('team.confirm', locale), exact: true });
    failDetail = true;
    await dialog.getByRole('button', { name: word('refresh'), exact: true }).click();
    await expect(confirm).toBeDisabled();
    failDetail = false;
    await dialog.getByRole('button', { name: word('detailRetry'), exact: true }).click();
    await expect(confirm).toBeEnabled();
    changed = true;
    await dialog.getByRole('button', { name: word('refresh'), exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('#template-name')).toHaveValue('Keep draft');
    await expect(page.getByText('new.txt', { exact: true })).toBeVisible();
    await expect(page.getByText('terms.txt', { exact: true })).toBeVisible();
    denied = true;
    await page.getByRole('button', { name: word('refresh'), exact: true }).click();
    await expect(page.locator('#template-name')).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText(word('denied'));
    await expect(page.getByText('new.txt', { exact: true })).toHaveCount(0);
  });
  test(`contract limit confirmation recovers its frozen values and rejects fresh changes (${locale}, dark=${darkMode})`, async ({
    page,
  }, info) => {
    await crmShell(page, locale);
    await page.route('**/api/public/branding/config', (route) =>
      route.fulfill({
        json: {
          appTitle: 'Contract settings',
          appTitleFa: 'تنظیمات قرارداد',
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
          primaryColor: '#2563eb',
          secondaryColor: '#64748b',
          accentColor: '#f59e0b',
          logoUrl: null,
          faviconUrl: null,
          darkMode,
        },
      })
    );
    let fail = false,
      changed = false,
      denied = false;
    await page.route('**/api/admin/config/contract-electricity-limits', (route) =>
      route.fulfill({
        status: denied ? 403 : fail ? 503 : 200,
        json: { ...electricityLimits, leadTimeDays: changed ? 7 : 0 },
      })
    );
    await page.goto('/admin/contract-limits');
    const lead = page.locator('#contract-limit-leadTimeDays');
    await lead.fill('14');
    fail = true;
    await page.getByRole('button', { name: limit('refresh'), exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(lead).toHaveValue('14');
    await inspect(page, `limits-${darkMode ? 'dark' : 'light'}`, locale, info.project.name);
    fail = false;
    await page.getByRole('button', { name: limit('retry'), exact: true }).click();
    await page.getByRole('button', { name: limit('save'), exact: true }).click();
    const dialog = page.getByRole('dialog'),
      confirm = dialog.getByRole('button', { name: appText('team.confirm', locale), exact: true });
    fail = true;
    await dialog.getByRole('button', { name: limit('refresh'), exact: true }).click();
    await expect(confirm).toBeDisabled();
    fail = false;
    await dialog.getByRole('button', { name: limit('retry'), exact: true }).click();
    await expect(confirm).toBeEnabled();
    changed = true;
    await dialog.getByRole('button', { name: limit('refresh'), exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(lead).toHaveValue('7');
    denied = true;
    await page.getByRole('button', { name: limit('refresh'), exact: true }).click();
    await expect(page.locator('input[id^="contract-limit-"]')).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText(limit('forbidden'));
  });
}
