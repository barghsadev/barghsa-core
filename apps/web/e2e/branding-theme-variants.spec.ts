import { test, expect } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import { brandSettings } from '../src/test/branding-settings-fixtures';
import { brandingText } from '@barghsa/i18n/branding';
import { t as settingsText } from '@barghsa/i18n/admin-ui';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
  'base64'
);
for (const locale of ['fa', 'en'] as const) {
  test(`dark palette and logo stay private until their reviewed revision is activated (${locale})`, async ({
    page,
  }, info) => {
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await crmShell(page, locale);
    let current = {
      id: '11111111-1111-4111-8111-111111111111',
      version: 1,
      status: 'active',
      config: { ...brandSettings, themeMode: 'system', logoDarkUrl: null as string | null },
      createdBy: 'staff',
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    };
    let published = current.config;
    const canonical =
      '/api/public/branding/assets/11111111-1111-4111-8111-111111111112/' + 'c'.repeat(64);
    const uploads: unknown[] = [];
    const writes: unknown[] = [];
    const activations: unknown[] = [];
    let publicImageReads = 0;
    await page.route('**/api/public/branding/config', (route) =>
      route.fulfill({ json: published })
    );
    await page.route('**/api/admin/branding/configs', (route) =>
      route.fulfill({ json: [current] })
    );
    await page.route('**/api/admin/branding/config', (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: current });
      const body = route.request().postDataJSON();
      writes.push(body);
      current = {
        ...current,
        id: '11111111-1111-4111-8111-111111111112',
        version: 2,
        status: 'draft',
        config: { ...body.config, logoDarkUrl: canonical },
      };
      return route.fulfill({ json: current });
    });
    await page.route('**/api/admin/branding/activate', (route) => {
      activations.push(route.request().postDataJSON());
      published = current.config;
      current = { ...current, status: 'active' };
      return route.fulfill({ json: current });
    });
    await page.route('**/api/upload/presigned-url', (route) => {
      uploads.push(route.request().postDataJSON());
      return route.fulfill({
        json: {
          key: 'uploads/image/dark-logo.png',
          presignedUrl: 'https://uploads.example.test/dark-logo',
        },
      });
    });
    await page.route('https://uploads.example.test/dark-logo', (route) => {
      expect(route.request().method()).toBe('PUT');
      expect(route.request().headers()['if-none-match']).toBe('*');
      expect(route.request().postDataBuffer()).toEqual(png);
      return route.fulfill({ status: 200 });
    });
    await page.route('**/api/upload/**/verify', (route) =>
      route.fulfill({ json: { status: 'confirmed' } })
    );
    await page.route('**/api/upload/**/record', (route) =>
      route.fulfill({ status: 201, json: {} })
    );
    await page.route('**/api/admin/branding/assets/**', (route) =>
      route.fulfill({ contentType: 'image/png', body: png })
    );
    await page.route('**/api/public/branding/assets/**', (route) => {
      publicImageReads++;
      return published.logoDarkUrl === canonical
        ? route.fulfill({ contentType: 'image/png', body: png })
        : route.fulfill({ status: 404 });
    });
    await page.goto('/admin/branding');
    await expect(page.locator('html')).toHaveCSS('--primary', brandSettings.primaryColor);
    await page
      .getByRole('button', { name: settingsText('admin.settings.edit', locale), exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: brandingText('save', locale), exact: true })
    ).toBeDisabled();
    const hex = brandingText('hex', locale).replace(
      '{label}',
      brandingText('darkPrimaryColor', locale)
    );
    await page.getByRole('textbox', { name: hex, exact: true }).fill('#abcdef');
    await page
      .getByLabel(brandingText('uploadDarkLogo', locale), { exact: true })
      .setInputFiles({ name: 'dark.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByAltText(brandingText('darkLogoPreview', locale))).toHaveAttribute(
      'src',
      /^blob:/
    );
    await expect(page.locator('html')).toHaveCSS('--primary', brandSettings.primaryColor);
    expect(publicImageReads).toBe(0);
    await page.getByRole('button', { name: brandingText('save', locale), exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog
      .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    expect(uploads).toEqual([
      {
        fileName: 'dark.png',
        contentType: 'image/png',
        fileSize: png.length,
        category: 'image',
        purpose: 'branding_logo',
      },
    ]);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      expectedVersion: 1,
      logoDarkUploadKey: 'uploads/image/dark-logo.png',
      config: { darkPrimaryColor: '#abcdef', logoDarkUrl: null },
    });
    await expect(page.getByAltText(brandingText('darkLogoPreview', locale))).toHaveAttribute(
      'src',
      canonical.replace('/public/', '/admin/')
    );
    expect(publicImageReads).toBe(0);
    await expect(page.locator('html')).toHaveCSS('--primary', brandSettings.primaryColor);
    await page.getByRole('button', { name: brandingText('activate', locale), exact: true }).click();
    await dialog
      .getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    expect(activations).toEqual([{ draftId: current.id, expectedVersion: 2 }]);
    await expect(page.locator('html')).toHaveCSS('--primary', '#abcdef');
    await expect(page.locator(`picture img[src="${canonical}"]`).first()).toHaveCount(1);
    await page.screenshot({
      path: info.outputPath(`branding-variants-${locale}.png`),
      fullPage: true,
    });
  });
}
