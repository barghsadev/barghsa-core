import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
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
  AgentSlotsService,
  AGENT_SLOT_KEYS,
  type AgentSlotDto,
  type AgentSlotKey,
} from './ai-agent-slots.service.js'

// ─── Validation schemas ────────────────────────────────────────────────────

/** The slot set is fixed system configuration; reject anything else. */
const slotKeySchema = z.enum(AGENT_SLOT_KEYS)
// Agent ids are UUID columns; reject anything else before it reaches
// Postgres (where 22P02 would otherwise surface as a raw 500).
const uuidSchema = z.string().uuid('Expected a UUID')

/** PUT body: the agent to serve the slot, or null to clear the assignment. */
export const AssignAgentSchema = z.object({
  agentId: uuidSchema.nullable(),
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

/** Validate a route @Param slot key, surfacing 400 instead of a DB 500. */
function assertSlotKey(slotKey: string): AgentSlotKey {
  const parsed = slotKeySchema.safeParse(slotKey)
  if (!parsed.success) {
    httpError(
      ErrorCodes.VALIDATION_PARSE_ZOD.code,
      `Invalid slot key: expected one of ${AGENT_SLOT_KEYS.join(', ')}`,
      400,
    )
  }
  return parsed.data
}

function validationDetails(issues: z.ZodIssue[]): Array<{ path: string; message: string }> {
  return issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
}

/**
 * Admin endpoints for AI agent slot assignment (S-09.11, T-09.11.05).
 *
 * Security posture (mirrors the AI agents controller T-09.11.04):
 * - Every route requires an authenticated session with the
 *   `admin:ai:agents` capability. Today the session model exposes only
 *   `req.session.isAdmin` (platform admin); granular staff-role
 *   permissions arrive with the role system. Centralized in one
 *   enforcement point per controller.
 * - The assignment mutation additionally requires recent step-up
 *   verification via `@RequiresStepUp()` (StepUpGuard) — changing which
 *   agent answers a customer-facing chatbot slot is a sensitive write.
 *
 * The admin web UI (per-slot dropdowns, "also used in" warning), the
 * fa/en dictionaries, and RTL/a11y land with the deferred UI slice;
 * these endpoints ship the durable slot mapping consumed by the frontend
 * and external integrations.
 */
@ApiTags('Admin · AI Agent Slots')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/admin/agent-slots')
export class AgentSlotsController {
  constructor(private readonly service: AgentSlotsService) {}

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
  @ApiOperation({ summary: 'List AI agent slot assignments (admin)' })
  @ApiResponse({
    status: 200,
    description:
      'All predefined slots with their current agent and the "also used in" warning set.',
  })
  async list(@Req() req: AuthenticatedRequest): Promise<AgentSlotDto[]> {
    this.assertAgentPermission(req)
    return this.service.list()
  }

  @Put(':slotKey/agent')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Assign an agent to a slot (admin)',
    description:
      'Set the agent serving a predefined chatbot slot. Body: ' +
      '{"agentId": "<uuid>"} to assign, {"agentId": null} to clear. ' +
      'An identical assignment is a no-op (no audit).',
  })
  @ApiResponse({ status: 200, description: 'Slot assignment updated.' })
  async assign(
    @Req() req: AuthenticatedRequest,
    @Param('slotKey') slotKey: string,
    @Body() body: z.infer<typeof AssignAgentSchema>,
  ): Promise<AgentSlotDto> {
    this.assertAgentPermission(req)
    const key = assertSlotKey(slotKey)
    const parsed = AssignAgentSchema.safeParse(body)
    if (!parsed.success) {
      httpError(
        ErrorCodes.VALIDATION_PARSE_ZOD.code,
        'Invalid slot assignment payload',
        400,
        validationDetails(parsed.error.issues),
      )
    }
    return this.service.assign({
      slotKey: key,
      agentId: parsed.data.agentId,
      actorUserId: req.session.userId,
      ip: requestIp(req),
    })
  }
}