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
import { ApiBody, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { StepUpGuard, RequiresStepUp } from '../session/step-up.guard.js';
import { CustomerCorrectionsService } from './customer-corrections.service.js';

const querySchema = z
  .object({
    completed: z.enum(['true', 'false']).optional(),
    offset: z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .pipe(z.number().int().min(0).max(1000000))
      .optional(),
  })
  .strict();
const resolutionSchema = z.object({ note: z.string().trim().min(1).max(2000) }).strict();

@ApiTags('Admin')
@Controller('api/admin/notifications/customer-corrections')
@UseGuards(SessionAuthGuard)
export class CustomerCorrectionsController {
  constructor(private readonly corrections: CustomerCorrectionsService) {}

  @Get()
  @ApiOperation({ summary: 'List email complaint correction tasks' })
  @ApiQuery({ name: 'completed', required: false, enum: ['true', 'false'] })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiResponse({
    status: 200,
    type: [Object],
    description: 'Correction tasks, newest first; at most 26 rows',
  })
  async list(@Query() query: unknown, @Req() req: AuthenticatedRequest) {
    const parsed = querySchema.safeParse(query);
    if (!parsed.success)
      throw new HttpException({ statusCode: 400, error: 'VALIDATION_INPUT_INVALID' }, 400);
    return this.corrections.list(
      req.session,
      parsed.data.completed === 'true',
      parsed.data.offset ?? 0
    );
  }

  @Post(':id/resolve')
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Record completion of an email complaint correction; suppression remains',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['note'],
      additionalProperties: false,
      properties: { note: { type: 'string', minLength: 1, maxLength: 2000 } },
    },
  })
  @ApiResponse({ status: 200, type: Object, description: 'Completed correction task' })
  async resolve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    const parsed = resolutionSchema.safeParse(body);
    if (!parsed.success)
      throw new HttpException({ statusCode: 400, error: 'VALIDATION_INPUT_INVALID' }, 400);
    return this.corrections.resolve(id, parsed.data.note, req.session, req.ip ?? null);
  }
}
