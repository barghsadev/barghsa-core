import { SOLAR_REQUEST_STATUSES } from '@barghsa/shared/validation';
import { canTransitionState } from '../common/business-transition.js';

export const solarCommercialStatuses = ['draft', ...SOLAR_REQUEST_STATUSES] as const;
export type SolarCommercialStatus = (typeof solarCommercialStatuses)[number];
const transitions: Record<SolarCommercialStatus, readonly SolarCommercialStatus[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['uploading_documents', 'documents_under_review'],
  uploading_documents: ['documents_under_review'],
  documents_under_review: ['changes_requested', 'waiting_for_postal_submission'],
  changes_requested: [
    'uploading_documents',
    'documents_under_review',
    'changes_requested',
    'waiting_for_postal_submission',
  ],
  waiting_for_postal_submission: ['postal_documents_received'],
  postal_documents_received: ['final_review'],
  final_review: ['approved', 'rejected', 'cancelled'],
  approved: ['contract_created', 'cancelled'],
  rejected: [],
  cancelled: [],
  contract_created: [],
};

export function canTransitionSolarRequest(from: string, to: string): boolean {
  return canTransitionState(transitions, from, to);
}
