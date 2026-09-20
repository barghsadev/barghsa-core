import { BadRequestException } from '@nestjs/common';
import type { Pool } from 'pg';
import { z } from 'zod';

export interface CrmRecordPage<T> {
  items: T[];
  nextCursor: string | null;
}
export interface CrmRecordScope {
  id: string;
  userId: string;
  profileType: string;
  username: string;
}
export interface CrmAgentRecord {
  id: string;
  kind: 'agent' | 'invitation';
  profileId: string;
  profileTitle: string;
  username: string | null;
  role: string;
  status: string;
  createdAt: string;
  expiresAt: string | null;
}
export interface CrmVerificationRecord {
  id: string;
  event: string;
  actor: string;
  previousStatus: string | null;
  newStatus: string | null;
  reason: string | null;
  createdAt: string;
}
const pageSize = 20;
const cursorSchema = z
  .object({
    profileId: z.string().uuid(),
    kind: z.enum(['agents', 'verification']),
    id: z.string().min(1).max(512),
    createdAt: z
      .string()
      .datetime()
      .refine(
        (value) =>
          Number.isFinite(Date.parse(value)) &&
          new Date(value).toISOString().slice(0, 19) === value.slice(0, 19)
      ),
  })
  .strict();
function cursorValues(profileId: string, kind: 'agents' | 'verification', cursor?: string) {
  if (!cursor) return [null, null];
  try {
    if (cursor.length > 2048) throw new Error();
    const value = cursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    if (value.profileId !== profileId || value.kind !== kind) throw new Error();
    return [value.createdAt, value.id];
  } catch {
    throw new BadRequestException('Invalid CRM record cursor');
  }
}
function page<T extends { id: string; createdAt: string }>(
  rows: T[],
  profileId: string,
  kind: 'agents' | 'verification'
): CrmRecordPage<T> {
  const items = rows.slice(0, pageSize);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > pageSize && last
        ? Buffer.from(
            JSON.stringify({ profileId, kind, id: last.id, createdAt: last.createdAt })
          ).toString('base64url')
        : null,
  };
}

export async function readAgentRecords(
  pool: Pool,
  scope: CrmRecordScope,
  cursor?: string
): Promise<CrmRecordPage<CrmAgentRecord>> {
  const [createdAt, id] = cursorValues(scope.id, 'agents', cursor);
  const result = await pool.query<CrmAgentRecord>(
    `WITH records AS (
       SELECT 'agent:'||a.id::text AS id, 'agent' AS kind, a.profile_id,
              COALESCE(p.title,l.legal_name,p.id::text) AS profile_title, u.username,
              a.role, CASE WHEN p.archived THEN 'Archived' ELSE 'Active' END AS status,
              a.joined_at AS created_at, NULL::timestamptz AS expires_at
       FROM profile_agents a JOIN profiles p ON p.id=a.profile_id
       LEFT JOIN legal_profiles l ON l.id=p.id LEFT JOIN users u ON u.user_id=a.user_id
       WHERE ($3='LEGAL' AND a.profile_id=$1::uuid) OR ($3='INDIVIDUAL' AND a.user_id=$2)
       UNION ALL
       SELECT 'invitation:'||i.id::text, 'invitation', i.profile_id,
              COALESCE(p.title,l.legal_name,p.id::text), i.username, i.role,
              CASE WHEN i.status='Pending' AND i.expires_at<=NOW() THEN 'Expired' ELSE i.status END,
              i.created_at, i.expires_at
       FROM profile_invitations i JOIN profiles p ON p.id=i.profile_id
       LEFT JOIN legal_profiles l ON l.id=p.id
       WHERE ($3='LEGAL' AND i.profile_id=$1::uuid) OR ($3='INDIVIDUAL' AND i.username=$4)
     )
     SELECT id,kind,profile_id AS "profileId",profile_title AS "profileTitle",username,role,status,
            to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
            to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "expiresAt"
     FROM records WHERE ($5::timestamptz IS NULL OR (created_at,id)<($5::timestamptz,$6::text))
     ORDER BY created_at DESC,id DESC LIMIT 21`,
    [scope.id, scope.userId, scope.profileType, scope.username, createdAt, id]
  );
  return page(result.rows, scope.id, 'agents');
}

export async function readVerificationRecords(
  pool: Pool,
  profileId: string,
  cursor?: string,
  includeCorrections = false
): Promise<CrmRecordPage<CrmVerificationRecord>> {
  const [createdAt, id] = cursorValues(profileId, 'verification', cursor);
  const result = await pool.query<CrmVerificationRecord>(
    `WITH records AS (
       SELECT a.id,a.event,a.user_id,a.created_at,
         CASE WHEN pg_input_is_valid(a.metadata,'jsonb') THEN a.metadata::jsonb ELSE '{}'::jsonb END AS data
       FROM audit_log a WHERE a.event IN ('verification_change','profile_onboarding_completed','verification_case_created','verification_case_reviewed')
     )
     SELECT r.id,r.event,COALESCE(u.username,r.user_id) AS actor,
       COALESCE(data->>'previousStatus',data->>'fromStatus') AS "previousStatus",
       COALESCE(data->>'newStatus',data->>'toStatus',data->>'decision',
         CASE WHEN r.event='verification_case_created' THEN 'Open' END) AS "newStatus",
       COALESCE(data->>'reason',data->>'reviewerNotes') AS reason,
       to_char(r.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt"
     FROM records r LEFT JOIN users u ON u.user_id=r.user_id
     WHERE lower(data->>'profileId')=$1
       AND ($4::boolean OR r.event IN ('verification_change','profile_onboarding_completed'))
       AND ($2::timestamptz IS NULL OR (r.created_at,r.id)<($2::timestamptz,$3::text))
     ORDER BY r.created_at DESC,r.id DESC LIMIT 21`,
    [profileId, createdAt, id, includeCorrections]
  );
  return page(result.rows, profileId, 'verification');
}
