import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { z } from 'zod'
import { ErrorCodes } from '@barghsa/shared/errors'
import {
  GIFT_CODE_DISCOUNT_TYPES,
  GIFT_CODE_ELIGIBILITY,
  GIFT_CODE_STATUSES,
  MAX_GIFT_PERCENT_BPS,
  normalizeGiftCode,
  type GiftCodeDto,
} from '@barghsa/shared/promotions'
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js'
import { StepUpGuard, RequiresStepUp } from '../session/step-up.guard.js'
import { GiftCodeService, type GiftCodeListFilter } from './gift-code.service.js'

// ─── Validation schemas ────────────────────────────────────────────────────

const discountTypeSchema = z.enum(GIFT_CODE_DISCOUNT_TYPES)
const eligibilitySchema = z.enum(GIFT_CODE_ELIGIBILITY)
const statusSchema = z.enum(GIFT_CODE_STATUSES)
const irrSchema = z
  .string()
  .regex(/^\d+$/, 'Expected a non-negative integer IRR amount')
const positiveIrrSchema = z
  .string()
  .regex(/^[1-9]\d*$/, 'Expected a positive integer IRR amount')
const codeSchema = z
  .string()
  .min(1, 'code is required')
  .max(64, 'code must be 64 characters or fewer')
  .transform(normalizeGiftCode)
const profileIdSchema = z.string().uuid('Expected a UUID')
const categorySchema = z.string().min(1).max(40)
const limitSchema = z
  .union([z.number().int().positive(), z.null()])
  .optional()
const dateSchema = z
  .string()
  .datetime({ offset: true })
  .or(z.string().datetime({ local: true }))
  .optional()

const CreateGiftCodeSchema = z.object({
  code: codeSchema,
  discountType: discountTypeSchema,
  discountValue: irrSchema,
  maxCapIrr: z.union([positiveIrrSchema, z.null()]).optional(),
  eligibility: eligibilitySchema.default('public'),
  profileIds: z.array(profileIdSchema).default([]),
  totalLimit: limitSchema,
  perProfileLimit: limitSchema,
  validFrom: dateSchema,
  validUntil: z
    .union([z.string().datetime({ offset: true }).or(z.string().datetime({ local: true })), z.null()])
    .optional(),
  minOrderAmount: irrSchema.default('0'),
  categories: z.array(categorySchema).default([]),
}).refine(
  (data) =>
    data.discountType !== 'fixed_irr' ||
    data.maxCapIrr === undefined ||
    data.maxCapIrr === null,
  {
    path: ['maxCapIrr'],
    message: 'maxCapIrr must not be set for fixed_irr codes',
  },
).refine(
  (data) => data.discountType !== 'percentage' || (data.maxCapIrr !== undefined && data.maxCapIrr !== null),
  {
    path: ['maxCapIrr'],
    message: 'percentage codes require a positive maxCapIrr',
  },
)

// NOTE: built independently (NOT .partial() of the create schema) —
// zod v4 forbids .partial() on refined object schemas, and the update
// contract must not inherit create defaults (a PATCH omitting
// `eligibility` must stay undefined, not default to 'public').
const UpdateGiftCodeSchema = z
  .object({
    code: codeSchema.optional(),
    discountType: discountTypeSchema.optional(),
    discountValue: irrSchema.optional(),
    maxCapIrr: z.union([positiveIrrSchema, z.null()]).optional(),
    eligibility: eligibilitySchema.optional(),
    profileIds: z.array(profileIdSchema).optional(),
    totalLimit: limitSchema,
    perProfileLimit: limitSchema,
    validFrom: dateSchema,
    validUntil: z
      .union([z.string().datetime({ offset: true }).or(z.string().datetime({ local: true })), z.null()])
      .optional(),
    minOrderAmount: irrSchema.optional(),
    categories: z.array(categorySchema).optional(),
  })
  .refine(
    (data) =>
      data.discountType !== 'fixed_irr' ||
      data.maxCapIrr === undefined ||
      data.maxCapIrr === null,
    {
      path: ['maxCapIrr'],
      message: 'maxCapIrr must not be set for fixed_irr codes',
    },
  )

const SetStatusSchema = z.object({
  status: statusSchema,
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

function validationDetails(issues: z.ZodIssue[]): Array<{ path: string; message: string }> {
  return issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
}

/** Validate the optional list filters and return sanitized values. */
function assertListFilters(raw: {
  search?: string | undefined
  status?: string | undefined
  discountType?: string | undefined
}): GiftCodeListFilter {
  const out: GiftCodeListFilter = {}
  if (raw.search !== undefined && raw.search !== '') {
    out.search = normalizeGiftCode(raw.search)
  }
  if (raw.status !== undefined) {
    const parsed = statusSchema.safeParse(raw.status)
    if (!parsed.success) {
      httpError(
        ErrorCodes.VALIDATION_PARSE_ZOD.code,
        `Invalid status: expected one of ${GIFT_CODE_STATUSES.join(', ')}`,
        400,
      )
    }
    out.status = parsed.data
  }
  if (raw.discountType !== undefined) {
    const parsed = discountTypeSchema.safeParse(raw.discountType)
    if (!parsed.success) {
      httpError(
        ErrorCodes.VALIDATION_PARSE_ZOD.code,
        `Invalid discountType: expected one of ${GIFT_CODE_DISCOUNT_TYPES.join(', ')}`,
        400,
      )
    }
    out.discountType = parsed.data
  }
  return out
}

/**
 * Admin endpoints for gift code management (S-09.12, T-09.12.03) — API
 * slice.
 *
 * Security posture (mirrors the S-09 admin controllers, e.g. the VAT
 * controller T-09.12.02):
 * - Every route requires an authenticated session with the
 *   `admin:promotions:edit` capability. Today the session model exposes
 *   only `req.session.isAdmin` (platform admin); granular staff-role
 *   permissions arrive with the role system. Centralized in one
 *   enforcement point per controller.
 * - All mutation endpoints additionally require recent step-up
 *   verification via `@RequiresStepUp()` (StepUpGuard) — gift codes
 *   carry financial value and are sensitive writes.
 *
 * The admin web UI slice (list with search/filter, create/edit form,
 * usage statistics view, active/inactive toggle, high-value percentage
 * warning, fa/en dicts, RTL/a11y) is deferred.
 */
@ApiTags('Admin · Gift Codes')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/admin/promotions/gift-codes')
export class GiftCodeController {
  constructor(private readonly service: GiftCodeService) {}

  /** Single enforcement point for the `admin:promotions:edit` capability. */
  private assertPromotionsPermission(req: AuthenticatedRequest): void {
    if (!(req.session.isAdmin ?? false)) {
      httpError(
        ErrorCodes.AUTHZ_FORBIDDEN.code,
        'Admin role required to manage gift codes',
        HttpStatus.FORBIDDEN,
      )
    }
  }

  @Get()
  @ApiOperation({
    summary: 'List gift codes (admin)',
    description:
      'Newest first, with derived usage totals. Optional filters: ?search= (normalized ' +
      'substring on the code), ?status=active|inactive, ?discountType=fixed_irr|percentage.',
  })
  @ApiResponse({ status: 200, description: 'Gift codes with usage totals.' })
  async list(
    @Req() req: AuthenticatedRequest,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('discountType') discountType?: string,
  ): Promise<GiftCodeDto[]> {
    this.assertPromotionsPermission(req)
    const filters = assertListFilters({ search, status, discountType })
    return this.service.list(filters)
  }

  @Get(':id/stats')
  @ApiOperation({
    summary: 'Gift code usage statistics (admin)',
    description:
      'Per-profile breakdown and the 25 most recent redemptions, plus the code itself ' +
      'with aggregate usage totals.',
  })
  @ApiResponse({ status: 200, description: 'Usage statistics.' })
  async stats(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<ReturnType<GiftCodeService['stats']>> {
    this.assertPromotionsPermission(req)
    assertUuid(id)
    return this.service.stats(id)
  }

  @Post()
  @HttpCode(201)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Create a gift code (admin)',
    description:
      'Code is normalized (trim + uppercase) and must be unique case-insensitively. ' +
      `fixed_irr: discountValue = IRR amount, no cap. percentage: discountValue = basis ` +
      `points (1..${MAX_GIFT_PERCENT_BPS}, 2500 = 25%) and maxCapIrr is REQUIRED. ` +
      'eligible categories are products.type keys; empty = all.',
  })
  @ApiResponse({ status: 201, description: 'Gift code created.' })
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() body: z.infer<typeof CreateGiftCodeSchema>,
  ): Promise<GiftCodeDto> {
    this.assertPromotionsPermission(req)
    const parsed = CreateGiftCodeSchema.safeParse(body)
    if (!parsed.success) {
      httpError(
        ErrorCodes.VALIDATION_PARSE_ZOD.code,
        'Invalid gift code payload',
        400,
        validationDetails(parsed.error.issues),
      )
    }
    return this.service.create({
      code: parsed.data.code,
      discountType: parsed.data.discountType,
      discountValue: parsed.data.discountValue,
      maxCapIrr: parsed.data.maxCapIrr ?? null,
      eligibility: parsed.data.eligibility,
      profileIds: parsed.data.profileIds,
      totalLimit: parsed.data.totalLimit ?? null,
      perProfileLimit: parsed.data.perProfileLimit ?? null,
      ...(parsed.data.validFrom !== undefined ? { validFrom: parsed.data.validFrom } : {}),
      validUntil: parsed.data.validUntil ?? null,
      minOrderAmount: parsed.data.minOrderAmount,
      categories: parsed.data.categories,
      actorUserId: req.session.userId,
      ip: requestIp(req),
    })
  }

  @Patch(':id')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Update a gift code (admin)',
    description:
      'Only provided fields change. Changing the code re-normalizes and re-checks ' +
      'case-insensitive uniqueness. For profile-restricted codes, profileIds is ' +
      'REPLACED when provided; switching eligibility to public clears scopes.',
  })
  @ApiResponse({ status: 200, description: 'Gift code updated.' })
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: z.infer<typeof UpdateGiftCodeSchema>,
  ): Promise<GiftCodeDto> {
    this.assertPromotionsPermission(req)
    assertUuid(id)
    const parsed = UpdateGiftCodeSchema.safeParse(body ?? {})
    if (!parsed.success) {
      httpError(
        ErrorCodes.VALIDATION_PARSE_ZOD.code,
        'Invalid gift code payload',
        400,
        validationDetails(parsed.error.issues),
      )
    }
    const data = parsed.data
    return this.service.update(id, {
      ...(data.code !== undefined ? { code: data.code } : {}),
      ...(data.discountType !== undefined ? { discountType: data.discountType } : {}),
      ...(data.discountValue !== undefined ? { discountValue: data.discountValue } : {}),
      ...(data.maxCapIrr !== undefined ? { maxCapIrr: data.maxCapIrr } : {}),
      ...(data.eligibility !== undefined ? { eligibility: data.eligibility } : {}),
      ...(data.profileIds !== undefined ? { profileIds: data.profileIds } : {}),
      ...(data.totalLimit !== undefined ? { totalLimit: data.totalLimit } : {}),
      ...(data.perProfileLimit !== undefined ? { perProfileLimit: data.perProfileLimit } : {}),
      ...(data.validFrom !== undefined ? { validFrom: data.validFrom } : {}),
      ...(data.validUntil !== undefined ? { validUntil: data.validUntil } : {}),
      ...(data.minOrderAmount !== undefined ? { minOrderAmount: data.minOrderAmount } : {}),
      ...(data.categories !== undefined ? { categories: data.categories } : {}),
      actorUserId: req.session.userId,
      ip: requestIp(req),
    })
  }

  @Post(':id/toggle')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Set gift code status (admin)',
    description:
      'active | inactive. Only active codes can be redeemed. Setting the same status is ' +
      'a no-op (no audit).',
  })
  @ApiResponse({ status: 200, description: 'Gift code status updated.' })
  async setStatus(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: z.infer<typeof SetStatusSchema>,
  ): Promise<GiftCodeDto> {
    this.assertPromotionsPermission(req)
    assertUuid(id)
    const parsed = SetStatusSchema.safeParse(body ?? {})
    if (!parsed.success) {
      httpError(
        ErrorCodes.VALIDATION_PARSE_ZOD.code,
        'Invalid status payload',
        400,
        validationDetails(parsed.error.issues),
      )
    }
    return this.service.setStatus(id, parsed.data.status, req.session.userId, requestIp(req))
  }
}
