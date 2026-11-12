import { privateLogId } from '@barghsa/shared/log-privacy';
import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { ErrorCodes } from '@barghsa/shared/errors';
import type { AgentPermission } from '@barghsa/shared/agent-permissions';
import { authorizationService } from '../session/authorization.service.js';
import { AGENT_PERMISSION_KEY } from './agent-permission.decorator.js';
import { AgentsService } from './agents.service.js';

/**
 * NestJS guard that enforces agent role-based permissions on
 * profile-scoped API endpoints.
 *
 * Must run AFTER SessionAuthGuard so `req.session` is populated.
 * Reads the required permission from the `@RequireAgentPermission()`
 * decorator on the route handler, then extracts the profile ID from
 * the route params and checks the caller's agent roles against the
 * permission matrix.
 *
 * Usage:
 * ```ts
 * @UseGuards(SessionAuthGuard, AgentRoleGuard)
 * @RequireAgentPermission('orders:create')
 * @Post()
 * async createOrder(...) { ... }
 * ```
 */
@Injectable()
export class AgentRoleGuard implements CanActivate {
  private readonly logger = new Logger(AgentRoleGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly agentsService: AgentsService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermission: AgentPermission | undefined =
      this.reflector.get<AgentPermission>(AGENT_PERMISSION_KEY, context.getHandler()) ??
      this.reflector.get<AgentPermission>(AGENT_PERMISSION_KEY, context.getClass());

    if (!requiredPermission) {
      this.logger.warn('AgentRoleGuard used without @RequireAgentPermission() decorator');
      throw new ForbiddenException({
        statusCode: 403,
        error: ErrorCodes.AUTHZ_FORBIDDEN.code,
      });
    }

    const http = context.switchToHttp();
    const request: AuthenticatedRequest = http.getRequest();
    const response = http.getResponse();

    // Must have an authenticated session
    if (!request.session) {
      this.logger.warn('AgentRoleGuard: no authenticated session');
      throw new ForbiddenException({
        statusCode: 403,
        error: ErrorCodes.AUTHZ_FORBIDDEN.code,
      });
    }

    // Extract profile ID from route params
    const profileId: string | undefined =
      typeof request.params.profileId === 'string'
        ? request.params.profileId
        : typeof request.params.id === 'string'
          ? request.params.id
          : undefined;
    if (!profileId) {
      this.logger.warn('AgentRoleGuard: no profile ID in route params');
      throw new ForbiddenException({
        statusCode: 403,
        error: ErrorCodes.AUTHZ_FORBIDDEN.code,
      });
    }

    const userId = request.session.userId;

    // Look up the caller's agent roles in this profile
    const roles = await this.agentsService.getAgentRoles(profileId, userId);

    if (roles.length === 0) {
      this.logger.warn(
        `AgentRoleGuard: user ${privateLogId('actor', userId)} is not an agent of profile ${privateLogId('profile', profileId)}`
      );
      throw new ForbiddenException({
        statusCode: 403,
        error: ErrorCodes.AUTHZ_INSUFFICIENT_ROLE.code,
      });
    }

    // Check if any of the user's roles grant the required permission
    if (!authorizationService.allowsProfile(roles, requiredPermission)) {
      this.logger.warn(
        `AgentRoleGuard: user ${privateLogId('actor', userId)} role(s) [${roles.join(', ')}] ` +
          `lack permission '${requiredPermission}' for profile ${privateLogId('profile', profileId)}`
      );
      // Set the error code header for the frontend to read
      if (typeof response?.setHeader === 'function') {
        response.setHeader('X-Required-Permission', requiredPermission);
      }
      throw new ForbiddenException({
        statusCode: 403,
        error: ErrorCodes.AUTHZ_INSUFFICIENT_ROLE.code,
      });
    }

    return true;
  }
}
