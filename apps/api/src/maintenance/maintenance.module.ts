import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MaintenanceService } from './maintenance.service.js';
import { MaintenanceGuard } from './maintenance.guard.js';
import {
  AdminMaintenanceController,
  PublicMaintenanceController,
} from './maintenance.controller.js';
import { SessionModule } from '../session/session.module.js';

@Module({
  imports: [SessionModule],
  controllers: [AdminMaintenanceController, PublicMaintenanceController],
  providers: [MaintenanceService, { provide: APP_GUARD, useClass: MaintenanceGuard }],
})
export class MaintenanceModule {}
