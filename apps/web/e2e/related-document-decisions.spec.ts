import { confirmationText } from '@barghsa/i18n/confirmation';
import { documentText } from '@barghsa/i18n/documents';
import { tSaving } from '@barghsa/i18n/saving';
import { tSolar } from '@barghsa/i18n/solar';
import { test, expect } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import { approveRiskConfirmation } from './confirmation-fixture';
import {
  savingChangeOrder,
  setupSavingChangeAddressForms,
} from './saving-change-address-form-fixture';
import { setupSolarPostalForms } from './solar-postal-form-fixture';
import { solarProfile } from '../src/test/solar-staff-fixtures.js';

const contractId = 'a0000000-0000-4000-8000-000000000001';
const profile = 'a0000000-0000-4000-8000-000000000002';
const versionId = 'a0000000-0000-4000-8000-000000000003';
const otherVersion = 'a0000000-0000-4000-8000-000000000004';
const documentId = 'c0000000-0000-4000-8000-000000000001';
const createdAt = '2026-09-23T10:00:00.000Z';
const locale = 'fa';
const word = (key: string) => documentText(key, locale);
const confirm = confirmationText('confirm', locale);
const original = {
  id: documentId,
  category: 'document',
  originalName: 'installation-report.pdf',
  state: 'SubmittedForReview',
  uploadedByType: 'customer',
  detectedMime: 'application/pdf',
  revision: 4,
  sizeBytes: 900,
  createdAt,
  permissions: { download: true, write: true, remove: true, replace: true },
  history: [],
};

test('contract correction decision reuses the exact command after a mismatched receipt', async ({
  page,
}) => {
  await crmShell(page, locale);
  const base = `/admin/contracts/${contractId}`;
  const record = `${base}/versions/${versionId}/documents/${documentId}`;
  const details = page.getByRole('region', { name: word('details'), exact: true });
  const document = {
    ...original,
    profileId: profile,
    businessRecordType: 'contract',
    businessRecordId: contractId,
    contractVersionId: versionId,
    contractRole: 'original',
    category: 'contract',
  };
  const version = {
    id: versionId,
    versionNumber: 2,
    changeDescription: 'Updated terms',
    createdAt,
    content: { text: 'Agreed terms' },
  };
  let applied = false;
  const commands: unknown[] = [];
  await page.route(`**/api${base}`, (route) =>
    route.fulfill({
      json: {
        id: contractId,
        profileId: profile,
        serviceType: 'electricity',
        contractNumber: 'EL-1405-024',
        state: 'Draft',
        currentVersionId: version.id,
        currentVersion: version,
      },
    })
  );
  await page.route(`**/api${base}/versions`, (route) =>
    route.fulfill({ json: { versions: [version], nextBefore: null } })
  );
  await page.route('**/api/admin/documents?*', (route) =>
    route.fulfill({
      json: {
        documents: [applied ? { ...document, revision: 5, state: 'Available' } : document],
        nextBefore: null,
      },
    })
  );
  await page.route(`**/api/admin/documents/${documentId}`, (route) =>
    route.fulfill({ json: applied ? { ...document, revision: 5, state: 'Available' } : document })
  );
  await page.route(`**/api/admin/documents/${documentId}/request-changes`, (route) => {
    commands.push(route.request().postDataJSON());
    applied = commands.length === 2;
    return route.fulfill({
      json: {
        ...document,
        revision: 5,
        state: 'Available',
        contractVersionId: applied ? versionId : otherVersion,
      },
    });
  });

  await page.goto(record);
  await expect(
    details.getByRole('heading', { name: original.originalName, exact: true })
  ).toBeVisible();
  await expect(details.getByRole('textbox')).toHaveCount(0);
  await details.getByRole('link', { name: word('request-changes'), exact: true }).click();
  await expect(page).toHaveURL(`${record}/request-changes`);
  await expect(
    details.getByRole('heading', { name: word('request-changes'), exact: true })
  ).toBeFocused();
  const form = details.getByRole('form', { name: word('reviewDecision'), exact: true });
  const reason = form.getByRole('textbox', { name: word('decisionLabel.request-changes') });
  const review = form.getByRole('button', { name: word('reviewDecisionAction') });
  await expect(
    form.getByText(word('decisionEffect.request-changes'), { exact: true })
  ).toBeVisible();
  await review.click();
  await expect(reason).toBeFocused();
  await expect(reason).toHaveAttribute('aria-invalid', 'true');
  expect(commands).toEqual([]);

  const explanation = 'امضای صفحه پایانی خوانا نیست. لطفاً نسخه واضحی ارسال کنید.';
  await reason.fill(explanation);
  await review.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(explanation, { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: confirm, exact: true }).click();
  const check = details.getByRole('button', {
    name: confirmationText('checkStatus', locale),
    exact: true,
  });
  await expect(check).toBeVisible();
  await expect(page).toHaveURL(`${record}/request-changes`);
  await check.click();
  await expect(reason).toHaveValue(explanation);
  await review.click();
  await dialog.getByRole('button', { name: confirm, exact: true }).click();
  await expect(
    details.getByRole('status').filter({ hasText: confirmationText('recorded', locale) })
  ).toBeVisible();
  expect(commands).toHaveLength(2);
  expect(commands[1]).toEqual(commands[0]);
  expect(commands[0]).toMatchObject({ expectedRevision: 4, reason: explanation });
  await details.getByRole('link', { name: word('backToDocuments'), exact: true }).click();
  await expect(page).toHaveURL(`${base}#contract-documents`);
});

test('staff saving approval starts compact and retains its queue lane', async ({ page }) => {
  const { state } = await setupSavingChangeAddressForms(page, locale, true);
  const order = state.staffDetails.get(savingChangeOrder)!;
  const base = `/admin/saving-orders/${savingChangeOrder}`;
  const record = `${base}/documents/${documentId}`;
  const document = {
    ...original,
    profileId: order.profileId,
    businessRecordType: 'order',
    businessRecordId: order.orderId,
  };
  const commands: unknown[] = [];
  await page.route(`**/api/admin/documents/${documentId}`, (route) =>
    route.fulfill({ json: document })
  );
  await page.route(`**/api/admin/documents/${documentId}/approve`, (route) => {
    const command = route.request().postDataJSON();
    commands.push(command);
    expect(command).toMatchObject({
      expectedRevision: 4,
      reason: 'مدرک با نشانی ثبت‌شده مطابقت دارد.',
    });
    return route.fulfill({
      json: {
        ...document,
        revision: 5,
        state: 'Approved',
        businessRecordId: commands.length === 1 ? contractId : order.orderId,
      },
    });
  });
  await page.goto(`${record}?lane=fulfillment`);
  const details = page.getByRole('region', { name: word('details'), exact: true });
  await details.getByRole('link', { name: word('approve'), exact: true }).click();
  await expect(page).toHaveURL(`${record}/approve?lane=fulfillment`);
  const form = details.getByRole('form', { name: word('reviewDecision'), exact: true });
  const note = form.getByRole('textbox', { name: word('decisionNote') });
  await expect(note).not.toBeVisible();
  await form.getByText(word('addDecisionNote'), { exact: true }).click();
  await note.fill('مدرک با نشانی ثبت‌شده مطابقت دارد.');
  await form.getByRole('button', { name: word('reviewDecisionAction') }).click();
  await page.getByRole('dialog').getByRole('button', { name: confirm, exact: true }).click();
  await details
    .getByRole('button', { name: confirmationText('checkStatus', locale), exact: true })
    .click();
  await expect(note).toBeVisible();
  await expect(note).toHaveValue('مدرک با نشانی ثبت‌شده مطابقت دارد.');
  await form.getByRole('button', { name: word('reviewDecisionAction') }).click();
  await page.getByRole('dialog').getByRole('button', { name: confirm, exact: true }).click();
  await details.getByRole('link', { name: word('backToDocuments'), exact: true }).click();
  await expect(page).toHaveURL(`${base}?lane=fulfillment#order-documents`);
  await expect(
    page.getByRole('region', { name: tSaving('documents', locale), exact: true })
  ).toBeVisible();
  expect(commands).toHaveLength(2);
  expect(commands[1]).toEqual(commands[0]);
});

test('solar customers can review removal on its own page and cannot open staff approval', async ({
  page,
}) => {
  const { firstSolar } = await setupSolarPostalForms(page, locale, false, true);
  const base = `/solar/requests/${firstSolar}`;
  const record = `${base}/documents/${documentId}`;
  const document = {
    ...original,
    profileId: solarProfile,
    businessRecordType: 'solar_request',
    businessRecordId: firstSolar,
    state: 'Available',
  };
  let removed = false;
  await page.route(`**/api${base}`, (route) =>
    route.fulfill({
      json: {
        request: {
          id: firstSolar,
          profile_id: solarProfile,
          status: 'uploading_documents',
          submitted_at: createdAt,
        },
      },
    })
  );
  await page.route('**/api/documents?*', (route) =>
    route.fulfill({ json: { documents: removed ? [] : [document], nextBefore: null } })
  );
  await page.route(`**/api/documents/${documentId}`, (route) => route.fulfill({ json: document }));
  await page.route(`**/api/documents/${documentId}/remove`, (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ expectedRevision: 4 });
    removed = true;
    return route.fulfill({ json: { ...document, revision: 5, state: 'Removed' } });
  });
  await page.goto(`${record}/approve`);
  const details = page.getByRole('region', { name: word('details'), exact: true });
  await expect(details.getByRole('alert')).toContainText(word('decisionUnavailable'));
  await page.goto(`${base}/documents`);
  const section = page.getByRole('region', {
    name: tSolar('documentGuidance', locale),
    exact: true,
  });
  await section.getByRole('link', { name: word('remove'), exact: true }).click();
  await expect(page).toHaveURL(`${record}/remove`);
  await expect(details.getByText(original.originalName, { exact: true })).toBeVisible();
  await approveRiskConfirmation(page, locale, 'destructive');
  await details.getByRole('button', { name: word('remove'), exact: true }).click();
  await details.getByRole('link', { name: word('backToDocuments'), exact: true }).click();
  await expect(page).toHaveURL(`${base}/documents`);
  await expect(section.getByRole('link', { name: original.originalName, exact: true })).toHaveCount(
    0
  );
  expect(removed).toBe(true);
});
