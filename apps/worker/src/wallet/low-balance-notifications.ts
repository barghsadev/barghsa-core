import { getDbPool } from '@barghsa/db';
import { UNPAID_CUSTOMER_INVOICE_PREDICATE } from '@barghsa/shared/finance';
import { defaultInboxContent } from '@barghsa/shared/notifications';
import type { Pool, PoolClient } from 'pg';
import { enqueueOutbox } from '../notifications/outbox-writer.js';

/** Evaluate committed signals after financial writers release their profile lock. */
export async function evaluateWalletLowBalanceSignals(pool: Pool = getDbPool(), limit = 50) {
  const candidates = await pool.query<{ profile_id: string }>(
    `SELECT profile_id FROM wallet_alert_signals GROUP BY profile_id
     ORDER BY min(created_at),profile_id LIMIT $1`,
    [Math.max(1, Math.min(100, Math.trunc(limit) || 50))]
  );
  const result = {
    evaluated: 0,
    notified: 0,
    busy: 0,
    errors: [] as Array<{ profileId: string; error: string }>,
  };
  for (const { profile_id: profileId } of candidates.rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const profile = (
        await client.query<{ user_id: string; archived: boolean }>(
          'SELECT user_id,archived FROM profiles WHERE id=$1 FOR UPDATE NOWAIT',
          [profileId]
        )
      ).rows[0];
      if (!profile) {
        await client.query('ROLLBACK');
        continue;
      }
      // Another evaluator may have drained this candidate before we took its lock.
      const pending = await client.query(
        'SELECT 1 FROM wallet_alert_signals WHERE profile_id=$1 LIMIT 1',
        [profileId]
      );
      if (!pending.rows.length) {
        await client.query('ROLLBACK');
        continue;
      }
      // Avoid waiting on an account operation that might itself need the profile.
      const recipient = await client.query(
        'SELECT user_id FROM users WHERE user_id=$1 FOR KEY SHARE NOWAIT',
        [profile.user_id]
      );
      if (recipient.rows.length !== 1)
        throw new Error('Low balance profile recipient is unavailable');
      const previous = (
        await client.query<{
          active: boolean;
          episode_id: string;
          recipient_user_id: string | null;
        }>(
          'SELECT active,episode_id,recipient_user_id FROM wallet_low_balance_states WHERE profile_id=$1',
          [profileId]
        )
      ).rows[0];
      const amounts = (
        await client.query<{ balance: string; unpaid: string; as_of: Date }>(
          `SELECT COALESCE((SELECT (posted_balance-reserved_balance)::text FROM wallets WHERE profile_id=$1),'0') AS balance,
          COALESCE((SELECT SUM(GREATEST(total_amount-paid_amount,0)) FROM invoices
            WHERE profile_id=$1 AND ${UNPAID_CUSTOMER_INVOICE_PREDICATE}),0)::text AS unpaid,
          clock_timestamp() AS as_of`,
          [profileId]
        )
      ).rows[0]!;
      const low = !profile.archived && BigInt(amounts.balance) < BigInt(amounts.unpaid);
      const newEpisode =
        low && (!previous?.active || previous.recipient_user_id !== profile.user_id);
      const episodeId =
        newEpisode || !previous
          ? (await client.query<{ id: string }>('SELECT uuid_generate_v7() AS id')).rows[0]!.id
          : previous.episode_id;
      if (newEpisode)
        await writeLowBalanceNotice(client, profileId, profile.user_id, episodeId, amounts);
      const saved = await client.query(
        `INSERT INTO wallet_low_balance_states(profile_id,active,episode_id,recipient_user_id)
         VALUES($1,$2,$3,$4) ON CONFLICT(profile_id) DO UPDATE SET
           active=EXCLUDED.active,episode_id=EXCLUDED.episode_id,recipient_user_id=EXCLUDED.recipient_user_id`,
        [profileId, low, episodeId, profile.user_id]
      );
      if (saved.rowCount !== 1) throw new Error('Low balance episode state was not stored');
      const acknowledged = await client.query(
        'DELETE FROM wallet_alert_signals WHERE profile_id=$1',
        [profileId]
      );
      if (!acknowledged.rowCount) throw new Error('Low balance signals were not acknowledged');
      await client.query('COMMIT');
      result.evaluated++;
      if (newEpisode) result.notified++;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if ((error as { code?: string }).code === '55P03') result.busy++;
      else
        result.errors.push({
          profileId,
          error: error instanceof Error ? error.message : String(error),
        });
    } finally {
      client.release();
    }
  }
  return result;
}

async function writeLowBalanceNotice(
  client: PoolClient,
  profileId: string,
  userId: string,
  episodeId: string,
  amounts: { balance: string; unpaid: string; as_of: Date }
) {
  const payload = {
    balance: amounts.balance,
    threshold: amounts.unpaid,
    episodeId,
    asOf: amounts.as_of.toISOString(),
    link_route: '/wallet',
  };
  const queued = await enqueueOutbox(client, {
    profileId,
    userId,
    eventKey: 'wallet.low_balance',
    channels: ['in_app', 'email'],
    payload,
    idempotencyKey: `wallet.low_balance:${episodeId}:${userId}`,
  });
  if (!queued.inserted || !queued.outboxId) throw new Error('Low balance outbox was not stored');
  const jobs = (
    await client.query(
      'SELECT channel,status,priority,attempts FROM notification_job WHERE outbox_id=$1 ORDER BY channel',
      [queued.outboxId]
    )
  ).rows;
  if (
    jobs.length !== 2 ||
    jobs[0]?.channel !== 'email' ||
    jobs[1]?.channel !== 'in_app' ||
    jobs.some((job) => job.status !== 'queued' || job.priority !== 'urgent' || job.attempts !== 0)
  )
    throw new Error('Low balance delivery jobs were not stored');
  const inbox = await client.query<{ id: string }>(
    `INSERT INTO in_app_notifications(profile_id,recipient_user_id,operating_context,type,title_i18n_key,body_i18n_key,params,localized_content,link_route,delivery_key)
     VALUES($1,$2,'customer','wallet.low_balance','notifications.legacy.title','notifications.legacy.body',$3,$4,'/wallet',$5) RETURNING id`,
    [
      profileId,
      userId,
      payload,
      defaultInboxContent('wallet.low_balance', { amount: amounts.balance }),
      `outbox:${queued.outboxId}`,
    ]
  );
  if (inbox.rows.length !== 1) throw new Error('Low balance inbox was not stored');
  const inboxId = inbox.rows[0]!.id;
  const done = await client.query(
    `UPDATE notification_job SET status='done',attempts=1,provider_ref=$2,delivery_payload=$3
     WHERE outbox_id=$1 AND channel='in_app' AND status='queued' AND attempts=0`,
    [queued.outboxId, inboxId, payload]
  );
  if (done.rowCount !== 1) throw new Error('Low balance inbox receipt was not stored');
  const history = await client.query(
    `INSERT INTO notification_delivery_log(notification_id,channel,status,attempt_number,provider_ref)
     VALUES($1,'in_app','delivered',1,$2)`,
    [queued.outboxId, inboxId]
  );
  if (history.rowCount !== 1) throw new Error('Low balance inbox history was not stored');
}
