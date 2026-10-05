import { test, expect, type Page } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import AxeBuilder from '@axe-core/playwright';
import { documentTemplateText } from '@barghsa/i18n/document-templates';
import { t } from '@barghsa/i18n/admin-ui';
import { templateDetail, templateFile } from '../src/test/document-list-fixtures';

async function setup(page: Page, locale: 'en' | 'fa') {
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
        darkMode: locale === 'fa',
      },
    })
  );
  let current = structuredClone(templateDetail);
  let failedRead = false;
  await page.route(
    (url) => url.pathname === '/api/admin/document-templates',
    (route) => route.fulfill({ status: failedRead ? 503 : 200, json: failedRead ? {} : [current] })
  );
  await page.route(`**/api/admin/document-templates/${current.id}`, (route) =>
    route.fulfill({ status: failedRead ? 503 : 200, json: failedRead ? {} : current })
  );
  const word = (key: Parameters<typeof documentTemplateText>[0]) =>
    documentTemplateText(key, locale);
  const confirm = () =>
    page.getByRole('dialog').getByRole('button', { name: t('team.confirm', locale), exact: true });
  await page.goto('/admin/document-templates');
  await page
    .getByRole('region', { name: word('listTitle'), exact: true })
    .getByRole('button', { name: current.title })
    .click();
  await expect(page.getByRole('heading', { name: current.title, exact: true })).toBeVisible();
  return {
    word,
    confirm,
    readFailed: (value: boolean) => {
      failedRead = value;
    },
    save: (value: typeof current) => {
      current = value;
    },
  };
}

async function inspect(page: Page, locale: string, project: string, kind: string) {
  expect((await new AxeBuilder({ page }).include('main > div').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (locale === 'fa' && project === 'chromium') {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page
      .getByRole('heading', { name: documentTemplateText('title', 'fa'), exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `/Users/majid/.local/state/barghsa-manual-batches/document-template-authoring/${kind}-fa.png`,
      fullPage: true,
    });
  }
}

for (const locale of ['en', 'fa'] as const) {
  test(`document metadata keeps raw input, maps server fields and owns one confirmed command (${locale})`, async ({
    page,
  }, info) => {
    const { word, confirm, save } = await setup(page, locale);
    const requests: Record<string, string>[] = [];
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**/api/admin/document-templates/${templateDetail.id}`, async (route) => {
      if (route.request().method() === 'GET') return route.fallback();
      const body = route.request().postDataJSON();
      requests.push(body);
      if (requests.length === 1)
        return route.fulfill({
          status: 400,
          json: {
            error: { code: 'VALIDATION:INPUT:INVALID', fields: ['title', 'privateUnknown'] },
          },
        });
      await pending;
      const result = { ...templateDetail, ...body };
      save(result);
      return route.fulfill({ json: result });
    });
    await page.getByRole('button', { name: word('edit'), exact: true }).click();
    const title = page.locator('#document-template-title');
    const details = page.locator('#document-template-description');
    const form = page.getByRole('form', { name: word('edit'), exact: true });
    await title.fill('   ');
    await form.getByRole('button', { name: word('save'), exact: true }).click();
    await expect(title).toHaveAttribute('aria-invalid', 'true');
    await expect(title).toBeFocused();
    expect(requests).toHaveLength(0);
    await title.fill('  قرارداد مشتری  ');
    await details.fill('  توضیحات قرارداد  ');
    await page.locator('#document-template-summary').fill('Unsubmitted companion draft');
    await form.getByRole('button', { name: word('save'), exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('قرارداد مشتری');
    await confirm().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(title).toHaveValue('  قرارداد مشتری  ');
    await expect(details).toHaveValue('  توضیحات قرارداد  ');
    await expect(title).toHaveAttribute('aria-invalid', 'true');
    await expect(title).toBeFocused();
    await title.fill('  قرارداد به‌روز مشتری  ');
    await form.getByRole('button', { name: word('save'), exact: true }).click();
    await confirm().click();
    await expect.poll(() => requests.length).toBe(2);
    await expect(title).toBeDisabled();
    await expect(page.locator('#document-template-summary')).toBeDisabled();
    await expect(
      page.getByRole('button', { name: word('refresh'), exact: true, includeHidden: true })
    ).toBeDisabled();
    await page
      .getByRole('dialog')
      .locator('form')
      .evaluate((node) => {
        node.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        node.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual({
      title: 'قرارداد به‌روز مشتری',
      description: 'توضیحات قرارداد',
      category: 'contract',
    });
    release();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(
      page.getByRole('status', { name: '', exact: true }).filter({ hasText: word('saved') })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'قرارداد به‌روز مشتری', exact: true })
    ).toBeVisible();
    await expect(page.locator('#document-template-summary')).toHaveValue('');
    await inspect(page, locale, info.project.name, 'metadata');
  });

  test(`document versions validate combined files and recover uncertain publication before deliberate retry (${locale})`, async ({
    page,
  }, info) => {
    const { word, confirm, save, readFailed } = await setup(page, locale);
    const form = page.getByRole('form', { name: word('publishVersion'), exact: true });
    const upload = page.locator('#document-template-files');
    const summary = page.locator('#document-template-summary');
    const retained = form.getByRole('checkbox');
    await retained.uncheck();
    await form.getByRole('button', { name: word('publishVersion'), exact: true }).click();
    await expect(upload).toHaveAttribute('aria-invalid', 'true');
    await expect(upload).toBeFocused();
    await retained.check();
    await upload.setInputFiles({
      name: 'TERMS.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF collision'),
    });
    await form.getByRole('button', { name: word('publishVersion'), exact: true }).click();
    await expect(upload).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(upload).toBeEnabled();
    const bytes = Buffer.from('%PDF-new-version');
    await upload.setInputFiles({
      name: 'Addendum.pdf',
      mimeType: 'application/pdf',
      buffer: bytes,
    });
    await summary.fill('  الحاقیه قرارداد  ');
    const commands: string[] = [];
    let stepUp = false;
    await page.route('**/api/auth/step-up', async (route) => {
      expect(route.request().postDataJSON()).toEqual({ password: 'test-password' });
      stepUp = true;
      await route.fulfill({ json: { verified: true } });
    });
    await page.route(
      `**/api/admin/document-templates/${templateDetail.id}/versions`,
      async (route) => {
        const body = route.request().postData()!;
        commands.push(body);
        expect(body).toContain('Addendum.pdf');
        expect(body).toContain(templateFile.id);
        expect(body).toContain('الحاقیه قرارداد');
        if (commands.length === 1)
          return route.fulfill({ status: 403, json: { requiresStepUp: true } });
        if (!stepUp) throw new Error('Write attempted without step-up');
        if (commands.length === 2) {
          readFailed(true);
          // A successful HTTP status without the matching receipt must not clear the draft.
          return route.fulfill({
            status: 201,
            json: { ...templateDetail, id: '88888888-8888-4888-8888-888888888888' },
          });
        }
        const result = {
          ...templateDetail,
          versionCount: 2,
          versions: [
            {
              ...templateDetail.versions[0],
              id: '99999999-9999-4999-8999-999999999999',
              versionNumber: 2,
              changeSummary: 'الحاقیه قرارداد',
              files: [
                templateFile,
                {
                  ...templateFile,
                  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                  originalName: 'Addendum.pdf',
                  sizeBytes: bytes.length,
                  checksum: 'c'.repeat(64),
                },
              ],
            },
            ...templateDetail.versions,
          ],
        };
        save(result);
        return route.fulfill({ status: 201, json: result });
      }
    );
    await form.getByRole('button', { name: word('publishVersion'), exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('Addendum.pdf');
    await confirm().click();
    await page.locator('#team-step-up-password').fill('test-password');
    await confirm().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText(word('uncertain'), { exact: true })).toBeVisible();
    await expect(summary).toHaveValue('  الحاقیه قرارداد  ');
    await expect(upload).toBeDisabled();
    expect(await upload.evaluate((input: HTMLInputElement) => input.files?.[0]?.name)).toBe(
      'Addendum.pdf'
    );
    const resume = page.getByRole('button', { name: word('resumeEditing'), exact: true });
    await expect(resume).toBeDisabled();
    expect(commands).toHaveLength(2);
    readFailed(false);
    await page.getByRole('button', { name: word('refresh'), exact: true }).click();
    await expect(resume).toBeEnabled();
    expect(commands).toHaveLength(2);
    await resume.click();
    await expect(summary).toBeEnabled();
    await form.getByRole('button', { name: word('publishVersion'), exact: true }).click();
    await confirm().click();
    await expect(page.getByText(word('saved'), { exact: true })).toBeVisible();
    await expect(summary).toHaveValue('');
    await expect(form.getByRole('checkbox')).toHaveCount(2);
    await expect(page.getByRole('region', { name: word('history'), exact: true })).toContainText(
      'Initial terms'
    );
    expect(commands).toHaveLength(3);
    await inspect(page, locale, info.project.name, 'version');
  });
}
