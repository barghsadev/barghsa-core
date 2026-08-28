import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { z } from 'zod'
import { ErrorCodes } from '@barghsa/shared/errors'
import { CONTRACT_TEMPLATE_STATUSES, type ContractTemplateDto } from '@barghsa/shared/admin'
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js'
import { StepUpGuard, RequiresStepUp } from '../session/step-up.guard.js'
import { ContractTemplateService } from './contract-template.service.js'

// ─── Validation schemas ────────────────────────────────────────────────────

const statusSchema = z.enum(CONTRACT_TEMPLATE_STATUSES)
const nameSchema = z
  .string()
  .min(1, 'name is required')
  .max(200, 'name must be 200 characters or fewer')
  .transform((s) => s.trim())

const CreateContractTemplateSchema = z.object({
  name: nameSchema,
  description: z.string().max(2000, 'description must be 2000 characters or fewer').optional(),
})

const UpdateContractTemplateSchema = z.object({
  name: nameSchema.optional(),
  description: z
    .union([z.string().max(2000, 'description must be 2000 characters or fewer'), z.null()])
    .optional(),
  status: statusSchema.optional(),
})

const UploadVersionSchema = z.object({
  fileName: z.string().min(1, 'fileName is required').max(255, 'fileName is too long'),
  contentType: z.string().max(100, 'contentType is too long').optional(),
  content: z.string(),
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

function assertUuid(id: string, label = 'id'): void {
  const parsed = z.string().uuid('Expected a UUID').safeParse(id)
  if (!parsed.success) {
    httpError(ErrorCodes.VALIDATION_PARSE_ZOD.code, `Invalid ${label}: expected a UUID`, 400)
  }
}

function validationDetails(issues: z.ZodIssue[]): Array<{ path: string; message: string }> {
  return issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
}

/**
 * Admin endpoints for contract template management (T-09.12.04) — API
 * slice.
 *
 * Security posture (mirrors the S-09 admin controllers):
 * - Every route requires an authenticated session with the
 *   `admin:documents:edit` capability. Today the session model exposes
 *   only `req.session.isAdmin` (platform admin); granular staff-role
 *   permissions arrive with the role system (E-10).
 * - All mutation endpoints require recent step-up verification via
 *   `@RequiresStepUp()` — template uploads can inject markup that may
 *   be rendered in generated contracts, so writes are guarded.
 *
 * The admin web UI slice (template list with version history, drag &
 * drop upload, placeholder extraction result display, edit metadata
 * modal, fa/en dicts, RTL/a11y) is deferred.
 */
@ApiTags('Admin · Contract Templates')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/admin/contract-templates')
export class ContractTemplateController {
  constructor(private readonly service: ContractTemplateService) {}

  /** Single enforcement point for the `admin:documents:edit` capability. */
  private assertDocumentsPermission(req: AuthenticatedRequest): void {
    if (!(req.session.isAdmin ?? false)) {
      httpError(
        ErrorCodes.AUTHZ_FORBIDDEN.code,
        'Admin role required to manage contract templates',
        HttpStatus.FORBIDDEN,
      )
    }
  }

  @Get()
  @ApiOperation({
    summary: 'List contract templates (admin)',
    description: 'Newest first, with version count and the latest version of each template.',
  })
  @ApiResponse({ status: 200, description: 'Contract templates.' })
  async list(@Req() req: AuthenticatedRequest): Promise<ContractTemplateDto[]> {
    this.assertDocumentsPermission(req)
    return this.service.list()
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a contract template with full version history (admin)',
    description: 'All versions, oldest first, including the placeholders extracted at upload time.',
  })
  @ApiResponse({ status: 200, description: 'The contract template with versions.' })
  async get(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<ContractTemplateDto> {
    this.assertDocumentsPermission(req)
    assertUuid(id)
    return this.service.get(id)
  }

  @Post()
  @HttpCode(201)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Create a contract template (admin)',
    description:
      'Creates the template metadata (name, optional description). Names are trimmed and ' +
      'case-insensitively unique (409 on duplicate). Upload a file via ' +
      'POST /:id/versions afterward.',
  })
  @ApiResponse({ status: 201, description: 'Contract template created.' })
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() body: z.infer<typeof CreateContractTemplateSchema>,
  ): Promise<ContractTemplateDto> {
    this.assertDocumentsPermission(req)
    const parsed = CreateContractTemplateSchema.safeParse(body)
    if (!parsed.success) {
      httpError(
        ErrorCodes.VALIDATION_PARSE_ZOD.code,
        'Invalid contract template payload',
        400,
        validationDetails(parsed.error.issues),
      )
    }
    return this.service.create({
      name: parsed.data.name,
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      actorUserId: req.session.userId,
      ip: requestIp(req),
    })
  }

  @Patch(':id')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Update a contract template (admin)',
    description:
      'Only provided fields change: name (re-checks case-insensitive uniqueness), ' +
      'description, status. Setting status=inactive archives a versioned template (the ' +
      'archival path — versioned templates cannot be hard-deleted).',
  })
  @ApiResponse({ status: 200, description: 'Contract template updated.' })
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: z.infer<typeof UpdateContractTemplateSchema>,
  ): Promise<ContractTemplateDto> {
    this.assertDocumentsPermission(req)
    assertUuid(id)
    const parsed = UpdateContractTemplateSchema.safeParse(body ?? {})
    if (!parsed.success) {
      httpError(
        ErrorCodes.VALIDATION_PARSE_ZOD.code,
        'Invalid contract template payload',
        400,
        validationDetails(parsed.error.issues),
      )
    }
    const data = parsed.data
    return this.service.update(id, {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      actorUserId: req.session.userId,
      ip: requestIp(req),
    })
  }

  @Post(':id/versions')
  @HttpCode(201)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Upload a new template version (admin)',
    description:
      'Stores the file in object storage, extracts placeholders ({{name}}) from its content, ' +
      'and appends an append-only version. Prior versions and their files are preserved as the ' +
      'archive of previous versions. Requires object storage to be configured.',
  })
  @ApiResponse({ status: 201, description: 'New template version uploaded with extracted placeholders.' })
  async uploadVersion(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: z.infer<typeof UploadVersionSchema>,
  ): Promise<ReturnType<ContractTemplateService['uploadVersion']>> {
    this.assertDocumentsPermission(req)
    assertUuid(id)
    const parsed = UploadVersionSchema.safeParse(body)
    if (!parsed.success) {
      httpError(
        ErrorCodes.VALIDATION_PARSE_ZOD.code,
        'Invalid contract template version payload',
        400,
        validationDetails(parsed.error.issues),
      )
    }
    return this.service.uploadVersion(id, {
      fileName: parsed.data.fileName,
      ...(parsed.data.contentType !== undefined ? { contentType: parsed.data.contentType } : {}),
      content: parsed.data.content,
      actorUserId: req.session.userId,
      ip: requestIp(req),
    })
  }

  @Delete(':id')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Delete a contract template (admin)',
    description:
      'Only succeeds for a template with no versions and no contract-type links. Versioned ' +
      'templates must be archived (status=inactive); templates referenced by a contract type ' +
      'return 409 and cannot be deleted.',
  })
  @ApiResponse({ status: 200, description: 'Contract template deleted.' })
  async delete(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<{ deleted: boolean }> {
    this.assertDocumentsPermission(req)
    assertUuid(id)
    return this.service.delete(id, req.session.userId, requestIp(req))
  }
}
