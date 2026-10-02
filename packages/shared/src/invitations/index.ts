import { z } from 'zod';

export const invitationRole = z.enum(['Manager', 'Finance', 'Legal']);
export type InvitationRole = z.infer<typeof invitationRole>;

// Empty proposals remain compatible with older clients. New clients bind both
// the company and authority they displayed before asking the server to write.
export const invitationDecisionInput = z.union([
  z.strictObject({}),
  z.strictObject({ expectedProfileId: z.uuid(), expectedRole: invitationRole }),
]);
export type InvitationDecisionInput = z.infer<typeof invitationDecisionInput>;
export interface InvitationDecisionReceipt {
  id: string;
  profileId: string;
  role: InvitationRole;
  status: 'Accepted' | 'Declined';
}
