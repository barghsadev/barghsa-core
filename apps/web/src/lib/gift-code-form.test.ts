import { expect, it } from 'vitest';
import { computeGiftDiscount } from '@barghsa/shared/promotions';
import { giftCode } from '../test/gift-code-fixtures.js';
import {
  giftDraftFrom,
  giftDraftErrors,
  giftDraftPayload,
  giftPercentBps,
  giftDateField,
  giftCapSubtotal,
} from './gift-code-form.js';
const zone = 'Asia/Tehran';
it('keeps financial values exact across Persian, Arabic and Western input without rounding', () => {
  expect(giftPercentBps('۱۲٫۳۴')).toBe('1234');
  expect(giftPercentBps('٠.٠١')).toBe('1');
  expect(giftPercentBps('100.00')).toBe('10000');
  for (const raw of ['1.005', '100.01', '0', '1e2', '-1', 'Infinity'])
    expect(giftPercentBps(raw)).toBeNull();
  const draft = {
    ...giftDraftFrom(undefined, zone),
    code: ' sale ',
    value: '۹۲۲۳۳۷۲۰۳۶۸۵۴۷۷۵۸۰۷',
    totalLimit: '٢',
    minimum: '۰۰',
  };
  expect(giftDraftErrors(draft, zone, true)).toEqual([]);
  expect(giftDraftPayload(draft, zone)).toMatchObject({
    code: 'SALE',
    discountValue: '9223372036854775807',
    totalLimit: 2,
    minOrderAmount: '0',
  });
  expect(draft.value).toBe('۹۲۲۳۳۷۲۰۳۶۸۵۴۷۷۵۸۰۷');
  expect(
    giftDraftErrors(
      { ...draft, value: '9223372036854775808', perProfileLimit: '2147483648' },
      zone,
      true
    )
  ).toEqual(['value', 'perProfileLimit']);
});
it('validates related eligibility, percentage caps and cancellation policy together', () => {
  const draft = {
    ...giftDraftFrom(undefined, zone),
    code: 'PERCENT',
    discountType: 'percentage' as const,
    value: '1.005',
    eligibility: 'profile' as const,
    restoreOnCancel: false,
    restoreAfterPayment: true,
  };
  expect(giftDraftErrors(draft, zone, true)).toEqual([
    'value',
    'cap',
    'profileIds',
    'restoreAfterPayment',
  ]);
  expect(
    giftDraftErrors(
      {
        ...draft,
        value: '1.25',
        cap: '1000',
        profileIds: ['11111111-1111-4111-8111-111111111111'],
        restoreAfterPayment: false,
      },
      zone,
      true
    )
  ).toEqual([]);
});
it('finds the first eligible subtotal that actually reaches the cap', () => {
  const subtotal = giftCapSubtotal({ value: '۷٫۵', cap: '۱۰۰' });
  expect(subtotal).toBe(1334n);
  const promotion = {
    discountType: 'percentage' as const,
    discountValue: '750',
    maxCapIrr: '100',
  };
  expect(computeGiftDiscount({ ...promotion, orderAmount: subtotal! - 1n })).toBe('99');
  expect(computeGiftDiscount({ ...promotion, orderAmount: subtotal! })).toBe('100');
  expect(giftCapSubtotal({ value: '0.01', cap: '9007199254740993' })).toBe(90071992547409930000n);
  expect(giftCapSubtotal({ value: '12.345', cap: '100' })).toBeNull();
  expect(giftCapSubtotal({ value: '5', cap: '' })).toBeNull();
});
it('preserves original instants and rejects invalid windows and DST gaps in the account zone', () => {
  const draft = giftDraftFrom(giftCode(), zone);
  expect(giftDraftPayload(draft, zone).validFrom).toBe(giftCode().validFrom);
  const end = giftDateField('2025-01-01T00:00:00Z', zone);
  expect(giftDraftErrors({ ...draft, end }, zone, false)).toContain('end');
  const gap = giftDateField('2026-03-08T07:30:00Z', 'America/New_York');
  gap.time = '02:30';
  gap.changed = true;
  expect(giftDraftErrors({ ...draft, start: gap }, 'America/New_York', false)).toContain('start');
});

it('requires explicitly scheduled dates and preserves an existing expiry when toggled back on', () => {
  const draft = { ...giftDraftFrom(undefined, zone), code: 'WEEKEND', value: '1000' };
  expect(giftDraftErrors(draft, zone, true)).toEqual([]);
  const defaults = giftDraftPayload(draft, zone);
  expect(defaults.validFrom).toBeUndefined();
  expect(defaults.validUntil).toBeNull();
  draft.start.enabled = true;
  draft.end.enabled = true;
  expect(giftDraftErrors(draft, zone, true)).toEqual(['start', 'end']);

  const validUntil = '2026-12-31T18:05:47Z';
  const edit = giftDraftFrom({ ...giftCode(), validUntil }, zone);
  edit.end.enabled = false;
  expect(giftDraftPayload(edit, zone).validUntil).toBeNull();
  edit.end.enabled = true;
  expect(giftDraftPayload(edit, zone).validUntil).toBe(validUntil);
});

it.each(['A', 'AB', '-SALE', 'SALE SPACE', 'SALE%', 'کد', 'A'.repeat(65)])(
  'rejects administrator code syntax %s before submission',
  (code) => {
    expect(
      giftDraftErrors({ ...giftDraftFrom(undefined, zone), code, value: '1000' }, zone, true)
    ).toEqual(['code']);
  }
);
