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
  AiAgentsService,
  type AgentDto,
  type AgentDetailDto,
} from './ai-agents.service.js'

// ─── Validation schemas ────────────────────────────────────────────────────

const titleSchema = z.string().min(1, 'Title is required').max(120)
const descriptionSchema = z.string().max(2000).default('')
// All agent/model/KB/policy ids are UUID columns; reject anything else before
// it reaches Postgres (where 22P02 would otherwise surface as a raw 500).
const uuidSchema = z.string().uuid('Expected a UUID')
const idListSchema = z.array(uuidSchema).max(200, 'An agent can reference at most 200 items')

export const CreateAgentSchema = z.object({
  title: titleSchema,
  description: descriptionSchema.optional(),
  modelId: uuidSchema,
  kbIds: idListSchema.optional(),
  policyIds: idListSchema.optional(),
  // Optional initial active/inactive state; defaults to enabled.
  enabled: z.boolean().optional(),
})

export const UpdateAgentSchema = z
  .object({
    title: titleSchema.optional(),
    description: z.string().max(2000).optional(),
    modelId: uuidSchema.optional(),
    kbIds: idListSchema.optional(),
    policyIds: idListSchema.optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'At least one field must be provided')

export const AddAgentKbSchema = z.object({
  kbId: uuidSchema,
})

export const AddAgentPolicySchema = z.object({
  policyId: uuidSchema,
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
  const parsed = uuidSchema.safeParse(id)
  if (!parsed.success) {
    httpError(ErrorCodes.VALIDATION_PARSE_ZOD.code, `Invalid ${label}: expected a UUID`, 400)
  }
}

function validationDetails(issues: z.ZodIssue[]): Array<{ path: string; message: string }> {
  return issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
}

/**
 * Admin endpoints for AI agent management (S-09.11, T-09.11.04) — slice 1.
 *
 * Security posture (mirrors the AI policies controller T-09.11.03):
 * - Every route requires an authenticated session with the
 *   `admin:ai:agents` capability. Today the session model exposes only
 *   `req.session.isAdmin` (platform admin); granular staff-role
 *   permissions arrive with the role system. Centralized in one
 *   enforcement point per controller.
 * - All mutation endpoints additionally require recent step-up verification
 *   via `@RequiresStepUp()` (StepUpGuard).
 *
 * The test-chat widget and the slot assignment (T-09.11.05) are later
 * slices; this slice ships the agent records + model/KB/policy links.
 */
@ApiTags('Admin · AI Agents')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/admin/agents')
export class AgentsController {
  constructor(private readonly service: AiAgentsService) {}

  /** Single enforcement point for the `admin:ai:agents` capability. */
  private assertAgentPermission(req: AuthenticatedRequest): void {
    if (!(req.session.isAdmin ?? false)) {
      httpError(
        ErrorCodes.AUTHZ_FORBIDDEN.code,
        'Admin role required to manage AI agents',
        HttpStatus.FORBIDDEN,
      )
    }
  }

  @Get()
  @ApiOperation({ summary: 'List AI agents (admin)' })
  @ApiResponse({ status: 200, description: 'All agents, newest first, with link counts.' })
  async list(@Req() req: AuthenticatedRequest): Promise<AgentDto[]> {
    this.assertAgentPermission(req)
    return this.service.list()
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single AI agent (admin)' })
  @ApiResponse({ status: 200, description: 'The agent with its model and linked KBs/policies.' })
  async get(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<AgentDetailDto> {
    this.assertAgentPermission(req)
    assertUuid(id)
    return this.service.get(id)
  }

  @Post()
  @HttpCode(201)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Create an AI agent (admin)' })
  @ApiResponse({ status: 201, description: 'AI agent created, KBs/policies linked.' })
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() body: z.infer<typeof CreateAgentSchema>,
  ): Promise<AgentDto> {
    this.assertAgentPermission(req)
    const parsed = CreateAgentSchema.safeParse(body)
    if (!parsed.success) {
      httpError(
        ErrorCodes.VALIDATION_PARSE_ZOD.code,
        'Invalid AI agent payload',
        400,
        validationDetails(parsed.error.issues),
      )
    }
    return this.service.create({
      title: parsed.data.title,
      description: parsed.data.description ?? '',
      modelId: parsed.data.modelId,
      ...(parsed.data.kbIds !== undefined ? { kbIds: parsed.data.kbIds } : {}),
      ...(parsed.data.policyIds !== undefined ? { policyIds: parsed.data.policyIds } : {}),
      ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
      actorUserId: req.session.userId,
      ip: requestIp(req),
    })
  }

  @Put(':id')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Update an AI agent (admin)',
    description:
      'Partial update. When kbIds/policyIds are supplied they replace the ' +
      'whole corresponding link set (full-set semantics for the admin ' +
      'multi-select form); omit them to leave links untouched.',
  })
  @ApiResponse({ status: 200, description: 'AI agent updated.' })
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: z.infer<typeof UpdateAgentSchema>,
  ): Promise<AgentDto> {
    this.assertAgentPermission(req)
    assertUuid(id)
    const parsed = UpdateAgentSchema.safeParse(body)
    if (!parsed.success) {
      httpError(
        ErrorCodes.VALIDATION_PARSE_ZOD.code,
        'Invalid AI agent payload',
        400,
        validationDetails(parsed.error.issues),
      )
    }
    return this.service.update(id, {
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.description !== undefined
        ? { description: parsed.data.description }
        : {}),
      ...(parsed.data.modelId !== undefined ? { modelId: parsed.data.modelId } : {}),
      ...(parsed.data.kbIds !== undefined ? { kbIds: parsed.data.kbIds } : {}),
      ...(parsed.data.policyIds !== undefined ? { policyIds: parsed.data.policyIds } : {}),
      ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
      actorUserId: req.session.userId,
      ip: requestIp(req),
    })
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Delete an AI agent (admin)' })
  @ApiResponse({ status: 204, description: 'AI agent deleted (KB/policy links cascaded).' })
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<void> {
    this.assertAgentPermission(req)
    assertUuid(id)
    return this.service.remove(id, req.session.userId, requestIp(req))
  }

  @Post(':id/kbs')
  @HttpCode(204)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Link a knowledge base to an AI agent (admin)',
    description: 'Both the agent and the KB must exist. Idempotent.',
  })
  @ApiResponse({ status: 204, description: 'Knowledge base linked to agent.' })
  async addKb(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: z.infer<typeof AddAgentKbSchema>,
  ): Promise<void> {
    this.assertAgentPermission(req)
    assertUuid(id)
    const parsed = AddAgentKbSchema.safeParse(body)
    if (!parsed.success) {
      httpError(ErrorCodes.VALIDATION_PARSE_ZOD.code, 'Invalid KB link payload', 400, validationDetails(parsed.error.issues))
    }
    return this.service.addKb({
      agentId: id,
      kbId: parsed.data.kbId,
      actorUserId: req.session.userId,
      ip: requestIp(req),
    })
  }

  @Delete(':id/kbs/:kbId')
  @HttpCode(204)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Remove a knowledge base link from an AI agent (admin)',
    description:
      'Removing a KB that is not linked returns 404 so callers can tell a ' +
      'real link change from a no-op.',
  })
  @ApiResponse({ status: 204, description: 'Knowledge base unlinked from agent.' })
  async removeKb(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('kbId') kbId: string,
  ): Promise<void> {
    this.assertAgentPermission(req)
    assertUuid(id)
    assertUuid(kbId, 'kbId')
    return this.service.removeKb(id, kbId, req.session.userId, requestIp(req))
  }

  @Post(':id/policies')
  @HttpCode(204)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Link an AI policy to an AI agent (admin)',
    description: 'Both the agent and the policy must exist. Idempotent.',
  })
  @ApiResponse({ status: 204, description: 'Policy linked to agent.' })
  async addPolicy(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: z.infer<typeof AddAgentPolicySchema>,
  ): Promise<void> {
    this.assertAgentPermission(req)
    assertUuid(id)
    const parsed = AddAgentPolicySchema.safeParse(body)
    if (!parsed.success) {
      httpError(ErrorCodes.VALIDATION_PARSE_ZOD.code, 'Invalid policy link payload', 400, validationDetails(parsed.error.issues))
    }
    return this.service.addPolicy({
      agentId: id,
      policyId: parsed.data.policyId,
      actorUserId: req.session.userId,
      ip: requestIp(req),
    })
  }

  @Delete(':id/policies/:policyId')
  @HttpCode(204)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Remove an AI policy link from an AI agent (admin)',
    description:
      'Removing a policy that is not linked returns 404 so callers can tell ' +
      'a real link change from a no-op.',
  })
  @ApiResponse({ status: 204, description: 'Policy unlinked from agent.' })
  async removePolicy(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('policyId') policyId: string,
  ): Promise<void> {
    this.assertAgentPermission(req)
    assertUuid(id)
    assertUuid(policyId, 'policyId')
    return this.service.removePolicy(id, policyId, req.session.userId, requestIp(req))
  }
}
