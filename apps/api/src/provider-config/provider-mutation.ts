import { HttpException } from '@nestjs/common';
import { ErrorCodes } from '@barghsa/shared/errors';
import { v7 as uuidv7 } from 'uuid';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import type { PoolClient, ProviderPool } from './provider-config.di.js';
import type { ValidatedSession } from '../session/session.service.js';
import { requireSessionOtpStepUp } from '../session/session-step-up.js';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';
import { resolveProviderTestRecipient } from './provider-test-recipient.js';

export type ProviderMutationSession = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;
type ProviderChannel = 'email' | 'sms';
type ProviderResult = { id: string; status: string };

const DELIVERY_CONFIG_HASH =
  "encode(sha256(convert_to(jsonb_build_array(transport, config)::text, 'UTF8')), 'hex')";

function requireActor(actorUserId: string, session: ProviderMutationSession): void {
  if (!session || session.userId !== actorUserId) {
    throw new HttpException({ error: ErrorCodes.AUTH_UNAUTHENTICATED.code }, 401);
  }
}

async function providerTransaction<T>(client: PoolClient, work: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    const result = await work();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function requireProviderAuthority(client: PoolClient, session: ProviderMutationSession) {
  await requireStaffMutationPermission(client, session.userId, 'admin:notification-providers:edit');
  return requireSessionOtpStepUp(client, session);
}

async function auditProviderMutation(
  client: PoolClient,
  session: ProviderMutationSession,
  channel: ProviderChannel,
  event: string,
  result: ProviderResult,
  stepUpVerifiedAt: Date,
  sourceProviderId?: string
) {
  await client.query(
    `INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,created_at)
     VALUES($1,$2,$3,$4::jsonb,$5,NOW())`,
    [
      uuidv7(),
      session.userId,
      `${channel}_provider_${event}`,
      JSON.stringify({
        providerId: result.id,
        status: result.status,
        sessionId: session.sessionId,
        stepUpVerified: true,
        stepUpVerifiedAt: stepUpVerifiedAt.toISOString(),
        ...('lastTestStatus' in result ? { lastTestStatus: result.lastTestStatus } : {}),
        ...(sourceProviderId ? { sourceProviderId } : {}),
      }),
      correlationIdStorage.getStore() ?? uuidv7(),
    ]
  );
  await requireSessionOtpStepUp(client, session);
}

/** Serialize a provider family's mutations and retain authority through its audit commit. */
export async function mutateProvider<T extends ProviderResult>(
  pool: ProviderPool,
  actorUserId: string,
  session: ProviderMutationSession,
  channel: ProviderChannel,
  event: string,
  work: (client: PoolClient) => Promise<T>,
  sourceProviderId?: string
): Promise<T> {
  requireActor(actorUserId, session);
  const client = await pool.connect();
  try {
    return await providerTransaction(client, async () => {
      // A concurrent test may own this key without a transaction. Wait before locking staff rows.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `notification-provider:${channel}`,
      ]);
      const stepUpVerifiedAt = await requireProviderAuthority(client, session);
      const result = await work(client);
      await auditProviderMutation(
        client,
        session,
        channel,
        event,
        result,
        stepUpVerifiedAt,
        sourceProviderId
      );
      return result;
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error as { code?: string }).code === '23514' &&
      (error as { constraint?: string }).constraint === 'provider_delivery_proof_required'
    ) {
      throw new HttpException(
        {
          statusCode: 409,
          error: ErrorCodes.CONFLICT_STATE.code,
          message: 'Provider activation requires a new successful delivery test',
        },
        409
      );
    }
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

export type ProviderTestOutcome = { ok: boolean; error?: string; transient?: boolean };

export type ProviderTestPlan = {
  run: (authorize: () => Promise<void>) => Promise<ProviderTestOutcome>;
  recipient?: string;
  verify?: (client: PoolClient) => Promise<void>;
  releaseProbe?: (client: PoolClient) => Promise<void>;
};

async function readDraftHash(client: PoolClient, channel: ProviderChannel, id: string) {
  const result = await client.query(
    `SELECT ${DELIVERY_CONFIG_HASH} AS hash FROM ${channel}_provider_configs
     WHERE id=$1 AND status='draft' FOR UPDATE`,
    [id]
  );
  const hash = result.rows[0]?.hash;
  if (typeof hash !== 'string') throw changedProvider();
  return hash;
}

function changedProvider() {
  return new HttpException(
    { error: ErrorCodes.CONFLICT_STATE.code, message: 'Provider draft changed during the test' },
    409
  );
}

/** Use a direct pool for the session lock. No SQL transaction spans provider I/O. */
export async function testProvider<T extends ProviderResult, Plan extends ProviderTestPlan>(
  pool: ProviderPool,
  actorUserId: string,
  session: ProviderMutationSession,
  channel: ProviderChannel,
  id: string,
  prepare: (client: PoolClient) => Promise<Plan>,
  record: (client: PoolClient, plan: Plan, outcome: ProviderTestOutcome) => Promise<T>
): Promise<{ ok: boolean; error: string | null; result: T }> {
  requireActor(actorUserId, session);
  const client = await pool.connect();
  const lockKey = `notification-provider:${channel}`;
  let locked = false;
  let finished = false;
  let releaseProbe: ProviderTestPlan['releaseProbe'];
  let releaseError: Error | undefined;
  try {
    try {
      await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [lockKey]);
      locked = true;
    } catch (error) {
      releaseError = new Error('Provider test lock acquisition failed');
      throw error;
    }
    const { plan, hash } = await providerTransaction(client, async () => {
      await requireProviderAuthority(client, session);
      const plan = await prepare(client);
      const hash = await readDraftHash(client, channel, id);
      await requireSessionOtpStepUp(client, session);
      return { plan, hash };
    });
    releaseProbe = plan.releaseProbe;
    const check = async () => {
      const stepUpVerifiedAt = await requireProviderAuthority(client, session);
      if ((await readDraftHash(client, channel, id)) !== hash) throw changedProvider();
      if (plan.recipient) {
        await resolveProviderTestRecipient(client, session, channel, plan.recipient);
      }
      await plan.verify?.(client);
      // A provider or template row could have been locked while the session expired.
      await requireSessionOtpStepUp(client, session);
      return stepUpVerifiedAt;
    };
    let authorizationFailure: { error: unknown } | undefined;
    const authorize = async () => {
      try {
        await providerTransaction(client, async () => {
          await check();
        });
      } catch (error) {
        // Transport testers sanitize provider errors, including callbacks they invoke.
        authorizationFailure = { error };
        throw error;
      }
    };
    const outcome = await plan.run(authorize);
    if (authorizationFailure) throw authorizationFailure.error;
    const result = await providerTransaction(client, async () => {
      const stepUpVerifiedAt = await check();
      const result = await record(client, plan, outcome);
      await auditProviderMutation(client, session, channel, 'tested', result, stepUpVerifiedAt);
      return result;
    });
    finished = true;
    return { ok: outcome.ok, error: outcome.error ?? null, result };
  } finally {
    try {
      // A lost cleanup response leaves the existing bounded probe lease to expire.
      if (!finished) await releaseProbe?.(client).catch(() => {});
    } finally {
      if (locked) {
        try {
          await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lockKey]);
        } catch {
          releaseError = new Error('Provider test lock release failed');
        }
      }
      client.release(releaseError);
    }
  }
}
