import AxeBuilder from '@axe-core/playwright';
import { geographyText } from '@barghsa/i18n/geography';
import { test, expect } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import {
  recoveryProvince as province,
  recoveryCity as city,
} from '../src/test/geography-recovery-fixtures';

for (const locale of ['en', 'fa'] as const) {
  const t = (key: Parameters<typeof geographyText>[0]) => geographyText(key, locale);
  test(`geography cards open a city workspace and preserve breakpoint drafts (${locale})`, async ({
    page,
  }, info) => {
    await crmShell(page, locale);
    await page.route('**/api/user/settings/locale', (route) => route.fulfill({ json: { locale } }));
    let cityReads = 0,
      writes = 0;
    await page.route('**/api/admin/geography/**', (route) => {
      if (route.request().method() !== 'GET') {
        writes++;
        return route.fulfill({ status: 500, json: {} });
      }
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/p1')) return route.fulfill({ json: province });
      if (path.endsWith('/cities/c1')) return route.fulfill({ json: city });
      if (path.endsWith('/cities')) {
        cityReads++;
        return route.fulfill({ json: { cities: [city], total: 1 } });
      }
      const provinces = [
        province,
        ...Array.from({ length: 19 }, (_, index) => ({
          ...province,
          id: `other-${index}`,
          nameFa: 'استان دیگر',
          nameEn: 'Other Province',
        })),
      ];
      return route.fulfill({ json: { provinces, total: provinces.length } });
    });
    await page.goto('/admin/geography');
    await page.setViewportSize({ width: 390, height: 844 });
    const provinces = page.getByRole('list', { name: t('title'), exact: true });
    const provinceCard = provinces.getByRole('listitem').filter({ hasText: province.nameEn });
    await expect(provinceCard).toContainText(province.nameFa);
    await expect(provinceCard).toContainText(province.nameEn);
    const expand = provinceCard.getByRole('link', { name: t('cities'), exact: true });
    if (locale === 'fa' && info.project.name === 'mobile-safari') {
      await provinceCard.screenshot({ path: test.info().outputPath('province-card-fa.png') });
    }
    await expand.click();
    await expect(page).toHaveURL('/admin/geography/provinces/p1');
    const workspace = page.locator('#cities-p1');
    const cityHeading = page.getByRole('main').getByRole('heading', { level: 1 });
    await expect(cityHeading).toBeFocused();
    await expect(cityHeading).toBeInViewport();
    const cityCard = workspace
      .getByRole('list', { name: t('cities'), exact: true })
      .getByRole('listitem');
    await expect(workspace).toHaveCount(1);
    await expect(cityCard).toContainText(city.nameFa);
    await expect(cityCard).toContainText(city.nameEn);
    expect(cityReads).toBe(1);
    expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    if (locale === 'fa' && info.project.name === 'mobile-safari') {
      await cityCard.screenshot({
        path: test.info().outputPath('city-card-fa.png'),
      });
    }
    const edit = cityCard.getByRole('link', { name: t('edit'), exact: true });
    await edit.click();
    const form = page.getByRole('form', { name: t('editCity'), exact: true });
    const name = form.getByLabel(t('nameEn'), { exact: true });
    await name.fill('  Retained city  ');
    await page.setViewportSize({ width: 1100, height: 900 });
    await expect(name).toHaveValue('  Retained city  ');
    await expect(form).toHaveCount(1);
    await expect(workspace).toHaveCount(0);
    expect(cityReads).toBe(1);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(name).toHaveValue('  Retained city  ');
    await form.getByRole('button', { name: t('cancel'), exact: true }).click();
    await expect(page).toHaveURL('/admin/geography/provinces/p1/cities/c1');
    await page
      .getByRole('main')
      .getByRole('link', { name: locale === 'fa' ? province.nameFa : province.nameEn, exact: true })
      .click();
    await workspace.getByRole('link', { name: t('importCities'), exact: true }).click();
    const importForm = page.getByRole('form', { name: t('importCities'), exact: true });
    const rows = importForm.getByLabel(t('importRows'), { exact: true });
    const draft = '  شهر نخست\t First City  \n شهر دوم\t Second City  ';
    await rows.fill(draft);
    await page.setViewportSize({ width: 1100, height: 900 });
    await expect(rows).toHaveValue(draft);
    await expect(importForm).toHaveCount(1);
    expect(cityReads).toBe(2);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(rows).toHaveValue(draft);
    await importForm.getByRole('button', { name: t('cancel'), exact: true }).click();
    expect(writes).toBe(0);
    await expect(cityCard).toBeVisible();
    expect(cityReads).toBe(3);
    await page
      .getByRole('main')
      .getByRole('link', { name: t('title'), exact: true })
      .click();
    await expect(workspace).toHaveCount(0);
    await expect(expand).toBeVisible();
    await page.setViewportSize({ width: 800, height: 844 });
    await expect(page.getByRole('table')).toHaveCount(1);
    const viewport = page
      .locator('[role=region][tabindex="0"]')
      .filter({ has: page.getByRole('table', { name: t('title'), exact: true }) });
    // Exercise keyboard overflow in a narrow desktop host; these short records otherwise fit.
    await viewport.evaluate((node) => {
      node.style.maxWidth = '24rem';
    });
    await viewport.focus();
    await viewport.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
    await expect
      .poll(() => viewport.evaluate((node) => Math.abs(node.scrollLeft)))
      .toBeGreaterThan(0);
    await expect(
      page
        .getByRole('table')
        .first()
        .getByRole('rowheader', {
          name: locale === 'fa' ? province.nameFa : province.nameEn,
          exact: true,
        })
    ).toBeVisible();
    expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
  });

  test(`geography cards retain failed reads and clear denied private work (${locale})`, async ({
    page,
  }) => {
    await crmShell(page, locale);
    await page.route('**/api/user/settings/locale', (route) => route.fulfill({ json: { locale } }));
    let status = 200,
      cityReads = 0;
    await page.route('**/api/admin/geography/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/p1')) return route.fulfill({ status, json: province });
      if (path.endsWith('/cities')) {
        cityReads++;
        return route.fulfill({ json: { cities: [city], total: 1 } });
      }
      return route.fulfill({ status, json: { provinces: [province], total: 1 } });
    });
    await page.goto('/admin/geography');
    await page.setViewportSize({ width: 390, height: 844 });
    const provinceCard = page
      .getByRole('list', { name: t('title'), exact: true })
      .getByRole('listitem');
    await provinceCard.getByRole('link', { name: t('cities'), exact: true }).click();
    const workspace = page.locator('#cities-p1');
    const cityCard = workspace
      .getByRole('list', { name: t('cities'), exact: true })
      .getByRole('listitem');
    await expect(cityCard).toContainText(city.nameEn);
    const refresh = page.getByRole('button', { name: t('provinceRetry'), exact: true });
    status = 503;
    await refresh.click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(cityCard.getByRole('button', { name: t('edit'), exact: true })).toBeDisabled();
    await expect(cityCard).toContainText(city.nameEn);
    status = 200;
    await refresh.click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(cityCard.getByRole('link', { name: t('edit'), exact: true })).toBeVisible();
    expect(cityReads).toBe(1);
    status = 403;
    await refresh.click();
    await expect(workspace).toHaveCount(0);
    await expect(page.locator('table')).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText(t('denied'));
  });
}
