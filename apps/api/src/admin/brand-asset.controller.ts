import { Controller, Get, Header, Param, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { BrandAssetService } from './brand-asset.service.js';

@ApiTags('Admin')
@Controller('api/admin/branding/assets')
@UseGuards(SessionAuthGuard)
export class AdminBrandAssetController {
  constructor(private readonly assets: BrandAssetService) {}
  @Get(':id/:digest')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({ summary: 'Preview a saved branding image' })
  read(@Param('id') id: string, @Param('digest') digest: string, @Req() req: AuthenticatedRequest) {
    if (!hasStaffPermission(req, 'admin:branding:read')) throw new ForbiddenException();
    return this.assets.read(id, digest, true);
  }
}

@ApiTags('Public')
@Controller('api/public/branding/assets')
export class PublicBrandAssetController {
  constructor(private readonly assets: BrandAssetService) {}
  @Get(':id/:digest')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({ summary: 'Read an image referenced by active branding' })
  read(@Param('id') id: string, @Param('digest') digest: string) {
    return this.assets.read(id, digest);
  }
}
