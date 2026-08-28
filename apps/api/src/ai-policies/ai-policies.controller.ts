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
  AiPoliciesService,
  POLICY_TYPES,
  type PolicyDto,
  type PolicyDetailDto,
  type PolicyGroupDto,
  type PolicyGroupDetailDto,
} from './ai-policies.service.js'
import { rulesSchemas } from './ai-policies.rules.js'

// ─── Validation schemas ────────────────────────────────────────────────────

const titleSchema = z.string().min(1, 'Title is required').max(120)
const descriptionSchema = z.string().max(2000).default('')
const policyTypeSchema = z.enum(POLICY_TYPES)

export const CreatePolicySchema = z
  .object({
    title: titleSchema,
    description: descriptionSchema.optional(),
    policyType: policyTypeSchema,
    // Structured guardrail document; shape validated against the chosen
    // policyType below (rulesSchemas shared with the service).
    rules: z.record(z.string(), z.unknown()),
    // Optional initial active/inactive state; defaults to enabled.
    enabled: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    const rulesSchema = rulesSchemas[v.policyType]
    const parsed = rulesSchema.safeParse(v.rules)
    if (!parsed.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rules'],
        message: `Invalid rules for policy type "${v.policyType}": ${parsed.error.issues
          .map((i) => i.message)
          .join('; ')}`,
      })
    }
  })

export const UpdatePolicySchema = z
  .object({
    title: titleSchema.optional(),
    description: z.string().max(2000).optional(),
    policyType: policyTypeSchema.optional(),
    // Rules/type cross-validation happens authoritatively in the service
    // where the stored policy_type is known (a rules-only update must be
    // checked against the existing type; a type change requires new rules).
    rules: z.record(z.string(), z.unknown()).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'At least one field must be provided')

export const CreatePolicyGroupSchema = z.object({
  title: titleSchema,
  description: descriptionSchema.optional(),
})

export const UpdatePolicyGroupSchema = z
  .object({
    title: titleSchema.optional(),
    description: z.string().max(2000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'At least one field must be provided')

export const AddGroupMemberSchema = z.object({
  policyId: z.string().min(1, 'policyId is required').max(64),
})

function httpError(
  code: string,
  message: string,
  statusCode = 400,
  details?: unknown,
): never {
  throw new HttpException({ statusCode, error: code, message, ...(details ? { details } : {}) }, statusCode)
}

function requestIp(req: AuthenticatedRequest): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown'
}

/** Flattened zod issues so the admin UI can highlight the offending rule field. */
function validationDetails(issues: z.ZodIssue[]): Array<{ path: string; message: string }> {
  return issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
}

/**
 * Admin endpoints for AI policy management (S-09.11, T-09.11.03).
 *
 * Security posture (mirrors the knowledge-bases controller T-09.11.02):
 * - Every route requires an authenticated session with the
 *   `admin:ai:policies` capability. Today the session model exposes only
 *   `req.session.isAdmin` (platform admin); granular staff-role
 *   permissions arrive with the role system. Centralized in one
 *   enforcement point per controller.
 * - All mutation endpoints additionally require recent step-up verification
 *   via `@RequiresStepUp()` (StepUpGuard).
 */
@ApiTags('Admin · AI Policies')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/admin/policies')
export class PoliciesController {
  constructor(private readonly service: AiPoliciesService) {}

  /** Single enforcement point for the `admin:ai:policies` capability. */
  private assertPolicyPermission(req: AuthenticatedRequest): void {
    if (!(req.session.isAdmin ?? false)) {
      httpError(
        ErrorCodes.AUTHZ_FORBIDDEN.code,
        'Admin role required to manage AI policies',
        HttpStatus.FORBIDDEN,
      )
    }
  }

  @Get()
  @ApiOperation({ summary: 'List AI policies (admin)' })
  @ApiResponse({ status: 200, description: 'All policies, newest first, with group counts.' })
  async list(@Req() req: AuthenticatedRequest): Promise<PolicyDto[]> {
    this.assertPolicyPermission(req)
    return this.service.listPolicies()
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single AI policy (admin)' })
  @ApiResponse({ status: 200, description: 'The policy with its group memberships.' })
  async get(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<PolicyDetailDto> {
    this.assertPolicyPermission(req)
    return this.service.getPolicy(id)
  }

  @Post()
  @HttpCode(201)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Create an AI policy (admin)' })
  @ApiResponse({ status: 201, description: 'AI policy created.' })
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() body: z.infer<typeof CreatePolicySchema>,
  ): Promise<PolicyDto> {
    this.assertPolicyPermission(req)
    const parsed = CreatePolicySchema.safeParse(body)
    if (!parsed.success) {
      httpError(ErrorCodes.VALIDATION_PARSE_ZOD.code, 'Invalid policy payload', 400, validationDetails(parsed.error.issues))
    }
    return this.service.createPolicy({
      title: parsed.data.title,
      description: parsed.data.description ?? '',
      policyType: parsed.data.policyType,
      rules: parsed.data.rules,
      ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
      actorUserId: req.session.userId,
      ip: requestIp(req),
    })
  }

  @Put(':id')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Update an AI policy (admin)' })
  @ApiResponse({ status: 200, description: 'AI policy updated.' })
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: z.infer<typeof UpdatePolicySchema>,
  ): Promise<PolicyDto> {
    this.assertPolicyPermission(req)
    const parsed = UpdatePolicySchema.safeParse(body)
    if (!parsed.success) {
      httpError(ErrorCodes.VALIDATION_PARSE_ZOD.code, 'Invalid policy payload', 400, validationDetails(parsed.error.issues))
    }
    return this.service.updatePolicy(id, {
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.description !== undefined
        ? { description: parsed.data.description }
        : {}),
      ...(parsed.data.policyType !== undefined ? { policyType: parsed.data.policyType } : {}),
      ...(parsed.data.rules !== undefined ? { rules: parsed.data.rules } : {}),
      ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
      actorUserId: req.session.userId,
      ip: requestIp(req),
    })
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Delete an AI policy (admin)' })
  @ApiResponse({ status: 204, description: 'AI policy deleted (memberships cascaded).' })
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<void> {
    this.assertPolicyPermission(req)
    return this.service.removePolicy(id, req.session.userId, requestIp(req))
  }
}

/**
 * Admin endpoints for AI policy group management (S-09.11, T-09.11.03).
 * Same permission + step-up posture as {@link PoliciesController}.
 */
@ApiTags('Admin · AI Policy Groups')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/admin/policy-groups')
export class PolicyGroupsController {
  constructor(private readonly service: AiPoliciesService) {}

  private assertPolicyPermission(req: AuthenticatedRequest): void {
    if (!(req.session.isAdmin ?? false)) {
      httpError(
        ErrorCodes.AUTHZ_FORBIDDEN.code,
        'Admin role required to manage AI policy groups',
        HttpStatus.FORBIDDEN,
      )
    }
  }

  @Get()
  @ApiOperation({ summary: 'List AI policy groups (admin)' })
  @ApiResponse({ status: 200, description: 'All groups, newest first, with member counts.' })
  async list(@Req() req: AuthenticatedRequest): Promise<PolicyGroupDto[]> {
    this.assertPolicyPermission(req)
    return this.service.listGroups()
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single AI policy group (admin)' })
  @ApiResponse({ status: 200, description: 'The group with its member policies.' })
  async get(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<PolicyGroupDetailDto> {
    this.assertPolicyPermission(req)
    return this.service.getGroup(id)
  }

  @Post()
  @HttpCode(201)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Create an AI policy group (admin)' })
  @ApiResponse({ status: 201, description: 'AI policy group created.' })
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() body: z.infer<typeof CreatePolicyGroupSchema>,
  ): Promise<PolicyGroupDto> {
    this.assertPolicyPermission(req)
    const parsed = CreatePolicyGroupSchema.safeParse(body)
    if (!parsed.success) {
      httpError(ErrorCodes.VALIDATION_PARSE_ZOD.code, 'Invalid policy group payload', 400, validationDetails(parsed.error.issues))
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
  @ApiOperation({ summary: 'Update an AI policy group (admin)' })
  @ApiResponse({ status: 200, description: 'AI policy group updated.' })
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: z.infer<typeof UpdatePolicyGroupSchema>,
  ): Promise<PolicyGroupDto> {
    this.assertPolicyPermission(req)
    const parsed = UpdatePolicyGroupSchema.safeParse(body)
    if (!parsed.success) {
      httpError(ErrorCodes.VALIDATION_PARSE_ZOD.code, 'Invalid policy group payload', 400, validationDetails(parsed.error.issues))
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
  @ApiOperation({ summary: 'Delete an AI policy group (admin)' })
  @ApiResponse({ status: 204, description: 'AI policy group deleted (memberships cascaded).' })
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<void> {
    this.assertPolicyPermission(req)
    return this.service.removeGroup(id, req.session.userId, requestIp(req))
  }

  @Post(':id/members')
  @HttpCode(204)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Link an AI policy into a policy group (admin)',
    description: 'Both the group and the policy must exist. Idempotent.',
  })
  @ApiResponse({ status: 204, description: 'Policy linked into group.' })
  async addMember(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: z.infer<typeof AddGroupMemberSchema>,
  ): Promise<void> {
    this.assertPolicyPermission(req)
    const parsed = AddGroupMemberSchema.safeParse(body)
    if (!parsed.success) {
      httpError(ErrorCodes.VALIDATION_PARSE_ZOD.code, 'Invalid member payload', 400, validationDetails(parsed.error.issues))
    }
    return this.service.addGroupMember({
      groupId: id,
      policyId: parsed.data.policyId,
      actorUserId: req.session.userId,
      ip: requestIp(req),
    })
  }

  @Delete(':id/members/:policyId')
  @HttpCode(204)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Remove an AI policy from a policy group (admin)',
    description:
      'Removing a policy that is not a member of the group returns 404. ' +
      'Unlike the idempotent add-member link, removal is assertive so callers ' +
      'can tell a real member change from a no-op.',
  })
  @ApiResponse({ status: 204, description: 'Policy removed from group.' })
  async removeMember(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('policyId') policyId: string,
  ): Promise<void> {
    this.assertPolicyPermission(req)
    return this.service.removeGroupMember(id, policyId, req.session.userId, requestIp(req))
  }
}
