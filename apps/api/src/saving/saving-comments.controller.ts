import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiZodBody } from '../openapi/zod-body.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { RequiresStepUp, StepUpGuard } from '../session/step-up.guard.js';
import { SavingCommentsService } from './saving-comments.service.js';

const commentInput = z
  .object({ idempotencyKey: z.string().uuid(), body: z.string().trim().min(1).max(10000) })
  .strict();
const commentQuery = z.object({ before: z.string().uuid().optional() }).strict();
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
  return result.data;
}

@ApiTags('Saving order comments')
@Controller('api/saving/orders/:orderId/comments')
@UseGuards(SessionAuthGuard)
export class SavingCommentsController {
  constructor(private readonly service: SavingCommentsService) {}

  @Get()
  @RateLimit({ namespace: 'saving:comments:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'List customer-visible saving order comments' })
  list(
    @Param('orderId', new ParseUUIDPipe()) id: string,
    @Query() query: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    return this.service.list(id, req.session, false, parse(commentQuery, query).before);
  }

  @Post()
  @HttpCode(200)
  @RateLimit({ namespace: 'saving:comments-write:user', limit: 20, windowMs: 60_000 })
  @ApiOperation({ summary: 'Add an append-only comment to a saving order' })
  @ApiZodBody(commentInput)
  add(
    @Param('orderId', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    return this.service.add(id, req.session, false, parse(commentInput, body), req.ip ?? 'unknown');
  }
}

@ApiTags('Staff · Saving order comments')
@Controller('api/staff/saving/orders/:orderId/comments')
@UseGuards(SessionAuthGuard, StepUpGuard)
export class StaffSavingCommentsController {
  constructor(private readonly service: SavingCommentsService) {}

  @Get()
  @RateLimit({ namespace: 'saving:staff-comments:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'List saving order comments for staff' })
  list(
    @Param('orderId', new ParseUUIDPipe()) id: string,
    @Query() query: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    return this.service.list(id, req.session, true, parse(commentQuery, query).before);
  }

  @Post()
  @HttpCode(200)
  @RequiresStepUp()
  @RateLimit({ namespace: 'saving:staff-comments-write:user', limit: 20, windowMs: 60_000 })
  @ApiOperation({ summary: 'Add a staff reply and notify the saving order customer' })
  @ApiZodBody(commentInput)
  add(
    @Param('orderId', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    return this.service.add(id, req.session, true, parse(commentInput, body), req.ip ?? 'unknown');
  }
}
