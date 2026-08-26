import { Controller, Get, Req, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { SessionAuthGuard } from '../session/session.guard.js'
import type { Request } from 'express'

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/dashboard')
export class DashboardController {
  @Get()
  @ApiOperation({ summary: 'Get dashboard overview data for active profile' })
  async getDashboard(@Req() req: Request) {
    // Return aggregated dashboard data. Currently returns placeholder/static
    // structure since cross-module aggregation is not yet wired.
    return {
      wallet: {
        balance: 0,
        currency: 'IRR',
        lowBalanceWarning: false,
      },
      activeOrders: 0,
      pendingInvoices: 0,
      openTickets: 0,
      contracts: {
        active: 0,
        total: 0,
      },
    }
  }
}