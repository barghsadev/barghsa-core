import { test, expect, type Page } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/admin-ui';
import { tCatalogue } from '@barghsa/i18n/catalogue';
import {
  catalogueProduct,
  catalogueDetail,
  catalogueReferences,
  type CatalogueType,
} from '../src/test/catalogue-fixtures';
import {
  knowledgeBase,
  knowledgeGroup,
  policyEntry,
  policyGroup,
} from '../src/test/knowledge-policy-fixtures';
test.use({ viewport: { width: 390, height: 844 } });
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
async function inspect(page: Page, locale: string, project: string, domain: string, dark: boolean) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(dark);
  expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (locale === 'fa' && project === 'mobile-safari')
    await page.screenshot({
      path: `/tmp/barghsa-category-query-${domain}-${dark ? 'dark' : 'light'}.png`,
    });
}
for (const locale of ['en', 'fa'] as const)
  for (const dark of [false, true])
    for (const domain of ['product', 'knowledge', 'policy'] as const) {
      test(`${domain} catalogue categories restore links and isolate private work (${locale}, ${dark})`, async ({
        page,
      }, info) => {
        await shell(page, locale, dark);
        const product = domain === 'product';
        const route = product
          ? 'catalogue'
          : domain === 'knowledge'
            ? 'knowledge-bases'
            : 'policies';
        const key = product ? 'type' : 'kind';
        const selected = product
          ? 'electricity'
          : domain === 'knowledge'
            ? 'kb-groups'
            : 'policy-groups';
        const fallback = product
          ? 'consultation'
          : domain === 'knowledge'
            ? 'knowledge-bases'
            : 'policies';
        const word = (name: string) =>
          product
            ? tCatalogue(name, locale)
            : t(`admin.${domain === 'knowledge' ? 'kb' : 'policies'}.${name}`, locale);
        const category = (name: string) =>
          page.getByRole(product ? 'tab' : 'button', { name: word(name), exact: true });
        const input = page.locator(
          product ? '#catalogue-titleEn' : domain === 'knowledge' ? '#kb-title' : '#policy-title'
        );
        let fail = false,
          denied = false;
        const reads: string[] = [],
          writes: string[] = [];
        await page.route('**/api/admin/**', (r) => {
          const url = new URL(r.request().url());
          if (r.request().method() !== 'GET') {
            writes.push(url.pathname);
            return r.fulfill({ status: 500, json: {} });
          }
          const kind = product ? url.searchParams.get('type') : url.pathname.split('/')[3];
          const isList = product
            ? url.pathname === '/api/admin/catalogue/products'
            : url.pathname === `/api/admin/${kind}`;
          if (isList) {
            reads.push(url.pathname + url.search);
            if (denied) return r.fulfill({ status: 403, json: {} });
            if (fail && kind === selected) return r.fulfill({ status: 503, json: {} });
            const rows = product
              ? [catalogueProduct(kind as CatalogueType)]
              : kind === 'knowledge-bases'
                ? [knowledgeBase]
                : kind === 'kb-groups'
                  ? [knowledgeGroup]
                  : kind === 'policies'
                    ? [policyEntry]
                    : [policyGroup];
            return r.fulfill({ json: rows });
          }
          if (product && url.pathname.endsWith('/rule-references'))
            return r.fulfill({ json: catalogueReferences });
          if (product)
            return r.fulfill({
              json: catalogueDetail(
                (new URL(page.url()).searchParams.get('type') || 'consultation') as CatalogueType
              ),
            });
          return r.fulfill({ status: 404, json: {} });
        });
        await page.goto(`/admin/${route}?${key}=${selected}`);
        await expect(category(selected)).toHaveAttribute(
          product ? 'aria-selected' : 'aria-pressed',
          'true'
        );
        await expect(
          page.locator('[data-slot="list-content"]').getByRole('button').first()
        ).toBeVisible();
        expect(
          reads.some((read) =>
            product ? read.endsWith(`type=${fallback}`) : read === `/api/admin/${fallback}`
          )
        ).toBe(!product);
        const create = async () => {
          if (product) {
            await page
              .getByRole('button', {
                name: `${word('edit')} ${catalogueProduct('electricity').title[locale]}`,
                exact: true,
              })
              .click();
          } else {
            await page.getByRole('button', { name: word('addGroup'), exact: true }).click();
          }
          await expect(input).toBeVisible();
          await input.fill('LOCAL-DRAFT');
        };
        await create();
        expect(page.url()).not.toContain('LOCAL-DRAFT');
        fail = true;
        await page.getByRole('button', { name: word('refresh'), exact: true }).click();
        const retry = page.getByRole('button', { name: word('retry'), exact: true });
        await expect(retry).toBeVisible();
        // The product's explicit whole-view refresh resets its editor baseline.
        if (product) await input.fill('LOCAL-DRAFT');
        await expect(input).toHaveValue('LOCAL-DRAFT');
        const failed = reads
          .filter((read) =>
            product ? read.endsWith(`type=${selected}`) : read === `/api/admin/${selected}`
          )
          .at(-1);
        fail = false;
        await retry.click();
        await expect(retry).toHaveCount(0);
        expect(
          reads
            .filter((read) =>
              product ? read.endsWith(`type=${selected}`) : read === `/api/admin/${selected}`
            )
            .at(-1)
        ).toBe(failed);
        await expect(input).toHaveValue('LOCAL-DRAFT');
        await page.reload();
        await expect(
          page.locator('[data-slot="list-content"]').getByRole('button').first()
        ).toBeVisible();
        await expect(input).toHaveCount(0);
        expect(new URL(page.url()).searchParams.get(key)).toBe(selected);
        await category(fallback).click();
        await expect(category(fallback)).toHaveAttribute(
          product ? 'aria-selected' : 'aria-pressed',
          'true'
        );
        await expect(category(fallback)).toBeFocused();
        expect(new URL(page.url()).searchParams.has(key)).toBe(false);
        await page.goBack();
        await expect(category(selected)).toHaveAttribute(
          product ? 'aria-selected' : 'aria-pressed',
          'true'
        );
        await expect(
          page.locator('[data-slot="list-content"]').getByRole('button').first()
        ).toBeVisible();
        await page.goForward();
        await expect(category(fallback)).toHaveAttribute(
          product ? 'aria-selected' : 'aria-pressed',
          'true'
        );
        await category(selected).click();
        await expect(
          page.locator('[data-slot="list-content"]').getByRole('button').first()
        ).toBeVisible();
        await expect(category(selected)).toBeFocused();
        if (product) {
          await category(selected).press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
          await expect(category('hardware')).toHaveAttribute('aria-selected', 'true');
          await expect(category('hardware')).toBeFocused();
          expect(new URL(page.url()).searchParams.get(key)).toBe('hardware');
          await page.goBack();
          await expect(category(selected)).toHaveAttribute('aria-selected', 'true');
        }
        await inspect(page, locale, info.project.name, domain, dark);
        await create();
        await page.getByRole('button', { name: word('save'), exact: true }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await page.goBack();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(input).toHaveCount(0);
        await expect(category(fallback)).toHaveAttribute(
          product ? 'aria-selected' : 'aria-pressed',
          'true'
        );
        expect(writes).toEqual([]);
        denied = true;
        await page.getByRole('button', { name: word('refresh'), exact: true }).click();
        await expect(page.getByRole('alert')).toContainText(word('denied'));
        await expect(
          page.locator('[data-slot="list-content"]').getByRole('button').first()
        ).toHaveCount(0);
      });
    }
