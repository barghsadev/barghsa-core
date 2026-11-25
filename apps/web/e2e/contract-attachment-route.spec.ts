import { test, expect } from './coverage-fixture';
import { crmShell } from './crm-shell-fixture';
import { contractText } from '@barghsa/i18n/contracts';
import { tContractReviewSignature } from '@barghsa/i18n/contract-review-signature';
import { documentUploadPolicy } from '../src/test/document-list-fixtures.js';

const id = '11111111-1111-4111-8111-111111111111';
const profileId = '22222222-2222-4222-8222-222222222222';
const base = `/admin/contracts/${id}`;
const current = {
  id: '33333333-3333-4333-8333-333333333333',
  versionNumber: 2,
  createdAt: '2026-09-21T00:00:00Z',
  changeDescription: 'Effective terms',
  content: { text: 'Published terms' },
  acceptedAt: '2026-09-21T01:00:00Z',
};
const proposed = {
  ...current,
  id: '44444444-4444-4444-8444-444444444444',
  versionNumber: 3,
  acceptedAt: null,
  changeDescription: 'New delivery period',
  content: { text: 'Proposed delivery period' },
};
const historical = {
  ...current,
  id: '55555555-5555-4555-8555-555555555555',
  versionNumber: 1,
};

test('staff attachment routes verify the draft amendment and return to that same version', async ({
  page,
}) => {
  await crmShell(page, 'fa');
  const word = (key: string) => contractText(key, 'fa');
  let reads = 0;
  let policyReads = 0;
  await page.route(`**/api${base}`, (route) =>
    route.fulfill({
      json: {
        id,
        profileId,
        contractNumber: 'EL-1405-024',
        serviceType: 'electricity',
        state: 'Active',
        currentVersionId: current.id,
        currentVersion: current,
        pendingAmendment: {
          versionId: proposed.id,
          baseVersionId: current.id,
          state: 'Draft',
          proposedBy: 'reviewer',
          createdAt: proposed.createdAt,
          publishedAt: null,
        },
      },
    })
  );
  await page.route(`**/api${base}/versions`, (route) =>
    route.fulfill({ json: { versions: [proposed, current, historical], nextBefore: null } })
  );
  await page.route(`**/api${base}/versions/*`, (route) => {
    reads++;
    expect(new URL(route.request().url()).pathname).toBe(`/api${base}/versions/${proposed.id}`);
    return route.fulfill({ json: proposed });
  });
  await page.route(`**/api${base}/activation?*`, (route) =>
    route.fulfill({
      json: { checks: [], isCurrent: false, ready: false, evaluatedAt: current.createdAt },
    })
  );
  await page.route(`**/api${base}/signature?*`, (route) =>
    route.fulfill({
      json: {
        contractId: id,
        versionId: proposed.id,
        state: 'Draft',
        isCurrent: false,
        isAmendment: true,
        canRequest: false,
        canRecord: false,
        request: null,
        signature: null,
      },
    })
  );
  await page.route('**/api/admin/documents?*', (route) =>
    route.fulfill({ json: { documents: [], nextBefore: null } })
  );
  await page.route('**/api/upload/policy/contract', (route) => {
    policyReads++;
    return route.fulfill({ json: documentUploadPolicy('contract') });
  });
  const editor = page.locator('[data-slot="contract-attachment"]');
  const unavailable = tContractReviewSignature('uploadUnavailable', 'fa');
  await page.goto(`${base}/upload-amendment/${historical.id}`);
  await expect(editor.getByText(unavailable, { exact: true })).toBeVisible();
  expect(reads).toBe(0);

  await page.goto(`${base}/upload-original/${proposed.id}`);
  await expect(editor.getByText(unavailable, { exact: true })).toBeVisible();
  expect(policyReads).toBe(0);

  await page.goto(`${base}/upload-amendment/${proposed.id}`);
  await expect(editor).toContainText('EL-1405-024');
  await expect(
    editor.getByRole('heading', { name: word('uploadAmendment'), exact: true })
  ).toBeFocused();
  await expect(editor.locator('input[type="file"]')).toBeEnabled();
  expect(policyReads).toBe(1);
  await editor.getByRole('link', { name: word('backToContract'), exact: true }).click();
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === base &&
      url.searchParams.get('versionId') === proposed.id &&
      url.hash === '#contract-documents'
  );
  await expect(page.getByText('Proposed delivery period', { exact: true })).toBeVisible();
  const attachments = page.locator('#contract-documents');
  await expect(
    attachments.getByRole('link', { name: word('uploadAmendment'), exact: true })
  ).toHaveAttribute('href', `${base}/upload-amendment/${proposed.id}`);
  await expect(
    attachments.getByRole('link', { name: word('uploadOriginal'), exact: true })
  ).toHaveCount(0);
});
