import { normalizeProfileDigits } from './profile-digits.js';

export interface VatDraft {
  category: string;
  percent: string;
  productId: string;
  rateId: string;
  scheduled: boolean;
  date: Date | undefined;
  time: string;
}
export interface VatFormContext {
  kind: 'rate' | 'override' | 'endRate' | 'endOverride';
  categories: readonly string[];
  productIds: string[];
  rateIds: string[];
  resolveDate: (date: Date, hours: number, minutes: number) => Date | undefined;
}
export const vatDefaults: VatDraft = {
  category: 'electricity',
  percent: '0',
  productId: '',
  rateId: '',
  scheduled: false,
  date: undefined,
  time: '00:00',
};
/** Decimal text is converted exactly; fractional basis points are never rounded. */
export function vatBasisPoints(raw: string): number | null {
  const value = normalizeProfileDigits(raw).trim().replace(/٫/g, '.');
  if (!/^(?:\d{1,3}(?:\.\d{1,2})?|\.\d{1,2})$/.test(value)) return null;
  const [whole = '', fraction = ''] = value.split('.');
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return bps <= 10000 ? bps : null;
}
export function vatDraftInstant(value: VatDraft, context: VatFormContext): string | null {
  const time = /^(\d{2}):(\d{2})$/.exec(value.time);
  if (!value.date || !time || Number(time[1]) > 23 || Number(time[2]) > 59) return null;
  return context.resolveDate(value.date, Number(time[1]), Number(time[2]))?.toISOString() ?? null;
}
