import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { expect } from 'vitest';

/** Expire a fixture staff session while its actual resource query is blocked. */
export async function readAfterStaffSessionExpires(
  pool: Pool,
  userId: string,
  read: (headers: { Cookie: string }) => Promise<Response>,
  hold: (client: PoolClient) => Promise<unknown>,
  queryText: string
): Promise<Response> {
  const session = randomUUID();
  const blocker = await pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,operating_context,expires_at,idle_deadline)
       VALUES($1,$2,$3,$4,'staff',clock_timestamp()+INTERVAL '1 hour',
              clock_timestamp()+INTERVAL '30 minutes')`,
      [session, userId, randomUUID(), randomUUID()]
    );
    await blocker.query('BEGIN');
    await hold(blocker);
    const { pid } = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
      .rows[0]!;
    const { expires_at: expiresAt } = (
      await pool.query<{ expires_at: Date }>(
        `UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '4 seconds'
           WHERE session_id=$1 RETURNING expires_at`,
        [session]
      )
    ).rows[0]!;
    pending = read({ Cookie: `barghsa_session=${session}` });
    await expect
      .poll(async () => {
        const waiting = await pool.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM pg_stat_activity
            WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))
              AND strpos(query,$2)>0`,
          [pid, queryText]
        );
        return waiting.rows[0]!.count;
      })
      .toBe(1);
    await expect
      .poll(
        async () =>
          (
            await pool.query<{ expired: boolean }>(
              'SELECT clock_timestamp()>=$1::timestamptz AS expired',
              [expiresAt]
            )
          ).rows[0]!.expired,
        { timeout: 6000 }
      )
      .toBe(true);
    await blocker.query('COMMIT');
    return await pending;
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    try {
      await pending;
    } finally {
      await pool.query('DELETE FROM sessions WHERE session_id=$1', [session]);
    }
  }
}
