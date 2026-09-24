import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import { getDbPool } from '@barghsa/db';
import { redactAnalyticsEvent } from '@barghsa/shared/analytics';
import { ErrorCodes } from '@barghsa/shared/errors';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { requireCurrentSession } from '../session/session-step-up.js';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';

const consentInput = z.object({ consent: z.boolean() }).strict();

@ApiTags('User Analytics')
@Controller('api/user/analytics')
@UseGuards(SessionAuthGuard)
export class AnalyticsController {
  @Get('consent')
  @HttpCode(200)
  @RateLimit({ namespace: 'analytics:consent:get', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Read optional product analytics consent' })
  @ApiResponse({
    status: 200,
    schema: { type: 'object', properties: { consent: { type: 'boolean', nullable: true } } },
  })
  async getConsent(@Req() req: AuthenticatedRequest) {
    const result = await getDbPool().query(
      'SELECT analytics_consent,disabled_at FROM users WHERE user_id=$1',
      [req.session.userId]
    );
    const account = result.rows[0];
    if (!account || account.disabled_at)
      throw new HttpException({ error: ErrorCodes.AUTH_UNAUTHENTICATED.code }, 401);
    return { consent: account.analytics_consent as boolean | null };
  }

  @Put('consent')
  @HttpCode(200)
  @RateLimit({ namespace: 'analytics:consent:put', limit: 20, windowMs: 60_000 })
  @ApiOperation({ summary: 'Change optional product analytics consent' })
  @ApiBody({
    schema: { type: 'object', required: ['consent'], properties: { consent: { type: 'boolean' } } },
  })
  @ApiResponse({
    status: 200,
    schema: { type: 'object', properties: { consent: { type: 'boolean' } } },
  })
  async updateConsent(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const parsed = consentInput.safeParse(body);
    if (!parsed.success)
      throw new HttpException({ error: ErrorCodes.VALIDATION_INPUT_INVALID.code }, 400);
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const account = (
        await client.query(
          'SELECT analytics_consent,disabled_at FROM users WHERE user_id=$1 FOR UPDATE',
          [req.session.userId]
        )
      ).rows[0];
      if (!account || account.disabled_at)
        throw new HttpException({ error: ErrorCodes.AUTH_UNAUTHENTICATED.code }, 401);
      await requireCurrentSession(client, req.session);
      await client.query(
        'UPDATE users SET analytics_consent=$1,updated_at=NOW() WHERE user_id=$2',
        [parsed.data.consent, req.session.userId]
      );
      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip,created_at)
         VALUES ($1,$2,'analytics_consent_changed',$3::jsonb,$4,$5,NOW())`,
        [
          uuidv7(),
          req.session.userId,
          JSON.stringify({ before: account.analytics_consent, after: parsed.data.consent }),
          correlationIdStorage.getStore() ?? uuidv7(),
          req.ip ?? null,
        ]
      );
      await requireCurrentSession(client, req.session);
      await client.query('COMMIT');
      return { consent: parsed.data.consent };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  @Post('events')
  @HttpCode(204)
  @RateLimit({ namespace: 'analytics:events:post', limit: 120, windowMs: 60_000 })
  @ApiOperation({ summary: 'Record a consented, redacted product analytics event' })
  @ApiResponse({ status: 204, description: 'Event accepted' })
  async recordEvent(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const event = redactAnalyticsEvent(body);
    if (!event) throw new HttpException({ error: ErrorCodes.VALIDATION_INPUT_INVALID.code }, 400);
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const account = (
        await client.query(
          'SELECT analytics_consent,disabled_at FROM users WHERE user_id=$1 FOR SHARE',
          [req.session.userId]
        )
      ).rows[0];
      if (!account || account.disabled_at)
        throw new HttpException({ error: ErrorCodes.AUTH_UNAUTHENTICATED.code }, 401);
      await requireCurrentSession(client, req.session);
      if (account.analytics_consent !== true)
        throw new HttpException({ error: 'ANALYTICS_CONSENT_REQUIRED' }, 403);
      await client.query(
        'INSERT INTO analytics_events(id,event_name,area,service) VALUES ($1,$2,$3,$4)',
        [
          uuidv7(),
          event.name,
          'area' in event ? event.area : null,
          'service' in event ? event.service : null,
        ]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}
