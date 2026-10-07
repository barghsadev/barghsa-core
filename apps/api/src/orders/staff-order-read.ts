import { HttpException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import type { PoolClient } from 'pg';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { requireCurrentSession } from '../session/session-step-up.js';
import type { ValidatedSession } from '../session/session.service.js';

type Actor = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;
/** Hold current read grants and session until the complete private order read finishes. */
export async function staffOrderRead<T>(
  actor: Actor,
  work: (client: PoolClient) => Promise<T>,
  options: { repeatableRead?: boolean } = {}
) {
  for (let attempt = 0; ; attempt++) {
    const client = await getDbPool().connect();
    try {
      await client.query(
        options.repeatableRead ? 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ' : 'BEGIN'
      );
      try {
        await requireStaffMutationPermission(client, actor.userId, 'contracts:read');
      } catch (error) {
        if (!(error instanceof HttpException) || error.getStatus() !== 403) throw error;
        // Preserve the existing contracts:write grant for order review reads.
        await requireStaffMutationPermission(client, actor.userId, 'contracts:write');
      }
      await requireCurrentSession(client, actor);
      const result = await work(client);
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      // Only a pure repeatable-read callback may be retried, once and after releasing its client.
      if (
        !options.repeatableRead ||
        attempt !== 0 ||
        (error as { code?: string } | null)?.code !== '40001'
      )
        throw error;
    } finally {
      client.release();
    }
  }
}
