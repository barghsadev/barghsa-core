import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { contractTemplatesText } from '@barghsa/i18n/contract-templates';
import { contentFormText } from '@barghsa/i18n/content-forms';
import { adminTosText } from '../src/pages/admin-tos-text';
import { termsVersion } from '../src/test/content-catalogue-fixtures';
import {
  contractTemplate,
  contractTemplateDetail,
  templateId,
} from '../src/test/contract-settings-fixtures';
import AxeBuilder from '@axe-core/playwright';
import { measureControlContrast } from './control-contrast';

test.use({ viewport: { width: 390, height: 844 } });
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true]) {
    test(`saved terms links and active formatting stay readable (${locale}, ${dark ? 'dark' : 'light'})`, async ({
      page,
    }, info) => {
      await setupCatalogueForms(page, locale, dark);
      const text = adminTosText(locale);
      await page.route('**/api/admin/tos/versions', (route) =>
        route.fulfill({
          json: [{ ...termsVersion(), contentEn: '[Barghsa help](https://example.test/help)' }],
        })
      );
      await page.goto('/admin/tos');
      await expect(page.locator('html')).toHaveClass(dark ? /\bdark\b/ : /^(?!.*\bdark\b)/);
      await page.getByRole('button', { name: text.edit, exact: true }).click();
      const editor = page.getByRole('textbox', { name: text.english, exact: true });
      const link = editor.getByRole('link', { name: 'Barghsa help' });
      await expect(link).toHaveAttribute('href', 'https://example.test/help');
      const bold = page
        .getByRole('group', { name: `${text.english}: ${text.formatting}`, exact: true })
        .getByRole('button', { name: text.bold, exact: true });
      await bold.click();
      await expect(bold).toHaveAttribute('aria-pressed', 'true');
      const measurements = [];
      for (const highContrast of [false, true]) {
        await page.locator('html').evaluate((root, enabled) => {
          if (enabled) root.dataset.contrast = 'more';
          else delete root.dataset.contrast;
        }, highContrast);
        const linkText = await measureControlContrast(link, 'text');
        const activeText = await measureControlContrast(bold, 'text');
        const activeBoundary = await measureControlContrast(bold, 'boundary');
        measurements.push({ highContrast, linkText, activeText, activeBoundary });
        expect.soft(linkText, `link, high contrast=${highContrast}`).toBeGreaterThanOrEqual(4.5);
        expect
          .soft(activeText, `active formatting text, high contrast=${highContrast}`)
          .toBeGreaterThanOrEqual(4.5);
        expect
          .soft(activeBoundary, `active formatting boundary, high contrast=${highContrast}`)
          .toBeGreaterThanOrEqual(3);
      }
      await info.attach('terms-editor-contrast', {
        body: JSON.stringify({ locale, dark, measurements }),
        contentType: 'application/json',
      });
    });

    test(`content forms link rich-text feedback and preserve content (${locale}, ${dark ? 'dark' : 'light'})`, async ({
      page,
    }, info) => {
      await setupCatalogueForms(page, locale, dark);
      const text = adminTosText(locale),
        word = (key: string) => contractTemplatesText(`admin.templates.${key}`, locale);
      const termsWrites: unknown[] = [],
        templateWrites: unknown[] = [];
      let terms = [] as ReturnType<typeof termsVersion>[],
        template = { ...contractTemplate },
        invalid = true;
      await page.route('**/api/admin/tos/versions', (route) => {
        if (route.request().method() === 'GET') return route.fulfill({ json: terms });
        const body = route.request().postDataJSON();
        termsWrites.push(body);
        if (invalid)
          return route.fulfill({
            status: 400,
            json: { error: { fields: ['contentFa'], message: 'private-untrusted-content' } },
          });
        terms = [{ ...termsVersion(), ...body }];
        return route.fulfill({ status: 201, json: terms[0] });
      });
      await page.goto('/admin/tos');
      await page.getByRole('button', { name: text.newDraft, exact: true }).click();
      const form = page.locator('form'),
        id = page.locator('#admintospage-field-1'),
        fa = form.getByRole('textbox', { name: text.persian, exact: true }),
        en = form.getByRole('textbox', { name: text.english, exact: true });
      await en.fill('Retained English terms');
      await form.getByRole('button', { name: text.createDraft, exact: true }).click();
      await expect(id).toBeFocused();
      await expect(id).toHaveAttribute('aria-invalid', 'true');
      expect(termsWrites).toHaveLength(0);
      await id.fill('v2');
      await form.getByRole('button', { name: text.createDraft, exact: true }).click();
      await expect(fa).toBeFocused();
      await expect(fa).toHaveAttribute('aria-invalid', 'true');
      await expect(en).toContainText('Retained English terms');
      await fa.fill('شرایط محلی');
      await form.getByRole('button', { name: text.createDraft, exact: true }).click();
      await expect(fa).toBeFocused();
      await expect(form).not.toContainText('private-untrusted-content');
      expect(termsWrites).toHaveLength(1);
      const errorId = await fa.getAttribute('aria-describedby');
      expect(errorId).toBeTruthy();
      await expect(page.locator(`[id="${errorId}"]`)).toContainText(
        contentFormText('contentFa', locale)
      );
      expect((await new AxeBuilder({ page }).include('form').analyze()).violations).toEqual([]);
      if (locale === 'fa' && dark)
        await form.screenshot({ path: `/tmp/barghsa-terms-form-fa-dark-${info.project.name}.png` });
      invalid = false;
      await fa.fill('شرایط اصلاح‌شده');
      await form.getByRole('button', { name: text.createDraft, exact: true }).click();
      await expect(form).toHaveCount(0);
      expect(termsWrites).toHaveLength(2);
      await page.route('**/api/admin/contract-templates', (route) =>
        route.fulfill({ json: [template] })
      );
      await page.route(`**/api/admin/contract-templates/${templateId}`, (route) => {
        if (route.request().method() === 'GET')
          return route.fulfill({ json: { ...contractTemplateDetail, ...template } });
        const body = route.request().postDataJSON();
        templateWrites.push(body);
        if (templateWrites.length === 1)
          return route.fulfill({
            status: 400,
            json: {
              error: {
                code: 'VALIDATION:INPUT:INVALID',
                fields: ['description'],
                message: 'private-untrusted-content',
              },
            },
          });
        template = { ...template, ...body };
        return route.fulfill({ json: template });
      });
      await page.goto('/admin/contract-templates');
      await page
        .getByRole('button', { name: `${word('open')} ${template.name}`, exact: true })
        .click();
      const name = page.locator('#template-name'),
        description = page.locator('#template-description');
      await description.fill('Retained description');
      await name.fill(' ');
      await page.locator('form button[type=submit]').click();
      await expect(name).toBeFocused();
      expect(templateWrites).toHaveLength(0);
      await name.fill('Local contract template');
      await page.locator('form button[type=submit]').click();
      const confirm = () =>
        page
          .getByRole('dialog')
          .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
          .click();
      await confirm();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(description).toBeFocused();
      await expect(name).toHaveValue('Local contract template');
      await expect(description).toHaveValue('Retained description');
      expect((await new AxeBuilder({ page }).include('form').analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      if (locale === 'fa' && dark)
        await page.locator('form').screenshot({
          path: `/tmp/barghsa-contract-template-form-fa-dark-${info.project.name}.png`,
        });
      await description.fill('Corrected description');
      await page.locator('form button[type=submit]').click();
      await confirm();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByRole('status').filter({ hasText: word('saved') })).toBeVisible();
      expect(templateWrites).toHaveLength(2);
    });
  }
for (const locale of ['en', 'fa'] as const)
  test(`content unverified saves require recovery and reset (${locale})`, async ({ page }) => {
    await setupCatalogueForms(page, locale, false);
    const text = adminTosText(locale),
      word = (key: string) => contractTemplatesText(`admin.templates.${key}`, locale);
    let writes = 0;
    await page.route('**/api/admin/tos/versions', (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: [] });
      writes++;
      return route.fulfill({ json: {} });
    });
    await page.goto('/admin/tos');
    await page.getByRole('button', { name: text.newDraft, exact: true }).click();
    await page.locator('#admintospage-field-1').fill('v2');
    await page.getByRole('textbox', { name: text.persian, exact: true }).fill('شرایط');
    await page.getByRole('textbox', { name: text.english, exact: true }).fill('Retained terms');
    await page.locator('form button[type=submit]').click();
    await expect(page.locator('form button[type=submit]')).toBeDisabled();
    await expect.poll(() => writes).toBe(1);
    await expect(page.locator('form')).toContainText(contentFormText('unverified', locale));
    await page.getByRole('button', { name: text.refresh, exact: true }).click();
    await page.getByRole('button', { name: contentFormText('reset', locale), exact: true }).click();
    await expect(page.locator('#admintospage-field-1')).toHaveValue('');
    await expect(page.getByRole('textbox', { name: text.persian, exact: true })).toHaveText('');
    await expect(page.getByRole('textbox', { name: text.english, exact: true })).toHaveText('');
    await page.route('**/api/admin/contract-templates', (route) =>
      route.fulfill({ json: [contractTemplate] })
    );
    await page.route(`**/api/admin/contract-templates/${templateId}`, (route) => {
      if (route.request().method() === 'GET')
        return route.fulfill({ json: contractTemplateDetail });
      writes++;
      return route.fulfill({ json: {} });
    });
    await page.goto('/admin/contract-templates');
    await page
      .getByRole('button', { name: `${word('open')} ${contractTemplate.name}`, exact: true })
      .click();
    await page.locator('#template-name').fill('Retained name');
    await page.locator('form button[type=submit]').click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(page.getByRole('dialog').locator('button[type=submit]')).toBeDisabled();
    await expect(page.locator('#template-name')).toHaveValue('Retained name');
    expect(writes).toBe(2);
    await page
      .getByRole('dialog')
      .getByRole('button', { name: word('refresh'), exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: contentFormText('reset', locale), exact: true }).click();
    await expect(page.locator('#template-name')).toHaveValue(contractTemplate.name);
  });
