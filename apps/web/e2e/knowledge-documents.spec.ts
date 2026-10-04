import { mockOppositeNumerals } from './number-preference-fixture';
import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { cookieResponse } from './cookie-response';
import { t } from '@barghsa/i18n/admin-ui';
import { knowledgePolicyFormText } from '@barghsa/i18n/knowledge-policy-forms';
import { knowledgeBase, policyEntry, policyGroup } from '../src/test/knowledge-policy-fixtures';
import AxeBuilder from '@axe-core/playwright';
test.use({ viewport: { width: 390, height: 844 } });
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true])
    test(`documents retain work and verify attachment, removal and catalogue numerals (${locale}, ${dark ? 'dark' : 'light'})`, async ({
      page,
    }, info) => {
      await setupCatalogueForms(page, locale, dark);
      await mockOppositeNumerals(page, locale, dark);
      const label = (key: string) => t(`admin.kb.${key}`, locale),
        p = (key: string) => t(`admin.policies.${key}`, locale);
      const copy = (key: Parameters<typeof knowledgePolicyFormText>[0]) =>
        knowledgePolicyFormText(key, locale);
      const button = (name: string) => page.getByRole('button', { name, exact: true });
      const kb = { ...knowledgeBase, sourceType: 'document', sourceConfig: {} };
      const guide = {
        id: '01900000-0000-7000-8000-000000000007',
        kbId: kb.id,
        storageKey: 'uploads/document/guide.txt',
        fileName: 'Guide.txt',
        processingStatus: 'pending',
      };
      const uploaded = {
        ...guide,
        id: '01900000-0000-7000-8000-000000000008',
        storageKey: 'uploads/document/new-guide.pdf',
        fileName: 'New-guide.pdf',
      };
      let detailStatus = 200,
        availableMalformed = false,
        verified = false,
        denied = false,
        puts = 0;
      let documents: (typeof guide)[] = [];
      const attachments: string[] = [];
      await page.route('**/api/admin/knowledge-bases', (route) => route.fulfill({ json: [kb] }));
      await page.route(`**/api/admin/knowledge-bases/${kb.id}`, (route) =>
        route.fulfill({ status: detailStatus, json: { ...kb, documents } })
      );
      await page.route('**/api/admin/knowledge-bases/documents/available?**', (route) =>
        route.fulfill({
          status: denied ? 401 : 200,
          json: availableMalformed ? [{ storageKey: guide.storageKey }] : [guide, uploaded],
        })
      );
      await page.route(`**/api/admin/knowledge-bases/${kb.id}/documents`, (route) => {
        const { storageKey } = route.request().postDataJSON();
        attachments.push(storageKey);
        if (attachments.length === 1)
          return route.fulfill({
            status: 400,
            json: {
              error: {
                code: 'VALIDATION:INPUT:INVALID',
                fields: ['storageKey'],
                message: 'private-document-value',
              },
            },
          });
        if (!verified)
          return route.fulfill({ status: 403, json: { error: 'AUTHZ:STEP_UP_REQUIRED' } });
        expect(route.request().headers()['x-csrf-token']).toBe('documents-fresh');
        const row = storageKey === guide.storageKey ? guide : uploaded;
        documents = [row];
        if (row === uploaded) {
          detailStatus = 503;
          return route.fulfill({ status: 200, json: { ...row, kbId: guide.id } });
        }
        return route.fulfill({ status: 200, json: row });
      });
      await page.route(`**/api/admin/knowledge-bases/${kb.id}/documents/${guide.id}`, (route) => {
        expect(route.request().method()).toBe('DELETE');
        documents = [];
        return route.fulfill({ status: 204 });
      });
      await page.route('**/api/auth/step-up', (route) => {
        verified = true;
        return cookieResponse(route, {
          json: { verified: true },
          headers: { 'Set-Cookie': 'barghsa_csrf=documents-fresh; Path=/; SameSite=Lax' },
        });
      });
      await page.route('**/api/upload/**', (route) => {
        const path = new URL(route.request().url()).pathname;
        expect(route.request().headers()['x-csrf-token']).toBe('documents-fresh');
        if (path.endsWith('/presigned-url'))
          return route.fulfill({
            json: {
              key: uploaded.storageKey,
              presignedUrl: 'https://storage.example.test/document',
            },
          });
        if (path.endsWith('/verify'))
          return route.fulfill({
            json: { key: uploaded.storageKey, status: 'confirmed', exists: true },
          });
        return route.fulfill({ json: { key: uploaded.storageKey, status: 'recorded' } });
      });
      await page.route('https://storage.example.test/document', (route) => {
        puts++;
        expect(route.request().headers()['x-csrf-token']).toBeUndefined();
        return route.fulfill({ status: 200 });
      });
      await page.goto('/admin/knowledge-bases');
      await button(`${label('open')} ${kb.title}`).click();
      const selected = page.locator('#kb-file'),
        search = page.locator('#kb-file-search'),
        file = page.locator('#kb-new-document');
      await button(label('attach')).click();
      await expect(selected).toBeFocused();
      await expect(selected).toHaveAttribute('aria-invalid', 'true');
      await search.fill('x'.repeat(201));
      await button(label('search')).click();
      await expect(search).toBeFocused();
      await expect(search).toHaveAttribute('aria-invalid', 'true');
      await search.fill('Guide');
      await selected.selectOption(guide.storageKey);
      availableMalformed = true;
      await button(label('search')).click();
      await expect(page.getByText(label('fileError'), { exact: true })).toBeVisible();
      await expect(selected).toHaveValue(guide.storageKey);
      await expect(search).toHaveValue('Guide');
      await expect(selected).toBeDisabled();
      availableMalformed = false;
      await button(label('retry')).click();
      await expect(selected).toBeEnabled();
      await button(label('attach')).click();
      await page.getByRole('dialog').locator('button[type=submit]').click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(selected).toBeFocused();
      await expect(selected).toHaveValue(guide.storageKey);
      await expect(page.locator('#admin-content')).not.toContainText('private-document-value');
      await button(label('attach')).click();
      let dialog = page.getByRole('dialog');
      await dialog.locator('button[type=submit]').click();
      await dialog.locator('input[type=password]').fill('Document-password-123!');
      await dialog.locator('button[type=submit]').click();
      await expect(dialog).toHaveCount(0);
      await expect(button(`${label('detach')} Guide.txt`)).toBeVisible();
      await expect(selected).toHaveValue('');
      await button(`${label('detach')} Guide.txt`).click();
      await page.getByRole('dialog').locator('button[type=submit]').click();
      await expect(button(`${label('detach')} Guide.txt`)).toHaveCount(0);
      await button(label('upload')).click();
      await expect(file).toBeFocused();
      await expect(file).toHaveAttribute('aria-invalid', 'true');
      await file.setInputFiles({
        name: 'tool.exe',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from('tool'),
      });
      await button(label('upload')).click();
      await expect(file).toBeFocused();
      expect(puts).toBe(0);
      expect(
        (await new AxeBuilder({ page }).include('#admin-content').analyze()).violations
      ).toEqual([]);
      await page.screenshot({
        path: info.outputPath('knowledge-documents-feedback.png'),
        fullPage: true,
      });
      await file.setInputFiles({
        name: uploaded.fileName,
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-test'),
      });
      await button(label('upload')).click();
      dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog
        .getByRole('button', { name: locale === 'fa' ? 'انصراف' : 'Cancel', exact: true })
        .click();
      await button(label('attachUploaded')).click();
      await page.getByRole('dialog').locator('button[type=submit]').click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByText(copy('uncertain'), { exact: true })).toBeVisible();
      await expect(button(copy('reset'))).toBeDisabled();
      await expect(file).not.toBeEmpty();
      expect(puts).toBe(1);
      detailStatus = 200;
      await button(label('detailRetry')).click();
      await expect(button(copy('reset'))).toBeEnabled();
      await button(copy('reset')).click();
      await expect(file).toBeEmpty();
      await expect(button(`${label('detach')} ${uploaded.fileName}`)).toBeVisible();
      expect(puts).toBe(1);
      denied = true;
      await button(label('search')).click();
      await expect(page.locator('#kb-file')).toHaveCount(0);
      await expect(page.locator('#admin-content')).not.toContainText(uploaded.fileName);
      await page.route('**/api/admin/policies', (route) =>
        route.fulfill({ json: [{ ...policyEntry, priority: 123 }] })
      );
      await page.route('**/api/admin/policy-groups', (route) =>
        route.fulfill({ json: [{ ...policyGroup, memberCount: 12 }] })
      );
      await page.goto('/admin/policies');
      const digits = (n: number) =>
        new Intl.NumberFormat(locale === 'fa' ? 'en-US' : 'fa-IR').format(n);
      await expect(
        page.getByText(`${p('priority')}: ${digits(123)}`, { exact: true })
      ).toBeVisible();
      await button(p('policy-groups')).click();
      await expect(page.getByText(`${p('members')}: ${digits(12)}`, { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      expect(
        (await new AxeBuilder({ page }).include('#admin-content').analyze()).violations
      ).toEqual([]);
    });
