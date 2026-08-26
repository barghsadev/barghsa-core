import { Controller, Get, Req, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { SessionAuthGuard } from '../session/session.guard.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { DashboardService } from './dashboard.service.js'

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  @ApiOperation({ summary: 'Get dashboard overview data for active profile' })
  async getDashboard(@Req() req: AuthenticatedRequest) {
    const userId = req.session.userId

    let quickStatus = { activeContracts: 0, pendingOrders: 0, openTickets: 0, unpaidInvoices: 0 }

    try {
      quickStatus = await this.dashboardService.getQuickStatusCounts(userId)
    } catch {
      // Non-critical — return zeros rather than breaking the dashboard.
    }

    return {
      wallet: {
        balance: 0,
        currency: 'IRR',
        lowBalanceWarning: false,
      },
      activeOrders: quickStatus.pendingOrders,
      pendingInvoices: quickStatus.unpaidInvoices,
      openTickets: quickStatus.openTickets,
      contracts: {
        active: quickStatus.activeContracts,
        total: quickStatus.activeContracts,
      },
      quickStatus, // structured payload the frontend can consume directly
    }
  }
}