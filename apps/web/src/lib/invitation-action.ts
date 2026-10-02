import { withCsrf } from './csrf.js';
import { isInvitationReceipt, type PendingInvitation } from './invitation-api.js';

/** Load decision transport only when the customer acts on an invitation. */
export async function invitationAction(
  target: PendingInvitation,
  action: 'accept' | 'decline' | 'open',
  signal: AbortSignal
) {
  const response = await fetch(
    action === 'open'
      ? `/api/profiles/switch/${target.profileId}`
      : `/api/invitations/${target.id}/${action}`,
    {
      method: 'POST',
      credentials: 'include',
      signal,
      headers: withCsrf({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(
        action === 'open' ? {} : { expectedProfileId: target.profileId, expectedRole: target.role }
      ),
    }
  );
  if (response.status === 401 || response.status === 403) return { denied: true };
  if (!response.ok) throw new Error('Invitation operation unavailable');
  const receipt: unknown = await response.json();
  if (action === 'open') {
    if (
      !receipt ||
      typeof receipt !== 'object' ||
      !('activeProfileId' in receipt) ||
      receipt.activeProfileId !== target.profileId
    )
      throw new Error('Invalid profile receipt');
  } else if (!isInvitationReceipt(receipt, target, action))
    throw new Error('Invalid invitation receipt');
  return { denied: false };
}
