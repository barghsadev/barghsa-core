import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import { z } from 'zod'
import { AdminGeographyService } from './admin-geography.service.js'
import { SessionAuthGuard } from '../session/session.guard.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'

// ---------------------------------------------------------------------------
// Zod validation schemas
// ---------------------------------------------------------------------------

const nameFaRe = /^[\u0600-\u06FF\s]+$/
const nameEnRe = /^[a-zA-Z\s]+$/

export const CreateProvinceSchema = z.object({
  nameFa: z
    .string()
    .min(1, { message: 'VALIDATION:INPUT:MISSING' })
    .max(100)
    .regex(nameFaRe, { message: 'VALIDATION:INVALID_PERSIAN_NAME' }),
  nameEn: z
    .string()
    .min(1, { message: 'VALIDATION:INPUT:MISSING' })
    .max(100)
    .regex(nameEnRe, { message: 'VALIDATION:INVALID_ENGLISH_NAME' }),
})

export const UpdateProvinceSchema = z.object({
  nameFa: z
    .string()
    .min(1, { message: 'VALIDATION:INPUT:MISSING' })
    .max(100)
    .regex(nameFaRe, { message: 'VALIDATION:INVALID_PERSIAN_NAME' })
    .optional(),
  nameEn: z
    .string()
    .min(1, { message: 'VALIDATION:INPUT:MISSING' })
    .max(100)
    .regex(nameEnRe, { message: 'VALIDATION:INVALID_ENGLISH_NAME' })
    .optional(),
  status: z.enum(['active', 'inactive']).optional(),
})

export type CreateProvinceDto = z.infer<typeof CreateProvinceSchema>
export type UpdateProvinceDto = z.infer<typeof UpdateProvinceSchema>

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@ApiTags('Admin Geography')
@Controller('api/admin/geography')
@UseGuards(SessionAuthGuard)
export class AdminGeographyController {
  private readonly logger = new Logger(AdminGeographyController.name)

  constructor(private readonly adminGeographyService: AdminGeographyService) {}

  /**
   * GET /api/admin/geography/provinces
   *
   * List provinces with optional search, status filter, and pagination.
   * Requires admin (isAdmin) privileges.
   */
  @Get('provinces')
  @ApiOperation({ summary: 'List provinces (admin)' })
  @ApiQuery({ name: 'search', required: false, description: 'Search in Persian/English name' })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by status (active/inactive)' })
  @ApiQuery({ name: 'page', required: false, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, description: 'Items per page (default: 20, max: 100)' })
  @ApiResponse({ status: 200, description: 'Paginated province list.' })
  @ApiResponse({ status: 403, description: 'Not admin.' })
  async listProvinces(
    @Req() req: AuthenticatedRequest,
    @Query('search') search?: string,
    @Query('status') status?: 'active' | 'inactive',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    this.requireAdmin(req)
    return this.adminGeographyService.listProvinces({
      search,
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    })
  }

  /**
   * GET /api/admin/geography/provinces/:id
   *
   * Get a single province by ID.
   */
  @Get('provinces/:id')
  @ApiOperation({ summary: 'Get province by ID (admin)' })
  @ApiResponse({ status: 200, description: 'Province details.' })
  @ApiResponse({ status: 404, description: 'Province not found.' })
  async getProvince(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    this.requireAdmin(req)
    const province = await this.adminGeographyService.getProvince(id)
    if (!province) {
      throw new HttpException(
        { statusCode: 404, error: 'GEOGRAPHY:PROVINCE_NOT_FOUND', message: 'Province not found' },
        404,
      )
    }
    return province
  }

  /**
   * POST /api/admin/geography/provinces
   *
   * Create a new province.
   */
  @Post('provinces')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create province (admin)' })
  @ApiResponse({ status: 201, description: 'Province created.' })
  @ApiResponse({ status: 400, description: 'Validation error.' })
  @ApiResponse({ status: 409, description: 'Province already exists.' })
  async createProvince(
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    this.requireAdmin(req)
    const parsed = CreateProvinceSchema.safeParse(body)
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]
      throw new HttpException(
        { statusCode: 400, error: firstIssue?.message ?? 'VALIDATION_ERROR', message: 'Invalid input' },
        400,
      )
    }
    return this.adminGeographyService.createProvince(parsed.data)
  }

  /**
   * PATCH /api/admin/geography/provinces/:id
   *
   * Update an existing province.
   */
  @Patch('provinces/:id')
  @ApiOperation({ summary: 'Update province (admin)' })
  @ApiResponse({ status: 200, description: 'Province updated.' })
  @ApiResponse({ status: 404, description: 'Province not found.' })
  @ApiResponse({ status: 409, description: 'Province name conflict.' })
  async updateProvince(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    this.requireAdmin(req)
    const parsed = UpdateProvinceSchema.safeParse(body)
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]
      throw new HttpException(
        { statusCode: 400, error: firstIssue?.message ?? 'VALIDATION_ERROR', message: 'Invalid input' },
        400,
      )
    }
    const province = await this.adminGeographyService.updateProvince(id, parsed.data as UpdateProvinceDto)
    if (!province) {
      throw new HttpException(
        { statusCode: 404, error: 'GEOGRAPHY:PROVINCE_NOT_FOUND', message: 'Province not found' },
        404,
      )
    }
    return province
  }

  /**
   * DELETE /api/admin/geography/provinces/:id
   *
   * Soft-delete (set inactive) a province. Rejects if cities reference it.
   */
  @Delete('provinces/:id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete (deactivate) province (admin)' })
  @ApiResponse({ status: 200, description: 'Province deactivated.' })
  @ApiResponse({ status: 404, description: 'Province not found.' })
  @ApiResponse({ status: 409, description: 'Province has cities.' })
  async deleteProvince(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    this.requireAdmin(req)
    const deleted = await this.adminGeographyService.deleteProvince(id)
    if (!deleted) {
      throw new HttpException(
        { statusCode: 404, error: 'GEOGRAPHY:PROVINCE_NOT_FOUND', message: 'Province not found' },
        404,
      )
    }
    return { success: true }
  }

  // ---------------------------------------------------------------------------
  // Permission helper
  // ---------------------------------------------------------------------------

  private requireAdmin(req: AuthenticatedRequest): void {
    const isAdmin = req.session.isAdmin ?? false
    if (!isAdmin) {
      throw new HttpException(
        { statusCode: 403, error: 'FORBIDDEN', message: 'Admin role required' },
        403,
      )
    }
  }
}