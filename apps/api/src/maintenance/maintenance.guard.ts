import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
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
    if (capability) await this.maintenance.requireAvailable(capability);
    return true;
  }
}
