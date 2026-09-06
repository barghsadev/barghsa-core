import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ErrorCodes } from '@barghsa/shared/errors';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { hasStaffPermission } from '../session/staff-permissions.js';

@Injectable()
export class StorageAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (
      !hasStaffPermission(
        context.switchToHttp().getRequest<AuthenticatedRequest>(),
        'admin:storage:edit'
      )
    )
      throw new ForbiddenException({ statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code });
    return true;
  }
}
