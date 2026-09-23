import { Body, Controller, Get, HttpException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiZodBody } from '../openapi/zod-body.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { RequiresStepUp, StepUpGuard } from '../session/step-up.guard.js';
import {
  ElectricityPriceAdjustmentService,
  cancelPriceAdjustmentSchema,
  finalizePriceAdjustmentSchema,
  proposePriceAdjustmentSchema,
} from './electricity-price-adjustment.service.js';

const idSchema = z.string().uuid();
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
  return parsed.data;
}

@ApiTags('Electricity contract changes')
@ApiBearerAuth()
@Controller('api/electricity/contracts/:id/price-adjustments')
@UseGuards(SessionAuthGuard)
export class CustomerElectricityPriceAdjustmentController {
  constructor(private readonly service: ElectricityPriceAdjustmentService) {}

  @Get()
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Read disclosed electricity price proposals and completed adjustments' })
  get(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.service.customer(parse(idSchema, id), req.session);
  }
}

@ApiTags('Staff · Electricity contract changes')
@ApiBearerAuth()
@Controller('api/staff/electricity')
@UseGuards(SessionAuthGuard, StepUpGuard)
export class StaffElectricityPriceAdjustmentController {
  constructor(private readonly service: ElectricityPriceAdjustmentService) {}

  @Get('contracts/:id/price-adjustments')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Read electricity contract price adjustment history' })
  async get(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    if (!hasStaffPermission(req, 'contracts:read') && !hasStaffPermission(req, 'contracts:write'))
      throw new HttpException({ error: 'AUTHZ:FORBIDDEN' }, 403);
    const result = await this.service.staff(parse(idSchema, id));
    const canCancel = hasStaffPermission(req, 'contracts:write');
    return {
      ...result,
      canPropose: result.canPropose && canCancel,
      canCancel,
      canFinalize: canCancel && hasStaffPermission(req, 'invoices:write'),
    };
  }

  @Post('contracts/:id/price-adjustments')
  @RequiresStepUp()
  @RateLimit({ namespace: 'electricity:price-proposal:user', limit: 10, windowMs: 60_000 })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Publish a future electricity price adjustment for customer review' })
  @ApiZodBody(proposePriceAdjustmentSchema)
  propose(@Param('id') id: string, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    if (!hasStaffPermission(req, 'contracts:write'))
      throw new HttpException({ error: 'AUTHZ:FORBIDDEN' }, 403);
    return this.service.propose(
      parse(idSchema, id),
      parse(proposePriceAdjustmentSchema, body),
      req.session,
      req.ip ?? '127.0.0.1'
    );
  }

  @Post('price-adjustments/:adjustmentId/finalize')
  @RequiresStepUp()
  @RateLimit({ namespace: 'electricity:price-finalize:user', limit: 10, windowMs: 60_000 })
  @ApiParam({ name: 'adjustmentId', format: 'uuid' })
  @ApiOperation({
    summary: 'Finalize a disclosed future price change and issue a charge or credit',
  })
  @ApiZodBody(finalizePriceAdjustmentSchema)
  finalize(
    @Param('adjustmentId') id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    if (!hasStaffPermission(req, 'contracts:write') || !hasStaffPermission(req, 'invoices:write'))
      throw new HttpException({ error: 'AUTHZ:FORBIDDEN' }, 403);
    return this.service.finalize(
      parse(idSchema, id),
      parse(finalizePriceAdjustmentSchema, body),
      req.session,
      req.ip ?? '127.0.0.1'
    );
  }

  @Post('price-adjustments/:adjustmentId/cancel')
  @RequiresStepUp()
  @RateLimit({ namespace: 'electricity:price-cancel:user', limit: 10, windowMs: 60_000 })
  @ApiParam({ name: 'adjustmentId', format: 'uuid' })
  @ApiOperation({
    summary: 'Cancel a disclosed electricity price proposal without issuing an invoice',
  })
  @ApiZodBody(cancelPriceAdjustmentSchema)
  cancel(
    @Param('adjustmentId') id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    if (!hasStaffPermission(req, 'contracts:write'))
      throw new HttpException({ error: 'AUTHZ:FORBIDDEN' }, 403);
    return this.service.cancel(
      parse(idSchema, id),
      parse(cancelPriceAdjustmentSchema, body),
      req.session,
      req.ip ?? '127.0.0.1'
    );
  }
}
