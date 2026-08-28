import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { z } from 'zod'
import { ErrorCodes } from '@barghsa/shared/errors'
import {
  CHARGE_CATEGORIES,
  PRODUCT_OVERRIDE_CATEGORY,
  type VatConfigDto,
  type VatProductOverrideDto,
  type VatResolution,
} from '@barghsa/shared/finance'
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js'
import { StepUpGuard, RequiresStepUp } from '../session/step-up.guard.js'
import { VatConfigService } from './vat-config.service.js'

// ─── Validation schemas ────────────────────────────────────────────────────

const categorySchema = z.enum([...CHARGE_CATEGORIES, PRODUCT_OVERRIDE_CATEGORY])
const bpsSchema = z.number().int().min(0).max(10_000)
const effectiveDateSchema = z
  .string()
  .datetime({ offset: true })
  .or(z.string().datetime({ local: true }))
  .optional()

export const CreateVatRateSchema = z.object({
  category: categorySchema,
  rateBasisPoints: bpsSchema,
  effectiveFrom: effectiveDateSchema,
})

export const EndVatRateSchema = z.object({
  effectiveUntil: effectiveDateSchema,
})

export const CreateProductOverrideSchema = z.object({
  productId: z.string().uuid('Expected a UUID'),
  vatConfigId: z.string().uuid('Expected a UUID'),
  effectiveFrom: effectiveDateSchema,
})

export const EndProductOverrideSchema = z.object({
  effectiveUntil: effectiveDateSchema,
})

function httpError(
  code: string,
  message: string,
  statusCode = 400,
  details?: unknown,
): never {
  throw new HttpException(
    { statusCode, error: code, message, ...(details ? { details } : {}) },
    statusCode,
  )
}

function requestIp(req: AuthenticatedRequest): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown'
}

/** Validate a route @Param id as a UUID, surfacing 400 instead of a DB 500. */
function assertUuid(id: string, label = 'id'): void {
  const parsed = z.string().uuid('Expected a UUID').safeParse(id)
  if (!parsed.success) {
    httpError(ErrorCodes.VALIDATION_PARSE_ZOD.code, `Invalid ${label}: expected a UUID`, 400)
  }
}

/** Validate an optional `?category=` query filter. */
function assertCategoryFilter(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined
  const parsed = categorySchema.safeParse(raw)
  if (!parsed.success) {
    httpError(
      ErrorCodes.VALIDATION_PARSE_ZOD.code,
      `Invalid category: expected one of ${CHARGE_CATEGORIES.join(', ')}`,
      400,
    )
  }
  return parsed.data
}

function validationDetails(issues: z.ZodIssue[]): Array<{ path: string; message: string }> {
  return issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
}

/**
 * Admin endpoints for VAT configuration (S-09.12, T-09.12.02) — API slice.
 *
 * Security posture (mirrors the S-09 admin controllers, e.g. the
 * catalogue controller T-09.12.01):
 * - Every route requires an authenticated session with the
 *   `admin:finance:edit` capability. Today the session model exposes
 *   only `req.session.isAdmin` (platform admin); granular staff-role
 *   permissions arrive with the role system. Centralized in one
 *   enforcement point per controller.
 * - All mutation endpoints additionally require recent step-up
 *   verification via `@RequiresStepUp()` (StepUpGuard) — VAT rates are
 *   financial configuration and sensitive writes.
 *
 * The admin web UI slice (table: category/product, rate, effective
 * from, status; add future-effective rate; product override toggle;
 * fa/en dicts, RTL/a11y) is deferred.
 */
@ApiTags('Admin · VAT Configuration')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/admin/finance/vat')
export class VatConfigController {
  constructor(private readonly service: VatConfigService) {}

  /** Single enforcement point for the `admin:finance:edit` capability. */
  private assertFinancePermission(req: AuthenticatedRequest): void {
    if (!(req.session.isAdmin ?? false)) {
      httpError(
        ErrorCodes.AUTHZ_FORBIDDEN.code,
        'Admin role required to manage VAT configuration',
        HttpStatus.FORBIDDEN,
      )
    }
  }

  @Get()
  @ApiOperation({ summary: 'List VAT rates (admin)' })
  @ApiResponse({ status: 200, description: 'Versioned VAT rates by category, newest first.' })
  async list(
    @Req() req: AuthenticatedRequest,
    @Query('category') category?: string,
  ): Promise<VatConfigDto[]> {
    this.assertFinancePermission(req)
    return this.service.list(assertCategoryFilter(category))
  }

  @Get('overrides')
  @ApiOperation({ summary: 'List product VAT overrides (admin)' })
  @ApiResponse({ status: 200, description: 'All product overrides with linked rates.' })
  async listOverrides(@Req() req: AuthenticatedRequest): Promise<VatProductOverrideDto[]> {
    this.assertFinancePermission(req)
    return this.service.listOverrides()
  }

  @Get('resolve')
  @ApiOperation({
    summary: 'Resolve a VAT rate at a point in time (admin/invoice seam)',
    description:
      'Product override wins; category active rate applies otherwise; 0% fallback. ' +
      'Used by the invoice snapshot seam (T-03.02.05.03) and admin preview.',
  })
  @ApiResponse({ status: 200, description: 'The resolved rate and its source rule.' })
  async resolve(
    @Req() req: AuthenticatedRequest,
    @Query('productId') productId?: string,
    @Query('category') category?: string,
    @Query('at') at?: string,
  ): Promise<VatResolution> {
    this.assertFinancePermission(req)
    if (productId !== undefined) assertUuid(productId, 'productId')
    if (at !== undefined) {
      const parsed = effectiveDateSchema.safeParse(at)
      if (!parsed.success) {
        httpError(
          ErrorCodes.VALIDATION_PARSE_ZOD.code,
          'Invalid at: expected an ISO-8601 timestamp',
          400,
        )
      }
    }
    const categoryFiltered = category !== undefined ? assertCategoryFilter(category) : undefined
    return this.service.resolve({
      ...(productId !== undefined ? { productId } : {}),
      ...(categoryFiltered !== undefined ? { category: categoryFiltered } : {}),
      ...(at !== undefined ? { at } : {}),
    })
  }

  @Post()
  @HttpCode(201)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Record a versioned VAT rate (admin)',
    description:
      'Appends a new rate for a charge category effective from `effectiveFrom` ' +
      '(default: now). The previously-open rate for the category is closed at that ' +
      'moment. Future-dated rates are allowed (scheduled). An exact re-submit of the ' +
      'open rate is a no-op.',
  })
  @ApiResponse({ status: 201, description: 'VAT rate recorded.' })
  async createRate(
    @Req() req: AuthenticatedRequest,
    @Body() body: z.infer<typeof CreateVatRateSchema>,
  ): Promise<VatConfigDto> {
    this.assertFinancePermission(req)
    const parsed = CreateVatRateSchema.safeParse(body)
    if (!parsed.success) {
      httpError(
        ErrorCodes.VALIDATION_PARSE_ZOD.code,
        'Invalid VAT rate payload',
        400,
        validationDetails(parsed.error.issues),
      )
    }
    return this.service.createRate({
      category: parsed.data.category,
      rateBasisPoints: parsed.data.rateBasisPoints,
      ...(parsed.data.effectiveFrom !== undefined ? { effectiveFrom: parsed.data.effectiveFrom } : {}),
      actorUserId: req.session.userId,
      ip: requestIp(req),
    })
  }

  @Post(':id/end')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'End-date a VAT rate (admin)',
    description:
      'Soft close: sets `effectiveUntil` (default: now). Rates are never hard-deleted — ' +
      'history is preserved for invoice snapshotting. Ending an already-ended rate is a no-op.',
  })
  @ApiResponse({ status: 200, description: 'VAT rate ended.' })
  async endRate(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: z.infer<typeof EndVatRateSchema>,
  ): Promise<VatConfigDto> {
    this.assertFinancePermission(req)
    assertUuid(id)
    const parsed = EndVatRateSchema.safeParse(body ?? {})
    if (!parsed.success) {
      httpError(
        ErrorCodes.VALIDATION_PARSE_ZOD.code,
        'Invalid VAT rate payload',
        400,
        validationDetails(parsed.error.issues),
      )
    }
    return this.service.endRate({
      id,
      ...(parsed.data.effectiveUntil !== undefined ? { effectiveUntil: parsed.data.effectiveUntil } : {}),
      actorUserId: req.session.userId,
      ip: requestIp(req),
    })
  }

  @Post('overrides')
  @HttpCode(201)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Create a product VAT override (admin)',
    description:
      'While the override is active, the product uses the linked vatConfig\'s rate ' +
      'instead of its category default. The previously-open override for the product ' +
      'is closed at the new effectiveFrom.',
  })
  @ApiResponse({ status: 201, description: 'Product VAT override created.' })
  async createOverride(
    @Req() req: AuthenticatedRequest,
    @Body() body: z.infer<typeof CreateProductOverrideSchema>,
  ): Promise<VatProductOverrideDto> {
    this.assertFinancePermission(req)
    const parsed = CreateProductOverrideSchema.safeParse(body)
    if (!parsed.success) {
      httpError(
        ErrorCodes.VALIDATION_PARSE_ZOD.code,
        'Invalid product override payload',
        400,
        validationDetails(parsed.error.issues),
      )
    }
    return this.service.createProductOverride({
      productId: parsed.data.productId,
      vatConfigId: parsed.data.vatConfigId,
      ...(parsed.data.effectiveFrom !== undefined ? { effectiveFrom: parsed.data.effectiveFrom } : {}),
      actorUserId: req.session.userId,
      ip: requestIp(req),
    })
  }

  @Post('overrides/:id/end')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'End-date a product VAT override (admin)',
    description:
      'Soft close: sets `effectiveUntil` (default: now). Overrides are never hard-deleted. ' +
      'Ending an already-ended override is a no-op.',
  })
  @ApiResponse({ status: 200, description: 'Product VAT override ended.' })
  async endOverride(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: z.infer<typeof EndProductOverrideSchema>,
  ): Promise<VatProductOverrideDto> {
    this.assertFinancePermission(req)
    assertUuid(id)
    const parsed = EndProductOverrideSchema.safeParse(body ?? {})
    if (!parsed.success) {
      httpError(
        ErrorCodes.VALIDATION_PARSE_ZOD.code,
        'Invalid product override payload',
        400,
        validationDetails(parsed.error.issues),
      )
    }
    return this.service.endProductOverride({
      id,
      ...(parsed.data.effectiveUntil !== undefined ? { effectiveUntil: parsed.data.effectiveUntil } : {}),
      actorUserId: req.session.userId,
      ip: requestIp(req),
    })
  }
}
