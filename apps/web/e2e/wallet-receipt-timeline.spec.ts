import AxeBuilder from '@axe-core/playwright';
import { createServer, type Server, type IncomingHttpHeaders } from 'node:http';
import { t } from '@barghsa/i18n/app';
import { dateRangePreset } from '@barghsa/ui';
import { defaultParseSearch } from '@tanstack/react-router';
import {
  openHistoryFilters,
  applyHistoryFilters,
  closeHistoryFilters,
} from './history-filter-reset';
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

let originalServer: Server | undefined;
let originalUrl: string;
const originalRequests: IncomingHttpHeaders[] = [];
test.beforeAll(async () => {
  originalServer = createServer((req, res) => {
    if (req.url === '/attachment') {
      res.writeHead(302, {
        Location: originalUrl,
        'Cache-Control': 'private, no-store',
        'Referrer-Policy': 'no-referrer',
      });
      res.end();
      return;
    }
    if (req.url !== '/original') {
      res.writeHead(404);
      res.end();
      return;
    }
    originalRequests.push(req.headers);
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'private, no-store',
    });
    res.end('Original receipt fixture');
  });
  await new Promise<void>((resolve, reject) => {
    originalServer!.once('error', reject);
    originalServer!.listen(0, '127.0.0.1', resolve);
  });
  const address = originalServer.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing original-file fixture port');
  originalUrl = `http://127.0.0.1:${address.port}/original`;
});
test.afterAll(async () => {
  if (originalServer) await new Promise<void>((resolve) => originalServer!.close(() => resolve()));
});

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
      let previewFails = true;
      const previewRequests: string[] = [];
      const attachmentRequests: string[] = [];
      await page.route(`**/api/wallet/${profileId}/bank-receipt-top-ups/*/preview?*`, (r) => {
        previewRequests.push(r.request().url());
        return previewFails
          ? r.fulfill({ status: 503, json: { message: 'Receipt preview is unavailable' } })
          : r.fulfill({
              contentType: 'image/png',
              headers: { 'Cache-Control': 'private, no-store' },
              body: Buffer.from(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
                'base64'
              ),
            });
      });
      await page
        .context()
        .route(`**/api/wallet/${profileId}/bank-receipt-top-ups/*/attachment`, (r) => {
          attachmentRequests.push(r.request().url());
          return r.continue({ url: new URL('/attachment', originalUrl).href });
        });
      let reads = 0;
      let failNextPage = false;
      let denyNextPage = false;
      const queries: URLSearchParams[] = [];
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
        queries.push(params);
        const more = params.has('cursor');
        if (more && denyNextPage) {
          denyNextPage = false;
          return r.fulfill({ status: 403, json: {} });
        }
        if (more && failNextPage) {
          failNextPage = false;
          return r.fulfill({ status: 503, json: { message: 'Try again' } });
        }
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
      const details = history.locator('[data-slot=wallet-receipt-details]');
      await expect(details).toHaveCount(1);
      if (test.info().project.name === 'chromium') {
        const initialReads = reads;
        await page.setViewportSize({ width: 1280, height: 900 });
        await expect(history.getByRole('table')).toBeVisible();
        expect(
          await page.evaluate(
            (id) => localStorage.getItem(`barghsa.list-view:${id}:customer-wallet-transactions`),
            profileId
          )
        ).toBeNull();
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(history.getByRole('table')).toHaveCount(0);
        expect(reads).toBe(initialReads);
      }
      if (locale === 'fa' && darkMode)
        await history
          .locator('[data-slot="card"]')
          .first()
          .screenshot({
            path: `/tmp/barghsa-wallet-views-card-fa-dark-${test.info().project.name}.png`,
          });
      const count = reads;
      await details.locator(':scope > summary').focus();
      await details.locator(':scope > summary').press('Enter');
      await expect(details).toHaveAttribute('open', '');
      await expect(history.getByRole('table')).toHaveCount(0);
      const beforeView = { reads, url: page.url() };
      await history
        .getByRole('button', { name: t('historyView.table', locale), exact: true })
        .click();
      const table = history.getByRole('table', {
        name: `${t('wallet.history.title', locale)} · ${t('historyView.table', locale)}`,
        exact: true,
      });
      await expect(table).toBeVisible();
      await expect(table.getByRole('columnheader')).toHaveCount(11);
      await expect(table).toContainText('TRK-123');
      await expect(table).toContainText('بانک ملی');
      await expect(details).toHaveAttribute('open', '');
      expect(reads).toBe(beforeView.reads);
      expect(previewRequests).toHaveLength(0);
      expect(page.url()).toBe(beforeView.url);
      const scroll = history.locator('[data-slot="scroll-area-viewport"]');
      await scroll.focus();
      await scroll.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
      await expect(scroll).toBeFocused();
      const tableScan = await new AxeBuilder({ page })
        .include('main [data-slot="list-page"]')
        .analyze();
      expect(tableScan.violations).toEqual([]);
      await verifyClippedContrast(page, tableScan);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      await history
        .getByRole('button', { name: t('historyView.card', locale), exact: true })
        .click();
      await expect(table).toHaveCount(0);
      await expect(details).toHaveAttribute('open', '');
      expect(reads).toBe(beforeView.reads);
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
      expect(previewRequests).toHaveLength(0);
      const preview = details.locator('details');
      await preview.locator('summary').focus();
      await preview.locator('summary').press('Enter');
      await expect(preview).toContainText(t('invoices.activity.previewUnavailable', locale));
      expect(previewRequests).toHaveLength(1);
      expect(previewRequests[0]).toContain(
        `/wallet/${profileId}/bank-receipt-top-ups/${receiptId}/preview?revision=0`
      );
      previewFails = false;
      await preview
        .getByRole('button', { name: t('invoices.activity.retry', locale), exact: true })
        .click();
      const image = preview.getByRole('img', {
        name: t('invoices.activity.receiptPreviewAlt', locale).replace('{receipt}', receiptId),
        exact: true,
      });
      await expect(image).toBeVisible();
      await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);
      await expect(preview.getByRole('status')).toHaveCount(0);
      expect(previewRequests).toHaveLength(2);
      expect(previewRequests[1]).toContain('revision=1');
      const original = details.getByRole('link', {
        name: t('invoices.activity.viewReceiptAttachment', locale),
        exact: true,
      });
      await expect(original).toHaveAttribute('rel', 'noopener noreferrer');
      const popupPromise = page.waitForEvent('popup');
      await original.click();
      const popup = await popupPromise;
      await expect(popup.getByText('Original receipt fixture', { exact: true })).toBeVisible();
      await expect(popup).toHaveURL(originalUrl);
      expect(originalRequests.at(-1)?.referer).toBeUndefined();
      expect(attachmentRequests).toHaveLength(1);
      expect(attachmentRequests[0]).toContain(
        `/wallet/${profileId}/bank-receipt-top-ups/${receiptId}/attachment`
      );
      await popup.close();
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
      await details.locator(':scope > summary').click();
      await expect(details).toContainText(rejectedId);
      await expect(details).toContainText('Please provide a readable deposit reference');
      await expect(details).toContainText(word('unknownTime'));
      await expect(
        details.getByRole('region', { name: word('timeline'), exact: true }).locator('time')
      ).toHaveCount(1);
      await expect(history).not.toContainText(receiptId);
      await expect(history.getByRole('img')).toHaveCount(0);
      await details.locator('details summary').click();
      await expect(details.getByRole('img')).toHaveAttribute(
        'src',
        `/api/wallet/${profileId}/bank-receipt-top-ups/${rejectedId}/preview?revision=0`
      );
      await expect.poll(() => previewRequests.length).toBe(3);
      const bankDraft = page.locator('#receipt-bank-name');
      await bankDraft.fill('Unsubmitted bank draft');
      await openHistoryFilters(page, locale);
      let drawer = page.getByRole('dialog');
      const search = drawer.getByRole('searchbox', {
        name: t('historySearch.label', locale),
        exact: true,
      });
      await search.fill('Cancelled search');
      await closeHistoryFilters(page, locale);
      expect(queries.at(-1)?.get('q')).toBeNull();
      await expect(bankDraft).toHaveValue('Unsubmitted bank draft');

      await openHistoryFilters(page, locale);
      drawer = page.getByRole('dialog');
      await drawer
        .getByRole('searchbox', { name: t('historySearch.label', locale), exact: true })
        .fill('TRK_%\\');
      await drawer
        .getByRole('combobox', { name: t('wallet.history.sort', locale), exact: true })
        .selectOption('submitted_at:asc');
      await drawer.locator('[name="type"]').selectOption('topup');
      const minimum = drawer.getByRole('textbox', {
        name: t('invoices.filter.min', locale),
        exact: true,
      });
      const maximum = drawer.getByRole('textbox', {
        name: t('invoices.filter.max', locale),
        exact: true,
      });
      await minimum.fill(locale === 'fa' ? '۹۰۰۷۱۹۹۲۵۴۷۴۰۹۹۳' : amount);
      await maximum.fill('1');
      const countBeforeApply = reads;
      await drawer
        .getByRole('button', { name: t('historyFilters.apply', locale), exact: true })
        .click();
      await expect(drawer).toBeVisible();
      expect(reads).toBe(countBeforeApply);
      await maximum.fill(amount);
      await drawer
        .locator('summary')
        .filter({ hasText: t('wallet.history.date', locale) })
        .click();
      await drawer
        .getByRole('combobox', { name: t('historyDates.preset', locale), exact: true })
        .selectOption('thisMonth');
      const range = dateRangePreset(
        'thisMonth',
        locale,
        'Pacific/Kiritimati',
        new Date(await page.evaluate(() => Date.now()))
      );
      await applyHistoryFilters(page, locale);
      await expect(drawer).not.toBeVisible();
      await expect.poll(() => queries.at(-1)?.get('q')).toBe('TRK_%\\');
      expect(queries.at(-1)?.get('sort')).toBe('asc');
      expect(queries.at(-1)?.get('type')).toBe('topup');
      expect(queries.at(-1)?.get('min')).toBe(amount);
      expect(queries.at(-1)?.get('max')).toBe(amount);
      expect(queries.at(-1)?.get('from')).toBe(range.from);
      expect(queries.at(-1)?.get('until')).toBe(range.to);
      expect(queries.at(-1)?.has('to')).toBe(false);
      expect(queries.at(-1)?.has('cursor')).toBe(false);
      expect(queries.at(-1)?.get('limit')).toBe('25');
      await expect(bankDraft).toHaveValue('Unsubmitted bank draft');
      const appliedUrl = page.url();
      expect(defaultParseSearch(new URL(appliedUrl).search)).toMatchObject({
        history_q: 'TRK_%\\',
        history_order: 'asc',
        history_min: amount,
        history_max: amount,
      });

      failNextPage = true;
      await history
        .getByRole('button', { name: t('wallet.history.next', locale), exact: true })
        .click();
      await expect(history.getByRole('alert')).toBeVisible();
      await expect(details).toHaveCount(1);
      expect(queries.at(-1)?.get('cursor')).toBe('older-page');
      const failedQuery = queries.at(-1)!.toString();
      const failedReads = reads;
      await history
        .getByRole('button', { name: t('historyView.table', locale), exact: true })
        .click();
      await expect(history.getByRole('table')).toBeVisible();
      expect(reads).toBe(failedReads);
      await expect(history.getByRole('alert')).toBeVisible();
      await history
        .getByRole('button', { name: t('wallet.history.retry', locale), exact: true })
        .click();
      await expect(history.getByRole('alert')).toHaveCount(0);
      expect(queries.at(-1)?.toString()).toBe(failedQuery);
      await history
        .getByRole('button', { name: t('wallet.history.previous', locale), exact: true })
        .click();
      denyNextPage = true;
      await history
        .getByRole('button', { name: t('wallet.history.next', locale), exact: true })
        .click();
      await expect(history.getByRole('alert')).toHaveText(
        t('historyPagination.accessDenied', locale)
      );
      await expect(history.getByRole('navigation')).toHaveCount(0);
      await expect(details).toHaveCount(0);
      await expect(bankDraft).toHaveValue('Unsubmitted bank draft');
      if (locale === 'fa' && darkMode && process.env.BARGHSA_SCREENSHOT_DIR)
        await history.screenshot({
          path: `${process.env.BARGHSA_SCREENSHOT_DIR}/wallet-history-denied-${test.info().project.name}.png`,
        });
      const beforeDeniedRetry = queries.length;
      await history
        .getByRole('button', { name: t('wallet.history.retry', locale), exact: true })
        .click();
      await expect(history.getByRole('alert')).toHaveCount(0);
      await expect.poll(() => queries.at(-1)?.has('cursor')).toBe(false);
      expect(queries.slice(beforeDeniedRetry).map((query) => query.has('cursor'))).toEqual([false]);
      expect(queries.at(-1)?.get('q')).toBe('TRK_%\\');
      expect(queries.at(-1)?.get('min')).toBe(amount);
      expect(queries.at(-1)?.get('max')).toBe(amount);
      expect(queries.at(-1)?.get('sort')).toBe('asc');
      await expect(bankDraft).toHaveValue('Unsubmitted bank draft');
      await expect(
        history.getByRole('button', { name: t('wallet.history.previous', locale), exact: true })
      ).toBeDisabled();
      if (locale === 'fa' && darkMode && process.env.BARGHSA_SCREENSHOT_DIR)
        await history.screenshot({
          path: `${process.env.BARGHSA_SCREENSHOT_DIR}/wallet-history-restored-${test.info().project.name}.png`,
        });
      await history
        .getByRole('button', { name: t('wallet.history.next', locale), exact: true })
        .click();
      await expect.poll(() => queries.at(-1)?.get('cursor')).toBe('older-page');
      const pageUrl = page.url();
      await page.reload();
      await expect(history).toBeVisible();
      await expect.poll(() => queries.at(-1)?.get('cursor')).toBe('older-page');
      expect(page.url()).toBe(pageUrl);
      await expect(history.getByRole('table')).toBeVisible();
      await expect(
        history.getByRole('button', { name: t('historyView.table', locale), exact: true })
      ).toHaveAttribute('aria-pressed', 'true');
      expect(queries.at(-1)?.toString()).toBe(failedQuery);
      await history
        .getByRole('button', { name: t('historyFilters.clearAll', locale), exact: true })
        .click();
      await expect.poll(() => queries.at(-1)?.get('q')).toBeNull();
      expect(queries.at(-1)?.has('cursor')).toBe(false);
      expect(queries.at(-1)?.has('min')).toBe(false);
      expect(queries.at(-1)?.get('sort')).toBe('asc');
      await page.goBack();
      await expect(page).toHaveURL(pageUrl);
      await expect.poll(() => queries.at(-1)?.get('cursor')).toBe('older-page');
      expect(queries.at(-1)?.get('min')).toBe(amount);
      const controlScan = await new AxeBuilder({ page })
        .include('main [data-slot="list-page"]')
        .analyze();
      expect(controlScan.violations).toEqual([]);
      await verifyClippedContrast(page, controlScan);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      if (locale === 'fa' && darkMode)
        await history.locator('[data-slot=scroll-area]').screenshot({
          path: `/tmp/barghsa-wallet-views-fa-dark-${test.info().project.name}.png`,
        });
      await history
        .getByRole('button', { name: t('historyFilters.clearAll', locale), exact: true })
        .click();
      await openHistoryFilters(page, locale);
      await page.getByRole('dialog').locator('select[name="state"]').selectOption('Pending');
      await applyHistoryFilters(page, locale);
      await details.locator(':scope > summary').click();
      await expect(details).toContainText(word('awaiting.second_approval'));
      await expect(details).not.toContainText(word('confirmed'));
      await expect(details).not.toContainText('Please provide a readable deposit reference');
    });
  }
