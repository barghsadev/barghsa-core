import { HttpException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { ErrorCodes } from '@barghsa/shared/errors';
import { TEAM_ACTIVITY_EVENTS, type TeamActivityPage } from '@barghsa/shared/team-activity';
import { z } from 'zod';

const invalid = () => new HttpException({ error: ErrorCodes.VALIDATION_INPUT_INVALID.code }, 400);
const forbidden = () => new HttpException({ error: ErrorCodes.AUTHZ_FORBIDDEN.code }, 403);
const cursorSchema = z
  .object({
    profileId: z.uuid(),
    userId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    createdAt: z.iso.datetime({ precision: 6 }),
  })
  .strict();
const uuidPattern = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
const resourceId = (key: string) =>
  `CASE WHEN details->>'${key}' ~ '${uuidPattern}' THEN (details->>'${key}')::uuid END`;

// Explicit profileId takes precedence. Legacy business events without it are resolved through
// their existing resource, with event guards preventing cross-domain requestId collisions.
const history = `WITH candidates AS MATERIALIZED (
  SELECT id,user_id,event,created_at,
    CASE WHEN metadata IS JSON OBJECT THEN metadata::jsonb ELSE '{}'::jsonb END AS details
  FROM audit_log WHERE event=ANY($3::text[]) AND (
    user_id=$2 OR (CASE WHEN metadata IS JSON OBJECT THEN metadata::jsonb ELSE '{}'::jsonb END)->>'profileId'=$1
  )
), scoped AS (
  SELECT a.id,a.user_id,a.event,a.created_at FROM candidates a
  LEFT JOIN orders o ON a.event='order_created' AND o.id=${resourceId('orderId')}
  LEFT JOIN electricity_orders e ON a.event LIKE 'electricity.%' AND e.id=COALESCE(${resourceId('electricityOrderId')},${resourceId('orderId')})
  LEFT JOIN saving_orders s ON a.event LIKE 'saving.%' AND s.id=${resourceId('savingOrderId')}
  LEFT JOIN solar_construction_requests solar ON a.event LIKE 'solar.%' AND solar.id=${resourceId('requestId')}
  LEFT JOIN consultation_requests consultation ON a.event LIKE 'consultation.%' AND consultation.id=${resourceId('requestId')}
  LEFT JOIN contracts contract ON a.event LIKE 'contract.%' AND contract.id=${resourceId('contractId')}
  WHERE COALESCE(details->>'profileId',o.profile_id::text,e.profile_id::text,s.profile_id::text,solar.profile_id::text,consultation.profile_id::text,contract.profile_id::text)=$1
  AND COALESCE(details->>'visibility','public')='public'
  AND (a.user_id=$2 OR (
    a.event=ANY($4::text[]) AND (details->>'targetUserId'=$2 OR details->>'fromUserId'=$2 OR details->>'toUserId'=$2)
  ))
)`;

/** A locked permission check and scoped, sanitized read in the same transaction. */
export async function listAgentActivity(
  profileId: string,
  userId: string,
  actorUserId: string,
  cursor?: string
): Promise<TeamActivityPage> {
  if (!z.uuid().safeParse(profileId).success || !/^[a-zA-Z0-9_-]{1,100}$/.test(userId))
    throw invalid();
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    const profile = (
      await client.query(
        "SELECT user_id FROM profiles WHERE id=$1 AND profile_type='LEGAL' AND NOT archived FOR SHARE",
        [profileId]
      )
    ).rows[0];
    if (!profile) throw forbidden();
    if (profile.user_id !== actorUserId) {
      const manager = await client.query(
        "SELECT id FROM profile_agents WHERE profile_id=$1 AND user_id=$2 AND role='Manager' FOR SHARE",
        [profileId, actorUserId]
      );
      if (!manager.rows.length) throw forbidden();
    }
    if (profile.user_id !== userId) {
      const member = await client.query(
        'SELECT id FROM profile_agents WHERE profile_id=$1 AND user_id=$2 FOR SHARE',
        [profileId, userId]
      );
      if (!member.rows.length)
        throw new HttpException({ error: ErrorCodes.NOT_FOUND_RESOURCE.code }, 404);
    }
    let anchor: z.infer<typeof cursorSchema> | null = null;
    if (cursor !== undefined) {
      if (!/^[A-Za-z0-9_-]{1,2048}$/.test(cursor)) throw invalid();
      try {
        const decoded = Buffer.from(cursor, 'base64url');
        if (decoded.toString('base64url') !== cursor) throw invalid();
        anchor = cursorSchema.parse(JSON.parse(decoded.toString('utf8')));
      } catch {
        throw invalid();
      }
      if (anchor.profileId !== profileId || anchor.userId !== userId) throw invalid();
    }
    const parameters = [
      profileId,
      userId,
      Object.keys(TEAM_ACTIVITY_EVENTS),
      [
        'agent_roles_changed',
        'agent_removed',
        'ownership_transfer_initiated',
        'ownership_transfer_accepted',
        'ownership_transfer_declined',
        'ownership_transfer_cancelled',
        'ownership_transfer_expired',
      ],
    ];
    if (anchor) {
      const found = await client.query(
        `${history} SELECT id FROM scoped WHERE id=$5 AND created_at=$6::timestamptz`,
        [...parameters, anchor.id, anchor.createdAt]
      );
      if (!found.rows.length) throw invalid();
    }
    const result = await client.query(
      `${history}
      SELECT id,event,user_id,created_at,
        to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
      FROM scoped WHERE ($5::text IS NULL OR (created_at,id)<($6::timestamptz,$5::text))
      ORDER BY created_at DESC,id DESC LIMIT 51`,
      [...parameters, anchor?.id ?? null, anchor?.createdAt ?? null]
    );
    const rows = result.rows.slice(0, 50),
      last = rows.at(-1);
    await client.query('COMMIT');
    return {
      profileId,
      userId,
      items: rows.map((row) => ({
        id: row.id,
        kind: TEAM_ACTIVITY_EVENTS[row.event as keyof typeof TEAM_ACTIVITY_EVENTS],
        createdAt: new Date(row.created_at).toISOString(),
        performed: row.user_id === userId,
      })),
      nextCursor:
        result.rows.length > 50 && last
          ? Buffer.from(
              JSON.stringify({
                profileId,
                userId,
                id: last.id,
                createdAt: last.cursor_time,
              })
            ).toString('base64url')
          : null,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
