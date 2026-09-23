import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiZodBody } from '../openapi/zod-body.decorator.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { SolarRequestService } from './solar-request.service.js';
import { solarSubmission } from './solar-request.validation.js';

@ApiTags('Solar construction requests')
@ApiBearerAuth()
@Controller('api/solar/requests')
@UseGuards(SessionAuthGuard)
export class SolarRequestController {
  constructor(private readonly service: SolarRequestService) {}

  @Post()
  @RateLimit({ namespace: 'solar:submit:user', limit: 10, windowMs: 60_000 })
  @ApiOperation({
    summary: 'Submit a solar construction request without creating a contract or invoice',
  })
  @ApiZodBody(solarSubmission)
  submit(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const input = solarSubmission.safeParse(body);
    if (!input.success) throw new HttpException({ error: 'VALIDATION:INPUT_INVALID' }, 400);
    return this.service.submit(req.session, input.data, req.ip ?? '127.0.0.1');
  }

  @Get()
  @RateLimit({ namespace: 'solar:list:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'List solar construction requests for a profile' })
  list(
    @Query('profileId', new ParseUUIDPipe()) profileId: string,
    @Req() req: AuthenticatedRequest
  ) {
    return this.service.list(req.session, profileId);
  }

  @Get(':id')
  @RateLimit({ namespace: 'solar:detail:user', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Read a solar construction request and its current stage' })
  detail(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AuthenticatedRequest) {
    return this.service.detail(req.session, id);
  }
}
