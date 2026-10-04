import { ErrorCodes } from '@barghsa/shared/errors';
import type { SavingAddressAmendmentReview } from '@barghsa/shared/finance';

export type SavingAddressDraft = { addressId: string; reason: string };
export const savingAddressUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export function matchedSavingAddressReceipt(value: unknown, review: SavingAddressAmendmentReview) {
  return record(value) &&
    savingAddressUuid(value.amendmentId) &&
    value.savingOrderId === review.scope.resourceId &&
    record(value.address) &&
    ['id', 'province_id', 'city_id', 'full_address', 'postal_code'].every(
      (key) =>
        value.address &&
        record(value.address) &&
        value.address[key] ===
          review.data.replacementAddress[key as keyof typeof review.data.replacementAddress]
    )
    ? value
    : null;
}
export function publicSavingAddressError(value: unknown) {
  if (!record(value) || !record(value.error)) return null;
  const error = value.error;
  return typeof error.code === 'string' &&
    typeof error.message === 'string' &&
    savingAddressUuid(error.correlationId)
    ? error
    : null;
}
export function definitiveSavingAddressRejection(value: unknown) {
  const error = publicSavingAddressError(value);
  return error &&
    [
      ErrorCodes.VALIDATION_INPUT_INVALID.code,
      'VALIDATION:INPUT_INVALID',
      ErrorCodes.CONFLICT_STATE.code,
      ErrorCodes.CONFLICT_VERSION.code,
    ].some((code) => code === error.code)
    ? error
    : null;
}
