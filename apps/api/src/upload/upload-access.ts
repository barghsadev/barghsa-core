import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AgentPermission } from '@barghsa/shared/agent-permissions';
import type { ProfilesService } from '../profiles/profiles.service.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { hasStaffPermission } from '../session/staff-permissions.js';
import type { UploadContext } from './upload.types.js';

/** Upload association never grants authority to the later business operation. */
export async function requireUploadContext(
  profiles: ProfilesService,
  request: AuthenticatedRequest,
  context: UploadContext
) {
  const { purpose, profileId } = context;
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
