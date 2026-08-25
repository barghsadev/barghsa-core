import {
  Controller,
  Get,
  Param,
  Logger,
  UseGuards,
} from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { GeographyService } from './geography.service.js'
import { SessionAuthGuard } from '../session/session.guard.js'

@ApiTags('Geography')
@Controller('api/geography')
@UseGuards(SessionAuthGuard)
export class GeographyController {
  private readonly logger = new Logger(GeographyController.name)

  constructor(private readonly geographyService: GeographyService) {}

  /**
   * GET /api/geography/provinces
   *
   * Returns all Iranian provinces ordered by Persian name.
   */
  @Get('provinces')
  @ApiOperation({ summary: 'List all provinces' })
  @ApiResponse({
    status: 200,
    description: 'List of provinces.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          nameFa: { type: 'string' },
          nameEn: { type: 'string' },
        },
      },
    },
  })
  async getProvinces() {
    return this.geographyService.getProvinces()
  }

  /**
   * GET /api/geography/provinces/:id/cities
   *
   * Returns all cities in the specified province ordered by Persian name.
   */
  @Get('provinces/:id/cities')
  @ApiOperation({ summary: 'List cities in a province' })
  @ApiResponse({
    status: 200,
    description: 'List of cities.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          provinceId: { type: 'string' },
          nameFa: { type: 'string' },
          nameEn: { type: 'string' },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async getCities(@Param('id') provinceId: string) {
    return this.geographyService.getCitiesByProvince(provinceId)
  }

  /**
   * GET /api/geography/company-types
   *
   * Returns all company/entity types ordered by Persian name
   * (T-03.02.03 — Legal profile form).
   */
  @Get('company-types')
  @ApiOperation({ summary: 'List all company types' })
  @ApiResponse({
    status: 200,
    description: 'List of company types.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          nameEn: { type: 'string' },
          nameFa: { type: 'string' },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async getCompanyTypes() {
    return this.geographyService.getCompanyTypes()
  }
}