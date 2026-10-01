/** Public summaries only. Never serialize audit metadata into the customer team UI. */
export const TEAM_ACTIVITY_EVENTS = {
  invitation_created: 'invitationCreated',
  invitation_accepted: 'invitationAccepted',
  invitation_declined: 'invitationDeclined',
  invitation_withdrawn: 'invitationWithdrawn',
  agent_roles_changed: 'rolesChanged',
  agent_removed: 'memberRemoved',
  ownership_transfer_initiated: 'ownershipRequested',
  ownership_transfer_accepted: 'ownershipAccepted',
  ownership_transfer_declined: 'ownershipDeclined',
  ownership_transfer_cancelled: 'ownershipCancelled',
  ownership_transfer_expired: 'ownershipExpired',
  profile_self_updated: 'profileUpdated',
  profile_onboarding_completed: 'profileCompleted',
  address_created: 'addressCreated',
  address_updated: 'addressUpdated',
  address_deleted: 'addressDeleted',
  address_main_changed: 'addressMainChanged',
  order_created: 'orderCreated',
  saving_order_draft_saved: 'orderDraftSaved',
  'electricity.order_cancelled': 'orderCancelled',
  'electricity.order_resubmitted': 'orderResubmitted',
  'electricity.order_comment_added': 'commentAdded',
  'saving.order_comment_added': 'commentAdded',
  'solar.request.draft_saved': 'solarDraftSaved',
  'solar.request.submitted': 'solarSubmitted',
  'solar.documents.submitted': 'documentsSubmitted',
  'solar.postal.shipped': 'documentsShipped',
  'consultation.request.submitted': 'consultationSubmitted',
  'contract.accepted': 'contractAccepted',
  'contract.amendment_accepted': 'amendmentAccepted',
  'contract.signature_requested': 'signatureRequested',
  'contract.signed_copy_recorded': 'signedCopyRecorded',
  'contract.cancellation_requested': 'cancellationRequested',
} as const;
export type TeamActivityKind = (typeof TEAM_ACTIVITY_EVENTS)[keyof typeof TEAM_ACTIVITY_EVENTS];
export interface TeamActivityItem {
  id: string;
  kind: TeamActivityKind;
  createdAt: string;
  performed: boolean;
}
export interface TeamActivityPage {
  profileId: string;
  userId: string;
  items: TeamActivityItem[];
  nextCursor: string | null;
}
const kinds = new Set<string>(Object.values(TEAM_ACTIVITY_EVENTS));
/** Reject wrong-scope, duplicate, malformed and unknown-summary pages before displaying them. */
export function validTeamActivity(
  value: unknown,
  profileId: string,
  userId: string
): value is TeamActivityPage {
  if (!value || typeof value !== 'object') return false;
  const page = value as TeamActivityPage;
  return (
    page.profileId === profileId &&
    page.userId === userId &&
    Array.isArray(page.items) &&
    page.items.length <= 50 &&
    page.items.every(
      (item) =>
        item &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        /^[a-zA-Z0-9_-]{1,100}$/.test(item.id) &&
        kinds.has(item.kind) &&
        typeof item.performed === 'boolean' &&
        typeof item.createdAt === 'string' &&
        item.createdAt.includes('T') &&
        Number.isFinite(Date.parse(item.createdAt))
    ) &&
    new Set(page.items.map((item) => item.id)).size === page.items.length &&
    (page.nextCursor === null ||
      (typeof page.nextCursor === 'string' &&
        /^[A-Za-z0-9_-]{1,2048}$/.test(page.nextCursor) &&
        page.items.length > 0))
  );
}
