import { Controller, Get, Logger, Req, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { SessionAuthGuard } from '../session/session.guard.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { DashboardService } from './dashboard.service.js'

@ApiTags('Dashboard')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/dashboard')
export class DashboardController {
  private readonly logger = new Logger(DashboardController.name)

  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  @ApiOperation({ summary: 'Get dashboard overview data for active profile' })
  async getDashboard(@Req() req: AuthenticatedRequest) {
    const userId = req.session.userId

    let quickStatus = { activeContracts: 0, pendingOrders: 0, openTickets: 0, unpaidInvoices: 0 }

    try {
      quickStatus = await this.dashboardService.getQuickStatusCounts(userId)
    } catch (err) {
      // Non-critical — return zeros rather than breaking the dashboard page.
      this.logger.warn(`Failed to fetch quick status counts for user ${userId}: ${(err as Error).message}`)
    }

    return {
      wallet: {
        balance: 0,
        currency: 'IRR',
        lowBalanceWarning: false,
      },
      // Map quickStatus.pendingOrders → activeOrders for backward compat
      // with the existing DashboardData interface. A future cleanup can
      // rename the field.
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