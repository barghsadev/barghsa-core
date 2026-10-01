import {
  GIFT_CODE_CATEGORIES,
  MAX_GIFT_IRR,
  MAX_GIFT_USAGE_LIMIT,
  normalizeGiftCode,
  validateGiftCodePayload,
  type GiftCodeDto,
  type GiftCodeProfileUsageDto,
  type GiftCodeRedemptionDto,
} from '@barghsa/shared/promotions';
export type GiftCodeStats = {
  code: GiftCodeDto;
  perProfile: GiftCodeProfileUsageDto[];
  recentRedemptions: GiftCodeRedemptionDto[];
};
export const GIFT_CODE_PAGE_SIZE = 50;
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v);
const date = (v: unknown): v is string =>
  typeof v === 'string' && v.includes('T') && Number.isFinite(Date.parse(v));
const count = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const amount = (v: unknown): v is string =>
  typeof v === 'string' && /^(0|[1-9]\d{0,18})$/.test(v) && BigInt(v) <= MAX_GIFT_IRR;
const limit = (v: unknown) => v === null || (count(v) && v > 0 && v <= MAX_GIFT_USAGE_LIMIT);
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === 'string') && new Set(v).size === v.length;
export function isGiftCode(value: unknown): value is GiftCodeDto {
  if (!record(value)) return false;
  return (
    uuid(value.id) &&
    typeof value.code === 'string' &&
    value.code.length > 0 &&
    value.code.length <= 64 &&
    value.code === normalizeGiftCode(value.code) &&
    (value.discountType === 'fixed_irr' || value.discountType === 'percentage') &&
    amount(value.discountValue) &&
    (value.maxCapIrr === null || amount(value.maxCapIrr)) &&
    (value.eligibility === 'public' || value.eligibility === 'profile') &&
    strings(value.profileIds) &&
    value.profileIds.every(uuid) &&
    (value.eligibility === 'public' ? !value.profileIds.length : value.profileIds.length > 0) &&
    limit(value.totalLimit) &&
    limit(value.perProfileLimit) &&
    date(value.validFrom) &&
    (value.validUntil === null || date(value.validUntil)) &&
    amount(value.minOrderAmount) &&
    strings(value.categories) &&
    value.categories.every((c) => (GIFT_CODE_CATEGORIES as readonly string[]).includes(c)) &&
    typeof value.restoreOnCancel === 'boolean' &&
    typeof value.restoreAfterPayment === 'boolean' &&
    (!value.restoreAfterPayment || value.restoreOnCancel) &&
    (value.status === 'active' || value.status === 'inactive') &&
    typeof value.createdBy === 'string' &&
    value.createdBy.length > 0 &&
    date(value.createdAt) &&
    date(value.updatedAt) &&
    record(value.usage) &&
    count(value.usage.consumed) &&
    count(value.usage.released) &&
    amount(value.usage.totalDiscountIrr) &&
    validateGiftCodePayload({
      ...value,
      discountType: value.discountType,
      discountValue: value.discountValue,
      maxCapIrr: value.maxCapIrr,
    }).ok
  );
}
export function isGiftCodePage(v: unknown): v is GiftCodeDto[] {
  return (
    Array.isArray(v) &&
    v.length <= GIFT_CODE_PAGE_SIZE &&
    v.every(isGiftCode) &&
    new Set(v.map((r) => r.id)).size === v.length
  );
}
export function isGiftCodeStats(v: unknown): v is GiftCodeStats {
  if (
    !record(v) ||
    !isGiftCode(v.code) ||
    !Array.isArray(v.perProfile) ||
    !Array.isArray(v.recentRedemptions)
  )
    return false;
  const id = v.code.id;
  return (
    v.perProfile.every(
      (r) =>
        record(r) &&
        uuid(r.profileId) &&
        typeof r.profileTitle === 'string' &&
        count(r.consumed) &&
        count(r.released) &&
        amount(r.discountIrr)
    ) &&
    new Set(v.perProfile.map((r) => r.profileId)).size === v.perProfile.length &&
    v.recentRedemptions.length <= 25 &&
    v.recentRedemptions.every(
      (r) =>
        record(r) &&
        uuid(r.id) &&
        r.giftCodeId === id &&
        uuid(r.profileId) &&
        uuid(r.orderId) &&
        amount(r.discountAmount) &&
        (r.status === 'consumed' || r.status === 'released') &&
        date(r.createdAt) &&
        (r.restoredAt === null || date(r.restoredAt))
    ) &&
    new Set(v.recentRedemptions.map((r) => r.id)).size === v.recentRedemptions.length
  );
}
/** Usage changes do not invalidate reviewed settings. */
export function giftCodeBasis(row: GiftCodeDto): string {
  return JSON.stringify([
    row.id,
    row.code,
    row.discountType,
    row.discountValue,
    row.maxCapIrr,
    row.eligibility,
    [...row.profileIds].sort(),
    row.totalLimit,
    row.perProfileLimit,
    row.validFrom,
    row.validUntil,
    row.minOrderAmount,
    [...row.categories].sort(),
    row.restoreOnCancel,
    row.restoreAfterPayment,
    row.status,
    row.updatedAt,
  ]);
}
export function matchesGiftReceipt(
  value: unknown,
  proposal: unknown,
  id: string | null
): value is GiftCodeDto {
  if (!isGiftCode(value) || !record(proposal) || (id !== null && value.id !== id)) return false;
  return Object.entries(proposal).every(([key, expected]) => {
    const actual = value[key as keyof GiftCodeDto];
    if (key === 'code') return actual === normalizeGiftCode(String(expected));
    if (Array.isArray(expected))
      return (
        Array.isArray(actual) &&
        JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort())
      );
    if ((key === 'validFrom' || key === 'validUntil') && typeof expected === 'string')
      return typeof actual === 'string' && Date.parse(actual) === Date.parse(expected);
    return actual === expected;
  });
}
