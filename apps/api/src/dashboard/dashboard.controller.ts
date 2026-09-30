import {
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { SessionAuthGuard } from '../session/session.guard.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { DashboardService, type DashboardWidgetKey } from './dashboard.service.js';

const widgetKeys = {
  wallet: 'wallet',
  status: 'status',
  invoices: 'invoices',
  orders: 'orders',
  contracts: 'contracts',
};

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('context')
  @ApiOperation({ summary: 'Get active dashboard profile and widget permissions' })
  async getContext(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.dashboardService.getContext(req.session.userId);
  }

  @Get('widgets/:widget')
  @ApiOperation({ summary: 'Get one dashboard widget for the expected active profile' })
  @ApiParam({ name: 'widget', enum: Object.values(widgetKeys) })
  @ApiQuery({ name: 'profileId', type: String, format: 'uuid', required: true })
  async getWidget(
    @Req() req: AuthenticatedRequest,
    @Param('widget', new ParseEnumPipe(widgetKeys)) widget: DashboardWidgetKey,
    @Query('profileId', new ParseUUIDPipe()) profileId: string,
    @Res({ passthrough: true }) response: Response
  ) {
    response.setHeader('Cache-Control', 'private, no-store');
    return this.dashboardService.getWidget(req.session.userId, widget, profileId);
  }

  @Get()
  @ApiOperation({ summary: 'Get dashboard overview data for active profile' })
  async getDashboard(@Req() req: AuthenticatedRequest) {
    return this.dashboardService.getOverview(req.session.userId);
  }
}
