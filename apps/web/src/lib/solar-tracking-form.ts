import { publicPostalUrl, type SolarPostalTracking } from './solar-postal-tracking.js';
import { receiptUuid, utcCalendarDay } from './solar-postal-form.js';

export interface SolarTrackingDraft {
  estimatedArrivalDate: string;
  trackingUrl: string;
  note: string;
}
export interface SolarTrackingCommand {
  estimatedArrivalDate: string | null;
  trackingUrl: string | null;
  note: string;
  expectedRevision: number;
  idempotencyKey: string;
}
export interface SolarTrackingSnapshot extends Omit<SolarPostalTracking, 'canEdit'> {
  profileId: string;
  receiptImageId: string | null;
  canEdit?: boolean;
}
export interface SolarTrackingReview {
  hash: string;
  data: SolarTrackingSnapshot & {
    previousEstimatedArrivalDate: string | null;
    previousTrackingUrl: string | null;
    previousNote: string | null;
  };
}
export const emptySolarTracking: SolarTrackingDraft = {
  estimatedArrivalDate: '',
  trackingUrl: '',
  note: '',
};
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export function definitiveSolarTrackingRejection(value: unknown) {
  return (
    record(value) &&
    record(value.error) &&
    typeof value.error.code === 'string' &&
    !!value.error.code &&
    typeof value.error.message === 'string' &&
    typeof value.error.correlationId === 'string' &&
    !!value.error.correlationId
  );
}
const nullableText = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';
const nullableDay = (value: unknown) =>
  value === null || (typeof value === 'string' && utcCalendarDay(value));
export function solarTrackingSnapshot(value: unknown): value is SolarTrackingSnapshot {
  return (
    record(value) &&
    typeof value.requestId === 'string' &&
    receiptUuid(value.requestId) &&
    typeof value.profileId === 'string' &&
    receiptUuid(value.profileId) &&
    typeof value.requestStatus === 'string' &&
    typeof value.postalStatus === 'string' &&
    (value.canEdit === undefined || typeof value.canEdit === 'boolean') &&
    nullableText(value.courier) &&
    nullableText(value.trackingNumber) &&
    nullableDay(value.sendDate) &&
    nullableDay(value.estimatedArrivalDate) &&
    nullableText(value.trackingUrl) &&
    nullableText(value.note) &&
    (value.receiptImageId === null ||
      (typeof value.receiptImageId === 'string' && receiptUuid(value.receiptImageId))) &&
    Number.isInteger(value.revision) &&
    Number(value.revision) >= 0 &&
    Number(value.revision) <= 2147483647 &&
    (value.recordedAt === null ||
      (typeof value.recordedAt === 'string' && Number.isFinite(Date.parse(value.recordedAt))))
  );
}
export function solarTrackingDraft(value: SolarTrackingSnapshot): SolarTrackingDraft {
  return {
    estimatedArrivalDate: value.estimatedArrivalDate ?? '',
    trackingUrl: value.trackingUrl ?? '',
    note: value.note ?? '',
  };
}
export function solarTrackingCommand(
  draft: SolarTrackingDraft,
  revision: number,
  key: string
): SolarTrackingCommand {
  const url = draft.trackingUrl.trim();
  return {
    estimatedArrivalDate: draft.estimatedArrivalDate || null,
    trackingUrl: url ? (publicPostalUrl(url)?.href ?? url) : null,
    note: draft.note.trim(),
    expectedRevision: revision,
    idempotencyKey: key,
  };
}
const sameParcel = (value: SolarTrackingSnapshot, captured: SolarTrackingSnapshot) =>
  [
    'requestId',
    'profileId',
    'requestStatus',
    'postalStatus',
    'courier',
    'trackingNumber',
    'sendDate',
    'receiptImageId',
  ].every(
    (key) =>
      value[key as keyof SolarTrackingSnapshot] === captured[key as keyof SolarTrackingSnapshot]
  );
export function confirmedSolarTracking(
  value: unknown,
  captured: SolarTrackingSnapshot,
  body: SolarTrackingCommand
): value is SolarTrackingSnapshot {
  return (
    solarTrackingSnapshot(value) &&
    sameParcel(value, captured) &&
    value.revision === body.expectedRevision + 1 &&
    value.recordedAt !== null &&
    value.estimatedArrivalDate === body.estimatedArrivalDate &&
    value.trackingUrl === body.trackingUrl &&
    value.note === body.note
  );
}
export function solarTrackingReview(
  value: unknown,
  captured: SolarTrackingSnapshot,
  body: SolarTrackingCommand
): value is SolarTrackingReview {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    typeof value.hash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value.hash) ||
    !record(value.scope) ||
    value.scope.action !== 'solar.postal.tracking' ||
    value.scope.profileId !== captured.profileId ||
    value.scope.resourceId !== captured.requestId ||
    !solarTrackingSnapshot(value.data)
  )
    return false;
  const data = value.data as SolarTrackingReview['data'] & Record<string, unknown>;
  return (
    sameParcel(data, captured) &&
    data.revision === body.expectedRevision &&
    data.estimatedArrivalDate === body.estimatedArrivalDate &&
    data.trackingUrl === body.trackingUrl &&
    data.note === body.note &&
    data.previousEstimatedArrivalDate === captured.estimatedArrivalDate &&
    data.previousTrackingUrl === captured.trackingUrl &&
    data.previousNote === captured.note &&
    data.expectedRevision === body.expectedRevision &&
    data.customerVisible === true &&
    data.confirmsReceipt === false &&
    data.createsContract === false &&
    data.collectsPayment === false
  );
}
