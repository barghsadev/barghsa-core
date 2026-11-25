import AxeBuilder from '@axe-core/playwright';
import { geographyText } from '@barghsa/i18n/geography';
import { test, expect, type Page } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import { verifyClippedContrast } from './clipped-contrast';
import {
  recoveryProvince as province,
  recoveryCity as city,
} from '../src/test/geography-recovery-fixtures';
test.use({ viewport: { width: 390, height: 844 } });
async function shell(page: Page, locale: 'en' | 'fa', darkMode: boolean) {
  await crmShell(page, locale);
  await page.route('**/api/public/branding/config', (route) =>
    route.fulfill({
      json: {
        appTitle: 'Geography',
        appTitleFa: 'اطلاعات جغرافیایی',
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
}
async function inspect(page: Page, name: string, locale: string, project: string) {
  const scan = await new AxeBuilder({ page }).include('main').analyze();
  expect(scan.violations).toEqual([]);
  await verifyClippedContrast(page, scan);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (locale === 'fa' && project === 'mobile-safari')
    await page.screenshot({
      path: `/tmp/barghsa-geography-${name}-fa-mobile-safari.png`,
      fullPage: true,
    });
}
for (const locale of ['en', 'fa'] as const) {
  test(`province and city editors reopen from their URLs (${locale})`, async ({ page }) => {
    await shell(page, locale, false);
    const word = (key: Parameters<typeof geographyText>[0]) => geographyText(key, locale);
    await page.route('**/api/admin/geography/provinces?*', (route) =>
      route.fulfill({ json: { provinces: [province], total: 1 } })
    );
    await page.route('**/api/admin/geography/provinces/p1/cities?*', (route) =>
      route.fulfill({ json: { cities: [city], total: 1 } })
    );
    const exactReads = new Set<string>();
    await page.route('**/api/admin/geography/provinces/p1', (route) => {
      exactReads.add(new URL(route.request().url()).pathname);
      return route.fulfill({ json: province });
    });
    await page.route('**/api/admin/geography/provinces/p1/cities/c1', (route) => {
      exactReads.add(new URL(route.request().url()).pathname);
      return route.fulfill({ json: city });
    });
    await page.goto('/admin/geography');
    const provinceForm = page.getByRole('form', { name: word('editTitle'), exact: true });
    const englishName = provinceForm.getByLabel(word('nameEn'), { exact: true });
    await page.getByRole('link', { name: word('edit'), exact: true }).click();
    await expect(page).toHaveURL('/admin/geography/provinces/p1/edit');
    await englishName.fill('Local province name');
    await page.reload();
    await expect(englishName).toHaveValue(province.nameEn);
    await page.goBack();
    await expect(provinceForm).toHaveCount(0);
    await page.getByRole('link', { name: word('cities'), exact: true }).click();
    const cityWorkspace = page.locator('#cities-p1');
    await cityWorkspace.getByRole('link', { name: word('edit'), exact: true }).click();
    await expect(page).toHaveURL('/admin/geography/provinces/p1/cities/c1/edit');
    exactReads.clear();
    await page.reload();
    const cityForm = page.getByRole('form', { name: word('editCity'), exact: true });
    await expect(cityForm.getByLabel(word('nameEn'), { exact: true })).toHaveValue(city.nameEn);
    expect([...exactReads].sort()).toEqual([
      '/api/admin/geography/provinces/p1',
      '/api/admin/geography/provinces/p1/cities/c1',
    ]);
    await cityForm.getByRole('button', { name: word('cancel'), exact: true }).click();
    await expect(page).toHaveURL('/admin/geography/provinces/p1/cities/c1');
    await expect(cityForm).toHaveCount(0);
    await page
      .getByRole('main')
      .getByRole('link', { name: locale === 'fa' ? province.nameFa : province.nameEn, exact: true })
      .click();
    await expect(cityWorkspace).toBeVisible();
  });
}

for (const [locale, darkMode] of [
  ['en', false],
  ['fa', false],
  ['en', true],
  ['fa', true],
] as const) {
  const word = (key: Parameters<typeof geographyText>[0]) => geographyText(key, locale);
  test(`province list recovery retains accepted rows and the exact request (${locale}, dark=${darkMode})`, async ({
    page,
  }, info) => {
    await shell(page, locale, darkMode);
    let fail = false,
      denied = false;
    const queries: string[] = [];
    await page.route('**/api/admin/geography/provinces?*', (route) => {
      queries.push(route.request().url());
      const second = new URL(route.request().url()).searchParams.get('page') === '2';
      return route.fulfill({
        status: denied ? 403 : fail && second ? 503 : 200,
        json: {
          provinces: [{ ...province, nameEn: second ? 'Other province' : province.nameEn }],
          total: 21,
        },
      });
    });
    await page.goto('/admin/geography');
    await expect(page.getByRole('link', { name: word('cities'), exact: true })).toBeVisible();
    await page.setViewportSize({ width: 800, height: 844 });
    const viewport = page
      .locator('[role=region][tabindex="0"]')
      .filter({ has: page.getByRole('table', { name: word('title'), exact: true }) });
    // Exercise keyboard overflow in a narrow desktop host; these short records otherwise fit.
    await viewport.evaluate((node) => {
      node.style.maxWidth = '24rem';
    });
    await viewport.focus();
    await viewport.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
    await expect
      .poll(() => viewport.evaluate((node) => Math.abs(node.scrollLeft)))
      .toBeGreaterThan(0);
    await page.setViewportSize({ width: 390, height: 844 });
    fail = true;
    await page.getByRole('button', { name: word('next'), exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(
      page
        .locator('table:visible, ol[role=list]:visible')
        .getByText(province.nameEn, { exact: true })
    ).toBeVisible();
    const failed = queries.at(-1);
    expect(new URL(failed!).searchParams.get('page')).toBe('2');
    await inspect(page, `lists-${darkMode ? 'dark' : 'light'}`, locale, info.project.name);
    fail = false;
    await page.getByRole('button', { name: word('retry'), exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(queries.at(-1)).toBe(failed);
    await expect(
      page
        .locator('table:visible, ol[role=list]:visible')
        .getByText('Other province', { exact: true })
    ).toBeVisible();
    denied = true;
    await page
      .getByRole('button', { name: word('refresh'), exact: true })
      .first()
      .click();
    await expect(page.locator('table:visible, ol[role=list]:visible')).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText(word('denied'));
  });
  test(`province editor preserves drafts through local recovery and rejects fresh metadata (${locale}, dark=${darkMode})`, async ({
    page,
  }, info) => {
    await shell(page, locale, darkMode);
    let fail = false,
      changed = false;
    await page.route('**/api/admin/geography/provinces/p1', (route) =>
      route.fulfill({
        status: fail ? 503 : 200,
        json: { ...province, nameEn: changed ? 'Changed Province' : province.nameEn },
      })
    );
    await page.goto('/admin/geography/provinces/p1/edit');
    const dialog = page.getByRole('form', { name: word('editTitle'), exact: true });
    await dialog.locator('#province-name-en').fill('Unsaved Province');
    fail = true;
    await dialog.getByRole('button', { name: word('provinceRetry'), exact: true }).click();
    await expect(dialog.getByRole('button', { name: word('save'), exact: true })).toBeDisabled();
    await expect(dialog.locator('#province-name-en')).toHaveValue('Unsaved Province');
    await inspect(page, `edit-${darkMode ? 'dark' : 'light'}`, locale, info.project.name);
    fail = false;
    await dialog.getByRole('button', { name: word('provinceRetry'), exact: true }).click();
    await expect(dialog.getByRole('button', { name: word('save'), exact: true })).toBeEnabled();
    await expect(dialog.locator('#province-name-en')).toHaveValue('Unsaved Province');
    changed = true;
    await dialog.getByRole('button', { name: word('provinceRetry'), exact: true }).click();
    await expect(dialog.locator('#province-name-en')).toHaveValue('Changed Province');
  });
  test(`city import preserves rows through exact parent retries and permission denial (${locale}, dark=${darkMode})`, async ({
    page,
  }, info) => {
    await shell(page, locale, darkMode);
    let fail = false,
      denied = false,
      collectionReads = 0;
    const writes: unknown[] = [];
    await page.route('**/api/admin/geography/provinces?*', (route) => {
      collectionReads++;
      return route.fulfill({ json: { provinces: [province], total: 1 } });
    });
    await page.route('**/api/admin/geography/provinces/p1', (route) =>
      route.fulfill({ status: denied ? 403 : fail ? 503 : 200, json: province })
    );
    await page.route('**/api/admin/geography/provinces/p1/cities/import', (route) => {
      writes.push(route.request().postDataJSON());
      return route.fulfill({ status: 409, json: {} });
    });
    await page.goto('/admin/geography/provinces/p1/cities/import');
    const dialog = page.getByRole('form', { name: word('importCities'), exact: true });
    await dialog.locator('#city-import-rows').fill('اسلامشهر\tEslamshahr');
    fail = true;
    await dialog.getByRole('button', { name: word('cityRetry'), exact: true }).click();
    await expect(
      dialog.getByRole('button', { name: word('importCities'), exact: true })
    ).toBeDisabled();
    await expect(dialog.locator('#city-import-rows')).toHaveValue('اسلامشهر\tEslamshahr');
    await inspect(page, `import-${darkMode ? 'dark' : 'light'}`, locale, info.project.name);
    fail = false;
    await dialog.getByRole('button', { name: word('cityRetry'), exact: true }).click();
    await expect(
      dialog.getByRole('button', { name: word('importCities'), exact: true })
    ).toBeEnabled();
    expect(collectionReads).toBe(0);
    await dialog.getByRole('button', { name: word('importCities'), exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText(word('importConflict'));
    expect(writes).toEqual([{ cities: [{ nameFa: 'اسلامشهر', nameEn: 'Eslamshahr' }] }]);
    await expect(dialog.locator('#city-import-rows')).toHaveValue('اسلامشهر\tEslamshahr');
    denied = true;
    await dialog.getByRole('button', { name: word('cityRetry'), exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('table:visible, ol[role=list]:visible')).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText(word('denied'));
  });
}
