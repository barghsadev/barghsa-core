import { test, expect } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import { notificationTemplate } from '../src/test/content-catalogue-fixtures';
import { notificationFormText } from '@barghsa/i18n/notification-forms';

test('the editor expands a longer email without submitting or disturbing the draft', async ({
  page,
}) => {
  await crmShell(page, 'en');
  await page.route('**/api/admin/notifications/templates', (route) => {
    expect(route.request().method()).toBe('GET');
    return route.fulfill({ json: [] });
  });
  await page.goto('/admin/notifications/new');
  const body = page.locator('#notification-template-bodyTemplate');
  const editor = page.locator('form').filter({ has: body });
  await editor.locator('#notification-template-locale').selectOption('fa');
  const message = Array.from({ length: 8 }, (_, index) => `<p>Invoice item ${index + 1}</p>`).join(
    ''
  );
  await body.fill(message);
  const iframe = editor.locator('iframe');
  const footer = editor.frameLocator('iframe').getByText('Invoice item 8', { exact: true });
  await expect(footer).toBeVisible();
  const bounds = () =>
    footer.evaluate((element) => ({
      bottom: element.getBoundingClientRect().bottom,
      viewport: window.innerHeight,
    }));
  const compact = await bounds();
  expect(compact.viewport).toBeLessThan(300);
  expect(compact.bottom).toBeGreaterThan(compact.viewport);

  const expand = editor.getByRole('button', { name: notificationFormText('previewExpand', 'en') });
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await expand.focus();
  await expand.press('Enter');
  const shrink = editor.getByRole('button', { name: notificationFormText('previewCompact', 'en') });
  await expect(shrink).toHaveAttribute('aria-expanded', 'true');
  await expect(shrink).toBeFocused();
  await expect.poll(async () => (await bounds()).viewport).toBeGreaterThan(420);
  await expect(iframe).toHaveAttribute('sandbox', '');
  await expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect(body).toHaveValue(message);
  await expect(page).toHaveURL('/admin/notifications/new');

  await shrink.press('Enter');
  await expect(expand).toBeFocused();
  await expect.poll(async () => (await bounds()).viewport).toBe(compact.viewport);
});

for (const locale of ['en', 'fa'] as const) {
  test(`system-policy email follows client theme inside its sandbox (${locale})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await crmShell(page, locale);
    await page.route('**/api/public/branding/config', (route) =>
      route.fulfill({
        json: {
          appTitle: 'Adaptive email',
          appTitleFa: 'رایانامه سازگار',
          supportEmail: 'support@example.test',
          supportPhone: '02126658042',
          supportMobile: '09002550292',
          slogan: '',
          primaryColor: '#176b5b',
          secondaryColor: '#547467',
          accentColor: '#d6a74e',
          darkPrimaryColor: '#abcdef',
          darkSecondaryColor: '#fedcba',
          darkAccentColor: '#567890',
          backgroundColor: '#ffffff',
          darkBackgroundColor: '#15201c',
          logoUrl: 'https://assets.example.test/light.png',
          logoDarkUrl: 'https://assets.example.test/dark.png',
          faviconUrl: null,
          darkMode: false,
          themeMode: 'system',
        },
      })
    );
    await page.route('https://assets.example.test/**', (route) =>
      route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
          'base64'
        ),
      })
    );
    await page.route('**/api/admin/notifications/templates', (route) =>
      route.fulfill({
        json: [
          {
            ...notificationTemplate(),
            id: 'adaptive-email',
            channel: 'email',
            locale,
            bodyTemplate: '<p>Captured message body</p>',
            variables: [],
          },
        ],
      })
    );
    await page.goto('/admin/notifications/preview');
    const iframe = page.locator('iframe').first();
    const frame = page.frameLocator('iframe').first();
    await expect(iframe).toHaveAttribute('sandbox', '');
    await expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer');
    await expect(frame.getByText('Captured message body')).toBeVisible();
    await expect(frame.locator('.barghsa-email')).toHaveCSS('background-color', 'rgb(21, 32, 28)');
    await expect(frame.locator('.barghsa-email-table')).toHaveCSS(
      'border-top-color',
      'rgb(171, 205, 239)'
    );
    await expect(frame.locator('.barghsa-email-logo-dark')).toBeVisible();
    await expect(frame.locator('.barghsa-email-logo-light')).toBeHidden();
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(frame.locator('.barghsa-email')).toHaveCSS(
      'background-color',
      'rgb(255, 255, 255)'
    );
    await expect(frame.locator('.barghsa-email-logo-light')).toBeVisible();
    await expect(frame.locator('.barghsa-email-logo-dark')).toBeHidden();
    await expect(frame.getByText('Captured message body')).toBeVisible();
  });
}

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
      await page.goto('/admin/notifications/preview');
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
      await expect(page).toHaveURL(/\/admin\/notifications\/preview$/);
      expect(
        await page.evaluate(() => (window as unknown as Record<string, unknown>).__previewPwned)
      ).toBeUndefined();
      expect(requests).toEqual([]);
      // Warnings remain outside the isolated HTML, where staff can act on them.
      await expect(page.getByRole('listitem').filter({ hasText: /• missing —/ })).toBeVisible();
      await page.goto('/admin/notifications/new');
      const editor = page
        .locator('form')
        .filter({ has: page.locator('#notification-template-eventKey') });
      await editor.locator('#notification-template-locale').selectOption(locale);
      await editor
        .getByRole('button', { name: notificationFormText('addVariable', locale) })
        .click();
      await editor.locator('[data-variable-name]').fill('user.name');
      await editor.locator('[data-variable-description]').fill('Recipient name');
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
    await page.goto('/admin/notifications/preview');
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
      await page.goto('/admin/notifications/preview');
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
