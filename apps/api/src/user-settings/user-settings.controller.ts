import {
  Body,
  Controller,
  Get,
  Put,
  HttpCode,
  HttpException,
  Logger,
  Req,
  UseGuards,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { getDbPool } from '@barghsa/db';
import { ErrorCodes } from '@barghsa/shared/errors';
import { SessionAuthGuard } from '../session/session.guard.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { requireCurrentSession } from '../session/session-step-up.js';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';

/**
 * Allowed notification channel values.
 */
const VALID_CHANNELS = ['SMS', 'EMAIL', 'IN_APP'] as const;
type NotificationChannel = (typeof VALID_CHANNELS)[number];
const notificationPreferencesInput = z
  .object({
    channels: z.array(z.enum(VALID_CHANNELS)).min(1).max(3),
  })
  .strict();

@ApiTags('User Settings')
@Controller('api/user/settings')
@UseGuards(SessionAuthGuard)
export class UserSettingsController {
  private readonly logger = new Logger(UserSettingsController.name);

  /**
   * GET /api/user/settings/notifications
   *
   * Returns the current user's notification channel preferences.
   */
  @Get('notifications')
  @HttpCode(200)
  @RateLimit({ namespace: 'settings:notifications:get', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Get notification channel preferences' })
  @ApiResponse({
    status: 200,
    description: 'Current notification preferences.',
    schema: {
      type: 'object',
      properties: {
        channels: { type: 'array', items: { type: 'string', enum: ['SMS', 'EMAIL', 'IN_APP'] } },
        availableChannels: {
          type: 'array',
          items: { type: 'string', enum: ['SMS', 'EMAIL', 'IN_APP'] },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async getNotificationPreferences(@Req() req: AuthenticatedRequest) {
    return this.readNotificationPreferences(getDbPool(), req.session.userId);
  }

  private async readNotificationPreferences(client: Pick<PoolClient, 'query'>, userId: string) {
    const result = await client.query(
      `SELECT u.notification_preferences,u.disabled_at,
       EXISTS(SELECT 1 FROM account_login_identifiers i WHERE i.user_id=u.user_id AND (
         (i.kind='primary' AND i.destination=lower(u.username) AND i.destination LIKE '%@%') OR
         (i.kind='email' AND i.destination=lower(u.email) AND i.verified_at IS NOT NULL))) AS has_email,
       EXISTS(SELECT 1 FROM account_login_identifiers i WHERE i.user_id=u.user_id AND (
         (i.kind='primary' AND i.destination=u.username AND i.destination LIKE '+%') OR
         (i.kind='mobile' AND i.destination=u.mobile AND i.verified_at IS NOT NULL))) AS has_mobile
       FROM users u WHERE u.user_id=$1`,
      [userId]
    );
    const user = result.rows[0];
    if (!user) throw new HttpException({ error: ErrorCodes.NOT_FOUND_RESOURCE.code }, 404);
    if (user.disabled_at)
      throw new HttpException({ error: ErrorCodes.AUTH_UNAUTHENTICATED.code }, 401);
    const availableChannels: NotificationChannel[] = ['IN_APP'];
    if (user.has_email) availableChannels.push('EMAIL');
    if (user.has_mobile) availableChannels.push('SMS');
    const saved = (user.notification_preferences as string).split(',');
    const channels = availableChannels.filter(
      (channel) => channel === 'IN_APP' || saved.includes(channel)
    );
    return { channels, availableChannels };
  }

  /**
   * PUT /api/user/settings/notifications
   *
   * Updates the authenticated user's notification channel preferences.
   * At minimum, IN_APP is always included.
   * Only channels that are available to the user are accepted:
   * - EMAIL: only if the user has an email address
   * - SMS: only if the user has a mobile number
   */
  @Put('notifications')
  @HttpCode(200)
  @RateLimit({ namespace: 'settings:notifications:put', limit: 20, windowMs: 60_000 })
  @ApiOperation({ summary: 'Update notification channel preferences' })
  @ApiResponse({
    status: 200,
    description: 'Notification preferences updated.',
    schema: {
      type: 'object',
      properties: {
        channels: { type: 'array', items: { type: 'string', enum: ['SMS', 'EMAIL', 'IN_APP'] } },
        availableChannels: {
          type: 'array',
          items: { type: 'string', enum: ['SMS', 'EMAIL', 'IN_APP'] },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid channels' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async updateNotificationPreferences(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const parsed = notificationPreferencesInput.safeParse(body);
    if (!parsed.success)
      throw new HttpException({ error: ErrorCodes.VALIDATION_INPUT_INVALID.code }, 400);
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      // Contact changes use the same account lock. Read availability after any wait.
      await client.query('SELECT user_id FROM users WHERE user_id=$1 FOR UPDATE', [
        req.session.userId,
      ]);
      await requireCurrentSession(client, req.session);
      const current = await this.readNotificationPreferences(client, req.session.userId);
      if (parsed.data.channels.some((channel) => !current.availableChannels.includes(channel)))
        throw new HttpException({ error: ErrorCodes.VALIDATION_INPUT_INVALID.code }, 400);
      const channels = current.availableChannels.filter(
        (channel) => channel === 'IN_APP' || parsed.data.channels.includes(channel)
      );
      await client.query(
        'UPDATE users SET notification_preferences=$1,updated_at=NOW() WHERE user_id=$2',
        [channels.join(','), req.session.userId]
      );
      await client.query(
        `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip,created_at)
         VALUES ($1,$2,'notification_preferences_changed',$3::jsonb,$4,$5,NOW())`,
        [
          uuidv7(),
          req.session.userId,
          JSON.stringify({ before: current.channels, after: channels }),
          correlationIdStorage.getStore() ?? uuidv7(),
          req.ip ?? null,
        ]
      );
      await requireCurrentSession(client, req.session);
      await client.query('COMMIT');
      return { channels, availableChannels: current.availableChannels };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  // ── Timezone Settings (T-03.03.06) ─────────────────────────────────────

  /**
   * Validates a timezone string against the IANA timezone database.
   * Returns true if the timezone is valid.
   */
  private isValidTimezone(tz: string): boolean {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * GET /api/user/settings/timezone
   *
   * Returns the current user's timezone setting.
   */
  @Get('timezone')
  @HttpCode(200)
  @RateLimit({ namespace: 'settings:timezone:get', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Get timezone setting' })
  @ApiResponse({
    status: 200,
    description: 'Current timezone.',
    schema: {
      type: 'object',
      properties: {
        timezone: { type: 'string', example: 'Asia/Tehran' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async getTimezone(@Req() req: AuthenticatedRequest) {
    const userId = req.session.userId;
    const pool = getDbPool();

    const result = await pool.query(`SELECT timezone FROM users WHERE user_id = $1`, [userId]);

    if (result.rows.length === 0) {
      throw new HttpException({ statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code }, 404);
    }

    const timezone = result.rows[0].timezone as string;
    this.logger.debug(`User ${userId}: timezone = ${timezone}`);
    return { timezone };
  }

  /**
   * PUT /api/user/settings/timezone
   *
   * Updates the authenticated user's timezone setting.
   * Accepts any valid IANA timezone string.
   */
  @Put('timezone')
  @HttpCode(200)
  @RateLimit({ namespace: 'settings:timezone:put', limit: 20, windowMs: 60_000 })
  @ApiOperation({ summary: 'Update timezone setting' })
  @ApiResponse({
    status: 200,
    description: 'Timezone updated.',
    schema: {
      type: 'object',
      properties: {
        timezone: { type: 'string', example: 'Asia/Tehran' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid timezone' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async updateTimezone(@Body() body: { timezone: string }, @Req() req: AuthenticatedRequest) {
    const userId = req.session.userId;

    if (!body.timezone || typeof body.timezone !== 'string') {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: 'Timezone must be a non-empty string',
        },
        400
      );
    }

    // Validate against IANA timezone database
    if (!this.isValidTimezone(body.timezone)) {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: `Invalid timezone: "${body.timezone}". Must be a valid IANA timezone string (e.g. "Asia/Tehran", "UTC").`,
        },
        400
      );
    }

    const pool = getDbPool();
    const result = await pool.query(
      `UPDATE users SET timezone = $1, updated_at = NOW() WHERE user_id = $2 RETURNING timezone`,
      [body.timezone, userId]
    );

    if (result.rows.length === 0) {
      throw new HttpException({ statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code }, 404);
    }

    const timezone = result.rows[0].timezone as string;
    this.logger.log(`User ${userId}: timezone updated to ${timezone}`);

    return { timezone };
  }

  // ── Marketing Consent (T-05.05.03) ──────────────────────────────

  /**
   * Channels eligible for marketing consent (email/SMS). In-app is never
   * consent-gated and is therefore excluded from this surface.
   */
  private static readonly MARKETING_CHANNELS: ReadonlyArray<'email' | 'sms'> = ['email', 'sms'];

  /**
   * Resolve the profile ids the marketing consent applies to.
   *
   * Consent is stored per (profile, channel). A user may own several active
   * profiles; we apply consent to every non-archived profile so the delivery
   * gate (T-05.05.02) honors the choice regardless of which profile an
   * outbox row references.
   */
  private async resolveConsentProfileIds(
    pool: {
      query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
    },
    userId: string
  ): Promise<string[]> {
    const res = await pool.query(
      `SELECT id FROM profiles WHERE user_id = $1 AND archived = false ORDER BY is_default DESC, created_at ASC`,
      [userId]
    );
    return res.rows.map((r) => r.id as string);
  }

  /**
   * GET /api/user/settings/marketing-consent
   *
   * Returns the authenticated user's marketing consent state for the
   * email and SMS channels, along with the last time it changed. Consent is
   * stored per (profile, channel); we report from the user's default (first
   * active) profile.
   */
  @Get('marketing-consent')
  @HttpCode(200)
  @RateLimit({ namespace: 'settings:marketing:get', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Get marketing consent preferences' })
  @ApiResponse({
    status: 200,
    description: 'Marketing consent for email and SMS.',
    schema: {
      type: 'object',
      properties: {
        channels: {
          type: 'object',
          properties: {
            email: {
              type: 'object',
              properties: {
                optedIn: { type: 'boolean' },
                lastChangedAt: { type: 'string', nullable: true },
              },
            },
            sms: {
              type: 'object',
              properties: {
                optedIn: { type: 'boolean' },
                lastChangedAt: { type: 'string', nullable: true },
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async getMarketingConsent(@Req() req: AuthenticatedRequest) {
    const userId = req.session.userId;
    const pool = getDbPool();

    const profiles = await this.resolveConsentProfileIds(pool, userId);
    // Default profile for display purposes. Empty consent by default.
    const empty: Record<string, { optedIn: boolean; lastChangedAt: string | null }> = {
      email: { optedIn: false, lastChangedAt: null },
      sms: { optedIn: false, lastChangedAt: null },
    };
    if (profiles.length === 0) {
      return { channels: empty };
    }

    const res = await pool.query(
      `SELECT channel, marketing_opted_in, updated_at
         FROM user_notification_preferences
        WHERE profile_id = $1 AND channel IN ('email','sms')`,
      [profiles[0]]
    );

    const channels: Record<string, { optedIn: boolean; lastChangedAt: string | null }> = {
      email: { optedIn: false, lastChangedAt: null },
      sms: { optedIn: false, lastChangedAt: null },
    };
    for (const row of res.rows) {
      const ch = row.channel as 'email' | 'sms';
      if (ch !== 'email' && ch !== 'sms') continue;
      channels[ch] = {
        optedIn: Boolean(row.marketing_opted_in),
        lastChangedAt: (row.updated_at as string) ?? null,
      };
    }

    return { channels };
  }

  /**
   * PUT /api/user/settings/marketing-consent
   *
   * Sets the user's marketing consent for the email and/or SMS channels.
   * Consent is applied to every active profile and recorded in the audit
   * trail. When opting in, `consent_granted_at` is stamped; when opting out,
   * `consent_revoked_at` is stamped. The consent writes and the audit insert
   * run inside a single transaction so a failure can never leave per-profile
   * consent in an inconsistent state.
   */
  @Put('marketing-consent')
  @HttpCode(200)
  @RateLimit({ namespace: 'settings:marketing:put', limit: 20, windowMs: 60_000 })
  @ApiOperation({ summary: 'Update marketing consent preferences' })
  @ApiResponse({
    status: 200,
    description: 'Marketing consent updated.',
    schema: { type: 'object' },
  })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async updateMarketingConsent(
    @Body()
    body: {
      email?: boolean;
      sms?: boolean;
    },
    @Req() req: AuthenticatedRequest
  ) {
    const userId = req.session.userId;

    if (typeof body.email !== 'boolean' && typeof body.sms !== 'boolean') {
      throw new HttpException(
        {
          statusCode: 400,
          error: ErrorCodes.VALIDATION_INPUT_INVALID.code,
          message: 'Provide at least one of email or sms as a boolean.',
        },
        400
      );
    }

    // Normalize: only provided channels are touched.
    const desired = new Map<string, boolean>();
    if (typeof body.email === 'boolean') desired.set('email', body.email);
    if (typeof body.sms === 'boolean') desired.set('sms', body.sms);

    const pool = getDbPool();
    const profiles = await this.resolveConsentProfileIds(pool, userId);
    if (profiles.length === 0) {
      throw new HttpException({ statusCode: 404, error: ErrorCodes.NOT_FOUND_RESOURCE.code }, 404);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const profileId of profiles) {
        for (const channel of UserSettingsController.MARKETING_CHANNELS) {
          if (!desired.has(channel)) continue;
          const optedIn = desired.get(channel) as boolean;
          await client.query(
            `INSERT INTO user_notification_preferences
               (id, profile_id, channel, marketing_opted_in,
                consent_granted_at, consent_revoked_at, created_at, updated_at)
             VALUES ($1, $2, $3, $4,
                     CASE WHEN $4 THEN NOW() ELSE NULL END,
                     CASE WHEN $4 THEN NULL ELSE NOW() END,
                     NOW(), NOW())
             ON CONFLICT (profile_id, channel) DO UPDATE SET
               marketing_opted_in = EXCLUDED.marketing_opted_in,
               consent_granted_at = CASE WHEN EXCLUDED.marketing_opted_in
                                   THEN NOW() ELSE user_notification_preferences.consent_granted_at END,
               consent_revoked_at = CASE WHEN EXCLUDED.marketing_opted_in
                                   THEN NULL ELSE NOW() END,
               updated_at = NOW()`,
            [uuidv7(), profileId, channel, optedIn]
          );
        }
      }

      // Audit trail — committed with the consent writes.
      await client.query(
        `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, NOW())`,
        [
          uuidv7(),
          userId,
          'marketing_consent_changed',
          JSON.stringify(Object.fromEntries(desired)),
          uuidv7(),
          req.ip ?? null,
        ]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    const updated = await this.getMarketingConsentInternal(pool, profiles[0] as string);
    this.logger.log(
      `User ${userId}: marketing consent updated -> ${JSON.stringify(Object.fromEntries(desired))}`
    );
    return { channels: updated };
  }

  /** Shared read used by both GET and PUT response. */
  private async getMarketingConsentInternal(
    pool: ReturnType<typeof getDbPool>,
    profileId: string
  ): Promise<Record<string, { optedIn: boolean; lastChangedAt: string | null }>> {
    const channels: Record<string, { optedIn: boolean; lastChangedAt: string | null }> = {
      email: { optedIn: false, lastChangedAt: null },
      sms: { optedIn: false, lastChangedAt: null },
    };
    const res = await pool.query(
      `SELECT channel, marketing_opted_in, updated_at
         FROM user_notification_preferences
        WHERE profile_id = $1 AND channel IN ('email','sms')`,
      [profileId]
    );
    for (const row of res.rows) {
      const ch = row.channel as 'email' | 'sms';
      if (ch !== 'email' && ch !== 'sms') continue;
      channels[ch] = {
        optedIn: Boolean(row.marketing_opted_in),
        lastChangedAt: (row.updated_at as string) ?? null,
      };
    }
    return channels;
  }
}
