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
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiZodBody } from '../openapi/zod-body.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { RequiresStepUp, StepUpGuard } from '../session/step-up.guard.js';
import { ElectricityCommentsService } from './electricity-comments.service.js';

const customerInput = z
  .object({ idempotencyKey: z.string().uuid(), body: z.string().trim().min(1).max(10000) })
  .strict();
const staffInput = customerInput.extend({ visibility: z.enum(['public', 'internal']) }).strict();
const listInput = z.object({ before: z.string().uuid().optional() }).strict();
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
  return result.data;
}

@ApiTags('Electricity order comments')
@Controller('api/electricity/orders/:orderId/comments')
@UseGuards(SessionAuthGuard)
export class ElectricityCommentsController {
  constructor(private readonly service: ElectricityCommentsService) {}

  @Get()
  @RateLimit({ namespace: 'electricity:comments:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'List customer-visible electricity order comments' })
  @ApiQuery({ name: 'before', required: false, format: 'uuid' })
  list(
    @Param('orderId', new ParseUUIDPipe()) id: string,
    @Query() query: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    return this.service.list(id, req.session, false, parse(listInput, query).before);
  }

  @Post()
  @HttpCode(200)
  @RateLimit({ namespace: 'electricity:comments-write:user', limit: 20, windowMs: 60_000 })
  @ApiOperation({ summary: 'Add an append-only comment to an electricity order' })
  @ApiZodBody(customerInput)
  add(
    @Param('orderId', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    return this.service.add(
      id,
      req.session,
      false,
      { ...parse(customerInput, body), visibility: 'public' },
      req.ip ?? 'unknown'
    );
  }
}

@ApiTags('Staff · Electricity order comments')
@Controller('api/staff/electricity/orders/:orderId/comments')
@UseGuards(SessionAuthGuard, StepUpGuard)
export class StaffElectricityCommentsController {
  constructor(private readonly service: ElectricityCommentsService) {}

  @Get()
  @RateLimit({ namespace: 'electricity:staff-comments:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'List public replies and internal electricity order notes' })
  @ApiQuery({ name: 'before', required: false, format: 'uuid' })
  list(
    @Param('orderId', new ParseUUIDPipe()) id: string,
    @Query() query: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    return this.service.list(id, req.session, true, parse(listInput, query).before);
  }

  @Post()
  @HttpCode(200)
  @RequiresStepUp()
  @RateLimit({ namespace: 'electricity:staff-comments-write:user', limit: 20, windowMs: 60_000 })
  @ApiOperation({ summary: 'Add a public reply or internal note to an electricity order' })
  @ApiZodBody(staffInput)
  add(
    @Param('orderId', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    return this.service.add(id, req.session, true, parse(staffInput, body), req.ip ?? 'unknown');
  }
}
