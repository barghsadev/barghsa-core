export const SAVING_ORDER_STATUSES = [
  'submitted',
  'awaiting_staff_review',
  'approved',
  'in_progress',
  'completed',
  'cancelled',
  'rejected',
] as const;

export const SOLAR_REQUEST_STATUSES = [
  'submitted',
  'uploading_documents',
  'documents_under_review',
  'changes_requested',
  'waiting_for_postal_submission',
  'postal_documents_received',
  'final_review',
  'approved',
  'rejected',
  'cancelled',
  'contract_created',
] as const;

export const CONSULTATION_REQUEST_STATUSES = [
  'submitted',
  'under_review',
  'awaiting_customer_info',
  'offer_pending',
  'offer_accepted',
  'offer_declined',
  'completed',
  'rejected',
  'cancelled',
] as const;

/** Canonical, bounded CSV status filters. Null means invalid input, never “show all”. */
export function parseStatusFilter<T extends string>(
  input: unknown,
  allowed: readonly T[]
): T[] | null {
  if (input === undefined || input === '') return [];
  if (typeof input !== 'string' || input.length > 500) return null;
  const requested = input.split(',');
  if (
    requested.length > allowed.length ||
    requested.some((status) => !allowed.includes(status as T))
  )
    return null;
  return allowed.filter((status) => requested.includes(status));
}
