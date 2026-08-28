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
  GLOBAL_MAX_UPLOAD_POLICY_SIZE_BYTES,
  MAX_UPLOAD_POLICY_EXTENSIONS,
  UPLOAD_POLICY_CATEGORIES,
  type UploadPolicyDto,
} from '@barghsa/shared/admin'
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js'
import { StepUpGuard, RequiresStepUp } from '../session/step-up.guard.js'
import { UploadPolicyService } from './upload-policy.service.js'

// ─── Validation schemas ────────────────────────────────────────────────────

const categorySchema = z.enum([...UPLOAD_POLICY_CATEGORIES])
const effectiveDateSchema = z
  .string()
  .datetime({ offset: true })
  .or(z.string().datetime({ local: true }))
  .optional()

export const CreateUploadPolicySchema = z.object({
  category: categorySchema,
  allowedExtensions: z
    .array(z.string())
    .min(1, 'At least one extension is required')
    .max(MAX_UPLOAD_POLICY_EXTENSIONS, `At most ${MAX_UPLOAD_POLICY_EXTENSIONS} extensions`)
    .refine(
      (exts) => exts.every((ext) => /^\.[a-z0-9]{1,10}$/.test(ext.trim().toLowerCase())),
      'Extensions must be lowercase .ext tokens, e.g. ".pdf"',
    ),
  maxSizeBytes: z
    .number()
    .int('maxSizeBytes must be an integer')
    .min(1, 'maxSizeBytes must be at least 1 byte')
    .max(
      GLOBAL_MAX_UPLOAD_POLICY_SIZE_BYTES,
      `maxSizeBytes cannot exceed the ${GLOBAL_MAX_UPLOAD_POLICY_SIZE_BYTES}-byte global deployment cap`,
    ),
  effectiveFrom: effectiveDateSchema,
})

export const EndUploadPolicySchema = z.object({
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
      `Invalid category: expected one of ${UPLOAD_POLICY_CATEGORIES.join(', ')}`,
      400,
    )
  }
  return parsed.data
}

function validationDetails(issues: z.ZodIssue[]): Array<{ path: string; message: string }> {
  return issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
}

/**
 * Admin endpoints for upload policy configuration (S-09.12, T-09.12.05) —
 * API slice.
 *
 * Security posture (mirrors the S-09 admin controllers, e.g. the VAT
 * configuration controller T-09.12.02):
 * - Every route requires an authenticated session with the
 *   `admin:uploads:edit` capability. Today the session model exposes only
 *   `req.session.isAdmin` (platform admin); granular staff-role
 *   permissions arrive with the role system (E-10). Centralized in one
 *   enforcement point per controller.
 * - All mutation endpoints additionally require recent step-up
 *   verification via `@RequiresStepUp()` (StepUpGuard) — upload policies
 *   are a security boundary (they determine what file formats and sizes
 *   the platform accepts), so writes are guarded.
 *
 * The admin web UI slice (table: category, formats, max size; edit modal
 * with a security-implications warning; fa/en dicts, RTL/a11y) is
 * deferred.
 */
@ApiTags('Admin · Upload Policies')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/admin/upload-policies')
export class UploadPolicyController {
  constructor(private readonly service: UploadPolicyService) {}

  /** Single enforcement point for the `admin:uploads:edit` capability. */
  private assertUploadsPermission(req: AuthenticatedRequest): void {
    if (!(req.session.isAdmin ?? false)) {
      httpError(
        ErrorCodes.AUTHZ_FORBIDDEN.code,
        'Admin role required to manage upload policies',
        HttpStatus.FORBIDDEN,
      )
    }
  }

  @Get()
  @ApiOperation({
    summary: 'List upload policies (admin)',
    description:
      'Versioned policies, newest first, optionally filtered by category. Each row ' +
      'carries its derived status (current/scheduled/expired).',
  })
  @ApiResponse({ status: 200, description: 'Upload policies.' })
  async list(
    @Req() req: AuthenticatedRequest,
    @Query('category') category?: string,
  ): Promise<UploadPolicyDto[]> {
    this.assertUploadsPermission(req)
    const filter = assertCategoryFilter(category)
    return this.service.list(filter)
  }

  @Post()
  @HttpCode(201)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Create an upload policy version (admin)',
    description:
      'Records a new versioned policy for a category: allowedExtensions (lowercase ' +
      '.ext whitelist, bounded to the deployment-permitted extension set) and ' +
      'maxSizeBytes (bounded to the deployment per-category cap). The previously ' +
      'open policy for the category is closed at the new effectiveFrom. Re-submitting ' +
      'the currently open policy is a no-op.',
  })
  @ApiResponse({ status: 201, description: 'Upload policy created.' })
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() body: z.infer<typeof CreateUploadPolicySchema>,
  ): Promise<UploadPolicyDto> {
    this.assertUploadsPermission(req)
    const parsed = CreateUploadPolicySchema.safeParse(body)
    if (!parsed.success) {
      httpError(
        ErrorCodes.VALIDATION_PARSE_ZOD.code,
        'Invalid upload policy payload',
        400,
        validationDetails(parsed.error.issues),
      )
    }
    return this.service.create({
      category: parsed.data.category,
      allowedExtensions: parsed.data.allowedExtensions,
      maxSizeBytes: parsed.data.maxSizeBytes,
      ...(parsed.data.effectiveFrom !== undefined
        ? { effectiveFrom: parsed.data.effectiveFrom }
        : {}),
      actorUserId: req.session.userId,
      ip: requestIp(req),
    })
  }

  @Post(':id/end')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'End an upload policy (admin)',
    description:
      'Soft-closes a policy window (effectiveUntil, exclusive). Policies are never ' +
      'hard-deleted — ending is the archival path, and ending an already-ended policy ' +
      'is a no-op.',
  })
  @ApiResponse({ status: 200, description: 'Upload policy ended.' })
  async end(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: z.infer<typeof EndUploadPolicySchema>,
  ): Promise<UploadPolicyDto> {
    this.assertUploadsPermission(req)
    assertUuid(id)
    const parsed = EndUploadPolicySchema.safeParse(body ?? {})
    if (!parsed.success) {
      httpError(
        ErrorCodes.VALIDATION_PARSE_ZOD.code,
        'Invalid upload policy payload',
        400,
        validationDetails(parsed.error.issues),
      )
    }
    return this.service.end({
      id,
      ...(parsed.data.effectiveUntil !== undefined
        ? { effectiveUntil: parsed.data.effectiveUntil }
        : {}),
      actorUserId: req.session.userId,
      ip: requestIp(req),
    })
  }
}