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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiZodBody } from '../openapi/zod-body.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { SolarProgressService } from './solar-progress.service.js';
import { solarProgressCommand, solarProgressConfirmation } from './solar-progress.validation.js';
import { InputFieldException } from '../common/input-field.exception.js';
import { hasStaffPermission } from '../session/staff-permissions.js';

function parseMilestone<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data as z.output<S>;
  if (
    parsed.error.issues.length &&
    parsed.error.issues.every(
      (issue) =>
        issue.path.length === 1 &&
        issue.path[0] === 'note' &&
        ['invalid_type', 'too_small', 'too_big'].includes(issue.code)
    )
  )
    throw new InputFieldException(['note']);
  throw new BadRequestException('Invalid construction milestone');
}
function requireFormPermission(req: AuthenticatedRequest) {
  if (!hasStaffPermission(req, 'orders:write')) throw new ForbiddenException('Permission denied');
}

@ApiTags('Admin · Solar construction progress')
@ApiBearerAuth()
@Controller('api/admin/solar/construction')
@UseGuards(SessionAuthGuard)
export class SolarProgressController {
  constructor(private readonly service: SolarProgressService) {}
  @Get()
  @ApiOperation({ summary: 'List solar requests with linked construction contracts' })
  @ApiQuery({ name: 'before', required: false, type: String })
  @ApiQuery({ name: 'q', required: false, type: String })
  list(@Req() req: AuthenticatedRequest, @Query('before') before: unknown, @Query('q') q: unknown) {
    const parsed = z
      .object({ before: z.uuid().optional(), q: z.string().trim().max(200).default('') })
      .safeParse({ before, q });
    if (!parsed.success) throw new BadRequestException('Invalid construction query');
    return this.service.list(req.session, parsed.data.before, parsed.data.q);
  }
  @Get(':id')
  @ApiOperation({
    summary: 'Read recorded construction progress without internal author identities',
  })
  detail(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    return this.service.detail(req.session, id);
  }
  @Post(':id/review')
  @HttpCode(200)
  @RateLimit({ namespace: 'solar:construction:review', scope: 'user', limit: 30, windowMs: 60000 })
  @ApiOperation({ summary: 'Review the next customer-visible construction milestone' })
  @ApiZodBody(solarProgressCommand)
  review(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown
  ) {
    requireFormPermission(req);
    return this.service.review(req.session, id, parseMilestone(solarProgressCommand, body));
  }
  @Post(':id')
  @HttpCode(200)
  @RateLimit({ namespace: 'solar:construction:record', scope: 'user', limit: 15, windowMs: 60000 })
  @ApiOperation({
    summary: 'Record the reviewed milestone atomically with audit and customer notification',
  })
  @ApiZodBody(solarProgressConfirmation)
  record(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown
  ) {
    requireFormPermission(req);
    const { expectedReviewHash, ...command } = parseMilestone(solarProgressConfirmation, body);
    return this.service.record(req.session, id, command, expectedReviewHash, req.ip ?? '127.0.0.1');
  }
}
