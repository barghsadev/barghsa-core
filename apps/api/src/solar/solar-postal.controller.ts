import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiZodBody } from '../openapi/zod-body.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { SolarPostalService } from './solar-postal.service.js';

const guidance = z
  .object({
    fa: z.string().trim().min(1).max(4000),
    en: z.string().trim().min(1).max(4000),
    destinationAddress: z.string().trim().max(2000),
    contactDetails: z.string().trim().max(1000),
    originals: z
      .array(
        z
          .object({ fa: z.string().trim().min(1).max(200), en: z.string().trim().min(1).max(200) })
          .strict()
      )
      .max(30),
  })
  .strict();
const shipment = z
  .object({
    courier: z.string().trim().min(1).max(100),
    trackingNumber: z.string().trim().min(1).max(200),
    sendDate: z.iso.date(),
    receiptImageId: z.string().uuid().optional(),
  })
  .strict();
const issue = z.object({ reason: z.string().trim().min(1).max(1000) }).strict();
function parse<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body);
  if (!result.success) throw new BadRequestException('Invalid postal request');
  return result.data as z.output<S>;
}

@ApiTags('Solar postal documents')
@ApiBearerAuth()
@Controller('api/solar')
@UseGuards(SessionAuthGuard)
export class SolarPostalController {
  constructor(private readonly service: SolarPostalService) {}

  @Get('postal-guidance')
  @ApiOperation({ summary: 'Read postal destination and original-document guidance' })
  guidance() {
    return this.service.guidance();
  }

  @Get('requests/:id/postal')
  @ApiOperation({ summary: 'Read postal shipment state for a solar request' })
  state(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    return this.service.customerState(req.session, id);
  }

  @Post('requests/:id/postal/shipment')
  @HttpCode(200)
  @RateLimit({ namespace: 'solar:postal:shipment', limit: 10, windowMs: 60_000 })
  @ApiOperation({
    summary: 'Record customer courier, tracking, send date and optional receipt image',
  })
  @ApiZodBody(shipment)
  shipment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    return this.service.shipment(req.session, id, parse(shipment, body), req.ip ?? '127.0.0.1');
  }
}

@ApiTags('Admin · Solar postal documents')
@ApiBearerAuth()
@Controller('api/admin/solar')
@UseGuards(SessionAuthGuard)
export class StaffSolarPostalController {
  constructor(private readonly service: SolarPostalService) {}

  @Get('postal-guidance')
  @ApiOperation({ summary: 'Read editable postal guidance' })
  guidance() {
    return this.service.guidance();
  }

  @Put('postal-guidance')
  @ApiOperation({ summary: 'Edit postal address, contact and original-document guidance' })
  @ApiZodBody(guidance)
  setGuidance(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    return this.service.setGuidance(req.session, parse(guidance, body), req.ip ?? '127.0.0.1');
  }

  @Get('postal-queue')
  @ApiOperation({ summary: 'List solar requests in the postal stage' })
  @ApiQuery({ name: 'before', required: false, format: 'uuid' })
  queue(@Req() req: AuthenticatedRequest, @Query('before') before?: string) {
    if (before && !z.string().uuid().safeParse(before).success)
      throw new BadRequestException('Invalid solar postal cursor');
    return this.service.staffQueue(req.session, before);
  }

  @Post('requests/:id/postal/confirm-received')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm receipt of postal originals' })
  received(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    return this.service.decide(req.session, id, 'received', undefined, req.ip ?? '127.0.0.1');
  }

  @Post('requests/:id/postal/mark-incomplete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark postal originals incomplete with a reason' })
  @ApiZodBody(issue)
  incomplete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    return this.service.decide(
      req.session,
      id,
      'incomplete',
      parse(issue, body).reason,
      req.ip ?? '127.0.0.1'
    );
  }

  @Post('requests/:id/postal/mark-not-received')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark postal originals not received with a reason' })
  @ApiZodBody(issue)
  notReceived(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest
  ) {
    return this.service.decide(
      req.session,
      id,
      'not_received',
      parse(issue, body).reason,
      req.ip ?? '127.0.0.1'
    );
  }
}
