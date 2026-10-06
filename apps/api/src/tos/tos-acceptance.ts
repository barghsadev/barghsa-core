import { HttpException } from '@nestjs/common';
import { ErrorCodes } from '@barghsa/shared/errors';
import type { PoolClient } from 'pg';

/** One policy for the status endpoint and transactional commercial boundaries. */
export function tosAcceptanceRequiredSql(): string {
  return `WITH active AS (
    SELECT id,published_at FROM tos_versions
    WHERE is_active=true AND status='published' AND published_at IS NOT NULL
    ORDER BY published_at DESC LIMIT 1
  ), material AS (
    SELECT v.id,v.published_at FROM tos_versions v, active a
    WHERE v.status='published' AND COALESCE(v.change_type,'major')='major'
      AND v.published_at <= a.published_at
    ORDER BY v.published_at DESC,(v.id=a.id) DESC,v.id DESC LIMIT 1
  )
  SELECT (accepted.id IS NULL OR
    (accepted.id<>active.id AND accepted.id<>material.id
      AND material.published_at IS NOT NULL AND accepted.published_at <= material.published_at)
  ) AS required
  FROM users u CROSS JOIN active LEFT JOIN material ON true
  LEFT JOIN tos_versions accepted ON accepted.id::text=u.last_accepted_tos_version
    AND accepted.status='published' AND accepted.published_at IS NOT NULL
  WHERE u.user_id=$1`;
}

/**
 * Caller holds the account lock. Admit against one current policy snapshot;
 * later publication applies to the next action. Do not hold a global version
 * lock across pricing/assignment and their participant-account locks.
 */
export async function requireCommercialTosAcceptance(client: PoolClient, userId: string) {
  const result = await client.query<{ required: boolean }>(tosAcceptanceRequiredSql(), [userId]);
  if (result.rows[0]?.required) {
    throw new HttpException({ error: ErrorCodes.AUTHZ_TOS_ACCEPTANCE_REQUIRED.code }, 403);
  }
}
