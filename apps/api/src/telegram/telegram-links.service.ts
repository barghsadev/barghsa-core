import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpException, Injectable } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import type { PoolClient } from 'pg';
import type { ValidatedSession } from '../session/session.service.js';
import { requireCurrentSession, requireSessionStepUp } from '../session/session-step-up.js';
import { activeProfileSql } from '../profiles/profile-context.js';
import { TELEGRAM_BOT_USERNAME, telegramConfirmationCode } from './telegram-protocol.js';
import type { PrivateTelegramUpdate } from './telegram-protocol.js';

export type TelegramActor = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;
export const telegramTokenHash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
const deny = (status: number, error: string): never => {
  throw new HttpException({ error }, status);
};

type Intent = {
  id: string;
  user_id: string;
  profile_id: string;
  session_id: string;
  token_hash: string;
  status: string;
  expires_at: Date;
  telegram_user_id: string | null;
  chat_id: string | null;
  confirmation_attempts: number;
};

@Injectable()
export class TelegramLinksService {
  private transportReady = false;
  setTransportReady(ready: boolean) {
    this.transportReady = ready;
  }
  configured() {
    return this.credentialsConfigured() && this.transportReady;
  }
  credentialsConfigured() {
    return (
      /^\d+:[A-Za-z0-9_-]{20,}$/.test(process.env['CUSTOMER_TELEGRAM_BOT_TOKEN'] ?? '') &&
      /^[A-Za-z0-9_-]{32,256}$/.test(process.env['CUSTOMER_TELEGRAM_WEBHOOK_SECRET'] ?? '')
    );
  }

  private async scope(client: PoolClient, actor: TelegramActor, stepUp: boolean) {
    const selected = (await client.query<{ id: string }>(activeProfileSql(), [actor.userId]))
      .rows[0];
    if (!selected) return deny(403, 'TELEGRAM_PROFILE_UNAVAILABLE');
    await client.query('SELECT id FROM profiles WHERE id=$1 FOR SHARE', [selected.id]);
    const account = (
      await client.query(
        'SELECT disabled_at,activation_token FROM users WHERE user_id=$1 FOR UPDATE',
        [actor.userId]
      )
    ).rows[0];
    if (!account || account.disabled_at || account.activation_token)
      return deny(401, 'AUTH:UNAUTHENTICATED');
    await client.query(
      'SELECT role FROM profile_agents WHERE profile_id=$1 AND user_id=$2 FOR SHARE',
      [selected.id, actor.userId]
    );
    if (stepUp) await requireSessionStepUp(client, actor);
    else await requireCurrentSession(client, actor);
    const session = (
      await client.query(
        'SELECT operating_context FROM sessions WHERE session_id=$1 AND user_id=$2',
        [actor.sessionId, actor.userId]
      )
    ).rows[0];
    if (session?.operating_context !== 'customer')
      return deny(403, 'TELEGRAM_CUSTOMER_CONTEXT_REQUIRED');
    if (
      (await client.query<{ id: string }>(activeProfileSql(), [actor.userId])).rows[0]?.id !==
      selected.id
    )
      return deny(409, 'TELEGRAM_PROFILE_CHANGED');
    return selected.id;
  }

  private async write<T>(
    actor: TelegramActor,
    work: (client: PoolClient, profileId: string) => Promise<T>
  ) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const profileId = await this.scope(client, actor, true);
      const result = await work(client, profileId);
      if ((await this.scope(client, actor, true)) !== profileId)
        return deny(409, 'TELEGRAM_PROFILE_CHANGED');
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        ['23505', '23514', '40P01'].includes(String(error.code))
      )
        return deny(409, 'TELEGRAM_LINK_CHANGED');
      throw error;
    } finally {
      client.release();
    }
  }

  private async audit(
    client: PoolClient,
    actor: TelegramActor,
    event: string,
    details: Record<string, unknown>
  ) {
    await client.query(
      'INSERT INTO audit_log(id,user_id,event,metadata) VALUES(uuid_generate_v7(),$1,$2,$3)',
      [actor.userId, event, JSON.stringify(details)]
    );
  }

  async status(actor: TelegramActor) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const profileId = await this.scope(client, actor, false);
      const link =
        (
          await client.query(
            'SELECT id,profile_id,telegram_user_id,verified_at FROM telegram_links WHERE user_id=$1 AND revoked_at IS NULL',
            [actor.userId]
          )
        ).rows[0] ?? null;
      const intent =
        (
          await client.query(
            `SELECT id,status,telegram_user_id,expires_at,confirmation_attempts FROM telegram_link_intents
         WHERE user_id=$1 AND profile_id=$2 AND session_id=$3 AND status IN ('pending','claimed')
          AND expires_at>clock_timestamp() ORDER BY created_at DESC,id DESC LIMIT 1`,
            [actor.userId, profileId, actor.sessionId]
          )
        ).rows[0] ?? null;
      const latestDelivery =
        link || intent
          ? ((
              await client.query<{ status: string }>(
                `SELECT status FROM telegram_updates WHERE link_id=$1 OR intent_id=$2
         ORDER BY created_at DESC,id DESC LIMIT 1`,
                [link?.id ?? null, intent?.id ?? null]
              )
            ).rows[0] ?? null)
          : null;
      if ((await this.scope(client, actor, false)) !== profileId)
        return deny(409, 'TELEGRAM_PROFILE_CHANGED');
      await client.query('COMMIT');
      return { available: this.configured(), profileId, link, intent, latestDelivery };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async create(actor: TelegramActor) {
    if (!this.configured()) return deny(503, 'TELEGRAM_UNAVAILABLE');
    return this.write(actor, async (client, profileId) => {
      const quota = (
        await client.query<{ count: number }>(
          'SELECT count FROM rate_limit_rolling(true,$1,60000,5,true)',
          ['telegram:link:' + actor.userId]
        )
      ).rows[0]!;
      if (Number(quota.count) > 5) return deny(429, 'TELEGRAM_LINK_RATE_LIMITED');
      const cancelled = await client.query<{ id: string }>(
        "UPDATE telegram_link_intents SET status='cancelled' WHERE user_id=$1 AND status IN ('pending','claimed') RETURNING id",
        [actor.userId]
      );
      const token = randomBytes(32).toString('base64url');
      const intent = (
        await client.query<{ id: string; expires_at: Date }>(
          `INSERT INTO telegram_link_intents(user_id,profile_id,session_id,token_hash,expires_at)
         VALUES($1,$2,$3,$4,NOW()+INTERVAL '10 minutes') RETURNING id,expires_at`,
          [actor.userId, profileId, actor.sessionId, telegramTokenHash(token)]
        )
      ).rows[0]!;
      await this.audit(client, actor, 'telegram_link_requested', {
        intentId: intent.id,
        profileId,
        cancelledIntentIds: cancelled.rows.map((row) => row.id),
      });
      return {
        id: intent.id,
        expiresAt: intent.expires_at,
        botUsername: TELEGRAM_BOT_USERNAME,
        url: `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${token}`,
      };
    });
  }

  /** Called only after independently authenticating the Telegram webhook. */
  async claim(update: PrivateTelegramUpdate, token: string, requestHash: string) {
    const pointer = (
      await getDbPool().query<Intent>(
        "SELECT * FROM telegram_link_intents WHERE token_hash=$1 AND status='pending' AND expires_at>clock_timestamp()",
        [telegramTokenHash(token)]
      )
    ).rows[0];
    if (!pointer) return null;
    const session = (
      await getDbPool().query<{ csrf_token: string }>(
        'SELECT csrf_token FROM sessions WHERE session_id=$1 AND user_id=$2',
        [pointer.session_id, pointer.user_id]
      )
    ).rows[0];
    if (!session) return null;
    const actor = {
      userId: pointer.user_id,
      sessionId: pointer.session_id,
      csrfToken: session.csrf_token,
    };
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const profileId = await this.scope(client, actor, false);
      if (profileId !== pointer.profile_id) return deny(403, 'TELEGRAM_PROFILE_CHANGED');
      const claimed = (
        await client.query<{ id: string }>(
          `UPDATE telegram_link_intents SET status='claimed',telegram_user_id=$2,chat_id=$3,
           claimed_at=clock_timestamp() WHERE id=$1 AND status='pending'
           AND expires_at>clock_timestamp() RETURNING id`,
          [pointer.id, update.telegramUserId, update.chatId]
        )
      ).rows[0];
      if (!claimed) {
        await client.query('ROLLBACK');
        return null;
      }
      const queued = (
        await client.query<{ id: string }>(
          `INSERT INTO telegram_updates(update_id,message_id,telegram_user_id,chat_id,kind,intent_id,request_hash)
         VALUES($1,$2,$3,$4,'link_confirmation',$5,$6) RETURNING id`,
          [
            update.updateId,
            update.messageId,
            update.telegramUserId,
            update.chatId,
            claimed.id,
            requestHash,
          ]
        )
      ).rows[0]!;
      await this.audit(client, actor, 'telegram_link_claimed', {
        intentId: claimed.id,
        profileId,
        updateId: update.updateId,
      });
      if ((await this.scope(client, actor, false)) !== profileId)
        return deny(403, 'TELEGRAM_PROFILE_CHANGED');
      await client.query('COMMIT');
      return queued.id;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async claimForDelivery(id: string, telegramUserId: string, chatId: string) {
    const pointer = (
      await getDbPool().query<Intent & { csrf_token: string; locale: string }>(
        `SELECT i.*,s.csrf_token,u.locale FROM telegram_link_intents i
       JOIN sessions s ON s.session_id=i.session_id AND s.user_id=i.user_id JOIN users u ON u.user_id=i.user_id
       WHERE i.id=$1 AND i.status='claimed' AND i.expires_at>clock_timestamp()
        AND i.telegram_user_id=$2 AND i.chat_id=$3`,
        [id, telegramUserId, chatId]
      )
    ).rows[0];
    if (!pointer) return null;
    const actor = {
      userId: pointer.user_id,
      sessionId: pointer.session_id,
      csrfToken: pointer.csrf_token,
    };
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      if ((await this.scope(client, actor, false)) !== pointer.profile_id)
        return deny(403, 'TELEGRAM_PROFILE_CHANGED');
      const current = (
        await client.query<Intent>(
          "SELECT * FROM telegram_link_intents WHERE id=$1 AND status='claimed' AND expires_at>clock_timestamp() FOR SHARE",
          [id]
        )
      ).rows[0];
      await client.query('COMMIT');
      if (!current || current.telegram_user_id !== telegramUserId || current.chat_id !== chatId)
        return null;
      return {
        ...current,
        telegram_user_id: telegramUserId,
        chat_id: chatId,
        locale: pointer.locale === 'en' ? ('en' as const) : ('fa' as const),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async confirm(id: string, code: string, actor: TelegramActor) {
    if (!this.configured()) return deny(503, 'TELEGRAM_UNAVAILABLE');
    // A bad code commits its attempt counter; throwing inside the transaction would undo it.
    const result = await this.write(actor, async (client, profileId) => {
      const intent = (
        await client.query<Intent>(
          'SELECT * FROM telegram_link_intents WHERE id=$1 AND user_id=$2 AND profile_id=$3 AND session_id=$4 FOR UPDATE',
          [id, actor.userId, profileId, actor.sessionId]
        )
      ).rows[0];
      if (!intent) return deny(404, 'TELEGRAM_INTENT_NOT_FOUND');
      if (intent.status === 'confirmed') {
        const linked = (
          await client.query(
            'SELECT id,telegram_user_id,profile_id FROM telegram_links WHERE intent_id=$1 AND revoked_at IS NULL',
            [intent.id]
          )
        ).rows[0];
        if (!linked) return deny(409, 'TELEGRAM_INTENT_USED');
        return { link: linked, invalid: false };
      }
      if (
        intent.status !== 'claimed' ||
        !intent.telegram_user_id ||
        intent.confirmation_attempts >= 5 ||
        intent.expires_at <= new Date()
      )
        return deny(409, 'TELEGRAM_INTENT_UNAVAILABLE');
      const expected = telegramConfirmationCode(
        process.env['CUSTOMER_TELEGRAM_WEBHOOK_SECRET']!,
        intent.id,
        intent.telegram_user_id
      );
      const valid =
        /^\d{6}$/.test(code) && timingSafeEqual(Buffer.from(expected), Buffer.from(code));
      if (!valid) {
        await client.query(
          "UPDATE telegram_link_intents SET confirmation_attempts=confirmation_attempts+1,status=CASE WHEN confirmation_attempts=4 THEN 'cancelled' ELSE 'claimed' END WHERE id=$1",
          [id]
        );
        await this.audit(client, actor, 'telegram_link_confirmation_denied', {
          intentId: id,
          profileId,
        });
        return { link: null, invalid: true };
      }
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        'telegram:identity:' + intent.telegram_user_id,
      ]);
      const existing = (
        await client.query(
          'SELECT user_id FROM telegram_links WHERE telegram_user_id=$1 AND revoked_at IS NULL',
          [intent.telegram_user_id]
        )
      ).rows[0];
      if (existing && existing.user_id !== actor.userId)
        return deny(409, 'TELEGRAM_ACCOUNT_ALREADY_LINKED');
      const replaced = await client.query<{ id: string }>(
        'UPDATE telegram_links SET revoked_at=clock_timestamp() WHERE user_id=$1 AND revoked_at IS NULL RETURNING id',
        [actor.userId]
      );
      await client.query(
        "UPDATE telegram_link_intents SET status='confirmed',confirmed_at=clock_timestamp() WHERE id=$1",
        [id]
      );
      const link = (
        await client.query(
          `INSERT INTO telegram_links(user_id,profile_id,intent_id,telegram_user_id,chat_id,verified_at)
           SELECT user_id,profile_id,id,telegram_user_id,chat_id,confirmed_at
           FROM telegram_link_intents WHERE id=$1 AND user_id=$2 AND profile_id=$3
           RETURNING id,telegram_user_id,profile_id`,
          [id, actor.userId, profileId]
        )
      ).rows[0];
      await this.audit(client, actor, 'telegram_link_confirmed', {
        intentId: id,
        linkId: link.id,
        profileId,
        replacedLinkIds: replaced.rows.map((row) => row.id),
      });
      return { link, invalid: false };
    });
    if (result.invalid) return deny(422, 'TELEGRAM_CODE_INVALID');
    return result.link;
  }

  async revoke(actor: TelegramActor) {
    return this.write(actor, async (client, profileId) => {
      const rows = await client.query<{ id: string }>(
        'UPDATE telegram_links SET revoked_at=clock_timestamp() WHERE user_id=$1 AND revoked_at IS NULL RETURNING id',
        [actor.userId]
      );
      const intents = await client.query<{ id: string }>(
        "UPDATE telegram_link_intents SET status='cancelled' WHERE user_id=$1 AND status IN ('pending','claimed') RETURNING id",
        [actor.userId]
      );
      if (rows.rowCount || intents.rowCount)
        await this.audit(client, actor, 'telegram_link_revoked', {
          linkIds: rows.rows.map((row) => row.id),
          intentIds: intents.rows.map((row) => row.id),
          profileId,
        });
      return { revoked: true };
    });
  }
}
