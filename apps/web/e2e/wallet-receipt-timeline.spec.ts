import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/app';
import { tWalletReceipts as receiptText } from '@barghsa/i18n/wallet-receipts';
import { test, expect } from './coverage-fixture';
import { verifyClippedContrast } from './clipped-contrast';

const profileId = '10000000-0000-4000-8000-000000000001';
const receiptId = '20000000-0000-4000-8000-000000000001';
const rejectedId = '20000000-0000-4000-8000-000000000002';
const submittedAt = '2026-09-01T23:30:00.123456Z';
const requestedAt = '2026-09-02T14:00:00.000Z';
const confirmedAt = '2026-09-03T15:00:00.000Z';
const amount = '9007199254740993';

for (const locale of ['en', 'fa'] as const)
  for (const darkMode of [false, true]) {
    test(`wallet receipt details preserve recorded dates, decisions and history scope (${locale}, dark=${darkMode})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addInitScript(
        ({ locale, darkMode }) => {
          localStorage.setItem('barghsa.locale', locale);
          const apply = () => {
            if (document.documentElement && document.documentElement.lang !== locale)
              document.documentElement.lang = locale;
            if (
              document.documentElement &&
              document.documentElement.classList.contains('dark') !== darkMode
            )
              document.documentElement.classList.toggle('dark', darkMode);
          };
          apply();
          new MutationObserver(apply).observe(document, {
            childList: true,
            attributes: true,
            attributeFilter: ['lang', 'class'],
            subtree: true,
          });
        },
        { locale, darkMode }
      );
      await page.route('**/api/**', (r) => r.fulfill({ status: 404, json: {} }));
      await page.route('**/api/auth/user', (r) =>
        r.fulfill({
          json: {
            userId: profileId,
            isStaff: false,
            operatingContext: 'customer',
            requiresTosAcceptance: false,
          },
        })
      );
      await page.route('**/api/profiles', (r) =>
        r.fulfill({
          json: {
            activeProfileId: profileId,
            profiles: [
              {
                id: profileId,
                profileType: 'INDIVIDUAL',
                title: 'Receipt account',
                status: 'ACTIVE',
              },
            ],
          },
        })
      );
      await page.route('**/api/user/settings/timezone', (r) =>
        r.fulfill({ json: { timezone: 'Pacific/Kiritimati' } })
      );
      await page.route(`**/api/wallet/${profileId}`, (r) =>
        r.fulfill({ json: { balance: '100', currency: 'IRR', onlineTopUpLimit: 0 } })
      );
      let reads = 0;
      const receipt = {
        paymentDate: '2026-09-01',
        payerReference: 'TRK-123',
        bankName: 'بانک ملی',
        customerNote: 'Branch transfer',
        rejectionReason: null,
        timeline: {
          events: [
            { state: 'submitted', occurredAt: submittedAt },
            { state: 'approval_requested', occurredAt: requestedAt },
            { state: 'confirmed', occurredAt: confirmedAt },
          ],
          awaiting: null,
        },
      };
      const tx = {
        id: receiptId,
        type: 'topup',
        amount,
        state: 'Released',
        refId: null,
        description: null,
        createdAt: submittedAt,
        bankReceipt: receipt,
      };
      await page.route(`**/api/wallet/${profileId}/transactions?*`, (r) => {
        reads++;
        const params = new URL(r.request().url()).searchParams;
        const more = params.has('cursor');
        const pending = params.get('state') === 'Pending';
        return r.fulfill({
          json: {
            transactions: pending
              ? [
                  {
                    ...tx,
                    state: 'Pending',
                    bankReceipt: {
                      ...receipt,
                      timeline: {
                        events: receipt.timeline.events.slice(0, 2),
                        awaiting: 'second_approval',
                      },
                    },
                  },
                ]
              : more
                ? [
                    {
                      ...tx,
                      id: rejectedId,
                      state: 'Rejected',
                      bankReceipt: {
                        ...receipt,
                        bankName: null,
                        rejectionReason: 'Please provide a readable deposit reference',
                        timeline: {
                          events: [
                            { state: 'submitted', occurredAt: submittedAt },
                            { state: 'rejected', occurredAt: null },
                          ],
                          awaiting: null,
                        },
                      },
                    },
                  ]
                : [tx, { ...tx, id: 'credit', state: 'Completed', bankReceipt: undefined }],
            nextCursor: !pending && !more ? 'older-page' : null,
          },
        });
      });
      await page.goto('/wallet');
      const history = page.getByRole('region', {
        name: t('wallet.history.title', locale),
        exact: true,
      });
      const word = (key: string) => receiptText(`wallet.receipt.${key}`, locale);
      const details = history.locator('details');
      await expect(details).toHaveCount(1);
      const count = reads;
      await details.locator('summary').focus();
      await details.locator('summary').press('Enter');
      await expect(details).toHaveAttribute('open', '');
      await expect(details).toContainText(receiptId);
      await expect(details).toContainText('بانک ملی');
      await expect(details).toContainText('TRK-123');
      await expect(details.locator('time[datetime="2026-09-01"]')).toHaveText(
        new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
          calendar: locale === 'fa' ? 'persian' : 'gregory',
          dateStyle: 'medium',
          timeZone: 'UTC',
        }).format(new Date('2026-09-01T00:00:00Z'))
      );
      const timeline = details.getByRole('region', { name: word('timeline'), exact: true });
      await expect(timeline.getByRole('listitem')).toHaveCount(3);
      await expect(timeline).toContainText(word('confirmed'));
      await expect(timeline).not.toContainText(word('awaiting.second_approval'));
      for (const stamp of [submittedAt, requestedAt, confirmedAt]) {
        const formatted = await page.evaluate(
          ({ locale, stamp }) =>
            new Intl.DateTimeFormat(locale, {
              dateStyle: 'medium',
              timeStyle: 'short',
              timeZone: 'Pacific/Kiritimati',
            }).format(new Date(stamp)),
          { locale, stamp }
        );
        await expect(timeline.locator(`time[datetime="${stamp}"]`)).toHaveText(formatted);
      }
      expect(reads).toBe(count);
      await expect(history).toContainText(
        new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US').format(BigInt(amount))
      );
      const scan = await new AxeBuilder({ page }).include('main details').analyze();
      expect(scan.violations).toEqual([]);
      await verifyClippedContrast(page, scan);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      await history
        .getByRole('button', { name: t('wallet.history.next', locale), exact: true })
        .click();
      await expect(details).not.toHaveAttribute('open', '');
      await details.locator('summary').click();
      await expect(details).toContainText(rejectedId);
      await expect(details).toContainText('Please provide a readable deposit reference');
      await expect(details).toContainText(word('unknownTime'));
      await expect(
        details.getByRole('region', { name: word('timeline'), exact: true }).locator('time')
      ).toHaveCount(1);
      await expect(history).not.toContainText(receiptId);
      await history.locator('select[name="state"]').selectOption('Pending');
      await history
        .getByRole('button', { name: t('wallet.history.apply', locale), exact: true })
        .click();
      await details.locator('summary').click();
      await expect(details).toContainText(word('awaiting.second_approval'));
      await expect(details).not.toContainText(word('confirmed'));
      await expect(details).not.toContainText('Please provide a readable deposit reference');
    });
  }
