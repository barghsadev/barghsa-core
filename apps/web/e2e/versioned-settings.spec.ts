import AxeBuilder from '@axe-core/playwright';
import { brandingText } from '@barghsa/i18n/branding';
import { t } from '@barghsa/i18n/admin-ui';
import { t as appText } from '@barghsa/i18n/app';
import { tVat } from '@barghsa/i18n/vat';
import { documentTemplateText } from '@barghsa/i18n/document-templates';
import { publishedBrand, previousBrand } from '../src/test/branding-settings-fixtures';
import { acceptBrandRevision, type BrandConfigDto } from '../src/lib/branding-settings';
import { electricityVatRate } from '../src/test/vat-catalogue-fixtures';
import { templateRow, templateDetail } from '../src/test/document-list-fixtures';
import { crmShell } from './crm-shell-fixture';
import { test, expect } from './coverage-fixture';
test.use({ viewport: { width: 390, height: 844 } });
for (const locale of ['en', 'fa'] as const)
  for (const darkMode of [false, true]) {
    const word = (key: string) => t(`admin.settings.${key}`, locale),
      brand = (key: Parameters<typeof brandingText>[0]) => brandingText(key, locale);
    test(`version review, recovery, rollback and exact activation (${locale}, dark=${darkMode})`, async ({
      page,
    }, info) => {
      await crmShell(page, locale);
      let current: BrandConfigDto = publishedBrand,
        history = [publishedBrand, previousBrand],
        fail = false,
        denied = false;
      const writes: unknown[] = [],
        activations: unknown[] = [];
      await page.route('**/api/public/branding/config', (route) =>
        route.fulfill({
          json: { ...history.find((row) => row.status === 'active')?.config, darkMode },
        })
      );
      await page.route('**/api/admin/branding/configs', (route) =>
        route.fulfill({ status: denied ? 403 : fail ? 503 : 200, json: history })
      );
      await page.route('**/api/admin/branding/config', (route) => {
        if (route.request().method() === 'GET') return route.fulfill({ json: current });
        const body = route.request().postDataJSON();
        writes.push(body);
        if (writes.length === 1) return route.fulfill({ json: {} });
        current = {
          ...publishedBrand,
          id: `01900000-0000-7000-8000-${String(body.expectedVersion + 1).padStart(12, '0')}`,
          status: 'draft',
          version: body.expectedVersion + 1,
          config: body.config,
        };
        history = acceptBrandRevision(history, current);
        return route.fulfill({ json: current });
      });
      await page.route('**/api/admin/branding/activate', (route) => {
        const body = route.request().postDataJSON();
        activations.push(body);
        if (activations.length === 1)
          return route.fulfill({ json: { ...current, status: 'active', id: previousBrand.id } });
        current = { ...current, status: 'active' };
        history = acceptBrandRevision(history, current);
        return route.fulfill({ json: current });
      });
      await page.goto('/admin/branding');
      const title = page.getByRole('textbox', {
        name: brand('appTitle'),
        exact: true,
        includeHidden: true,
      });
      await expect(title).toBeDisabled();
      const edit = page.getByRole('button', { name: word('edit'), exact: true });
      await edit.focus();
      await edit.press('Enter');
      await title.fill('Retained draft');
      fail = true;
      await page.getByRole('button', { name: brand('refresh'), exact: true }).click();
      await expect(page.getByRole('alert')).toContainText(word('historyError'));
      const save = page.getByRole('button', { name: brand('save'), exact: true });
      await expect(save).toBeDisabled();
      await expect(title).toHaveValue('Retained draft');
      fail = false;
      await page.getByRole('button', { name: word('retryHistory'), exact: true }).click();
      await expect(save).toBeEnabled();
      await save.click();
      const dialog = page.getByRole('dialog'),
        confirm = dialog.getByRole('button', {
          name: appText('team.confirm', locale),
          exact: true,
        });
      await confirm.click();
      await expect(dialog.getByRole('alert')).toBeVisible();
      await expect(title).toHaveValue('Retained draft');
      await expect
        .poll(() =>
          dialog.evaluate(
            (node) =>
              node.getAnimations().filter((animation) => animation.playState === 'running').length
          )
        )
        .toBe(0);
      expect(
        (await new AxeBuilder({ page }).include('[role=dialog]').analyze()).violations
      ).toEqual([]);
      await confirm.click();
      await expect(dialog).toHaveCount(0);
      expect(writes[0]).toEqual(writes[1]);
      await expect(title).toBeDisabled();
      await page.getByRole('button', { name: word('history'), exact: true }).click();
      await page.getByRole('button', { name: word('rollback'), exact: false }).click();
      await expect(dialog).toContainText(
        word('rollbackConfirm').replace('{version}', locale === 'fa' ? '۱' : '1')
      );
      await confirm.click();
      await expect(dialog).toHaveCount(0);
      expect(writes[2]).toEqual({ config: previousBrand.config, expectedVersion: 3 });
      const preview = page.getByTestId('config-preview');
      await expect(
        preview.getByRole('group', { name: word('current'), exact: true })
      ).toContainText(
        locale === 'fa' ? publishedBrand.config.appTitleFa : publishedBrand.config.appTitle
      );
      await expect(preview.getByRole('group', { name: word('draft'), exact: true })).toContainText(
        locale === 'fa' ? previousBrand.config.appTitleFa : previousBrand.config.appTitle
      );
      await page.getByRole('button', { name: brand('activate'), exact: true }).click();
      await confirm.click();
      await expect(dialog.getByRole('alert')).toBeVisible();
      await confirm.click();
      await expect(dialog).toHaveCount(0);
      expect(activations).toEqual(Array(2).fill({ draftId: current.id, expectedVersion: 4 }));
      expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      if (locale === 'fa' && info.project.name === 'mobile-safari')
        await preview.screenshot({
          path: `/tmp/barghsa-versioned-preview-${darkMode ? 'dark' : 'light'}.png`,
        });
      denied = true;
      await page.getByRole('button', { name: brand('refresh'), exact: true }).click();
      await expect(title).toHaveCount(0);
      await expect(preview).toHaveCount(0);
      await expect(page.getByRole('alert')).toContainText(word('denied'));
    });
    test(`VAT and document previews keep pending changes separate (${locale}, dark=${darkMode})`, async ({
      page,
    }) => {
      await crmShell(page, locale);
      await page.route('**/api/public/branding/config', (route) =>
        route.fulfill({ json: { ...publishedBrand.config, darkMode } })
      );
      const mutations: string[] = [];
      await page.route('**/api/admin/finance/vat', (route) => {
        if (route.request().method() !== 'GET') mutations.push(route.request().method());
        return route.fulfill({ json: [electricityVatRate] });
      });
      await page.route('**/api/admin/finance/vat/overrides', (route) =>
        route.fulfill({ json: [] })
      );
      await page.route('**/api/admin/finance/vat/products', (route) => route.fulfill({ json: [] }));
      await page.goto('/admin/vat');
      await page
        .getByRole('button', { name: tVat('admin.vat.addRate', locale), exact: true })
        .click();
      await page.locator('#vat-percent').fill('0.5');
      const preview = page.getByTestId('config-preview');
      await expect(
        preview.getByRole('group', { name: word('current'), exact: true })
      ).toContainText(new Intl.NumberFormat(locale, { style: 'percent' }).format(0.09));
      await expect(preview.getByRole('group', { name: word('draft'), exact: true })).toContainText(
        new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(0.005)
      );
      expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
      await page.route('**/api/admin/document-templates?**', (route) =>
        route.fulfill({ json: [templateRow] })
      );
      await page.route(`**/api/admin/document-templates/${templateRow.id}`, (route) => {
        if (route.request().method() !== 'GET') mutations.push(route.request().method());
        return route.fulfill({ json: templateDetail });
      });
      await page.goto('/admin/document-templates');
      const doc = (key: Parameters<typeof documentTemplateText>[0]) =>
        documentTemplateText(key, locale);
      await page.getByRole('button', { name: new RegExp(templateRow.title), exact: true }).click();
      await page.getByRole('button', { name: doc('edit'), exact: true }).click();
      await page.locator('#document-template-title').fill('Pending title');
      await page.locator('#document-template-description').fill('<script>pending content</script>');
      const metadata = page
        .getByRole('form', { name: doc('edit'), exact: true })
        .getByTestId('config-preview');
      await expect(
        metadata.getByRole('group', { name: word('current'), exact: true })
      ).toContainText(templateRow.title);
      await expect(metadata.getByRole('group', { name: word('draft'), exact: true })).toContainText(
        '<script>pending content</script>'
      );
      await expect(metadata.locator('script')).toHaveCount(0);
      await page.locator('#document-template-files').setInputFiles({
        name: 'pending.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.7'),
      });
      await expect(
        page
          .getByTestId('config-preview')
          .last()
          .getByRole('group', { name: word('draft'), exact: true })
      ).toContainText('pending.pdf');
      expect(mutations).toEqual([]);
      expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
    });
  }
