import { test, expect } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import { notificationTemplate } from '../src/test/content-catalogue-fixtures';

for (const locale of ['en', 'fa'] as const)
  for (const darkMode of [false, true]) {
    test(`branded email previews stay isolated (${locale}, dark=${darkMode})`, async ({ page }) => {
      const requests: string[] = [];
      await page.route('**/preview-leak**', (route) => {
        requests.push(route.request().url());
        return route.fulfill({ body: 'blocked probe' });
      });
      await crmShell(page, locale);
      await page.route('**/api/public/branding/config', (route) =>
        route.fulfill({
          json: {
            appTitle: 'Branded <energy>',
            appTitleFa: 'Branded <energy>',
            supportEmail: 'staff@example.test',
            supportPhone: '02126658042',
            supportMobile: '09002550292',
            slogan: 'Safe & clear',
            primaryColor: '#123456',
            secondaryColor: '#345678',
            accentColor: '#567890',
            backgroundColor: '#ffffff',
            darkBackgroundColor: '#0f172a',
            logoUrl: null,
            faviconUrl: null,
            darkMode,
            numberStyle: 'locale',
          },
        })
      );
      const body =
        '<h1>Welcome {{user.name}}</h1><p>{{missing}}</p><a href="/preview-leak" target="_top">Leave preview</a><script>parent.__previewPwned=true;fetch("/preview-leak")</script><iframe src="/preview-leak"></iframe>';
      await page.route('**/api/admin/notifications/templates', (route) =>
        route.fulfill({
          json: [
            {
              ...notificationTemplate(),
              id: 'preview-brand',
              eventKey: 'fixture.brand',
              channel: 'email',
              locale,
              subject: 'Preview email',
              bodyTemplate: body,
              variables: [{ name: 'user.name', description: 'Recipient name' }],
              status: 'draft',
              isActive: false,
              version: 1,
              publishedAt: null,
            },
          ],
        })
      );
      await page.goto('/admin/notifications');
      const historyFrame = page.frameLocator('iframe').first();
      await expect(historyFrame.getByText('Branded <energy>', { exact: true })).toBeVisible();
      await expect(historyFrame.getByRole('heading', { name: 'Welcome user.name' })).toBeVisible();
      await expect(historyFrame.locator('div[lang]')).toHaveAttribute(
        'dir',
        locale === 'fa' ? 'rtl' : 'ltr'
      );
      await expect(historyFrame.locator('div[lang]')).toHaveCSS(
        'background-color',
        darkMode ? 'rgb(15, 23, 42)' : 'rgb(255, 255, 255)'
      );
      await expect(historyFrame.locator('table')).toHaveCSS('border-top-color', 'rgb(18, 52, 86)');
      await expect(page.locator('iframe').first()).toHaveAttribute('sandbox', '');
      await expect(page.locator('iframe').first()).toHaveAttribute('referrerpolicy', 'no-referrer');
      await historyFrame.getByRole('link', { name: 'Leave preview' }).click();
      await expect(page).toHaveURL(/\/admin\/notifications$/);
      expect(
        await page.evaluate(() => (window as unknown as Record<string, unknown>).__previewPwned)
      ).toBeUndefined();
      expect(requests).toEqual([]);
      // Warnings remain outside the isolated HTML, where staff can act on them.
      await expect(page.getByRole('listitem').filter({ hasText: /• missing —/ })).toBeVisible();
      await page
        .getByRole('button', { name: locale === 'fa' ? 'قالب جدید' : 'New Template', exact: true })
        .click();
      const editor = page
        .locator('form')
        .filter({ has: page.locator('#notification-template-eventKey') });
      await editor.locator('#notification-template-locale').selectOption(locale);
      await editor
        .locator('#notification-template-variablesLabel')
        .fill('user.name: Recipient name');
      await editor
        .locator('#notification-template-bodyTemplate')
        .fill('<h1>Live {{user.name}}</h1>');
      const live = editor.frameLocator('iframe');
      await expect(live.getByText('Branded <energy>', { exact: true })).toBeVisible();
      await expect(live.getByRole('heading', { name: 'Live user.name' })).toBeVisible();
      await expect(live.locator('div[lang]')).toHaveAttribute(
        'dir',
        locale === 'fa' ? 'rtl' : 'ltr'
      );
      await editor
        .locator('#notification-template-bodyTemplate')
        .fill('<h1>Changed {{user.name}}</h1>');
      await expect(live.getByRole('heading', { name: 'Changed user.name' })).toBeVisible();
      if (locale === 'en' && !darkMode)
        await editor.locator('iframe').screenshot({ path: '/tmp/r02-brand-preview-final.png' });
    });
  }

for (const channel of ['sms', 'in_app']) {
  test(`${channel} preview stays plain text`, async ({ page }) => {
    await crmShell(page);
    await page.route('**/api/admin/notifications/templates', (route) =>
      route.fulfill({
        json: [
          {
            ...notificationTemplate(),
            id: 'plain-preview',
            eventKey: 'fixture.plain',
            channel,
            locale: 'en',
            subject: null,
            bodyTemplate: '<b>Literal text</b>',
            variables: [],
            status: 'draft',
            isActive: false,
            version: 1,
            publishedAt: null,
          },
        ],
      })
    );
    await page.goto('/admin/notifications');
    await expect(page.locator('pre').filter({ hasText: '<b>Literal text</b>' })).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);
  });
}

for (const locale of ['fa', 'en'] as const)
  for (const darkMode of [false, true]) {
    test(`localized branded preview uses configured backgrounds (${locale}, dark=${darkMode})`, async ({
      page,
    }, testInfo) => {
      await crmShell(page, locale);
      await page.route('**/api/public/branding/config', (route) =>
        route.fulfill({
          json: {
            appTitle: 'English & Energy',
            appTitleFa: 'برق <آزمایش>',
            supportEmail: 'staff@example.test',
            supportPhone: '02126658042',
            supportMobile: '09002550292',
            primaryColor: '#176b5b',
            secondaryColor: '#547467',
            accentColor: '#d6a74e',
            backgroundColor: '#e0f2e9',
            darkBackgroundColor: '#000000',
            darkMode,
            logoUrl: null,
            faviconUrl: null,
            slogan: '',
            numberStyle: 'locale',
          },
        })
      );
      await page.route('**/api/admin/notifications/templates', (route) =>
        route.fulfill({
          json: [
            {
              ...notificationTemplate(),
              id: 'localized-preview',
              channel: 'email',
              locale,
              bodyTemplate: '<p>Localized preview body</p>',
              variables: [],
            },
          ],
        })
      );
      await page.goto('/admin/notifications');
      const frame = page.frameLocator('iframe').first();
      await expect(
        frame.getByText(locale === 'fa' ? 'برق <آزمایش>' : 'English & Energy', { exact: true })
      ).toBeVisible();
      await expect(frame.getByText('Localized preview body')).toBeVisible();
      await expect(frame.locator('div[lang]')).toHaveAttribute(
        'dir',
        locale === 'fa' ? 'rtl' : 'ltr'
      );
      await expect(frame.locator('div[lang]')).toHaveCSS(
        'background-color',
        darkMode ? 'rgb(0, 0, 0)' : 'rgb(224, 242, 233)'
      );
      await expect(frame.locator('div[lang]')).toHaveCSS(
        'color',
        darkMode ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)'
      );
      await expect(page.locator('iframe').first()).toHaveAttribute('sandbox', '');
      await expect(page.locator('iframe').first()).toHaveAttribute('referrerpolicy', 'no-referrer');
      await page
        .locator('iframe')
        .first()
        .screenshot({ path: testInfo.outputPath('localized-brand-preview.png') });
    });
  }
