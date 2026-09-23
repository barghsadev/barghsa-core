import { Controller, Get, HttpException, Param, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { getDbPool } from '@barghsa/db';
import { ErrorCodes } from '@barghsa/shared/errors';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { customerContractAccess } from './contract-customer-access.js';
import { contractUuid } from './contract-validation.js';
import { readCancellationStatus } from './contract-cancellation-status.js';
function idValue(raw: string) {
  const parsed = contractUuid.safeParse(raw);
  if (!parsed.success)
    throw new HttpException({ error: ErrorCodes.VALIDATION_PARSE_ZOD.code }, 400);
  return parsed.data;
}
@ApiTags('Admin · Contracts')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/admin/contracts')
export class StaffContractCancellationStatusController {
  @Get(':id/cancellation-status')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Read service cancellation and current financial closure independently',
  })
  async get(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    if (!hasStaffPermission(req, 'contracts:read'))
      throw new HttpException({ error: ErrorCodes.AUTHZ_FORBIDDEN.code }, 403);
    const status = await readCancellationStatus(getDbPool(), idValue(id));
    return {
      ...status,
      canCancel:
        hasStaffPermission(req, 'contracts:write') &&
        !['Completed', 'Cancelled', 'Rejected'].includes(status.state) &&
        !status.savingTerminal,
      canChooseRefund: hasStaffPermission(req, 'admin:financial:edit'),
    };
  }
}
@ApiTags('Contracts')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/contracts')
export class CustomerContractCancellationStatusController {
  @Get(':id/cancellation-status')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary:
      'Read cancellation refund outcomes for an available contract on the authorized profile',
  })
  get(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const parsed = idValue(id);
    return customerContractAccess(req.session, false, (client, profile) =>
      readCancellationStatus(client, parsed, profile)
    );
  }
}
