import AxeBuilder from '@axe-core/playwright';
import { t as crmText } from '@barghsa/i18n/crm';
import { t as appText } from '@barghsa/i18n/app';
import type { Route } from '@playwright/test';
import { test, expect } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import {
  crmCase,
  crmCaseDetail,
  crmCorrectionProfile,
  crmQueue,
  crmProfileId,
  crmCaseId,
} from '../src/test/crm-recovery-fixtures';

test.use({ viewport: { width: 390, height: 844 } });
for (const profile of [false, true])
  for (const locale of ['en', 'fa'] as const) {
    test(`correction URLs restore queue history without obsolete review work (profile=${profile}, ${locale})`, async ({
      page,
    }, info) => {
      await crmShell(page, locale);
      await page.route('**/api/public/branding/config', (r) =>
        r.fulfill({
          json: {
            appTitle: 'Correction review',
            appTitleFa: 'اصلاح هویت',
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
            darkMode: locale === 'fa',
          },
        })
      );
      let failed = true,
        total = 41,
        profileReads = 0;
      let write: Route | undefined;
      const requests: string[] = [];
      await page.route(`**/api/crm/profiles/${crmProfileId}`, (r) => {
        profileReads++;
        return r.fulfill({ json: crmCorrectionProfile });
      });
      await page.route('**/api/crm/verification-cases?*', (r) => {
        const query = new URL(r.request().url()).searchParams;
        requests.push(query.toString());
        return r.fulfill({
          status: failed && query.get('offset') === '20' ? 503 : 200,
          json: {
            ...crmQueue,
            total,
            cases: [
              {
                ...crmCase,
                status: query.get('status') ?? 'Open',
                requestedValue: `Page ${Number(query.get('offset')) / 20 + 1}`,
              },
            ],
          },
        });
      });
      await page.route(`**/api/crm/verification-cases/${crmCaseId}`, (r) =>
        r.fulfill({ json: { ...crmCaseDetail, requestedValue: 'Page 2' } })
      );
      await page.route(`**/api/crm/verification-cases/${crmCaseId}/status`, (r) => {
        write = r;
      });
      const path = '/admin/crm/corrections',
        context = profile ? `&profileId=${crmProfileId}&fieldName=last_name` : '';
      const params = () => new URL(page.url()).searchParams;
      const copy = (key: string) => crmText(`crm.corrections.${key}`, locale);
      await page.goto(path + '?status=Under%20Review' + context);
      const main = page.getByRole('main');
      await expect(main.getByText('Page 1', { exact: true })).toBeVisible();
      if (profile) {
        await expect(page.locator('#correction-field')).toHaveValue('last_name');
        await page.locator('#correction-value').fill('PRIVATE VALUE');
        await page.locator('#correction-reason').fill('PRIVATE REASON');
        await page.locator('#correction-files').setInputFiles({
          name: 'evidence.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('evidence'),
        });
      }
      await main
        .getByRole('button', { name: crmText('crm.list.next', locale), exact: true })
        .click();
      await expect(main.getByRole('alert')).toBeVisible();
      expect(params().get('page')).toBe('2');
      await expect(main.getByText('Page 1', { exact: true })).toBeVisible();
      await expect(main.getByRole('button', { name: copy('details'), exact: true })).toBeDisabled();
      const retryQuery = requests.at(-1);
      failed = false;
      await main.getByRole('button', { name: copy('queueRetry'), exact: true }).click();
      await expect(main.getByText('Page 2', { exact: true })).toBeVisible();
      expect(requests.at(-1)).toBe(retryQuery);
      if (profile) {
        await expect(page.locator('#correction-value')).toHaveValue('PRIVATE VALUE');
        expect(
          await page
            .locator('#correction-files')
            .evaluate((input: HTMLInputElement) => input.files?.[0]?.name)
        ).toBe('evidence.pdf');
        expect(profileReads).toBe(1);
      }
      await main.getByRole('button', { name: copy('details'), exact: true }).click();
      await page.locator('#case-notes').fill('PRIVATE NOTES');
      await main.getByRole('button', { name: copy('save'), exact: true }).click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: appText('team.confirm', locale), exact: true })
        .click();
      await expect.poll(() => !!write).toBe(true);
      await page.goBack();
      await expect(main.getByText('Page 1', { exact: true })).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.locator('#case-notes')).toHaveCount(0);
      const receipt = page.waitForResponse((r) => r.url().endsWith('/status'));
      await write!.fulfill({
        json: { success: true, id: crmCaseId, profileId: crmProfileId, status: 'Approved' },
      });
      await (await receipt).finished();
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          )
      );
      expect(params().get('page')).toBeNull();
      await expect(main.getByText('Page 1', { exact: true })).toBeVisible();
      await page.goForward();
      await expect(main.getByText('Page 2', { exact: true })).toBeVisible();
      await page.reload();
      await expect(main.getByText('Page 2', { exact: true })).toBeVisible();
      expect(new URLSearchParams(requests.at(-1)).get('offset')).toBe('20');
      await page.locator('#case-status').selectOption('Approved');
      await expect.poll(() => params().get('status')).toBe('Approved');
      expect(params().get('page')).toBeNull();
      await expect(main.getByText('Page 1', { exact: true })).toBeVisible();
      expect([...params().keys()].sort()).toEqual(
        profile ? ['fieldName', 'profileId', 'status'] : ['status']
      );
      await page.reload();
      await expect(page.locator('#case-status')).toHaveValue('Approved');
      await expect(main.getByText('Page 1', { exact: true })).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
        .toBe(locale === 'fa');
      expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      if (locale === 'fa' && info.project.name === 'mobile-safari')
        await page.screenshot({
          path: `/tmp/barghsa-crm-query-${profile ? 'profile' : 'global'}-fa.png`,
          fullPage: true,
        });
      total = 1;
      await page.goto(
        path +
          '?page=7&status=Rejected' +
          (profile ? `&profileId=${crmProfileId}&fieldName=last_name` : '')
      );
      await expect(main.getByText('Page 1', { exact: true })).toBeVisible();
      expect(params().get('page')).toBeNull();
      expect(params().get('status')).toBe('Rejected');
    });
  }
