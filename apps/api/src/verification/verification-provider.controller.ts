import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Logger,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'
import { z } from 'zod'
import { ErrorCodes } from '@barghsa/shared/errors'
import { VerificationErrorCodes } from '@barghsa/shared/verification'
import { VerificationProviderService } from './verification-provider.service.js'
import { SessionAuthGuard } from '../session/session.guard.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'

/**
 * Zod schema for the provider config update request body.
 */
const SetProviderConfigSchema = z.object({
  providerId: z.string().min(1),
  settings: z.record(z.string(), z.string()),
  enabled: z.boolean(),
})

/**
 * Zod schema for the verification request body.
 */
const RunVerificationSchema = z.object({
  providerId: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
})

@ApiTags('Verification')
@Controller('api/admin/verification')
@UseGuards(SessionAuthGuard)
export class VerificationProviderController {
  private readonly logger = new Logger(VerificationProviderController.name)

  constructor(
    private readonly verificationProviderService: VerificationProviderService,
  ) {}

  /**
   * GET /api/admin/verification/providers
   *
   * List all registered verification providers with their status.
   */
  @Get('providers')
  @ApiOperation({ summary: 'List registered verification providers' })
  @ApiResponse({ status: 200, description: 'List of providers with status.' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  listProviders(@Req() req: AuthenticatedRequest) {
    const isAdmin = req.session.isAdmin ?? false
    if (!isAdmin) {
      throw new HttpException(
        { statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code, message: 'Admin role required' },
        403,
      )
    }
    return this.verificationProviderService.listProviders()
  }

  /**
   * GET /api/admin/verification/providers/:providerId/config
   *
   * Get the configuration for a specific provider.
   */
  @Get('providers/:providerId/config')
  @ApiOperation({ summary: 'Get verification provider configuration' })
  @ApiParam({ name: 'providerId', description: 'Provider identifier (e.g. stub, national_id)' })
  @ApiResponse({ status: 200, description: 'Provider configuration.' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  @ApiResponse({ status: 404, description: 'Provider not found' })
  async getProviderConfig(
    @Param('providerId') providerId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const isAdmin = req.session.isAdmin ?? false
    if (!isAdmin) {
      throw new HttpException(
        { statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code, message: 'Admin role required' },
        403,
      )
    }

    const adapter = this.verificationProviderService.getAdapter(providerId)
    if (!adapter) {
      throw new HttpException(
        { statusCode: 404, error: VerificationErrorCodes.PROVIDER_NOT_FOUND, message: 'Provider not found' },
        404,
      )
    }

    const config = await this.verificationProviderService.getProviderConfig(providerId)
    return {
      providerId,
      displayName: adapter.displayName,
      config: config ?? { providerId, settings: {}, enabled: false },
    }
  }

  /**
   * PUT /api/admin/verification/providers/:providerId/config
   *
   * Update the configuration for a verification provider.
   */
  @Put('providers/:providerId/config')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update verification provider configuration' })
  @ApiParam({ name: 'providerId', description: 'Provider identifier' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['providerId', 'settings', 'enabled'],
      properties: {
        providerId: { type: 'string', description: 'Must match the URL providerId' },
        settings: { type: 'object', description: 'Provider-specific settings (URL, API key, etc.)' },
        enabled: { type: 'boolean', description: 'Whether the provider is enabled' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Configuration updated.' })
  @ApiResponse({ status: 400, description: 'Validation error or providerId mismatch' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  @ApiResponse({ status: 404, description: 'Provider not found' })
  async setProviderConfig(
    @Param('providerId') providerId: string,
    @Body() rawBody: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    const isAdmin = req.session.isAdmin ?? false
    if (!isAdmin) {
      throw new HttpException(
        { statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code, message: 'Admin role required' },
        403,
      )
    }

    const parsed = SetProviderConfigSchema.safeParse(rawBody)
    if (!parsed.success) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: 'Invalid provider config' },
        400,
      )
    }

    if (parsed.data.providerId !== providerId) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: 'providerId in body must match URL parameter' },
        400,
      )
    }

    const adapter = this.verificationProviderService.getAdapter(providerId)
    if (!adapter) {
      throw new HttpException(
        { statusCode: 404, error: VerificationErrorCodes.PROVIDER_NOT_FOUND, message: 'Provider not found' },
        404,
      )
    }

    await this.verificationProviderService.setProviderConfig(providerId, parsed.data)

    this.logger.log(`Provider config updated: ${providerId} by ${req.session.userId}`)

    return { providerId, message: 'Configuration updated' }
  }

  /**
   * POST /api/admin/verification/providers/:providerId/reset-circuit-breaker
   *
   * Reset the circuit breaker for a provider back to CLOSED state.
   * Useful after a provider has recovered from an outage.
   */
  @Post('providers/:providerId/reset-circuit-breaker')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reset circuit breaker for a provider' })
  @ApiParam({ name: 'providerId', description: 'Provider identifier' })
  @ApiResponse({ status: 200, description: 'Circuit breaker reset.' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  @ApiResponse({ status: 404, description: 'Provider not found' })
  async resetCircuitBreaker(
    @Param('providerId') providerId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const isAdmin = req.session.isAdmin ?? false
    if (!isAdmin) {
      throw new HttpException(
        { statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code, message: 'Admin role required' },
        403,
      )
    }

    const reset = this.verificationProviderService.resetCircuitBreaker(providerId)
    if (!reset) {
      throw new HttpException(
        { statusCode: 404, error: VerificationErrorCodes.PROVIDER_NOT_FOUND, message: 'Provider not found' },
        404,
      )
    }

    this.logger.log(`Circuit breaker reset for provider: ${providerId} by ${req.session.userId}`)
    return { providerId, message: 'Circuit breaker reset' }
  }

  /**
   * POST /api/admin/verification/verify
   *
   * Run a verification through the specified provider.
   * This is a testing endpoint — in production, verification is triggered
   * automatically on profile creation.
   */
  @Post('verify')
  @HttpCode(200)
  @ApiOperation({ summary: 'Run verification (testing endpoint)' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['providerId', 'input'],
      properties: {
        providerId: { type: 'string', description: 'Provider identifier' },
        input: { type: 'object', description: 'Provider-specific input data' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Verification result.' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async runVerification(
    @Body() rawBody: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    const isAdmin = req.session.isAdmin ?? false
    if (!isAdmin) {
      throw new HttpException(
        { statusCode: 403, error: ErrorCodes.AUTHZ_FORBIDDEN.code, message: 'Admin role required' },
        403,
      )
    }

    const parsed = RunVerificationSchema.safeParse(rawBody)
    if (!parsed.success) {
      throw new HttpException(
        { statusCode: 400, error: ErrorCodes.VALIDATION_INPUT_INVALID.code, message: 'Invalid verification request' },
        400,
      )
    }

    this.logger.log(`Verification requested: provider=${parsed.data.providerId} by ${req.session.userId}`)

    return this.verificationProviderService.verify(parsed.data.providerId, parsed.data.input)
  }
}