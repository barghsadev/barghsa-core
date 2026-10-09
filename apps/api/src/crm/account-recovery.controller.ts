import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { AccountRecoveryService } from './account-recovery.service.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { RequiresStepUp, StepUpGuard } from '../session/step-up.guard.js';
import { RequirePreauthCsrf } from '../session/csrf.guard.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { ApiZodBody } from '../openapi/zod-body.decorator.js';
const createInput = z
  .object({
    profileId: z.string().uuid(),
    newLogin: z.string().trim().min(1).max(255),
    supportReference: z.string().trim().min(1).max(200),
    reason: z.string().trim().min(1).max(2000),
    evidenceKeys: z.array(z.string().min(1).max(1024)).min(1).max(5),
  })
  .strict();
const reviewInput = z
  .object({ decision: z.enum(['approved', 'rejected']), notes: z.string().trim().min(1).max(2000) })
  .strict();
const completeInput = z
  .object({
    oldContact: z.string().trim().min(1).max(200),
    newContact: z.string().trim().min(1).max(200),
  })
  .strict();
const verifyInput = z
  .object({
    caseId: z.string().uuid(),
    challengeId: z.string().uuid(),
    code: z.string().regex(/^\d{6}$/),
  })
  .strict();
function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new BadRequestException();
  return result.data;
}
@ApiTags('Account recovery')
@Controller('api/crm/account-recovery')
@UseGuards(SessionAuthGuard, StepUpGuard)
export class AccountRecoveryController {
  constructor(private readonly service: AccountRecoveryService) {}
  @Post()
  @RequiresStepUp()
  @ApiZodBody(createInput)
  @ApiOperation({ summary: 'Create a restricted lost-contact identity case' })
  create(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    return this.service.create(req.session, parse(createInput, body), req.ip ?? '');
  }
  @Get(':id')
  @ApiOperation({
    summary: 'Read an authorized recovery case, sealed evidence and complete audit history',
  })
  get(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    return this.service.get(req.session, id);
  }
  @Post(':id/review')
  @RequiresStepUp()
  @HttpCode(200)
  @ApiZodBody(reviewInput)
  @ApiOperation({ summary: 'Independent identity review of the exact requested contact' })
  review(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    const input = parse(reviewInput, body);
    return this.service.review(req.session, id, input.decision, input.notes, req.ip ?? '');
  }
  @Post(':id/code')
  @RequiresStepUp()
  @HttpCode(200)
  @ApiOperation({ summary: 'Send a purpose-bound code to the approved new contact' })
  send(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    return this.service.sendCode(req.session, id, req.ip ?? '');
  }
  @Post(':id/apply')
  @RequiresStepUp()
  @HttpCode(200)
  @ApiOperation({ summary: 'Apply single-use verified recovery and revoke old authentication' })
  apply(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    return this.service.apply(req.session, id, req.ip ?? '');
  }
  @Post(':id/complete')
  @RequiresStepUp()
  @HttpCode(200)
  @ApiZodBody(completeInput)
  @ApiOperation({ summary: 'Record both support notice receipts after committed claimant login' })
  complete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    return this.service.complete(req.session, id, parse(completeInput, body), req.ip ?? '');
  }
}
@ApiTags('Account recovery')
@Controller('api/auth/recovery')
export class RecoveryContactController {
  constructor(private readonly service: AccountRecoveryService) {}
  @Post('verify')
  @RequirePreauthCsrf()
  @HttpCode(200)
  @ApiZodBody(verifyInput)
  @RateLimit({ namespace: 'auth:recovery:verify', limit: 10, windowMs: 60000, security: true })
  @ApiOperation({
    summary: 'Claimant verifies the approved new contact without disclosing account data',
  })
  verify(@Body() body: unknown, @Req() req: Request) {
    const input = parse(verifyInput, body);
    return this.service.verifyContact(input.caseId, input.challengeId, input.code, req.ip ?? '');
  }
}
