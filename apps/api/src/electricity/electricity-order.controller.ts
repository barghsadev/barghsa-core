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
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { validatePostalCode } from '@barghsa/shared/validation';
import { ApiZodBody } from '../openapi/zod-body.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { ElectricityOrderService } from './electricity-order.service.js';
import { simplePeriodOptions } from './electricity-order.service.js';
import { ElectricityBillDataService } from './electricity-bill-data.service.js';

const simpleInput = z
  .object({
    profileId: z.string().uuid(),
    period: z.enum(['current_month', 'next_month', 'current_week', 'next_week', 'week_after_next']),
    totalKwh: z
      .string()
      .regex(/^[1-9]\d*$/)
      .max(19),
    giftCode: z.string().trim().min(1).max(100).optional(),
  })
  .strict();
const submitInput = simpleInput
  .extend({
    idempotencyKey: z.string().uuid(),
    expectedQuoteDigest: z.string().regex(/^[a-f0-9]{64}$/),
    address: z
      .object({
        provinceId: z.string().uuid(),
        cityId: z.string().uuid(),
        fullAddress: z.string().trim().min(1).max(500),
        postalCode: z.string().trim().refine(validatePostalCode),
      })
      .strict(),
  })
  .strict();

@ApiTags('Electricity')
@Controller('api/electricity')
@UseGuards(SessionAuthGuard)
export class ElectricityOrderController {
  constructor(
    private readonly service: ElectricityOrderService,
    private readonly billData: ElectricityBillDataService
  ) {}

  @Get('periods/simple')
  @RateLimit({ namespace: 'electricity:periods:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Available server-calculated Jalali month and week periods' })
  @ApiResponse({ status: 200, description: 'Five selectable period ranges in Iran time.' })
  periods() {
    return { periods: simplePeriodOptions(new Date()) };
  }

  @Get('bill-data/:profileId')
  @RateLimit({ namespace: 'electricity:bill-data:user', limit: 30, windowMs: 60_000 })
  @ApiOperation({ summary: 'Historical hourly bill-data estimate, with manual-entry fallback' })
  @ApiResponse({ status: 200, description: 'Estimate or a non-blocking unavailable reason.' })
  async getBillData(
    @Param('profileId', new ParseUUIDPipe()) profileId: string,
    @Query('period') period: string,
    @Req() req: AuthenticatedRequest
  ) {
    const selected = z
      .enum(['current_month', 'next_month', 'current_week', 'next_week', 'week_after_next'])
      .safeParse(period);
    if (!selected.success) throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    return this.billData.get(req.session, profileId, selected.data);
  }

  @Post('preview/simple')
  @HttpCode(200)
  @RateLimit({ namespace: 'electricity:preview:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Quote a simple electricity order using current authoritative prices' })
  @ApiZodBody(simpleInput)
  @ApiResponse({ status: 200, description: 'Current period, lines, discount, VAT and total.' })
  async preview(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const parsed = simpleInput.safeParse(body);
    if (!parsed.success) throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    return this.service.preview(req.session, parsed.data);
  }

  @Post('orders/simple')
  @HttpCode(201)
  @RateLimit({ namespace: 'electricity:submit:user', limit: 20, windowMs: 60_000 })
  @ApiOperation({
    summary: 'Submit a simple electricity order with contract and invoice atomically',
  })
  @ApiZodBody(submitInput)
  @ApiResponse({ status: 201, description: 'Submitted order, contract, invoice and frozen quote.' })
  async submit(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const parsed = submitInput.safeParse(body);
    if (!parsed.success) throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    return this.service.submit(req.session, parsed.data, req.ip ?? 'unknown');
  }
}
