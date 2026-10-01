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
async function inspect(page: Page, name: string, locale: string, project: string, dialog = false) {
  const popup = page.getByRole('dialog');
  if (dialog) {
    await popup.evaluate(async (node) => {
      await Promise.all(
        node.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {}))
      );
    });
  }
  const scan = await new AxeBuilder({ page })
    .include(dialog ? '[role="dialog"]' : 'main')
    .analyze();
  expect(scan.violations).toEqual([]);
  if (dialog) {
    // Wrapped description/alert text can appear partially obscured to Axe.
    // Verify every reported text node against its opaque dialog background and
    // hit-test its visible lines rather than assuming one affected node.
    for (const item of scan.incomplete.filter((item) => item.id === 'color-contrast')) {
      for (const reported of item.nodes) {
        expect(reported.html).toMatch(/data-slot="dialog-description"|role="alert"/);
        const measured = await popup.locator(reported.target[0] as string).evaluate((node) => {
          const popup = node.closest('[role="dialog"]')!;
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 1;
          const ctx = canvas.getContext('2d')!;
          const color = (value: string) => {
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = value;
            ctx.fillRect(0, 0, 1, 1);
            return Array.from(ctx.getImageData(0, 0, 1, 1).data);
          };
          const fg = color(getComputedStyle(node).color),
            bg = color(getComputedStyle(popup).backgroundColor);
          const luminance = (rgb: number[]) =>
            rgb.slice(0, 3).reduce((sum, value, index) => {
              const s = value / 255;
              return (
                sum +
                [0.2126, 0.7152, 0.0722][index]! *
                  (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4)
              );
            }, 0);
          const f = luminance(fg),
            b = luminance(bg);
          const range = document.createRange();
          range.selectNodeContents(node);
          const unobscured = Array.from(range.getClientRects()).every((rect) =>
            node.contains(
              document.elementFromPoint(
                rect.x + Math.min(10, rect.width / 2),
                rect.y + rect.height / 2
              )
            )
          );
          let opaque = true;
          for (let ancestor: Element | null = node; ancestor; ancestor = ancestor.parentElement)
            if (getComputedStyle(ancestor).opacity !== '1') opaque = false;
          return {
            ratio: (Math.max(f, b) + 0.05) / (Math.min(f, b) + 0.05),
            fg,
            bg,
            unobscured,
            opaque,
          };
        });
        expect(measured.fg[3]).toBe(255);
        expect(measured.bg[3]).toBe(255);
        expect(measured.opaque).toBe(true);
        expect(measured.unobscured).toBe(true);
        expect(measured.ratio).toBeGreaterThanOrEqual(4.5);
      }
    }
  } else {
    await verifyClippedContrast(page, scan);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (locale === 'fa' && project === 'mobile-safari')
    await page.screenshot({
      path: `/tmp/barghsa-geography-${name}-fa-mobile-safari.png`,
      fullPage: true,
    });
}
for (const [locale, darkMode] of [
  ['en', false],
  ['fa', false],
  ['en', true],
  ['fa', true],
] as const) {
  const word = (key: Parameters<typeof geographyText>[0]) => geographyText(key, locale);
  test(`province page recovery retains expanded cities and exact request (${locale}, dark=${darkMode})`, async ({
    page,
  }, info) => {
    await shell(page, locale, darkMode);
    let fail = false,
      denied = false,
      cityReads = 0;
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
    await page.route('**/api/admin/geography/provinces/p1/cities?*', (route) => {
      cityReads++;
      return route.fulfill({ json: { cities: [city], total: 1 } });
    });
    await page.goto('/admin/geography');
    await page.getByRole('button', { name: word('cities'), exact: true }).click();
    await expect(page.getByRole('cell', { name: 'Rey', exact: true })).toBeVisible();
    const viewport = page.locator('[data-slot="scroll-area-viewport"]').first();
    await viewport.focus();
    await viewport.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
    await expect
      .poll(() => viewport.evaluate((node) => Math.abs(node.scrollLeft)))
      .toBeGreaterThan(0);
    fail = true;
    await page.getByRole('button', { name: word('next'), exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Rey', exact: true })).toBeVisible();
    const failed = queries.at(-1);
    expect(new URL(failed!).searchParams.get('page')).toBe('2');
    await inspect(page, `lists-${darkMode ? 'dark' : 'light'}`, locale, info.project.name);
    fail = false;
    await page.getByRole('button', { name: word('retry'), exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(queries.at(-1)).toBe(failed);
    expect(cityReads).toBe(1);
    await expect(page.getByRole('cell', { name: 'Other province', exact: true })).toBeVisible();
    denied = true;
    await page
      .getByRole('button', { name: word('refresh'), exact: true })
      .first()
      .click();
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText(word('denied'));
  });
  test(`province editor preserves drafts through local recovery and rejects fresh metadata (${locale}, dark=${darkMode})`, async ({
    page,
  }, info) => {
    await shell(page, locale, darkMode);
    let fail = false,
      changed = false;
    await page.route('**/api/admin/geography/provinces?*', (route) =>
      route.fulfill({
        status: fail ? 503 : 200,
        json: {
          provinces: [{ ...province, nameEn: changed ? 'Changed Province' : province.nameEn }],
          total: 1,
        },
      })
    );
    await page.goto('/admin/geography');
    await page.getByRole('button', { name: word('edit'), exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('#province-name-en').fill('Unsaved Province');
    fail = true;
    await dialog.getByRole('button', { name: word('provinceRetry'), exact: true }).click();
    await expect(dialog.getByRole('button', { name: word('save'), exact: true })).toBeDisabled();
    await expect(dialog.locator('#province-name-en')).toHaveValue('Unsaved Province');
    await inspect(page, `edit-${darkMode ? 'dark' : 'light'}`, locale, info.project.name, true);
    fail = false;
    await dialog.getByRole('button', { name: word('provinceRetry'), exact: true }).click();
    await expect(dialog.getByRole('button', { name: word('save'), exact: true })).toBeEnabled();
    await expect(dialog.locator('#province-name-en')).toHaveValue('Unsaved Province');
    changed = true;
    await dialog.getByRole('button', { name: word('provinceRetry'), exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('cell', { name: 'Changed Province', exact: true })).toBeVisible();
  });
  test(`city import preserves rows through independent retries and permission denial (${locale}, dark=${darkMode})`, async ({
    page,
  }, info) => {
    await shell(page, locale, darkMode);
    let fail = false,
      denied = false,
      provinceReads = 0;
    const writes: unknown[] = [];
    await page.route('**/api/admin/geography/provinces?*', (route) => {
      provinceReads++;
      return route.fulfill({ json: { provinces: [province], total: 1 } });
    });
    await page.route('**/api/admin/geography/provinces/p1/cities?*', (route) =>
      route.fulfill({ status: denied ? 403 : fail ? 503 : 200, json: { cities: [city], total: 1 } })
    );
    await page.route('**/api/admin/geography/provinces/p1/cities/import', (route) => {
      writes.push(route.request().postDataJSON());
      return route.fulfill({ status: 409, json: {} });
    });
    await page.goto('/admin/geography');
    await page.getByRole('button', { name: word('cities'), exact: true }).click();
    await page.getByRole('button', { name: word('importCities'), exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('#city-import-rows').fill('اسلامشهر\tEslamshahr');
    fail = true;
    await dialog.getByRole('button', { name: word('cityRetry'), exact: true }).click();
    await expect(
      dialog.getByRole('button', { name: word('importCities'), exact: true })
    ).toBeDisabled();
    await expect(dialog.locator('#city-import-rows')).toHaveValue('اسلامشهر\tEslamshahr');
    await inspect(page, `import-${darkMode ? 'dark' : 'light'}`, locale, info.project.name, true);
    fail = false;
    await dialog.getByRole('button', { name: word('cityRetry'), exact: true }).click();
    await expect(
      dialog.getByRole('button', { name: word('importCities'), exact: true })
    ).toBeEnabled();
    expect(provinceReads).toBe(1);
    await dialog.getByRole('button', { name: word('importCities'), exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText(word('cityConflict'));
    expect(writes).toEqual([{ cities: [{ nameFa: 'اسلامشهر', nameEn: 'Eslamshahr' }] }]);
    await expect(dialog.locator('#city-import-rows')).toHaveValue('اسلامشهر\tEslamshahr');
    denied = true;
    await dialog.getByRole('button', { name: word('cityRetry'), exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText(word('denied'));
  });
}
