import { documentUploadPolicy } from '../src/test/document-list-fixtures.js';
import { expandListFilters, test, expect, type Page } from './coverage-fixture';
import type { Locator, Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { documentText } from '@barghsa/i18n/documents';
import { documentTemplateText } from '@barghsa/i18n/document-templates';
import { approveRiskConfirmation } from './confirmation-fixture';
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

async function selectHoldExpiryDay(
  page: Page,
  date: Locator,
  instant: string,
  locale: 'en' | 'fa'
) {
  await date.press('ArrowDown');
  const calendar = page.getByRole('dialog', {
    name: documentText('holdExpiryDate', locale),
    exact: true,
  });
  const calendarDay = await page.evaluate(
    ({ instant, locale }) =>
      new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : undefined, {
        timeZone: 'Asia/Tehran',
      }).format(new Date(instant)),
    { instant, locale }
  );
  const day = calendar.locator(`button[data-day="${calendarDay}"]`);
  await expect(calendar).toBeVisible();
  if (!(await day.count())) await calendar.locator('button.rdp-button_next').click();
  await day.click();
}

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
        invalidPage = false,
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
          if (invalidPage) {
            const invalid = staff
              ? { ...documentMore, originalName: { text: 'Wrong name shape' } }
              : { ...documentMore, profileId: '99999999-9999-4999-8999-999999999999' };
            return route.fulfill({ json: { documents: [invalid], nextBefore: null } });
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
        await expandListFilters(page, locale);
        await page.locator('#documents-profile').fill(documentProfileId);
        await page.locator('#documents-category').selectOption('document');
        await page.locator('#documents-search').fill('Review');
        await page.getByRole('button', { name: word('apply'), exact: true }).click();
      }
      const main = page.getByRole('main');
      const list = main.getByRole('region', { name: word('listTitle'), exact: true });
      const content = list.locator('[data-slot="list-content"]');
      const rowRole = 'link';
      if (staff) {
        await expect
          .poll(() => new URL(queries.at(-1)!, 'https://local').searchParams.get('q'))
          .toBe('Review');
      }
      await expect(content).not.toHaveAttribute('aria-busy', 'true');
      await expect(content.getByRole('alert')).toBeVisible();
      status = 200;
      await content.getByRole('button', { name: word('retry'), exact: true }).click();
      await content.getByRole(rowRole, { name: documentRow.originalName, exact: true }).click();
      const detail = main.getByRole('region', { name: word('details'), exact: true });
      await expect(detail.getByRole('heading', { name: documentRow.originalName })).toBeVisible();
      if (staff) {
        await expect(detail.locator('#document-review-reason')).toHaveCount(0);
        await detail.getByRole('link', { name: word('request-changes'), exact: true }).click();
        await expect(page).toHaveURL(
          new RegExp(`/admin/documents/${documentRow.id}/decisions/request-changes`)
        );
        await detail.locator('#document-review-reason').fill('Review draft');
        await expect(detail.locator('#document-review-reason')).toHaveValue('Review draft');
        await main.getByRole('link', { name: word('backToDocument'), exact: true }).click();
      }
      await main.getByRole('link', { name: word('backToDocuments'), exact: true }).click();
      await expect(
        content.getByRole(rowRole, { name: documentRow.originalName, exact: true })
      ).toBeVisible();
      const reads = detailReads;
      hold = true;
      await list.getByRole('button', { name: word('next'), exact: true }).click();
      await expect.poll(() => !!held).toBe(true);
      await expect(content).toHaveAttribute('aria-busy', 'true');
      await expect(
        content.getByRole(rowRole, { name: documentRow.originalName, exact: true })
      ).toBeVisible();
      await held!.fulfill({ status: 503, json: {} });
      hold = false;
      await expect(content.getByRole('alert')).toBeVisible();
      const failed = queries.at(-1)!;
      const query = new URL(failed, 'https://local');
      expect(query.searchParams.get('before')).toBe(documentCursor);
      expect(query.searchParams.get('profileId')).toBe(documentProfileId);
      if (staff) {
        expect(query.searchParams.get('q')).toBe('Review');
        expect(query.searchParams.get('category')).toBe('document');
        expect(query.searchParams.get('state')).toBe('SubmittedForReview');
      }
      invalidPage = true;
      await content.getByRole('button', { name: word('retry'), exact: true }).click();
      await expect(content.getByRole('alert')).toBeVisible();
      await expect(content.getByRole(rowRole, { name: documentMore.originalName })).toHaveCount(0);
      expect(queries.at(-1)).toBe(failed);
      invalidPage = false;
      const count = queries.length;
      await content.getByRole('button', { name: word('retry'), exact: true }).click();
      await expect(
        content.getByRole(rowRole, { name: documentMore.originalName, exact: true })
      ).toBeVisible();
      expect(queries.slice(count)).toEqual([failed]);
      expect(detailReads).toBe(reads);
      expect(
        await content.getByRole(rowRole, { name: documentRow.originalName, exact: true }).count()
      ).toBe(1);
      const uploadFile = page.locator('[data-slot="file-upload"] input[type="file"]');
      const openDraft = async () => {
        await list.getByRole('link', { name: word('upload'), exact: true }).click();
        await expect
          .poll(() => new URL(page.url()).pathname)
          .toBe(staff ? '/admin/documents/new' : '/documents/new');
        await uploadFile.setInputFiles({
          name: 'Draft.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('%PDF-draft'),
        });
      };
      const refreshStart = queries.length;
      status = 503;
      await list.getByRole('button', { name: word('refresh'), exact: true }).click();
      const refreshError = content.getByRole('alert').filter({ hasText: word('listError') });
      await expect(refreshError).toBeVisible();
      const firstPage = new URL(failed, 'https://local');
      firstPage.searchParams.delete('before');
      expect(queries.slice(refreshStart)).toEqual([firstPage.pathname + firstPage.search]);
      status = 200;
      await refreshError.getByRole('button', { name: word('retry'), exact: true }).click();
      await expect(content.getByRole('alert')).toHaveCount(0);
      const refreshedReads = queries.length;
      status = 503;
      await openDraft();
      expect(await uploadFile.evaluate((input: HTMLInputElement) => input.files?.[0]?.name)).toBe(
        'Draft.pdf'
      );
      expect(queries).toHaveLength(refreshedReads);
      expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      if (locale === 'fa' && testInfo.project.name === 'mobile-safari')
        await page.screenshot({
          path: testInfo.outputPath(
            `barghsa-document-${staff ? 'staff' : 'customer'}-fa-mobile-safari.png`
          ),
          fullPage: true,
        });
      status = 200;
      await main.getByRole('button', { name: word('cancel'), exact: true }).click();
      await expect(
        content.getByRole(rowRole, { name: documentRow.originalName, exact: true })
      ).toBeVisible();
      status = 403;
      await list.getByRole('button', { name: word('refresh'), exact: true }).click();
      await expect(content.getByRole('alert')).toContainText(word('denied'));
      await expect(uploadFile).toHaveCount(0);
      await expect(content.getByRole(rowRole, { name: documentRow.originalName })).toHaveCount(0);
      await expect(content.getByRole('button', { name: word('retry'), exact: true })).toHaveCount(
        0
      );
    });
  }
for (const staff of [false, true])
  for (const locale of ['en', 'fa'] as const) {
    test(`${staff ? 'staff' : 'customer'} document details recover locally and discard signed links on denial (${locale})`, async ({
      page,
    }) => {
      await shell(page, locale, staff);
      const word = (key: string) => documentText(key, locale);
      const base = staff ? '/api/admin/documents' : '/api/documents';
      const diagnostic = 'Private upstream document diagnostic';
      const reads: string[] = [];
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route(
        (url) => url.pathname === base,
        (route) => {
          reads.push('list');
          return route.fulfill({ json: { documents: [documentRow], nextBefore: null } });
        }
      );
      let resume!: () => void;
      const held = new Promise<void>((resolve) => {
        resume = resolve;
      });
      let detailReads = 0;
      await page.route(`**${base}/${documentRow.id}`, async (route) => {
        reads.push('detail');
        if (++detailReads === 1) {
          await held;
          return route.fulfill({ status: 503, json: { message: diagnostic } });
        }
        return route.fulfill({
          json:
            detailReads === 2
              ? { ...documentDetail, originalName: { title: diagnostic } }
              : documentDetail,
        });
      });
      const url = 'https://storage.example.test/private.pdf';
      await page.route(`**${base}/${documentRow.id}/download`, (route) => {
        reads.push('download');
        return route.fulfill(
          reads.filter((read) => read === 'download').length === 1
            ? { json: { url } }
            : { status: 403, json: { message: diagnostic } }
        );
      });
      await page.goto(staff ? '/admin/documents' : '/documents');
      const list = page.getByRole('region', { name: word('listTitle'), exact: true });
      const row = list.getByRole('link', {
        name: documentRow.originalName,
        exact: true,
      });
      await row.press('Enter');
      const detail = page
        .getByRole('main')
        .getByRole('region', { name: word('details'), exact: true });
      try {
        await expect(detail.getByRole('status', { name: word('loading') })).toBeVisible();
      } finally {
        resume();
      }
      const retry = detail.getByRole('button', { name: word('refresh'), exact: true });
      for (const attempt of [1, 2]) {
        await expect.poll(() => detailReads).toBe(attempt);
        await expect(detail.getByRole('alert')).toContainText(word('error'));
        expect(new URL(page.url()).pathname).toBe(
          `${staff ? '/admin/documents' : '/documents'}/${documentRow.id}`
        );
        await expect(detail.getByText(diagnostic)).toHaveCount(0);
        await retry.press('Enter');
      }
      await expect(detail.getByRole('heading', { name: documentRow.originalName })).toBeVisible();
      const download = detail.getByRole('button', { name: word('download'), exact: true });
      await download.press('Enter');
      await expect(
        detail.getByRole('link', { name: word('openFile'), exact: true })
      ).toHaveAttribute('href', url);
      await download.press('Enter');
      await expect(detail.getByRole('alert')).toContainText(word('denied'));
      await expect(detail.getByRole('link', { name: word('openFile'), exact: true })).toHaveCount(
        0
      );
      await expect(detail.getByRole('heading', { name: documentRow.originalName })).toHaveCount(0);
      await expect(retry).toHaveCount(0);
      await expect(
        page.getByRole('link', { name: word('backToDocuments'), exact: true })
      ).toBeVisible();
      expect(reads).toEqual(['list', 'detail', 'detail', 'detail', 'download', 'download']);
      expect(errors).toEqual([]);
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
      malformedList = false,
      malformedDetail = false,
      detailReads = 0;
    const queries: string[] = [];
    await page.route(
      (url) => url.pathname === '/api/admin/document-templates',
      (route) => {
        const url = new URL(route.request().url());
        queries.push(url.pathname + url.search);
        return listStatus === 200
          ? route.fulfill({ json: malformedList ? [null] : [templateRow] })
          : route.fulfill({ status: listStatus, json: {} });
      }
    );
    await page.route(`**/api/admin/document-templates/${templateRow.id}`, (route) => {
      detailReads++;
      return detailStatus === 200
        ? route.fulfill({
            json: malformedDetail
              ? { ...templateDetail, versions: [{ ...templateDetail.versions[0], files: null }] }
              : templateDetail,
          })
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
    await content.getByRole('link', { name: templateRow.title, exact: true }).click();
    const error = main.getByRole('alert').filter({ hasText: word('detailError') });
    await expect(error).toBeVisible();
    const count = queries.length;
    detailStatus = 200;
    await error.getByRole('button', { name: word('retry'), exact: true }).click();
    await expect(
      main.getByRole('heading', { level: 1, name: templateRow.title, exact: true })
    ).toBeVisible();
    expect(queries.length).toBe(count);
    const refresh = main.getByRole('button', { name: word('refresh'), exact: true });
    const query = queries.at(-1)!;
    expect(new URL(query, 'https://local').searchParams.get('search')).toBe('Customer');
    expect(new URL(query, 'https://local').searchParams.get('category')).toBe('contract');
    await main.getByRole('link', { name: word('edit'), exact: true }).click();
    await page.locator('#document-template-title').fill('Metadata draft');
    malformedDetail = true;
    await refresh.click();
    await expect(error).toBeVisible();
    await expect(page.locator('#document-template-title')).toHaveValue('Metadata draft');
    malformedDetail = false;
    await error.getByRole('button', { name: word('retry'), exact: true }).click();
    await expect(error).toHaveCount(0);
    await expect(page.locator('#document-template-title')).toHaveValue('Metadata draft');
    expect(queries.length).toBe(count);

    const details = `/admin/document-templates/${templateRow.id}`;
    await page.goto(details + '/versions/new?category=contract&q=Customer');
    const summary = page.locator('#document-template-summary');
    const file = page.locator('#document-template-files');
    await summary.fill('Version draft');
    await file.setInputFiles({
      name: 'Draft.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-draft'),
    });
    await main.getByRole('checkbox').uncheck();
    detailStatus = 503;
    await refresh.click();
    await expect(error).toBeVisible();
    await expect(summary).toHaveValue('Version draft');
    detailStatus = 200;
    const reads = detailReads;
    await error.getByRole('button', { name: word('retry'), exact: true }).click();
    await expect(error).toHaveCount(0);
    await expect(summary).toHaveValue('Version draft');
    await expect(main.getByRole('checkbox')).not.toBeChecked();
    expect(await file.evaluate((input: HTMLInputElement) => input.files?.[0]?.name)).toBe(
      'Draft.pdf'
    );
    expect(detailReads).toBe(reads + 1);
    expect(queries.at(-1)).toBe(query);
    expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    if (locale === 'fa' && testInfo.project.name === 'mobile-safari')
      await page.screenshot({
        path: '/tmp/barghsa-document-template-fa-mobile-safari.png',
        fullPage: true,
      });
    detailStatus = 403;
    await refresh.click();
    await expect(main.getByRole('alert')).toContainText(word('denied'));
    await expect(file).toHaveCount(0);
    await expect(summary).toHaveCount(0);

    await page.goto('/admin/document-templates?category=contract&q=Customer');
    await expect(content.getByRole('link', { name: templateRow.title, exact: true })).toBeVisible();
    malformedList = true;
    await refresh.click();
    await expect(content.getByRole('alert')).toContainText(word('error'));
    await expect(content.getByRole('link', { name: templateRow.title, exact: true })).toBeVisible();
    malformedList = false;
    const detailBeforeListRetry = detailReads;
    await content.getByRole('button', { name: word('retry'), exact: true }).click();
    await expect(content.getByRole('alert')).toHaveCount(0);
    expect(detailReads).toBe(detailBeforeListRetry);
  });
  for (const source of ['detail', 'download'] as const) {
    test(`template ${source} denial withdraws the list and aborts stale reads (${locale})`, async ({
      page,
    }) => {
      await shell(page, locale, true);
      const word = (key: Parameters<typeof documentTemplateText>[0]) =>
        documentTemplateText(key, locale);
      const endpoint = '/api/admin/document-templates';
      const detailPath = `${endpoint}/${templateRow.id}`;
      const version = templateDetail.versions[0]!;
      const filePath = `${detailPath}/versions/${version.id}/files/${version.files[0]!.id}/download`;
      let hold = false;
      let heldList: Route | undefined;
      let aborted = false;
      page.on('requestfailed', (request) => {
        if (new URL(request.url()).pathname === endpoint) aborted = true;
      });
      await page.route(
        (url) => url.pathname === endpoint,
        (route) => {
          if (hold) {
            heldList = route;
            return;
          }
          return route.fulfill({ json: [templateRow] });
        }
      );
      await page.route(`**${detailPath}`, (route) =>
        source === 'detail'
          ? route.fulfill({ status: 403, json: { message: 'Private template data' } })
          : route.fulfill({ json: templateDetail })
      );
      await page.route(`**${filePath}`, (route) =>
        hold
          ? route.fulfill({ status: 403, json: { message: 'Private template data' } })
          : route.fulfill({ json: { url: 'https://files.example.test/terms.pdf' } })
      );
      await page.goto('/admin/document-templates');
      const main = page.getByRole('main');
      const list = main.getByRole('region', { name: word('listTitle'), exact: true });
      const row = list.getByRole('link', { name: templateRow.title, exact: true });
      const download = main.getByRole('button', { name: word('download'), exact: true });
      const signedLink = main.getByRole('link', { name: word('openFile'), exact: true });
      await expect(row).toBeVisible();
      try {
        hold = true;
        await main.getByRole('button', { name: word('refresh'), exact: true }).click();
        await expect.poll(() => !!heldList).toBe(true);
        await row.click();
        await expect.poll(() => aborted).toBe(true);
        if (source === 'download') {
          await main.locator(`a[href$="/versions/${version.id}"]`).click();
          hold = false;
          await download.click();
          await expect(signedLink).toBeVisible();
          hold = true;
          await download.click();
        }
        await expect(main.getByRole('alert')).toContainText(word('denied'));
        await expect(row).toHaveCount(0);
        await expect(download).toHaveCount(0);
        await expect(signedLink).toHaveCount(0);
        await heldList!.fulfill({ json: [templateRow] }).catch(() => {});
        await expect(main).not.toContainText('Private template data');
      } finally {
        await heldList?.abort().catch(() => {});
      }
    });
  }
  test(`document governance fields link validation to the exact input (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale, true);
    const word = (key: string) => documentText(key, locale);
    const writes: string[] = [];
    await page.route('**/api/admin/document-retention/**', (route) => {
      const request = route.request();
      if (request.method() !== 'GET') writes.push(request.url());
      return route.fallback();
    });
    await page.route('**/api/admin/document-retention/policies', (route) =>
      route.fulfill({ json: { policies: [], canManage: true } })
    );
    await page.route('**/api/admin/document-retention/holds?*', (route) =>
      route.fulfill({
        json: {
          canManage: true,
          held: true,
          holds: [
            {
              id: documentCursor,
              documentId: documentRow.id,
              profileId: null,
              active: true,
              reason: 'Preserve for audit',
              initiatedAt: documentRow.createdAt,
              expiresAt: null,
              releasedAt: null,
            },
          ],
        },
      })
    );
    await page.route('**/api/admin/documents?*', (route) =>
      route.fulfill({ json: { documents: [documentRow], nextBefore: null } })
    );
    await page.route(`**/api/admin/documents/${documentRow.id}`, (route) =>
      route.fulfill({ json: documentDetail })
    );
    await page.goto('/admin/documents');
    await page.getByRole('link', { name: word('retentionPolicies'), exact: true }).click();
    const retention = page.getByRole('region', { name: word('retentionPolicies'), exact: true });
    await expect(retention.locator('form')).toHaveCount(0);
    await retention
      .getByRole('link', {
        name: word('editRetentionFor').replace('{kind}', word('contract')),
        exact: true,
      })
      .click();
    const years = retention.getByRole('spinbutton', { name: word('retentionYears'), exact: true });
    const note = retention.getByRole('textbox', { name: word('approvalNote'), exact: true });
    const save = retention.getByRole('button', { name: word('reviewRetention'), exact: true });
    await expect(
      retention.getByRole('heading', { name: word('contract'), exact: true })
    ).toBeVisible();
    await expect(years).toHaveAttribute('aria-required', 'true');
    await expect(note).toHaveAttribute('aria-required', 'true');
    await years.fill('101');
    await note.fill('  ');
    await save.click();
    await expect(years).toHaveAccessibleDescription(word('retentionYearsError'));
    await expect(note).toHaveAccessibleDescription(word('legalReasonLength'));
    await years.fill('12');
    await expect(years).not.toHaveAttribute('aria-invalid', 'true');
    await expect(note).toHaveAttribute('aria-invalid', 'true');
    await note.fill('Reviewed by legal');
    await save.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByRole('link', { name: word('backToRetention'), exact: true }).click();
    await page.getByRole('link', { name: word('backToDocuments'), exact: true }).click();
    await page.getByRole('link', { name: documentRow.originalName, exact: true }).click();
    const detail = page.getByRole('region', { name: word('details'), exact: true });
    await expect(detail.locator('#document-review-reason')).toHaveCount(0);
    await detail.getByRole('link', { name: word('quarantine'), exact: true }).click();
    const quarantineReason = detail.getByRole('textbox', {
      name: word('decisionLabel.quarantine'),
      exact: true,
    });
    const reviewDecision = detail.getByRole('button', {
      name: word('reviewDecisionAction'),
      exact: true,
    });
    await expect(quarantineReason).toHaveAttribute('aria-required', 'true');
    await reviewDecision.click();
    await expect(quarantineReason).toHaveAccessibleDescription(word('reasonRequired'));
    await quarantineReason.fill('Quarantine reason');
    await expect(quarantineReason).not.toHaveAttribute('aria-invalid', 'true');
    await reviewDecision.click();
    await expect(page.getByRole('dialog')).toContainText('Quarantine reason');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('link', { name: word('backToDocument'), exact: true }).click();

    const holds = page.getByRole('region', { name: word('legalHolds'), exact: true });
    await expect(holds.getByRole('link', { name: word('newHold'), exact: true })).toHaveAttribute(
      'href',
      `/admin/documents/${documentRow.id}/holds/new`
    );
    await holds.getByRole('link', { name: word('openHolds'), exact: true }).click();
    await expect(holds.locator('form')).toHaveCount(0);
    await holds.getByRole('link', { name: word('newHold'), exact: true }).click();
    expect(new URL(page.url()).pathname).toBe(`/admin/documents/${documentRow.id}/holds/new`);
    const reason = holds.getByRole('textbox', { name: word('holdReason'), exact: true });
    const expiry = holds.getByRole('checkbox', { name: word('setHoldExpiry'), exact: true });
    const date = holds.getByRole('combobox', { name: word('holdExpiryDate'), exact: true });
    const time = holds.getByLabel(word('holdExpiryTime'), { exact: true });
    const release = holds.getByRole('textbox', { name: word('releaseNote'), exact: true });
    await expect(
      holds.getByRole('combobox', { name: word('holdScope'), exact: true })
    ).toHaveAttribute('aria-required', 'true');
    await expect(reason).toHaveAttribute('aria-required', 'true');
    await expect(expiry).not.toHaveAttribute('aria-required', 'true');
    await expect(release).toHaveCount(0);
    await expiry.check();
    await selectHoldExpiryDay(page, date, new Date().toISOString(), locale);
    await time.fill('00:00');
    await reason.fill('  ');
    await holds.getByRole('button', { name: word('reviewHold'), exact: true }).click();
    await expect(reason).toHaveAccessibleDescription(word('legalReasonLength'));
    await expect(time).toHaveAccessibleDescription(word('holdExpiryError'));
    await reason.fill('Preserve the sealed original');
    await expiry.uncheck();
    await expect(reason).not.toHaveAttribute('aria-invalid', 'true');
    await expect(date).toHaveCount(0);
    await expect(time).toHaveCount(0);
    await expect(expiry).toHaveAccessibleDescription(word('holdUntilReleased'));
    await holds.getByRole('button', { name: word('reviewHold'), exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Preserve the sealed original');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('link', { name: word('backToHolds'), exact: true }).click();
    await holds.getByRole('link', { name: word('releaseHold'), exact: true }).click();
    expect(new URL(page.url()).pathname).toBe(
      `/admin/documents/${documentRow.id}/holds/release/${documentCursor}`
    );
    await expect(reason).toHaveCount(0);
    await expect(release).toHaveAttribute('aria-required', 'true');
    await expect(release).not.toHaveAttribute('aria-invalid', 'true');
    await holds.getByRole('button', { name: word('reviewRelease'), exact: true }).click();
    await expect(release).toHaveAccessibleDescription(word('legalReasonLength'));
    await expect(release).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(writes).toEqual([]);
    expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
  });
  test(`legal hold routes bind scope, expiry, and release to verified receipts (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale, true);
    const word = (key: string) => documentText(key, locale);
    const root = `/admin/documents/${documentRow.id}/holds`;
    const createdId = '70000000-0000-4000-8000-000000000001';
    const unrelatedId = '70000000-0000-4000-8000-000000000002';
    const otherDocument = '70000000-0000-4000-8000-000000000003';
    const reason = 'Preserve the signed original for review';
    const note = 'The preservation review is complete';
    const tomorrow = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tehran' }).format(
      new Date(Date.now() + 86_400_000)
    );
    const expiresAt = `${tomorrow}T04:15:00.000Z`;
    const history: {
      id: string;
      reason: string;
      documentId: string | null;
      profileId: string | null;
      initiatedAt: string;
      expiresAt: string | null;
      releasedAt: string | null;
      active: boolean;
    }[] = [
      {
        id: unrelatedId,
        reason: 'UNRELATED-HOLD',
        documentId: otherDocument,
        profileId: null,
        initiatedAt: documentRow.createdAt,
        expiresAt: null,
        releasedAt: null,
        active: true,
      },
    ];
    const writes: unknown[] = [];
    await page.route(`**/api/admin/documents/${documentRow.id}`, (route) =>
      route.fulfill({ json: documentDetail })
    );
    await page.route('**/api/admin/document-retention/holds?*', (route) =>
      route.fulfill({
        json: {
          held: history.some((hold) => hold.id === createdId && hold.active),
          canManage: true,
          holds: history,
        },
      })
    );
    await page.route('**/api/admin/document-retention/holds', (route) => {
      const body = route.request().postDataJSON();
      writes.push(body);
      if (writes.length > 1) return route.fulfill({ status: 201, json: {} });
      const receipt = {
        id: createdId,
        reason,
        documentId: null,
        profileId: documentRow.profileId,
        initiatedAt: documentRow.createdAt,
        expiresAt,
        releasedAt: null,
        active: true,
      };
      history.push(receipt);
      return route.fulfill({ status: 201, json: receipt });
    });
    await page.route(`**/api/admin/document-retention/holds/${createdId}/release`, (route) => {
      writes.push(route.request().postDataJSON());
      const hold = history.find((row) => row.id === createdId)!;
      hold.active = false;
      hold.releasedAt = documentRow.updatedAt;
      return route.fulfill({ status: 200, json: hold });
    });
    await page.goto(`${root}/release/${unrelatedId}`);
    const holds = page.getByRole('region', { name: word('legalHolds'), exact: true });
    await expect(holds).toContainText(word('holdUnavailable'));
    await expect(holds).not.toContainText('UNRELATED-HOLD');
    await expect(holds.locator('form')).toHaveCount(0);
    const back = page.getByRole('link', { name: word('backToHolds'), exact: true });
    await back.click();
    const start = holds.getByRole('link', { name: word('newHold'), exact: true });
    await start.click();
    const scope = holds.getByRole('combobox', { name: word('holdScope'), exact: true });
    await scope.selectOption('profile');
    await expect(scope).toHaveAccessibleDescription(word('holdProfileHelp'));
    const expiry = holds.getByRole('checkbox', { name: word('setHoldExpiry'), exact: true });
    const date = holds.getByRole('combobox', { name: word('holdExpiryDate'), exact: true });
    const time = holds.getByLabel(word('holdExpiryTime'), { exact: true });
    await expect(date).toHaveCount(0);
    await expect(expiry).toHaveAccessibleDescription(word('holdUntilReleased'));
    await expiry.check();
    await expect(date).toBeEnabled();
    const reasonField = holds.getByRole('textbox', { name: word('holdReason'), exact: true });
    await reasonField.fill(reason);
    const review = holds.getByRole('button', { name: word('reviewHold'), exact: true });
    await review.click();
    await expect(date).toBeFocused();
    await expect(date).toHaveAttribute('aria-invalid', 'true');
    expect(writes).toEqual([]);
    await selectHoldExpiryDay(page, date, expiresAt, locale);
    await review.click();
    await expect(time).toBeFocused();
    await time.fill('07:45');
    await review.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(reason);
    await expect(dialog).toContainText(word('holdProfile'));
    await dialog.locator('button[type=submit]').click();
    await expect(holds.getByRole('status').filter({ hasText: word('holdRecorded') })).toBeVisible();
    expect(writes).toEqual([{ profileId: documentRow.profileId, reason, expiresAt }]);
    await back.click();
    await holds.getByRole('link', { name: word('releaseHold'), exact: true }).click();
    await expect(holds).toContainText(reason);
    await holds.getByRole('textbox', { name: word('releaseNote'), exact: true }).fill(note);
    await holds.getByRole('button', { name: word('reviewRelease'), exact: true }).click();
    await expect(dialog).toContainText(note);
    await approveRiskConfirmation(page, locale, 'destructive');
    await dialog.locator('button[type=submit]').click();
    await expect(
      holds.getByRole('status').filter({ hasText: word('releaseRecorded') })
    ).toBeVisible();
    expect(writes[1]).toEqual({ note });
    await back.click();
    await start.click();
    await reasonField.fill('Second hold with an unconfirmed response');
    await review.click();
    await dialog.locator('button[type=submit]').click();
    await expect(holds).toContainText(word('checkHoldHistory'));
    await expect(holds.locator('form')).toHaveCount(0);
    expect(writes).toHaveLength(3);
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
    await main.getByRole('link', { name: word('destructionQueue'), exact: true }).click();
    const list = main.getByRole('region', { name: word('destructionQueue'), exact: true });
    const content = list.locator('[data-slot="list-content"]');
    await expect(content.getByRole('alert')).toBeVisible();
    status = 200;
    await content.getByRole('button', { name: word('retry'), exact: true }).click();
    await content.getByRole('link', { name: word('destructionApprove'), exact: true }).click();
    const note = list.getByRole('textbox', { name: word('destructionApprovalNote'), exact: true });
    await expect(note).toHaveAttribute('aria-required', 'true');
    await note.fill('  ');
    await list
      .locator('form')
      .getByRole('button', { name: word('destructionReview'), exact: true })
      .click();
    await expect(note).toHaveAccessibleDescription(word('legalReasonLength'));
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await note.fill('Legal approval draft');
    await expect(note).not.toHaveAttribute('aria-invalid', 'true');
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

    status = 200;
    pending = true;
    const item = destructionQueue.items[0]!;
    const approval = 'Retention expired and the review is complete';
    await page.route(`**/api/admin/document-retention/destruction/${item.id}/approve`, (route) => {
      expect(route.request().postDataJSON()).toEqual({ note: approval });
      pending = false;
      return route.fulfill({
        json: { id: item.id, document_id: item.documentId, status: 'approved' },
      });
    });
    await page.goto(
      `/admin/documents/governance/destruction/${item.id}?profileId=${documentCursor}`
    );
    await expect(
      list.getByRole('link', { name: word('reviewDestructionDocument'), exact: true })
    ).toHaveAttribute('href', `/admin/documents/${item.documentId}`);
    await note.fill(approval);
    await list.getByRole('button', { name: word('destructionReview'), exact: true }).click();
    const review = page.getByRole('dialog');
    await expect(review).toContainText(approval);
    await expect(review).toContainText(item.documentId);
    await approveRiskConfirmation(page, locale, 'destructive');
    await review.locator('button[type=submit]').click();
    await expect(
      list.getByText(word('destructionApprovalRecorded'), { exact: true })
    ).toBeVisible();
    await expect(note).toHaveCount(0);
  });
}
