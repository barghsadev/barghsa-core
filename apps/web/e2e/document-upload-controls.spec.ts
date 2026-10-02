import { test, expect } from './upload-fixture';
import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import { documentText } from '@barghsa/i18n/documents';
import {
  documentRow,
  documentProfileId,
  documentUploadPolicy,
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
  await page.route('**/api/invitations/pending', (route) =>
    route.fulfill({ json: { invitations: [] } })
  );
  await page.route('**/api/profiles/ownership-transfers', (route) =>
    route.fulfill({ json: { transfers: [] } })
  );
}
for (const staff of [false, true])
  for (const locale of ['en', 'fa'] as const)
    for (const mode of ['transfer', 'confirmation'] as const)
      test(`${staff ? 'staff' : 'customer'} validates configured files and resumes ${mode} without repeating reservation (${locale})`, async ({
        page,
        baseURL,
        uploadReceiver,
      }, testInfo) => {
        await shell(page, locale, staff);
        await page
          .context()
          .addCookies([{ name: 'barghsa-session', value: 'fixture-only-session', url: baseURL! }]);
        const word = (key: string) => documentText(key, locale),
          base = staff ? '/api/admin/documents' : '/api/documents';
        let reads = 0,
          creates = 0,
          confirmed = false,
          held: Route | undefined;
        const confirmations: unknown[] = [];
        await page.route('**/api/upload/policy/*', (route) => {
          if (++reads === 1) return route.fulfill({ status: 503, json: {} });
          return route.fulfill({ json: { ...documentUploadPolicy(), maxSizeBytes: 1048576 } });
        });
        await page.route(
          (url) => url.pathname === base,
          async (route) => {
            if (route.request().method() === 'GET')
              return route.fulfill({
                json: {
                  documents: creates
                    ? [
                        {
                          ...documentRow,
                          state: confirmed ? 'Available' : 'Uploading',
                          originalName: 'proof.pdf',
                        },
                      ]
                    : [],
                  nextBefore: null,
                },
              });
            creates++;
            expect(route.request().postDataJSON()).toMatchObject({
              profileId: documentProfileId,
              fileName: 'proof.pdf',
              fileSize: 7,
              contentType: 'application/pdf',
            });
            return route.fulfill({
              status: 201,
              json: {
                document: { ...documentRow, state: 'Uploading', revision: 1 },
                upload: { presignedUrl: uploadReceiver.url, headers: { 'If-None-Match': '*' } },
              },
            });
          }
        );
        await page.route(`**${base}/${documentRow.id}/confirm`, async (route) => {
          confirmations.push(route.request().postDataJSON());
          if (mode === 'confirmation' && confirmations.length === 1) {
            held = route;
            return;
          }
          confirmed = true;
          return route.fulfill({
            json: { ...documentRow, state: 'Available', originalName: 'proof.pdf' },
          });
        });
        await page.route(`**${base}/${documentRow.id}`, (route) =>
          route.fulfill({
            json: {
              ...documentRow,
              state: confirmed ? 'Available' : 'Uploading',
              originalName: 'proof.pdf',
              history: [],
            },
          })
        );
        await page.goto(staff ? `/admin/documents?profileId=${documentProfileId}` : '/documents');
        const list = page.getByRole('region', { name: word('listTitle'), exact: true });
        await list.getByRole('button', { name: word('upload'), exact: true }).click();
        const upload = list.getByRole('region', { name: word('upload'), exact: true });
        await expect(upload.getByRole('alert')).toContainText(word('policyError'));
        await expect(
          upload.getByRole('button', { name: word('dropFiles'), exact: true })
        ).toBeDisabled();
        await upload.getByRole('button', { name: word('retry'), exact: true }).click();
        const drop = upload.getByRole('button', { name: word('dropFiles'), exact: true });
        await expect(drop).toBeEnabled();
        await drop.evaluate((element) => {
          const data = new DataTransfer();
          data.items.add(new File(['bad'], 'bad.exe', { type: 'application/pdf' }));
          element.dispatchEvent(
            new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true })
          );
        });
        await expect(upload.getByRole('alert')).toContainText('.exe');
        expect(creates).toBe(0);
        await drop.evaluate((element) => {
          const data = new DataTransfer();
          data.items.add(
            new File([new Uint8Array(1048577)], 'large.pdf', { type: 'application/pdf' })
          );
          element.dispatchEvent(
            new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true })
          );
        });
        await expect(upload.getByRole('alert')).toContainText(
          locale === 'fa' ? '۱ مگابایت' : '1 MB'
        );
        expect(creates).toBe(0);
        await drop.evaluate((element) => {
          const data = new DataTransfer();
          for (const name of ['one.pdf', 'two.pdf'])
            data.items.add(new File(['pdf'], name, { type: 'application/pdf' }));
          element.dispatchEvent(
            new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true })
          );
        });
        await expect(upload.getByRole('alert')).toContainText(
          locale === 'fa' ? 'حداکثر ۱ فایل' : 'up to 1'
        );
        expect(creates).toBe(0);
        await drop.focus();
        const chooserPromise = page.waitForEvent('filechooser');
        await drop.press('Enter');
        const chooser = await chooserPromise;
        await chooser.setFiles({
          name: 'proof.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('abcdefg'),
        });
        await expect(upload.getByRole('alert')).toHaveCount(0);
        await expect(upload).toContainText('proof.pdf');
        expect(
          (await new AxeBuilder({ page }).include('[data-slot="file-upload"]').analyze()).violations
        ).toEqual([]);
        uploadReceiver.holdResponses = mode === 'transfer';
        await upload.getByRole('button', { name: word('upload'), exact: true }).click();
        await page
          .getByRole('dialog')
          .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
          .click();
        await expect.poll(() => uploadReceiver.uploads.length).toBe(1);
        const progress = upload.getByRole('progressbar');
        await expect(progress).toHaveAttribute('aria-valuenow', '100');
        if (mode === 'confirmation') await expect.poll(() => !!held).toBe(true);
        await expect(upload.getByRole('status')).toContainText(
          word(mode === 'confirmation' ? 'confirming' : 'uploading')
        );
        await upload.getByRole('button', { name: word('pauseUpload'), exact: true }).click();
        await expect(upload.getByRole('status')).toContainText(word('paused'));
        expect(creates).toBe(1);
        expect(uploadReceiver.uploads[0]!.headers.cookie).toBeUndefined();
        expect(uploadReceiver.uploads[0]!.headers['x-csrf-token']).toBeUndefined();
        expect(uploadReceiver.uploads[0]!.headers['if-none-match']).toBe('*');
        expect(uploadReceiver.uploads[0]!.body.toString()).toBe('abcdefg');
        await page.screenshot({
          path: `/tmp/barghsa-upload-${staff ? 'staff' : 'customer'}-${locale}-${mode}-${testInfo.project.name}.png`,
          fullPage: false,
        });
        if (mode === 'transfer') {
          uploadReceiver.holdResponses = false;
          uploadReceiver.release();
        } else await held!.fulfill({ status: 503, json: {} });
        await upload.getByRole('button', { name: word('resumeUpload'), exact: true }).click();
        await expect(
          list.getByRole('region', { name: word('details'), exact: true })
        ).toBeVisible();
        expect(creates).toBe(1);
        if (mode === 'confirmation') {
          expect(uploadReceiver.uploads).toHaveLength(1);
          expect(confirmations).toHaveLength(2);
          expect(confirmations[0]).toEqual(confirmations[1]);
        } else {
          expect(uploadReceiver.uploads).toHaveLength(2);
          expect(confirmations).toHaveLength(1);
        }
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
        ).toBe(true);
      });
