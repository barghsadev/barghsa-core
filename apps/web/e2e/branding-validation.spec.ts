import { crmShell } from './crm-shell-fixture';
import { brandSettings } from '../src/test/branding-settings-fixtures';
import { brandingText } from '@barghsa/i18n/branding';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { t as settingsText } from '@barghsa/i18n/admin-ui';
import { test, expect } from './coverage-fixture';

const config = brandSettings;
const valid = {
  id: '11111111-1111-4111-8111-111111111111',
  version: 1,
  status: 'active',
  config,
  createdBy: 'system',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
};
for (const locale of ['en', 'fa'] as const)
  test(`appearance rejects malformed reads and preserves edits on invalid save (${locale})`, async ({
    page,
  }) => {
    const fa = locale === 'fa';
    await crmShell(page, locale);
    let history: unknown[] = [valid];
    let historyReads = 0;
    let configReads = 0;
    await page.route('**/api/admin/branding/configs', (route) => {
      expect(route.request().method()).toBe('GET');
      historyReads++;
      return route.fulfill({ json: history });
    });
    const draftId = '11111111-1111-4111-8111-111111111112';
    let response: unknown = { ...valid, config: { ...config, numberStyle: ['western'] } };
    let saveResponse = 'invalid';
    const writes: unknown[] = [];
    let releaseInitialRead!: () => void;
    const initialRead = new Promise<void>((resolve) => {
      releaseInitialRead = resolve;
    });
    await page.route('**/api/admin/branding/config', async (route) => {
      if (route.request().method() === 'GET') {
        configReads++;
        await initialRead;
        return route.fulfill({ json: response });
      }
      const body = route.request().postDataJSON();
      writes.push(body);
      const savedDraft = {
        ...valid,
        id: draftId,
        status: 'draft',
        version: 2,
        config: body.config,
      };
      if (saveResponse === 'valid') {
        response = savedDraft;
        history = [savedDraft, valid];
      }
      return route.fulfill({
        json:
          saveResponse === 'invalid'
            ? { ...valid, config: { ...body.config, numberStyle: 'bad' } }
            : saveResponse === 'stale'
              ? { ...valid, status: 'draft', config: body.config }
              : saveResponse === 'wrong-title'
                ? { ...valid, status: 'draft', version: 2, config }
                : saveResponse === 'wrong-status'
                  ? { ...valid, version: 2, config: body.config }
                  : savedDraft,
      });
    });
    let activationResponse = 'wrong-id';
    const activations: unknown[] = [];
    await page.route('**/api/admin/branding/activate', (route) => {
      const body = route.request().postDataJSON();
      activations.push(body);
      return route.fulfill({
        json: {
          ...valid,
          config: { ...config, appTitle: 'Retained draft' },
          id: activationResponse === 'wrong-id' ? 'another-draft' : draftId,
          version: activationResponse === 'wrong-version' ? 3 : 2,
          status: activationResponse === 'wrong-status' ? 'draft' : 'active',
        },
      });
    });
    await page.goto('/admin/branding');
    const main = page.getByRole('main');
    const heading = main.getByRole('heading', { level: 1, name: brandingText('title', locale) });
    await expect(main.getByRole('status', { name: brandingText('loading', locale) })).toBeVisible();
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(main.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(heading).toBeVisible();
    releaseInitialRead();
    await expect(main.getByRole('status', { name: brandingText('loading', locale) })).toHaveCount(
      0
    );
    await expect(heading).toBeVisible();
    const save = page.getByRole('button', {
      name: fa ? 'ذخیره پیش‌نویس' : 'Save Draft',
      exact: true,
    });
    const refresh = page.getByRole('button', { name: fa ? 'تازه‌سازی' : 'Refresh', exact: true });
    const configError = main
      .getByRole('alert')
      .filter({ hasText: brandingText('loadFailed', locale) });
    for (const malformed of [
      response,
      { ...valid, version: -1 },
      { ...valid, status: 'unknown' },
      { ...valid, config: { ...config, logoUrl: 4 } },
      { ...valid, updatedAt: 'not-a-date' },
    ]) {
      response = malformed;
      await refresh.click();
      await expect(configError).toBeVisible();
      await expect(
        main
          .getByRole('alert')
          .filter({ hasText: settingsText('admin.settings.historyError', locale) })
      ).toHaveCount(0);
      await expect(
        page.getByRole('button', {
          name: brandingText('save', locale),
          exact: true,
          disabled: false,
        })
      ).toHaveCount(0);
    }
    expect(writes).toEqual([]);
    response = valid;
    await expect(refresh).toBeEnabled();
    const beforeRetry = { configReads, historyReads };
    await configError.getByRole('button').press('Enter');
    await expect(configError).toHaveCount(0);
    await page
      .getByRole('button', {
        name: settingsText('admin.settings.edit', locale),
        exact: true,
      })
      .click();
    expect(configReads).toBe(beforeRetry.configReads + 1);
    expect(historyReads).toBe(beforeRetry.historyReads);
    expect(writes).toEqual([]);
    const title = page.getByRole('textbox', {
      name: brandingText('appTitle', locale),
      exact: true,
      includeHidden: true,
    });
    await expect(title).toHaveValue(config.appTitle);
    await title.fill('Retained draft');
    await save.click();
    const dialog = page.getByRole('dialog');
    const confirm = dialog.getByRole('button', { name: fa ? 'تأیید' : 'Confirm', exact: true });
    const resolveUnconfirmed = async (writeCount: () => number, expected: number) => {
      await expect(dialog.getByRole('alert')).toHaveText(confirmationText('unconfirmed', locale));
      await expect(confirm).toBeDisabled();
      expect(writeCount()).toBe(expected);
      await dialog
        .getByRole('button', { name: brandingText('refresh', locale), exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      expect(writeCount()).toBe(expected);
    };
    for (const [index, failure] of ['invalid', 'stale', 'wrong-title', 'wrong-status'].entries()) {
      saveResponse = failure;
      await confirm.click();
      if (fa && index === 0 && test.info().project.name === 'mobile-safari') {
        await expect(confirm).toBeDisabled();
        await page.screenshot({
          path: test.info().outputPath('branding-unconfirmed-fa-mobile.png'),
        });
      }
      await resolveUnconfirmed(() => writes.length, index + 1);
      await expect(title).toHaveValue('Retained draft');
      await save.click();
    }
    saveResponse = 'valid';
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await expect(title).toHaveValue('Retained draft');
    expect(writes).toHaveLength(5);
    for (const write of writes) expect(write).toEqual(writes[0]);
    const activate = page.getByRole('button', { name: fa ? 'انتشار' : 'Activate', exact: true });
    await activate.click();
    for (const [index, failure] of ['wrong-id', 'wrong-version', 'wrong-status'].entries()) {
      activationResponse = failure;
      await confirm.click();
      await resolveUnconfirmed(() => activations.length, index + 1);
      await activate.click();
    }
    activationResponse = 'valid';
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    expect(activations).toEqual(Array.from({ length: 4 }, () => ({ draftId, expectedVersion: 2 })));
  });
