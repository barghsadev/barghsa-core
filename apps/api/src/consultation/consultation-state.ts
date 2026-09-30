import { CONSULTATION_REQUEST_STATUSES } from '@barghsa/shared/validation';
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
  if (terminal.has(from)) return false;
  if (actor === 'staff' && (to === 'cancelled' || to === 'rejected')) return true;
  if (actor === 'staff') {
    return (
      (from === 'submitted' && to === 'under_review') ||
      (from === 'under_review' && (to === 'awaiting_customer_info' || to === 'offer_pending')) ||
      (from === 'offer_pending' && to === 'under_review') ||
      (from === 'offer_accepted' && to === 'completed')
    );
  }
  if (actor === 'customer') {
    return (
      (from === 'awaiting_customer_info' && to === 'under_review') ||
      (from === 'offer_pending' && to === 'offer_declined')
    );
  }
  return from === 'offer_pending' && to === 'offer_accepted';
}
