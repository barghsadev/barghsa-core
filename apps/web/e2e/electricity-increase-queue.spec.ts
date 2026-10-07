import { test, expect } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { t } from '@barghsa/i18n/admin-ui';
import { t as appText } from '@barghsa/i18n/app';
import {
  increaseRequest,
  increaseRequestId,
  otherIncreaseRequestId,
  increaseDecisionReview,
} from './electricity-quantity-increase-form-fixture';

test.use({ timezoneId: 'America/Los_Angeles' });
const digits = (text: string) =>
  text.replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true])
    for (const lane of ['pending', 'expired'] as const) {
      test(`increase directory keeps exact facts and account-zone decisions (${locale}, dark=${dark}, ${lane})`, async ({
        page,
      }, info) => {
        const copy = (key: string) => t(`admin.electricityIncreases.${key}`, locale);
        const accountDate = (value: string) =>
          page.evaluate(
            ({ value, locale }) =>
              new Intl.DateTimeFormat(locale, {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: 'Asia/Tehran',
              }).format(new Date(value)),
            { value, locale }
          );

        await setupCatalogueForms(page, locale, dark, {
          numberStyle: locale === 'fa' ? 'western' : 'persian',
        });
        const rows = [
          {
            ...increaseRequest(),
            originalKwh: '900719925474099120',
            requestedKwh: '1080863910568918944',
            status: lane,
            adjustmentInvoiceId: lane === 'expired' ? '87000000-0000-4000-8000-000000000020' : null,
            adjustmentInvoiceState: lane === 'expired' ? 'Paid' : null,
            adjustmentPaidAmount: lane === 'expired' ? '900719925474099321' : null,
            financialFollowUp: lane === 'expired',
          },
          {
            ...increaseRequest(otherIncreaseRequestId),
            status: lane,
            contractState: lane === 'expired' ? 'Completed' : 'Active',
            adjustmentInvoiceState: lane === 'expired' ? 'Cancelled' : null,
            adjustmentPaidAmount: lane === 'expired' ? '0' : null,
            financialFollowUp: false,
          },
        ];
        let status = 200,
          reads = 0;
        const previews: unknown[] = [],
          writes: unknown[] = [];
        await page.route('**/api/staff/electricity/increase-requests**', (route) => {
          if (
            new URL(route.request().url()).pathname === '/api/staff/electricity/increase-requests'
          ) {
            reads++;
            return status === 200
              ? route.fulfill({ json: { requests: rows, nextBefore: null } })
              : route.fulfill({ status, json: {} });
          }
          const body = route.request().postDataJSON();
          if (route.request().url().endsWith('/approve/review')) {
            previews.push(body);
            const review = increaseDecisionReview(rows[0]!, 'approve', body);
            review.data.incrementalKwh = (
              BigInt(rows[0]!.requestedKwh) - BigInt(rows[0]!.originalKwh)
            ).toString();
            return route.fulfill({ json: review });
          }
          writes.push(body);
          return route.fulfill({ status: 500, json: {} });
        });
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto(
          `/admin/electricity-increases${lane === 'expired' ? '?status=expired' : ''}`
        );
        const content = page.locator('[data-slot=list-content]');
        const records = content.locator(
          'table:visible > tbody > tr:has(th[scope=row]), ol[role=list]:visible > li:has(h2)'
        );
        const caption = copy(lane === 'pending' ? 'pendingDirectory' : 'expiredDirectory');
        await expect(records).toHaveCount(2);
        await expect(content.getByRole('table')).toHaveAccessibleName(caption);
        const inspect = async () => {
          const row = records.first();
          await expect(row).toContainText(increaseRequestId);
          await expect(
            row.locator(`a[href="/admin/contracts?contractId=${rows[0]!.contractId}"]`)
          ).toBeVisible();
          await expect(
            row.locator(`a[href="/admin/electricity-orders?orderId=${rows[0]!.orderId}"]`)
          ).toBeVisible();
          const plain = digits(await row.innerText()).replace(/[,٬]/g, '');
          expect(plain).toContain(rows[0]!.originalKwh);
          expect(plain).toContain(rows[0]!.requestedKwh);
          expect(plain).toContain('20%');
          for (const date of [rows[0]!.effectiveFrom, rows[0]!.periodEnd, rows[0]!.createdAt])
            await expect(row.locator(`time[datetime="${date}"]`)).toHaveText(
              await accountDate(date)
            );
          expect(
            (
              await new AxeBuilder({ page })
                .include('[data-slot=list-content]')
                .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
                .analyze()
            ).violations
          ).toEqual([]);
          if (lane === 'expired') {
            expect(plain).toContain(rows[0]!.adjustmentPaidAmount);
            await expect(row).toContainText(copy('financeFollowUp'));
            await expect(
              row.locator(`a[href="/admin/invoices?invoiceId=${rows[0]!.adjustmentInvoiceId}"]`)
            ).toBeVisible();
            await expect(records.nth(1)).toContainText(copy('expiredClosed'));
            await expect(content.locator('form')).toHaveCount(0);
          }
        };
        await inspect();
        const acceptedReads = reads;
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(content.getByRole('table')).toHaveCount(0);
        await inspect();
        expect(reads).toBe(acceptedReads);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true
        );
        if (
          locale === 'fa' &&
          info.project.name === 'mobile-safari' &&
          process.env.BARGHSA_SCREENSHOT_DIR &&
          ((lane === 'pending' && !dark) || (lane === 'expired' && dark))
        ) {
          const last = await records.last().boundingBox();
          expect(last).not.toBeNull();
          await page.setViewportSize({
            width: 390,
            height: Math.ceil(last!.y + last!.height + 120),
          });
          const bounds = await content.boundingBox();
          const bottom = await records.last().boundingBox();
          await page.screenshot({
            path: `${process.env.BARGHSA_SCREENSHOT_DIR}/increase-${lane}-fa-${dark ? 'dark' : 'light'}.png`,
            clip: {
              x: bounds!.x,
              y: bounds!.y,
              width: bounds!.width,
              height: bottom!.y + bottom!.height - bounds!.y + 16,
            },
          });
          await page.setViewportSize({ width: 390, height: 844 });
        }
        if (lane === 'pending') {
          const open = records.first().getByRole('button');
          expect(
            await open.evaluate((button) => button.getBoundingClientRect().height)
          ).toBeGreaterThanOrEqual(44);
          await open.click();
          await expect(page.locator(`#increase-decision-${increaseRequestId}`)).toBeFocused();
          const approveForm = page.getByTestId('electricity-increase-approve-form').first();
          const date = page.locator(`#increase-effective-${increaseRequestId}`);
          const reason = page.locator(`#increase-reason-${increaseRequestId}`);
          const approvalReason = page.locator(`#increase-approval-reason-${increaseRequestId}`);
          await expect(approveForm).toContainText('Asia/Tehran');
          await date.fill('2026-10-10T12:00');
          await approvalReason.fill('  Capacity reviewed  ');
          await reason.fill('  Retain the staff capacity draft  ');
          await page.setViewportSize({ width: 1280, height: 900 });
          await expect(date).toHaveValue('2026-10-10T12:00');
          await expect(reason).toHaveValue('  Retain the staff capacity draft  ');
          await expect(page.getByTestId('electricity-increase-approve-form')).toHaveCount(2);
          expect(reads).toBe(acceptedReads);
          await approveForm.getByRole('button', { name: copy('approve'), exact: true }).click();
          const dialog = page.getByRole('dialog');
          await expect(dialog).toBeVisible();
          expect(previews).toEqual([
            { effectiveFrom: '2026-10-10T08:30:00.000Z', reason: 'Capacity reviewed' },
          ]);
          await expect(dialog).toContainText('Capacity reviewed');
          await expect(dialog).toContainText(await accountDate('2026-10-10T08:30:00.000Z'));
          await page.setViewportSize({ width: 390, height: 844 });
          await expect(dialog).toBeVisible();
          await expect(date).toHaveValue('2026-10-10T12:00');
          expect(previews).toHaveLength(1);
          await dialog
            .getByRole('button', { name: appText('team.cancel', locale), exact: true })
            .click();
          await expect(dialog).toHaveCount(0);
          await expect(reason).toHaveValue('  Retain the staff capacity draft  ');
        }
        expect(writes).toEqual([]);
        status = 503;
        await page.getByRole('button', { name: copy('refresh'), exact: true }).click();
        const retry = content.getByRole('button', { name: copy('retry'), exact: true });
        await expect(retry).toBeVisible();
        await expect(records).toHaveCount(2);
        status = 200;
        await retry.click();
        await expect(retry).toHaveCount(0);
        await expect(records).toHaveCount(2);
        status = 403;
        await page.getByRole('button', { name: copy('refresh'), exact: true }).click();
        await expect(content.getByRole('alert')).toContainText(copy('forbidden'));
        await expect(records).toHaveCount(0);
        await expect(content.locator('form')).toHaveCount(0);
      });
    }
