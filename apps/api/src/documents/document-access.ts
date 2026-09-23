import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import { ErrorCodes } from '@barghsa/shared/errors';
import { getDbPool } from '@barghsa/db';
import type { AgentPermission } from '@barghsa/shared/agent-permissions';
import type { PoolClient } from 'pg';
import type { ValidatedSession } from '../session/session.service.js';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { requireCurrentSession, requireSessionStepUp } from '../session/session-step-up.js';
import { activeProfileSql } from '../profiles/profile-context.js';
import type { BusinessType } from './document-validation.js';

export type DocumentActor = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;
export function customerDocumentPermission(kind: BusinessType, write: boolean): AgentPermission {
  if (kind === 'contract') return write ? 'contracts:sign' : 'contracts:view';
  if (kind === 'invoice') return write ? 'bank-receipts:submit' : 'invoices:view';
  if (kind === 'order' || kind === 'solar_request') return write ? 'orders:create' : 'orders:view';
  return write ? 'documents:write' : 'documents:view';
}
export function staffDocumentPermission(kind: BusinessType, write: boolean) {
  const area =
    kind === 'contract'
      ? 'contracts'
      : kind === 'invoice'
        ? 'invoices'
        : kind === 'order' || kind === 'solar_request'
          ? 'orders'
          : 'legal';
  return `${area}:${write ? 'write' : 'read'}`;
}

async function requireStaffDocumentPermission(
  client: PoolClient,
  actor: DocumentActor,
  kind: BusinessType,
  write: boolean,
  businessRecordId?: string
) {
  try {
    await requireStaffMutationPermission(
      client,
      actor.userId,
      staffDocumentPermission(kind, write)
    );
  } catch (error) {
    if (
      kind !== 'order' ||
      !businessRecordId ||
      !(error instanceof HttpException) ||
      error.getStatus() !== 403
    )
      throw error;
    const saving = await client.query('SELECT 1 FROM saving_orders WHERE order_id=$1', [
      businessRecordId,
    ]);
    if (!saving.rowCount) throw error;
    await requireStaffMutationPermission(
      client,
      actor.userId,
      write ? 'contracts:write' : 'contracts:read'
    );
  }
}

/** Staff queues span profiles, but remain limited to the actor's current business capability. */
export async function staffDocumentRead<T>(
  actor: DocumentActor,
  kind: BusinessType,
  work: (client: PoolClient) => Promise<T>,
  businessRecordId?: string
) {
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    await requireStaffDocumentPermission(client, actor, kind, false, businessRecordId);
    await requireCurrentSession(client, actor);
    const result = await work(client);
    await requireCurrentSession(client, actor);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Match the profile/account/membership lock order used by other customer financial workflows. */
export async function documentAccess<T>(
  actor: DocumentActor,
  kind: BusinessType,
  write: boolean,
  staff: boolean,
  requestedProfile: string | undefined,
  work: (client: PoolClient, profileId: string) => Promise<T>,
  businessRecordId?: string
) {
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    const permission = customerDocumentPermission(kind, write);
    const selected = staff
      ? requestedProfile
      : (await client.query<{ id: string }>(activeProfileSql(permission), [actor.userId])).rows[0]
          ?.id;
    if (!selected || (requestedProfile && requestedProfile !== selected))
      throw new NotFoundException();
    const profile = (
      await client.query<{ archived: boolean }>(
        'SELECT archived FROM profiles WHERE id=$1 FOR SHARE',
        [selected]
      )
    ).rows[0];
    if (!profile || (profile.archived && (!staff || write))) throw new NotFoundException();
    if (staff) {
      await requireStaffDocumentPermission(client, actor, kind, write, businessRecordId);
    } else {
      const account = (
        await client.query(
          'SELECT disabled_at,activation_token FROM users WHERE user_id=$1 FOR UPDATE',
          [actor.userId]
        )
      ).rows[0];
      if (!account || account.disabled_at || account.activation_token)
        throw new HttpException({ error: ErrorCodes.AUTH_UNAUTHENTICATED.code }, 401);
      await client.query(
        'SELECT role FROM profile_agents WHERE profile_id=$1 AND user_id=$2 FOR SHARE',
        [selected, actor.userId]
      );
    }
    const sessionCheck = write ? requireSessionStepUp : requireCurrentSession;
    const check = async () => {
      await sessionCheck(client, actor);
      if (
        !staff &&
        (await client.query<{ id: string }>(activeProfileSql(permission), [actor.userId])).rows[0]
          ?.id !== selected
      )
        throw new NotFoundException();
    };
    await check();
    const result = await work(client, selected);
    await check();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    const databaseError = error instanceof Error && error.cause ? error.cause : error;
    if (
      databaseError &&
      typeof databaseError === 'object' &&
      'code' in databaseError &&
      ['23514', '23505', '40P01'].includes(String(databaseError.code))
    )
      throw new ConflictException('Document changed or the action is no longer permitted');
    throw error;
  } finally {
    client.release();
  }
}
