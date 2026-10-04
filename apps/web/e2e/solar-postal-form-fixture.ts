import type { Page, Route } from '@playwright/test';
import { ErrorCodes } from '@barghsa/shared/errors';
import { fullNavigation } from './navigation-fixture';
import { setupCatalogueForms } from './catalogue-form-fixture';
import {
  firstSolar,
  olderSolar,
  solarPostal,
  solarProfile,
} from '../src/test/solar-staff-fixtures';

export const postalReceipt = '84000000-0000-4000-8000-000000000004';
export const postalGuidance = {
  fa: 'راهنمای ارسال اصل مدارک',
  en: 'Original postal guidance',
  destinationAddress: 'Solar Street',
  contactDetails: 'Staff contact',
  originals: [] as Array<{ fa: string; en: string }>,
};
type Shipment = {
  courier: string;
  trackingNumber: string;
  sendDate: string;
  receiptImageId?: string;
};
function parcel() {
  return {
    status: 'waiting_for_shipment',
    courier: null as string | null,
    tracking_number: null as string | null,
    send_date: null as string | null,
    receipt_image_id: null as string | null,
    staff_notes: null,
  };
}
const invalid = (route: Route, fields: string[]) =>
  route.fulfill({
    status: 400,
    json: { error: { code: ErrorCodes.VALIDATION_INPUT_INVALID.code, fields } },
  });

export async function setupSolarPostalForms(
  page: Page,
  locale: 'en' | 'fa',
  dark: boolean,
  customer = false
) {
  await setupCatalogueForms(page, locale, dark);
  const state = {
    customerReadMode: 'success' as 'success' | 'mismatch' | 'denied' | 'held',
    shipmentMode: 'owned' as 'owned' | 'held' | 'success' | 'denied',
    guidanceMode: 'owned' as 'owned' | 'unsafe' | 'success' | 'mismatch' | 'denied',
    guidanceReadMode: 'success' as 'success' | 'unavailable',
    postalPreviewMode: 'owned' as 'owned' | 'success',
    finalPreviewMode: 'held' as 'held' | 'success',
    verified: false,
    shipment: undefined as Route | undefined,
    customerRead: undefined as Route | undefined,
    finalPreview: undefined as Route | undefined,
    stepUp: undefined as Route | undefined,
    shipmentWrites: [] as Shipment[],
    customerReads: [] as string[],
    guidanceWrites: [] as Array<typeof postalGuidance>,
    postalPreviews: [] as Array<Record<string, unknown>>,
    postalWrites: [] as Array<Record<string, unknown>>,
    finalPreviews: [] as Array<Record<string, unknown>>,
    finalWrites: [] as Array<Record<string, unknown>>,
    guidanceReads: 0,
    queueReads: 0,
    verifications: 0,
    firstPostalStatus: 'shipped',
    finalClosed: false,
    guidance: structuredClone(postalGuidance),
    parcels: { [firstSolar]: parcel(), [olderSolar]: parcel() },
  };
  if (customer)
    await page.route('**/api/auth/user', (route) =>
      route.fulfill({
        json: {
          userId: 'buyer',
          isStaff: false,
          operatingContext: 'customer',
          requiresTosAcceptance: false,
          navigation: fullNavigation('customer'),
        },
      })
    );
  await page.route('**/api/profiles', (route) =>
    route.fulfill({
      json: {
        profiles: [{ id: solarProfile, profileType: 'INDIVIDUAL', title: 'Solar buyer' }],
        activeProfileId: solarProfile,
        hasDefault: true,
      },
    })
  );
  await page.route('**/api/profiles/verification-status', (route) =>
    route.fulfill({
      json: {
        activeProfileId: solarProfile,
        profileStatus: 'ACTIVE',
        verificationRequired: true,
        isVerified: true,
      },
    })
  );
  await page.route('**/api/documents?*', (route) => {
    const id = new URL(route.request().url()).searchParams.get('businessRecordId');
    return route.fulfill({
      json: {
        documents: [
          {
            id: postalReceipt,
            profileId: solarProfile,
            businessRecordType: 'solar_request',
            businessRecordId: id,
            category: 'image',
            originalName: 'postal-receipt.png',
            detectedMime: 'image/png',
            state: 'Available',
            uploadedBy: 'buyer',
            uploadedByType: 'customer',
            revision: 1,
            sizeBytes: 8,
            createdAt: '2026-09-23T10:00:00.000Z',
            updatedAt: '2026-09-23T10:00:00.000Z',
          },
        ],
        nextBefore: null,
      },
    });
  });
  const customerState = (id: string) => ({
    requestStatus: 'waiting_for_postal_submission',
    guidance: state.guidance,
    postal: state.parcels[id]!,
  });
  const persistShipment = (id = firstSolar) => {
    const body = state.shipmentWrites.at(-1)!;
    state.parcels[id] = {
      ...parcel(),
      status: 'shipped',
      courier: body.courier,
      tracking_number: body.trackingNumber,
      send_date: body.sendDate,
      receipt_image_id: body.receiptImageId ?? null,
    };
  };
  for (const id of [firstSolar, olderSolar]) {
    await page.route(`**/api/solar/requests/${id}`, (route) =>
      route.fulfill({
        json: {
          request: {
            ...solarPostal(id),
            status: 'waiting_for_postal_submission',
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
    await page.route(`**/api/solar/requests/${id}/documents`, (route) =>
      route.fulfill({
        json: { guidance: { ...state.guidance, suggestions: [] }, requestedDocuments: [] },
      })
    );
    await page.route(`**/api/solar/requests/${id}/postal`, (route) => {
      state.customerReads.push(id);
      if (state.customerReadMode === 'held') {
        state.customerRead = route;
        return;
      }
      if (state.customerReadMode === 'denied') return route.fulfill({ status: 403, json: {} });
      const value = customerState(id);
      return route.fulfill({
        json:
          state.customerReadMode === 'mismatch'
            ? {
                ...value,
                postal: { ...value.postal, tracking_number: 'Different tracking receipt' },
              }
            : value,
      });
    });
    await page.route(`**/api/solar/requests/${id}/postal/shipment`, (route) => {
      state.shipmentWrites.push(route.request().postDataJSON());
      if (state.shipmentMode === 'owned') return invalid(route, ['trackingNumber']);
      if (state.shipmentMode === 'denied') return route.fulfill({ status: 403, json: {} });
      if (state.shipmentMode === 'held') {
        state.shipment = route;
        return;
      }
      persistShipment(id);
      return route.fulfill({ json: { status: 'shipped' } });
    });
  }
  await page.route('**/api/admin/solar/postal-guidance', (route) => {
    if (route.request().method() === 'GET') {
      state.guidanceReads++;
      return state.guidanceReadMode === 'unavailable'
        ? route.fulfill({ status: 503, json: {} })
        : route.fulfill({ json: state.guidance });
    }
    const body = route.request().postDataJSON();
    state.guidanceWrites.push(body);
    if (state.guidanceMode === 'owned') return invalid(route, ['originalsEn']);
    if (state.guidanceMode === 'unsafe')
      return invalid(route, ['originalsEn', 'PRIVATE_REVIEW_HASH']);
    if (state.guidanceMode === 'denied') return route.fulfill({ status: 403, json: {} });
    state.guidance = body;
    return route.fulfill({
      json:
        state.guidanceMode === 'mismatch' ? { ...body, contactDetails: 'Different receipt' } : body,
    });
  });
  await page.route('**/api/admin/solar/postal-queue?*', (route) => {
    state.queueReads++;
    return route.fulfill({
      json: {
        requests: [
          { ...solarPostal(), postal_status: state.firstPostalStatus },
          ...(!state.finalClosed
            ? [
                {
                  ...solarPostal(olderSolar),
                  request_status: 'final_review',
                  postal_status: 'received',
                },
              ]
            : []),
        ],
        nextBefore: null,
      },
    });
  });
  const postalReview = (body: Record<string, unknown>) => ({
    hash: 'a'.repeat(64),
    scope: {
      action: `solar.postal.${body.decision}`,
      profileId: solarProfile,
      resourceId: firstSolar,
    },
    data: {
      requestId: firstSolar,
      currentRequestStatus: 'waiting_for_postal_submission',
      currentPostalStatus: 'shipped',
      courier: 'Post',
      trackingNumber: 'TRACK-1',
      sendDate: '2026-09-23',
      receiptImageId: null,
      decision: body.decision,
      reason: body.reason ?? null,
      postalOutcome: body.decision,
      requestOutcome:
        body.decision === 'received'
          ? 'postal_documents_received'
          : 'waiting_for_postal_submission',
      createsContract: false,
      createsInvoice: false,
    },
  });
  await page.route(`**/api/admin/solar/requests/${firstSolar}/postal/review`, (route) => {
    const body = route.request().postDataJSON();
    state.postalPreviews.push(body);
    return state.postalPreviewMode === 'owned'
      ? invalid(route, ['reason'])
      : route.fulfill({ json: postalReview(body) });
  });
  await page.route(`**/api/admin/solar/requests/${firstSolar}/postal/mark-incomplete`, (route) => {
    state.postalWrites.push(route.request().postDataJSON());
    if (!state.verified) return route.fulfill({ status: 403, json: { requiresStepUp: true } });
    state.firstPostalStatus = 'incomplete';
    return route.fulfill({
      json: { status: 'incomplete', requestStatus: 'waiting_for_postal_submission' },
    });
  });
  const finalReview = (body: Record<string, unknown>) => ({
    hash: 'b'.repeat(64),
    scope: {
      action: `solar.final.${body.decision}`,
      profileId: solarProfile,
      resourceId: olderSolar,
    },
    data: {
      requestId: olderSolar,
      currentStatus: 'final_review',
      postalStatus: 'received',
      trackingNumber: 'TRACK-1',
      contractId: null,
      decision: body.decision,
      reason: body.reason ?? null,
      outcome:
        body.decision === 'reject'
          ? 'rejected'
          : body.decision === 'approve'
            ? 'approved'
            : 'cancelled',
      createsContract: false,
      createsInvoice: false,
      supportPath: '/tickets',
    },
  });
  await page.route(`**/api/admin/solar/requests/${olderSolar}/final-decision/review`, (route) => {
    const body = route.request().postDataJSON();
    state.finalPreviews.push(body);
    if (state.finalPreviewMode === 'held') {
      state.finalPreview = route;
      return;
    }
    return route.fulfill({ json: finalReview(body) });
  });
  await page.route(`**/api/admin/solar/requests/${olderSolar}/close-no-contract`, (route) => {
    state.finalWrites.push(route.request().postDataJSON());
    state.finalClosed = true;
    return route.fulfill({ json: { status: 'cancelled' } });
  });
  await page.route('**/api/auth/step-up', (route) => {
    state.verifications++;
    state.stepUp = route;
  });
  return { state, persistShipment, customerState, finalReview, firstSolar, olderSolar };
}
