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
    previewMode: 'success' as 'success' | 'owned' | 'held' | 'denied',
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
      const detail = solarDocuments(id);
      if (id === firstSolar) {
        detail.documents[0]!.revision = state.rejected ? 8 : 7;
        if (state.rejected) {
          detail.documents[0]!.staff_status = 'rejected';
          detail.documents[0]!.state = 'Rejected';
        }
      }
      return route.fulfill({ json: detail });
    });
  await page.route(
    `**/api/admin/solar/requests/${firstSolar}/documents/${firstSolar}/reject`,
    (route) => {
      state.rejectWrites.push(route.request().postDataJSON());
      if (state.rejectMode === 'owned') return invalid(route, ['reason']);
      if (state.rejectMode === 'denied') return route.fulfill({ status: 403, json: {} });
      if (state.rejectMode === 'protected' && !state.verified)
        return route.fulfill({ status: 403, json: { requiresStepUp: true } });
      state.rejected = true;
      return route.fulfill({ json: { id: firstSolar, state: 'Rejected', revision: 8 } });
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
      currentStatus: 'documents_under_review',
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
      existingRequests: [],
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
      return route.fulfill({ json: reviewFor(body) });
    }
  );
  await page.route(
    `**/api/admin/solar/requests/${firstSolar}/documents/request-additional`,
    (route) => {
      state.additionalWrites.push(route.request().postDataJSON());
      return route.fulfill({ json: { status: 'changes_requested' } });
    }
  );
  return { state, reviewFor, firstSolar, olderSolar };
}
