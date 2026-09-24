import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { InvoiceLedgerService } from './invoice-ledger.service.js';

const QuerySchema = z
  .object({
    state: z
      .enum([
        'Draft',
        'Unpaid',
        'PaymentUnderReview',
        'PartiallyFunded',
        'Paid',
        'Overdue',
        'Cancelled',
        'PartiallyRefunded',
        'Refunded',
      ])
      .optional(),
    invoiceId: z.string().uuid().optional(),
    beforeAt: z.string().datetime({ offset: true }).optional(),
    beforeId: z.string().uuid().optional(),
  })
  .strict()
  .refine((value) => Boolean(value.beforeAt) === Boolean(value.beforeId));

@ApiTags('Admin · Invoice ledger')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/admin/invoices/ledger')
export class InvoiceLedgerController {
  constructor(private readonly service: InvoiceLedgerService) {}

  private assertPermission(req: AuthenticatedRequest): void {
    if (!hasStaffPermission(req, 'invoices:read'))
      throw new ForbiddenException('Invoice read permission required');
  }

  @Get()
  @ApiOperation({ summary: 'List invoices for finance staff, newest first' })
  @ApiQuery({ name: 'state', required: false })
  @ApiQuery({ name: 'invoiceId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'beforeAt', required: false, format: 'date-time' })
  @ApiQuery({ name: 'beforeId', required: false, format: 'uuid' })
  async list(@Req() req: AuthenticatedRequest, @Query() raw: Record<string, unknown>) {
    this.assertPermission(req);
    const parsed = QuerySchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException('Invalid invoice filters');
    return this.service.list(req.session, parsed.data);
  }

  @Get(':invoiceId')
  @ApiOperation({ summary: 'Get invoice lines and payment activity for finance staff' })
  @ApiParam({ name: 'invoiceId', format: 'uuid' })
  async get(@Req() req: AuthenticatedRequest, @Param('invoiceId') invoiceId: string) {
    this.assertPermission(req);
    if (!z.string().uuid().safeParse(invoiceId).success)
      throw new BadRequestException('Invalid invoice ID');
    return this.service.get(req.session, invoiceId);
  }
}
