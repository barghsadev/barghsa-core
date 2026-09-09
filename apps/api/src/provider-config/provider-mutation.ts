import { HttpException } from '@nestjs/common';
import { ErrorCodes } from '@barghsa/shared/errors';
import { v7 as uuidv7 } from 'uuid';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import type { PoolClient, ProviderPool } from './provider-config.di.js';
import type { ValidatedSession } from '../session/session.service.js';
import { requireSessionStepUp } from '../session/session-step-up.js';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';

export type ProviderMutationSession = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;

/** Serialize a provider family's mutations and retain authority through its audit commit. */
export async function mutateProvider<T extends { id: string; status: string }>(
  pool: ProviderPool,
  actorUserId: string,
  session: ProviderMutationSession,
  channel: 'email' | 'sms',
  event: string,
  work: (client: PoolClient) => Promise<T>
): Promise<T> {
  if (!session || session.userId !== actorUserId) {
    throw new HttpException({ error: ErrorCodes.AUTH_UNAUTHENTICATED.code }, 401);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await requireStaffMutationPermission(client, actorUserId, 'admin:notification-providers:edit');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `notification-provider:${channel}`,
    ]);
    const stepUpVerifiedAt = await requireSessionStepUp(client, session);
    const result = await work(client);
    await client.query(
      `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,created_at)
       VALUES($1,$2,$3,$4::jsonb,$5,NOW())`,
      [
        uuidv7(),
        actorUserId,
        `${channel}_provider_${event}`,
        JSON.stringify({
          providerId: result.id,
          status: result.status,
          sessionId: session.sessionId,
          stepUpVerified: true,
          stepUpVerifiedAt: stepUpVerifiedAt.toISOString(),
          ...('lastTestStatus' in result ? { lastTestStatus: result.lastTestStatus } : {}),
        }),
        correlationIdStorage.getStore() ?? uuidv7(),
      ]
    );
    await requireSessionStepUp(client, session);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (
      error instanceof Error &&
      (error as { code?: string; constraint?: string }).code === '23505' &&
      (error as { constraint?: string }).constraint === `uq_${channel}_provider_active`
    ) {
      throw new HttpException(
        {
          statusCode: 409,
          error: ErrorCodes.CONFLICT_DUPLICATE.code,
          message: `An active ${channel} provider configuration already exists; supersede it first`,
        },
        409
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Commit a server-produced outcome and its provider audit together. */
export async function testProvider<T extends { id: string; status: string }>(
  pool: ProviderPool,
  actorUserId: string,
  session: ProviderMutationSession,
  channel: 'email' | 'sms',
  work: (client: PoolClient) => Promise<{ ok: boolean; error: string | null; result: T }>
): Promise<{ ok: boolean; error: string | null; result: T }> {
  const committed = await mutateProvider(
    pool,
    actorUserId,
    session,
    channel,
    'tested',
    async (client) => {
      const outcome = await work(client);
      return { ...outcome.result, outcome };
    }
  );
  return committed.outcome;
}
