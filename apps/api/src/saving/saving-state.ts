import { SAVING_ORDER_STATUSES } from '@barghsa/shared/validation';
import { canTransitionState } from '../common/business-transition.js';

export const savingCommercialStatuses = ['draft', ...SAVING_ORDER_STATUSES] as const;
export type SavingCommercialStatus = (typeof savingCommercialStatuses)[number];
const transitions: Record<SavingCommercialStatus, readonly SavingCommercialStatus[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['awaiting_staff_review', 'rejected', 'cancelled'],
  awaiting_staff_review: ['approved', 'rejected', 'cancelled'],
  approved: ['awaiting_staff_review', 'in_progress', 'cancelled'],
  in_progress: ['in_progress', 'completed', 'cancelled'],
  completed: [],
  cancelled: [],
  rejected: [],
};

export function canTransitionSavingOrder(from: string, to: string): boolean {
  return canTransitionState(transitions, from, to);
}
