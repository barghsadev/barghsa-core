import { test, expect } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { t as adminText } from '@barghsa/i18n/admin-ui';
import { t as appText } from '@barghsa/i18n/app';
import {
  correctionStaffOrder,
  correctionStaffReview,
  correctionOrder,
  otherCorrectionOrder,
} from './electricity-correction-form-fixture';

const western = (text: string) =>
  text.replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/[^0-9]/g, '');
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true])
    for (const lane of ['review', 'conversations'] as const) {
      test(`electricity staff tables retain ${lane} facts and one decision owner (${locale}, dark=${dark})`, async ({
        page,
      }, info) => {
        const copy = (key: string) => adminText(`admin.electricityOrders.${key}`, locale);
        await setupCatalogueForms(page, locale, dark, {
          numberStyle: locale === 'fa' ? 'western' : 'persian',
        });
        const rows = [
          {
            ...correctionStaffOrder(),
            customerName: 'Operations <script> Buyer',
            totalKwh: '900719925474099123',
            totalIrR: '900719925474099321',
            paidIrR: '0',
            ageHours: 73,
            priority: 'urgent',
            latestCommentAt: '2026-10-05T00:30:00.000Z',
          },
          {
            ...correctionStaffOrder(otherCorrectionOrder),
            customerName: 'Second Buyer',
            financialStatus: 'paid',
            invoiceState: 'Paid',
            paidIrR: '100000',
            ageHours: 0,
            priority: 'normal',
            latestCommentAt: '2026-10-04T10:00:00.000Z',
          },
        ];
        let failed = false,
          denied = false,
          queueReads = 0,
          detailReads = 0;
        const writes: unknown[] = [];
        await page.route('**/api/staff/electricity/orders**', (route) => {
          const url = new URL(route.request().url());
          const base = '/api/staff/electricity/orders';
          if (url.pathname === base || url.pathname === `${base}/conversations`) {
            queueReads++;
            return denied
              ? route.fulfill({ status: 403, json: {} })
              : failed
                ? route.fulfill({ status: 503, json: {} })
                : route.fulfill({ json: { orders: rows, nextAfter: null } });
          }
          if (url.pathname.endsWith('/comments')) return route.fulfill({ json: { comments: [] } });
          if (url.pathname.endsWith('/financial-review')) {
            const command = route.request().postDataJSON();
            return route.fulfill({ json: correctionStaffReview(rows[0]!, command) });
          }
          if (
            route.request().method() === 'GET' &&
            [correctionOrder, otherCorrectionOrder].some((id) => url.pathname === `${base}/${id}`)
          ) {
            detailReads++;
            return route.fulfill({ json: rows.find((row) => url.pathname.endsWith(row.orderId)) });
          }
          writes.push(route.request().postDataJSON());
          return route.fulfill({ status: 403, json: { requiresStepUp: true } });
        });
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto(
          `/admin/electricity-orders${lane === 'conversations' ? '?view=conversations' : ''}`
        );
        const content = page.locator('[data-slot=list-content]');
        const records = content.locator(
          'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2)'
        );
        const caption = copy(
          lane === 'conversations' ? 'conversationDirectory' : 'reviewDirectory'
        );
        await expect(records).toHaveCount(2);
        await expect(content.getByRole('table')).toHaveAccessibleName(caption);
        await expect(
          content.getByRole('columnheader', { name: copy('commercial'), exact: true })
        ).toBeVisible();
        await expect(
          content.getByRole('columnheader', { name: copy('financial'), exact: true })
        ).toBeVisible();
        const inspect = async () => {
          await expect(records.first()).toContainText(rows[0]!.customerName);
          await expect(records.first()).toContainText(correctionOrder);
          expect(western(await records.first().innerText())).toContain(rows[0]!.totalKwh);
          expect(western(await records.first().innerText())).toContain(rows[0]!.totalIrR);
          await expect(records.first()).toContainText(copy('commercial.awaiting_staff_review'));
          await expect(records.first()).toContainText(copy('financial.unpaid'));
          await expect(records.nth(1)).toContainText(copy('financial.paid'));
          await expect(
            records.first().locator(`time[datetime="${rows[0]!.submittedAt}"]`)
          ).toBeVisible();
          if (lane === 'review') {
            await expect(records.first()).toContainText(copy('priority.urgent'));
            expect(western(await records.first().innerText())).toContain('73');
          } else
            await expect(
              records.first().locator(`time[datetime="${rows[0]!.latestCommentAt}"]`)
            ).toBeVisible();
          expect(await content.locator('script').count()).toBe(0);
          await expect(content).not.toContainText('Original Electricity Street');
          expect(
            (
              await new AxeBuilder({ page })
                .include('[data-slot=list-content]')
                .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
                .analyze()
            ).violations
          ).toEqual([]);
        };
        await inspect();
        const acceptedReads = queueReads;
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(content.getByRole('table')).toHaveCount(0);
        await inspect();
        expect(queueReads).toBe(acceptedReads);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true
        );
        expect(
          await records
            .first()
            .getByRole('button')
            .evaluate((button) => button.getBoundingClientRect().height)
        ).toBeGreaterThanOrEqual(44);
        if (
          locale === 'fa' &&
          info.project.name === 'mobile-safari' &&
          process.env.BARGHSA_SCREENSHOT_DIR &&
          ((lane === 'review' && !dark) || (lane === 'conversations' && dark))
        ) {
          const last = await records.last().boundingBox();
          expect(last).not.toBeNull();
          await page.setViewportSize({
            width: 390,
            height: Math.ceil(last!.y + last!.height + 120),
          });
          await page.screenshot({
            path: `${process.env.BARGHSA_SCREENSHOT_DIR}/electricity-${lane}-fa-${dark ? 'dark' : 'light'}.png`,
            fullPage: true,
          });
          await page.setViewportSize({ width: 390, height: 844 });
        }
        failed = true;
        await page.getByRole('button', { name: copy('refresh'), exact: true }).click();
        const retry = content.getByRole('button', {
          name: appText('historyPagination.retry', locale),
          exact: true,
        });
        await expect(retry).toBeVisible();
        await expect(records).toHaveCount(0);
        failed = false;
        await retry.click();
        await expect(records).toHaveCount(2);
        await expect(retry).toHaveCount(0);
        denied = true;
        await page.getByRole('button', { name: copy('refresh'), exact: true }).click();
        await expect(content.getByText(copy('forbidden'))).toBeVisible();
        await expect(records).toHaveCount(0);

        denied = false;
        await page.reload();
        await expect(records).toHaveCount(2);
        const commandReads = queueReads;
        await records.first().getByRole('button').click();
        const reason = page.locator('textarea[name=reason]');
        await expect(reason).toHaveCount(1);
        await reason.fill('  Keep the exact staff draft  ');
        const selectedReads = detailReads;
        await page.setViewportSize({ width: 1280, height: 900 });
        await expect(reason).toHaveValue('  Keep the exact staff draft  ');
        expect(detailReads).toBe(selectedReads);
        expect(queueReads).toBe(commandReads);
        await expect(records.first().getByRole('button')).toHaveAttribute('aria-pressed', 'true');
        await page.getByRole('button', { name: copy('request-changes'), exact: true }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await dialog
          .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
          .click();
        await dialog.locator('input[type=password]').fill('synthetic-only-password');
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(dialog.locator('input[type=password]')).toHaveValue('synthetic-only-password');
        await expect(reason).toHaveValue('  Keep the exact staff draft  ');
        await expect(reason).toHaveCount(1);
        expect(detailReads).toBe(selectedReads);
        expect(writes).toHaveLength(1);
        await dialog
          .getByRole('button', { name: appText('team.cancel', locale), exact: true })
          .click();
        await expect(dialog).toHaveCount(0);
        await expect(reason).toHaveValue('  Keep the exact staff draft  ');
        await expect(
          page.getByRole('button', { name: copy('refresh'), exact: true })
        ).toBeDisabled();
        expect(writes).toHaveLength(1);
      });
    }
