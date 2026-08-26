import { Module } from '@nestjs/common'
import { AdminModule } from '../admin/admin.module.js'
import { PublicBrandingController } from './branding.controller.js'

/**
 * Public module (T-09.01.02).
 *
 * Provides unauthenticated endpoints exposed to all visitors
 * (auth pages, public pages, email templates).
 */
@Module({
  imports: [AdminModule],
  controllers: [PublicBrandingController],
})
export class PublicModule {}