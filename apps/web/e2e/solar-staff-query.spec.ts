import { test, expect, type Page } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { crmShell } from './crm-shell-fixture';
import { tSolar } from '@barghsa/i18n/solar';
import {
  firstSolar,
  olderSolar,
  solarRequest,
  solarFile,
  solarDocuments,
  solarPostal,
  solarGuidance,
} from '../src/test/solar-staff-fixtures';

test.use({ viewport: { width: 390, height: 844 } });
const oldest = '84000000-0000-4000-8000-000000000004';
const cases = [
  {
    name: 'files',
    path: '/admin/solar-requests',
    base: '/api/admin/solar/document-review-queue',
    key: 'documents',
    cursor: 'files_cursor',
    slot: 0,
    more: 'moreFiles',
  },
  {
    name: 'requests',
    path: '/admin/solar-requests',
    base: '/api/admin/solar/requests',
    key: 'requests',
    cursor: 'requests_cursor',
    slot: 1,
    more: 'moreRequests',
  },
  {
    name: 'postal',
    path: '/admin/solar-postal',
    base: '/api/admin/solar/postal-queue',
    key: 'requests',
    cursor: 'cursor',
    slot: 0,
    more: 'moreRequests',
  },
] as const;
const params = (page: Page) => new URL(page.url()).searchParams;
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true])
    for (const item of cases)
      test(`solar ${item.name} URLs restore independent cursors and safe review scope (${locale}, ${dark})`, async ({
        page,
      }, info) => {
        const copy = (key: string) => tSolar(key, locale);
        await crmShell(page, locale);
        await page.route('**/api/public/branding/config', (r) =>
          r.fulfill({
            json: {
              appTitle: 'Barghsa',
              appTitleFa: 'برق‌آسا',
              supportEmail: 'support@example.test',
              supportPhone: '+982112345678',
              supportMobile: '+989121234567',
              slogan: '',
              primaryColor: '#2563eb',
              secondaryColor: '#64748b',
              accentColor: '#f59e0b',
              backgroundColor: '#f6f7f4',
              darkBackgroundColor: '#15201c',
              fontFamily: 'vazirmatn',
              borderRadiusRem: 0.75,
              spacingScale: 1,
              numberStyle: 'locale',
              logoUrl: null,
              faviconUrl: null,
              darkMode: dark,
            },
          })
        );
        let guidanceReads = 0;
        await page.route('**/api/admin/solar/*-guidance', (r) => {
          guidanceReads++;
          return r.fulfill({ json: solarGuidance });
        });
        await page.route('**/api/admin/solar/requests/*/documents', (r) =>
          r.fulfill({ json: solarDocuments() })
        );
        const reads: URL[] = [],
          siblingReads: string[] = [],
          writes: string[] = [];
        let fail = true,
          denied = false;
        for (const queue of cases) {
          await page.route(
            (url) => url.pathname === queue.base,
            (r) => {
              const url = new URL(r.request().url());
              if (queue.name !== item.name) {
                siblingReads.push(url.pathname + url.search);
                return r.fulfill({
                  json: {
                    [queue.key]: [queue.name === 'files' ? solarFile() : solarRequest()],
                    nextBefore: null,
                  },
                });
              }
              reads.push(url);
              if (denied) return r.fulfill({ status: dark ? 401 : 403, json: {} });
              const cursor = url.searchParams.get('before');
              if (cursor === firstSolar && fail) return r.fulfill({ status: 503, json: {} });
              const ids = !cursor
                ? [firstSolar]
                : cursor === firstSolar
                  ? [olderSolar]
                  : [olderSolar, oldest];
              const rows = ids.map((id) =>
                queue.name === 'files'
                  ? {
                      ...solarFile(id),
                      file_name: id === oldest ? 'oldest.pdf' : solarFile(id).file_name,
                    }
                  : {
                      ...(queue.name === 'postal' ? solarPostal(id) : solarRequest(id)),
                      profile_name:
                        id === oldest ? 'Oldest solar buyer' : solarRequest(id).profile_name,
                    }
              );
              return r.fulfill({
                json: {
                  [queue.key]: rows,
                  nextBefore:
                    cursor === oldest
                      ? null
                      : !cursor
                        ? firstSolar
                        : cursor === firstSolar
                          ? olderSolar
                          : oldest,
                },
              });
            }
          );
        }
        await page.route(
          (url) =>
            url.pathname.startsWith('/api/admin/solar/') &&
            !cases.some((q) => q.base === url.pathname) &&
            !url.pathname.includes('guidance') &&
            !url.pathname.endsWith('/documents'),
          (r) => {
            writes.push(r.request().url());
            return r.fulfill({ status: 500, json: {} });
          }
        );
        await page.goto(item.path);
        const list = page.locator('[data-slot="list-page"]').nth(item.slot);
        const content = list.locator('[data-slot="list-content"]');
        const first = item.name === 'files' ? /first.pdf/ : /First solar buyer/;
        const older = item.name === 'files' ? /older.pdf/ : /Older solar buyer/;
        const last = item.name === 'files' ? /oldest.pdf/ : /Oldest solar buyer/;
        await expect(content.getByRole('button', { name: first })).toBeVisible();
        await page
          .getByRole('button', { name: /First solar buyer/ })
          .first()
          .click();
        const note =
          item.name === 'postal'
            ? page.getByRole('textbox', { name: copy('reason'), exact: true })
            : page.locator('#solar-review-reason');
        await note.fill('LOCAL-REASON');
        const guidance = page.locator('form textarea').first();
        await guidance.fill('LOCAL-GUIDANCE');
        const siblings = siblingReads.length;
        const more = list.getByRole('button', { name: copy(item.more), exact: true });
        await more.click();
        const retry = content.getByRole('button', { name: copy('retry'), exact: true });
        await expect(retry).toBeVisible();
        await expect(note).toHaveValue('LOCAL-REASON');
        await expect(guidance).toHaveValue('LOCAL-GUIDANCE');
        expect(params(page).get(item.cursor)).toBe(firstSolar);
        expect(page.url()).not.toContain('LOCAL-');
        const failed = reads.at(-1)!.search;
        fail = false;
        await retry.click();
        await expect(content.getByRole('button', { name: older })).toBeVisible();
        expect(reads.at(-1)!.search).toBe(failed);
        expect(siblingReads).toHaveLength(siblings);
        await expect(content.getByRole('button', { name: first })).toBeVisible();
        await expect(note).toHaveValue('LOCAL-REASON');
        await page.reload();
        await expect(content.getByRole('button', { name: older })).toBeVisible();
        await expect(content.getByRole('button', { name: first })).toHaveCount(0);
        expect(params(page).get(item.cursor)).toBe(firstSolar);
        expect(reads.at(-1)!.searchParams.get('before')).toBe(firstSolar);
        await guidance.fill('LOCAL-GUIDANCE');
        const fixedGuidanceReads = guidanceReads;
        await page.goBack();
        await expect(content.getByRole('button', { name: first })).toBeVisible();
        await expect(content.getByRole('button', { name: older })).toHaveCount(0);
        await page.goForward();
        await expect(content.getByRole('button', { name: older })).toBeVisible();
        await page
          .getByRole('button', { name: /First solar buyer/ })
          .first()
          .click();
        await note.fill('LOCAL-REASON');
        await page
          .locator('form')
          .getByRole('button', {
            name: copy(item.name === 'postal' ? 'postalSaveGuidance' : 'saveGuidance'),
            exact: true,
          })
          .click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await page.goBack();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(note).toHaveCount(0);
        await expect(guidance).toHaveValue('LOCAL-GUIDANCE');
        await page.goForward();
        await expect(content.getByRole('button', { name: older })).toBeVisible();
        await more.click();
        await expect(content.getByRole('button', { name: last })).toBeVisible();
        await expect(content.getByRole('button', { name: older })).toHaveCount(1);
        expect(params(page).get(item.cursor)).toBe(olderSolar);
        if (item.name !== 'postal') {
          const otherCursor = item.name === 'files' ? 'requests_cursor' : 'files_cursor';
          expect(params(page).has(otherCursor)).toBe(false);
        } else {
          await page.locator('#solar-postal-lane').selectOption('waiting_customer');
          await expect(content.getByRole('button', { name: first })).toBeVisible();
          await expect(content.getByRole('button', { name: older })).toHaveCount(0);
          expect(params(page).get('lane')).toBe('waiting_customer');
          expect(params(page).has('cursor')).toBe(false);
          expect(Object.fromEntries(reads.at(-1)!.searchParams)).toEqual({
            lane: 'waiting_customer',
          });
          await page.goBack();
          await expect(page.locator('#solar-postal-lane')).toHaveValue('needs_staff');
          await expect(content.getByRole('button', { name: last })).toBeVisible();
          expect(params(page).get('cursor')).toBe(olderSolar);
        }
        expect(guidanceReads).toBe(fixedGuidanceReads);
        expect(writes).toEqual([]);
        await expect
          .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
          .toBe(dark);
        expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true
        );
        if (locale === 'fa' && info.project.name === 'mobile-safari') {
          await page.evaluate(() => scrollTo(0, 0));
          await page.screenshot({
            path: `/tmp/barghsa-solar-query-${item.name}-${dark ? 'dark' : 'light'}.png`,
          });
        }
        await content.getByRole('button', { name: last }).click();
        denied = true;
        await more.click();
        await expect(content.getByRole('alert')).toHaveText(copy('staffQueueForbidden'));
        await expect(content.getByRole('button')).toHaveCount(0);
        await expect(note).toHaveCount(0);
        await expect(guidance).toHaveValue('LOCAL-GUIDANCE');
      });
