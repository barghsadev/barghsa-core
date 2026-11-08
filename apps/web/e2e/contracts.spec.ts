import { contractReview } from './contract-review-fixture';
import { approveRiskConfirmation } from './confirmation-fixture';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { documentUploadPolicy } from '../src/test/document-list-fixtures.js';
import { test, expect } from './upload-fixture';
import { en, fa } from '../../../packages/i18n/src/contracts';
import { en as documentEn, fa as documentFa } from '../../../packages/i18n/src/documents';
const ID = '11111111-1111-4111-8111-111111111111',
  PROFILE = '22222222-2222-4222-8222-222222222222',
  VERSION = '33333333-3333-4333-8333-333333333333',
  DOCUMENT = '44444444-4444-4444-8444-444444444444';
for (const locale of ['en', 'fa'] as const)
  for (const staff of [false, true]) {
    test(`${locale}: ${staff ? 'staff publishes' : 'customer accepts and uploads'} the exact contract version`, async ({
      page,
      uploadReceiver,
    }) => {
      const words = locale === 'fa' ? fa : en,
        documentWords = locale === 'fa' ? documentFa : documentEn,
        confirm = locale === 'fa' ? 'تأیید' : 'Confirm';
      await page.addInitScript((language) => {
        localStorage.setItem('barghsa.locale', language);
        if (document.documentElement) document.documentElement.lang = language;
        new MutationObserver(() => {
          if (document.documentElement) document.documentElement.lang = language;
        }).observe(document, { childList: true });
      }, locale);
      await page.route('**/api/**', (route) => route.fulfill({ status: 404, json: {} }));
      await page.route('**/api/upload/policy/contract', (route) =>
        route.fulfill({ json: documentUploadPolicy('contract') })
      );
      await page.route('**/api/auth/user', (route) =>
        route.fulfill({
          json: {
            userId: 'contract-test-user',
            isStaff: staff,
            operatingContext: staff ? 'staff' : 'customer',
            canSwitchContext: staff,
            requiresTosAcceptance: false,
          },
        })
      );
      const base = staff ? '/api/admin/contracts' : '/api/contracts';
      await page.route(`**${base}/${ID}/activation?*`, (route) =>
        route.fulfill({
          json: { checks: [], isCurrent: true, ready: false, evaluatedAt: '2026-09-21T00:00:00Z' },
        })
      );
      let state = staff ? 'AwaitingStaffReview' : 'AwaitingCustomerAcceptance',
        verified = false;
      const version = {
        id: VERSION,
        versionNumber: 2,
        content: {
          price: '9007199254740993',
          text: 'Published terms',
          deliveryZone: 'Northern district',
        },
        changeDescription: 'Revised terms',
        createdAt: '2026-09-21T00:00:00Z',
        createdBy: 'legal-reviewer',
        acceptedAt: null as string | null,
      };
      const dto = () => ({
        id: ID,
        profileId: PROFILE,
        serviceType: 'electricity',
        state,
        ...(staff
          ? { currentVersionId: VERSION, currentVersion: version }
          : { version, canAccept: state === 'AwaitingCustomerAcceptance' }),
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
        route.fulfill({
          json: {
            contractId: ID,
            versionId: VERSION,
            state,
            isCurrent: true,
            isAmendment: false,
            canRequest: false,
            canRecord: false,
            request: null,
            signature: null,
          },
        })
      );
      let uploaded = false;
      const document = {
        id: DOCUMENT,
        profileId: PROFILE,
        businessRecordType: 'contract',
        businessRecordId: ID,
        contractVersionId: VERSION,
        contractRole: 'signed',
        category: 'contract',
        state: 'Available',
        originalName: 'signed.pdf',
        detectedMime: 'application/pdf',
        sizeBytes: 8,
        uploadedBy: 'customer',
        uploadedByType: 'customer',
        supersedesDocumentId: null,
        rejectionReason: null,
        reviewComment: null,
        revision: 3,
        checksum: 'a'.repeat(64),
        createdAt: '2026-09-21T00:00:00Z',
        updatedAt: '2026-09-21T00:00:00Z',
      };
      await page.route(`**/api/${staff ? 'admin/' : ''}documents?*`, (route) => {
        const params = new URL(route.request().url()).searchParams;
        expect(params.get('businessRecordId')).toBe(ID);
        expect(params.get('contractVersionId')).toBe(VERSION);
        expect(params.get('profileId')).toBe(PROFILE);
        return route.fulfill({ json: { documents: uploaded ? [document] : [], nextBefore: null } });
      });
      const originalReview = contractReview('acceptance');
      let financialReview = originalReview;
      await page.route(`**${base}/${ID}/acceptance-review?*`, (route) =>
        route.fulfill({ json: financialReview })
      );
      await page.route('**/api/user/settings/timezone', (route) =>
        route.fulfill({ json: { timezone: 'Asia/Tehran' } })
      );
      const attempts: unknown[] = [];
      let releaseReply = () => {};
      const heldReply = new Promise<void>((resolve) => (releaseReply = resolve));
      const recordedBeforeReply = staff && locale === 'en';
      const lostReply = locale === 'en';
      function record() {
        state = staff ? 'AwaitingCustomerAcceptance' : 'Accepted';
        if (!staff) version.acceptedAt = '2026-09-21T01:00:00Z';
      }
      await page.route(`**${base}/${ID}/${staff ? 'publish' : 'accept'}`, async (route) => {
        attempts.push(route.request().postDataJSON());
        if (!verified)
          return route.fulfill({ status: 403, json: { error: 'AUTHZ:STEP_UP_REQUIRED' } });
        if (attempts.length === 2) {
          if (recordedBeforeReply) record();
          if (lostReply) {
            await heldReply;
            return route.abort().catch(() => {});
          }
          return route.fulfill({
            json: {
              ...dto(),
              id: 'foreign-contract',
              ...(!staff ? { financialReview } : {}),
            },
          });
        }
        record();
        return route.fulfill({ json: { ...dto(), ...(!staff ? { financialReview } : {}) } });
      });
      await page.route('**/api/auth/step-up', (route) => {
        expect(route.request().postDataJSON()).toEqual({ password: 'Test-password' });
        verified = true;
        return route.fulfill({ json: { verified: true } });
      });
      await page.route('**/api/documents', (route) => {
        expect(route.request().postDataJSON()).toMatchObject({
          profileId: PROFILE,
          businessRecordType: 'contract',
          businessRecordId: ID,
          contractVersionId: VERSION,
          contractRole: 'signed',
          category: 'contract',
        });
        return route.fulfill({
          status: 201,
          json: {
            document: { ...document, state: 'Uploading', revision: 1 },
            upload: {
              presignedUrl: uploadReceiver.url,
              headers: { 'If-None-Match': '*' },
            },
          },
        });
      });
      await page.route(`**/api/documents/${DOCUMENT}/confirm`, (route) => {
        expect(uploadReceiver.uploads).toHaveLength(1);
        const upload = uploadReceiver.uploads[0]!;
        expect(upload.method).toBe('PUT');
        expect(upload.headers['x-csrf-token']).toBeUndefined();
        expect(upload.headers['if-none-match']).toBe('*');
        expect(upload.body.toString()).toBe('%PDF-1.7');
        expect(route.request().postDataJSON()).toMatchObject({ expectedRevision: 1 });
        uploaded = true;
        return route.fulfill({ json: document });
      });
      await page.goto(staff ? '/admin/contracts' : '/contracts');
      await page
        .getByRole('button', {
          name: `${words.electricity} · ${words.version} ${(2).toLocaleString(locale)}`,
          exact: true,
        })
        .click();
      const detail = page.getByRole('region', { name: words.terms, exact: true });
      await expect(detail.getByText('9007199254740993', { exact: true })).toBeVisible();
      await expect(detail.getByText('deliveryZone', { exact: true })).toBeVisible();
      await expect(detail.getByText('Northern district', { exact: true })).toBeVisible();
      if (!staff) {
        await expect(
          detail.getByRole('button', { name: words.accept, exact: true })
        ).toBeDisabled();
        const acknowledgement = detail.getByRole('checkbox', { name: words.acceptAcknowledgement });
        await expect(acknowledgement).toHaveAttribute('aria-required', 'true');
        await acknowledgement.check();
      }
      await detail
        .getByRole('button', { name: staff ? words.publish : words.accept, exact: true })
        .click();
      const dialog = page.getByRole('dialog');
      if (!staff) {
        await expect(dialog.getByRole('button', { name: confirm, exact: true })).toBeDisabled();
        await approveRiskConfirmation(page, locale, 'financial');
      }
      await dialog.getByRole('button', { name: confirm, exact: true }).click();
      await dialog
        .getByLabel(locale === 'fa' ? 'رمز عبور خود را تأیید کنید' : 'Confirm your password', {
          exact: true,
        })
        .fill('Test-password');
      if (lostReply) await page.clock.install();
      await dialog.getByRole('button', { name: confirm, exact: true }).click();
      try {
        await expect.poll(() => attempts.length).toBe(2);
        if (lostReply) await page.clock.runFor(15_100);
        await expect(dialog).toHaveCount(0);
        await expect(
          detail.getByText(confirmationText('unconfirmed', locale), { exact: true })
        ).toBeVisible();
      } finally {
        releaseReply();
      }
      expect(attempts).toHaveLength(2);
      expect(attempts[0]).toEqual(attempts[1]);
      if (!staff) expect(attempts[1]).toMatchObject({ expectedReviewHash: originalReview.hash });
      expect(attempts[1]).toMatchObject({
        expectedVersionId: VERSION,
        idempotencyKey: expect.any(String),
      });
      const action = detail.getByRole('button', {
        name: staff ? words.publish : words.accept,
        exact: true,
      });
      await expect(action).toBeDisabled();
      const check = detail.getByRole('button', {
        name: confirmationText('checkStatus', locale),
        exact: true,
      });
      await check.click();
      await expect(check).toHaveCount(0);
      expect(attempts).toHaveLength(2);
      if (!recordedBeforeReply) {
        if (!staff) {
          await detail.getByRole('checkbox', { name: words.acceptAcknowledgement }).check();
          if (locale === 'fa')
            financialReview = {
              ...originalReview,
              hash: 'd'.repeat(64),
              data: {
                ...originalReview.data,
                activation: { ...originalReview.data.activation, ruleRevision: 2 },
              },
            };
        }
        await action.click();
        if (!staff) await approveRiskConfirmation(page, locale, 'financial');
        await dialog.getByRole('button', { name: confirm, exact: true }).click();
        await expect(dialog).toHaveCount(0);
        expect(attempts).toHaveLength(3);
        if (!staff && locale === 'fa') {
          expect(attempts[2]).toMatchObject({ expectedReviewHash: financialReview.hash });
          expect((attempts[2] as { idempotencyKey: string }).idempotencyKey).not.toBe(
            (attempts[1] as { idempotencyKey: string }).idempotencyKey
          );
        } else expect(attempts[2]).toEqual(attempts[1]);
      }
      await expect(
        detail
          .getByText(staff ? words.AwaitingCustomerAcceptance : words.Accepted, { exact: true })
          .first()
      ).toBeVisible();
      if (!staff) {
        await detail.getByRole('button', { name: words.uploadSigned, exact: true }).click();
        const upload = detail.getByRole('region', { name: documentWords.upload, exact: true });
        const file = upload.getByLabel(documentWords.file, { exact: true });
        await expect(file).toBeEnabled();
        await file.setInputFiles({
          name: 'signed.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('%PDF-1.7'),
        });
        await upload.getByRole('button', { name: documentWords.upload, exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: confirm, exact: true }).click();
        await expect(detail.getByRole('button', { name: 'signed.pdf', exact: true })).toBeVisible();
      }
      await expect(
        page
          .locator('[dir]')
          .filter({
            has: page.getByRole('heading', {
              name: staff ? words.staffTitle : words.title,
              exact: true,
            }),
          })
          .last()
      ).toHaveAttribute('dir', locale === 'fa' ? 'rtl' : 'ltr');
    });
  }
