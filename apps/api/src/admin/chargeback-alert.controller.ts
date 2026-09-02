import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ErrorCodes } from '@barghsa/shared/errors'
import {
  FINANCE_CHARGEBACK_ALERT_PERMISSION,
  type UnresolvedChargebackWarning,
} from '@barghsa/shared/finance'
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js'
import { ChargebackAlertService } from '../wallet/chargeback-alert.service.js'

function httpError(code: string, message: string, statusCode = 400): never {
  throw new HttpException({ statusCode, error: code, message }, statusCode)
}

/**
 * Finance dashboard warning for unresolved chargebacks (T-04.2.04.03).
 *
 * GET /api/admin/wallet/chargebacks/unresolved-warning returns the open
 * unmatched / reversal-failed set so the admin dashboard can show a
 * persistent warning. The capability is
 * `admin:finance:wallet:chargeback-alerts`; today that maps to a
 * platform admin session (granular finance roles arrive with C-04.CC.03).
 */
@ApiTags('Admin · Wallet chargebacks')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/admin/wallet/chargebacks')
export class ChargebackAlertController {
  constructor(private readonly alerts: ChargebackAlertService) {}

  private assertViewPermission(req: AuthenticatedRequest): void {
    if (!(req.session.isAdmin ?? false)) {
      httpError(
        ErrorCodes.AUTHZ_FORBIDDEN.code,
        `Admin role required (${FINANCE_CHARGEBACK_ALERT_PERMISSION})`,
        HttpStatus.FORBIDDEN,
      )
    }
  }

  @Get('unresolved-warning')
  @ApiOperation({ summary: 'Dashboard warning for unresolved provider chargebacks' })
  @ApiResponse({ status: 200, description: 'Open unmatched and reversal-failed chargebacks.' })
  @ApiResponse({ status: 403, description: 'Finance permission required' })
  async unresolvedWarning(
    @Req() req: AuthenticatedRequest,
  ): Promise<UnresolvedChargebackWarning> {
    this.assertViewPermission(req)
    return this.alerts.getDashboardWarning()
  }
}
