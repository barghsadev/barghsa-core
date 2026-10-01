import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AgentPermission } from '@barghsa/shared/agent-permissions';
import type { ProfilesService } from '../profiles/profiles.service.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { hasStaffPermission } from '../session/staff-permissions.js';
import type { UploadContext } from './upload.types.js';
import { getDbPool } from '@barghsa/db';
import { authorizeTicketMutation } from '../tickets/ticket-actor.js';

/** Upload association never grants authority to the later business operation. */
export async function requireUploadContext(
  profiles: ProfilesService,
  request: AuthenticatedRequest,
  context: UploadContext
) {
  const { purpose, profileId, ticketId } = context;
  if (purpose === 'ticket_reply_attachment') {
    if (!ticketId) throw new BadRequestException('A reply upload requires a ticket');
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const staff = request.session.operatingContext === 'staff';
      const scope = await authorizeTicketMutation(
        client,
        request.session,
        request.session.userId,
        staff
      );
      const ticket = (
        await client.query(
          `SELECT profile_id,status FROM tickets WHERE id=$1 AND ($2::text IS NULL OR user_id=$2)
         AND ($3::text IS NULL OR assigned_to=$3) FOR SHARE`,
          [ticketId, staff ? null : request.session.userId, scope ?? null]
        )
      ).rows[0];
      if (!ticket) throw new NotFoundException('Ticket not found');
      if ((ticket.profile_id ?? null) !== (profileId ?? null))
        throw new BadRequestException('Reply upload profile must match the ticket');
      if (['closed', 'resolved'].includes(ticket.status))
        throw new BadRequestException('Reopen the ticket before uploading a reply attachment');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return;
  }
  if (ticketId) throw new BadRequestException('Only reply attachments may specify a ticket');
  const staffPurpose = [
    'staff_business_document',
    'branding_logo',
    'knowledge_base',
    'verification_evidence',
  ].includes(purpose ?? '');
  if (
    (request.session.operatingContext === 'customer' && staffPurpose) ||
    (request.session.operatingContext === 'staff' && !staffPurpose && (purpose || profileId))
  )
    throw new ForbiddenException('Upload is not permitted in this operating context');
  if (purpose === 'staff_business_document') {
    if (
      !profileId ||
      !['contracts:write', 'invoices:write', 'orders:write', 'legal:write'].some((permission) =>
        hasStaffPermission(request, permission)
      )
    )
      throw new ForbiddenException('Document upload is not permitted');
    if (!(await profiles.getProfileById(profileId)))
      throw new NotFoundException('Upload profile is not accessible');
    return;
  }
  const staffPermission =
    purpose === 'branding_logo'
      ? 'admin:branding:edit'
      : purpose === 'knowledge_base'
        ? 'admin:ai:kb'
        : purpose === 'verification_evidence'
          ? 'crm:edit-identity'
          : undefined;
  if (staffPermission && !hasStaffPermission(request, staffPermission))
    throw new ForbiddenException('Upload purpose is not permitted');
  if (purpose === 'branding_logo' || purpose === 'knowledge_base') {
    if (profileId) throw new BadRequestException('This upload purpose is not profile-scoped');
    return;
  }
  if (!profileId) {
    if (
      [
        'bank_receipt',
        'verification_evidence',
        'legal_profile_document',
        'business_document',
      ].includes(purpose ?? '')
    )
      throw new BadRequestException('This upload purpose requires a profile');
    return;
  }
  const permission: AgentPermission =
    purpose === 'bank_receipt'
      ? 'bank-receipts:submit'
      : purpose === 'legal_profile_document'
        ? 'profile:edit'
        : 'profile:view';
  const profile =
    purpose === 'verification_evidence'
      ? await profiles.getProfileById(profileId)
      : await profiles.getAccessibleProfile(request.session.userId, profileId, permission);
  if (!profile) throw new NotFoundException('Upload profile is not accessible');
  if (purpose === 'legal_profile_document' && profile.profileType !== 'LEGAL')
    throw new BadRequestException('Legal documents require a legal profile');
}
