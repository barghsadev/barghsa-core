import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { cookieResponse } from './cookie-response';
import { t } from '@barghsa/i18n/admin-ui';
import { knowledgePolicyFormText } from '@barghsa/i18n/knowledge-policy-forms';
import {
  knowledgeBase,
  knowledgeGroup,
  policyEntry,
  policyGroup,
} from '../src/test/knowledge-policy-fixtures';
import AxeBuilder from '@axe-core/playwright';

test.use({ viewport: { width: 390, height: 844 } });
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true])
    test(`knowledge, policy and group editors own feedback and verify saves (${locale}, ${dark ? 'dark' : 'light'})`, async ({
      page,
    }, info) => {
      await setupCatalogueForms(page, locale, dark);
      const kbText = (key: string) => t(`admin.kb.${key}`, locale),
        policyText = (key: string) => t(`admin.policies.${key}`, locale),
        copy = (key: Parameters<typeof knowledgePolicyFormText>[0]) =>
          knowledgePolicyFormText(key, locale),
        button = (name: string) => page.getByRole('button', { name, exact: true });
      const invalid = (field: string) => ({
        status: 400,
        json: {
          error: {
            code: 'VALIDATION:INPUT:INVALID',
            fields: [field],
            message: 'private-server-value',
          },
        },
      });
      const confirm = async () => {
        const dialog = page.getByRole('dialog');
        await dialog.locator('button[type=submit]').click();
        await expect(dialog).toHaveCount(0);
      };
      let kb: Record<string, unknown> = { ...knowledgeBase },
        kbStatus = 200,
        verified = false;
      const kbWrites: Record<string, unknown>[] = [];
      await page.route('**/api/admin/knowledge-bases', (route) =>
        route.fulfill({
          status: kbStatus,
          json: kbStatus === 200 ? [kb] : {},
        })
      );
      await page.route(`**/api/admin/knowledge-bases/${knowledgeBase.id}`, (route) => {
        if (route.request().method() === 'GET')
          return route.fulfill({ json: { ...kb, documents: [] } });
        const body = route.request().postDataJSON();
        kbWrites.push(body);
        if (kbWrites.length === 1) return route.fulfill(invalid('chunkSize'));
        if (!verified)
          return route.fulfill({ status: 403, json: { error: 'AUTHZ:STEP_UP_REQUIRED' } });
        expect(route.request().headers()['x-csrf-token']).toBe('knowledge-policy-fresh');
        kb = { ...kb, ...body };
        if (kbWrites.length === 3) {
          kbStatus = 503;
          return route.fulfill({ json: { id: knowledgeBase.id } });
        }
        return route.fulfill({ json: kb });
      });
      await page.route('**/api/auth/step-up', (route) => {
        verified = true;
        return cookieResponse(route, {
          json: { verified: true },
          headers: {
            'Set-Cookie': 'barghsa_csrf=knowledge-policy-fresh; Path=/; SameSite=Lax',
          },
        });
      });
      await page.route('**/api/admin/kb-groups', (route) =>
        route.fulfill({ json: [knowledgeGroup] })
      );
      await page.goto('/admin/knowledge-bases');
      await button(`${kbText('edit')} ${knowledgeBase.title}`).click();
      const kbTitle = page.locator('#kb-title'),
        size = page.locator('#kb-chunk-size'),
        overlap = page.locator('#kb-chunk-overlap'),
        source = page.locator('#kb-source-url');
      await kbTitle.fill('');
      await button(kbText('save')).click();
      await expect(kbTitle).toBeFocused();
      await expect(kbTitle).toHaveAttribute('aria-invalid', 'true');
      expect(kbWrites).toHaveLength(0);
      await kbTitle.fill('Keep local knowledge');
      kb = { ...kb, title: 'Changed stored knowledge' };
      await button(kbText('refresh')).click();
      await expect(page.getByText(copy('changed'), { exact: true })).toBeVisible();
      await expect(kbTitle).toHaveValue('Keep local knowledge');
      await expect(button(kbText('save'))).toBeDisabled();
      await button(copy('reset')).click();
      await expect(kbTitle).toHaveValue('Changed stored knowledge');
      await size.fill('');
      await button(kbText('save')).click();
      await expect(size).toBeFocused();
      await size.fill(locale === 'fa' ? '۸۰۰' : '800');
      await overlap.fill(locale === 'fa' ? '١٠٠' : '100');
      await page.locator('#kb-source-type').selectOption('api');
      await source.fill('https://one.example.test https://two.example.test');
      await button(kbText('save')).click();
      await expect(source).toBeFocused();
      await expect(source).toHaveAttribute('aria-invalid', 'true');
      await page.locator('#kb-source-type').selectOption('document');
      await expect(source).toHaveCount(0);
      await page.locator('#kb-source-type').selectOption('url');
      await source.fill('https://one.example.test\nhttps://two.example.test');
      await button(kbText('save')).click();
      await confirm();
      await expect(size).toBeFocused();
      await expect(size).toHaveAttribute('aria-invalid', 'true');
      await expect(source).toHaveValue('https://one.example.test\nhttps://two.example.test');
      await expect(page.locator('#admin-content')).not.toContainText('private-server-value');
      expect(
        (await new AxeBuilder({ page }).include('#admin-content').analyze()).violations
      ).toEqual([]);
      await page.screenshot({
        path: info.outputPath('knowledge-field-feedback.png'),
        fullPage: true,
      });
      await button(kbText('save')).click();
      const dialog = page.getByRole('dialog');
      await dialog.locator('button[type=submit]').click();
      await expect(dialog.locator('input[type=password]')).toBeVisible();
      await dialog.locator('input[type=password]').fill('Knowledge-password-123!');
      await dialog.locator('button[type=submit]').click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByText(copy('uncertain'), { exact: true })).toBeVisible();
      await expect(button(copy('reset'))).toBeDisabled();
      await expect(button(kbText('cancel'))).toBeDisabled();
      await expect(button(kbText('save'))).toBeDisabled();
      await expect(source).toHaveValue('https://one.example.test\nhttps://two.example.test');
      kbStatus = 200;
      await button(kbText('refresh')).click();
      await expect(button(copy('reset'))).toBeEnabled();
      await button(copy('reset')).click();
      await button(kbText('save')).click();
      await confirm();
      await expect(kbTitle).toHaveCount(0);
      expect(kbWrites).toEqual(
        Array(4).fill({
          title: 'Changed stored knowledge',
          description: knowledgeBase.description,
          audience: 'admin',
          sourceType: 'url',
          sourceConfig: { urls: ['https://one.example.test', 'https://two.example.test'] },
          chunkingStrategy: { size: 800, overlap: 100 },
          vectorEmbeddingModel: null,
        })
      );

      let policy: Record<string, unknown> = { ...policyEntry };
      const policyWrites: Record<string, unknown>[] = [];
      await page.route('**/api/admin/policies', (route) => route.fulfill({ json: [policy] }));
      await page.route(`**/api/admin/policies/${policyEntry.id}`, (route) => {
        const body = route.request().postDataJSON();
        policyWrites.push(body);
        if (policyWrites.length === 2) return route.fulfill(invalid('maxRequests'));
        policy = { ...policy, ...body };
        return route.fulfill({ json: policy });
      });
      await page.route('**/api/admin/policy-groups', (route) =>
        route.fulfill({ json: [policyGroup] })
      );
      await page.goto('/admin/policies');
      await button(`${policyText('edit')} ${policyEntry.title}`).click();
      const priority = page.locator('#policy-priority'),
        enabled = page.getByRole('checkbox', { name: policyText('enabled'), exact: true });
      await priority.fill('1.5');
      await button(policyText('save')).click();
      await expect(priority).toBeFocused();
      await priority.fill(locale === 'fa' ? '-۱۲' : '-12');
      await enabled.uncheck();
      await page.locator('#policy-type').selectOption('response_style');
      await page.locator('#policy-tone').fill('Friendly');
      await page.getByRole('checkbox', { name: policyText('requireSources'), exact: true }).check();
      await expect(enabled).not.toBeChecked();
      await button(policyText('save')).click();
      await confirm();
      await expect(page.locator('#policy-tone')).toHaveCount(0);
      expect(policyWrites[0]).toEqual({
        title: policyEntry.title,
        description: policyEntry.description,
        policyType: 'response_style',
        enabled: false,
        priority: -12,
        rules: { tone: 'Friendly', requireSources: true },
      });
      await button(`${policyText('edit')} ${policyEntry.title}`).click();
      await expect(
        page.getByRole('checkbox', { name: policyText('requireSources'), exact: true })
      ).toBeChecked();
      await expect(enabled).not.toBeChecked();
      await page.locator('#policy-type').selectOption('rate_limit');
      await expect(page.locator('#policy-tone')).toHaveCount(0);
      const requests = page.locator('#policy-max-requests');
      await requests.fill('');
      await button(policyText('save')).click();
      await expect(requests).toBeFocused();
      await requests.fill(locale === 'fa' ? '۱۰' : '10');
      await page.locator('#policy-window-seconds').fill(locale === 'fa' ? '٦٠' : '60');
      await button(policyText('save')).click();
      await confirm();
      await expect(requests).toBeFocused();
      await expect(requests).toHaveAttribute('aria-invalid', 'true');
      await expect(enabled).not.toBeChecked();
      await expect(page.locator('#admin-content')).not.toContainText('private-server-value');
      expect(
        (await new AxeBuilder({ page }).include('#admin-content').analyze()).violations
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      await page.screenshot({ path: info.outputPath('policy-field-feedback.png'), fullPage: true });
      await button(policyText('save')).click();
      await confirm();
      await expect(requests).toHaveCount(0);
      expect(policyWrites.slice(1)).toEqual(
        Array(2).fill({
          title: policyEntry.title,
          description: policyEntry.description,
          policyType: 'rate_limit',
          enabled: false,
          priority: -12,
          rules: { maxRequests: 10, windowSeconds: 60 },
        })
      );

      for (const group of [
        {
          path: 'kb-groups',
          pagePath: 'knowledge-bases',
          field: 'kb',
          row: knowledgeGroup,
          text: kbText,
        },
        {
          path: 'policy-groups',
          pagePath: 'policies',
          field: 'policy',
          row: policyGroup,
          text: policyText,
        },
      ]) {
        const writes: Record<string, unknown>[] = [];
        await page.route(`**/api/admin/${group.path}`, (route) => {
          if (route.request().method() === 'GET') return route.fulfill({ json: [group.row] });
          const body = route.request().postDataJSON();
          writes.push(body);
          return route.fulfill(
            writes.length === 1
              ? invalid('title')
              : { status: 201, json: { ...group.row, ...body } }
          );
        });
        await page.goto(`/admin/${group.pagePath}`);
        await button(group.text(group.path)).click();
        await button(group.text('addGroup')).click();
        const title = page.locator(`#${group.field}-title`);
        await button(group.text('save')).click();
        await expect(title).toBeFocused();
        await expect(title).toHaveAttribute('aria-invalid', 'true');
        await title.fill('New group');
        await page.locator(`#${group.field}-description`).fill('Group description');
        await button(group.text('save')).click();
        await confirm();
        await expect(title).toBeFocused();
        await expect(title).toHaveAttribute('aria-invalid', 'true');
        expect(
          (await new AxeBuilder({ page }).include('#admin-content').analyze()).violations
        ).toEqual([]);
        await button(group.text('save')).click();
        await confirm();
        await expect(title).toHaveCount(0);
        expect(writes).toEqual(
          Array(2).fill({ title: 'New group', description: 'Group description' })
        );
      }
    });
