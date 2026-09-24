import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCodes } from '@barghsa/shared/errors';
import { MaintenanceService, type Capability } from './maintenance.service.js';

const CAPABILITY_KEY = 'barghsa:maintenance-capability';

export const RequiresCapability = (capability: Capability) =>
  SetMetadata(CAPABILITY_KEY, capability);

@Injectable()
export class MaintenanceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly maintenance: MaintenanceService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const capability = this.reflector.getAllAndOverride<Capability | undefined>(CAPABILITY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!capability) return true;
    const setting = await this.maintenance.get(capability);
    if (!setting.active) return true;
    throw new ServiceUnavailableException({
      error: ErrorCodes.MAINTENANCE_ACTIVE.code,
      capability,
      reason: setting.reason,
      estimatedUntil: setting.estimatedUntil,
      supportUrl: '/tickets',
    });
  }
}
