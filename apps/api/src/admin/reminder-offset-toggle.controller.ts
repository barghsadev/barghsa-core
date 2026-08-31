import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ErrorCodes } from '@barghsa/shared/errors'
import {
  REMINDER_OFFSET_TOGGLE_PERMISSION,
  type ReminderOffsetToggleDto,
} from '@barghsa/shared/finance'
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js'
import { ReminderOffsetToggleService } from './reminder-offset-toggle.service.js'

function httpError(
  code: string,
  message: string,
  statusCode = 400,
  details?: unknown,
): never {
  throw new HttpException(
    { statusCode, error: code, message, ...(details ? { details } : {}) },
    statusCode,
  )
}

function requestIp(req: AuthenticatedRequest): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown'
}

/**
 * Admin endpoints for per-service-type reminder offset toggles
 * (T-04.1.04.05 / S-04.1.04).
 *
 * Security:
 * - Every route requires an authenticated session with the
 *   `admin:finance:invoices:reminder-offsets` capability. Today the
 *   session model exposes only `req.session.isAdmin` (platform admin);
 *   granular staff-role permissions arrive with C-04.CC.03.
 * - Step-up on the mutation is deliberately deferred, matching other
 *   raw-fetch admin config panels (`DeliveryWindowConfigPanel`, dual-approval
 *   threshold, wallet top-up limit). The web toggle panel uses raw `fetch`
 *   and does not implement the AUTHZ:STEP_UP_REQUIRED challenge/retry flow
 *   yet; requiring step-up here would let admins load the matrix but fail
 *   every toggle. It must land together with the client-side step-up flow.
 */
@ApiTags('Admin · Invoice reminder offsets')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/admin/config/invoice-reminder-offsets')
export class ReminderOffsetToggleController {
  constructor(private readonly service: ReminderOffsetToggleService) {}

  private assertTogglePermission(req: AuthenticatedRequest): void {
    if (!(req.session.isAdmin ?? false)) {
      httpError(
        ErrorCodes.AUTHZ_FORBIDDEN.code,
        `Admin role required (${REMINDER_OFFSET_TOGGLE_PERMISSION})`,
        HttpStatus.FORBIDDEN,
      )
    }
  }

  @Get()
  @ApiOperation({ summary: 'List reminder offset toggles per service type (admin)' })
  @ApiResponse({
    status: 200,
    description: 'Full 4×6 matrix; missing pairs default to enabled.',
  })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async list(@Req() req: AuthenticatedRequest): Promise<ReminderOffsetToggleDto[]> {
    this.assertTogglePermission(req)
    return this.service.list()
  }

  @Put()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Enable or disable one reminder offset for one service type (admin)',
    description:
      'Upserts (serviceType, offset, enabled). Changes apply to newly ' +
      'scheduled invoices; already-inserted schedule rows are left in place. ' +
      'Step-up is deferred until the web raw-fetch admin panels implement the ' +
      'AUTHZ:STEP_UP_REQUIRED challenge/retry flow.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['serviceType', 'offset', 'enabled'],
      properties: {
        serviceType: {
          type: 'string',
          enum: ['electricity', 'saving_plan', 'consultation', 'manual'],
        },
        offset: { type: 'integer', enum: [-7, -3, -1, 0, 1, 7] },
        enabled: { type: 'boolean' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Updated toggle matrix.' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async set(
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<ReminderOffsetToggleDto[]> {
    this.assertTogglePermission(req)
    return this.service.set({
      raw: body,
      actorUserId: req.session.userId,
      ip: requestIp(req),
    })
  }
}
