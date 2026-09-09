/**
 * Real-PostgreSQL integration tests for finance chargeback alerts
 * (T-04.2.04.03 / S-04.2.04).
 *
 * Proves against actual PostgreSQL:
 *   1. An unmatched chargeback enqueues immediate in-app + email jobs
 *      for finance-role staff (and platform admins).
 *   2. The outbox payload carries the admin-dashboard deep-link.
 *   3. A duplicate alert reuses the idempotency key and still has jobs.
 *   4. The dashboard warning lists unmatched / reversal-failed rows and
 *      hides reversed events.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { startHttpFixture } from '../test/http-fixture';
import { WALLET_CHARGEBACK_REASON } from '@barghsa/shared/finance';
import { runOutboxPoll } from '../../../worker/dist/notifications/outbox-runner.js';
import { InAppNotificationTransport } from '../../../worker/dist/notifications/in-app-transport.js';
import { NotificationCenterService } from '../notifications/notification-center.service.js';
import {
  ChargebackAlertService,
  enqueueFinanceChargebackAlert,
} from './chargeback-alert.service.js';

const poolHolder = vi.hoisted(() => ({ pool: null as import('pg').Pool | null }));

vi.mock('@barghsa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@barghsa/db')>();
  return {
    ...actual,
    getDbPool: () => {
      if (!poolHolder.pool) {
        throw new Error('test pool not initialized — beforeAll must run first');
      }
      return poolHolder.pool;
    },
  };
});

const FINANCE_USER = 'staff-finance-1';
const ADMIN_USER = 'staff-admin-1';
const OTHER_USER = 'staff-ops-1';
const FINANCE_PROFILE = '11111111-1111-7111-8111-111111111111';
const ADMIN_PROFILE = '22222222-2222-7222-8222-222222222222';
const OTHER_PROFILE = '33333333-3333-7333-8333-333333333333';
const EVENT_ID = 'evt-cb-alert-int-1';

describe('ChargebackAlertService — real PostgreSQL (T-04.2.04.03)', () => {
  let ctx: Awaited<ReturnType<typeof startHttpFixture>>;
  const service = new ChargebackAlertService();

  beforeAll(async () => {
    ctx = await startHttpFixture(process.env.TEST_DATABASE_URL!, undefined, '', 2);
    poolHolder.pool = ctx.pool;

    await ctx.pool.query(
      `INSERT INTO users (user_id, username, password_hash, is_admin, is_staff) VALUES
       ($1, 'finance@example.test', 'test-only', false, true),
       ($2, 'admin@example.test', 'test-only', true, true),
       ($3, 'ops@example.test', 'test-only', false, true)`,
      [FINANCE_USER, ADMIN_USER, OTHER_USER]
    );
    await ctx.pool.query(
      `INSERT INTO profiles (id, user_id, is_default) VALUES ($1, $2, true), ($3, $4, true), ($5, $6, true)`,
      [FINANCE_PROFILE, FINANCE_USER, ADMIN_PROFILE, ADMIN_USER, OTHER_PROFILE, OTHER_USER]
    );
    await ctx.pool.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, 'role-finance')`, [
      FINANCE_USER,
    ]);
  }, 60_000);

  afterAll(async () => {
    poolHolder.pool = null;
    await ctx.close();
  });

  beforeEach(async () => {
    await ctx.pool.query('DELETE FROM in_app_notifications');
    await ctx.pool.query('DELETE FROM notification_job');
    await ctx.pool.query('DELETE FROM notification_outbox');
    await ctx.pool.query('DELETE FROM wallet_chargeback_events');
  });

  function notification() {
    return {
      type: 'chargeback' as const,
      merchantId: 'm-1',
      merchantOrderId: null,
      providerRefId: 'psp-1',
      authority: null,
      amountIrR: 75_000n,
      reason: WALLET_CHARGEBACK_REASON,
    };
  }

  it('enqueues urgent in-app + email jobs for finance staff and admins', async () => {
    const client = await ctx.pool.connect();
    try {
      const result = await service.notifyUnresolved(client, {
        eventId: EVENT_ID,
        status: 'unmatched',
        notification: notification(),
        walletId: null,
        originalTransactionId: null,
      });
      expect(result).toEqual({ recipients: 2, inserted: 2 });
    } finally {
      client.release();
    }

    const outbox = await ctx.pool.query(
      `SELECT profile_id, user_id, event_key, channels, status, payload, idempotency_key
         FROM notification_outbox
        ORDER BY profile_id`
    );
    expect(outbox.rows).toHaveLength(2);
    expect(outbox.rows.map((row) => row.user_id).sort()).toEqual([ADMIN_USER, FINANCE_USER].sort());
    expect(outbox.rows.every((row) => row.user_id !== OTHER_USER)).toBe(true);
    expect(outbox.rows[0]).toMatchObject({
      event_key: 'finance.chargeback_unresolved',
      status: 'queued',
    });
    expect(outbox.rows[0]?.channels).toEqual(['in_app', 'email']);
    expect(outbox.rows[0]?.payload).toMatchObject({
      event_id: EVENT_ID,
      status: 'unmatched',
      amount_irr: '75000',
      link_route: '/admin',
    });

    const jobs = await ctx.pool.query(
      `SELECT j.channel, j.status, j.priority
         FROM notification_job j
         JOIN notification_outbox o ON o.id = j.outbox_id
        WHERE o.user_id = $1
        ORDER BY j.channel`,
      [FINANCE_USER]
    );
    expect(jobs.rows).toEqual([
      { channel: 'email', status: 'queued', priority: 'urgent' },
      { channel: 'in_app', status: 'queued', priority: 'urgent' },
    ]);
  });

  it('reuses the outbox row and keeps jobs when the same event is alerted twice', async () => {
    const client = await ctx.pool.connect();
    try {
      const first = await enqueueFinanceChargebackAlert(client, {
        userId: FINANCE_USER,
        eventId: EVENT_ID,
        payload: { event_id: EVENT_ID, link_route: '/admin' },
      });
      expect(first.inserted).toBe(true);
      const retry = await enqueueFinanceChargebackAlert(client, {
        userId: FINANCE_USER,
        eventId: EVENT_ID,
        payload: { event_id: EVENT_ID, link_route: '/admin' },
      });
      expect(retry).toEqual({ outboxId: first.outboxId, inserted: false });
    } finally {
      client.release();
    }

    const outbox = await ctx.pool.query(`SELECT id FROM notification_outbox`);
    expect(outbox.rows).toHaveLength(1);
    const jobs = await ctx.pool.query(`SELECT channel FROM notification_job ORDER BY channel`);
    expect(jobs.rows.map((row) => row.channel)).toEqual(['email', 'in_app']);
  });

  it('preserves an older profile-scoped delivery when its provider event is retried', async () => {
    const legacy = await ctx.pool.query(
      `INSERT INTO notification_outbox(profile_id,user_id,event_key,payload,channels,status,idempotency_key)
       VALUES ($1,$2,'finance.chargeback_unresolved',$3,ARRAY['in_app','email'],'delivered',$4) RETURNING id`,
      [
        FINANCE_PROFILE,
        FINANCE_USER,
        { event_id: EVENT_ID },
        `finance.chargeback_unresolved:${EVENT_ID}:${FINANCE_PROFILE}`,
      ]
    );
    const outboxId = legacy.rows[0].id;
    await ctx.pool.query(
      "INSERT INTO notification_job(outbox_id,channel,status,attempts,provider_ref) VALUES ($1,'in_app','done',1,'previous-delivery')",
      [outboxId]
    );
    const client = await ctx.pool.connect();
    try {
      expect(
        await enqueueFinanceChargebackAlert(client, {
          userId: FINANCE_USER,
          eventId: EVENT_ID,
          payload: { event_id: EVENT_ID },
        })
      ).toEqual({ outboxId, inserted: false });
    } finally {
      client.release();
    }
    expect(
      (await ctx.pool.query('SELECT id,profile_id,status FROM notification_outbox')).rows
    ).toEqual([{ id: outboxId, profile_id: FINANCE_PROFILE, status: 'delivered' }]);
    expect(
      (
        await ctx.pool.query(
          "SELECT status,attempts,provider_ref FROM notification_job WHERE outbox_id=$1 AND channel='in_app'",
          [outboxId]
        )
      ).rows[0]
    ).toEqual({ status: 'done', attempts: 1, provider_ref: 'previous-delivery' });
  });

  it('surfaces unmatched and reversal-failed rows on the dashboard warning', async () => {
    await ctx.pool.query(
      `INSERT INTO wallet_chargeback_events (event_id, status, raw, created_at)
       VALUES
         ('evt-unmatched', 'unmatched', '{"amountIrR":"75000","reason":"provider chargeback"}', '2026-09-02T06:00:00Z'),
         ('evt-failed', 'unresolved', '{"amountIrR":"10000","reason":"provider chargeback"}', '2026-09-02T05:00:00Z'),
         ('evt-reversed', 'reversed', '{"amountIrR":"5000"}', '2026-09-02T04:00:00Z')`
    );

    const warning = await service.getDashboardWarning();
    expect(warning.count).toBe(2);
    expect(warning.unmatchedCount).toBe(1);
    expect(warning.reversalFailedCount).toBe(1);
    expect(warning.items.map((item) => item.eventId)).toEqual(['evt-unmatched', 'evt-failed']);
    expect(warning.items[0]).toMatchObject({
      status: 'unmatched',
      amountIrR: '75000',
      reason: 'provider chargeback',
    });
  });

  it('delivers private account alerts to profileless Finance staff by current permission', async () => {
    const users = ['cb-finance', 'cb-custom', 'cb-admin', 'cb-disabled', 'cb-inactive', 'cb-other'];
    await ctx.pool.query(`INSERT INTO staff_roles(role_id,name,permissions,description)
      VALUES ('cb-custom-role','Chargeback reviewer','["admin:finance:wallet:chargeback-alerts"]','Test finance role')`);
    for (const user of users) {
      await ctx.pool.query(
        `INSERT INTO users(user_id,username,password_hash,is_staff,is_admin,disabled_at,activation_token)
        VALUES ($1,$2,'test',true,$3,$4,$5)`,
        [
          user,
          `${user}@example.test`,
          user === 'cb-admin',
          user === 'cb-disabled' ? new Date() : null,
          user === 'cb-inactive' ? 'pending-activation' : null,
        ]
      );
      if (!['cb-admin', 'cb-other'].includes(user)) {
        await ctx.pool.query('INSERT INTO user_roles(user_id,role_id) VALUES ($1,$2)', [
          user,
          user === 'cb-custom' ? 'cb-custom-role' : 'role-finance',
        ]);
      }
    }
    const client = await ctx.pool.connect();
    try {
      const input = {
        eventId: EVENT_ID,
        status: 'unmatched' as const,
        notification: notification(),
        walletId: null,
        originalTransactionId: null,
      };
      expect(await service.notifyUnresolved(client, input)).toEqual({ recipients: 5, inserted: 5 });
      expect(await service.notifyUnresolved(client, input)).toEqual({ recipients: 5, inserted: 0 });
      const outbox = await ctx.pool.query('SELECT profile_id,user_id FROM notification_outbox');
      expect(outbox.rows.map((row) => row.user_id).sort()).toEqual(
        [FINANCE_USER, ADMIN_USER, 'cb-finance', 'cb-custom', 'cb-admin'].sort()
      );
      expect(outbox.rows.every((row) => row.profile_id === null)).toBe(true);

      // Run real leasing, availability, job persistence and in-app delivery. Email is intentionally unavailable.
      await runOutboxPoll({
        pool: ctx.pool,
        transports: { in_app: new InAppNotificationTransport(ctx.pool) },
      });
      const jobs = await ctx.pool.query(
        "SELECT status FROM notification_job WHERE channel='in_app'"
      );
      expect(jobs.rows).toHaveLength(5);
      expect(jobs.rows.every((row) => row.status === 'done')).toBe(true);
      const inbox = new NotificationCenterService(ctx.pool);
      const page = await inbox.list(null, {}, 'cb-finance');
      expect(page.data).toHaveLength(1);
      const rows = await ctx.pool.query(
        "SELECT recipient_user_id,profile_id,localized_content,link_route FROM in_app_notifications WHERE type='finance.chargeback_unresolved'"
      );
      expect(rows.rows).toHaveLength(5);
      expect(
        rows.rows.every(
          (row) =>
            row.profile_id === null &&
            row.localized_content.fa &&
            row.localized_content.en &&
            row.link_route === '/admin'
        )
      ).toBe(true);
      expect((await inbox.list(null, {}, 'cb-other')).data).toHaveLength(0);
      // A selected profile must not hide a staff account alert or reveal it to another account.
      expect((await inbox.list(OTHER_PROFILE, {}, 'cb-finance')).data).toHaveLength(1);
      expect((await inbox.list(FINANCE_PROFILE, {}, OTHER_USER)).data).toHaveLength(0);
    } finally {
      client.release();
      await ctx.pool.query('DELETE FROM users WHERE user_id=ANY($1::text[])', [users]);
      await ctx.pool.query("DELETE FROM staff_roles WHERE role_id='cb-custom-role'");
    }
  });
});
