/**
 * Customer invoice API (T-04.1.05.04).
 *
 * Authenticated customers read invoices for their active profile:
 *   GET /api/invoices              → list (non-draft)
 *   GET /api/invoices/:invoiceId   → details + correction chain
 *
 * Details include the original invoice and every linked replacement or
 * adjustment, each with the staff-supplied explanation of the change.
 */

import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import { z } from 'zod'
import { ErrorCodes } from '@barghsa/shared/errors'
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js'
import { RateLimit } from '../rate-limit/rate-limit.decorator.js'
import {
  CustomerInvoiceDetailsService,
  type CustomerInvoiceDetailsDto,
  type CustomerInvoiceListDto,
} from './customer-invoice-details.service.js'

function httpError(
  code: string,
  message: string,
  statusCode = 400,
): never {
  throw new HttpException({ statusCode, error: code, message }, statusCode)
}

function assertUuid(id: string, label = 'invoiceId'): void {
  const parsed = z.string().uuid('Expected a UUID').safeParse(id)
  if (!parsed.success) {
    httpError(
      ErrorCodes.VALIDATION_PARSE_ZOD.code,
      `Invalid ${label}: expected a UUID`,
      HttpStatus.BAD_REQUEST,
    )
  }
}

@ApiTags('Invoices')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/invoices')
export class CustomerInvoiceController {
  constructor(private readonly service: CustomerInvoiceDetailsService) {}

  @Get()
  @RateLimit({ namespace: 'invoices:list:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({
    summary: 'List invoices for the active profile',
    description:
      'Returns non-draft invoices on the caller\'s active profile, newest first.',
  })
  @ApiResponse({ status: 200, description: 'Invoice list for the active profile.' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'No active profile' })
  async list(@Req() req: AuthenticatedRequest): Promise<CustomerInvoiceListDto> {
    return this.service.listForUser(req.session.userId)
  }

  @Get(':invoiceId')
  @RateLimit({ namespace: 'invoices:get:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({
    summary: 'Get invoice details with the correction chain',
    description:
      'Returns the requested invoice plus the original and every linked ' +
      'replacement or adjustment, each with a customer-visible explanation.',
  })
  @ApiParam({ name: 'invoiceId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Invoice details and correction chain.' })
  @ApiResponse({ status: 400, description: 'invoiceId is not a UUID' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 404, description: 'Invoice not found for the active profile' })
  async get(
    @Req() req: AuthenticatedRequest,
    @Param('invoiceId') invoiceId: string,
  ): Promise<CustomerInvoiceDetailsDto> {
    assertUuid(invoiceId)
    return this.service.getForUser(req.session.userId, invoiceId)
  }
}
