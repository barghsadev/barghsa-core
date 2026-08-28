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
import { RateLimit } from '../rate-limit/rate-limit.decorator.js'
import {
  AiModelsService,
  AI_MODEL_PROVIDER_TYPES,
  type AiModelDto,
  type TestAiModelResult,
} from './ai-models.service.js'

/** Shared url refinement: http(s), non-empty after trim. */
const baseUrlSchema = z
  .string()
  .min(1, 'Base URL is required')
  .max(500)
  .refine((v) => {
    try {
      const url = new URL(v)
      return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
      return false
    }
  }, 'Base URL must be an http(s) URL')

export const CreateAiModelSchema = z.object({
  title: z.string().min(1, 'Title is required').max(120),
  providerType: z.enum(AI_MODEL_PROVIDER_TYPES, {
    message: 'Provider type is required',
  }),
  baseUrl: baseUrlSchema,
  modelName: z.string().min(1, 'Model name is required').max(200),
  apiToken: z.string().max(4000).optional(),
})

export const UpdateAiModelSchema = z
  .object({
    title: z.string().min(1).max(120).optional(),
    providerType: z.enum(AI_MODEL_PROVIDER_TYPES).optional(),
    baseUrl: baseUrlSchema.optional(),
    modelName: z.string().min(1).max(200).optional(),
    apiToken: z.string().max(4000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'At least one field must be provided')

function httpError(code: string, message: string, statusCode = 400): never {
  throw new HttpException({ statusCode, error: code, message }, statusCode)
}

function requestIp(req: AuthenticatedRequest): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown'
}

/**
 * Admin endpoints for AI model management (S-09.11, T-09.11.01).
 *
 * Security posture (mirrors the provider-config controllers T-09.06.x):
 * - Every route requires an authenticated session with the
 *   `admin:ai:models` capability. Today the session model exposes only
 *   `req.session.isAdmin` (platform admin); granular staff-role permissions
 *   arrive with the role system. Centralized in one enforcement point.
 * - All mutation endpoints additionally require recent step-up verification
 *   via `@RequiresStepUp()` (StepUpGuard).
 * - API tokens are write-only: they are accepted on create/update, encrypted
 *   at rest, and only ever returned as a masked display value.
 */
@ApiTags('Admin · AI Models')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/admin/ai-models')
export class AiModelsController {
  constructor(private readonly service: AiModelsService) {}

  /** Single enforcement point for the `admin:ai:models` capability. */
  private assertAiModelsPermission(req: AuthenticatedRequest): void {
    if (!(req.session.isAdmin ?? false)) {
      httpError(
        ErrorCodes.AUTHZ_FORBIDDEN.code,
        'Admin role required to manage AI models',
        HttpStatus.FORBIDDEN,
      )
    }
  }

  @Get()
  @ApiOperation({ summary: 'List AI models (admin)' })
  @ApiResponse({ status: 200, description: 'All AI models, newest first, tokens masked.' })
  async list(@Req() req: AuthenticatedRequest): Promise<AiModelDto[]> {
    this.assertAiModelsPermission(req)
    return this.service.list()
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single AI model (admin)' })
  @ApiResponse({ status: 200, description: 'The AI model with its masked token.' })
  async get(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<AiModelDto> {
    this.assertAiModelsPermission(req)
    return this.service.get(id)
  }

  @Post()
  @HttpCode(201)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Create an AI model (admin)' })
  @ApiResponse({ status: 201, description: 'AI model created (token stored encrypted).' })
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() body: z.infer<typeof CreateAiModelSchema>,
  ): Promise<AiModelDto> {
    this.assertAiModelsPermission(req)
    const parsed = CreateAiModelSchema.safeParse(body)
    if (!parsed.success) {
      httpError(ErrorCodes.VALIDATION_PARSE_ZOD.code, 'Invalid AI model payload')
    }
    return this.service.create({
      title: parsed.data.title,
      providerType: parsed.data.providerType,
      baseUrl: parsed.data.baseUrl,
      modelName: parsed.data.modelName,
      ...(parsed.data.apiToken !== undefined ? { apiToken: parsed.data.apiToken } : {}),
      actorUserId: req.session.userId,
      ip: requestIp(req),
    })
  }

  @Put(':id')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({
    summary: 'Update an AI model (admin)',
    description:
      'Partial update. apiToken semantics: omit = unchanged, masked ' +
      'placeholder = unchanged, empty string = clear, anything else = new ' +
      'token (encrypted at rest).',
  })
  @ApiResponse({ status: 200, description: 'AI model updated (masked token preserved).' })
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: z.infer<typeof UpdateAiModelSchema>,
  ): Promise<AiModelDto> {
    this.assertAiModelsPermission(req)
    const parsed = UpdateAiModelSchema.safeParse(body)
    if (!parsed.success) {
      httpError(ErrorCodes.VALIDATION_PARSE_ZOD.code, 'Invalid AI model payload')
    }
    return this.service.update(id, {
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.providerType !== undefined
        ? { providerType: parsed.data.providerType }
        : {}),
      ...(parsed.data.baseUrl !== undefined ? { baseUrl: parsed.data.baseUrl } : {}),
      ...(parsed.data.modelName !== undefined ? { modelName: parsed.data.modelName } : {}),
      ...(parsed.data.apiToken !== undefined ? { apiToken: parsed.data.apiToken } : {}),
      actorUserId: req.session.userId,
      ip: requestIp(req),
    })
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @ApiOperation({ summary: 'Delete an AI model (admin)' })
  @ApiResponse({ status: 204, description: 'AI model deleted.' })
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<void> {
    this.assertAiModelsPermission(req)
    return this.service.remove(id, req.session.userId, requestIp(req))
  }

  @Post(':id/test')
  @HttpCode(200)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @RateLimit({ namespace: 'ai-models:test', limit: 20, windowMs: 60_000 })
  @ApiOperation({
    summary: 'Test the connection to an AI model endpoint (admin)',
    description:
      'Runs a minimal request against the configured provider (SSRF-guarded), ' +
      'persists the outcome as the model status, and returns a truncated ' +
      'response preview. The API token is never returned.',
  })
  @ApiResponse({ status: 200, description: 'Test outcome + refreshed model.' })
  async test(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<TestAiModelResult> {
    this.assertAiModelsPermission(req)
    return this.service.test(id, req.session.userId, requestIp(req))
  }
}
