import { test, expect } from './coverage-fixture';
import type { Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/app';
import { tTicketForms } from '@barghsa/i18n/ticket-forms';
import {
  supportTicket,
  supportQueue,
  supportPeople,
  supportTeams,
  supportComments,
} from '../src/test/support-queue-fixtures.js';

const teamId = '33333333-3333-4333-8333-333333333333';

for (const staff of [false, true])
  for (const locale of ['en', 'fa'] as const) {
    test(`${staff ? 'staff' : 'customer'} support queue recovers independently and preserves work (${locale})`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route('**/api/auth/user', (route) =>
        route.fulfill({
          json: {
            userId: staff ? 'staff' : 'customer',
            isStaff: staff,
            operatingContext: staff ? 'staff' : 'customer',
            canSwitchContext: false,
            requiresTosAcceptance: false,
          },
        })
      );
      await page.route('**/api/profiles', (route) =>
        route.fulfill({ json: { profiles: [], activeProfileId: null } })
      );
      await page.route('**/api/user/settings/timezone', (route) =>
        route.fulfill({ json: { timezone: 'Asia/Tehran' } })
      );
      const prefix = staff ? '/api/staff/tickets' : '/api/tickets';
      const copy = (key: string) => t(`tickets.${key}`, locale);
      let queueStatus = 503,
        detailStatus = 503,
        resourceStatus = 503,
        shrink = false;
      let holdQueue = false,
        heldQueue: Route | undefined;
      let holdDetail = false,
        heldDetail: Route | undefined;
      let detailReads = 0,
        commentReads = 0,
        resourceReads = 0;
      const queries: string[] = [];
      await page.route(
        (url) => url.pathname === prefix,
        (route) => {
          if (route.request().method() !== 'GET') return route.fulfill({ status: 503, json: {} });
          const url = new URL(route.request().url());
          queries.push(url.pathname + url.search);
          if (holdQueue) {
            heldQueue = route;
            return;
          }
          return queueStatus === 200
            ? route.fulfill({
                json: shrink
                  ? {
                      ...supportQueue,
                      data: url.searchParams.get('page') === '2' ? [] : supportQueue.data,
                      totalPages: 1,
                    }
                  : supportQueue,
              })
            : route.fulfill({ status: queueStatus, json: {} });
        }
      );
      await page.route(`**${prefix}/${supportTicket.id}`, (route) => {
        detailReads++;
        if (holdDetail) {
          heldDetail = route;
          return;
        }
        return detailStatus === 200
          ? route.fulfill({ json: supportTicket })
          : route.fulfill({ status: detailStatus, json: {} });
      });
      await page.route(`**${prefix}/${supportTicket.id}/comments`, (route) => {
        if (route.request().method() !== 'GET')
          return route.fulfill({
            status: 400,
            json: {
              error: {
                code: 'VALIDATION:INPUT:INVALID',
                message: 'Invalid input',
                correlationId: 'support-recovery-fixture',
                fields: ['body'],
              },
            },
          });
        commentReads++;
        // Deliberately include an internal entry: customer rendering must exclude it too.
        return route.fulfill({ json: supportComments });
      });
      await page.route(
        (url) =>
          ['assignees', 'teams', 'options'].some((path) => url.pathname === `${prefix}/${path}`),
        (route) => {
          resourceReads++;
          const path = new URL(route.request().url()).pathname;
          return resourceStatus === 200
            ? route.fulfill({
                json: path.endsWith('/teams')
                  ? supportTeams.map((team) => ({ ...team, id: teamId }))
                  : path.endsWith('/assignees')
                    ? supportPeople
                    : { profiles: [], records: [] },
              })
            : route.fulfill({ status: resourceStatus, json: {} });
        }
      );
      await page.goto(staff ? '/admin/tickets' : '/tickets?scope=active');
      const main = page.getByRole('main');
      const list = main.locator('[data-slot="list-page"]');
      const content = list.locator('[data-slot="list-content"]');
      await expect(main.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(content.getByRole('alert')).toContainText(copy('queueError'));
      queueStatus = 200;
      await content.getByRole('button', { name: copy('retry'), exact: true }).click();
      await expect(
        content.getByRole('button', { name: supportTicket.subject, exact: true })
      ).toBeVisible();
      await page.locator('#ticket-filter').selectOption('in_progress');
      await page.locator('#ticket-sort').selectOption('asc');
      await page.locator('#ticket-search').fill('Delivery');
      await expect
        .poll(() => new URL(queries.at(-1)!, 'https://local').searchParams.get('search'))
        .toBe('Delivery');
      await expect(content).not.toHaveAttribute('aria-busy', 'true');
      const currentQuery = new URL(queries.at(-1)!, 'https://local');
      expect(currentQuery.searchParams.get('status')).toBe('in_progress');
      expect(currentQuery.searchParams.get('sortOrder')).toBe('asc');
      if (!staff) expect(currentQuery.searchParams.get('scope')).toBe('active');
      await content.getByRole('button', { name: supportTicket.subject, exact: true }).click();
      const detailError = main.getByRole('alert').filter({ hasText: copy('detailError') });
      await expect(detailError).toBeVisible();
      const queueCount = queries.length;
      detailStatus = 200;
      await detailError.getByRole('button', { name: copy('retry'), exact: true }).click();
      await expect(
        main.getByRole('heading', { level: 2, name: supportTicket.subject })
      ).toBeFocused();
      expect(queries.length).toBe(queueCount);
      await expect(main.getByText('Public answer', { exact: true })).toBeVisible();
      await expect(main.getByText('Private staff reasoning', { exact: true })).toHaveCount(
        staff ? 1 : 0
      );
      if (staff) {
        const error = main.getByRole('alert').filter({ hasText: copy('assignmentError') });
        await expect(error).toBeVisible();
        await expect(page.locator('#ticket-team')).toBeDisabled();
        resourceStatus = 200;
        await error.getByRole('button', { name: copy('retry'), exact: true }).click();
        await expect(page.locator('#ticket-team')).toBeEnabled();
        await page.locator('#ticket-team').selectOption(teamId);
        await page.locator('#ticket-assignee').selectOption('other');
        await page.locator('#ticket-status-reason').fill('Awaiting another document');
        await main.getByRole('checkbox', { name: copy('internal'), exact: true }).check();
      } else {
        await main.getByRole('button', { name: copy('create'), exact: true }).click();
        await page.locator('#ticket-subject').fill('Creation draft');
        await page.locator('#ticket-body').fill('Creation explanation');
        await page.locator('#ticket-files').setInputFiles({
          name: 'draft.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('%PDF-draft'),
        });
        const error = main.getByRole('alert').filter({ hasText: copy('optionsError') });
        await expect(error).toBeVisible();
        resourceStatus = 200;
        await error.getByRole('button', { name: copy('retry'), exact: true }).click();
        await expect(page.locator('#ticket-profile')).toBeVisible();
      }
      await page.locator('#ticket-reply').fill('Unsaved reply');
      await main.getByRole('button', { name: copy('send'), exact: true }).click();
      // A current owned validation failure leaves this draft and queue controls editable.
      // Unknown outcomes use the separate explicit-retry stories in ticket-forms.spec.ts.
      const commandError = page
        .locator('[data-slot=ticket-reply-input]')
        .getByText(tTicketForms('replyInvalid', locale), { exact: true });
      await expect(commandError).toBeVisible();
      const reads = { detailReads, commentReads, resourceReads };
      holdQueue = true;
      await list
        .getByRole('navigation', { name: copy('pages'), exact: true })
        .getByRole('button', { name: copy('next'), exact: true })
        .click();
      await expect.poll(() => !!heldQueue).toBe(true);
      await expect(content).toHaveAttribute('aria-busy', 'true');
      await expect(
        content.getByRole('button', { name: supportTicket.subject, exact: true })
      ).toBeVisible();
      await expect(page.locator('#ticket-reply')).toHaveValue('Unsaved reply');
      await heldQueue!.fulfill({ status: 503, json: {} });
      holdQueue = false;
      await expect(content.getByRole('alert')).toBeVisible();
      await expect(commandError).toBeVisible();
      const failedQuery = queries.at(-1)!;
      expect(new URL(failedQuery, 'https://local').searchParams.get('page')).toBe('2');
      await expect(list.locator('[aria-current="page"]')).toHaveCount(1);
      await expect(list.locator('[aria-current="page"]')).toHaveText((1).toLocaleString(locale));
      await content.getByRole('button', { name: copy('retry'), exact: true }).click();
      await expect(content.getByRole('alert')).toHaveCount(0);
      expect(queries.at(-1)).toBe(failedQuery);
      expect({ detailReads, commentReads, resourceReads }).toEqual(reads);
      await expect(page.locator('#ticket-reply')).toHaveValue('Unsaved reply');
      await expect(commandError).toBeVisible();
      await expect(list.locator('[aria-current="page"]')).toHaveText((2).toLocaleString(locale));
      if (staff) {
        await expect(page.locator('#ticket-team')).toHaveValue(teamId);
        await expect(page.locator('#ticket-assignee')).toHaveValue('other');
        await expect(page.locator('#ticket-status-reason')).toHaveValue(
          'Awaiting another document'
        );
        await expect(
          main.getByRole('checkbox', { name: copy('internal'), exact: true })
        ).toBeChecked();
      } else {
        await expect(page.locator('#ticket-subject')).toHaveValue('Creation draft');
        await expect(page.locator('#ticket-body')).toHaveValue('Creation explanation');
        expect(
          await page
            .locator('#ticket-files')
            .evaluate((input: HTMLInputElement) => input.files?.[0]?.name)
        ).toBe('draft.pdf');
      }
      await list.getByRole('button', { name: t('historyView.table', locale), exact: true }).click();
      const viewport = list.locator('[data-slot="scroll-area-viewport"]');
      await viewport.focus();
      await expect(viewport).toBeFocused();
      const before = await viewport.evaluate((node) => node.scrollLeft);
      await page.keyboard.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
      await expect.poll(() => viewport.evaluate((node) => node.scrollLeft)).not.toBe(before);
      const accessibility = await new AxeBuilder({ page }).include('main').analyze();
      expect(accessibility.violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      if (locale === 'fa' && testInfo.project.name === 'mobile-safari')
        await main.locator('section[aria-labelledby="ticket-conversation-heading"]').screenshot({
          path: `/tmp/barghsa-ticket-thread-${staff ? 'staff' : 'customer'}-fa-mobile-safari.png`,
        });
      if (locale === 'fa' && testInfo.project.name === 'mobile-safari')
        await page.screenshot({
          path: `/tmp/barghsa-support-${staff ? 'staff' : 'customer'}-fa-mobile-safari.png`,
          fullPage: true,
        });
      shrink = true;
      await list.getByRole('button', { name: copy('refresh'), exact: true }).click();
      await expect(list.locator('[aria-current="page"]')).toHaveText((1).toLocaleString(locale));
      await expect(content).not.toHaveAttribute('aria-busy', 'true');
      expect(
        queries.slice(-2).map((query) => new URL(query, 'https://local').searchParams.get('page'))
      ).toEqual(['2', '1']);
      await expect(page.locator('#ticket-reply')).toHaveValue('Unsaved reply');
      // A queue denial must also reject a late detail read that started before it.
      holdDetail = true;
      await content.getByRole('button', { name: supportTicket.subject, exact: true }).click();
      await expect.poll(() => !!heldDetail).toBe(true);
      queueStatus = 403;
      await list.getByRole('button', { name: copy('refresh'), exact: true }).click();
      await expect(content.getByRole('alert')).toContainText(copy('forbidden'));
      await heldDetail!.fulfill({ json: supportTicket });
      await expect(content.getByRole('button', { name: supportTicket.subject })).toHaveCount(0);
      await expect(main.locator('article')).toHaveCount(0);
      await expect(page.locator('#ticket-reply')).toHaveCount(0);
      await expect(page.locator('#ticket-subject')).toHaveCount(0);
    });
  }
