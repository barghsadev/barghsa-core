import { test, expect, type Page } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import AxeBuilder from '@axe-core/playwright';
import { t as adminText } from '@barghsa/i18n/admin-ui';
import { t as appText } from '@barghsa/i18n/app';
import { tSaving } from '@barghsa/i18n/saving';
import { tSavingStaffReview } from '@barghsa/i18n/saving-staff-review';
import {
  firstWork,
  olderWork,
  electricityWork,
  savingWork,
} from '../src/test/staff-business-fixtures';
test.use({ viewport: { width: 390, height: 844 } });
async function shell(page: Page, locale: 'en' | 'fa', darkMode: boolean) {
  await crmShell(page, locale);
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

const lastWork = '83000000-0000-4000-8000-000000000004';
const cases = [
  {
    name: 'electricity',
    path: '/admin/electricity-orders',
    base: '/api/staff/electricity/orders',
    key: 'view',
    other: 'conversations',
    row: electricityWork,
    draft: '#electricity-review-reason',
  },
  {
    name: 'saving',
    path: '/admin/saving-orders',
    base: '/api/staff/saving/orders',
    key: 'lane',
    other: 'fulfillment',
    row: savingWork,
    draft: '#saving-staff-note',
  },
];
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true])
    for (const item of cases) {
      test(`${item.name} queue URLs restore pages and selections (${locale}, ${dark})`, async ({
        page,
      }, info) => {
        await shell(page, locale, dark);
        const reads: URL[] = [];
        await page.route(
          (url) => url.pathname === item.base || url.pathname === item.base + '/conversations',
          (route) => {
            const url = new URL(route.request().url());
            reads.push(url);
            const cursor = url.searchParams.get('after');
            const id =
              cursor === olderWork ? lastWork : cursor === firstWork ? olderWork : firstWork;
            return route.fulfill({
              json: {
                orders: [
                  {
                    ...item.row(id),
                    customerName: id === lastWork ? 'Last buyer' : item.row(id).customerName,
                  },
                ],
                nextAfter: cursor === olderWork ? null : id,
              },
            });
          }
        );
        for (const id of [firstWork, olderWork, lastWork])
          await page.route(`**${item.base}/${id}`, (route) =>
            route.fulfill({
              json: {
                ...item.row(id),
                customerName: id === lastWork ? 'Last buyer' : item.row(id).customerName,
              },
            })
          );
        await page.route(`**${item.base}/*/comments`, (route) =>
          route.fulfill({ json: { comments: [] } })
        );
        const words = (key: 'review' | 'other' | 'more') =>
          item.name === 'electricity'
            ? adminText(
                'admin.electricityOrders.' +
                  { review: 'reviewView', other: 'conversationView', more: 'more' }[key],
                locale
              )
            : tSaving(
                {
                  review: 'staffReviewLane',
                  other: 'staffFulfillmentLane',
                  more: 'staffMoreOrders',
                }[key],
                locale
              );
        const params = () => new URL(page.url()).searchParams;
        await page.goto(
          `${item.path}?${item.key}=${item.other}&cursor=${firstWork}&orderId=${olderWork}`
        );
        const list = page.locator('[data-slot="list-page"]').first();
        const content =
          item.name === 'saving'
            ? list
                .getByLabel(tSaving('staffQueue', locale), { exact: true })
                .filter({ has: page.locator('[data-slot="list-content"]') })
                .locator('[data-slot="list-content"]')
                .first()
            : list.locator('[data-slot="list-content"]').first();
        const more = list.getByRole('button', { name: words('more'), exact: true });
        const previous = list.getByRole('button', {
          name: appText('historyPagination.previous', locale),
          exact: true,
        });
        const input = page.locator(item.draft);
        const electricity = item.name === 'electricity';
        const operation = electricity ? '/decisions/request-changes' : '/reject';
        const decision = page.locator(`a[href*="${operation}"]`);
        const laneAndPage = `?${item.key}=${item.other}&cursor=${firstWork}`;
        const canonical = `${item.path}/${olderWork}${laneAndPage}`;
        await expect(page).toHaveURL(canonical);
        await expect(decision).toBeVisible();
        expect(reads).toHaveLength(0);
        await page.reload();
        await expect(page).toHaveURL(canonical);
        await expect(decision).toBeVisible();
        expect(reads).toHaveLength(0);
        const back = page.getByRole('link', {
          name:
            item.name === 'electricity'
              ? adminText('admin.electricityOrders.backToQueue', locale)
              : tSavingStaffReview('staffBackToQueue', locale),
          exact: true,
        });
        await back.click();
        await expect(page).toHaveURL(item.path + laneAndPage);
        await expect(content.getByRole('link', { name: /Older buyer/ })).toBeVisible();
        await expect(previous).toBeDisabled();
        expect(reads.at(-1)?.searchParams.get('after')).toBe(firstWork);
        if (item.name === 'electricity')
          expect(reads.at(-1)?.pathname).toBe(item.base + '/conversations');
        else expect(reads.at(-1)?.searchParams.get('lane')).toBe('fulfillment');
        await more.click();
        await expect(content.getByRole('link', { name: /Last buyer/ })).toBeVisible();
        await expect(previous).toBeEnabled();
        await expect.poll(() => params().get('cursor')).toBe(olderWork);
        await page.reload();
        await expect(content.getByRole('link', { name: /Last buyer/ })).toBeVisible();
        await expect(content.getByRole('link', { name: /Older buyer/ })).toHaveCount(0);
        await expect(
          list.getByRole('navigation', {
            name: appText('historyPagination.label', locale),
            exact: true,
          })
        ).toHaveCount(0);
        await list.getByRole('button', { name: words('review'), exact: true }).click();
        await expect(content.getByRole('link', { name: /First buyer/ })).toBeVisible();
        await expect.poll(() => params().get('cursor')).toBeNull();
        await page.goBack();
        await expect(content.getByRole('link', { name: /Last buyer/ })).toBeVisible();
        expect(params().get(item.key)).toBe(item.other);
        await page.goForward();
        const first = content.getByRole('link', { name: /First buyer/ });
        await expect(first).toBeVisible();
        const count = reads.length;
        await first.click();
        await expect(page).toHaveURL(`${item.path}/${firstWork}?${item.key}=review`);
        await decision.click();
        await expect(page).toHaveURL(`${item.path}/${firstWork}${operation}?${item.key}=review`);
        await expect(input).toBeVisible();
        expect(reads).toHaveLength(count);
        await input.fill('Private staff draft');
        await page.goBack();
        await expect(input).toHaveCount(0);
        await expect(decision).toBeVisible();
        await page.goBack();
        await expect(first).toBeVisible();
        await page.goForward();
        await expect(decision).toBeVisible();
        await page.goForward();
        await expect(input).toHaveValue('');
        expect(
          (
            await new AxeBuilder({ page })
              .include(`[data-slot="${item.name}-staff-order"]`)
              .analyze()
          ).violations
        ).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true
        );
        if (locale === 'fa' && info.project.name === 'mobile-safari') {
          await input.scrollIntoViewIfNeeded();
          await page.screenshot({
            path: info.outputPath(`${item.name}-record-${dark ? 'dark' : 'light'}.png`),
          });
        }
      });
    }
