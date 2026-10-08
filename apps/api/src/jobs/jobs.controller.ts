import { Controller, Get, HttpCode, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { relativeLinkRoute } from '@barghsa/shared/notifications';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { JobService } from './jobs.service.js';

@ApiTags('Jobs')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/jobs')
export class JobsController {
  constructor(private readonly jobs: JobService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Read your async job status' })
  get(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.jobs.get(id, req.session.userId, req.session.operatingContext);
  }

  @Get(':id/status')
  @ApiOperation({ summary: 'Read your async job status' })
  status(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.jobs.get(id, req.session.userId, req.session.operatingContext);
  }

  @Get(':id/result')
  @ApiOperation({ summary: 'Open your completed async job result' })
  @ApiResponse({ status: 202, description: 'Job is still queued or processing' })
  @ApiResponse({ status: 204, description: 'Job completed without a result URL' })
  @ApiResponse({ status: 302, description: 'Redirect to the completed result' })
  @ApiResponse({ status: 409, description: 'Job failed' })
  async result(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response
  ): Promise<void> {
    const job = await this.jobs.get(id, req.session.userId, req.session.operatingContext);
    const resultUrl = relativeLinkRoute({ link_route: job.result_url });
    if (job.status === 'completed' && resultUrl) {
      res.redirect(302, resultUrl);
      return;
    }
    if (job.status === 'completed') {
      res.status(204).end();
      return;
    }
    res.status(job.status === 'failed' ? 409 : 202).json({
      id: job.id,
      status: job.status,
      progress_pct: job.progress_pct,
      error_message: job.error_message,
    });
  }

  @Post(':id/retry')
  @HttpCode(202)
  @ApiOperation({ summary: 'Retry your failed async job' })
  retry(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.jobs.retry(id, req.session);
  }
}
