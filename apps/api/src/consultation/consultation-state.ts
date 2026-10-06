import { CONSULTATION_REQUEST_STATUSES } from '@barghsa/shared/validation';
import { canTransitionState } from '../common/business-transition.js';
export const CONSULTATION_STATUSES = CONSULTATION_REQUEST_STATUSES;
export type ConsultationStatus = (typeof CONSULTATION_STATUSES)[number];

export type ConsultationActor = 'staff' | 'customer' | 'payment';

const terminal = new Set<ConsultationStatus>([
  'offer_declined',
  'completed',
  'rejected',
  'cancelled',
]);

export function canTransitionConsultation(
  from: ConsultationStatus,
  to: ConsultationStatus,
  actor: ConsultationActor
): boolean {
  if (!CONSULTATION_STATUSES.includes(from) || !CONSULTATION_STATUSES.includes(to)) return false;
  if (terminal.has(from)) return false;
  if (actor === 'staff' && (to === 'cancelled' || to === 'rejected')) return true;
  if (actor === 'staff') {
    return canTransitionState(
      {
        submitted: ['under_review'],
        under_review: ['awaiting_customer_info', 'offer_pending'],
        offer_pending: ['under_review'],
        offer_accepted: ['completed'],
      },
      from,
      to
    );
  }
  if (actor === 'customer') {
    return canTransitionState(
      { awaiting_customer_info: ['under_review'], offer_pending: ['offer_declined'] },
      from,
      to
    );
  }
  return actor === 'payment' && canTransitionState({ offer_pending: ['offer_accepted'] }, from, to);
}
