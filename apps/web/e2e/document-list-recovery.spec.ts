import { documentUploadPolicy } from '../src/test/document-list-fixtures.js';
import { test, expect, type Page } from './coverage-fixture';
import type { Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { documentText } from '@barghsa/i18n/documents';
import { documentTemplateText } from '@barghsa/i18n/document-templates';
import {
  documentProfileId,
  documentRow,
  documentMore,
  documentCursor,
  documentDetail,
  templateRow,
  templateDetail,
  destructionQueue,
} from '../src/test/document-list-fixtures.js';

async function shell(page: Page, locale: 'en' | 'fa', staff: boolean) {
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
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
  await page.route('**/api/invitations/pending', (route) =>
    route.fulfill({ json: { invitations: [] } })
  );
  await page.route('**/api/profiles/ownership-transfers', (route) =>
    route.fulfill({ json: { transfers: [] } })
  );
  await page.route('**/api/admin/document-retention/policies', (route) =>
    route.fulfill({ json: { policies: [], canManage: false } })
  );
  await page.route('**/api/admin/document-retention/destruction', (route) =>
    route.fulfill({ json: { items: [], counts: [], canManage: false } })
  );
  await page.route('**/api/upload/policy/*', (route) =>
    route.fulfill({
      json: documentUploadPolicy(new URL(route.request().url()).pathname.split('/').at(-1)),
    })
  );
}
for (const staff of [false, true])
  for (const locale of ['en', 'fa'] as const) {
    test(`${staff ? 'staff' : 'customer'} document queue retries the exact page and preserves open work (${locale})`, async ({
      page,
    }, testInfo) => {
      await shell(page, locale, staff);
      const word = (key: string) => documentText(key, locale);
      const base = staff ? '/api/admin/documents' : '/api/documents';
      let status = 503,
        detailReads = 0,
        hold = false,
        held: Route | undefined;
      const queries: string[] = [];
      await page.route(
        (url) => url.pathname === base,
        (route) => {
          const url = new URL(route.request().url());
          queries.push(url.pathname + url.search);
          if (hold) {
            held = route;
            return;
          }
          return status === 200
            ? route.fulfill({
                json: {
                  documents: url.searchParams.has('before')
                    ? [documentRow, documentMore]
                    : [documentRow],
                  nextBefore: url.searchParams.has('before') ? null : documentCursor,
                },
              })
            : route.fulfill({ status, json: {} });
        }
      );
      await page.route(`**${base}/${documentRow.id}`, (route) => {
        detailReads++;
        return route.fulfill({ json: documentDetail });
      });
      await page.goto(staff ? '/admin/documents' : '/documents');
      if (staff) {
        await page.locator('#documents-profile').fill(documentProfileId);
        await page.locator('#documents-category').selectOption('document');
        await page.locator('#documents-search').fill('Review');
        await page.getByRole('button', { name: word('apply'), exact: true }).click();
      }
      const main = page.getByRole('main');
      const list = main.getByRole('region', { name: word('listTitle'), exact: true });
      const content = list.locator('[data-slot="list-content"]');
      if (staff) {
        await expect
          .poll(() => new URL(queries.at(-1)!, 'https://local').searchParams.get('q'))
          .toBe('Review');
      }
      await expect(content).not.toHaveAttribute('aria-busy', 'true');
      await expect(content.getByRole('alert')).toBeVisible();
      status = 200;
      await content.getByRole('button', { name: word('retry'), exact: true }).click();
      await content.getByRole('button', { name: documentRow.originalName, exact: true }).click();
      const detail = list.getByRole('region', { name: word('details'), exact: true });
      await expect(detail).toBeVisible();
      if (staff) await detail.locator('#document-review-reason').fill('Review draft');
      const reads = detailReads;
      hold = true;
      await list.getByRole('button', { name: word('next'), exact: true }).click();
      await expect.poll(() => !!held).toBe(true);
      await expect(content).toHaveAttribute('aria-busy', 'true');
      await expect(
        content.getByRole('button', { name: documentRow.originalName, exact: true })
      ).toBeVisible();
      await expect(detail).toBeVisible();
      await held!.fulfill({ status: 503, json: {} });
      hold = false;
      await expect(content.getByRole('alert')).toBeVisible();
      const failed = queries.at(-1)!;
      const count = queries.length;
      const query = new URL(failed, 'https://local');
      expect(query.searchParams.get('before')).toBe(documentCursor);
      expect(query.searchParams.get('profileId')).toBe(documentProfileId);
      if (staff) {
        expect(query.searchParams.get('q')).toBe('Review');
        expect(query.searchParams.get('category')).toBe('document');
        expect(query.searchParams.get('state')).toBe('SubmittedForReview');
      }
      await content.getByRole('button', { name: word('retry'), exact: true }).click();
      await expect(
        content.getByRole('button', { name: documentMore.originalName, exact: true })
      ).toBeVisible();
      expect(queries.slice(count)).toEqual([failed]);
      expect(detailReads).toBe(reads);
      expect(
        await content.getByRole('button', { name: documentRow.originalName, exact: true }).count()
      ).toBe(1);
      if (staff)
        await expect(detail.locator('#document-review-reason')).toHaveValue('Review draft');
      await list.getByRole('button', { name: word('upload'), exact: true }).click();
      await page.locator('[data-slot="file-upload"] input[type="file"]').setInputFiles({
        name: 'Draft.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-draft'),
      });
      const uploadFile = page.locator('[data-slot="file-upload"] input[type="file"]');
      status = 503;
      await list.getByRole('button', { name: word('refresh'), exact: true }).click();
      await expect(content.getByRole('alert')).toBeVisible();
      status = 200;
      await content.getByRole('button', { name: word('retry'), exact: true }).click();
      await expect(content.getByRole('alert')).toHaveCount(0);
      expect(await uploadFile.evaluate((input: HTMLInputElement) => input.files?.[0]?.name)).toBe(
        'Draft.pdf'
      );
      expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      if (locale === 'fa' && testInfo.project.name === 'mobile-safari')
        await page.screenshot({
          path: `/tmp/barghsa-document-${staff ? 'staff' : 'customer'}-fa-mobile-safari.png`,
          fullPage: true,
        });
      status = 403;
      await list.getByRole('button', { name: word('refresh'), exact: true }).click();
      await expect(content.getByRole('alert')).toContainText(word('denied'));
      await expect(uploadFile).toHaveCount(0);
      await expect(content.getByRole('button', { name: documentRow.originalName })).toHaveCount(0);
      await expect(content.getByRole('button', { name: word('retry'), exact: true })).toHaveCount(
        0
      );
    });
  }
for (const locale of ['en', 'fa'] as const) {
  test(`template queue and detail recover separately while metadata and version drafts remain (${locale})`, async ({
    page,
  }, testInfo) => {
    await shell(page, locale, true);
    const word = (key: Parameters<typeof documentTemplateText>[0]) =>
      documentTemplateText(key, locale);
    let listStatus = 503,
      detailStatus = 503,
      detailReads = 0,
      hold = false,
      held: Route | undefined;
    const queries: string[] = [];
    await page.route(
      (url) => url.pathname === '/api/admin/document-templates',
      (route) => {
        const url = new URL(route.request().url());
        queries.push(url.pathname + url.search);
        if (hold) {
          held = route;
          return;
        }
        return listStatus === 200
          ? route.fulfill({ json: [templateRow] })
          : route.fulfill({ status: listStatus, json: {} });
      }
    );
    await page.route(`**/api/admin/document-templates/${templateRow.id}`, (route) => {
      detailReads++;
      return detailStatus === 200
        ? route.fulfill({ json: templateDetail })
        : route.fulfill({ status: detailStatus, json: {} });
    });
    await page.goto('/admin/document-templates');
    const main = page.getByRole('main');
    const list = main.getByRole('region', { name: word('listTitle'), exact: true });
    const content = list.locator('[data-slot="list-content"]');
    await expect(content.getByRole('alert')).toBeVisible();
    listStatus = 200;
    await content.getByRole('button', { name: word('retry'), exact: true }).click();
    await page.locator('#document-template-category').selectOption('contract');
    await page.locator('#document-template-search').fill('Customer');
    await main.getByRole('button', { name: word('search'), exact: true }).click();
    await content.getByRole('button', { name: new RegExp(templateRow.title) }).click();
    const error = main.getByRole('alert').filter({ hasText: word('detailError') });
    await expect(error).toBeVisible();
    const count = queries.length;
    detailStatus = 200;
    await error.getByRole('button', { name: word('retry'), exact: true }).click();
    await expect(main.getByRole('heading', { level: 2, name: templateRow.title })).toBeVisible();
    expect(queries.length).toBe(count);
    await main.getByRole('button', { name: word('edit'), exact: true }).click();
    await page.locator('#document-template-title').fill('Metadata draft');
    await page.locator('#document-template-summary').fill('Version draft');
    await page.locator('#document-template-files').setInputFiles({
      name: 'Draft.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-draft'),
    });
    await main.getByRole('checkbox').uncheck();
    hold = true;
    await main.getByRole('button', { name: word('refresh'), exact: true }).click();
    await expect.poll(() => !!held).toBe(true);
    await expect(content).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#document-template-title')).toHaveValue('Metadata draft');
    await held!.fulfill({ status: 503, json: {} });
    hold = false;
    await expect(content.getByRole('alert')).toBeVisible();
    const reads = detailReads,
      query = queries.at(-1)!;
    expect(new URL(query, 'https://local').searchParams.get('search')).toBe('Customer');
    expect(new URL(query, 'https://local').searchParams.get('category')).toBe('contract');
    await content.getByRole('button', { name: word('retry'), exact: true }).click();
    await expect(content.getByRole('alert')).toHaveCount(0);
    expect(detailReads).toBe(reads);
    expect(queries.at(-1)).toBe(query);
    await expect(page.locator('#document-template-title')).toHaveValue('Metadata draft');
    await expect(page.locator('#document-template-summary')).toHaveValue('Version draft');
    await expect(main.getByRole('checkbox')).not.toBeChecked();
    expect(
      await page
        .locator('#document-template-files')
        .evaluate((input: HTMLInputElement) => input.files?.[0]?.name)
    ).toBe('Draft.pdf');
    expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    if (locale === 'fa' && testInfo.project.name === 'mobile-safari')
      await page.screenshot({
        path: '/tmp/barghsa-document-template-fa-mobile-safari.png',
        fullPage: true,
      });
    listStatus = 403;
    await main.getByRole('button', { name: word('refresh'), exact: true }).click();
    await expect(content.getByRole('alert')).toContainText(word('denied'));
    await expect(page.locator('#document-template-title')).toHaveCount(0);
    await expect(page.locator('#document-template-files')).toHaveCount(0);
  });
  test(`destruction queue recovery keeps approval reasons and clears newly ineligible work (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale, true);
    const word = (key: string) => documentText(key, locale);
    let status = 503,
      pending = true;
    await page.route('**/api/admin/document-retention/destruction', (route) =>
      status === 200
        ? route.fulfill({
            json: pending
              ? destructionQueue
              : {
                  ...destructionQueue,
                  items: [{ ...destructionQueue.items[0]!, status: 'approved' }],
                },
          })
        : route.fulfill({ status, json: {} })
    );
    await page.route('**/api/admin/documents?*', (route) =>
      route.fulfill({ json: { documents: [], nextBefore: null } })
    );
    await page.goto('/admin/documents');
    const main = page.getByRole('main');
    await main
      .locator('summary')
      .filter({ hasText: word('destructionQueue') })
      .click();
    const list = main.getByRole('region', { name: word('destructionQueue'), exact: true });
    const content = list.locator('[data-slot="list-content"]');
    await expect(content.getByRole('alert')).toBeVisible();
    status = 200;
    await content.getByRole('button', { name: word('retry'), exact: true }).click();
    await content.getByRole('button', { name: word('destructionApprove'), exact: true }).click();
    await list.locator('#destruction-note').fill('Legal approval draft');
    status = 503;
    await list.getByRole('button', { name: word('refresh'), exact: true }).click();
    await expect(content.getByRole('alert')).toBeVisible();
    await expect(list.locator('#destruction-note')).toHaveValue('Legal approval draft');
    status = 200;
    await content.getByRole('button', { name: word('retry'), exact: true }).click();
    await expect(content.getByRole('alert')).toHaveCount(0);
    await expect(list.locator('#destruction-note')).toHaveValue('Legal approval draft');
    pending = false;
    await list.getByRole('button', { name: word('refresh'), exact: true }).click();
    await expect(list.locator('#destruction-note')).toHaveCount(0);
    await expect(content.getByText(word('destructionApproved'), { exact: true })).toBeVisible();
    status = 403;
    await list.getByRole('button', { name: word('refresh'), exact: true }).click();
    await expect(content.getByRole('alert')).toContainText(word('denied'));
    await expect(content.getByText(documentRow.id, { exact: true })).toHaveCount(0);
    expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
  });
}
