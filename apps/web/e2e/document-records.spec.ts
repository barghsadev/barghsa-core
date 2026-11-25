import { documentUploadPolicy } from '../src/test/document-list-fixtures.js';
import { test, expect, type Page } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { documentText } from '@barghsa/i18n/documents';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { t as appText } from '@barghsa/i18n/app';
import { approveRiskConfirmation } from './confirmation-fixture';
import {
  documentRow,
  documentProfileId,
  documentCursor,
  documentDetail,
} from '../src/test/document-list-fixtures.js';

async function shell(page: Page, locale: 'en' | 'fa', staff: boolean) {
  await page.addInitScript((language) => localStorage.setItem('barghsa.locale', language), locale);
  await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: staff ? 'staff' : 'customer',
        isStaff: staff,
        operatingContext: staff ? 'staff' : 'customer',
        canSwitchContext: false,
        requiresTosAcceptance: false,
      },
    })
  );
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        activeProfileId: documentProfileId,
        hasDefault: true,
        profiles: [
          {
            id: documentProfileId,
            title: 'Current profile',
            profileType: 'LEGAL',
            status: 'ACTIVE',
            isDefault: true,
          },
        ],
      },
    })
  );
  await page.route('**/api/user/settings/theme', (route) =>
    route.fulfill({ json: { mode: locale === 'fa' ? 'dark' : 'light' } })
  );
  await page.route('**/api/user/settings/timezone', (route) =>
    route.fulfill({ json: { timezone: 'Asia/Tehran' } })
  );
  await page.route('**/api/admin/document-retention/policies', (route) =>
    route.fulfill({ json: { policies: [], canManage: false } })
  );
  await page.route('**/api/admin/document-retention/destruction', (route) =>
    route.fulfill({ json: { items: [], counts: [], canManage: false } })
  );
  await page.route('https://files.test/preview.png', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cA1cAAAAASUVORK5CYII=',
        'base64'
      ),
    })
  );
  await page.route('**/api/upload/policy/*', (route) =>
    route.fulfill({
      json: documentUploadPolicy(new URL(route.request().url()).pathname.split('/').at(-1)),
    })
  );
}
for (const locale of ['en', 'fa'] as const)
  test(`document policy and review require matching receipts and a fresh read after uncertainty (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale, true);
    const word = (key: string) => documentText(key, locale);
    const policy = {
      id: '44444444-4444-4444-8444-444444444444',
      businessRecordType: 'contract',
      retentionYears: 10,
      legalHold: false,
      approvalNote: 'System default',
      effectiveDate: documentRow.createdAt,
    };
    const acceptedPolicy = {
      ...policy,
      id: '55555555-5555-4555-8555-555555555555',
      retentionYears: 12,
      legalHold: true,
      approvalNote: 'Reviewed preservation requirement',
    };
    let policyWrites = 0,
      policyReadFails = false,
      approved = false,
      badRead = false;
    const approvals: unknown[] = [];
    const base = '/api/admin/documents';
    await page.route('**/api/admin/document-retention/policies', (route) =>
      policyReadFails
        ? route.fulfill({ status: 503, json: {} })
        : route.fulfill({
            json: { canManage: true, policies: [policyWrites === 2 ? acceptedPolicy : policy] },
          })
    );
    await page.route('**/api/admin/document-retention/policies/contract', (route) => {
      expect(route.request().postDataJSON()).toEqual({
        retentionYears: acceptedPolicy.retentionYears,
        legalHold: acceptedPolicy.legalHold,
        approvalNote: acceptedPolicy.approvalNote,
      });
      policyWrites++;
      return route.fulfill({
        json:
          policyWrites === 1
            ? { ...acceptedPolicy, businessRecordType: 'invoice' }
            : acceptedPolicy,
      });
    });
    const reviewed = { ...documentRow, revision: 4, state: 'Approved' };
    await page.route(
      (url) => url.pathname === base,
      (route) =>
        route.fulfill({
          json: { documents: [approved ? reviewed : documentRow], nextBefore: null },
        })
    );
    await page.route(`**${base}/${documentRow.id}`, (route) =>
      route.fulfill({
        json: {
          ...(approved ? { ...documentDetail, ...reviewed } : documentDetail),
          ...(badRead
            ? { profileId: documentCursor, originalName: 'PRIVATE FOREIGN DOCUMENT' }
            : {}),
        },
      })
    );
    await page.route(`**${base}/${documentRow.id}/approve`, (route) => {
      approvals.push(route.request().postDataJSON());
      approved = approvals.length === 2;
      return route.fulfill({
        json: approved ? reviewed : { ...reviewed, profileId: documentCursor },
      });
    });
    await page.goto('/admin/documents');
    await page.getByRole('link', { name: word('retentionPolicies'), exact: true }).click();
    const panel = page.getByRole('region', { name: word('retentionPolicies'), exact: true });
    await panel
      .getByRole('link', {
        name: word('editRetentionFor').replace('{kind}', word('contract')),
        exact: true,
      })
      .click();
    const save = panel.getByRole('button', { name: word('reviewRetention'), exact: true });
    const note = panel.getByLabel(word('approvalNote'), { exact: true });
    const confirm = page.getByRole('dialog').getByRole('button', {
      name: appText('team.confirm', locale),
      exact: true,
    });
    const check = { name: confirmationText('checkStatus', locale), exact: true };
    await panel.getByLabel(word('retentionYears'), { exact: true }).fill('12');
    await panel.getByLabel(word('policyHold'), { exact: true }).check();
    await note.fill(acceptedPolicy.approvalNote);
    await save.click();
    await confirm.click();
    await expect(panel.getByRole('alert')).toContainText(confirmationText('unconfirmed', locale));
    await expect(panel.getByText(word('policyUpdated'), { exact: true })).toHaveCount(0);
    await expect(save).toBeDisabled();
    policyReadFails = true;
    await panel.getByRole('button', check).click();
    await expect(panel.getByRole('button', check)).toBeEnabled();
    await expect(note).toHaveValue(acceptedPolicy.approvalNote);
    await expect(save).toBeDisabled();
    expect(policyWrites).toBe(1);
    policyReadFails = false;
    await panel.getByRole('button', check).click();
    await expect(save).toBeEnabled();
    await expect(note).toHaveValue(acceptedPolicy.approvalNote);
    await save.click();
    await confirm.click();
    await expect(
      panel.getByRole('status').filter({ hasText: word('policyUpdated') })
    ).toBeVisible();
    expect(policyWrites).toBe(2);

    await page.getByRole('link', { name: word('backToRetention'), exact: true }).click();
    await page.getByRole('link', { name: word('backToDocuments'), exact: true }).click();
    await page.getByRole('link', { name: documentRow.originalName, exact: true }).click();
    const detail = page.getByRole('region', { name: word('details'), exact: true });
    await detail.getByRole('link', { name: word('approve'), exact: true }).click();
    const approve = detail.getByRole('button', { name: word('reviewDecisionAction'), exact: true });
    await approve.click();
    await confirm.click();
    await expect(detail.getByRole('alert')).toContainText(confirmationText('unconfirmed', locale));
    await expect(approve).toHaveCount(0);
    badRead = true;
    await detail.getByRole('button', check).click();
    await expect(detail.getByRole('alert')).toContainText(word('error'));
    await expect(detail.getByText(documentRow.originalName, { exact: true })).toHaveCount(0);
    await expect(detail.getByText('PRIVATE FOREIGN DOCUMENT')).toHaveCount(0);
    await expect(approve).toHaveCount(0);
    expect(approvals).toHaveLength(1);
    badRead = false;
    await detail.getByRole('button', { name: word('refresh'), exact: true }).click();
    await approve.click();
    await confirm.click();
    await expect(approve).toHaveCount(0);
    await expect(detail.getByRole('status')).toContainText(documentRow.originalName);
    expect(approvals).toHaveLength(2);
    expect(approvals[1]).toEqual(approvals[0]);
  });

for (const locale of ['en', 'fa'] as const)
  test(`staff document decision routes keep the action and version fixed (${locale})`, async ({
    page,
  }) => {
    await shell(page, locale, true);
    const word = (key: string) => documentText(key, locale);
    const root = `/admin/documents/${documentRow.id}`;
    const base = `/api${root}`;
    const decisions = [
      {
        action: 'submit',
        from: 'Available',
        to: 'SubmittedForReview',
        required: false,
        destructive: false,
      },
      {
        action: 'approve',
        from: 'SubmittedForReview',
        to: 'Approved',
        required: false,
        destructive: false,
      },
      {
        action: 'reject',
        from: 'SubmittedForReview',
        to: 'Rejected',
        required: true,
        destructive: true,
      },
      {
        action: 'request-changes',
        from: 'SubmittedForReview',
        to: 'Available',
        required: true,
        destructive: false,
      },
      {
        action: 'quarantine',
        from: 'SubmittedForReview',
        to: 'Quarantined',
        required: true,
        destructive: true,
      },
      { action: 'remove', from: 'PendingScan', to: 'Removed', required: false, destructive: true },
    ] as const;
    let record = {
      ...documentDetail,
      permissions: { download: false, write: true, remove: true, replace: false },
    };
    const writes: string[] = [];
    await page.route(`**${base}`, (route) => route.fulfill({ json: record }));
    for (const { action, from, to, required, destructive } of decisions) {
      const reason = `Reason for ${action}`;
      await page.route(`**${base}/${action}`, (route) => {
        const request = route.request();
        expect(request.method()).toBe('POST');
        expect(request.postDataJSON()).toEqual({
          expectedRevision: documentRow.revision,
          idempotencyKey: expect.any(String),
          reason,
        });
        writes.push(action);
        record = { ...record, state: to, revision: record.revision + 1 };
        return route.fulfill({ json: record });
      });
      record = { ...record, state: from, revision: documentRow.revision };
      await page.goto(`${root}?profileId=${documentProfileId}`);
      const detail = page.getByRole('region', { name: word('details'), exact: true });
      await detail.getByRole('link', { name: word(action), exact: true }).click();
      expect(new URL(page.url()).pathname).toBe(`${root}/decisions/${action}`);
      expect(new URL(page.url()).searchParams.get('profileId')).toBe(documentProfileId);
      const form = detail.getByRole('form', { name: word('reviewDecision'), exact: true });
      const label = word(required ? `decisionLabel.${action}` : 'decisionNote');
      const input = form.getByRole('textbox', { name: label, exact: true });
      await expect(form).toContainText(documentRow.originalName);
      await expect(form).toContainText(word(from));
      const review = form.getByRole('button', { name: word('reviewDecisionAction'), exact: true });
      if (required) {
        await expect(input).toHaveAttribute('aria-required', 'true');
        await review.click();
        await expect(input).toBeFocused();
        await expect(input).toHaveAccessibleDescription(word('reasonRequired'));
        await expect(page.getByRole('dialog')).toHaveCount(0);
      } else {
        await expect(input).not.toHaveAttribute('aria-required', 'true');
      }
      await input.fill(reason);
      await review.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(reason);
      await expect(dialog).toContainText(word(to));
      expect(writes).not.toContain(action);
      if (destructive) await approveRiskConfirmation(page, locale, 'destructive');
      await dialog
        .getByRole('button', { name: appText('team.confirm', locale), exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      await expect(detail.getByRole('status').filter({ hasText: word(to) })).toBeVisible();
      await expect(form).toHaveCount(0);
    }
    record = {
      ...record,
      state: 'SubmittedForReview',
      permissions: { ...record.permissions, write: false },
    };
    await page.goto(`${root}/decisions/reject`);
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(word('decisionUnavailable'));
    await expect(page.locator('#document-review-reason')).toHaveCount(0);
    expect(writes).toEqual(decisions.map(({ action }) => action));
  });

for (const staff of [false, true])
  for (const locale of ['en', 'fa'] as const) {
    test(`${staff ? 'staff' : 'customer'} document metadata and lazy files survive layout changes (${locale})`, async ({
      page,
    }, testInfo) => {
      await shell(page, locale, staff);
      const word = (key: string) => documentText(key, locale),
        base = staff ? '/api/admin/documents' : '/api/documents';
      let listReads = 0,
        detailReads = 0,
        previewReads = 0,
        downloadReads = 0;
      const quarantine = {
        ...documentRow,
        id: documentCursor,
        state: 'Quarantined',
        originalName: 'Quarantined.pdf',
        rejectionReason: 'PRIVATE scanner signature',
      };
      await page.route(
        (url) => url.pathname === base,
        (route) => {
          listReads++;
          return route.fulfill({
            json: {
              documents: [
                documentRow,
                quarantine,
                {
                  ...quarantine,
                  id: '44444444-4444-4444-8444-444444444444',
                  originalName: 'Replaced.pdf',
                  state: 'Superseded',
                  scanState: 'Quarantined',
                },
              ],
              nextBefore: null,
            },
          });
        }
      );
      await page.route(`**${base}/${documentRow.id}`, (route) => {
        detailReads++;
        return route.fulfill({ json: documentDetail });
      });
      await page.route(`**${base}/${documentRow.id}/preview`, (route) => {
        previewReads++;
        return route.fulfill({ json: { url: 'https://files.test/preview.png', expiresIn: 300 } });
      });
      await page.route(`**${base}/${documentRow.id}/download`, (route) => {
        downloadReads++;
        return route.fulfill({ json: { url: 'https://files.test/proof.pdf', expiresIn: 300 } });
      });
      await page.goto(staff ? '/admin/documents' : '/documents');
      const list = page.getByRole('region', { name: word('listTitle'), exact: true }),
        records = list.locator('[data-slot="document-records"]');
      const record = records.getByRole('link', {
        name: documentRow.originalName,
        exact: true,
      });
      await expect(record).toBeVisible();
      expect(previewReads + downloadReads).toBe(0);
      await expect(records).toContainText(word('quarantinedNotice'));
      await expect(records).not.toContainText('PRIVATE');
      await expect(records).toContainText(word('sizeBytes'));
      await expect(records.locator('time').first()).toHaveAttribute(
        'datetime',
        documentRow.createdAt
      );
      const reads = listReads;
      await records.getByRole('button', { name: word('preview'), exact: true }).click();
      await expect(records.getByRole('img')).toBeVisible();
      await records.getByRole('button', { name: word('download'), exact: true }).click();
      await expect(
        records.getByRole('link', { name: word('openFile'), exact: true })
      ).toHaveAttribute('href', 'https://files.test/proof.pdf');
      const main = page.getByRole('main');
      const detail = main.getByRole('region', { name: word('details'), exact: true });
      const detailCount = detailReads;
      const tableTooltip = page.locator('[data-table-action-tooltip-popup]');
      for (const view of ['table', 'card'] as const) {
        const control = list.getByRole('button', {
          name: appText(`historyView.${view}`, locale),
          exact: true,
        });
        await control.focus();
        await control.press('Enter');
        await expect(records).toHaveAttribute('data-view', view);
        if (testInfo.project.name === 'chromium' && view === 'card')
          await expect(tableTooltip).toHaveCount(0);
        await expect(control).toHaveAttribute('aria-pressed', 'true');
        await expect(records.getByRole('img')).toBeVisible();
        expect(listReads).toBe(reads);
        expect(detailReads).toBe(detailCount);
        expect(previewReads).toBe(1);
        expect(downloadReads).toBe(1);
        expect(
          (await new AxeBuilder({ page }).include('[data-slot="document-records"]').analyze())
            .violations
        ).toEqual([]);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
        ).toBe(true);
        if (testInfo.project.name === 'chromium' && view === 'table') {
          await records
            .getByRole('button', { name: word('download'), exact: true })
            .dispatchEvent('pointerover', { pointerType: 'mouse' });
          await expect(tableTooltip).toContainText(word('download'));
        }
      }
      await records.getByRole('button', { name: word('hidePreview'), exact: true }).click();
      await expect(records.getByRole('img')).toHaveCount(0);
      await records.getByRole('button', { name: word('preview'), exact: true }).click();
      expect(previewReads).toBe(1);
      await page.screenshot({
        path: `/tmp/barghsa-documents-${staff ? 'staff' : 'customer'}-${locale}-${testInfo.project.name}.png`,
        fullPage: true,
      });
      {
        await record.press('Enter');
        await expect(
          detail.getByRole('heading', { name: documentRow.originalName, level: 1 })
        ).toBeVisible();
        expect(listReads).toBe(reads);
        expect(detailReads).toBe(detailCount + 1);
        await main.getByRole('link', { name: word('backToDocuments'), exact: true }).click();
        await expect(records).toHaveAttribute('data-view', 'card');
      }
    });
    test(`${staff ? 'staff' : 'customer'} document access retry and upload draft survive layout changes (${locale})`, async ({
      page,
    }) => {
      await shell(page, locale, staff);
      const word = (key: string) => documentText(key, locale),
        base = staff ? '/api/admin/documents' : '/api/documents';
      let reads = 0,
        previewReads = 0,
        status = 503;
      await page.route(
        (url) => url.pathname === base,
        (route) => {
          reads++;
          return route.fulfill({ json: { documents: [documentRow], nextBefore: null } });
        }
      );
      await page.route(`**${base}/${documentRow.id}/preview`, (route) => {
        previewReads++;
        return route.fulfill({
          status,
          json: status === 200 ? { url: 'https://files.test/preview.png' } : {},
        });
      });
      await page.route(`**${base}/${documentRow.id}/download`, (route) =>
        route.fulfill({ json: { url: 'https://files.test/proof.pdf' } })
      );
      await page.goto(staff ? `/admin/documents?profileId=${documentProfileId}` : '/documents');
      const list = page.getByRole('region', { name: word('listTitle'), exact: true }),
        records = list.locator('[data-slot="document-records"]');
      const fileLink = records.getByRole('link', { name: word('openFile'), exact: true });
      await records.getByRole('button', { name: word('preview'), exact: true }).click();
      await expect(records.getByRole('alert')).toContainText(word('fileAccessError'));
      status = 200;
      await records.getByRole('button', { name: word('preview'), exact: true }).click();
      await expect(records.getByRole('img')).toBeVisible();
      await records.getByRole('button', { name: word('download'), exact: true }).click();
      await expect(fileLink).toBeVisible();
      const controls = page.getByRole('main');
      {
        await list
          .getByRole('button', { name: appText('historyView.table', locale), exact: true })
          .click();
        await list
          .getByRole('button', { name: appText('historyView.card', locale), exact: true })
          .click();
      }
      await list.getByRole('link', { name: word('upload'), exact: true }).click();
      await controls.locator('input[type="file"]').setInputFiles({
        name: 'draft.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.7'),
      });
      const count = reads;
      await page.setViewportSize({ width: 390, height: 844 });
      expect(
        await controls
          .locator('input[type="file"]')
          .evaluate((element: HTMLInputElement) => element.files?.[0]?.name)
      ).toBe('draft.pdf');
      expect(reads).toBe(count);
      {
        await controls.getByRole('button', { name: word('cancel'), exact: true }).click();
        await records.getByRole('button', { name: word('preview'), exact: true }).click();
        await records.getByRole('button', { name: word('download'), exact: true }).click();
        await expect(fileLink).toBeVisible();
      }
      await records.getByRole('button', { name: word('hidePreview'), exact: true }).click();
      // A new accepted revision invalidates all previously issued links.
      await page.route(
        (url) => url.pathname === base,
        (route) =>
          route.fulfill({
            json: { documents: [{ ...documentRow, revision: 4 }], nextBefore: null },
          })
      );
      await list.getByRole('button', { name: word('refresh'), exact: true }).click();
      await expect(fileLink).toHaveCount(0);
      status = 403;
      await records.getByRole('button', { name: word('preview'), exact: true }).click();
      await expect(list.getByRole('alert')).toContainText(word('denied'));
      await expect(list.locator('[data-slot=document-records]')).toHaveCount(0);
      await expect(list.getByRole('img')).toHaveCount(0);
      await expect(list.getByRole('link')).toHaveCount(0);
      await expect(list.locator('input[type=file]')).toHaveCount(0);
      expect(previewReads).toBe(4);
    });
  }

for (const staff of [false, true])
  for (const locale of ['en', 'fa'] as const) {
    test(`${staff ? 'staff' : 'customer'} document replacement and removal preserve scope and exact retry proposals (${locale})`, async ({
      page,
    }, testInfo) => {
      await shell(page, locale, staff);
      const word = (key: string) => documentText(key, locale),
        base = staff ? '/api/admin/documents' : '/api/documents';
      const replace = {
        ...documentRow,
        state: 'Available',
        originalName: 'Replace.pdf',
        permissions: { download: true, write: true, remove: false, replace: true },
      };
      const old = {
        ...documentRow,
        id: documentCursor,
        state: 'Superseded',
        originalName: 'Old.pdf',
        permissions: { download: true, write: true, remove: true, replace: false },
      };
      const readonly = {
        ...replace,
        id: '44444444-4444-4444-8444-444444444444',
        originalName: 'Read only.pdf',
        permissions: { download: true, write: false, remove: false, replace: false },
      };
      const next = {
        ...replace,
        id: '55555555-5555-4555-8555-555555555555',
        originalName: 'replacement.pdf',
        supersedesDocumentId: replace.id,
      };
      let documents = [replace, old, readonly],
        detailReads = 0,
        putCount = 0,
        releaseRemoval = () => {};
      const heldRemoval = new Promise<void>((resolve) => (releaseRemoval = resolve));
      const removals: unknown[] = [];
      await page.route(
        (url) => url.pathname === base,
        async (route) => {
          if (route.request().method() === 'POST') {
            const body = route.request().postDataJSON();
            expect(body).toMatchObject({
              profileId: documentProfileId,
              supersedesDocumentId: replace.id,
              businessRecordType: 'standalone',
              fileName: 'replacement.pdf',
            });
            expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
            return route.fulfill({
              status: 201,
              json: {
                document: { ...next, state: 'Uploading', revision: 1 },
                upload: {
                  presignedUrl: 'https://files.test/replacement',
                  headers: { 'Content-Type': 'application/pdf' },
                },
              },
            });
          }
          return route.fulfill({ json: { documents, nextBefore: null } });
        }
      );
      await page.route('https://files.test/replacement', (route) => {
        expect(route.request().method()).toBe('PUT');
        putCount++;
        return route.fulfill({ status: 200 });
      });
      await page.route(`**${base}/${next.id}/confirm`, (route) => {
        expect(route.request().postDataJSON()).toMatchObject({
          expectedRevision: 1,
          idempotencyKey: expect.any(String),
        });
        documents = [next, old, readonly];
        return route.fulfill({ json: next });
      });
      await page.route(`**${base}/${next.id}`, (route) => {
        detailReads++;
        return route.fulfill({ json: { ...next, history: [] } });
      });
      await page.route(`**${base}/${replace.id}`, (route) => {
        detailReads++;
        return route.fulfill({
          json: { ...replace, state: putCount ? 'Superseded' : replace.state, history: [] },
        });
      });
      await page.route(`**${base}/${readonly.id}`, (route) =>
        route.fulfill({ json: { ...readonly, history: [] } })
      );
      await page.route(`**${base}/${old.id}`, (route) => {
        detailReads++;
        const current = documents.some(({ id }) => id === old.id)
          ? old
          : { ...old, state: 'Removed', revision: 4 };
        return route.fulfill({ json: { ...current, history: [] } });
      });
      await page.route(`**${base}/${old.id}/download`, (route) =>
        route.fulfill({ json: { url: 'https://files.test/old.pdf' } })
      );
      await page.route('**/api/auth/step-up', (route) => {
        expect(route.request().postDataJSON()).toEqual({ password: 'test password' });
        return route.fulfill({ json: { verified: true } });
      });
      await page.route(`**${base}/${old.id}/remove`, async (route) => {
        const body = route.request().postDataJSON();
        removals.push(body);
        expect(body).toMatchObject({
          expectedRevision: old.revision,
          idempotencyKey: expect.any(String),
        });
        if (removals.length === 1)
          return route.fulfill({ status: 409, json: { error: 'conflict' } });
        if (removals.length === 2)
          return route.fulfill({ status: 403, json: { requiresStepUp: true } });
        if (removals.length === 3) {
          await heldRemoval;
          return route.abort().catch(() => {});
        }
        documents = [next, readonly];
        return route.fulfill({ json: { ...old, state: 'Removed', revision: 4 } });
      });
      const list = page.getByRole('region', { name: word('listTitle'), exact: true }),
        records = list.locator('[data-slot=document-records]');
      const main = page.getByRole('main');
      const detail = main.getByRole('region', { name: word('details'), exact: true });
      const rowRole = 'link';
      const fileLinks = records.getByRole('link', { name: word('openFile'), exact: true });
      const docsRoute = staff ? '/admin/documents' : '/documents';
      {
        await page.goto(`${docsRoute}/${readonly.id}/replace`);
        await expect(main.getByRole('alert')).toContainText(word('denied'));
        await expect(main.locator('input[type=file]')).toHaveCount(0);
        await page.goto(staff ? docsRoute + '?state=all' : docsRoute);
      }
      await list
        .getByRole('button', { name: appText('historyView.table', locale), exact: true })
        .click();
      const readRow = records
        .getByRole('row')
        .filter({ has: page.getByRole(rowRole, { name: readonly.originalName, exact: true }) });
      await expect(readRow.getByRole(rowRole, { name: word('replace'), exact: true })).toHaveCount(
        0
      );
      await expect(readRow.getByRole('link', { name: word('remove'), exact: true })).toHaveCount(0);
      const replaceRow = records
        .getByRole('row')
        .filter({ has: page.getByRole(rowRole, { name: replace.originalName, exact: true }) });
      await replaceRow.getByRole(rowRole, { name: word('replace'), exact: true }).click();
      const upload = main.locator('form').filter({ has: page.locator('input[type=file]') });
      const fileInput = upload.locator('input[type=file]');
      await expect(fileInput).toBeEnabled();
      expect(detailReads).toBe(1);
      await fileInput.setInputFiles({
        name: 'replacement.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.7'),
      });
      await upload.getByRole('button', { name: word('replace'), exact: true }).click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: appText('team.confirm', locale), exact: true })
        .click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByText(word('uploadComplete'), { exact: true })).toBeVisible();
      const back = main.getByRole('link', { name: word('backToDocuments'), exact: true });
      await expect.poll(() => new URL(page.url()).pathname).toBe(`${docsRoute}/${next.id}`);
      await detail.getByRole('link', { name: word('predecessor'), exact: true }).click();
      await expect(
        detail.getByRole('heading', { name: replace.originalName, level: 1 })
      ).toBeVisible();
      await back.click();
      expect(putCount).toBe(1);
      const oldRow = records
        .getByRole('row')
        .filter({ has: page.getByRole(rowRole, { name: old.originalName, exact: true }) });
      await oldRow.getByRole(rowRole, { name: old.originalName, exact: true }).click();
      await expect(detail.getByRole('heading', { name: old.originalName })).toBeVisible();
      await back.click();
      await oldRow.getByRole('button', { name: word('download'), exact: true }).click();
      await expect(oldRow.getByRole('link', { name: word('openFile'), exact: true })).toBeVisible();
      const removeLink = oldRow.getByRole('link', { name: word('remove'), exact: true });
      await removeLink.press('Enter');
      await expect(page).toHaveURL(
        `${docsRoute}/${old.id}/${staff ? 'decisions/' : ''}remove${staff ? '?state=all' : ''}`
      );
      const review = detail.getByRole('button', {
        name: word('reviewDecisionAction'),
        exact: true,
      });
      if (staff) await review.click();
      const confirmation = staff
        ? page.getByRole('dialog')
        : detail.getByRole('form', { name: word('remove'), exact: true });
      const confirm = confirmation.getByRole('button', {
        name: staff ? appText('team.confirm', locale) : word('remove'),
        exact: true,
      });
      await expect(confirmation).toContainText(old.originalName);
      await expect(confirm).toBeDisabled();
      await approveRiskConfirmation(page, locale, 'destructive');
      await confirm.click();
      await expect(confirmation.getByRole('alert')).toContainText(word('conflict'));
      await confirm.click();
      await confirmation.locator('input[type=password]').fill('test password');
      await page.clock.install();
      await confirmation
        .getByRole('button', { name: appText('team.confirm', locale), exact: true })
        .click();
      try {
        await expect.poll(() => removals.length).toBe(3);
        await page.clock.runFor(15_100);
        await expect(confirmation).toHaveCount(0);
        await expect(detail.getByRole('alert')).toContainText(
          confirmationText('unconfirmed', locale)
        );
        await expect(main.getByRole('link', { name: word('openFile'), exact: true })).toHaveCount(
          0
        );
      } finally {
        releaseRemoval();
      }
      await detail
        .getByRole('button', { name: confirmationText('checkStatus', locale), exact: true })
        .click();
      if (staff) await review.click();
      await expect(confirm).toBeDisabled();
      expect(removals).toHaveLength(3);
      await approveRiskConfirmation(page, locale, 'destructive');
      await confirm.click();
      await expect(confirmation).toHaveCount(0);
      await expect(detail.getByRole('status')).toContainText(word('Removed'));
      await detail.getByRole('link', { name: word('backToDocuments'), exact: true }).click();
      await expect(records.getByRole(rowRole, { name: old.originalName, exact: true })).toHaveCount(
        0
      );
      expect(removals).toHaveLength(4);
      expect(removals[1]).toEqual(removals[0]);
      expect(removals[2]).toEqual(removals[0]);
      expect(removals[3]).toEqual(removals[0]);
      expect(detailReads).toBe(staff ? 7 : 6);
      await expect(list.getByRole('region', { name: word('details'), exact: true })).toHaveCount(0);
      await expect(fileLinks).toHaveCount(0);
      expect(
        (await new AxeBuilder({ page }).include('[data-slot=document-records]').analyze())
          .violations
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      await records.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath('inline-document-recovery.png'),
      });
    });
    test(`${staff ? 'staff' : 'customer'} clears private document actions after permission denial (${locale})`, async ({
      page,
    }) => {
      await shell(page, locale, staff);
      const word = (key: string) => documentText(key, locale),
        base = staff ? '/api/admin/documents' : '/api/documents';
      const row = {
        ...documentRow,
        state: 'Superseded',
        permissions: { download: true, write: true, remove: true, replace: false },
      };
      let denied = false;
      const deniedStatus = locale === 'fa' ? 401 : 403;
      await page.route(
        (url) => url.pathname === base,
        (route) =>
          route.fulfill(
            denied
              ? { status: deniedStatus, json: {} }
              : { json: { documents: [row], nextBefore: null } }
          )
      );
      await page.route(`**${base}/${row.id}`, (route) =>
        route.fulfill(
          denied ? { status: deniedStatus, json: {} } : { json: { ...row, history: [] } }
        )
      );
      await page.route(`**${base}/${row.id}/download`, (route) =>
        route.fulfill({ json: { url: 'https://files.test/private.pdf' } })
      );
      await page.route(`**${base}/${row.id}/remove`, (route) => {
        denied = true;
        return route.fulfill({ status: deniedStatus, json: { error: 'forbidden' } });
      });
      await page.goto(staff ? '/admin/documents?state=all' : '/documents');
      const list = page.getByRole('region', { name: word('listTitle'), exact: true }),
        records = list.locator('[data-slot=document-records]');
      await records.getByRole('button', { name: word('download'), exact: true }).click();
      await expect(
        records.getByRole('link', { name: word('openFile'), exact: true })
      ).toBeVisible();
      await records.getByRole('link', { name: word('remove'), exact: true }).click();
      const main = page.getByRole('main');
      if (staff)
        await main.getByRole('button', { name: word('reviewDecisionAction'), exact: true }).click();
      await approveRiskConfirmation(page, locale, 'destructive');
      const confirmation = staff
        ? page.getByRole('dialog')
        : main.getByRole('form', { name: word('remove'), exact: true });
      await confirmation
        .getByRole('button', {
          name: staff ? appText('team.confirm', locale) : word('remove'),
          exact: true,
        })
        .click();
      await expect(confirmation).toHaveCount(0);
      await expect(main.getByRole('alert')).toContainText(word('denied'));
      await expect(main.getByText(row.originalName, { exact: true })).toHaveCount(0);
      await expect(main.getByRole('link', { name: word('openFile') })).toHaveCount(0);
      const back = main.getByRole('link', { name: word('backToDocument'), exact: true });
      await expect(back).toHaveAttribute(
        'href',
        new RegExp(`^${staff ? '/admin' : ''}/documents/${row.id}(?:\\?|$)`)
      );
      await back.click();
      await expect(main.getByRole('alert')).toContainText(word('denied'));
      await main.getByRole('link', { name: word('backToDocuments'), exact: true }).click();
      await expect(list.getByRole('alert')).toContainText(word('denied'));
      await expect(list.locator('[data-slot=document-records]')).toHaveCount(0);
      await expect(list.getByRole('link')).toHaveCount(0);
      await expect(list.locator('input[type=file]')).toHaveCount(0);
    });
  }
