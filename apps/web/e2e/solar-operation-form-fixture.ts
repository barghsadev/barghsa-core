import type { Page, Route } from '@playwright/test';
import { ErrorCodes } from '@barghsa/shared/errors';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { fullNavigation } from './navigation-fixture';
import {
  firstSolar,
  olderSolar,
  solarPostal,
  solarProfile,
  solarGuidance,
} from '../src/test/solar-staff-fixtures';
import {
  constructionProgress,
  constructionRow,
  constructionRequest,
  constructionOlder,
} from '../src/test/solar-progress-fixtures';
import type { SolarProgress } from '../src/lib/solar-progress';
import type { SolarTrackingSnapshot } from '../src/lib/solar-tracking-form';

export const trackingPath = (id = firstSolar) => `/api/admin/solar/requests/${id}/postal/tracking`;
export const constructionPath = '/api/admin/solar/construction';
export function trackingSnapshot(id = firstSolar): SolarTrackingSnapshot {
  return {
    requestId: id,
    profileId: solarProfile,
    receiptImageId: null,
    requestStatus: 'waiting_for_postal_submission',
    postalStatus: 'shipped',
    courier: 'Post',
    trackingNumber: id === firstSolar ? 'TRACK-1' : 'OTHER-PARCEL',
    sendDate: '2026-09-23',
    estimatedArrivalDate: '2026-09-26',
    trackingUrl: 'https://courier.example.org/track/TRACK-1',
    note:
      id === firstSolar
        ? 'Courier estimate; originals are awaiting staff confirmation.'
        : 'Other parcel note',
    revision: 0,
    recordedAt: '2026-09-23T10:00:00.000Z',
    canEdit: true,
  };
}
export function trackingReview(
  current: ReturnType<typeof trackingSnapshot>,
  body: Record<string, unknown>
) {
  const { canEdit: _canEdit, ...row } = current;
  return {
    schemaVersion: 1,
    hash: 'a'.repeat(64),
    scope: { action: 'solar.postal.tracking', profileId: row.profileId, resourceId: row.requestId },
    data: {
      ...row,
      estimatedArrivalDate: body.estimatedArrivalDate,
      trackingUrl: body.trackingUrl,
      note: body.note,
      expectedRevision: body.expectedRevision,
      previousEstimatedArrivalDate: row.estimatedArrivalDate,
      previousTrackingUrl: row.trackingUrl,
      previousNote: row.note,
      customerVisible: true,
      confirmsReceipt: false,
      createsContract: false,
      collectsPayment: false,
    },
  };
}
export function constructionReview(current: SolarProgress, command: Record<string, unknown>) {
  return {
    schemaVersion: 1,
    hash: 'b'.repeat(64),
    scope: {
      action: 'solar.construction.record',
      profileId: current.profileId,
      resourceId: current.requestId,
    },
    data: {
      command,
      contractId: current.contractId,
      contractState: current.contractState,
      versionId: '85000000-0000-4000-8000-000000000005',
      revision: current.revision,
      previousStage: current.events.at(-1)?.stage ?? null,
      customerVisible: true,
      collectsPayment: false,
      changesContract: false,
    },
  };
}
export function progressWithNotes(notes: string[], id = constructionRequest): SolarProgress {
  const value = constructionProgress(notes.length, id);
  value.events.forEach((event, index) => {
    event.note = notes[index]!;
  });
  for (const step of value.steps) {
    const event = value.events.find((event) => event.stage === step.id);
    if (event) step.note = event.note;
  }
  return value;
}
type ReviewMode = 'owned' | 'unsafe' | 'held' | 'success';
type WriteMode = 'held' | 'success' | 'denied';
type ReadMode = 'success' | 'held' | 'denied';
export async function setupSolarOperationForms(page: Page, locale: 'en' | 'fa', dark: boolean) {
  await setupCatalogueForms(page, locale, dark);
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: 'reviewer',
        isStaff: true,
        operatingContext: 'staff',
        canSwitchContext: false,
        requiresTosAcceptance: false,
        navigation: fullNavigation('staff'),
      },
    })
  );
  const state = {
    tracking: trackingSnapshot(),
    progress: progressWithNotes([]),
    trackingReviewMode: 'owned' as ReviewMode,
    progressReviewMode: 'owned' as ReviewMode,
    trackingWriteMode: 'held' as WriteMode,
    progressWriteMode: 'held' as WriteMode,
    trackingReadMode: 'success' as ReadMode,
    progressReadMode: 'success' as ReadMode,
    trackingPreview: undefined as Route | undefined,
    progressPreview: undefined as Route | undefined,
    trackingWrite: undefined as Route | undefined,
    progressWrite: undefined as Route | undefined,
    trackingRead: undefined as Route | undefined,
    progressRead: undefined as Route | undefined,
    stepUp: undefined as Route | undefined,
    verified: false,
    requireStepUp: false,
    verifications: 0,
    trackingPreviews: [] as Record<string, unknown>[],
    progressPreviews: [] as Record<string, unknown>[],
    trackingWrites: [] as Record<string, unknown>[],
    progressWrites: [] as Record<string, unknown>[],
    trackingReads: [] as string[],
    progressReads: [] as string[],
  };
  const invalid = (route: Route, fields: string[]) =>
    route.fulfill({
      status: 400,
      json: {
        error: {
          code: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          fields,
          message: 'PRIVATE_SERVER_VALIDATION_TEXT',
          correlationId: 'solar-operation-form-fixture',
        },
      },
    });
  await page.route('**/api/admin/solar/postal-guidance', (route) =>
    route.fulfill({ json: solarGuidance })
  );
  await page.route('**/api/admin/solar/postal-queue?*', (route) =>
    route.fulfill({
      json: {
        requests: [
          { ...solarPostal(), tracking_revision: state.tracking.revision },
          { ...solarPostal(olderSolar), tracking_revision: 0 },
        ],
        nextBefore: null,
      },
    })
  );
  await page.route(
    (url) => url.pathname === constructionPath,
    (route) =>
      route.fulfill({
        json: {
          items: [constructionRow(), constructionRow(constructionOlder)],
          nextBefore: null,
        },
      })
  );
  for (const id of [firstSolar, olderSolar]) {
    await page.route(
      (url) => url.pathname === trackingPath(id),
      (route) => {
        if (route.request().method() === 'GET') {
          state.trackingReads.push(id);
          if (state.trackingReadMode === 'held') {
            state.trackingRead = route;
            return;
          }
          if (state.trackingReadMode === 'denied') return route.fulfill({ status: 403, json: {} });
          return route.fulfill({ json: id === firstSolar ? state.tracking : trackingSnapshot(id) });
        }
        state.trackingWrites.push(route.request().postDataJSON());
        if (state.trackingWriteMode === 'denied') return route.fulfill({ status: 403, json: {} });
        if (state.requireStepUp && !state.verified)
          return route.fulfill({ status: 403, json: { requiresStepUp: true } });
        if (state.trackingWriteMode === 'held') {
          state.trackingWrite = route;
          return;
        }
        const { canEdit: _canEdit, ...receipt } = state.tracking;
        return route.fulfill({ json: receipt });
      }
    );
    await page.route(
      (url) => url.pathname === trackingPath(id) + '/review',
      (route) => {
        const body = route.request().postDataJSON();
        state.trackingPreviews.push(body);
        if (state.trackingReviewMode === 'owned') return invalid(route, ['trackingUrl']);
        if (state.trackingReviewMode === 'unsafe')
          return invalid(route, ['trackingUrl', 'PRIVATE_REVIEW_HASH']);
        if (state.trackingReviewMode === 'held') {
          state.trackingPreview = route;
          return;
        }
        return route.fulfill({
          json: trackingReview(id === firstSolar ? state.tracking : trackingSnapshot(id), body),
        });
      }
    );
  }
  for (const id of [constructionRequest, constructionOlder]) {
    await page.route(
      (url) => url.pathname === `${constructionPath}/${id}`,
      (route) => {
        if (route.request().method() === 'GET') {
          state.progressReads.push(id);
          if (state.progressReadMode === 'held') {
            state.progressRead = route;
            return;
          }
          if (state.progressReadMode === 'denied') return route.fulfill({ status: 403, json: {} });
          return route.fulfill({
            json: id === constructionRequest ? state.progress : progressWithNotes([], id),
          });
        }
        state.progressWrites.push(route.request().postDataJSON());
        if (state.progressWriteMode === 'denied') return route.fulfill({ status: 403, json: {} });
        if (state.requireStepUp && !state.verified)
          return route.fulfill({ status: 403, json: { requiresStepUp: true } });
        if (state.progressWriteMode === 'held') {
          state.progressWrite = route;
          return;
        }
        return route.fulfill({ json: state.progress });
      }
    );
    await page.route(
      (url) => url.pathname === `${constructionPath}/${id}/review`,
      (route) => {
        const body = route.request().postDataJSON();
        state.progressPreviews.push(body);
        if (state.progressReviewMode === 'owned') return invalid(route, ['note']);
        if (state.progressReviewMode === 'unsafe')
          return invalid(route, ['note', 'PRIVATE_OPERATION_ID']);
        if (state.progressReviewMode === 'held') {
          state.progressPreview = route;
          return;
        }
        return route.fulfill({
          json: constructionReview(
            id === constructionRequest ? state.progress : progressWithNotes([], id),
            body
          ),
        });
      }
    );
  }
  await page.route('**/api/auth/step-up', (route) => {
    state.verifications++;
    state.stepUp = route;
  });
  const persistTracking = () => {
    const body = state.trackingWrites.at(-1)!;
    state.tracking = {
      ...state.tracking,
      estimatedArrivalDate: body.estimatedArrivalDate as string | null,
      trackingUrl: body.trackingUrl as string | null,
      note: String(body.note),
      revision: Number(body.expectedRevision) + 1,
      recordedAt: '2026-09-27T12:00:00.000Z',
    };
  };
  const persistProgress = () => {
    const body = state.progressWrites.at(-1)!;
    state.progress = progressWithNotes([
      ...state.progress.events.map((event) => event.note),
      String(body.note),
    ]);
  };
  return { state, persistTracking, persistProgress };
}
