import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { cookieResponse } from './cookie-response';
import { t } from '@barghsa/i18n/admin-ui';
import { knowledgePolicyFormText } from '@barghsa/i18n/knowledge-policy-forms';
import {
  knowledgeBase as kb,
  knowledgeGroup as kg,
  knowledgeDetail as kd,
  policyEntry as policy,
  policySecond,
  policyGroup as pg,
} from '../src/test/knowledge-policy-fixtures';
import AxeBuilder from '@axe-core/playwright';
test.use({ viewport: { width: 390, height: 844 } });
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true])
    test(`group membership, priorities and query forms verify outcomes (${locale}, ${dark ? 'dark' : 'light'})`, async ({
      page,
    }, info) => {
      await setupCatalogueForms(page, locale, dark);
      const k = (key: string) => t(`admin.kb.${key}`, locale),
        p = (key: string) => t(`admin.policies.${key}`, locale),
        copy = (key: Parameters<typeof knowledgePolicyFormText>[0]) =>
          knowledgePolicyFormText(key, locale),
        button = (name: string) => page.getByRole('button', { name, exact: true });
      const invalid = (field: string) => ({
        status: 400,
        json: {
          error: {
            code: 'VALIDATION:INPUT:INVALID',
            fields: [field],
            message: 'private-member-value',
          },
        },
      });
      const confirm = async () => {
        const dialog = page.getByRole('dialog');
        await dialog.locator('button[type=submit]').click();
        await expect(dialog).toHaveCount(0);
      };
      let knowledgeMembers: (typeof kb)[] = [],
        detailStatus = 200,
        verified = false,
        queries = 0;
      const knowledgeWrites: string[] = [];
      await page.route('**/api/admin/knowledge-bases', (route) => route.fulfill({ json: [kb] }));
      await page.route(`**/api/admin/knowledge-bases/${kb.id}`, (route) =>
        route.fulfill({ json: kd })
      );
      await page.route('**/api/admin/kb-groups', (route) => route.fulfill({ json: [kg] }));
      await page.route(`**/api/admin/kb-groups/${kg.id}`, (route) =>
        route.fulfill({
          status: detailStatus,
          json: detailStatus === 200 ? { ...kg, members: knowledgeMembers } : {},
        })
      );
      await page.route('**/api/admin/*/*/query', (route) => {
        queries++;
        if (queries === 1) return route.fulfill(invalid('query'));
        return route.fulfill({
          json: [
            {
              id: 'chunk',
              kbId: kb.id,
              excerpt: 'Verified guidance',
              score: 0.8,
              metadata: { fileName: 'Guide.txt' },
            },
          ],
        });
      });
      await page.route(`**/api/admin/kb-groups/${kg.id}/members`, (route) => {
        const body = route.request().postDataJSON();
        expect(body).toEqual({ kbId: kb.id });
        knowledgeWrites.push('add');
        if (knowledgeWrites.length === 1) return route.fulfill(invalid('kbId'));
        if (!verified)
          return route.fulfill({ status: 403, json: { error: 'AUTHZ:STEP_UP_REQUIRED' } });
        expect(route.request().headers()['x-csrf-token']).toBe('membership-fresh');
        knowledgeMembers = [kb];
        detailStatus = 503;
        return route.fulfill({ status: 204 });
      });
      await page.route(`**/api/admin/kb-groups/${kg.id}/members/${kb.id}`, (route) => {
        knowledgeWrites.push('remove');
        knowledgeMembers = [];
        return route.fulfill({ status: 204 });
      });
      await page.route('**/api/auth/step-up', (route) => {
        verified = true;
        return cookieResponse(route, {
          json: { verified: true },
          headers: { 'Set-Cookie': 'barghsa_csrf=membership-fresh; Path=/; SameSite=Lax' },
        });
      });
      await page.goto('/admin/knowledge-bases');
      await button(k('kb-groups')).click();
      await button(`${k('open')} ${kg.title}`).click();
      const query = page.locator('#kb-test-query'),
        member = page.locator('#kb-member');
      await button(k('runQuery')).click();
      await expect(query).toBeFocused();
      await expect(query).toHaveAttribute('aria-invalid', 'true');
      expect(queries).toBe(0);
      await query.fill('Meter question');
      await button(k('runQuery')).click();
      await expect(query).toBeFocused();
      await expect(query).toHaveValue('Meter question');
      await expect(query).toHaveAttribute('aria-invalid', 'true');
      await button(k('runQuery')).click();
      await expect(page.getByText('Verified guidance', { exact: true })).toBeVisible();
      await button(k('link')).click();
      await expect(member).toBeFocused();
      await expect(member).toHaveAttribute('aria-invalid', 'true');
      await member.selectOption(kb.id);
      await button(k('link')).click();
      await confirm();
      await expect(member).toBeFocused();
      await expect(member).toHaveValue(kb.id);
      await expect(page.locator('#admin-content')).not.toContainText('private-member-value');
      expect(
        (await new AxeBuilder({ page }).include('#admin-content').analyze()).violations
      ).toEqual([]);
      await button(k('link')).click();
      const dialog = page.getByRole('dialog');
      await dialog.locator('button[type=submit]').click();
      await expect(dialog.locator('input[type=password]')).toBeVisible();
      await dialog.locator('input[type=password]').fill('Member-password-123!');
      await dialog.locator('button[type=submit]').click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByText(copy('uncertain'), { exact: true })).toBeVisible();
      await expect(button(copy('reset'))).toBeDisabled();
      await expect(member).toHaveValue(kb.id);
      await expect(query).toHaveValue('Meter question');
      detailStatus = 200;
      await button(k('detailRetry')).click();
      await expect(button(copy('reset'))).toBeEnabled();
      await button(copy('reset')).click();
      await expect(member).toHaveValue('');
      await button(`${k('unlink')} ${kb.title}`).click();
      await confirm();
      await expect(button(`${k('unlink')} ${kb.title}`)).toHaveCount(0);
      expect(knowledgeWrites).toEqual(['add', 'add', 'add', 'remove']);

      let policyMembers = [{ ...policy, priorityOverride: null as number | null }],
        policyStatus = 200;
      const policyWrites: Record<string, unknown>[] = [];
      await page.route('**/api/admin/policies', (route) =>
        route.fulfill({ json: [policy, policySecond] })
      );
      await page.route('**/api/admin/policy-groups', (route) => route.fulfill({ json: [pg] }));
      await page.route(`**/api/admin/policy-groups/${pg.id}`, (route) =>
        route.fulfill({
          status: policyStatus,
          json: policyStatus === 200 ? { ...pg, members: policyMembers } : {},
        })
      );
      await page.route(`**/api/admin/policy-groups/${pg.id}/members`, (route) => {
        const body = route.request().postDataJSON();
        policyWrites.push(body);
        if (policyWrites.length === 1 || policyWrites.length === 3)
          return route.fulfill(invalid('priorityOverride'));
        const found = policyMembers.find((row) => row.id === body.policyId);
        if (found) found.priorityOverride = body.priorityOverride;
        else
          policyMembers.push({ ...policySecond, priorityOverride: body.priorityOverride ?? null });
        if (policyWrites.length === 4) policyStatus = 503;
        return route.fulfill({ status: 204 });
      });
      await page.route(
        `**/api/admin/policy-groups/${pg.id}/members/${policySecond.id}`,
        (route) => {
          policyMembers = policyMembers.filter((row) => row.id !== policySecond.id);
          return route.fulfill({ status: 204 });
        }
      );
      await page.goto('/admin/policies');
      await button(p('policy-groups')).click();
      await button(`${p('open')} ${pg.title}`).click();
      const first = page.locator(`#member-priority-${policy.id}`),
        saveFirst = page
          .locator('form')
          .filter({ has: first })
          .getByRole('button', { name: p('updatePriority'), exact: true });
      await first.fill('1.5');
      await saveFirst.click();
      await expect(first).toBeFocused();
      await expect(first).toHaveAttribute('aria-invalid', 'true');
      expect(policyWrites).toHaveLength(0);
      await page.locator('#policy-member').selectOption(policySecond.id);
      await page.locator('#policy-member-priority').fill(locale === 'fa' ? '-۱۲' : '-12');
      await button(p('link')).click();
      await confirm();
      await expect(page.locator('#policy-member-priority')).toBeFocused();
      await expect(first).toHaveValue('1.5');
      await expect(page.locator('#policy-member')).toHaveValue(policySecond.id);
      await button(p('link')).click();
      await confirm();
      await expect(page.locator('#policy-member')).toHaveValue('');
      await expect(first).toHaveValue('1.5');
      const second = page.locator(`#member-priority-${policySecond.id}`);
      await second.fill('77');
      await first.fill(locale === 'fa' ? '-۱۲' : '-12');
      await saveFirst.click();
      await confirm();
      await expect(first).toBeFocused();
      await expect(first).toHaveAttribute('aria-invalid', 'true');
      await expect(second).toHaveValue('77');
      expect(
        (await new AxeBuilder({ page }).include('#admin-content').analyze()).violations
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      await page.screenshot({
        path: info.outputPath('membership-priority-feedback.png'),
        fullPage: true,
      });
      await saveFirst.click();
      await confirm();
      await expect(page.getByText(copy('uncertain'), { exact: true })).toBeVisible();
      await expect(button(copy('reset'))).toBeDisabled();
      await expect(second).toHaveValue('77');
      policyStatus = 200;
      await button(p('detailRetry')).click();
      await expect(button(copy('reset'))).toBeEnabled();
      await button(copy('reset')).click();
      await expect(first).toHaveValue('-12');
      await expect(second).toHaveValue('77');
      await first.fill('');
      await saveFirst.click();
      await confirm();
      await expect(first).toHaveValue('');
      await expect(second).toHaveValue('77');
      expect(policyWrites).toEqual([
        { policyId: policySecond.id, priorityOverride: -12 },
        { policyId: policySecond.id, priorityOverride: -12 },
        { policyId: policy.id, priorityOverride: -12 },
        { policyId: policy.id, priorityOverride: -12 },
        { policyId: policy.id, priorityOverride: null },
      ]);
      await button(`${p('unlink')} ${policySecond.title}`).click();
      await confirm();
      await expect(second).toHaveCount(0);
      await page.goto('/admin/knowledge-bases');
      await button(`${k('open')} ${kb.title}`).click();
      await button(k('runQuery')).click();
      await expect(query).toBeFocused();
      await expect(query).toHaveAttribute('aria-invalid', 'true');
      await query.fill('Base query');
      await button(k('runQuery')).click();
      await expect(page.getByText('Verified guidance', { exact: true })).toBeVisible();
      expect(
        (await new AxeBuilder({ page }).include('#admin-content').analyze()).violations
      ).toEqual([]);
      await page.screenshot({
        path: info.outputPath('knowledge-query-feedback.png'),
        fullPage: true,
      });
    });
