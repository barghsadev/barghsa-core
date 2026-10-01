import AxeBuilder from '@axe-core/playwright';
import { t as crmText } from '@barghsa/i18n/crm';
import { t as appText } from '@barghsa/i18n/app';
import { test, expect, type Page } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import {
  crmUser,
  crmCaseDetail,
  crmQueue,
  crmCorrectionProfile,
  crmProfileId,
  crmCaseId,
} from '../src/test/crm-recovery-fixtures';
test.use({ viewport: { width: 390, height: 844 } });
async function inspect(page: Page, name: string, locale: string, project: string) {
  expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (locale === 'fa' && project === 'mobile-safari')
    await page.screenshot({
      path: `/tmp/barghsa-crm-${name}-fa-mobile-safari.png`,
      fullPage: true,
    });
}
for (const locale of ['en', 'fa'] as const) {
  const label = (key: string) => crmText(key, locale);
  test(`CRM directory retains expansion and exact cursor through recovery (${locale})`, async ({
    page,
  }, info) => {
    await crmShell(page, locale);
    let failed = false,
      denied = false;
    const requests: string[] = [];
    await page.route('**/api/crm/users?*', (route) => {
      requests.push(route.request().url());
      return route.fulfill({
        status: denied ? 403 : failed ? 503 : 200,
        json: { users: [crmUser], hasMore: true, cursor: 'page-two' },
      });
    });
    await page.goto('/admin/crm?verification=PENDING');
    const table = page.getByRole('table');
    await expect(table).toBeVisible();
    await table.getByRole('button').last().click();
    await expect(table.getByRole('link', { name: /Customer profile/ })).toBeVisible();
    const viewport = page.locator('[data-slot="scroll-area-viewport"]');
    await viewport.evaluate((node) => {
      node.scrollLeft = 0;
    });
    await viewport.focus();
    const position = await viewport.evaluate((node) => node.scrollLeft);
    await viewport.press(locale === 'fa' ? 'ArrowLeft' : 'ArrowRight');
    await expect.poll(() => viewport.evaluate((node) => node.scrollLeft)).not.toBe(position);
    failed = true;
    await page.getByRole('button', { name: label('crm.list.next'), exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(table.getByRole('link', { name: /Customer profile/ })).toBeVisible();
    const failedPath = requests.at(-1);
    expect(new URL(failedPath!).searchParams.get('cursor')).toBe('page-two');
    await inspect(page, 'directory', locale, info.project.name);
    failed = false;
    await page.getByRole('button', { name: label('crm.list.retry'), exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(requests.at(-1)).toBe(failedPath);
    await expect(table.getByRole('link', { name: /Customer profile/ })).toBeVisible();
    denied = true;
    await page.getByRole('button', { name: label('crm.list.refresh'), exact: true }).click();
    await expect(table).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText(label('crm.profile.error.accessDenied'));
    denied = false;
    await page.getByRole('button', { name: label('crm.list.refresh'), exact: true }).click();
    await expect(table).toBeVisible();
  });
  test(`CRM correction review recovers resources independently and invalidates changed evidence (${locale})`, async ({
    page,
  }, info) => {
    await crmShell(page, locale);
    let failQueue = false,
      failDetail = false,
      changedEvidence = false,
      denied = false,
      queueReads = 0,
      detailReads = 0;
    await page.route('**/api/crm/verification-cases?*', (route) => {
      queueReads++;
      return route.fulfill({ status: denied ? 403 : failQueue ? 503 : 200, json: crmQueue });
    });
    await page.route(`**/api/crm/verification-cases/${crmCaseId}`, (route) => {
      detailReads++;
      return route.fulfill({
        status: failDetail ? 503 : 200,
        json: changedEvidence
          ? { ...crmCaseDetail, evidenceUrls: ['verification-evidence/replaced'] }
          : crmCaseDetail,
      });
    });
    const bodies: unknown[] = [];
    await page.route(`**/api/crm/verification-cases/${crmCaseId}/status`, (route) => {
      const body = route.request().postDataJSON();
      bodies.push(body);
      return route.fulfill({
        json: { success: true, id: crmCaseId, profileId: crmProfileId, status: body.decision },
      });
    });
    await page.goto('/admin/crm/corrections');
    await page.getByRole('button', { name: label('crm.corrections.details'), exact: true }).click();
    await page.locator('#case-notes').fill('Keep explanation');
    await page.getByRole('button', { name: label('crm.corrections.save'), exact: true }).click();
    const dialog = page.getByRole('dialog');
    const confirm = dialog.getByRole('button', {
      name: appText('team.confirm', locale),
      exact: true,
    });
    await expect(dialog).toContainText('Keep explanation');
    failQueue = true;
    await dialog
      .getByRole('button', { name: label('crm.corrections.queueRetry'), exact: true })
      .click();
    await expect(confirm).toBeDisabled();
    const detailBefore = detailReads;
    failQueue = false;
    await dialog
      .getByRole('button', { name: label('crm.corrections.queueRetry'), exact: true })
      .click();
    await expect(confirm).toBeEnabled();
    expect(detailReads).toBe(detailBefore);
    failDetail = true;
    await dialog
      .getByRole('button', { name: label('crm.corrections.detailRetry'), exact: true })
      .click();
    await expect(confirm).toBeDisabled();
    const queueBefore = queueReads;
    failDetail = false;
    await dialog
      .getByRole('button', { name: label('crm.corrections.detailRetry'), exact: true })
      .click();
    await expect(confirm).toBeEnabled();
    expect(queueReads).toBe(queueBefore);
    await inspect(page, 'review', locale, info.project.name);
    changedEvidence = true;
    await dialog
      .getByRole('button', { name: label('crm.corrections.detailRetry'), exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('#case-notes')).toHaveValue('Keep explanation');
    expect(bodies).toEqual([]);
    await page.locator('#case-decision').selectOption('Rejected');
    await page.getByRole('button', { name: label('crm.corrections.save'), exact: true }).click();
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    expect(bodies).toEqual([{ decision: 'Rejected', reviewerNotes: 'Keep explanation' }]);
    await page.getByRole('button', { name: label('crm.corrections.details'), exact: true }).click();
    await expect(page.locator('#case-notes')).toBeVisible();
    denied = true;
    await page.getByRole('button', { name: label('crm.list.refresh'), exact: true }).click();
    await expect(page.locator('#case-notes')).toHaveCount(0);
    await expect(page.getByText('Corrected', { exact: true })).toHaveCount(0);
  });
  test(`CRM correction-only creation retains files across profile recovery (${locale})`, async ({
    page,
  }, info) => {
    await crmShell(page, locale);
    let profileFailed = false,
      allowed = true,
      queueReads = 0,
      uploads = 0;
    await page.route('**/api/crm/verification-cases?*', (route) => {
      queueReads++;
      return route.fulfill({ status: 403, json: {} });
    });
    await page.route(`**/api/crm/profiles/${crmProfileId}`, (route) =>
      route.fulfill({
        status: profileFailed ? 503 : 200,
        json: { ...crmCorrectionProfile, viewerPermissions: { canEditIdentity: allowed } },
      })
    );
    const key = 'uploads/document/33333333-3333-4333-8333-333333333333.pdf';
    await page.route('**/api/upload/presigned-url', (route) =>
      route.fulfill({ json: { key, presignedUrl: '/test-evidence-upload' } })
    );
    await page.route('**/test-evidence-upload', (route) => {
      uploads++;
      return route.fulfill({ status: 200, body: '' });
    });
    await page.route('**/api/upload/*/verify', (route) =>
      route.fulfill({ json: { status: 'confirmed' } })
    );
    await page.route('**/api/upload/*/record', (route) =>
      route.fulfill({ json: { status: 'recorded' } })
    );
    const bodies: unknown[] = [];
    await page.route(`**/api/crm/profiles/${crmProfileId}/verification-cases`, (route) => {
      bodies.push(route.request().postDataJSON());
      return route.fulfill({
        json: { success: true, id: crmCaseId, profileId: crmProfileId, status: 'Open' },
      });
    });
    await page.goto(`/admin/crm/corrections?profileId=${crmProfileId}`);
    await page.locator('#correction-field').selectOption('last_name');
    await page.locator('#correction-value').fill('New name');
    await page.locator('#correction-reason').fill('Checked document');
    await page.locator('#correction-files').setInputFiles({
      name: 'evidence.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n'),
    });
    const upload = page.getByRole('button', { name: label('crm.corrections.upload'), exact: true });
    profileFailed = true;
    await page.getByRole('button', { name: label('crm.list.refresh'), exact: true }).click();
    await expect(upload).toBeDisabled();
    await expect(page.locator('#correction-value')).toHaveValue('New name');
    await page.locator('#correction-value').fill('Edited during retry');
    const queueBefore = queueReads;
    profileFailed = false;
    await page
      .getByRole('button', { name: label('crm.corrections.profileRetry'), exact: true })
      .click();
    await expect(upload).toBeEnabled();
    expect(queueReads).toBe(queueBefore);
    expect(
      await page
        .locator('#correction-files')
        .evaluate((node: HTMLInputElement) => node.files?.length)
    ).toBe(1);
    await inspect(page, 'creation', locale, info.project.name);
    await upload.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Edited during retry');
    expect(uploads).toBe(1);
    allowed = false;
    await dialog
      .getByRole('button', { name: label('crm.corrections.profileRetry'), exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('#correction-value')).toHaveCount(0);
    expect(bodies).toEqual([]);
  });
}
