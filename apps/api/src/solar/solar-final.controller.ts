import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiZodBody } from '../openapi/zod-body.decorator.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { SolarFinalService } from './solar-final.service.js';
import { ContractService } from '../contract/contract.service.js';
import {
  solarContractSchema,
  solarContractConfirmationSchema,
} from './solar-contract.validation.js';
import { InputFieldException } from '../common/input-field.exception.js';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { parseSolarContractInput } from './solar-contract-input-fields.js';

const close = z.object({ reason: z.string().trim().min(1).max(1000) }).strict();
const reviewHash = z.string().regex(/^[a-f0-9]{64}$/);
const confirmedClose = close.safeExtend({ expectedReviewHash: reviewHash });
const confirmedApproval = z.object({ expectedReviewHash: reviewHash }).strict();
const finalDecisionReview = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('approve'), reason: close.shape.reason.optional() }).strict(),
  close.safeExtend({ decision: z.literal('reject') }),
  close.safeExtend({ decision: z.literal('close-no-contract') }),
]);
function parseReason<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data as z.output<S>;
  if (
    parsed.error.issues.length &&
    parsed.error.issues.every(
      (issue) =>
        issue.path.length === 1 &&
        issue.path[0] === 'reason' &&
        ['invalid_type', 'too_small', 'too_big'].includes(issue.code)
    )
  )
    throw new InputFieldException(['reason']);
  throw new BadRequestException('Invalid solar final decision');
}
function requireFormPermission(req: AuthenticatedRequest, permission: string) {
  if (!hasStaffPermission(req, permission)) throw new ForbiddenException('Permission denied');
}
@ApiTags('Admin · Solar final decisions')
@ApiBearerAuth()
@Controller('api/admin/solar/requests/:id')
@UseGuards(SessionAuthGuard)
export class StaffSolarFinalController {
  constructor(
    private readonly service: SolarFinalService,
    private readonly contracts: ContractService
  ) {}

  @Get('contract-options')
  @ApiOperation({
    summary: 'List eligible template versions and uploaded documents for a solar contract',
  })
  options(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    return this.contracts.solarOptions(id, req.session);
  }

  @Post('create-contract/review')
  @HttpCode(200)
  @ApiOperation({ summary: 'Review the solar contract and initial invoice before issuance' })
  @ApiZodBody(solarContractSchema)
  async reviewContract(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    requireFormPermission(req, 'contracts:write');
    const input = await parseSolarContractInput(solarContractSchema, body, (profileId) =>
      this.contracts.assertCanEditSolarContract(id, profileId, req.session, false)
    );
    return this.contracts.reviewSolar({ ...input, requestId: id }, req.session);
  }

  @Post('create-contract')
  @HttpCode(200)
  @ApiOperation({ summary: 'Create a linked solar draft contract and issue its initial invoice' })
  @ApiZodBody(solarContractConfirmationSchema)
  async createContract(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    requireFormPermission(req, 'contracts:write');
    const input = await parseSolarContractInput(
      solarContractConfirmationSchema,
      body,
      (profileId) => this.contracts.assertCanEditSolarContract(id, profileId, req.session, true)
    );
    return this.contracts.createSolar(
      { ...input, requestId: id },
      req.session,
      req.ip ?? '127.0.0.1'
    );
  }

  @Post('final-approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve a solar request after confirmed postal receipt' })
  @ApiZodBody(confirmedApproval)
  approve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    const parsed = confirmedApproval.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid solar final decision');
    return this.service.decide(
      req.session,
      id,
      'approve',
      undefined,
      parsed.data.expectedReviewHash,
      req.ip ?? '127.0.0.1'
    );
  }

  @Post('final-decision/review')
  @HttpCode(200)
  @ApiOperation({ summary: 'Review the current solar request before a final decision' })
  @ApiZodBody(finalDecisionReview)
  reviewDecision(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    const closing =
      body &&
      typeof body === 'object' &&
      'decision' in body &&
      body.decision === 'close-no-contract';
    requireFormPermission(req, closing ? 'contracts:write' : 'orders:write');
    const input = parseReason(finalDecisionReview, body);
    return this.service.reviewDecision(req.session, id, input.decision, input.reason);
  }

  @Post('start-final-review')
  @HttpCode(200)
  @ApiOperation({ summary: 'Begin final review after confirmed solar postal receipt' })
  startReview(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    return this.service.beginReview(req.session, id, req.ip ?? '127.0.0.1');
  }

  @Post('final-reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject a solar request after confirmed postal receipt, with a reason' })
  @ApiZodBody(confirmedClose)
  reject(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    requireFormPermission(req, 'orders:write');
    const input = parseReason(confirmedClose, body);
    return this.service.decide(
      req.session,
      id,
      'reject',
      input.reason,
      input.expectedReviewHash,
      req.ip ?? '127.0.0.1'
    );
  }

  @Post('close-no-contract')
  @HttpCode(200)
  @ApiOperation({ summary: 'Close a solar request without a contract, with a reason' })
  @ApiZodBody(confirmedClose)
  close(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    requireFormPermission(req, 'contracts:write');
    const input = parseReason(confirmedClose, body);
    return this.service.decide(
      req.session,
      id,
      'close-no-contract',
      input.reason,
      input.expectedReviewHash,
      req.ip ?? '127.0.0.1'
    );
  }
}

@ApiTags('Staff · Solar final decisions')
@ApiBearerAuth()
@Controller('api/staff/solar/requests/:id')
@UseGuards(SessionAuthGuard)
export class SolarStaffFinalController extends StaffSolarFinalController {
  constructor(service: SolarFinalService, contracts: ContractService) {
    super(service, contracts);
  }
}
