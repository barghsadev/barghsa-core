import { test, expect } from './coverage-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { aiDetail, aiOptions, aiAgent } from '../src/test/ai-catalogue-fixtures';
import { assignmentAgent, assignmentSlots } from '../src/test/assignment-settings-fixtures';
import { t } from '@barghsa/i18n/admin-ui';
import { aiAgentFormText } from '@barghsa/i18n/ai-agent-forms';
import { timezoneText } from '@barghsa/i18n/timezone';
import AxeBuilder from '@axe-core/playwright';
test.use({ viewport: { width: 390, height: 844 } });
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true])
    test(`AI management shows counts, highlighted source and audited slot times (${locale}, ${dark ? 'dark' : 'light'})`, async ({
      page,
      browserName,
    }, info) => {
      await setupCatalogueForms(
        page,
        locale,
        dark,
        locale === 'fa' && dark ? { darkBackgroundColor: '#615461' } : {}
      );
      const copy = (key: Parameters<typeof aiAgentFormText>[0]) => aiAgentFormText(key, locale),
        agentText = (key: string) => t(`admin.agents.${key}`, locale),
        slotText = (key: string) => t(`admin.slots.${key}`, locale);
      let stored = structuredClone(aiDetail),
        denied = false;
      const writes: Record<string, unknown>[] = [];
      await page.route('**/api/admin/agents', (route) =>
        route.fulfill(denied ? { status: 403, json: {} } : { json: [stored] })
      );
      await page.route('**/api/admin/agents/options', (route) =>
        route.fulfill({ json: aiOptions })
      );
      await page.route(`**/api/admin/agents/${aiAgent.id}`, (route) => {
        if (route.request().method() === 'GET') return route.fulfill({ json: stored });
        const body = route.request().postDataJSON();
        writes.push(body);
        if (writes.length === 1)
          return route.fulfill({
            status: 400,
            json: {
              error: {
                code: 'VALIDATION:INPUT:INVALID',
                fields: ['systemPrompt'],
                message: 'private-server-copy',
              },
            },
          });
        stored = { ...stored, ...body };
        return route.fulfill({ json: stored });
      });
      await page.goto('/admin/agents');
      const item = page
        .getByRole('list', { name: agentText('title'), exact: true })
        .getByRole('listitem')
        .filter({ has: page.getByRole('heading', { name: aiAgent.title, exact: true }) });
      const count = item
        .locator('dl > div')
        .filter({ has: page.locator('dt').filter({ hasText: copy('linkedKbs') }) })
        .locator('dd');
      await expect(count).toHaveText(locale === 'fa' ? '۱' : '1');
      await expect(
        item
          .locator('dl > div')
          .filter({ hasText: copy('linkedPolicies') })
          .locator('dd')
      ).toHaveText(locale === 'fa' ? '۰' : '0');
      await page
        .getByRole('button', { name: `${agentText('edit')} ${aiAgent.title}`, exact: true })
        .click();
      const input = page.locator('#agent-system-prompt'),
        backdrop = input.locator('..').locator('pre[aria-hidden=true]');
      const source = `${locale === 'fa' ? '# دستورهای عامل' : '# Agent instructions'}\n\n- Use supplied facts\n- Keep **sources** and \`code\`\n\n<script>private()</script>\n${Array(100).fill('Energy guidance with facts.').join('\n')}\n`;
      await input.fill(source);
      expect(
        await input.evaluate((node) => ({
          color: getComputedStyle(node).color,
          background: getComputedStyle(node).backgroundColor,
        }))
      ).toEqual({ color: 'rgba(0, 0, 0, 0)', background: 'rgba(0, 0, 0, 0)' });
      expect(await input.evaluate((node) => getComputedStyle(node, '::selection').color)).not.toBe(
        'rgba(0, 0, 0, 0)'
      );
      const colors = await backdrop.evaluate((node) => {
        const canvas = document.createElement('canvas'),
          context = canvas.getContext('2d')!;
        const rgb = (color: string) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
        };
        const luminance = (values: number[]) =>
          values
            .map((value) => {
              const n = value / 255;
              return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
            })
            .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i]!, 0);
        const bg = luminance(rgb(getComputedStyle(document.body).backgroundColor));
        return [...node.querySelectorAll('span')]
          .filter((span) => span.textContent?.trim())
          .map((span) => {
            const color = getComputedStyle(span).color,
              fg = luminance(rgb(color));
            return { color, contrast: (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05) };
          });
      });
      for (const token of colors)
        expect(token.contrast, JSON.stringify(token)).toBeGreaterThanOrEqual(4.5);

      await expect(input).toHaveValue(source);
      expect(await backdrop.textContent()).toBe(source + '\u200b');
      expect(await backdrop.locator('span[class*=text-]').count()).toBeGreaterThan(1);
      await expect(backdrop.locator('script,img,a')).toHaveCount(0);
      await input.evaluate((node) => {
        node.scrollTop = node.scrollHeight;
        node.dispatchEvent(new Event('scroll', { bubbles: true }));
      });
      await expect.poll(() => backdrop.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
      const alignment = await input.evaluate((node) => {
        const back = node.parentElement!.querySelector('pre')!,
          a = getComputedStyle(node),
          b = getComputedStyle(back);
        return {
          font: a.fontFamily === b.fontFamily,
          line: a.lineHeight === b.lineHeight,
          width: node.clientWidth === back.clientWidth,
          scroll: Math.abs(node.scrollTop - back.scrollTop) <= 1,
        };
      });
      expect(alignment).toEqual({ font: true, line: true, width: true, scroll: true });
      if (browserName === 'chromium') {
        await page.emulateMedia({ forcedColors: 'active' });
        expect(await backdrop.evaluate((node) => getComputedStyle(node).display)).toBe('none');
        expect(await input.evaluate((node) => getComputedStyle(node).color)).not.toBe(
          'rgba(0, 0, 0, 0)'
        );
        await page.emulateMedia({ forcedColors: 'none' });
      }
      await page.getByRole('button', { name: agentText('save'), exact: true }).click();
      await page.getByRole('dialog').locator('button[type=submit]').click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(input).toBeFocused();
      await expect(input).toHaveAttribute('aria-invalid', 'true');
      await expect(input).toHaveValue(source);
      await expect(page.locator('#admin-content')).not.toContainText('private-server-copy');
      expect(
        (await new AxeBuilder({ page }).include('#admin-content').analyze()).violations
      ).toEqual([]);
      await input.evaluate((node) => {
        node.scrollTop = 0;
        node.dispatchEvent(new Event('scroll', { bubbles: true }));
      });
      await input.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath('highlighted-prompt.png'), fullPage: true });
      await page.getByRole('button', { name: agentText('save'), exact: true }).click();
      await page.getByRole('dialog').locator('button[type=submit]').click();
      await expect(input).toHaveCount(0);
      expect(writes).toHaveLength(2);
      expect(writes[0]).toEqual(writes[1]);
      expect(writes[1]!.systemPrompt).toBe(source);
      await page
        .getByRole('button', { name: `${agentText('edit')} ${aiAgent.title}`, exact: true })
        .click();
      await expect(backdrop).toContainText('#');
      denied = true;
      await page.getByRole('button', { name: agentText('refresh'), exact: true }).click();
      await expect(page.locator('#admin-content pre')).toHaveCount(0);

      let zoneFailed = true;
      const reads: string[] = [];
      await page.route('**/api/admin/agents', (route) => {
        reads.push('agents');
        return route.fulfill({ json: [assignmentAgent] });
      });
      await page.route('**/api/admin/agent-slots', (route) => {
        reads.push('slots');
        return route.fulfill({ json: assignmentSlots() });
      });
      await page.route('**/api/user/settings/timezone', (route) =>
        route.fulfill(
          zoneFailed ? { status: 503, json: {} } : { json: { timezone: 'Asia/Tehran' } }
        )
      );
      await page.goto('/admin/agent-slots');
      const region = page.getByRole('region', { name: copy('slotsTable'), exact: true }),
        viewport = region.locator('[data-slot=scroll-area-viewport]');
      await expect(region.locator('tbody tr')).toHaveCount(5);
      await expect(region.locator('thead')).toContainText(copy('lastChanged'));
      await expect(region.locator('time').first()).toHaveAttribute(
        'datetime',
        assignmentSlots()[0]!.updatedAt
      );
      await expect(region.locator('time').first()).toHaveText(
        timezoneText('display.pending', locale)
      );
      await viewport.focus();
      await viewport.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
      await expect
        .poll(() => viewport.evaluate((node) => Math.abs(node.scrollLeft)))
        .toBeGreaterThan(0);
      const choice = page.locator('#slot-individual_chatbot');
      await choice.selectOption(assignmentAgent.id);
      await expect(choice).toHaveValue(assignmentAgent.id);
      expect([...reads].sort()).toEqual(['agents', 'slots']);
      zoneFailed = false;
      await page.getByRole('button', { name: timezoneText('retry', locale), exact: true }).click();
      await expect(region.locator('time').first()).not.toHaveText(
        timezoneText('display.pending', locale)
      );
      await expect(choice).toHaveValue(assignmentAgent.id);
      expect([...reads].sort()).toEqual(['agents', 'slots']);
      const first = region.locator('tbody tr').first();
      await expect(first.getByRole('rowheader')).toHaveText(slotText('individual_chatbot'));
      await expect(
        first.getByRole('button', {
          name: `${slotText('save')} ${slotText('individual_chatbot')}`,
          exact: true,
        })
      ).toBeEnabled();
      expect(
        (await new AxeBuilder({ page }).include('#admin-content').analyze()).violations
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      await page.screenshot({ path: info.outputPath('slot-table.png'), fullPage: true });
    });
