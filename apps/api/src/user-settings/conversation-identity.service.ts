import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import { VerifiedAttachmentsService } from '../storage/verified-attachments.service.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { requireCurrentSession } from '../session/session-step-up.js';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';

const input = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .refine((name) => !/[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(name))
      .nullable(),
    avatarUploadKey: z.string().min(1).max(256).nullable().optional(),
    shareInActivity: z.boolean().optional(),
    revision: z.number().int().min(0).max(2147483646),
  })
  .strict();
type IdentityRow = {
  display_name: string | null;
  avatar_key: string | null;
  source_key: string | null;
  share_in_activity: boolean;
  revision: number;
};

@Injectable()
export class ConversationIdentityService {
  constructor(private readonly attachments: VerifiedAttachmentsService) {}

  private async row(client: Pick<PoolClient, 'query'>, userId: string): Promise<IdentityRow> {
    const result = await client.query(
      `SELECT i.display_name,i.avatar_key,i.revision,i.share_in_activity,s.metadata->>'sourceKey' AS source_key
       FROM conversation_identities i LEFT JOIN storage_records s ON s.storage_key=i.avatar_key
       AND s.status='immutable' AND s.metadata->>'purpose'='conversation_avatar'
       AND s.metadata->>'uploadedBy'=i.user_id WHERE i.user_id=$1`,
      [userId]
    );
    return (
      result.rows[0] ?? {
        display_name: null,
        avatar_key: null,
        source_key: null,
        revision: 0,
        share_in_activity: false,
      }
    );
  }

  private async dto(row: IdentityRow) {
    const urls =
      row.avatar_key && row.source_key
        ? await this.attachments.downloadUrls([row.avatar_key], 'conversation_avatar')
        : [];
    return {
      displayName: row.display_name,
      avatarUrl: urls[0] ?? null,
      avatarUploadKey: row.source_key,
      revision: row.revision,
      shareInActivity: row.share_in_activity,
    };
  }

  async read(req: AuthenticatedRequest) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const account = (
        await client.query(
          'SELECT disabled_at,activation_token FROM users WHERE user_id=$1 FOR SHARE',
          [req.session.userId]
        )
      ).rows[0];
      if (!account || account.disabled_at || account.activation_token)
        throw new UnauthorizedException();
      await requireCurrentSession(client, req.session);
      const row = await this.row(client, req.session.userId);
      await client.query('COMMIT');
      return this.dto(row);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async update(body: unknown, req: AuthenticatedRequest) {
    const parsed = input.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid conversation identity');
    const { displayName, avatarUploadKey, revision } = parsed.data;
    const client = await getDbPool().connect();
    let saved: IdentityRow;
    try {
      await client.query('BEGIN');
      const account = (
        await client.query(
          'SELECT disabled_at,activation_token FROM users WHERE user_id=$1 FOR UPDATE',
          [req.session.userId]
        )
      ).rows[0];
      if (!account || account.disabled_at || account.activation_token)
        throw new UnauthorizedException();
      await requireCurrentSession(client, req.session);
      const previous = await this.row(client, req.session.userId);
      const shareInActivity =
        displayName !== null && (parsed.data.shareInActivity ?? previous.share_in_activity);
      const same =
        previous.display_name === displayName &&
        previous.share_in_activity === shareInActivity &&
        (avatarUploadKey === undefined ||
          (avatarUploadKey === null
            ? previous.avatar_key === null
            : avatarUploadKey === previous.source_key));
      // Exact retry after a lost acknowledgement must not copy the photo or audit twice.
      if (previous.revision !== revision && !(previous.revision === revision + 1 && same))
        throw new ConflictException('Conversation identity changed; reload and retry');
      if (same) saved = previous;
      else {
        const avatarKey =
          avatarUploadKey === undefined
            ? previous.avatar_key
            : avatarUploadKey === null
              ? null
              : (
                  await this.attachments.seal(
                    client,
                    [avatarUploadKey],
                    req.session.userId,
                    null,
                    'conversation_avatar'
                  )
                )[0]!;
        await client.query(
          `INSERT INTO conversation_identities(user_id,display_name,avatar_key,revision,share_in_activity)
          VALUES ($1,$2,$3,$4,$5) ON CONFLICT(user_id) DO UPDATE SET display_name=EXCLUDED.display_name,
          avatar_key=EXCLUDED.avatar_key,revision=EXCLUDED.revision,share_in_activity=EXCLUDED.share_in_activity,updated_at=NOW()`,
          [req.session.userId, displayName, avatarKey, previous.revision + 1, shareInActivity]
        );
        await client.query(
          `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip,created_at)
          VALUES ($1,$2,'conversation_identity_changed',$3::jsonb,$4,$5,NOW())`,
          [
            uuidv7(),
            req.session.userId,
            JSON.stringify({
              before: {
                displayName: previous.display_name,
                hasPhoto: !!previous.avatar_key,
                shareInActivity: previous.share_in_activity,
              },
              after: { displayName, hasPhoto: !!avatarKey, shareInActivity },
              revision: previous.revision + 1,
            }),
            correlationIdStorage.getStore() ?? uuidv7(),
            req.ip ?? null,
          ]
        );
        saved = await this.row(client, req.session.userId);
      }
      await requireCurrentSession(client, req.session);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    return this.dto(saved);
  }
}
