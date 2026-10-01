import type { GiftCodeDto } from '@barghsa/shared/promotions';
export function giftCode(index = 0): GiftCodeDto {
  return {
    id: `00000000-0000-7000-8000-${String(index).padStart(12, '0')}`,
    code: `CODE${String(index).padStart(2, '0')}`,
    discountType: 'fixed_irr',
    discountValue: '1000',
    maxCapIrr: null,
    eligibility: 'public',
    profileIds: [],
    totalLimit: null,
    perProfileLimit: null,
    validFrom: '2026-01-01T00:00:00.000Z',
    validUntil: null,
    minOrderAmount: '0',
    categories: [],
    restoreOnCancel: true,
    restoreAfterPayment: false,
    status: 'active',
    createdBy: 'staff-1',
    createdAt: '2026-09-24T00:00:00.000Z',
    updatedAt: '2026-09-24T00:00:00.000Z',
    usage: { consumed: 1, released: 1, totalDiscountIrr: '1000' },
  };
}
