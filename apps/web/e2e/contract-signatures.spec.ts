import { contractReview, ORIGINAL, SIGNED, REQUEST } from './contract-review-fixture';
import { test, expect } from './coverage-fixture';
import { en, fa } from '../../../packages/i18n/src/contracts';
import { t } from '../../../packages/i18n/src/app';
const ID = '11111111-1111-4111-8111-111111111111',
  PROFILE = '22222222-2222-4222-8222-222222222222',
  VERSION = '33333333-3333-4333-8333-333333333333';
for (const locale of ['en', 'fa'] as const)
  for (const staff of [false, true]) {
    test(`${locale}: ${staff ? 'staff prepares and records' : 'customer records'} approved signed-copy evidence`, async ({
      page,
    }) => {
      const words = locale === 'fa' ? fa : en;
      await page.addInitScript((language) => {
        if (document.documentElement) document.documentElement.lang = language;
        new MutationObserver(() => {
          if (document.documentElement) document.documentElement.lang = language;
        }).observe(document, { childList: true });
      }, locale);
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      const base = staff ? '/api/admin/contracts' : '/api/contracts';
      await page.route(`**${base}/${ID}/activation?*`, (route) =>
        route.fulfill({
          json: { checks: [], isCurrent: true, ready: false, evaluatedAt: '2026-09-21T00:00:00Z' },
        })
      );
      let state = staff ? 'Accepted' : 'AwaitingSignature',
        requested = !staff,
        recorded = false,
        verified = false;
      const version = {
        id: VERSION,
        versionNumber: 2,
        content: { text: 'Accepted terms' },
        changeDescription: 'Accepted terms',
        createdAt: '2026-09-21T00:00:00Z',
        acceptedAt: '2026-09-21T00:01:00Z',
      };
      const dto = () => ({
        id: ID,
        profileId: PROFILE,
        serviceType: 'electricity',
        state,
        ...(staff
          ? { currentVersionId: VERSION, currentVersion: version }
          : { version, canAccept: false }),
      });
      const signature = () => ({
        contractId: ID,
        versionId: VERSION,
        state,
        isCurrent: true,
        canRequest: staff && !recorded,
        canRecord: requested && !recorded,
        request: requested
          ? {
              id: REQUEST,
              requestNumber: 1,
              originalDocumentId: ORIGINAL,
              originalName: 'original.pdf',
              documentState: 'Approved',
              requestedAt: '2026-09-21T00:02:00Z',
            }
          : null,
        signature: recorded
          ? {
              requestId: REQUEST,
              signedDocumentId: SIGNED,
              originalName: 'signed.pdf',
              documentState: 'Approved',
              recordedByType: staff ? 'staff' : 'customer',
              uploadedByType: 'customer',
              recordedAt: '2026-09-21T00:03:00Z',
            }
          : null,
      });
      await page.route(`**${base}?*`, (route) =>
        route.fulfill({
          json: {
            contracts: [
              { id: ID, serviceType: 'electricity', state, versionId: VERSION, versionNumber: 2 },
            ],
            nextBefore: null,
          },
        })
      );
      await page.route(`**${base}/${ID}`, (route) => route.fulfill({ json: dto() }));
      await page.route(`**${base}/${ID}/versions`, (route) =>
        route.fulfill({ json: { versions: [version], nextBefore: null } })
      );
      await page.route(`**${base}/${ID}/signature?*`, (route) =>
        route.fulfill({ json: signature() })
      );
      await page.route(`**/api/${staff ? 'admin/' : ''}documents?*`, (route) => {
        const query = new URL(route.request().url()).searchParams;
        expect(query.get('contractVersionId')).toBe(VERSION);
        const documents = ['original', 'signed'].map((id) => ({
          id: id === 'original' ? ORIGINAL : SIGNED,
          profileId: PROFILE,
          businessRecordType: 'contract',
          businessRecordId: ID,
          contractVersionId: VERSION,
          contractRole: id,
          state: 'Approved',
          category: 'contract',
          originalName: id + '.pdf',
          detectedMime: 'application/pdf',
          sizeBytes: 8,
          revision: 4,
          uploadedByType: 'customer',
          createdAt: '2026-09-21T00:00:00Z',
        }));
        return route.fulfill({ json: { documents, nextBefore: null } });
      });
      let financialReview = contractReview('request');
      await page.route(`**${base}/${ID}/signature/review`, (route) => {
        const input = route.request().postDataJSON();
        financialReview = contractReview(input.action, requested);
        return route.fulfill({ json: financialReview });
      });
      await page.route('**/api/user/settings/timezone', (route) =>
        route.fulfill({ json: { timezone: 'Asia/Tehran' } })
      );
      const attempts: unknown[] = [];
      await page.route(`**${base}/${ID}/signature-request`, (route) => {
        expect(route.request().postDataJSON()).toMatchObject({
          expectedVersionId: VERSION,
          expectedRequestId: null,
          originalDocumentId: ORIGINAL,
          idempotencyKey: expect.any(String),
        });
        requested = true;
        state = 'AwaitingSignature';
        return route.fulfill({ json: { ...signature(), financialReview } });
      });
      await page.route(`**${base}/${ID}/signature`, (route) => {
        attempts.push(route.request().postDataJSON());
        if (!verified)
          return route.fulfill({ status: 403, json: { error: 'AUTHZ:STEP_UP_REQUIRED' } });
        recorded = true;
        state = 'Signed';
        return route.fulfill({ json: { ...signature(), financialReview } });
      });
      await page.route('**/api/auth/step-up', (route) => {
        verified = true;
        return route.fulfill({ json: { verified: true } });
      });
      await page.goto(staff ? '/admin/contracts' : '/contracts');
      await page
        .getByRole('button', {
          name: `${words.electricity} \u00b7 ${words.version} ${(2).toLocaleString(locale)}`,
          exact: true,
        })
        .click();
      const panel = page.getByRole('region', { name: words.signatureTitle, exact: true });
      const dialog = page.getByRole('dialog');
      const confirm = t('team.confirm', locale);
      if (staff) {
        await panel.getByLabel(words.approvedOriginal, { exact: true }).selectOption(ORIGINAL);
        await panel.getByRole('button', { name: words.prepareSignature, exact: true }).click();
        await dialog.getByRole('button', { name: confirm, exact: true }).click();
        await expect(dialog).toHaveCount(0);
      }
      await expect(panel.getByText('original.pdf', { exact: false }).first()).toBeVisible();
      await panel.getByLabel(words.approvedSigned, { exact: true }).selectOption(SIGNED);
      await expect(
        panel.getByRole('button', { name: words.recordSignature, exact: true })
      ).toBeDisabled();
      await panel.getByRole('checkbox', { name: words.signatureAcknowledgement }).check();
      await panel.getByRole('button', { name: words.recordSignature, exact: true }).click();
      await dialog.getByRole('button', { name: confirm, exact: true }).click();
      await dialog.locator('input[type=password]').fill('Test-password');
      await dialog.getByRole('button', { name: confirm, exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect(attempts).toHaveLength(2);
      expect(attempts[0]).toEqual(attempts[1]);
      expect(attempts[1]).toMatchObject({ expectedReviewHash: financialReview.hash });
      expect(attempts[1]).toMatchObject({
        expectedVersionId: VERSION,
        requestId: REQUEST,
        signedDocumentId: SIGNED,
        idempotencyKey: expect.any(String),
      });
      await expect(panel.getByRole('status')).toContainText(words.signatureRecorded);
      await expect(panel.getByRole('status')).toContainText(
        `${words.recordedBy}: ${staff ? words.staff : words.customer}`
      );
      await expect(panel.getByRole('status')).toContainText(
        `${words.uploadedBy}: ${words.customer}`
      );
      await expect(panel.getByRole('combobox')).toHaveCount(0);
      await expect(page.getByRole('button', { name: words.uploadSigned, exact: true })).toHaveCount(
        0
      );
    });
  }
