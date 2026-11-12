import { getDbPool } from '@barghsa/db';
import { ErrorCodes } from '@barghsa/shared/errors';
import { HttpException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { ValidatedSession } from '../session/session.service.js';
import { requireCurrentSession } from '../session/session-step-up.js';

export async function readAccountSettings<T>(
  actor: Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>,
  read: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT disabled_at FROM users WHERE user_id=$1 FOR SHARE',
      [actor.userId]
    );
    if (rows[0]?.disabled_at)
      throw new HttpException({ error: ErrorCodes.AUTH_UNAUTHENTICATED.code }, 401);
    await requireCurrentSession(client, actor);
    const result = await read(client);
    await requireCurrentSession(client, actor);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
