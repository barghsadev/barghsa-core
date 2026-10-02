import { test, expect, registerComponentCoverage } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { build, preview, type PreviewServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test.use({ timezoneId: 'UTC' });
let server: PreviewServer, outDir: string, url: string;
test.beforeAll(async () => {
  const coverageDir = process.env['BARGHSA_BROWSER_COVERAGE_DIR'];
  const parent = coverageDir ? join(coverageDir, 'builds') : tmpdir();
  await mkdir(parent, { recursive: true });
  outDir = await mkdtemp(join(parent, 'component-form-fields-'));
  const root = resolve('e2e/fixtures/form-fields');
  await build({
    configFile: false,
    root,
    plugins: [react(), tailwindcss()],
    logLevel: 'error',
    build: { outDir, emptyOutDir: true, sourcemap: coverageDir ? 'hidden' : false },
  });
  server = await preview({
    configFile: false,
    root,
    logLevel: 'error',
    build: { outDir },
    preview: { host: '127.0.0.1', port: 0 },
  });
  url = server.resolvedUrls.local[0]!;
  if (coverageDir) registerComponentCoverage(url, outDir);
});
test.afterAll(async () => {
  if (server)
    await new Promise<void>((done, reject) =>
      server.httpServer.close((error) => (error ? reject(error) : done()))
    );
  if (outDir && !process.env['BARGHSA_BROWSER_COVERAGE_DIR'])
    await rm(outDir, { recursive: true, force: true });
});

for (const locale of ['en', 'fa'] as const) {
  const names =
    locale === 'fa'
      ? {
          text: 'نام',
          note: 'توضیحات',
          phone: 'شماره همراه',
          select: 'نوع درخواست',
          checkbox: 'تأیید اطلاعات',
          switch: 'اعلان‌ها',
          radio: 'روش تحویل',
          combo: 'شهر',
          multi: 'شهرهای دیگر',
          slider: 'مقدار',
          sliders: 'بازه مقدار',
          date: 'تاریخ تحویل',
          range: 'بازه تحویل',
        }
      : {
          text: 'Name',
          note: 'Notes',
          phone: 'Phone',
          select: 'Request type',
          checkbox: 'Confirm details',
          switch: 'Notifications',
          radio: 'Delivery method',
          combo: 'City',
          multi: 'Other cities',
          slider: 'Quantity',
          sliders: 'Quantity range',
          date: 'Delivery date',
          range: 'Delivery range',
        };
  const actions =
    locale === 'fa'
      ? {
          save: 'ذخیره',
          finish: 'پایان ذخیره',
          reset: 'بازنشانی',
          check: 'بررسی',
          error: 'این مقدار را اصلاح کنید.',
          alpha: 'شیراز',
          beta: 'تهران',
          inactive: 'غیرفعال',
          remove: 'حذف',
          draft: 'پیش‌نویس',
          saved: 'ذخیره شده',
          attempts: 'تعداد ارسال',
        }
      : {
          save: 'Save',
          finish: 'Finish save',
          reset: 'Reset',
          check: 'Check',
          error: 'Correct this value.',
          alpha: 'Shiraz',
          beta: 'Tehran',
          inactive: 'Inactive',
          remove: 'Remove',
          draft: 'Draft',
          saved: 'Saved',
          attempts: 'Submission count',
        };
  test(`all form adapters retain rejected values, focus the interactive control and expose feedback (${locale})`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${url}?${locale}`);
    await expect(page.locator('html')).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
    await expect(page.locator('html')).toHaveClass(locale === 'fa' ? /dark/ : '');
    const draft = page.getByRole('status', { name: actions.draft, exact: true });
    const original = await draft.textContent();
    for (const name of Object.keys(names) as (keyof typeof names)[]) {
      await page
        .getByRole('button', { name: `${actions.check} ${names[name]}`, exact: true })
        .click();
      const focus =
        name === 'checkbox' || name === 'switch'
          ? page.getByRole(name, { name: names[name], exact: true })
          : name === 'radio'
            ? page
                .getByRole('radiogroup', { name: names.radio })
                .getByRole('radio', { name: actions.alpha })
            : name === 'slider' || name === 'sliders'
              ? page.locator(`#${name} input[type=range]`).first()
              : page.locator(`#${name}`);
      await expect(focus).toBeFocused();
      await expect(page.locator(`#${name}-message`)).toHaveText(actions.error);
      const feedback = name === 'checkbox' || name === 'switch' ? focus : page.locator(`#${name}`);
      await expect(feedback).toHaveAttribute('aria-invalid', 'true');
      await expect(feedback).toHaveAttribute('aria-describedby', new RegExp(`${name}-message`));
      await expect(draft).toHaveText(original!);
    }
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    await page.screenshot({ path: `/tmp/barghsa-form-fields-${locale}-${info.project.name}.png` });
    await page.getByRole('button', { name: actions.reset, exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
  test(`all form adapters bind edits and block pending changes and duplicate submissions (${locale})`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${url}?${locale}`);
    await page.getByRole('textbox', { name: names.text, exact: true }).fill('  Changed name  ');
    await page.getByRole('textbox', { name: names.note, exact: true }).fill('Changed note');
    await page.getByRole('textbox', { name: names.phone, exact: true }).fill('+98 ۹۱۲ 1234567');
    const select = page.getByRole('combobox', { name: names.select, exact: true });
    await select.click();
    await expect(page.getByRole('option', { name: actions.inactive, exact: true })).toBeDisabled();
    await page.getByRole('option', { name: actions.beta, exact: true }).click();
    await page.getByRole('checkbox', { name: names.checkbox, exact: true }).uncheck();
    await page.getByRole('switch', { name: names.switch, exact: true }).uncheck();
    await page
      .getByRole('radiogroup', { name: names.radio })
      .getByRole('radio', { name: actions.beta })
      .check();
    const combo = page.getByRole('combobox', { name: names.combo, exact: true });
    await combo.fill(actions.beta);
    await page.getByRole('option', { name: actions.beta, exact: true }).click();
    const multi = page.getByRole('combobox', { name: names.multi, exact: true });
    await multi.fill(actions.beta);
    await page.getByRole('option', { name: actions.beta, exact: true }).click();
    await page.keyboard.press('Escape');
    await page
      .getByRole('button', { name: `${actions.remove} ${actions.alpha}`, exact: true })
      .click();
    await page.getByRole('slider', { name: names.slider, exact: true }).press('ArrowUp');
    await page
      .getByRole('slider', { name: locale === 'fa' ? 'کمینه' : 'Minimum', exact: true })
      .press('ArrowUp');
    await page.getByRole('combobox', { name: names.date, exact: true }).click();
    await page
      .getByRole('dialog', { name: names.date, exact: true })
      .getByRole('button', { name: locale === 'fa' ? / ۳-ام فروردین / : /March 23rd/ })
      .click();
    await page.getByRole('combobox', { name: names.range, exact: true }).click();
    await page
      .getByRole('dialog', { name: names.range, exact: true })
      .getByRole('button', { name: locale === 'fa' ? / ۳-ام فروردین / : /March 23rd/ })
      .click();
    await page.keyboard.press('Escape');
    const draft = page.getByRole('status', { name: actions.draft, exact: true });
    await expect(draft).toContainText('2026-03-24T00:00:00.000Z');
    await page.getByRole('button', { name: actions.save, exact: true }).click();
    await expect(page.getByRole('status', { name: actions.attempts, exact: true })).toHaveText('1');
    for (const name of ['text', 'note', 'phone'] as const)
      await expect(page.getByRole('textbox', { name: names[name], exact: true })).toBeDisabled();
    for (const name of ['select', 'combo', 'multi', 'date', 'range'] as const)
      await expect(page.getByRole('combobox', { name: names[name], exact: true })).toBeDisabled();
    for (const role of ['checkbox', 'switch', 'radio', 'slider'] as const)
      for (const control of await page.getByRole(role).all()) await expect(control).toBeDisabled();
    const remove = page.getByRole('button', {
      name: `${actions.remove} ${actions.beta}`,
      exact: true,
    });
    await expect(remove).toBeDisabled();
    await remove.evaluate((element) => (element as HTMLElement).click());
    await page.locator('form').evaluate((element) => {
      element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await expect(page.getByRole('status', { name: actions.attempts, exact: true })).toHaveText('1');
    await page.getByRole('button', { name: actions.finish, exact: true }).click();
    await expect(page.getByRole('button', { name: actions.save, exact: true })).toBeEnabled();
    const saved = JSON.parse(
      (await page.getByRole('status', { name: actions.saved, exact: true }).textContent())!
    );
    expect(saved).toMatchObject({
      text: 'Changed name',
      note: 'Changed note',
      phone: '+98 ۹۱۲ 1234567',
      select: 'beta',
      checkbox: false,
      switch: false,
      radio: 'beta',
      combo: 'beta',
      multi: ['beta'],
      slider: 11,
      sliders: [11, 20],
      date: '2026-03-23T00:00:00.000Z',
      range: { to: '2026-03-24T00:00:00.000Z' },
    });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(errors).toEqual([]);
  });
  test(`an incomplete date range displays nested validation and focuses its picker before recovery (${locale})`, async ({
    page,
  }) => {
    await page.goto(`${url}?${locale}&partial-range`);
    await page.getByRole('button', { name: actions.save, exact: true }).click();
    const range = page.getByRole('combobox', { name: names.range, exact: true });
    await expect(range).toBeFocused();
    await expect(page.locator('#range-message')).toHaveText(actions.error);
    await expect(range).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('status', { name: actions.attempts, exact: true })).toHaveText('0');
    await range.click();
    await page
      .getByRole('dialog', { name: names.range, exact: true })
      .getByRole('button', { name: locale === 'fa' ? / ۳-ام فروردین / : /March 23rd/ })
      .click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#range-message')).toBeEmpty();
    await page.getByRole('button', { name: actions.save, exact: true }).click();
    await expect(page.getByRole('status', { name: actions.attempts, exact: true })).toHaveText('1');
    await page.getByRole('button', { name: actions.finish, exact: true }).click();
    await expect(page.getByRole('status', { name: actions.saved, exact: true })).toContainText(
      'Retained note'
    );
    await expect(page.getByRole('status', { name: actions.saved, exact: true })).toContainText(
      '2026-03-24T00:00:00.000Z'
    );
  });
  test(`date selection validates on interaction completion and correction preserves other fields (${locale})`, async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date('2026-03-22T12:00:00Z'));
    await page.goto(`${url}?${locale}`);
    const date = page.getByRole('combobox', { name: names.date, exact: true });
    await date.click();
    await page
      .getByRole('dialog', { name: names.date, exact: true })
      .getByRole('button', { name: locale === 'fa' ? / ۲-ام فروردین / : /March 22nd/ })
      .click();
    await expect(page.locator('#date-message')).toHaveText(actions.error);
    await expect(date).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('textbox', { name: names.phone, exact: true })).toHaveValue(
      '+98 912 123 4567'
    );
    await date.click();
    const dialog = page.getByRole('dialog', { name: names.date, exact: true });
    await dialog
      .getByRole('button', { name: locale === 'fa' ? / ۳-ام فروردین / : /March 23rd/ })
      .click();
    await expect(page.locator('#date-message')).toBeEmpty();
    await expect(date).toHaveAttribute('aria-invalid', 'false');
    await expect(page.getByRole('status', { name: actions.draft, exact: true })).toContainText(
      '2026-03-23T00:00:00.000Z'
    );
  });
}
