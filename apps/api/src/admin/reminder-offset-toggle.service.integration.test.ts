/**
 * Real-PostgreSQL integration tests for ReminderOffsetToggleService
 * (T-04.1.04.05).
 *
 * Unit tests mock the pg client and cannot see that SELECT ... FOR UPDATE
 * is a no-op when the toggle row is absent. This suite runs the service
 * against Testcontainers PostgreSQL 17 and proves concurrent first writes
 * for the same (serviceType, offset) pair produce a truthful audit chain:
 * each event's previousEnabled matches the immediately preceding committed
 * value (default enabled=true when no row exists yet).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createMigratedTestDb } from '../../../../packages/db/src/test/migrated-db.js';
import { REMINDER_OFFSET_TOGGLE_EVENT } from '@barghsa/shared/finance';
import { ReminderOffsetToggleService } from './reminder-offset-toggle.service.js';

const poolHolder = vi.hoisted(() => ({ pool: null as import('pg').Pool | null }));

vi.mock('@barghsa/db', () => ({
  getDbPool: () => {
    if (!poolHolder.pool) {
      throw new Error('test pool not initialized — beforeAll must run first');
    }
    return poolHolder.pool;
  },
}));

const ACTOR_A = 'toggle-admin-a';
const ACTOR_B = 'toggle-admin-b';

interface AuditMeta {
  serviceType: string;
  offset: number;
  enabled: boolean;
  previousEnabled: boolean;
}

function parseMeta(raw: unknown): AuditMeta {
  if (typeof raw === 'string') {
    return JSON.parse(raw) as AuditMeta;
  }
  if (raw && typeof raw === 'object') {
    return raw as AuditMeta;
  }
  throw new Error(`unexpected audit metadata: ${String(raw)}`);
}

describe('ReminderOffsetToggleService — real PostgreSQL (T-04.1.04.05)', () => {
  let ctx: Awaited<ReturnType<typeof createMigratedTestDb>>;
  let service: ReminderOffsetToggleService;

  beforeAll(async () => {
    // Separate actor transactions can contend on the same per-pair lock.
    ctx = await createMigratedTestDb();
    poolHolder.pool = ctx.pool;
    service = new ReminderOffsetToggleService({
      getCorrelationId: () => 'corr-toggle-integration',
    } as never);

    await ctx.pool.query(
      `INSERT INTO users (user_id, username, password_hash, is_admin) VALUES ($1,$1,'test-only',true), ($2,$2,'test-only',true)`,
      [ACTOR_A, ACTOR_B]
    );
  }, 60_000);

  afterAll(async () => {
    poolHolder.pool = null;
    await ctx.close();
  });

  beforeEach(async () => {
    await ctx.pool.query('DELETE FROM invoice_reminder_offset_toggles');
    await ctx.pool.query('DELETE FROM audit_log');
  });

  it('records previousEnabled from the preceding committed value under concurrent first writes', async () => {
    const body = { serviceType: 'electricity', offset: -7, enabled: false };

    const results = await Promise.all([
      service.set({ raw: body, actorUserId: ACTOR_A, ip: '10.0.0.1' }),
      service.set({ raw: body, actorUserId: ACTOR_B, ip: '10.0.0.2' }),
    ]);

    for (const matrix of results) {
      expect(
        matrix.find((row) => row.serviceType === 'electricity' && row.offset === -7)?.enabled
      ).toBe(false);
    }

    const stored = await ctx.pool.query<{ enabled: boolean }>(
      `SELECT enabled FROM invoice_reminder_offset_toggles
        WHERE service_type = $1 AND "offset" = $2`,
      ['electricity', -7]
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]!.enabled).toBe(false);

    const audits = await ctx.pool.query<{ id: string; metadata: unknown }>(
      `SELECT id, metadata FROM audit_log
        WHERE event = $1
        ORDER BY created_at ASC, id ASC`,
      [REMINDER_OFFSET_TOGGLE_EVENT]
    );
    expect(audits.rows).toHaveLength(2);

    const chain = audits.rows.map((row) => parseMeta(row.metadata));
    expect(chain[0]).toMatchObject({
      serviceType: 'electricity',
      offset: -7,
      enabled: false,
      previousEnabled: true,
    });
    expect(chain[1]).toMatchObject({
      serviceType: 'electricity',
      offset: -7,
      enabled: false,
      previousEnabled: false,
    });

    let preceding = true;
    for (const event of chain) {
      expect(event.previousEnabled).toBe(preceding);
      preceding = event.enabled;
    }
  });
});
