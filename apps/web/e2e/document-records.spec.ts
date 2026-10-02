import { test, expect, type Page } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { documentText } from '@barghsa/i18n/documents';
import { t as appText } from '@barghsa/i18n/app';
import {
  documentRow,
  documentProfileId,
  documentCursor,
  documentDetail,
} from '../src/test/document-list-fixtures.js';

async function shell(page: Page, locale: 'en' | 'fa', staff: boolean) {
  await page.addInitScript((language) => localStorage.setItem('barghsa.locale', language), locale);
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
    route.fulfill({
      json: {
        activeProfileId: documentProfileId,
        hasDefault: true,
        profiles: [
          {
            id: documentProfileId,
            title: 'Current profile',
            profileType: 'LEGAL',
            status: 'ACTIVE',
            isDefault: true,
          },
        ],
      },
    })
  );
  await page.route('**/api/user/settings/theme', (route) =>
    route.fulfill({ json: { mode: locale === 'fa' ? 'dark' : 'light' } })
  );
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
  await page.route('**/api/admin/document-retention/policies', (route) =>
    route.fulfill({ json: { policies: [], canManage: false } })
  );
  await page.route('**/api/admin/document-retention/destruction', (route) =>
    route.fulfill({ json: { items: [], counts: [], canManage: false } })
  );
  await page.route('https://files.test/preview.png', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cA1cAAAAASUVORK5CYII=',
        'base64'
      ),
    })
  );
}
for (const staff of [false, true])
  for (const locale of ['en', 'fa'] as const) {
    test(`${staff ? 'staff' : 'customer'} document metadata and lazy files survive layout changes (${locale})`, async ({
      page,
    }, testInfo) => {
      await shell(page, locale, staff);
      const word = (key: string) => documentText(key, locale),
        base = staff ? '/api/admin/documents' : '/api/documents';
      let listReads = 0,
        detailReads = 0,
        previewReads = 0,
        downloadReads = 0;
      const quarantine = {
        ...documentRow,
        id: documentCursor,
        state: 'Quarantined',
        originalName: 'Quarantined.pdf',
        rejectionReason: 'PRIVATE scanner signature',
      };
      await page.route(
        (url) => url.pathname === base,
        (route) => {
          listReads++;
          return route.fulfill({
            json: {
              documents: [
                documentRow,
                quarantine,
                {
                  ...quarantine,
                  id: '44444444-4444-4444-8444-444444444444',
                  originalName: 'Replaced.pdf',
                  state: 'Superseded',
                  scanState: 'Quarantined',
                },
              ],
              nextBefore: null,
            },
          });
        }
      );
      await page.route(`**${base}/${documentRow.id}`, (route) => {
        detailReads++;
        return route.fulfill({ json: documentDetail });
      });
      await page.route(`**${base}/${documentRow.id}/preview`, (route) => {
        previewReads++;
        return route.fulfill({ json: { url: 'https://files.test/preview.png', expiresIn: 300 } });
      });
      await page.route(`**${base}/${documentRow.id}/download`, (route) => {
        downloadReads++;
        return route.fulfill({ json: { url: 'https://files.test/proof.pdf', expiresIn: 300 } });
      });
      await page.goto(staff ? '/admin/documents' : '/documents');
      const list = page.getByRole('region', { name: word('listTitle'), exact: true }),
        records = list.locator('[data-slot="document-records"]');
      await expect(
        records.getByRole('button', { name: documentRow.originalName, exact: true })
      ).toBeVisible();
      expect(previewReads + downloadReads).toBe(0);
      await expect(records).toContainText(word('quarantinedNotice'));
      await expect(records).not.toContainText('PRIVATE');
      await expect(records).toContainText(word('sizeBytes'));
      await expect(records.locator('time').first()).toHaveAttribute(
        'datetime',
        documentRow.createdAt
      );
      const reads = listReads;
      await records.getByRole('button', { name: word('preview'), exact: true }).click();
      await expect(records.getByRole('img')).toBeVisible();
      await records.getByRole('button', { name: word('download'), exact: true }).click();
      await expect(
        records.getByRole('link', { name: word('openFile'), exact: true })
      ).toHaveAttribute('href', 'https://files.test/proof.pdf');
      await records.getByRole('button', { name: documentRow.originalName, exact: true }).click();
      const detail = list.getByRole('region', { name: word('details'), exact: true });
      await expect(detail).toBeVisible();
      if (staff) await detail.locator('#document-review-reason').fill('Keep my review draft');
      const detailCount = detailReads;
      for (const view of ['table', 'card'] as const) {
        const control = list.getByRole('button', {
          name: appText(`historyView.${view}`, locale),
          exact: true,
        });
        await control.focus();
        await control.press('Enter');
        await expect(records).toHaveAttribute('data-view', view);
        await expect(control).toHaveAttribute('aria-pressed', 'true');
        await expect(records.getByRole('img')).toBeVisible();
        await expect(detail).toBeVisible();
        if (staff)
          await expect(detail.locator('#document-review-reason')).toHaveValue(
            'Keep my review draft'
          );
        expect(listReads).toBe(reads);
        expect(detailReads).toBe(detailCount);
        expect(previewReads).toBe(1);
        expect(downloadReads).toBe(1);
        expect(
          (await new AxeBuilder({ page }).include('[data-slot="document-records"]').analyze())
            .violations
        ).toEqual([]);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
        ).toBe(true);
      }
      await records.getByRole('button', { name: word('hidePreview'), exact: true }).click();
      await expect(records.getByRole('img')).toHaveCount(0);
      await records.getByRole('button', { name: word('preview'), exact: true }).click();
      expect(previewReads).toBe(1);
      await page.screenshot({
        path: `/tmp/barghsa-documents-${staff ? 'staff' : 'customer'}-${locale}-${testInfo.project.name}.png`,
        fullPage: true,
      });
    });
    test(`${staff ? 'staff' : 'customer'} document access retry and upload draft survive layout changes (${locale})`, async ({
      page,
    }) => {
      await shell(page, locale, staff);
      const word = (key: string) => documentText(key, locale),
        base = staff ? '/api/admin/documents' : '/api/documents';
      let reads = 0,
        previewReads = 0,
        status = 503;
      await page.route(
        (url) => url.pathname === base,
        (route) => {
          reads++;
          return route.fulfill({ json: { documents: [documentRow], nextBefore: null } });
        }
      );
      await page.route(`**${base}/${documentRow.id}/preview`, (route) => {
        previewReads++;
        return route.fulfill({
          status,
          json: status === 200 ? { url: 'https://files.test/preview.png' } : {},
        });
      });
      await page.route(`**${base}/${documentRow.id}/download`, (route) =>
        route.fulfill({ json: { url: 'https://files.test/proof.pdf' } })
      );
      await page.goto(staff ? `/admin/documents?profileId=${documentProfileId}` : '/documents');
      const list = page.getByRole('region', { name: word('listTitle'), exact: true }),
        records = list.locator('[data-slot="document-records"]');
      await records.getByRole('button', { name: word('preview'), exact: true }).click();
      await expect(records.getByRole('alert')).toContainText(word('fileAccessError'));
      status = 200;
      await records.getByRole('button', { name: word('preview'), exact: true }).click();
      await expect(records.getByRole('img')).toBeVisible();
      await records.getByRole('button', { name: word('download'), exact: true }).click();
      await expect(records.getByRole('link')).toBeVisible();
      await list.getByRole('button', { name: word('upload'), exact: true }).click();
      await list.locator('input[type="file"]').setInputFiles({
        name: 'draft.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.7'),
      });
      const count = reads;
      await list
        .getByRole('button', { name: appText('historyView.table', locale), exact: true })
        .click();
      await list
        .getByRole('button', { name: appText('historyView.card', locale), exact: true })
        .click();
      expect(
        await list
          .locator('input[type="file"]')
          .evaluate((element: HTMLInputElement) => element.files?.[0]?.name)
      ).toBe('draft.pdf');
      expect(reads).toBe(count);
      await records.getByRole('button', { name: word('hidePreview'), exact: true }).click();
      // A new accepted revision invalidates all previously issued links.
      await page.route(
        (url) => url.pathname === base,
        (route) =>
          route.fulfill({
            json: { documents: [{ ...documentRow, revision: 4 }], nextBefore: null },
          })
      );
      await list.getByRole('button', { name: word('refresh'), exact: true }).click();
      await expect(records.getByRole('link')).toHaveCount(0);
      status = 403;
      await records.getByRole('button', { name: word('preview'), exact: true }).click();
      await expect(records.getByRole('alert')).toContainText(word('fileUnavailable'));
      await expect(records.getByRole('img')).toHaveCount(0);
      expect(previewReads).toBe(3);
    });
  }
