import { Controller, Get, Query, Logger } from '@nestjs/common'
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import { TosService, type CurrentTosResponse } from './tos.service.js'

@ApiTags('Terms of Service')
@Controller('api/tos')
export class TosController {
  private readonly logger = new Logger(TosController.name)

  constructor(private readonly tosService: TosService) {}

  /**
   * GET /api/tos/current
   *
   * Returns the current active Terms of Service version.
   * Public endpoint — no authentication required.
   * Supports Persian and English content via the `locale` query parameter.
   */
  @Get('current')
  @ApiOperation({ summary: 'Get current active TOS version' })
  @ApiQuery({
    name: 'locale',
    required: false,
    enum: ['fa', 'en'],
    description: 'Content locale (default: fa)',
  })
  @ApiResponse({
    status: 200,
    description: 'Current TOS version',
    schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'TOS content in the requested locale' },
        versionId: { type: 'string', description: 'Version identifier, e.g. "v1"' },
        updatedAt: { type: 'string', format: 'date-time' },
        publishedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'No active TOS version found' })
  async getCurrent(
    @Query('locale') locale?: string,
  ): Promise<CurrentTosResponse> {
    const normalizedLocale = locale === 'en' ? 'en' : 'fa'
    return this.tosService.getCurrent(normalizedLocale)
  }
}