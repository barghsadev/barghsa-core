import { test, expect } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { smsProviderText } from '@barghsa/i18n/providers';

function provider(id = 'sms-draft', status = 'draft') {
  return {
    id,
    transport: 'smsir',
    label: id,
    status,
    lastTestStatus: 'pending',
    createdAt: '2026-09-01T12:00:00Z',
    maskedConfig: {
      api_key: '********live',
      sender: '3000',
      timeout: 15,
      throughput_limit: 100,
      low_credit_threshold: 0,
      template_mappings: [
        { event_key: 'auth.otp', template_id: '42', variables: { code: 'CODE' } },
      ],
    },
  };
}
async function shell(page: Page, locale: 'en' | 'fa', baseURL: string) {
  await page.context().addCookies([{ url: baseURL, name: 'barghsa_csrf', value: 'sms-initial' }]);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
  await page.route('**/api/admin/email-providers', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/admin/sms-providers/template-event-keys', (route) =>
    route.fulfill({ json: ['auth.otp', 'invoice.created'] })
  );
  await page.goto('/admin/providers');
  await page.evaluate((lang) => {
    document.documentElement.lang = lang;
  }, locale);
}
for (const locale of ['en', 'fa'] as const) {
  const text = (key: Parameters<typeof smsProviderText>[0]) => smsProviderText(key, locale);
  test(`SMS locale mappings survive save and cannot be silently dropped (${locale})`, async ({
    page,
    baseURL,
  }) => {
    await shell(page, locale, baseURL!);
    let row = provider(),
      writes = 0;
    await page.route('**/api/admin/sms-providers', (route) => route.fulfill({ json: [row] }));
    await page.route('**/api/admin/sms-providers/sms-draft', (route) => {
      const body = route.request().postDataJSON();
      expect(body.config).not.toHaveProperty('api_key');
      expect(body.config.template_mappings).toEqual([
        { event_key: 'auth.otp', locale: 'fa', template_id: '42', variables: { code: 'CODE' } },
        { event_key: 'auth.otp', locale: 'en', template_id: '43', variables: { code: 'CODE' } },
      ]);
      writes++;
      if (writes === 1)
        return route.fulfill({
          json: {
            ...row,
            maskedConfig: {
              ...body.config,
              api_key: '********live',
              template_mappings: body.config.template_mappings.map(
                (m: {
                  event_key: string;
                  template_id: string;
                  variables: Record<string, string>;
                }) => ({
                  event_key: m.event_key,
                  template_id: m.template_id,
                  variables: m.variables,
                })
              ),
            },
          },
        });
      row = { ...row, maskedConfig: { ...body.config, api_key: '********live' } };
      return route.fulfill({ json: row });
    });
    await page.getByRole('tab', { name: 'SMS.ir', exact: true }).click();
    const panel = page.locator('section[aria-labelledby="sms-title"]');
    await panel.getByRole('button', { name: text('edit'), exact: true }).click();
    await page
      .getByRole('combobox', { name: `${text('language')} 1`, exact: true })
      .selectOption('fa');
    await panel.getByRole('button', { name: text('addMapping'), exact: true }).click();
    await page.getByRole('combobox', { name: `${text('event')} 2`, exact: true }).fill('auth.otp');
    await page
      .getByRole('combobox', { name: `${text('language')} 2`, exact: true })
      .selectOption('en');
    await page.getByRole('textbox', { name: `${text('template')} 2`, exact: true }).fill('43');
    await page.getByRole('textbox', { name: `${text('variable')} 2.1`, exact: true }).fill('code');
    await page.getByRole('textbox', { name: `${text('parameter')} 2.1`, exact: true }).fill('CODE');
    await panel.getByRole('button', { name: text('save'), exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText(text('unavailable'));
    await expect(
      page.getByRole('combobox', { name: `${text('language')} 2`, exact: true })
    ).toHaveValue('en');
    await panel.getByRole('button', { name: text('save'), exact: true }).click();
    await expect(panel.getByRole('status').filter({ hasText: text('saved') })).toBeVisible();
    await expect(page.locator('#sms-test-event option')).toHaveCount(1);
    await expect(
      panel.getByRole('heading', { level: 3 }).filter({ hasText: 'auth.otp' })
    ).toHaveCount(2);
    await panel.getByRole('button', { name: text('edit'), exact: true }).click();
    await expect(
      page.getByRole('combobox', { name: `${text('language')} 1`, exact: true })
    ).toHaveValue('fa');
    await expect(
      page.getByRole('combobox', { name: `${text('language')} 2`, exact: true })
    ).toHaveValue('en');
    expect(
      (await new AxeBuilder({ page }).include('[aria-labelledby="sms-title"]').analyze()).violations
    ).toEqual([]);
  });
  test(`SMS saved settings recover reads, preserve edits and never echo the stored key (${locale})`, async ({
    page,
    baseURL,
  }) => {
    await shell(page, locale, baseURL!);
    let row = provider(),
      reads = 0,
      writes = 0;
    await page.route('**/api/admin/sms-providers', (route) => {
      reads++;
      return route.fulfill({ json: reads === 1 ? null : [row] });
    });
    await page.route('**/api/admin/sms-providers/sms-draft', (route) => {
      writes++;
      const body = route.request().postDataJSON();
      expect(body.config).not.toHaveProperty('api_key');
      expect(body.config).toMatchObject({
        sender: '3000',
        timeout: 25,
        throughput_limit: 100,
        low_credit_threshold: 0,
      });
      expect(body.config.template_mappings).toEqual([
        { event_key: 'auth.otp', template_id: '42', variables: { code: 'CODE' } },
        { event_key: 'invoice.created', template_id: '43', variables: { amount: 'AMOUNT' } },
      ]);
      if (writes === 1) return route.fulfill({ json: { ...row, id: 'wrong-provider' } });
      row = {
        ...row,
        label: body.label,
        maskedConfig: { ...body.config, api_key: '********live' },
      };
      return route.fulfill({ json: row });
    });
    expect(reads).toBe(0);
    await page.getByRole('tab', { name: 'SMS.ir', exact: true }).click();
    const panel = page.locator('section[aria-labelledby="sms-title"]');
    await expect(panel.getByRole('alert')).toContainText(text('loadFailed'));
    await expect(panel.getByRole('button', { name: text('new'), exact: true })).toBeDisabled();
    await panel.getByRole('button', { name: text('retry'), exact: true }).click();
    await panel.getByRole('button', { name: text('edit'), exact: true }).click();
    await expect(page.locator('#sms-key')).toHaveValue('');
    await expect(page.locator('#sms-sender')).toHaveValue('3000');
    await expect(page.locator('#sms-key-hint')).toHaveText(text('keyHint'));
    await page.locator('#sms-timeout').fill('25');
    await panel.getByRole('button', { name: text('addMapping'), exact: true }).click();
    await page
      .getByRole('combobox', { name: `${text('event')} 2`, exact: true })
      .fill('invoice.created');
    await page.getByRole('textbox', { name: `${text('template')} 2`, exact: true }).fill('43');
    await page
      .getByRole('textbox', { name: `${text('variable')} 2.1`, exact: true })
      .fill('amount');
    await page
      .getByRole('textbox', { name: `${text('parameter')} 2.1`, exact: true })
      .fill('AMOUNT');
    await panel.getByRole('button', { name: text('save'), exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText(text('unavailable'));
    await expect(page.locator('#sms-timeout')).toHaveValue('25');
    await panel.getByRole('button', { name: text('save'), exact: true }).click();
    await expect(page.locator('#sms-key')).toHaveCount(0);
    await expect(panel.getByRole('status')).toContainText(text('saved'));
    await expect(panel).toContainText('test-amount');
    await expect(panel).not.toContainText('********live');
    expect(writes).toBe(2);
  });

  test(`SMS draft creation keeps entered credentials on failure and clears them after a verified save (${locale})`, async ({
    page,
    baseURL,
  }) => {
    await shell(page, locale, baseURL!);
    let rows: ReturnType<typeof provider>[] = [],
      writes = 0;
    await page.route('**/api/admin/sms-providers', (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: rows });
      writes++;
      const body = route.request().postDataJSON();
      expect(body.config.api_key).toBe('new-test-secret');
      if (writes === 1) return route.fulfill({ status: 503, json: {} });
      const row = {
        ...provider('created-sms'),
        label: body.label,
        maskedConfig: { ...body.config, api_key: '********cret' },
      };
      rows = [row];
      return route.fulfill({ status: 201, json: row });
    });
    await page.getByRole('tab', { name: 'SMS.ir', exact: true }).click();
    const panel = page.locator('section[aria-labelledby="sms-title"]');
    await panel.getByRole('button', { name: text('new'), exact: true }).click();
    await page.locator('#sms-label').fill('Created SMS');
    await page.locator('#sms-sender').fill('3001');
    await page.locator('#sms-key').fill('new-test-secret');
    await page.getByRole('combobox', { name: `${text('event')} 1`, exact: true }).fill('auth.otp');
    await page.getByRole('textbox', { name: `${text('template')} 1`, exact: true }).fill('42');
    await page.getByRole('textbox', { name: `${text('variable')} 1.1`, exact: true }).fill('code');
    await page.getByRole('textbox', { name: `${text('parameter')} 1.1`, exact: true }).fill('CODE');
    await panel.getByRole('button', { name: text('save'), exact: true }).click();
    await expect(panel.getByRole('alert')).toBeVisible();
    await expect(page.locator('#sms-key')).toHaveValue('new-test-secret');
    await panel.getByRole('button', { name: text('save'), exact: true }).click();
    await expect(page.locator('#sms-key')).toHaveCount(0);
    await expect(panel.getByRole('status')).toContainText(text('saved'));
    await expect(panel).not.toContainText('new-test-secret');
    expect(writes).toBe(2);
  });

  test(`SMS previews every test and guards activation, recovery and rollback acknowledgements (${locale})`, async ({
    page,
    baseURL,
  }) => {
    await shell(page, locale, baseURL!);
    let row = provider(),
      verified = false,
      tests = 0,
      activations = 0,
      rollbacks = 0;
    row.maskedConfig.template_mappings.push({
      event_key: 'invoice.created',
      template_id: '43',
      variables: { code: 'INVOICE_CODE' },
    });
    await page.route('**/api/admin/sms-providers', (route) => route.fulfill({ json: [row] }));
    await page.route('**/api/auth/step-up', (route) => {
      if (route.request().postDataJSON().password !== 'right-password')
        return route.fulfill({ status: 401, json: {} });
      verified = true;
      return route.fulfill({
        json: {},
        headers: { 'set-cookie': 'barghsa_csrf=sms-current; Path=/; SameSite=Strict' },
      });
    });
    await page.route('**/api/admin/sms-providers/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('template-event-keys'))
        return route.fulfill({ json: ['auth.otp', 'invoice.created'] });
      if (path.endsWith('/test-connection')) {
        expect(route.request().postDataJSON()).toEqual({ eventKey: 'invoice.created' });
        if (!verified)
          return route.fulfill({ status: 403, json: { error: 'AUTHZ:STEP_UP_REQUIRED' } });
        expect(route.request().headers()['x-csrf-token']).toBe('sms-current');
        tests++;
        row = { ...row, lastTestStatus: tests === 1 ? 'failed' : 'passed' };
        return route.fulfill({
          json: {
            ...row,
            test: { ok: tests > 1, error: tests === 1 ? 'redacted test failure' : null },
          },
        });
      }
      if (path.endsWith('/activate')) {
        activations++;
        if (activations === 1) return route.fulfill({ json: { ...row, status: 'draft' } });
        row = { ...row, status: 'active' };
      }
      if (path.endsWith('/disable'))
        return route.fulfill({
          status: 409,
          json: { error: 'CONFLICT:STATE', message: 'Recovery required' },
        });
      if (path.endsWith('/rollback')) {
        rollbacks++;
        if (rollbacks === 1) return route.fulfill({ json: { ...row, status: 'active' } });
        row = { ...row, id: 'rollback-version', status: 'active' };
      }
      return route.fulfill({ json: row });
    });
    await page.getByRole('tab', { name: 'SMS.ir', exact: true }).click();
    const panel = page.locator('section[aria-labelledby="sms-title"]');
    await expect(panel.getByRole('button', { name: text('activate'), exact: true })).toBeDisabled();
    await panel.getByRole('button', { name: text('preview'), exact: true }).click();
    await page.locator('#sms-test-event').selectOption('invoice.created');
    const preview = page.locator('section[aria-labelledby="sms-preview-title"]');
    await expect(preview).toContainText(
      text('testNotice').replace('{count}', new Intl.NumberFormat(locale).format(2))
    );
    await expect(preview.getByRole('heading', { level: 3 }).first()).toContainText(
      'invoice.created'
    );
    await expect(preview).toContainText('INVOICE_CODE');
    await expect(preview).toContainText('test-code');
    await preview.getByRole('button', { name: text('test'), exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('input[type=password]').fill('wrong-password');
    await dialog.locator('button[type=submit]').click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    expect(tests).toBe(0);
    await dialog.locator('input[type=password]').fill('right-password');
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toHaveCount(0);
    await expect(panel.getByRole('alert')).toContainText(text('failed'));
    await expect(panel.getByRole('button', { name: text('activate'), exact: true })).toBeDisabled();
    await preview.getByRole('button', { name: text('test'), exact: true }).click();
    await expect(panel.getByRole('status')).toContainText(text('passed'));
    await panel.getByRole('button', { name: text('activate'), exact: true }).click();
    await dialog.locator('button[type=submit]').click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await page.keyboard.press('Escape');
    await panel.getByRole('button', { name: text('activate'), exact: true }).click();
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toHaveCount(0);
    await panel.getByRole('button', { name: text('disable'), exact: true }).click();
    await dialog.locator('button[type=submit]').click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await page.keyboard.press('Escape');
    row = { ...row, status: 'superseded' };
    await page.getByRole('tab', { name: text('email'), exact: true }).click();
    await page.getByRole('tab', { name: 'SMS.ir', exact: true }).click();
    await panel.getByRole('button', { name: text('rollback'), exact: true }).click();
    await expect(dialog).toContainText(text('rollbackNotice'));
    await dialog.locator('button[type=submit]').click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toHaveCount(0);
    await expect(panel.getByRole('status')).toContainText(text('changed'));
    expect(tests).toBe(2);
    expect(activations).toBe(2);
    expect(rollbacks).toBe(2);
  });

  test(`SMS editor supports mobile, direction and accessible controls (${locale})`, async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await shell(page, locale, baseURL!);
    await page.route('**/api/admin/sms-providers', (route) =>
      route.fulfill({ json: [provider()] })
    );
    await page.getByRole('tab', { name: 'SMS.ir', exact: true }).click();
    const panel = page.locator('section[aria-labelledby="sms-title"]');
    await panel.getByRole('button', { name: text('edit'), exact: true }).click();
    expect(await panel.evaluate((el) => getComputedStyle(el).direction)).toBe(
      locale === 'fa' ? 'rtl' : 'ltr'
    );
    for (const dark of [false, true]) {
      await page.evaluate(
        (value) => document.documentElement.classList.toggle('dark', value),
        dark
      );
      await expect
        .poll(() =>
          panel.evaluate(
            (element) =>
              getComputedStyle(element.querySelector('#sms-label')!).color ===
              getComputedStyle(element).color
          )
        )
        .toBe(true);
      const result = await new AxeBuilder({ page })
        .include('section[aria-labelledby="sms-title"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(result.violations).toEqual([]);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
  });
}
