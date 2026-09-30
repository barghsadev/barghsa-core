import {
  BadRequestException,
  Body,
  Controller,
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

const close = z.object({ reason: z.string().trim().min(1).max(1000) }).strict();
const reviewHash = z.string().regex(/^[a-f0-9]{64}$/);
const confirmedClose = close.safeExtend({ expectedReviewHash: reviewHash });
const confirmedApproval = z.object({ expectedReviewHash: reviewHash }).strict();
const finalDecisionReview = z
  .object({
    decision: z.enum(['approve', 'reject', 'close-no-contract']),
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();
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
  reviewContract(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    const parsed = solarContractSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid solar contract');
    return this.contracts.reviewSolar({ ...parsed.data, requestId: id }, req.session);
  }

  @Post('create-contract')
  @HttpCode(200)
  @ApiOperation({ summary: 'Create a linked solar draft contract and issue its initial invoice' })
  @ApiZodBody(solarContractConfirmationSchema)
  createContract(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    const parsed = solarContractConfirmationSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid solar contract');
    return this.contracts.createSolar(
      { ...parsed.data, requestId: id },
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
    const parsed = finalDecisionReview.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid solar final decision');
    return this.service.reviewDecision(req.session, id, parsed.data.decision, parsed.data.reason);
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
    const parsed = confirmedClose.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Reason is required');
    return this.service.decide(
      req.session,
      id,
      'reject',
      parsed.data.reason,
      parsed.data.expectedReviewHash,
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
    const parsed = confirmedClose.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Reason is required');
    return this.service.decide(
      req.session,
      id,
      'close-no-contract',
      parsed.data.reason,
      parsed.data.expectedReviewHash,
      req.ip ?? '127.0.0.1'
    );
  }
}
