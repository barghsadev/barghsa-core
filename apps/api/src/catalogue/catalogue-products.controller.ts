import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { z } from 'zod'
import { ErrorCodes } from '@barghsa/shared/errors'
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js'
import { StepUpGuard, RequiresStepUp } from '../session/step-up.guard.js'
import {
  CatalogueProductsService,
  CONSULTATION_CATEGORIES,
  ELECTRICITY_CATEGORIES,
  PRODUCT_TYPES,
  type LocalizedText,
  type ProductCategory,
  type ProductDetailDto,
  type ProductDto,
  type ProductType,
} from './catalogue-products.service.js'

// ─── Validation schemas ────────────────────────────────────────────────────

const typeSchema = z.enum(PRODUCT_TYPES)
/** Product types admin can create: electricity is the immutable system set. */
const creatableTypeSchema = typeSchema.exclude(['electricity'])
const statusSchema = z.enum(['active', 'inactive'])
const localizedTextSchema = z.object({
  fa: z.string().min(1, 'Persian title is required').max(300),
  en: z.string().min(1, 'English title is required').max(300),
})
const descriptionSchema = z.object({
  fa: z.string().max(4000).optional().default(''),
  en: z.string().max(4000).optional().default(''),
})
const categorySchema = z.enum([...CONSULTATION_CATEGORIES, ...ELECTRICITY_CATEGORIES])
// IRR amounts are BIGINT columns; accept digits-only strings up to 18 digits
// (safe within BIGINT range) and reject anything else before it reaches PG.
const irrPriceSchema = z
  .string()
  .regex(/^\d{1,18}$/, 'Price must be a non-negative integer in IRR (up to 18 digits)')
const kwhSchema = z
  .string()
  .regex(/^\d{1,18}$/, 'kWh value must be a non-negative integer')

export const CreateProductSchema = z.object({
  type: creatableTypeSchema,
  title: localizedTextSchema,
  description: descriptionSchema.optional(),
  price: irrPriceSchema.nullable().optional(),
  status: statusSchema.optional(),
  categories: z.array(categorySchema).max(10, 'At most 10 categories').optional(),
})

export const UpdateProductSchema = z
  .object({
    title: localizedTextSchema.optional(),
    description: descriptionSchema.nullable().optional(),
    status: statusSchema.optional(),
    categories: z.array(categorySchema).max(10, 'At most 10 categories').optional(),
    minKwh: kwhSchema.optional(),
    maxKwh: kwhSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'At least one field must be provided')

export const AddPriceSchema = z.object({
  price: irrPriceSchema,
  effectiveFrom: z
    .string()
    .datetime({ offset: true })
    .or(z.string().datetime({ local: true }))
    .optional(),
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

/** Validate an optional `?type=` query filter. */
function assertTypeFilter(raw: string | undefined, typeName = 'type'): ProductType | undefined {
  if (raw === undefined) return undefined
  const parsed = typeSchema.safeParse(raw)
  if (!parsed.success) {
    httpError(
      ErrorCodes.VALIDATION_PARSE_ZOD.code,
      `Invalid ${typeName}: expected one of ${PRODUCT_TYPES.join(', ')}`,
      400,
    )
  }
  return parsed.data
}

function validationDetails(issues: z.ZodIssue[]): Array<{ path: string; message: string }> {
  return issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
}

/**
 * Admin endpoints for product catalogue management (S-09.12, T-09.12.01) —
 * API slice.
 *
 * Security posture (mirrors the S-09 admin controllers, e.g. T-09.11.04):
 * - Every route requires an authenticated session with the
 *   `admin:catalogue:edit` capability. Today the session model exposes
 *   only `req.session.isAdmin` (platform admin); granular staff-role
 *   permissions arrive with the role system. Centralized in one
 *   enforcement point per controller.
 * - All mutation endpoints additionally require recent step-up
 *   verification via `@RequiresStepUp()` (StepUpGuard) — pricing and
 *   catalogue structure changes are sensitive writes.
 *
 * The tabbed admin web UI (list/add/edit per type, price history view,
 * fa/en dictionaries, RTL/a11y) lands with the UI slice; these endpoints
 * ship the durable catalogue API consumed by that UI.
 */
@ApiTags('Admin · Product Catalogue')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/admin/catalogue/products')
export class CatalogueProductsController {
  constructor(private readonly service: CatalogueProductsService) {}

  /** Single enforcement point for the `admin:catalogue:edit` capability. */
  private assertCataloguePermission(req: AuthenticatedRequest): void {
    if (!(req.session.isAdmin ?? false)) {
      httpError(
        ErrorCodes.AUTHZ_FORBIDDEN.code,
        'Admin role required to manage the product catalogue',
        HttpStatus.FORBIDDEN,
      )
    }
  }

  @Get()
  @ApiOperation({ summary: 'List catalogue products (admin)' })
  @ApiResponse({ status: 200, description: 'All products (optionally by type), newest first.' })
  async list(
    @Req() req: AuthenticatedRequest,
    @Query('type') type?: string,
  ): Promise<ProductDto[]> {
    this.assertCataloguePermission(req)
    return this.service.list(assertTypeFilter(type))
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single catalogue product (admin)' })
  @ApiResponse({ status: 200, description: 'The product with its versioned price history.' })
  async get(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<ProductDetailDto> {
    this.assertCataloguePermission(req)
    assertUuid(id)
    return this.service.get(id)
  }

  @Post()
  @HttpCode(201)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Create a catalogue product (admin)',
    description:
      'Creates a product of type consultation, hardware, or saving_plan ' +
      '(electricity products are the immutable system fixtures). Optional ' +
      'initial price seeds the first versioned price record.',
  })
  @ApiResponse({ status: 201, description: 'Catalogue product created.' })
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() body: z.infer<typeof CreateProductSchema>,
  ): Promise<ProductDetailDto> {
    this.assertCataloguePermission(req)
    const parsed = CreateProductSchema.safeParse(body)
    if (!parsed.success) {
      httpError(
        ErrorCodes.VALIDATION_PARSE_ZOD.code,
        'Invalid catalogue product payload',
        400,
        validationDetails(parsed.error.issues),
      )
    }
    const d = parsed.data
    const description: LocalizedText | null =
      d.description === undefined ? null : { fa: d.description.fa, en: d.description.en }
    return this.service.create({
      type: d.type,
      title: d.title,
      description,
      price: d.price ?? null,
      status: d.status ?? 'inactive',
      categories: (d.categories ?? []) as ProductCategory[],
      actorUserId: req.session.userId,
      ip: requestIp(req),
    })
  }

  @Put(':id')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Update a catalogue product (admin)',
    description:
      'Partial update of title, description, status (active/inactive), ' +
      'categories (full-set replace), or electricity limits. type and ' +
      'system_key are immutable.',
  })
  @ApiResponse({ status: 200, description: 'Catalogue product updated.' })
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: z.infer<typeof UpdateProductSchema>,
  ): Promise<ProductDetailDto> {
    this.assertCataloguePermission(req)
    assertUuid(id)
    const parsed = UpdateProductSchema.safeParse(body)
    if (!parsed.success) {
      httpError(
        ErrorCodes.VALIDATION_PARSE_ZOD.code,
        'Invalid catalogue product payload',
        400,
        validationDetails(parsed.error.issues),
      )
    }
    const d = parsed.data
    return this.service.update(id, {
      ...(d.title !== undefined ? { title: d.title } : {}),
      ...(d.description !== undefined
        ? {
            description:
              d.description === null ? null : { fa: d.description.fa, en: d.description.en },
          }
        : {}),
      ...(d.status !== undefined ? { status: d.status } : {}),
      ...(d.categories !== undefined ? { categories: d.categories as ProductCategory[] } : {}),
      ...(d.minKwh !== undefined ? { minKwh: d.minKwh } : {}),
      ...(d.maxKwh !== undefined ? { maxKwh: d.maxKwh } : {}),
      actorUserId: req.session.userId,
      ip: requestIp(req),
    })
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Archive a catalogue product (admin)',
    description:
      'Soft delete: sets status to archived. Products are never hard-deleted — ' +
      'order references are FK-protected and must stay valid. System products ' +
      'cannot be archived.',
  })
  @ApiResponse({ status: 204, description: 'Catalogue product archived.' })
  async archive(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<void> {
    this.assertCataloguePermission(req)
    assertUuid(id)
    return this.service.archive(id, req.session.userId, requestIp(req))
  }

  @Post(':id/prices')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Add a versioned price change (admin)',
    description:
      'Appends a new price version effective from `effectiveFrom` (default: ' +
      'now). The previously-open version is closed at that moment. An exact ' +
      're-submit of the active price is a no-op.',
  })
  @ApiResponse({ status: 200, description: 'Price version added; product price history returned.' })
  async addPrice(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: z.infer<typeof AddPriceSchema>,
  ): Promise<ProductDetailDto> {
    this.assertCataloguePermission(req)
    assertUuid(id)
    const parsed = AddPriceSchema.safeParse(body)
    if (!parsed.success) {
      httpError(
        ErrorCodes.VALIDATION_PARSE_ZOD.code,
        'Invalid price payload',
        400,
        validationDetails(parsed.error.issues),
      )
    }
    return this.service.addPrice({
      productId: id,
      price: parsed.data.price,
      effectiveFrom: parsed.data.effectiveFrom ?? new Date().toISOString(),
      actorUserId: req.session.userId,
      ip: requestIp(req),
    })
  }
}
