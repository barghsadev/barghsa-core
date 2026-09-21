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
      const attempts: unknown[] = [];
      await page.route(`**${base}/${ID}/${staff ? 'publish' : 'accept'}`, (route) => {
        attempts.push(route.request().postDataJSON());
        if (!verified)
          return route.fulfill({ status: 403, json: { error: 'AUTHZ:STEP_UP_REQUIRED' } });
        state = staff ? 'AwaitingCustomerAcceptance' : 'Accepted';
        if (!staff) version.acceptedAt = '2026-09-21T01:00:00Z';
        return route.fulfill({ json: dto() });
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
        await detail.getByRole('checkbox', { name: words.acceptAcknowledgement }).check();
      }
      await detail
        .getByRole('button', { name: staff ? words.publish : words.accept, exact: true })
        .click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: confirm, exact: true }).click();
      await dialog
        .getByLabel(locale === 'fa' ? 'رمز عبور خود را تأیید کنید' : 'Confirm your password', {
          exact: true,
        })
        .fill('Test-password');
      await dialog.getByRole('button', { name: confirm, exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect(attempts).toHaveLength(2);
      expect(attempts[0]).toEqual(attempts[1]);
      expect(attempts[1]).toMatchObject({
        expectedVersionId: VERSION,
        idempotencyKey: expect.any(String),
      });
      await expect(
        detail
          .getByText(staff ? words.AwaitingCustomerAcceptance : words.Accepted, { exact: true })
          .first()
      ).toBeVisible();
      if (!staff) {
        await detail.getByRole('button', { name: words.uploadSigned, exact: true }).click();
        const upload = detail.getByRole('region', { name: documentWords.upload, exact: true });
        await upload.getByLabel(documentWords.file, { exact: true }).setInputFiles({
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
