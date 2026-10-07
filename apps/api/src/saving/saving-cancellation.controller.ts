import {
  Body,
  Controller,
  HttpException,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { getDbPool } from '@barghsa/db';
import { ErrorCodes } from '@barghsa/shared/errors';
import { z } from 'zod';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { RequiresStepUp, StepUpGuard } from '../session/step-up.guard.js';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { ContractCancellationService } from '../contract/contract-cancellation.service.js';
import {
  ContractCancellationRequestService,
  rejectCancellationRequestSchema,
} from '../contract/contract-cancellation-request.service.js';
import { executeCancellationSchema } from '../contract/contract-cancellation-validation.js';
import { contractUuid } from '../contract/contract-validation.js';

const rejection = rejectCancellationRequestSchema.safeExtend({ requestId: contractUuid });
function parse<T>(schema: z.ZodType<T>, value: unknown) {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new HttpException({ error: ErrorCodes.VALIDATION_PARSE_ZOD.code }, 400);
  return result.data;
}

@ApiTags('Staff · Saving cancellations')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard, StepUpGuard)
@Controller('api/staff/saving/orders/:id')
export class SavingCancellationController {
  constructor(
    private readonly cancellations: ContractCancellationService,
    private readonly requests: ContractCancellationRequestService
  ) {}

  private async contract(raw: string, req: AuthenticatedRequest) {
    if (!hasStaffPermission(req, 'contracts:write'))
      throw new HttpException({ error: ErrorCodes.AUTHZ_FORBIDDEN.code }, 403);
    const row = (
      await getDbPool().query<{ contract_id: string }>(
        `SELECT c.id AS contract_id FROM saving_orders s JOIN contracts c ON c.order_id=s.order_id AND c.profile_id=s.profile_id AND c.service_type='savings'
       WHERE s.id=$1`,
        [parse(contractUuid, raw)]
      )
    ).rows[0];
    if (!row) throw new NotFoundException();
    return row.contract_id;
  }

  @Post('approve-cancellation')
  @RequiresStepUp()
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary:
      'Execute a saving customer cancellation using its prepared, approved financial decision',
    description:
      'Prepare the bound customer request through the shared contract cancellation review first. Refund amounts and destinations, current fingerprint, financial permission and any second approval remain enforced by that decision.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['intentId', 'idempotencyKey'],
      properties: {
        intentId: { type: 'string', format: 'uuid' },
        idempotencyKey: { type: 'string', format: 'uuid' },
      },
    },
  })
  async approve(@Param('id') id: string, @Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const contractId = await this.contract(id, req);
    const input = parse(executeCancellationSchema, body);
    const intent = await this.cancellations.get(contractId, input.intentId);
    if (intent.terminalAction !== 'cancel' || !intent.customerRequestId)
      throw new NotFoundException();
    return this.cancellations.execute(contractId, input, req.session, req.ip ?? '127.0.0.1');
  }

  @Post('reject-cancellation')
  @RequiresStepUp()
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary:
      'Reject the selected saving customer cancellation request with an explanation; retain service and invoices',
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['requestId', 'reason', 'idempotencyKey'],
      properties: {
        requestId: { type: 'string', format: 'uuid' },
        reason: { type: 'string', minLength: 1, maxLength: 1000 },
        idempotencyKey: { type: 'string', format: 'uuid' },
      },
    },
  })
  async reject(@Param('id') id: string, @Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const contractId = await this.contract(id, req);
    const { requestId, ...input } = parse(rejection, body);
    const request = await getDbPool().query(
      'SELECT 1 FROM contract_cancellation_requests WHERE id=$1 AND contract_id=$2',
      [requestId, contractId]
    );
    if (request.rowCount !== 1) throw new NotFoundException();
    return this.requests.reject(requestId, input, req.session, req.ip ?? '127.0.0.1');
  }
}
