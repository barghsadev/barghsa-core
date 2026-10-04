import { test, expect } from './coverage-fixture';
import AxeBuilder from '@axe-core/playwright';
import { crmShell } from './crm-shell-fixture';
import { tSolar } from '@barghsa/i18n/solar';
import { t } from '@barghsa/i18n/app';
import {
  firstSolar,
  olderSolar,
  solarPostal,
  solarProfile,
  solarGuidance,
} from '../src/test/solar-staff-fixtures';
import { postalCalendarDate, type SolarPostalTracking } from '../src/lib/solar-postal-tracking';
import { trackingReview, trackingSnapshot } from './solar-operation-form-fixture';
const base = `/api/admin/solar/requests/${firstSolar}/postal/tracking`;
function detail(revision = 0): SolarPostalTracking {
  return {
    ...trackingSnapshot(),
    requestId: firstSolar,
    requestStatus: 'waiting_for_postal_submission',
    postalStatus: 'shipped',
    courier: 'Post',
    trackingNumber: 'TRACK-1',
    sendDate: '2026-09-23',
    estimatedArrivalDate: '2026-09-26',
    trackingUrl: 'https://courier.example.org/track/TRACK-1',
    note: 'Courier estimate; originals are awaiting staff confirmation.',
    revision,
    recordedAt: '2026-09-23T10:00:00.000Z',
    canEdit: true,
  };
}
async function setup(page: Parameters<typeof crmShell>[0], locale: 'en' | 'fa') {
  await crmShell(page, locale);
  await page.route('**/api/admin/solar/postal-guidance', (r) => r.fulfill({ json: solarGuidance }));
  await page.route('**/api/admin/solar/postal-queue?*', (r) =>
    r.fulfill({
      json: { requests: [{ ...solarPostal(), tracking_revision: 0 }], nextBefore: null },
    })
  );
}
for (const locale of ['en', 'fa'] as const) {
  const copy = (key: string) => tSolar(key, locale);
  test(`${locale}: staff reviews a public tracking update with step-up and exact retry, then the customer sees dated shipment information`, async ({
    page,
  }, info) => {
    await setup(page, locale);
    let revision = 0,
      needsStepUp = true,
      lost = true;
    let current = detail();
    const writes: Record<string, unknown>[] = [],
      previews: Record<string, unknown>[] = [];
    await page.route(
      (url) => url.pathname === base,
      async (r) => {
        if (r.request().method() === 'GET') return r.fulfill({ json: current });
        const body = r.request().postDataJSON() as Record<string, unknown>;
        writes.push(body);
        if (needsStepUp) return r.fulfill({ status: 403, json: { requiresStepUp: true } });
        if (!revision) {
          expect(body.expectedRevision).toBe(0);
          current = {
            ...current,
            estimatedArrivalDate: null,
            note: String(body.note),
            trackingUrl: String(body.trackingUrl),
            revision: ++revision,
          };
        } else expect(body).toEqual(writes[1]);
        if (lost) {
          lost = false;
          return r.fulfill({ status: 503, json: {} });
        }
        return r.fulfill({ json: current });
      }
    );
    await page.route(
      (url) => url.pathname === base + '/review',
      (r) => {
        const body = r.request().postDataJSON() as Record<string, unknown>;
        previews.push(body);
        return r.fulfill({
          json: trackingReview({ ...trackingSnapshot(), ...current }, body),
        });
      }
    );
    await page.route('**/api/auth/step-up', (r) => {
      expect(r.request().postDataJSON()).toEqual({ password: 'test-only-password' });
      needsStepUp = false;
      return r.fulfill({ json: { verified: true } });
    });
    await page.goto('/admin/solar-postal');
    await page.getByRole('button', { name: /First solar buyer/ }).click();
    const editor = page.getByRole('region', { name: copy('postalTrackingUpdate') }).first();
    await expect(editor.getByLabel(copy('postalTrackingNote'), { exact: true })).toBeVisible();
    await expect(editor).toContainText(postalCalendarDate('2026-09-26', locale)!);
    await editor.getByRole('button', { name: copy('postalClearEstimate'), exact: true }).click();
    const note = 'Updated <script> arrival note, visible to the customer.';
    await editor.getByLabel(copy('postalTrackingNote'), { exact: true }).fill(note);
    await editor
      .getByLabel(copy('postalTrackingUrl'), { exact: true })
      .fill('https://courier.example.org/track/TRACK-1');
    await editor.getByRole('button', { name: copy('postalTrackingReview'), exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(copy('postalTrackingReviewDescription'));
    await expect(dialog).toContainText(note);
    await expect(dialog).toContainText(copy('postalTrackingPrevious'));
    await expect(dialog).toContainText(postalCalendarDate('2026-09-26', locale)!);
    await dialog.getByRole('button', { name: t('team.confirm', locale), exact: true }).click();
    await dialog.getByLabel(t('team.password', locale), { exact: true }).fill('test-only-password');
    await dialog.getByRole('button', { name: t('team.confirm', locale), exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await dialog.getByRole('button', { name: t('team.confirm', locale), exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(previews).toHaveLength(1);
    expect(writes).toHaveLength(3);
    expect(writes[0]).toEqual(writes[1]);
    expect(writes[1]).toEqual(writes[2]);
    await expect(editor).toContainText(copy('postalNoEstimate'));
    await expect(editor.locator('script,img')).toHaveCount(0);
    expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
    await page.route('**/api/auth/user', (r) =>
      r.fulfill({
        json: {
          userId: 'buyer',
          isStaff: false,
          operatingContext: 'customer',
          requiresTosAcceptance: false,
        },
      })
    );
    await page.route('**/api/profiles', (r) =>
      r.fulfill({
        json: {
          profiles: [{ id: solarProfile, profileType: 'INDIVIDUAL', title: 'Solar buyer' }],
          activeProfileId: solarProfile,
          hasDefault: true,
        },
      })
    );
    await page.route(`**/api/solar/requests/${firstSolar}`, (r) =>
      r.fulfill({
        json: {
          request: {
            ...solarPostal(),
            status: 'waiting_for_postal_submission',
            building_type: 'building_apartment',
            grid_type: 'off_grid',
            property_form: 'villa',
            structural_frame: 'concrete',
            building_completion_date: '2020-01-01',
            agreement_snapshot: 'Accepted solar terms',
            agreement_version: '2026-09',
            agreement_accepted_at: '2026-09-23T10:00:00.000Z',
            submitted_at: '2026-09-23T10:00:00.000Z',
            contract_id: null,
            initial_invoice_id: null,
            status_reason: null,
            support_path: null,
          },
        },
      })
    );
    await page.route(`**/api/solar/requests/${firstSolar}/documents`, (r) =>
      r.fulfill({ json: { guidance: solarGuidance, requestedDocuments: [] } })
    );
    await page.route('**/api/documents?*', (r) =>
      r.fulfill({ json: { documents: [], nextBefore: null } })
    );
    await page.route(`**/api/solar/requests/${firstSolar}/postal`, (r) =>
      r.fulfill({
        json: {
          requestStatus: current.requestStatus,
          guidance: solarGuidance,
          postal: {
            status: 'shipped',
            courier: current.courier,
            tracking_number: current.trackingNumber,
            send_date: current.sendDate,
            receipt_image_id: null,
            staff_notes: null,
            estimated_arrival_date: '2026-09-26',
            tracking_url: current.trackingUrl,
            tracking_note: current.note,
            tracking_recorded_at: current.recordedAt,
          },
        },
      })
    );
    await page.goto(`/solar/requests/${firstSolar}`);
    const postal = page.getByRole('region', { name: copy('postalStage'), exact: true });
    await expect(postal).toContainText(note);
    await expect(postal).toContainText(postalCalendarDate('2026-09-26', locale)!);
    await expect(postal).toContainText(postalCalendarDate('2026-09-23', locale)!);
    await expect(postal).toContainText(copy('postalEstimateHelp'));
    await expect(postal.locator('form')).toHaveCount(0);
    await expect(postal.locator('script,img')).toHaveCount(0);
    const link = postal.getByRole('link', { name: new RegExp(copy('postalTrackingLink')) });
    await expect(link).toHaveAttribute('href', current.trackingUrl!);
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    await postal.screenshot({ path: info.outputPath(`postal-tracking-${locale}.png`) });
  });
  test(`${locale}: failed tracking reads recover and lost read authority clears the selected customer`, async ({
    page,
  }) => {
    await setup(page, locale);
    let failure: 403 | 503 | null = null;
    await page.route(
      (url) => url.pathname === base,
      (r) =>
        r.fulfill(
          failure ? { status: failure, json: {} } : { json: { ...detail(), canEdit: false } }
        )
    );
    await page.goto('/admin/solar-postal');
    await page.getByRole('button', { name: /First solar buyer/ }).click();
    const editor = page.getByRole('region', { name: copy('postalTrackingUpdate') }).first();
    await expect(editor).toContainText(postalCalendarDate('2026-09-26', locale)!);
    await expect(editor.locator('form')).toHaveCount(0);
    failure = 503;
    await editor.getByRole('button', { name: copy('postalTrackingReload'), exact: true }).click();
    await expect(editor.getByRole('alert')).toBeVisible();
    await expect(editor).not.toContainText('TRACK-1');
    failure = null;
    await editor.getByRole('button', { name: copy('postalTrackingReload'), exact: true }).click();
    await expect(editor).toContainText('TRACK-1');
    await expect(editor.getByRole('alert')).toHaveCount(0);
    await expect(editor.locator('form')).toHaveCount(0);
    failure = 403;
    await editor.getByRole('button', { name: copy('postalTrackingReload'), exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(page.getByRole('button', { name: /First solar buyer/ })).toHaveCount(0);
    await expect(page.locator('#admin-content')).not.toContainText('TRACK-1');
  });

  test(`${locale}: a late tracking review cannot reopen after selecting another shipment`, async ({
    page,
  }) => {
    await setup(page, locale);
    await page.route('**/api/admin/solar/postal-queue?*', (r) =>
      r.fulfill({
        json: {
          requests: [
            { ...solarPostal(), tracking_revision: 0 },
            { ...solarPostal(olderSolar), tracking_revision: 0 },
          ],
          nextBefore: null,
        },
      })
    );
    await page.route(
      (url) => url.pathname === base,
      (r) => r.fulfill({ json: detail() })
    );
    await page.route(
      (url) => url.pathname === `/api/admin/solar/requests/${olderSolar}/postal/tracking`,
      (r) =>
        r.fulfill({
          json: {
            ...detail(),
            requestId: olderSolar,
            trackingNumber: 'OTHER-PARCEL',
            note: 'Other parcel note',
          },
        })
    );
    let releasePreview!: () => void;
    const held = new Promise<void>((resolve) => {
      releasePreview = resolve;
    });
    let reviewing = false;
    await page.route(
      (url) => url.pathname === base + '/review',
      async (r) => {
        reviewing = true;
        const body = r.request().postDataJSON();
        await held;
        await r.fulfill({
          json: trackingReview({ ...trackingSnapshot(), ...detail() }, body),
        });
      }
    );
    await page.goto('/admin/solar-postal');
    await page.getByRole('button', { name: /First solar buyer/ }).click();
    await page.getByLabel(copy('postalTrackingNote'), { exact: true }).fill('Obsolete proposal');
    await page.getByRole('button', { name: copy('postalTrackingReview'), exact: true }).click();
    await expect.poll(() => reviewing).toBe(true);
    await page.getByRole('button', { name: /Older solar buyer/ }).click();
    await expect(page.getByLabel(copy('postalTrackingNote'), { exact: true })).toHaveValue(
      'Other parcel note'
    );
    const resolved = page.waitForResponse((r) => new URL(r.url()).pathname === base + '/review');
    releasePreview();
    await resolved;
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByLabel(copy('postalTrackingNote'), { exact: true })).toHaveValue(
      'Other parcel note'
    );
  });
}
