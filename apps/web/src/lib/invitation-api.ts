import type { InvitationDecisionReceipt, InvitationRole } from '@barghsa/shared/invitations';

export interface PendingInvitation {
  id: string;
  profileId: string;
  profileName: string;
  role: InvitationRole;
  invitedBy: string;
  inviterName: string | null;
  createdAt: string;
  expiresAt: string | null;
  message?: string | null;
  entity?: { nationalIdentifier: string | null; registrationNumber: string | null };
}
export interface PendingInvitationsResponse {
  invitations: PendingInvitation[];
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 1000): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const optionalText = (v: unknown, max = 1000) =>
  v == null || (typeof v === 'string' && v.length <= max);
const role = (v: unknown) => v === 'Manager' || v === 'Finance' || v === 'Legal';
const date = (v: unknown) =>
  typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v.slice(0, 10) + 'T00:00:00Z').toISOString().slice(0, 10) === v.slice(0, 10);
const validInvitation = (v: unknown): v is PendingInvitation =>
  record(v) &&
  typeof v.id === 'string' &&
  uuid.test(v.id) &&
  typeof v.profileId === 'string' &&
  uuid.test(v.profileId) &&
  text(v.profileName) &&
  role(v.role) &&
  text(v.invitedBy) &&
  (v.inviterName === null || text(v.inviterName)) &&
  date(v.createdAt) &&
  (v.expiresAt === null || date(v.expiresAt)) &&
  optionalText(v.message, 2000) &&
  (v.entity === undefined ||
    (record(v.entity) &&
      optionalText(v.entity.nationalIdentifier, 100) &&
      optionalText(v.entity.registrationNumber, 100)));

export function isPendingInvitations(value: unknown): value is PendingInvitationsResponse {
  return (
    record(value) &&
    Array.isArray(value.invitations) &&
    value.invitations.every(validInvitation) &&
    new Set(value.invitations.map((i) => i.id)).size === value.invitations.length
  );
}

export function isInvitationReceipt(
  value: unknown,
  target: PendingInvitation,
  decision: 'accept' | 'decline'
): value is { invitation: InvitationDecisionReceipt } {
  return (
    record(value) &&
    record(value.invitation) &&
    value.invitation.id === target.id &&
    value.invitation.profileId === target.profileId &&
    value.invitation.role === target.role &&
    value.invitation.status === (decision === 'accept' ? 'Accepted' : 'Declined')
  );
}
