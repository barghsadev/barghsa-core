import { expect, it } from 'vitest';
import { canTransitionConsultation, type ConsultationStatus } from './consultation-state.js';

it('allows only the defined consultation lifecycle transitions by the correct actor', () => {
  const allowed: Array<[ConsultationStatus, ConsultationStatus, 'staff' | 'customer' | 'payment']> =
    [
      ['submitted', 'under_review', 'staff'],
      ['under_review', 'awaiting_customer_info', 'staff'],
      ['awaiting_customer_info', 'under_review', 'customer'],
      ['under_review', 'offer_pending', 'staff'],
      ['offer_pending', 'under_review', 'staff'],
      ['offer_pending', 'offer_accepted', 'payment'],
      ['offer_pending', 'offer_declined', 'customer'],
      ['offer_accepted', 'completed', 'staff'],
      ['submitted', 'cancelled', 'staff'],
      ['under_review', 'rejected', 'staff'],
    ];
  for (const [from, to, actor] of allowed) {
    expect(canTransitionConsultation(from, to, actor), `${from} -> ${to} by ${actor}`).toBe(true);
  }
  expect(canTransitionConsultation('submitted', 'offer_pending', 'staff')).toBe(false);
  expect(canTransitionConsultation('offer_pending', 'offer_accepted', 'customer')).toBe(false);
  expect(canTransitionConsultation('under_review', 'completed', 'staff')).toBe(false);
  expect(canTransitionConsultation('completed', 'cancelled', 'staff')).toBe(false);
  expect(canTransitionConsultation('offer_declined', 'under_review', 'staff')).toBe(false);
});
