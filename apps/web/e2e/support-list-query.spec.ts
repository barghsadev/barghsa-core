import { expandListFilters, test, expect, type Page } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import { fullNavigation } from './navigation-fixture';
import AxeBuilder from '@axe-core/playwright';
import { t as appText } from '@barghsa/i18n/app';
import { tStaffConsultation } from '@barghsa/i18n/consultation-staff';
import { tTicketForms } from '@barghsa/i18n/ticket-forms';
import {
  supportTicket,
  supportQueue,
  supportComments,
  supportPeople,
  supportTeams,
} from '../src/test/support-queue-fixtures';
import { firstWork, olderWork, consultationWork } from '../src/test/staff-business-fixtures';
test.use({ viewport: { width: 390, height: 844 } });
async function shell(page: Page, locale: 'en' | 'fa', darkMode: boolean, customer = false) {
  await crmShell(page, locale);
  if (customer) {
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
    await page.route('**/api/profiles', (route) =>
      route.fulfill({ json: { profiles: [], activeProfileId: null } })
    );
  }
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
        darkMode,
      },
    })
  );
}

const teamId = '33333333-3333-4333-8333-333333333333';
const last = '88000000-0000-4000-8000-000000000001';
const second = '88000000-0000-4000-8000-000000000002';
const params = (page: Page) => new URL(page.url()).searchParams;
async function inspect(page: Page, locale: string, project: string, name: string, dark: boolean) {
  expect(
    (await new AxeBuilder({ page }).include('[data-slot="list-page"]').analyze()).violations
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (locale === 'fa' && project === 'mobile-safari')
    await page.screenshot({
      path: test.info().outputPath(`support-query-${name}-${dark ? 'dark' : 'light'}.png`),
    });
}
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true]) {
    for (const staff of [false, true])
      test(`${staff ? 'staff' : 'customer'} ticket URLs restore search, pages, scope and selection (${locale}, ${dark})`, async ({
        page,
      }, info) => {
        await shell(page, locale, dark, !staff);
        if (staff)
          await page.route('**/api/auth/user', (route) =>
            route.fulfill({
              json: {
                userId: 'staff',
                isStaff: true,
                operatingContext: 'staff',
                navigation: fullNavigation('staff'),
                canSwitchContext: false,
                requiresTosAcceptance: false,
              },
            })
          );
        const base = staff ? '/api/staff/tickets' : '/api/tickets';
        const path = staff ? '/admin/tickets' : '/tickets';
        const word = (key: string) => appText('tickets.' + key, locale);
        const row = (id: string) => ({
          ...supportTicket,
          id,
          subject:
            id === last
              ? 'Last question'
              : id === second
                ? 'Another question'
                : 'Delivery question',
        });
        const reads: URL[] = [];
        await page.route(
          (url) => url.pathname === base,
          (route) => {
            const url = new URL(route.request().url());
            reads.push(url);
            const number = url.searchParams.get('page');
            return route.fulfill({
              json: {
                ...supportQueue,
                data: [row(number === '3' ? last : number === '2' ? second : supportTicket.id)],
              },
            });
          }
        );
        for (const id of [supportTicket.id, second, last]) {
          await page.route(`**${base}/${id}`, (route) =>
            route.fulfill({
              json: { ...row(id), ...(staff ? { viewer: supportQueue.viewer } : {}) },
            })
          );
          await page.route(`**${base}/${id}/comments`, (route) =>
            route.fulfill({ json: supportComments })
          );
        }
        await page.route(`**${base}/assignees`, (route) => route.fulfill({ json: supportPeople }));
        await page.route(`**${base}/teams`, (route) =>
          route.fulfill({ json: supportTeams.map((team) => ({ ...team, id: teamId })) })
        );
        await page.goto(
          `${path}?q=Delivery&status=in_progress&order=asc&page=2&ticketId=${supportTicket.id}${staff ? '' : '&scope=active'}`
        );
        const list = page.locator('[data-slot="list-page"]').first();
        const content = list.locator('[data-slot="list-content"]');
        const reply = page.locator('#ticket-reply');
        const back = page.locator('[data-slot=tickets-page]').getByRole('link', {
          name: tTicketForms(staff ? 'backToStaffQueue' : 'backToTickets', locale),
          exact: true,
        });
        const subject = (name: string) => content.getByRole('link', { name, exact: true });
        await expect(
          page.getByRole('heading', { name: 'Delivery question', level: 1 })
        ).toBeVisible();
        expect(new URL(page.url()).pathname).toBe(`${path}/${supportTicket.id}`);
        expect(params(page).has('ticketId')).toBe(false);
        await expect(list).toHaveCount(0);
        expect(reads).toHaveLength(0);
        await back.click();
        await expect(subject('Another question')).toBeVisible();
        expect(Object.fromEntries(reads.at(-1)!.searchParams)).toMatchObject({
          page: '2',
          search: 'Delivery',
          status: 'in_progress',
          sortOrder: 'asc',
          ...(staff ? {} : { scope: 'active' }),
        });
        await list.getByRole('button', { name: word('next'), exact: true }).click();
        await expect(subject('Last question')).toBeVisible();
        const count = reads.length;
        await subject('Last question').click();
        await expect(page.getByRole('heading', { name: 'Last question', level: 1 })).toBeFocused();
        expect(new URL(page.url()).pathname).toBe(`${path}/${last}`);
        expect(params(page).get('page')).toBe('3');
        await page.reload();
        await expect(reply).toBeVisible();
        expect(reads).toHaveLength(count);
        await page.goBack();
        await expect(subject('Last question')).toBeVisible();
        await page.locator('#ticket-sort').selectOption('desc');
        await expect(subject('Delivery question')).toBeVisible();
        expect(params(page).has('page')).toBe(false);
        await page.locator('#ticket-filter').selectOption('resolved');
        await page.locator('#ticket-search').fill('Revised');
        await expect.poll(() => reads.at(-1)?.searchParams.get('search')).toBe('Revised');
        await page.reload();
        await expect(page.locator('#ticket-search')).toHaveValue('Revised');
        await expect(page.locator('#ticket-filter')).toHaveValue('resolved');
        await expect(page.locator('#ticket-sort')).toHaveValue('desc');
        expect(params(page).get('scope')).toBe(staff ? null : 'active');
        await inspect(
          page,
          locale,
          info.project.name,
          staff ? 'staff-ticket' : 'customer-ticket',
          dark
        );
      });
    test(`consultation URLs restore every queue criterion and selected request (${locale}, ${dark})`, async ({
      page,
    }, info) => {
      await shell(page, locale, dark);
      const base = '/api/admin/consultations/requests';
      const word = (key: string) => tStaffConsultation(key, locale);
      const reads: URL[] = [];
      await page.route('**/api/admin/consultations/teams', (route) =>
        route.fulfill({ json: { teams: [] } })
      );
      await page.route(
        (url) => url.pathname === base,
        (route) => {
          const url = new URL(route.request().url());
          reads.push(url);
          const cursor = url.searchParams.get('after');
          const id = cursor === olderWork ? last : cursor === firstWork ? olderWork : firstWork;
          return route.fulfill({
            json: {
              requests: [
                {
                  ...consultationWork(id),
                  profile_name: id === last ? 'Last buyer' : consultationWork(id).profile_name,
                },
              ],
              nextAfter: cursor === olderWork ? null : id,
            },
          });
        }
      );
      for (const id of [firstWork, olderWork, last])
        await page.route(`**${base}/${id}`, (route) =>
          route.fulfill({
            json: {
              request: consultationWork(id),
              history: [
                {
                  status: 'under_review',
                  actor_type: 'customer',
                  reason: 'Workshop consumption data supplied',
                  created_at: '2026-09-25T10:00:00.000Z',
                },
              ],
            },
          })
        );
      await page.goto(
        `/admin/consultations?status=under_review&assignment=mine&priority=high&minAgeDays=7&cursor=${firstWork}&requestId=${olderWork}`
      );
      const list = page.locator('[data-slot="list-page"]');
      const content = list.locator('[data-slot="list-content"]');
      const decision = page.locator('a[href*="/decisions/request-info"]');
      const back = page.getByRole('link', { name: word('backToStaffRequests'), exact: true });
      const row = (name: string) => content.getByRole('link', { name: new RegExp(name) });
      await expect(decision).toBeVisible();
      expect(new URL(page.url()).pathname).toBe('/admin/consultations/' + olderWork);
      expect(params(page).has('requestId')).toBe(false);
      expect(reads).toHaveLength(0);
      await expect(list).toHaveCount(0);
      await expect(
        page.getByRole('region', { name: word('customerResponse'), exact: true })
      ).toContainText('Workshop consumption data supplied');
      await decision.click();
      await expect(page.locator('#consultation-reason')).toBeVisible();
      expect(new URL(page.url()).pathname).toBe(
        '/admin/consultations/' + olderWork + '/decisions/request-info'
      );
      expect(reads).toHaveLength(0);
      await page.getByRole('link', { name: word('backToFeeRequest'), exact: true }).click();
      await back.click();
      await expect(row('Older buyer')).toBeVisible();
      expect(Object.fromEntries(reads.at(-1)!.searchParams)).toMatchObject({
        status: 'under_review',
        assignment: 'mine',
        priority: 'high',
        minAgeDays: '7',
        after: firstWork,
      });
      await expandListFilters(page, locale);
      await expect(
        page.getByRole('combobox', { name: word('filterAssignment'), exact: true })
      ).toHaveValue('mine');
      await expect(page.getByRole('combobox', { name: word('age'), exact: true })).toHaveValue('7');
      const more = list.getByRole('button', { name: word('moreWork'), exact: true });
      await expect(
        list.getByRole('button', {
          name: appText('historyPagination.previous', locale),
          exact: true,
        })
      ).toBeDisabled();
      await more.click();
      await expect(row('Last buyer')).toBeVisible();
      await page.reload();
      await expect(row('Last buyer')).toBeVisible();
      await expect(row('Older buyer')).toHaveCount(0);
      await expect(
        list.getByRole('navigation', {
          name: appText('historyPagination.label', locale),
          exact: true,
        })
      ).toHaveCount(0);
      const count = reads.length;
      await row('Last buyer').click();
      await expect(decision).toBeVisible();
      expect(new URL(page.url()).pathname).toBe('/admin/consultations/' + last);
      await decision.click();
      const input = page.locator('#consultation-reason');
      await expect(input).toBeVisible();
      await expect(input).toHaveValue('');
      expect(params(page).get('cursor')).toBe(olderWork);
      expect(reads).toHaveLength(count);
      await page.goBack();
      await expect(decision).toBeVisible();
      await page.goBack();
      await expect(row('Last buyer')).toBeVisible();
      await expandListFilters(page, locale);
      await page
        .getByRole('combobox', { name: word('priority'), exact: true })
        .selectOption('normal');
      await expect.poll(() => params(page).get('priority')).toBe('normal');
      await expect.poll(() => params(page).get('cursor')).toBeNull();
      await expect(row('First buyer')).toBeVisible();
      await page.goBack();
      await expect(row('Last buyer')).toBeVisible();
      await page.goForward();
      await expect(row('First buyer')).toBeVisible();
      await list.scrollIntoViewIfNeeded();
      await inspect(page, locale, info.project.name, 'consultation', dark);
    });
  }
