import { documentUploadPolicy } from '../src/test/document-list-fixtures.js';
import { test, expect, type Page } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import AxeBuilder from '@axe-core/playwright';
import { documentText } from '@barghsa/i18n/documents';
import { contractText } from '@barghsa/i18n/contracts';
import { t as appText } from '@barghsa/i18n/app';
import {
  documentRow,
  documentMore,
  documentProfileId,
  documentDetail,
} from '../src/test/document-list-fixtures';
import {
  financeContractId,
  financeContract,
  financeVersion,
} from '../src/test/contract-finance-list-fixtures';
test.use({ viewport: { width: 390, height: 844 } });
const last = '88888888-8888-4888-8888-888888888888';
const newProfile = '99999999-9999-4999-8999-999999999999';
const newDocument = '77777777-7777-4777-8777-777777777777';
const params = (page: Page) => new URL(page.url()).searchParams;
async function shell(page: Page, locale: 'en' | 'fa', dark: boolean, customer = false) {
  await crmShell(page, locale);
  if (customer)
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({
        json: {
          userId: 'customer',
          isStaff: false,
          operatingContext: 'customer',
          requiresTosAcceptance: false,
        },
      })
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
  await page.route('**/api/admin/document-retention/holds?*', (route) =>
    route.fulfill({ json: { holds: [], held: false, canManage: false } })
  );
  await page.route('**/api/public/branding/config', (route) =>
    route.fulfill({
      json: {
        appTitle: 'Barghsa',
        appTitleFa: 'برق‌آسا',
        supportEmail: 'support@example.test',
        supportPhone: '+982112345678',
        supportMobile: '+989121234567',
        backgroundColor: '#f6f7f4',
        darkBackgroundColor: '#15201c',
        fontFamily: 'vazirmatn',
        borderRadiusRem: 0.75,
        spacingScale: 1,
        numberStyle: 'locale',
        slogan: '',
        primaryColor: '#2563eb',
        secondaryColor: '#64748b',
        accentColor: '#f59e0b',
        logoUrl: null,
        faviconUrl: null,
        darkMode: dark,
      },
    })
  );
  await page.route('**/api/upload/policy/*', (route) =>
    route.fulfill({
      json: documentUploadPolicy(new URL(route.request().url()).pathname.split('/').at(-1)),
    })
  );
}
async function inspect(page: Page, locale: string, project: string, name: string, dark: boolean) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(dark);
  expect(
    (await new AxeBuilder({ page }).include('[data-slot="list-page"]').analyze()).violations
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (locale === 'fa' && project === 'mobile-safari')
    await page.screenshot({
      path: `/tmp/barghsa-record-query-${name}-${dark ? 'dark' : 'light'}.png`,
    });
}
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true]) {
    for (const staff of [false, true])
      test(`${staff ? 'staff' : 'customer'} document URLs restore applied criteria, pages and selection (${locale}, ${dark})`, async ({
        page,
      }, info) => {
        await shell(page, locale, dark, !staff);
        const word = (key: string) => documentText(key, locale);
        const base = staff ? '/api/admin/documents' : '/api/documents';
        let activeProfile = documentProfileId;
        await page.route('**/api/profiles', (route) =>
          route.fulfill({
            json: {
              activeProfileId: activeProfile,
              hasDefault: true,
              profiles: [
                {
                  id: activeProfile,
                  title: 'Current profile',
                  profileType: 'LEGAL',
                  status: 'ACTIVE',
                  isDefault: true,
                },
              ],
            },
          })
        );
        const reads: URL[] = [];
        await page.route(
          (url) => url.pathname === base,
          (route) => {
            const url = new URL(route.request().url());
            reads.push(url);
            const cursor = url.searchParams.get('before');
            const row =
              activeProfile === newProfile
                ? {
                    ...documentRow,
                    profileId: newProfile,
                    id: newDocument,
                    originalName: 'New profile.pdf',
                  }
                : cursor === documentMore.id
                  ? { ...documentRow, id: last, originalName: 'Last.pdf' }
                  : cursor
                    ? documentMore
                    : documentRow;
            return route.fulfill({
              json: {
                documents: [row],
                nextBefore:
                  activeProfile === newProfile || cursor === documentMore.id
                    ? null
                    : cursor
                      ? documentMore.id
                      : documentRow.id,
              },
            });
          }
        );
        for (const row of [
          documentRow,
          documentMore,
          { ...documentRow, id: newDocument, profileId: newProfile },
        ])
          await page.route(`**${base}/${row.id}`, (route) =>
            route.fulfill({ json: { ...documentDetail, ...row } })
          );
        await page.goto(
          `${staff ? '/admin/documents' : '/documents'}?q=Review&kind=standalone&state=SubmittedForReview&category=document&profileId=${documentProfileId}&cursor=${documentRow.id}&documentId=${documentRow.id}`
        );
        const list = page.getByRole('region', { name: word('listTitle'), exact: true });
        const content = list.locator(':scope > [data-slot="list-content"]');
        const detail = list.getByRole('region', { name: word('details'), exact: true });
        await expect(
          content.getByRole('button', { name: 'Another.pdf', exact: true })
        ).toBeVisible();
        await expect(detail).toBeVisible();
        await expect(page.locator('#documents-search')).toHaveValue('Review');
        expect(Object.fromEntries(reads.at(-1)!.searchParams)).toMatchObject({
          q: 'Review',
          businessRecordType: 'standalone',
          state: 'SubmittedForReview',
          category: 'document',
          profileId: documentProfileId,
          before: documentRow.id,
        });
        const count = reads.length;
        await page.locator('#documents-search').fill('Unapplied');
        expect(reads).toHaveLength(count);
        expect(params(page).get('q')).toBe('Review');
        if (staff) await page.locator('#document-review-reason').fill('Private review draft');
        await list.getByRole('button', { name: word('next'), exact: true }).click();
        await expect(content.getByRole('button', { name: 'Last.pdf', exact: true })).toBeVisible();
        await expect(
          content.getByRole('button', { name: 'Another.pdf', exact: true })
        ).toBeVisible();
        await expect(page.locator('#documents-search')).toHaveValue('Unapplied');
        if (staff)
          await expect(page.locator('#document-review-reason')).toHaveValue('Private review draft');
        const selectedReads = reads.length;
        await content.getByRole('button', { name: 'Another.pdf', exact: true }).click();
        await expect.poll(() => params(page).get('documentId')).toBe(documentMore.id);
        expect(reads).toHaveLength(selectedReads);
        if (staff) await expect(page.locator('#document-review-reason')).toHaveValue('');
        await page.reload();
        await expect(content.getByRole('button', { name: 'Last.pdf', exact: true })).toBeVisible();
        await expect(content.getByRole('button', { name: 'Another.pdf', exact: true })).toHaveCount(
          0
        );
        await expect(detail).toBeVisible();
        await expect(page.locator('#documents-search')).toHaveValue('Review');
        await expect(
          list.getByRole('button', {
            name: appText('historyPagination.previous', locale),
            exact: true,
          })
        ).toHaveCount(0);
        await page.locator('#documents-state').selectOption('');
        await page.getByRole('button', { name: word('apply'), exact: true }).click();
        await expect(
          content.getByRole('button', { name: 'Review.pdf', exact: true })
        ).toBeVisible();
        await expect.poll(() => params(page).get('cursor')).toBeNull();
        await expect.poll(() => params(page).get('documentId')).toBeNull();
        expect(reads.at(-1)!.searchParams.has('state')).toBe(false);
        await expect(page.locator('#documents-state')).toHaveValue('');
        await page.reload();
        await expect(page.locator('#documents-state')).toHaveValue('');
        if (staff) expect(params(page).get('state')).toBe('all');
        await page.goBack();
        await expect(content.getByRole('button', { name: 'Last.pdf', exact: true })).toBeVisible();
        await expect(detail).toBeVisible();
        await page.goForward();
        await expect(
          content.getByRole('button', { name: 'Review.pdf', exact: true })
        ).toBeVisible();
        await expect(detail).toHaveCount(0);
        if (!staff) {
          await list.getByRole('button', { name: word('next'), exact: true }).click();
          await expect(
            content.getByRole('button', { name: 'Another.pdf', exact: true })
          ).toBeVisible();
          await expect.poll(() => params(page).get('cursor')).toBe(documentRow.id);
          await list.getByRole('button', { name: word('upload'), exact: true }).click();
          await page.locator('[data-slot="file-upload"] input[type="file"]').setInputFiles({
            name: 'Private.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from('%PDF-draft'),
          });
          activeProfile = newProfile;
          await page.evaluate(() => {
            const channel = new BroadcastChannel('barghsa-profile-context');
            channel.postMessage({ type: 'profile-changed' });
            channel.close();
          });
          await expect(
            content.getByRole('button', { name: 'New profile.pdf', exact: true })
          ).toBeVisible();
          await expect(page.locator('[data-slot="file-upload"] input[type="file"]')).toHaveCount(0);
          await expect.poll(() => reads.at(-1)?.searchParams.get('profileId')).toBe(newProfile);
          expect(params(page).has('profileId')).toBe(false);
          await expect.poll(() => params(page).has('cursor')).toBe(false);
          await expect.poll(() => params(page).has('documentId')).toBe(false);
          await expect.poll(() => reads.at(-1)?.searchParams.has('before')).toBe(false);
          await content.getByRole('button', { name: 'New profile.pdf', exact: true }).click();
          await expect.poll(() => params(page).get('documentId')).toBe(newDocument);
          activeProfile = documentProfileId;
          await page.evaluate(() => {
            const channel = new BroadcastChannel('barghsa-profile-context');
            channel.postMessage({ type: 'profile-changed' });
            channel.close();
          });
          await expect(
            content.getByRole('button', { name: 'Review.pdf', exact: true })
          ).toBeVisible();
          await expect.poll(() => params(page).has('documentId')).toBe(false);
          await expect
            .poll(() => reads.at(-1)?.searchParams.get('profileId'))
            .toBe(documentProfileId);
          await expect(detail).toHaveCount(0);
        }
        await list.scrollIntoViewIfNeeded();
        await inspect(
          page,
          locale,
          info.project.name,
          staff ? 'staff-document' : 'customer-document',
          dark
        );
      });
    test(`staff contract URLs preserve exact numbers, filters and independent detail (${locale}, ${dark})`, async ({
      page,
    }, info) => {
      await shell(page, locale, dark);
      const word = (key: string) => contractText(key, locale);
      const reads: URL[] = [];
      await page.route(
        (url) => url.pathname === '/api/admin/contracts',
        (route) => {
          const url = new URL(route.request().url());
          reads.push(url);
          const cursor = url.searchParams.get('before');
          const id = cursor === documentMore.id ? last : cursor ? documentMore.id : documentRow.id;
          return route.fulfill({
            json: {
              contracts: [
                {
                  id,
                  contractNumber: url.searchParams.get('contractNumber') || '42',
                  state: 'Active',
                  serviceType: 'electricity',
                  versionId: financeVersion.id,
                  versionNumber: id === last ? 3 : id === documentMore.id ? 2 : 1,
                },
              ],
              nextBefore: cursor === documentMore.id ? null : id,
            },
          });
        }
      );
      await page.route(`**/api/admin/contracts/${financeContractId}`, (route) =>
        route.fulfill({ json: financeContract })
      );
      await page.route(`**/api/admin/contracts/${financeContractId}/versions*`, (route) =>
        route.fulfill({ json: { versions: [financeVersion], nextBefore: null } })
      );
      await page.route(`**/api/admin/contracts/${financeContractId}/activation*`, (route) =>
        route.fulfill({
          json: { checks: [], isCurrent: true, ready: false, evaluatedAt: '2026-10-01T00:00:00Z' },
        })
      );
      await page.route(
        `**/api/admin/contracts/${financeContractId}/cancellation-requests`,
        (route) => route.fulfill({ json: { request: null, canRequest: false } })
      );
      await page.goto(
        `/admin/contracts?contractNumber=${encodeURIComponent(JSON.stringify('9223372036854775807'))}&profileId=${documentProfileId}&state=Active&serviceType=electricity&cursor=${documentRow.id}&contractId=${financeContractId}`
      );
      const list = page.getByRole('region', { name: word('staffTitle'), exact: true });
      const content = list.locator(':scope > [data-slot="list-content"]');
      const row = (version: number) =>
        content.getByRole('button', {
          name: `${word('electricity')} · ${word('version')} ${version.toLocaleString(locale)}`,
          exact: true,
        });
      const detail = list.getByRole('region', { name: word('terms'), exact: true });
      await expect(row(2)).toBeVisible();
      await expect(detail).toBeVisible();
      await expect(page.locator('#contracts-number')).toHaveValue('9223372036854775807');
      expect(Object.fromEntries(reads.at(-1)!.searchParams)).toMatchObject({
        contractNumber: '9223372036854775807',
        profileId: documentProfileId,
        state: 'Active',
        serviceType: 'electricity',
        before: documentRow.id,
      });
      await list.getByRole('button', { name: word('next'), exact: true }).click();
      await expect(row(3)).toBeVisible();
      await expect(row(2)).toBeVisible();
      await page.reload();
      await expect(row(3)).toBeVisible();
      await expect(row(2)).toHaveCount(0);
      await expect(detail).toBeVisible();
      const count = reads.length;
      await page.locator('#contracts-number').fill('9223372036854775808');
      await page.getByRole('button', { name: word('apply'), exact: true }).click();
      await expect(page.locator('#contracts-number')).toHaveAttribute('aria-invalid', 'true');
      expect(reads).toHaveLength(count);
      await page.locator('#contracts-number').fill('42');
      await page.getByRole('button', { name: word('apply'), exact: true }).click();
      await expect(row(1)).toBeVisible();
      await expect(detail).toHaveCount(0);
      expect(params(page).has('cursor')).toBe(false);
      expect(params(page).has('contractId')).toBe(false);
      await page.goBack();
      await expect(row(3)).toBeVisible();
      await expect(detail).toBeVisible();
      await expect(page.locator('#contracts-number')).toHaveValue('9223372036854775807');
      await page.goForward();
      await expect(row(1)).toBeVisible();
      await expect(page.locator('#contracts-number')).toHaveValue('42');
      await list.scrollIntoViewIfNeeded();
      await inspect(page, locale, info.project.name, 'staff-contract', dark);
    });
  }
