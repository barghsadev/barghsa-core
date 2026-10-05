import { test, expect } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { crmShell } from './crm-shell-fixture';
import { geographyText } from '@barghsa/i18n/geography';
import { ErrorCodes } from '@barghsa/shared/errors';

const province = { id: 'province-1', nameFa: 'تهران', nameEn: 'Tehran', status: 'active' };
for (const locale of ['en', 'fa'] as const) {
  const t = (key: Parameters<typeof geographyText>[0]) => geographyText(key, locale);
  test(`geography creation and editing keep owned feedback and raw drafts (${locale})`, async ({
    page,
  }, testInfo) => {
    await crmShell(page, locale);
    const writes: { method: string; body: Record<string, unknown> }[] = [];
    let release!: () => void;
    const held = new Promise<void>((done) => {
      release = done;
    });
    await page.route('**/api/admin/geography/provinces**', async (route) => {
      const method = route.request().method();
      if (method === 'GET') return route.fulfill({ json: { provinces: [province], total: 1 } });
      writes.push({ method, body: route.request().postDataJSON() });
      if (method === 'POST') await held;
      return route.fulfill({
        status: 400,
        json: {
          error: {
            code: ErrorCodes.VALIDATION_INPUT_INVALID.code,
            fields: [method === 'PATCH' ? 'status' : 'nameEn'],
            message: 'private server detail',
          },
        },
      });
    });
    await page.goto('/admin/geography');
    const add = page.getByRole('button', { name: t('add'), exact: true });
    await add.click();
    const dialog = page.getByRole('dialog');
    const nameFa = dialog.getByLabel(t('nameFa'), { exact: true });
    const nameEn = dialog.getByLabel(t('nameEn'), { exact: true });
    await dialog.getByRole('button', { name: t('create'), exact: true }).click();
    await expect(nameFa).toHaveAttribute('aria-invalid', 'true');
    await expect(nameEn).toHaveAttribute('aria-invalid', 'true');
    await expect(nameFa).toBeFocused();
    expect(writes).toHaveLength(0);
    await nameFa.fill('  تهران  ');
    await nameEn.fill('  Tehran  ');
    try {
      await dialog.locator('form').evaluate((element) => {
        element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      await expect.poll(() => writes.length).toBe(1);
      await expect(nameEn).toBeDisabled();
      await expect(dialog.getByRole('button', { name: t('cancel'), exact: true })).toBeDisabled();
      expect(writes[0]).toEqual({ method: 'POST', body: { nameFa: 'تهران', nameEn: 'Tehran' } });
    } finally {
      release();
    }
    await expect(nameEn).toHaveAttribute('aria-invalid', 'true');
    await expect(nameEn).toBeFocused();
    await expect(nameEn).toHaveValue('  Tehran  ');
    await expect(nameFa).toHaveValue('  تهران  ');
    await expect(dialog).not.toContainText('private server detail');
    expect(
      (await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations
    ).toEqual([]);
    await dialog.screenshot({ path: testInfo.outputPath('geography-name-feedback.png') });
    await dialog.getByRole('button', { name: t('cancel'), exact: true }).click();
    await expect(add).toBeFocused();
    await page
      .locator('table:visible tbody tr, ol[role=list]:visible > li')
      .filter({ hasText: 'Tehran' })
      .getByRole('button', { name: t('edit'), exact: true })
      .click();
    const status = dialog.getByLabel(t('status'), { exact: true });
    await status.selectOption('inactive');
    await dialog.getByRole('button', { name: t('save'), exact: true }).click();
    await expect(status).toHaveAttribute('aria-invalid', 'true');
    await expect(status).toBeFocused();
    await expect(status).toHaveValue('inactive');
    expect(writes[1]).toEqual({
      method: 'PATCH',
      body: { nameFa: 'تهران', nameEn: 'Tehran', status: 'inactive' },
    });
    const box = await dialog.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(
      (await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations
    ).toEqual([]);
    await dialog.screenshot({ path: testInfo.outputPath('geography-status-feedback.png') });
  });
  test(`city import validates rows, preserves the draft and focuses owned rejection (${locale})`, async ({
    page,
  }, testInfo) => {
    await crmShell(page, locale);
    const writes: { path: string; body: unknown }[] = [];
    await page.route('**/api/admin/geography/provinces**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() === 'GET')
        return route.fulfill({
          json: path.endsWith('/cities')
            ? { cities: [], total: 0 }
            : { provinces: [province], total: 1 },
        });
      writes.push({ path, body: route.request().postDataJSON() });
      return route.fulfill({
        status: 400,
        json: {
          error: {
            code: ErrorCodes.VALIDATION_INPUT_INVALID.code,
            fields: ['cities'],
            message: 'private import detail',
          },
        },
      });
    });
    await page.goto('/admin/geography');
    await page.getByRole('button', { name: t('cities'), exact: true }).click();
    await page.getByRole('button', { name: t('importCities'), exact: true }).click();
    const dialog = page.getByRole('dialog'),
      rows = dialog.getByLabel(t('importRows'), { exact: true });
    await rows.fill('not tab-separated');
    await dialog.getByRole('button', { name: t('importCities'), exact: true }).click();
    await expect(rows).toHaveAttribute('aria-invalid', 'true');
    await expect(rows).toBeFocused();
    expect(writes).toHaveLength(0);
    const draft = '  شهر نخست\t First City  \n شهر دوم\t Second City  ';
    await rows.fill(draft);
    await dialog.locator('form').evaluate((element) => {
      element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await expect.poll(() => writes.length).toBe(1);
    await expect(rows).toHaveAttribute('aria-invalid', 'true');
    await expect(rows).toBeFocused();
    await expect(rows).toHaveValue(draft);
    await expect(dialog).not.toContainText('private import detail');
    await rows.blur();
    await expect(rows).toHaveAttribute('aria-invalid', 'true');
    await expect(dialog.locator('[role=alert]')).toContainText(t('importInvalid'));
    expect(writes[0]).toEqual({
      path: '/api/admin/geography/provinces/province-1/cities/import',
      body: {
        cities: [
          { nameFa: 'شهر نخست', nameEn: 'First City' },
          { nameFa: 'شهر دوم', nameEn: 'Second City' },
        ],
      },
    });
    const box = await dialog.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(
      await dialog
        .locator('[role=alert]')
        .evaluateAll((alerts) => alerts.every((node) => node.scrollWidth <= node.clientWidth))
    ).toBe(true);
    expect(
      (await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations
    ).toEqual([]);
    await dialog.screenshot({ path: testInfo.outputPath('geography-import-feedback.png') });
  });
}
