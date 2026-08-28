import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Logger,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import { z } from 'zod'
import { SessionAuthGuard } from '../session/session.guard.js'
import type { AuthenticatedRequest } from '../session/session.guard.js'
import { ErrorCodes } from '@barghsa/shared/errors'
import { FailedJobsService, type FailedJobDto } from './failed-jobs.service.js'
import { BACKGROUND_JOB_STATUSES, BACKGROUND_JOB_TYPES } from '@barghsa/shared/admin'

/** Strict validation for the list view's limit/offset query params. */
const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})

/** Strict validation for the bulk-retry body. */
const BulkRetrySchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(200),
})

/** Swagger enum values for the background job statuses. */
const STATUSES = [...BACKGROUND_JOB_STATUSES] as const

/** Swagger enum values for the job types. */
const JOB_TYPES = BACKGROUND_JOB_TYPES.map((t) => t.key) as readonly string[]

/**
 * Failed-jobs dashboard controller (S-09.09, T-09.09.02).
 *
 * Admin/staff surface for background-job failures recorded by the worker:
 *
 * - `GET  /api/admin/failed-jobs` — triage view (filters: status, jobType,
 *   limit, offset);
 * - `POST /api/admin/failed-jobs/:id/retry` — retry a single failed/
 *   dead-lettered job;
 * - `POST /api/admin/failed-jobs/retry-bulk` — retry many at once;
 * - `POST /api/admin/failed-jobs/:id/resolve` — mark a job resolved.
 *
 * The list view is gated by the S-09.09 capability `admin:jobs:view`;
 * state transitions by `admin:jobs:retry`. Today the session model exposes
 * only `isAdmin` (platform admin); granular staff-role permissions arrive
 * with the role system. Until then both capabilities map to a platform admin
 * session, mirroring the S-09.09 reconciliation controller.
 */
@ApiTags('Admin')
@Controller('api/admin/failed-jobs')
@UseGuards(SessionAuthGuard)
export class FailedJobsController {
  private readonly logger = new Logger(FailedJobsController.name)

  constructor(private readonly failedJobsService: FailedJobsService) {}

  /**
   * Permission gate for viewing the failed-jobs dashboard.
   *
   * Capability `admin:jobs:view` maps to a platform admin session today;
   * centralized here as a single enforcement point.
   */
  private assertViewPermission(req: AuthenticatedRequest): void {
    if (!(req.session.isAdmin ?? false)) {
      this.logger.warn(
        `Non-admin user ${req.session.userId} attempted to view background jobs`,
      )
      throw new HttpException(
        {
          statusCode: 403,
          error: ErrorCodes.AUTHZ_FORBIDDEN.code,
          message: 'Admin role required to view background jobs',
        },
        403,
      )
    }
  }

  /**
   * Permission gate for background-job state transitions.
   *
   * Capability `admin:jobs:retry` maps to a platform admin session today.
   */
  private assertRetryPermission(req: AuthenticatedRequest): void {
    if (!(req.session.isAdmin ?? false)) {
      this.logger.warn(
        `Non-admin user ${req.session.userId} attempted to mutate a background job`,
      )
      throw new HttpException(
        {
          statusCode: 403,
          error: ErrorCodes.AUTHZ_FORBIDDEN.code,
          message: 'Admin role required to retry or resolve background jobs',
        },
        403,
      )
    }
  }

  /**
   * GET /api/admin/failed-jobs?status=failed&jobType=service_breach_scan&limit=50&offset=0
   *
   * Triage view for background-job failures, most-recently-failed first.
   */
  @Get()
  @ApiOperation({ summary: 'List failed background jobs (admin)' })
  @ApiQuery({ name: 'status', required: false, enum: STATUSES })
  @ApiQuery({ name: 'jobType', required: false, enum: JOB_TYPES })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'List of background job failures', type: [Object] })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async listFailedJobs(
    @Query('status') status: string | undefined,
    @Query('jobType') jobType: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('offset') offset: string | undefined,
    @Req() req: AuthenticatedRequest,
  ): Promise<FailedJobDto[]> {
    this.assertViewPermission(req)
    const options: Parameters<FailedJobsService['listFailedJobs']>[0] = {}
    if (status !== undefined) {
      options.status = status as NonNullable<typeof options.status>
    }
    if (jobType !== undefined) {
      options.jobType = jobType
    }
    if (limit !== undefined || offset !== undefined) {
      const parsed = ListQuerySchema.safeParse({ limit, offset })
      if (!parsed.success) {
        throw new HttpException(
          {
            statusCode: 400,
            error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
            message: 'limit must be an integer 1..200 and offset a non-negative integer',
          },
          400,
        )
      }
      if (parsed.data.limit !== undefined) options.limit = parsed.data.limit
      if (parsed.data.offset !== undefined) options.offset = parsed.data.offset
    }
    return this.failedJobsService.listFailedJobs(options)
  }

  /**
   * POST /api/admin/failed-jobs/:id/retry
   *
   * Reset a failed/dead-lettered job's budget and mark it for re-running.
   * A resolved job or an unknown id is rejected (409/404).
   */
  @Post(':id/retry')
  @HttpCode(200)
  @ApiOperation({ summary: 'Retry a failed background job (admin)' })
  @ApiParam({ name: 'id', description: 'Background job ID' })
  @ApiResponse({ status: 200, description: 'Job moved to retrying', type: Object })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  @ApiResponse({ status: 409, description: 'State transition not allowed' })
  async retryJob(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<FailedJobDto> {
    this.assertRetryPermission(req)
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown'
    return this.failedJobsService.retryFailedJob(id, req.session.userId, ip)
  }

  /**
   * POST /api/admin/failed-jobs/retry-bulk
   *
   * Retry many failed/dead-lettered jobs at once. Non-retryable or unknown
   * ids are skipped. Body: `{ "ids": ["...", "..."] }`.
   */
  @Post('retry-bulk')
  @HttpCode(200)
  @ApiOperation({ summary: 'Bulk-retry failed background jobs (admin)' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['ids'],
      properties: { ids: { type: 'array', items: { type: 'string' }, description: 'Job IDs to retry' } },
    },
  })
  @ApiResponse({ status: 200, description: 'Retried jobs', type: [Object] })
  @ApiResponse({ status: 400, description: 'Invalid body' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  async retryBulk(
    @Body() rawBody: unknown,
    @Req() req: AuthenticatedRequest,
  ): Promise<FailedJobDto[]> {
    this.assertRetryPermission(req)
    const parsed = BulkRetrySchema.safeParse(rawBody)
    if (!parsed.success) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: 'ids must be a non-empty array of job ids (max 200)',
        },
        400,
      )
    }
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown'
    return this.failedJobsService.retryFailedJobsBulk(parsed.data.ids, req.session.userId, ip)
  }

  /**
   * POST /api/admin/failed-jobs/:id/resolve
   *
   * Mark a failed/retrying/dead-lettered job resolved (terminal).
   */
  @Post(':id/resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resolve a failed background job (admin)' })
  @ApiParam({ name: 'id', description: 'Background job ID' })
  @ApiResponse({ status: 200, description: 'Job resolved', type: Object })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  @ApiResponse({ status: 403, description: 'Admin role required' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  @ApiResponse({ status: 409, description: 'State transition not allowed' })
  async resolveJob(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<FailedJobDto> {
    this.assertRetryPermission(req)
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown'
    return this.failedJobsService.resolveFailedJob(id, req.session.userId, ip)
  }
}
