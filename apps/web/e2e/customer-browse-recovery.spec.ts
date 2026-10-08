import { test, expect } from './coverage-fixture';
import type { Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { t } from '@barghsa/i18n/app';
import { tSaving } from '@barghsa/i18n/saving';
import { tConsultation } from '@barghsa/i18n/consultation';
import {
  browseProfiles,
  browseProfileId,
  browseElectricity,
  browseSavingPlan,
  browseConsultation,
  browseConsultationHistory,
} from '../src/test/customer-browse-fixtures.js';

const cases = [
  {
    kind: 'electricity',
    path: '/electricity',
    api: '/api/products/electricity',
    copy: (key: string, locale: 'en' | 'fa') => t(`electricity.catalogue.${key}`, locale),
    refresh: 'refresh',
    retry: (locale: 'en' | 'fa') => t('electricity.order.retry', locale),
    denied: 'denied',
    title: browseElectricity[0]!.title,
    response: browseElectricity,
  },
  {
    kind: 'saving',
    path: '/savings',
    api: '/api/saving/plans',
    copy: tSaving,
    refresh: 'refresh',
    retry: (locale: 'en' | 'fa') => tSaving('retry', locale),
    denied: 'catalogueDenied',
    title: browseSavingPlan.title,
    response: { plans: [browseSavingPlan] },
  },
  {
    kind: 'consultation',
    path: '/consultations',
    api: '/api/consultations/products',
    copy: tConsultation,
    refresh: 'refreshProducts',
    retry: (locale: 'en' | 'fa') => tConsultation('retry', locale),
    denied: 'productsDenied',
    title: browseConsultation.title,
    response: { products: [browseConsultation] },
  },
];
for (const { kind, path, api, copy, refresh, retry, denied, title, response } of cases)
  for (const locale of ['en', 'fa'] as const) {
    test(`customer ${kind} browsing retries independently and retains accepted products (${locale})`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addInitScript((value) => localStorage.setItem('barghsa.locale', value), locale);
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route('**/api/auth/user', (route) =>
        route.fulfill({
          json: {
            userId: 'browse-customer',
            isStaff: false,
            operatingContext: 'customer',
            canSwitchContext: false,
            requiresTosAcceptance: false,
          },
        })
      );
      let profileFail = kind === 'consultation',
        profileReads = 0,
        historyReads = 0;
      await page.route('**/api/profiles', (route) => {
        profileReads++;
        return profileFail
          ? route.fulfill({ status: 503, json: {} })
          : route.fulfill({ json: browseProfiles });
      });
      await page.route('**/api/profiles/verification-status', (route) =>
        route.fulfill({ json: { activeProfileId: browseProfileId } })
      );
      await page.route('**/api/user/settings/timezone', (route) =>
        route.fulfill({ json: { timezone: 'Asia/Tehran' } })
      );
      await page.route('**/api/consultations/requests?*', (route) => {
        historyReads++;
        return route.fulfill({ json: browseConsultationHistory });
      });
      let status = 503,
        hold = false,
        held: Route | undefined;
      const queries: string[] = [];
      await page.route(
        (url) => url.pathname === api,
        (route) => {
          const url = new URL(route.request().url());
          queries.push(url.pathname + url.search);
          if (hold) {
            held = route;
            return;
          }
          return status === 200
            ? route.fulfill({ json: response })
            : route.fulfill({ status, json: {} });
        }
      );
      await page.goto(path);
      // The root guard, switcher and lazy default-profile dialog own startup reads.
      // Consultation also owns its profile read; settle these before retry counters.
      await expect.poll(() => profileReads).toBe(kind === 'consultation' ? 4 : 3);
      const main = page.getByRole('main');
      await expect(main.getByRole('heading', { level: 1 })).toBeVisible();
      if (profileFail) {
        const error = main
          .getByRole('alert')
          .filter({ hasText: tConsultation('profileLoadError', locale) });
        await expect(error).toBeVisible();
        profileFail = false;
        await error.getByRole('button', { name: retry(locale), exact: true }).click();
      }
      const list = main.locator('[data-slot="list-page"]').first();
      const content = list.locator('[data-slot="list-content"]');
      await expect(content.getByRole('alert')).toBeVisible();
      if (kind === 'consultation')
        await expect(
          main.getByText(browseConsultationHistory.requests[0]!.product_snapshot.title[locale], {
            exact: true,
          })
        ).toBeVisible();
      const initialProfiles = profileReads,
        initialHistories = historyReads;
      status = 200;
      await content.getByRole('button', { name: retry(locale), exact: true }).click();
      await expect(content.getByText(title[locale], { exact: true })).toBeVisible();
      expect(profileReads).toBe(initialProfiles);
      expect(historyReads).toBe(initialHistories);
      if (kind === 'consultation') {
        await content.getByRole('radio').check();
        await main
          .getByRole('checkbox', { name: tConsultation('confirm', locale), exact: true })
          .check();
      }
      if (kind === 'saving') {
        await content.locator('summary').click();
        await expect(content.getByText('Accepted text', { exact: true })).toBeVisible();
      }
      hold = true;
      const refreshButton = list.getByRole('button', { name: copy(refresh, locale), exact: true });
      await refreshButton.click();
      await expect.poll(() => !!held).toBe(true);
      await expect(refreshButton).toBeDisabled();
      await expect(content).toHaveAttribute('aria-busy', 'true');
      await expect(content.getByText(title[locale], { exact: true })).toBeVisible();
      if (kind === 'consultation')
        await expect(
          main.getByRole('button', { name: tConsultation('request', locale), exact: true })
        ).toBeDisabled();
      await held!.fulfill({ status: 503, json: {} });
      await expect(content.getByRole('alert')).toBeVisible();
      const failedQuery = queries.at(-1),
        profiles = profileReads,
        histories = historyReads;
      hold = false;
      await content.getByRole('button', { name: retry(locale), exact: true }).click();
      await expect(content.getByRole('alert')).toHaveCount(0);
      expect(queries.at(-1)).toBe(failedQuery);
      expect(profileReads).toBe(profiles);
      expect(historyReads).toBe(histories);
      if (kind === 'consultation') {
        expect(new URLSearchParams(failedQuery!.split('?')[1]).get('profileId')).toBe(
          browseProfileId
        );
        await expect(content.getByRole('radio')).toBeChecked();
        await expect(
          main.getByRole('checkbox', { name: tConsultation('confirm', locale), exact: true })
        ).toBeChecked();
        await expect(
          main.getByRole('button', { name: tConsultation('request', locale), exact: true })
        ).toBeEnabled();
      }
      if (kind === 'saving')
        await expect(content.getByText('Accepted text', { exact: true })).toBeVisible();
      expect(await list.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      expect(
        (await new AxeBuilder({ page }).include('[data-slot="list-page"]').analyze()).violations
      ).toEqual([]);
      if (locale === 'fa')
        await page.screenshot({
          path: `/tmp/barghsa-customer-browse-${kind}-fa-${testInfo.project.name}.png`,
          fullPage: true,
        });
      status = 403;
      await refreshButton.click();
      await expect(content.getByRole('alert')).toContainText(copy(denied, locale));
      await expect(content.getByText(title[locale], { exact: true })).toHaveCount(0);
      await expect(content.getByRole('button')).toHaveCount(0);
      if (kind === 'consultation') {
        await expect(
          main.getByRole('checkbox', { name: tConsultation('confirm', locale), exact: true })
        ).toHaveCount(0);
        await expect(
          main.getByText(browseConsultationHistory.requests[0]!.product_snapshot.title[locale], {
            exact: true,
          })
        ).toBeVisible();
      }
    });
  }
