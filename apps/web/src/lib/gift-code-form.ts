import { datePickerAtTime } from '@barghsa/ui';
import {
  GIFT_CODE_CATEGORIES,
  GIFT_CODE_PATTERN,
  MAX_GIFT_IRR,
  MAX_GIFT_USAGE_LIMIT,
  normalizeGiftCode,
  type GiftCodeDto,
} from '@barghsa/shared/promotions';
import { normalizeProfileDigits } from './profile-digits.js';
export type GiftDateField = {
  date: Date | undefined;
  time: string;
  original: string | null;
  changed: boolean;
};
export type GiftDraft = {
  code: string;
  discountType: 'fixed_irr' | 'percentage';
  value: string;
  cap: string;
  eligibility: 'public' | 'profile';
  profileIds: string[];
  totalLimit: string;
  perProfileLimit: string;
  minimum: string;
  categories: string[];
  restoreOnCancel: boolean;
  restoreAfterPayment: boolean;
  start: GiftDateField;
  end: GiftDateField;
};
export function giftDateField(value: string | null, zone: string): GiftDateField {
  const date = value ? new Date(value) : undefined;
  return {
    date,
    time: date
      ? new Intl.DateTimeFormat('en-GB', {
          timeZone: zone,
          hourCycle: 'h23',
          hour: '2-digit',
          minute: '2-digit',
        }).format(date)
      : '00:00',
    original: value,
    changed: false,
  };
}
export function giftDraftFrom(row: GiftCodeDto | undefined, zone: string): GiftDraft {
  return {
    code: row?.code ?? '',
    discountType: row?.discountType ?? 'fixed_irr',
    value: row
      ? row.discountType === 'percentage'
        ? String(Number(row.discountValue) / 100)
        : row.discountValue
      : '',
    cap: row?.maxCapIrr ?? '',
    eligibility: row?.eligibility ?? 'public',
    profileIds: [...(row?.profileIds ?? [])],
    totalLimit: row?.totalLimit?.toString() ?? '',
    perProfileLimit: row?.perProfileLimit?.toString() ?? '',
    minimum: row?.minOrderAmount ?? '0',
    categories: [...(row?.categories ?? [])],
    restoreOnCancel: row?.restoreOnCancel ?? true,
    restoreAfterPayment: row?.restoreAfterPayment ?? false,
    start: giftDateField(row?.validFrom ?? null, zone),
    end: giftDateField(row?.validUntil ?? null, zone),
  };
}
const digits = (value: string) => normalizeProfileDigits(value.trim());
function irr(value: string, positive = true): string | null {
  const text = digits(value);
  if (!/^\d{1,19}$/.test(text)) return null;
  const amount = BigInt(text);
  return amount >= (positive ? 1n : 0n) && amount <= MAX_GIFT_IRR ? amount.toString() : null;
}
export function giftPercentBps(value: string): string | null {
  const text = digits(value).replace('٫', '.');
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const bps = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
  return bps > 0n && bps <= 10000n ? bps.toString() : null;
}
function limit(value: string): number | null | undefined {
  const text = digits(value);
  if (!text) return null;
  if (!/^\d{1,10}$/.test(text)) return undefined;
  const count = Number(text);
  return Number.isSafeInteger(count) && count > 0 && count <= MAX_GIFT_USAGE_LIMIT
    ? count
    : undefined;
}
function instant(field: GiftDateField, zone: string): string | null {
  if (!field.date) return null;
  if (!field.changed && field.original) return field.original;
  const match = /^(\d{2}):(\d{2})$/.exec(field.time);
  if (!match) throw new Error('Invalid time');
  const date = datePickerAtTime(field.date, Number(match[1]), Number(match[2]), zone);
  if (!date) throw new Error('Invalid time');
  return date.toISOString();
}
export function giftDraftErrors(
  value: GiftDraft,
  zone: string,
  isNew: boolean
): (keyof GiftDraft)[] {
  const invalid: (keyof GiftDraft)[] = [];
  const code = normalizeGiftCode(value.code);
  if (!GIFT_CODE_PATTERN.test(code)) invalid.push('code');
  if (!['fixed_irr', 'percentage'].includes(value.discountType)) invalid.push('discountType');
  if (value.discountType === 'percentage') {
    if (!giftPercentBps(value.value)) invalid.push('value');
    if (!irr(value.cap)) invalid.push('cap');
  } else if (!irr(value.value)) invalid.push('value');
  if (!['public', 'profile'].includes(value.eligibility)) invalid.push('eligibility');
  if (
    value.eligibility === 'profile' &&
    (!value.profileIds.length ||
      new Set(value.profileIds).size !== value.profileIds.length ||
      value.profileIds.some((id) => !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)))
  )
    invalid.push('profileIds');
  for (const name of ['totalLimit', 'perProfileLimit'] as const)
    if (limit(value[name]) === undefined) invalid.push(name);
  if (irr(value.minimum, false) === null) invalid.push('minimum');
  if (
    new Set(value.categories).size !== value.categories.length ||
    value.categories.some(
      (category) => !(GIFT_CODE_CATEGORIES as readonly string[]).includes(category)
    )
  )
    invalid.push('categories');
  if (value.restoreAfterPayment && !value.restoreOnCancel) invalid.push('restoreAfterPayment');
  let start: string | null = null;
  try {
    start = instant(value.start, zone);
    if (!isNew && !start) invalid.push('start');
  } catch {
    invalid.push('start');
  }
  try {
    const end = instant(value.end, zone);
    if (end && Date.parse(end) <= Date.parse(start ?? new Date().toISOString()))
      invalid.push('end');
  } catch {
    invalid.push('end');
  }
  return invalid;
}
export function giftDraftPayload(value: GiftDraft, zone: string) {
  const start = instant(value.start, zone);
  return {
    code: normalizeGiftCode(value.code),
    discountType: value.discountType,
    discountValue: (value.discountType === 'percentage'
      ? giftPercentBps(value.value)
      : irr(value.value))!,
    maxCapIrr: value.discountType === 'percentage' ? irr(value.cap) : null,
    eligibility: value.eligibility,
    profileIds: value.eligibility === 'profile' ? [...value.profileIds] : [],
    totalLimit: limit(value.totalLimit)!,
    perProfileLimit: limit(value.perProfileLimit)!,
    minOrderAmount: irr(value.minimum, false)!,
    categories: [...value.categories],
    restoreOnCancel: value.restoreOnCancel,
    restoreAfterPayment: value.restoreAfterPayment,
    ...(start ? { validFrom: start } : {}),
    validUntil: instant(value.end, zone),
  };
}
export const giftFieldNames: Record<string, keyof GiftDraft> = {
  code: 'code',
  discountType: 'discountType',
  discountValue: 'value',
  maxCapIrr: 'cap',
  eligibility: 'eligibility',
  profileIds: 'profileIds',
  totalLimit: 'totalLimit',
  perProfileLimit: 'perProfileLimit',
  minOrderAmount: 'minimum',
  categories: 'categories',
  restoreOnCancel: 'restoreOnCancel',
  restoreAfterPayment: 'restoreAfterPayment',
  validFrom: 'start',
  validUntil: 'end',
};
