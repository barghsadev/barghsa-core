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
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { z } from 'zod'
import { ErrorCodes } from '@barghsa/shared/errors'
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js'
import { StepUpGuard, RequiresStepUp } from '../session/step-up.guard.js'
import {
  KnowledgeBasesService,
  type KbDto,
  type KbDetailDto,
  type KbDocumentDto,
  type KbGroupDto,
  type KbGroupDetailDto,
} from './knowledge-bases.service.js'

// ─── Validation schemas ────────────────────────────────────────────────────

const titleSchema = z.string().min(1, 'Title is required').max(120)
const descriptionSchema = z.string().max(2000).default('')

export const CreateKnowledgeBaseSchema = z.object({
  title: titleSchema,
  description: descriptionSchema.optional(),
})

export const UpdateKnowledgeBaseSchema = z
  .object({
    title: titleSchema.optional(),
    description: z.string().max(2000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'At least one field must be provided')

export const AttachDocumentSchema = z.object({
  storageKey: z.string().min(1, 'storageKey is required').max(500),
})

export const CreateKbGroupSchema = z.object({
  title: titleSchema,
  description: descriptionSchema.optional(),
})

export const UpdateKbGroupSchema = z
  .object({
    title: titleSchema.optional(),
    description: z.string().max(2000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'At least one field must be provided')

export const AddGroupMemberSchema = z.object({
  kbId: z.string().min(1, 'kbId is required').max(64),
})

function httpError(code: string, message: string, statusCode = 400): never {
  throw new HttpException({ statusCode, error: code, message }, statusCode)
}

function requestIp(req: AuthenticatedRequest): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown'
}

/**
 * Admin endpoints for knowledge base management (S-09.11, T-09.11.02).
 *
 * Security posture (mirrors the ai-models controller T-09.11.01):
 * - Every route requires an authenticated session with the `admin:ai:kb`
 *   capability. Today the session model exposes only
 *   `req.session.isAdmin` (platform admin); granular staff-role permissions
 *   arrive with the role system. Centralized in one enforcement point.
 * - All mutation endpoints additionally require recent step-up verification
 *   via `@RequiresStepUp()` (StepUpGuard).
 * - Documents are attached by storage key referencing the shared document
 *   system; the service validates the record exists and is not removed.
 */
@ApiTags('Admin · Knowledge Bases')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/admin/knowledge-bases')
export class KnowledgeBasesController {
  constructor(private readonly service: KnowledgeBasesService) {}

  /** Single enforcement point for the `admin:ai:kb` capability. */
  private assertKbPermission(req: AuthenticatedRequest): void {
    if (!(req.session.isAdmin ?? false)) {
      httpError(
        ErrorCodes.AUTHZ_FORBIDDEN.code,
        'Admin role required to manage knowledge bases',
        HttpStatus.FORBIDDEN,
      )
    }
  }

  @Get()
  @ApiOperation({ summary: 'List knowledge bases (admin)' })
  @ApiResponse({ status: 200, description: 'All KBs, newest first, with document + group counts.' })
  async list(@Req() req: AuthenticatedRequest): Promise<KbDto[]> {
    this.assertKbPermission(req)
    return this.service.listKbs()
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single knowledge base (admin)' })
  @ApiResponse({ status: 200, description: 'The KB with its documents and group memberships.' })
  async get(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<KbDetailDto> {
    this.assertKbPermission(req)
    return this.service.getKb(id)
  }

  @Post()
  @HttpCode(201)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Create a knowledge base (admin)' })
  @ApiResponse({ status: 201, description: 'Knowledge base created.' })
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() body: z.infer<typeof CreateKnowledgeBaseSchema>,
  ): Promise<KbDto> {
    this.assertKbPermission(req)
    const parsed = CreateKnowledgeBaseSchema.safeParse(body)
    if (!parsed.success) {
      httpError(ErrorCodes.VALIDATION_PARSE_ZOD.code, 'Invalid knowledge base payload')
    }
    return this.service.createKb({
      title: parsed.data.title,
      description: parsed.data.description ?? '',
      actorUserId: req.session.userId,
      ip: requestIp(req),
    })
  }

  @Put(':id')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Update a knowledge base (admin)' })
  @ApiResponse({ status: 200, description: 'Knowledge base updated.' })
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: z.infer<typeof UpdateKnowledgeBaseSchema>,
  ): Promise<KbDto> {
    this.assertKbPermission(req)
    const parsed = UpdateKnowledgeBaseSchema.safeParse(body)
    if (!parsed.success) {
      httpError(ErrorCodes.VALIDATION_PARSE_ZOD.code, 'Invalid knowledge base payload')
    }
    return this.service.updateKb(id, {
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.description !== undefined
        ? { description: parsed.data.description }
        : {}),
      actorUserId: req.session.userId,
      ip: requestIp(req),
    })
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Delete a knowledge base (admin)' })
  @ApiResponse({ status: 204, description: 'Knowledge base deleted (links cascaded).' })
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<void> {
    this.assertKbPermission(req)
    return this.service.removeKb(id, req.session.userId, requestIp(req))
  }

  @Post(':id/documents')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Attach a document to a knowledge base (admin)',
    description:
      'Links an existing storage record (from the shared document system) ' +
      'to the KB by key. The file metadata is snapshotted and the chunk/embed ' +
      'pipeline starts at `pending`. Attaching an already-attached key is a no-op.',
  })
  @ApiResponse({ status: 200, description: 'The document link.' })
  async attachDocument(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: z.infer<typeof AttachDocumentSchema>,
  ): Promise<KbDocumentDto> {
    this.assertKbPermission(req)
    const parsed = AttachDocumentSchema.safeParse(body)
    if (!parsed.success) {
      httpError(ErrorCodes.VALIDATION_PARSE_ZOD.code, 'Invalid document payload')
    }
    return this.service.attachDocument({
      kbId: id,
      storageKey: parsed.data.storageKey,
      actorUserId: req.session.userId,
      ip: requestIp(req),
    })
  }

  @Delete(':id/documents/:documentId')
  @HttpCode(204)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Detach a document from a knowledge base (admin)',
    description:
      'Removes the KB↔document link by link id. The underlying storage ' +
      'record is retained. The link id is used instead of the storage key ' +
      'because storage keys contain path separators.',
  })
  @ApiResponse({ status: 204, description: 'Document detached.' })
  async detachDocument(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
  ): Promise<void> {
    this.assertKbPermission(req)
    return this.service.detachDocument(id, documentId, req.session.userId, requestIp(req))
  }
}

/**
 * Admin endpoints for KB group management (S-09-11, T-09.11.02).
 * Same permission + step-up posture as {@link KnowledgeBasesController}.
 */
@ApiTags('Admin · KB Groups')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/admin/kb-groups')
export class KbGroupsController {
  constructor(private readonly service: KnowledgeBasesService) {}

  private assertKbPermission(req: AuthenticatedRequest): void {
    if (!(req.session.isAdmin ?? false)) {
      httpError(
        ErrorCodes.AUTHZ_FORBIDDEN.code,
        'Admin role required to manage KB groups',
        HttpStatus.FORBIDDEN,
      )
    }
  }

  @Get()
  @ApiOperation({ summary: 'List KB groups (admin)' })
  @ApiResponse({ status: 200, description: 'All groups, newest first, with member counts.' })
  async list(@Req() req: AuthenticatedRequest): Promise<KbGroupDto[]> {
    this.assertKbPermission(req)
    return this.service.listGroups()
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single KB group (admin)' })
  @ApiResponse({ status: 200, description: 'The group with its member KBs.' })
  async get(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<KbGroupDetailDto> {
    this.assertKbPermission(req)
    return this.service.getGroup(id)
  }

  @Post()
  @HttpCode(201)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Create a KB group (admin)' })
  @ApiResponse({ status: 201, description: 'KB group created.' })
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() body: z.infer<typeof CreateKbGroupSchema>,
  ): Promise<KbGroupDto> {
    this.assertKbPermission(req)
    const parsed = CreateKbGroupSchema.safeParse(body)
    if (!parsed.success) {
      httpError(ErrorCodes.VALIDATION_PARSE_ZOD.code, 'Invalid KB group payload')
    }
    return this.service.createGroup({
      title: parsed.data.title,
      description: parsed.data.description ?? '',
      actorUserId: req.session.userId,
      ip: requestIp(req),
    })
  }

  @Put(':id')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Update a KB group (admin)' })
  @ApiResponse({ status: 200, description: 'KB group updated.' })
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: z.infer<typeof UpdateKbGroupSchema>,
  ): Promise<KbGroupDto> {
    this.assertKbPermission(req)
    const parsed = UpdateKbGroupSchema.safeParse(body)
    if (!parsed.success) {
      httpError(ErrorCodes.VALIDATION_PARSE_ZOD.code, 'Invalid KB group payload')
    }
    return this.service.updateGroup(id, {
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.description !== undefined
        ? { description: parsed.data.description }
        : {}),
      actorUserId: req.session.userId,
      ip: requestIp(req),
    })
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Delete a KB group (admin)' })
  @ApiResponse({ status: 204, description: 'KB group deleted (memberships cascaded).' })
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<void> {
    this.assertKbPermission(req)
    return this.service.removeGroup(id, req.session.userId, requestIp(req))
  }

  @Post(':id/members')
  @HttpCode(204)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Link a knowledge base into a KB group (admin)',
    description: 'Both the group and the KB must exist. Idempotent.',
  })
  @ApiResponse({ status: 204, description: 'KB linked into group.' })
  async addMember(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: z.infer<typeof AddGroupMemberSchema>,
  ): Promise<void> {
    this.assertKbPermission(req)
    const parsed = AddGroupMemberSchema.safeParse(body)
    if (!parsed.success) {
      httpError(ErrorCodes.VALIDATION_PARSE_ZOD.code, 'Invalid member payload')
    }
    return this.service.addGroupMember({
      groupId: id,
      kbId: parsed.data.kbId,
      actorUserId: req.session.userId,
      ip: requestIp(req),
    })
  }

  @Delete(':id/members/:kbId')
  @HttpCode(204)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Remove a KB from a KB group (admin)' })
  @ApiResponse({ status: 204, description: 'KB removed from group.' })
  async removeMember(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('kbId') kbId: string,
  ): Promise<void> {
    this.assertKbPermission(req)
    return this.service.removeGroupMember(id, kbId, req.session.userId, requestIp(req))
  }
}
