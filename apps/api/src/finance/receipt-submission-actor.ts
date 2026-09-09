import { HttpException } from '@nestjs/common';
import { hasAnyRolePermission, type AgentRole } from '@barghsa/shared/agent-permissions';
import { ErrorCodes } from '@barghsa/shared/errors';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';
import { requireCurrentSession } from '../session/session-step-up.js';
import type { ValidatedSession } from '../session/session.service.js';

export type ReceiptSubmissionActor = Pick<
  ValidatedSession,
  'userId' | 'sessionId' | 'csrfToken'
> & {
  correlationId?: string;
};
type Client = {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
};

/** Hold the requesting account, session and current profile permission until commit. */
export async function lockReceiptSubmissionActor(
  client: Client,
  actor: ReceiptSubmissionActor,
  profileId: string
): Promise<void> {
  const account = (
    await client.query(
      'SELECT disabled_at,activation_token FROM users WHERE user_id=$1 FOR UPDATE',
      [actor.userId]
    )
  ).rows[0];
  if (!account || account.disabled_at || account.activation_token)
    throw new HttpException({ error: ErrorCodes.AUTH_UNAUTHENTICATED.code }, 401);
  await requireCurrentSession(client, actor);
  const profile = (
    await client.query('SELECT user_id,profile_type,archived FROM profiles WHERE id=$1 FOR SHARE', [
      profileId,
    ])
  ).rows[0];
  if (!profile) throw new HttpException({ error: ErrorCodes.NOT_FOUND_RESOURCE.code }, 404);
  if (profile.archived !== false)
    throw new HttpException(
      {
        error: ErrorCodes.CONFLICT_STATE.code,
        message: 'Archived profiles cannot submit bank receipts',
      },
      409
    );
  if (profile.user_id === actor.userId) return;
  const roles = (
    await client.query(
      "SELECT role FROM profile_agents WHERE profile_id=$1 AND user_id=$2 AND role IN ('Manager','Finance','Legal') FOR SHARE",
      [profileId, actor.userId]
    )
  ).rows;
  if (
    profile.profile_type !== 'LEGAL' ||
    !hasAnyRolePermission(
      roles.map((row) => row.role as AgentRole),
      'bank-receipts:submit'
    )
  )
    throw new HttpException({ error: ErrorCodes.NOT_FOUND_RESOURCE.code }, 404);
}

export async function auditReceiptSubmission(
  client: Client,
  actor: ReceiptSubmissionActor,
  profileId: string,
  receiptId: string,
  flow: 'wallet' | 'invoice'
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,created_at)
    VALUES(uuid_generate_v7(),$1,$2,$3::jsonb,COALESCE($4::uuid,uuid_generate_v7()),NOW())`,
    [
      actor.userId,
      flow === 'wallet' ? 'wallet_bank_receipt_submitted' : 'invoice_bank_receipt_submitted',
      JSON.stringify({ sessionId: actor.sessionId, profileId, receiptId }),
      actor.correlationId ?? correlationIdStorage.getStore() ?? null,
    ]
  );
}
