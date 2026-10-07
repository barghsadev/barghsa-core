import { test, expect } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { t } from '@barghsa/i18n/app';
const orderId = '84000000-0000-4000-8000-000000000001',
  profileId = '85000000-0000-4000-8000-000000000001';
for (const locale of ['en', 'fa'] as const)
  for (const funded of [false, true])
    test(`raw draft keyboard confirmation, privacy and mobile layout (${locale}, funded=${funded})`, async ({
      page,
    }) => {
      const copy = (key: string) => t('electricity.rawDraft.' + key, locale);
      await setupCatalogueForms(page, locale, false);
      const writes: unknown[] = [];
      await page.route('**/api/staff/electricity/orders**', (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/drafts'))
          return route.fulfill({
            json: {
              drafts: [
                {
                  orderId,
                  profileId,
                  mode: 'simple',
                  createdAt: '2026-10-06T12:00:00Z',
                  updatedAt: '2026-10-06T12:00:00Z',
                  private: 'PRIVATE progress',
                },
              ],
              nextAfter: null,
            },
          });
        if (path.endsWith('/draft-terminal/review')) {
          const command = route.request().postDataJSON();
          return route.fulfill({
            json: {
              hash: 'a'.repeat(64),
              scope: {
                action: 'electricity.draft-terminal.reject',
                resourceId: orderId,
                profileId,
              },
              data: {
                ...command,
                fromState: 'draft',
                toState: 'rejected',
                mode: 'simple',
                stateFingerprint: 'b'.repeat(64),
                createsContract: false,
                createsInvoice: false,
                collectsPayment: false,
                refundAmount: funded ? '100' : '0',
                ...(funded
                  ? {
                      paidOrder: true,
                      invoices: [
                        { id: '96000000-0000-4000-8000-000000000001', refundableAmount: '100' },
                      ],
                      existingReturns: [
                        {
                          refundId: '97000000-0000-4000-8000-000000000001',
                          invoiceId: '96000000-0000-4000-8000-000000000001',
                          amount: '100',
                          refundState: 'Failed',
                          job: { exhausted: true },
                        },
                      ],
                    }
                  : {}),
                changesSavedWizardProgress: false,
                gift: {
                  giftCodeId: '86000000-0000-4000-8000-000000000001',
                  redemptionId: '87000000-0000-4000-8000-000000000001',
                  status: 'consumed',
                  restoreOnCancel: true,
                  ...(funded ? { restoreAfterPayment: true } : {}),
                  outcome: 'release',
                },
              },
            },
          });
        }
        if (path.endsWith('/draft-terminal')) {
          writes.push(route.request().postDataJSON());
          return route.fulfill({
            json: {
              orderId,
              status: 'rejected',
              refundId: funded ? '97000000-0000-4000-8000-000000000001' : null,
              ...(funded
                ? {
                    financiallyClosed: false,
                    refunds: [
                      {
                        id: '97000000-0000-4000-8000-000000000001',
                        invoiceId: '96000000-0000-4000-8000-000000000001',
                        amount: '100',
                      },
                    ],
                  }
                : {}),
            },
          });
        }
        return route.fulfill({ json: { orders: [], nextAfter: null } });
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/admin/electricity-orders');
      const summary = page.locator('summary').filter({ hasText: copy('title') });
      await summary.focus();
      await summary.press('Enter');
      const details = page.locator('details').filter({ has: summary });
      await expect(details).toHaveAttribute('open', '');
      await expect(details).not.toContainText('PRIVATE');
      await expect(details).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
      await details.getByRole('button', { name: copy('reject'), exact: true }).click();
      const reason = details.getByLabel(copy('reason'), { exact: true });
      await reason.fill('Keyboard reviewed reason');
      await reason.press('Tab');
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(orderId);
      await expect(dialog).toContainText(profileId);
      await expect(dialog).toContainText('Keyboard reviewed reason');
      await expect(dialog).toContainText(copy('gift.release'));
      await expect(dialog).toContainText('86000000-0000-4000-8000-000000000001');
      if (funded) {
        await expect(dialog).toContainText(copy('manualRetryRequired'));
        await expect(dialog).toContainText('97000000-0000-4000-8000-000000000001');
      }
      expect(writes).toHaveLength(0);
      expect(
        (
          await new AxeBuilder({ page })
            .include('[role=dialog]')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze()
        ).violations
      ).toEqual([]);
      await page.setViewportSize({ width: 1280, height: 900 });
      await expect(reason).toHaveValue('Keyboard reviewed reason');
      await expect(dialog).toContainText('Keyboard reviewed reason');
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(details.getByRole('table')).toHaveCount(0);
      const overflow = await page.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        overflowing: [...document.querySelectorAll('*')]
          .map((el) => ({
            tag: el.tagName,
            text: el.textContent?.slice(0, 80),
            className: el.className,
            left: el.getBoundingClientRect().left,
            right: el.getBoundingClientRect().right,
          }))
          .filter((el) => el.left < 0 || el.right > innerWidth),
      }));
      expect(overflow.scrollWidth <= overflow.width, JSON.stringify(overflow)).toBe(true);
      await dialog.getByRole('button', { name: t('team.confirm', locale), exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect(writes).toHaveLength(1);
      expect(writes[0]).toMatchObject({
        action: 'reject',
        reason: 'Keyboard reviewed reason',
        expectedReviewHash: 'a'.repeat(64),
      });
    });
