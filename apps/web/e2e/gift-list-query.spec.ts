import { test, expect, type Page } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import AxeBuilder from '@axe-core/playwright';
import { tGift } from '@barghsa/i18n/gifts';
import { giftCode } from '../src/test/gift-code-fixtures';
test.use({ viewport: { width: 390, height: 844 } });
const params = (page: Page) => new URL(page.url()).searchParams;
async function shell(page: Page, locale: 'en' | 'fa', dark: boolean) {
  await crmShell(page, locale);
  await page.route('**/api/public/branding/config', (route) =>
    route.fulfill({
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
}
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true]) {
    test(`promotion links restore applied criteria, usage selection and editor scope (${locale}, ${dark})`, async ({
      page,
    }, info) => {
      await shell(page, locale, dark);
      const word = (key: string) => tGift(`admin.gifts.${key}`, locale);
      let deny = false,
        detailFail = false;
      const reads: URL[] = [];
      await page.route('**/api/admin/promotions/gift-codes**', (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('/stats'))
          return route.fulfill({
            status: deny ? 403 : detailFail ? 503 : 200,
            json: { code: giftCode(50), perProfile: [], recentRedemptions: [] },
          });
        reads.push(url);
        return route.fulfill({ status: deny ? 403 : 200, json: [giftCode(50)] });
      });
      const filters =
        'search=CODE&status=active&discountType=fixed_irr&eligibility=public&expiry=not_expired';
      await page.goto(
        `/admin/gift-codes?${filters}&cursor=${giftCode(49).id}&selected=${giftCode(50).id}`
      );
      const form = page.getByRole('form', { name: word('editor'), exact: true });
      const searchForm = page.getByRole('form', { name: word('filters'), exact: true });
      const search = page.locator('#gift-search');
      await expect(form.locator('#gift-value')).toHaveValue('1000');
      await expect(search).toHaveValue('CODE');
      await expect(page.locator('#gift-status-filter')).toHaveValue('active');
      await expect(page.locator('#gift-type-filter')).toHaveValue('fixed_irr');
      await expect(page.locator('#gift-eligibility-filter')).toHaveValue('public');
      await expect(page.locator('#gift-expiry-filter')).toHaveValue('not_expired');
      expect(Object.fromEntries(reads.at(-1)!.searchParams)).toEqual({
        search: 'CODE',
        status: 'active',
        discountType: 'fixed_irr',
        eligibility: 'public',
        expiry: 'not_expired',
        limit: '50',
        before: giftCode(49).id,
      });
      const count = reads.length;
      await search.fill('UNAPPLIED');
      await form.locator('#gift-value').fill('2222');
      expect(params(page).get('search')).toBe('CODE');
      expect(reads).toHaveLength(count);
      detailFail = true;
      await page.getByRole('button', { name: word('refreshStats'), exact: true }).click();
      await expect(form.locator('button[type=submit]')).toBeDisabled();
      await expect(form.locator('#gift-value')).toHaveValue('2222');
      await expect(search).toHaveValue('UNAPPLIED');
      detailFail = false;
      await page.getByRole('button', { name: word('retry'), exact: true }).click();
      await expect(form.locator('button[type=submit]')).toBeEnabled();
      await page.reload();
      await expect(form.locator('#gift-value')).toHaveValue('1000');
      await expect(search).toHaveValue('CODE');
      await form.getByRole('button', { name: word('cancel'), exact: true }).click();
      await expect(form).toHaveCount(0);
      expect(params(page).has('selected')).toBe(false);
      expect(params(page).get('cursor')).toBe(giftCode(49).id);
      await page.goBack();
      await expect(form.locator('#gift-value')).toHaveValue('1000');
      await form.locator('#gift-value').fill('3333');
      await search.fill('NEXT');
      await page.locator('#gift-status-filter').selectOption('inactive');
      await searchForm.locator('button[type=submit]').click();
      await expect.poll(() => reads.at(-1)?.searchParams.get('search')).toBe('NEXT');
      await expect(form).toHaveCount(0);
      expect(params(page).get('status')).toBe('inactive');
      expect(params(page).has('cursor')).toBe(false);
      expect(params(page).has('selected')).toBe(false);
      await page.goBack();
      await expect(form.locator('#gift-value')).toHaveValue('1000');
      await expect(search).toHaveValue('CODE');
      await expect
        .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
        .toBe(dark);
      expect((await new AxeBuilder({ page }).include('main > div').analyze()).violations).toEqual(
        []
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      if (locale === 'fa' && info.project.name === 'mobile-safari')
        await page.screenshot({ path: `/tmp/barghsa-gift-query-${dark ? 'dark' : 'light'}.png` });
      deny = true;
      await page.getByRole('button', { name: word('refreshStats'), exact: true }).click();
      await expect(form).toHaveCount(0);
      await expect(page.getByRole('alert')).toContainText(word('denied'));
    });
    test(`promotion cursor navigation retains recovery and withdraws stale confirmations (${locale}, ${dark})`, async ({
      page,
    }) => {
      await shell(page, locale, dark);
      const word = (key: string) => tGift(`admin.gifts.${key}`, locale);
      let failed = true;
      const reads: URL[] = [];
      await page.route('**/api/admin/promotions/gift-codes**', (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('/stats'))
          return route.fulfill({
            json: {
              code: giftCode(50),
              perProfile: [],
              recentRedemptions: [],
            },
          });
        reads.push(url);
        const later = url.searchParams.has('before');
        return route.fulfill({
          status: later && failed ? 503 : 200,
          json: later
            ? [giftCode(49), giftCode(50)]
            : Array.from({ length: 50 }, (_, i) => giftCode(i)),
        });
      });
      await page.goto('/admin/gift-codes?search=CODE');
      const root = page.getByRole('main');
      await expect(
        root.getByRole('button', { name: `${word('edit')} CODE00`, exact: true })
      ).toBeVisible();
      await root.getByRole('button', { name: word('loadMore'), exact: true }).click();
      await expect(root.getByRole('alert')).toContainText(word('moreError'));
      await expect(
        root.getByRole('button', { name: `${word('edit')} CODE00`, exact: true })
      ).toBeVisible();
      expect(params(page).get('cursor')).toBe(giftCode(49).id);
      const query = reads.at(-1)!.search;
      failed = false;
      await root.getByRole('button', { name: word('loadMore'), exact: true }).click();
      await expect(
        root.getByRole('button', { name: `${word('edit')} CODE50`, exact: true })
      ).toBeVisible();
      expect(reads.at(-1)!.search).toBe(query);
      await expect(
        root.getByRole('button', { name: `${word('edit')} CODE49`, exact: true })
      ).toHaveCount(1);
      await page.reload();
      await expect(
        root.getByRole('button', { name: `${word('edit')} CODE50`, exact: true })
      ).toBeVisible();
      await expect(
        root.getByRole('button', { name: `${word('edit')} CODE00`, exact: true })
      ).toHaveCount(0);
      expect(reads.at(-1)!.search).toBe(query);
      await page.goBack();
      await expect(
        root.getByRole('button', { name: `${word('edit')} CODE00`, exact: true })
      ).toBeVisible();
      await page.goForward();
      await expect(
        root.getByRole('button', { name: `${word('edit')} CODE50`, exact: true })
      ).toBeVisible();
      await root.getByRole('button', { name: `${word('deactivate')} CODE50`, exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.goBack();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(
        root.getByRole('button', { name: `${word('edit')} CODE00`, exact: true })
      ).toBeVisible();
      const before = reads.length;
      await root
        .getByRole('form', { name: word('filters'), exact: true })
        .locator('button[type=submit]')
        .click();
      await expect.poll(() => reads.length).toBe(before + 1);
      expect(params(page).get('search')).toBe('CODE');
    });
  }
