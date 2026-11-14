import { ForbiddenException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import type { PoolClient } from 'pg';
import type { ValidatedSession } from '../session/session.service.js';
import { requireCurrentSession } from '../session/session-step-up.js';
import {
  requireStaffMutationPermission,
  type RequiredStaffPermissions,
} from './staff-mutation-permission.js';

export type StaffReadActor = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;

/** Keep the account, grant and session current through a database-only staff read. */
export async function withStaffReadAuthority<T>(
  actor: StaffReadActor,
  permissions: RequiredStaffPermissions,
  read: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    await requireStaffMutationPermission(client, actor.userId, permissions);
    await requireCurrentSession(client, actor);
    const context = await client.query(
      "SELECT current_setting('barghsa.actor_context', true) AS context"
    );
    if (context.rows[0]?.context !== 'staff') throw new ForbiddenException();
    const result = await read(client);
    await requireCurrentSession(client, actor);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Recheck a guarded read after database or storage work outside the authority transaction. */
export async function recheckStaffAuthorityAfter<T>(
  actor: StaffReadActor,
  permissions: RequiredStaffPermissions,
  read: () => Promise<T>
): Promise<T> {
  try {
    return await read();
  } finally {
    await withStaffReadAuthority(actor, permissions, async () => {});
  }
}
