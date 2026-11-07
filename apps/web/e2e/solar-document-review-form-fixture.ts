import type { Page, Route } from '@playwright/test';
import { ErrorCodes } from '@barghsa/shared/errors';
import { setupCatalogueForms } from './catalogue-form-fixture';
import {
  firstSolar,
  olderSolar,
  solarDocuments,
  solarFile,
  solarProfile,
  solarRequest,
} from '../src/test/solar-staff-fixtures';

export async function setupSolarDocumentForms(page: Page, locale: 'en' | 'fa', dark: boolean) {
  await setupCatalogueForms(page, locale, dark);
  const state = {
    guidance: {
      fa: 'راهنمای معتبر',
      en: 'Verified guidance',
      suggestions: [] as Array<{ fa: string; en: string }>,
    },
    guidanceMode: 'success' as 'success' | 'owned' | 'unsafe' | 'malformed' | 'mismatch' | 'denied',
    guidanceReadMode: 'success' as 'success' | 'unavailable',
    rejectMode: 'owned' as 'owned' | 'protected' | 'success' | 'denied',
    additionalMode: 'success' as 'success' | 'mismatch',
    detailMode: 'success' as 'success' | 'wrong-request',
    previewMode: 'success' as 'success' | 'owned' | 'held' | 'denied' | 'mismatch',
    verified: false,
    stepUp: undefined as Route | undefined,
    preview: undefined as Route | undefined,
    guidanceWrites: [] as Array<Record<string, unknown>>,
    rejectWrites: [] as Array<Record<string, unknown>>,
    previews: [] as Array<Record<string, unknown>>,
    additionalWrites: [] as Array<Record<string, unknown>>,
    detailReads: [] as string[],
    guidanceReads: 0,
    verifications: 0,
    rejected: false,
    requestStatus: 'documents_under_review',
    requestedDocuments: [] as Array<{ id: string; description: string }>,
  };
  const invalid = (route: Route, fields: string[]) =>
    route.fulfill({
      status: 400,
      json: { error: { code: ErrorCodes.VALIDATION_INPUT_INVALID.code, fields } },
    });
  await page.route('**/api/admin/solar/document-guidance', async (route) => {
    if (route.request().method() === 'GET') {
      state.guidanceReads++;
      return state.guidanceReadMode === 'unavailable'
        ? route.fulfill({ status: 503, json: {} })
        : route.fulfill({ json: state.guidance });
    }
    const body = route.request().postDataJSON() as typeof state.guidance;
    state.guidanceWrites.push(body);
    if (state.guidanceMode === 'owned') return invalid(route, ['suggestionsEn']);
    if (state.guidanceMode === 'unsafe') return invalid(route, ['en', 'PRIVATE_HASH_FIELD']);
    if (state.guidanceMode === 'denied') return route.fulfill({ status: 403, json: {} });
    state.guidance = body;
    return route.fulfill({
      json:
        state.guidanceMode === 'malformed'
          ? { saved: true }
          : state.guidanceMode === 'mismatch'
            ? { ...body, en: 'Different server receipt' }
            : body,
    });
  });
  await page.route('**/api/admin/solar/requests', (route) =>
    route.fulfill({
      json: { requests: [solarRequest(), solarRequest(olderSolar)], nextBefore: null },
    })
  );
  await page.route('**/api/admin/solar/document-review-queue', (route) =>
    route.fulfill({
      json: { documents: [solarFile()], nextBefore: null },
    })
  );
  for (const id of [firstSolar, olderSolar])
    await page.route(`**/api/admin/solar/requests/${id}/documents`, (route) => {
      state.detailReads.push(id);
      if (id === firstSolar && state.detailMode === 'wrong-request')
        return route.fulfill({ json: solarDocuments(olderSolar) });
      const detail = solarDocuments(id);
      if (id === firstSolar) {
        detail.request.status = state.requestStatus;
        detail.documents[0]!.revision = state.rejected ? 8 : 7;
        if (state.rejected) {
          detail.documents[0]!.staff_status = 'rejected';
          detail.documents[0]!.state = 'Rejected';
        }
      }
      return route.fulfill({
        json: {
          ...detail,
          requestedDocuments: id === firstSolar ? state.requestedDocuments : [],
        },
      });
    });
  await page.route(
    `**/api/admin/solar/requests/${firstSolar}/documents/${firstSolar}/reject`,
    (route) => {
      const body = route.request().postDataJSON();
      state.rejectWrites.push(body);
      if (state.rejectMode === 'owned') return invalid(route, ['reason']);
      if (state.rejectMode === 'denied') return route.fulfill({ status: 403, json: {} });
      if (state.rejectMode === 'protected' && !state.verified)
        return route.fulfill({ status: 403, json: { requiresStepUp: true } });
      state.rejected = true;
      return route.fulfill({
        json: {
          id: firstSolar,
          profileId: solarProfile,
          businessRecordType: 'solar_request',
          businessRecordId: firstSolar,
          state: 'Rejected',
          revision: 8,
          rejectionReason: body.reason,
        },
      });
    }
  );
  await page.route('**/api/auth/step-up', (route) => {
    state.verifications++;
    state.stepUp = route;
  });
  const reviewFor = (body: Record<string, unknown>) => ({
    hash: 'a'.repeat(64),
    scope: {
      action: 'solar.documents.request_additional',
      profileId: solarProfile,
      resourceId: firstSolar,
    },
    data: {
      requestId: firstSolar,
      currentStatus: state.requestStatus,
      documents: [
        {
          documentId: firstSolar,
          fileName: 'first.pdf',
          staffStatus: state.rejected ? 'rejected' : 'pending',
          state: state.rejected ? 'Rejected' : 'SubmittedForReview',
          revision: state.rejected ? 8 : 7,
          supersedesDocumentId: null,
        },
      ],
      existingRequests: state.requestedDocuments,
      decision: body.decision,
      description: body.description,
      nextStatus: 'changes_requested',
      createsContract: false,
      createsInvoice: false,
    },
  });
  await page.route(
    `**/api/admin/solar/requests/${firstSolar}/documents/review-set-decision`,
    (route) => {
      const body = route.request().postDataJSON();
      state.previews.push(body);
      if (state.previewMode === 'owned') return invalid(route, ['description']);
      if (state.previewMode === 'denied') return route.fulfill({ status: 403, json: {} });
      if (state.previewMode === 'held') {
        state.preview = route;
        return;
      }
      return route.fulfill({
        json: reviewFor(
          state.previewMode === 'mismatch'
            ? { ...body, description: 'Different instruction' }
            : body
        ),
      });
    }
  );
  await page.route(
    `**/api/admin/solar/requests/${firstSolar}/documents/request-additional`,
    (route) => {
      const body = route.request().postDataJSON();
      state.additionalWrites.push(body);
      state.requestStatus = 'changes_requested';
      state.requestedDocuments.push({
        id: `additional-${state.additionalWrites.length}`,
        description: body.description,
      });
      return route.fulfill({
        json:
          state.additionalMode === 'mismatch'
            ? { status: 'documents_under_review', message: 'PRIVATE_BAD_RECEIPT' }
            : { status: state.requestStatus },
      });
    }
  );
  return { state, reviewFor, firstSolar, olderSolar };
}
