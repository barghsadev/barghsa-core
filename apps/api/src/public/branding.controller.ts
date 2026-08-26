import { Controller, Get, Logger } from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { BrandConfigService } from '../admin/brand-config.service.js'

/**
 * Public brand configuration DTO — safe for unauthenticated consumption.
 *
 * Strips internal fields (id, version, status, createdBy, createdAt, updatedAt)
 * and returns only the frontend-facing config values.
 */
export interface PublicBrandConfigDto {
  appTitle: string
  slogan: string
  primaryColor: string
  secondaryColor: string
  accentColor: string
  logoUrl: string | null
  faviconUrl: string | null
  darkMode: boolean
}

/**
 * Public branding controller (T-09.01.02).
 *
 * Exposes the active brand configuration for unauthenticated pages
 * (login, register, forgot-password, public pages, email/notification templates).
 * No auth required — used by the frontend BrandThemeProvider to inject
 * CSS custom properties and display brand identity consistently.
 */
@ApiTags('Public')
@Controller('api/public')
export class PublicBrandingController {
  private readonly logger = new Logger(PublicBrandingController.name)

  constructor(
    private readonly brandConfigService: BrandConfigService,
  ) {}

  /**
   * GET /api/public/branding/config
   *
   * Returns the active brand configuration for public-facing UI.
   * No authentication required — public endpoint for theme injection.
   */
  @Get('branding/config')
  @ApiOperation({ summary: 'Get active brand configuration (public)' })
  @ApiResponse({ status: 200, description: 'Active brand configuration for theming.' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getActiveBrandConfig(): Promise<PublicBrandConfigDto> {
    const config = await this.brandConfigService.getActiveConfig()

    const brandConfig = config.config as Record<string, unknown>

    return {
      appTitle: (brandConfig.appTitle as string) ?? 'Barghsa',
      slogan: (brandConfig.slogan as string) ?? '',
      primaryColor: (brandConfig.primaryColor as string) ?? '#2563eb',
      secondaryColor: (brandConfig.secondaryColor as string) ?? '#64748b',
      accentColor: (brandConfig.accentColor as string) ?? '#f59e0b',
      logoUrl: (brandConfig.logoUrl as string | null) ?? null,
      faviconUrl: (brandConfig.faviconUrl as string | null) ?? null,
      darkMode: (brandConfig.darkMode as boolean) ?? false,
    }
  }
}