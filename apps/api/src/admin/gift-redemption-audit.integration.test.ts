import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { createMigratedTestDb } from '../../../../packages/db/src/test/migrated-db';
import { GiftCodeService } from './gift-code.service.js';
import { BadRequestException } from '@nestjs/common';

const holder = vi.hoisted(() => ({ pool: null as import('pg').Pool | null }));
vi.mock('@barghsa/db', () => ({ getDbPool: () => holder.pool }));
let db: Awaited<ReturnType<typeof createMigratedTestDb>>,
  service: GiftCodeService,
  profileId: string,
  productId: string;
const actor = 'gift-audit-owner',
  releaseActor = 'gift-audit-reviewer';
beforeAll(async () => {
  db = await createMigratedTestDb();
  holder.pool = db.pool;
  for (const user of [actor, releaseActor])
    await db.pool.query(
      "INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'test-only')",
      [user]
    );
  profileId = (
    await db.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status) VALUES($1,'LEGAL','ACTIVE') RETURNING id",
      [actor]
    )
  ).rows[0].id;
  productId = (
    await db.pool.query(
      "INSERT INTO products(type,system_key,title,price,status) VALUES('electricity','thermal','{\"en\":\"Gift audit electricity\"}',2000,'active') ON CONFLICT(system_key) DO UPDATE SET price=EXCLUDED.price,status='active' RETURNING id"
    )
  ).rows[0].id;
  service = new GiftCodeService({ getCorrelationId: () => randomUUID() } as never, {} as never);
}, 30000);
afterAll(async () => {
  await db?.close();
  holder.pool = null;
});
async function seed() {
  const code = 'AUDIT-' + randomUUID().slice(0, 8).toUpperCase();
  await db.pool.query(
    "INSERT INTO gift_codes(code,discount_type,discount_value,valid_from,created_by) VALUES($1,'fixed_irr',1000,'2026-01-01',$2)",
    [code, actor]
  );
  const orderId = (
    await db.pool.query(
      `INSERT INTO orders(user_id,profile_id,product_id,order_type,snapshot_province_id,snapshot_city_id,snapshot_full_address,snapshot_postal_code) VALUES($1,$2,$3,'electricity','province','city','Street','1234567890') RETURNING id`,
      [actor, profileId, productId]
    )
  ).rows[0].id as string;
  return {
    giftCode: code,
    profileId,
    orderId,
    orderAmount: '2000',
    category: 'electricity',
    actorUserId: actor,
    ip: '127.0.0.1',
  };
}
const auditRows = async () => (await db.pool.query('SELECT * FROM audit_log ORDER BY id')).rows;
async function check(id: string, action: string, from: string | null, to: string, user: string) {
  const rows = (
    await db.pool.query(
      `SELECT * FROM audit_log WHERE event='change_recorded' AND metadata::jsonb->>'entityId'=$1 AND metadata::jsonb->>'action'=$2`,
      [id, action]
    )
  ).rows;
  expect(rows).toHaveLength(1);
  const row = rows[0]!;
  expect(row.user_id).toBe(user);
  expect(row.created_at).toBeInstanceOf(Date);
  expect(row.correlation_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(JSON.parse(row.metadata)).toMatchObject({
    entity: 'gift_code_redemption',
    entityId: id,
    fromState: from,
    toState: to,
    action,
  });
  return JSON.parse(row.metadata) as Record<string, unknown>;
}
async function failAudit(action: string) {
  await db.pool
    .query(`CREATE FUNCTION reject_gift_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='change_recorded' AND NEW.metadata::jsonb->>'entity'='gift_code_redemption' AND NEW.metadata::jsonb->>'action'='${action}' THEN RAISE EXCEPTION 'injected gift audit failure'; END IF; RETURN NEW; END $$;
 CREATE TRIGGER reject_gift_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_gift_audit()`);
}
async function removeFailure() {
  await db.pool.query(
    'DROP TRIGGER reject_gift_audit ON audit_log; DROP FUNCTION reject_gift_audit()'
  );
}
it('persists exact redemption and release identities once with their actual actors', async () => {
  const input = await seed();
  const result = await service.redeem(input);
  expect(result.discountAmount).toBe('1000');
  expect(result.status).toBe('consumed');
  expect(await check(result.id, 'redeemed', null, 'consumed', actor)).toMatchObject({
    reason: null,
    orderId: input.orderId,
    profileId,
    giftCodeId: result.giftCodeId,
    discountAmount: '1000',
  });
  expect(
    await service.releaseByOrder(input.orderId, undefined, {
      actorUserId: releaseActor,
      ip: '127.0.0.1',
    })
  ).toEqual({ released: 1 });
  expect(await check(result.id, 'released', 'consumed', 'released', releaseActor)).toMatchObject({
    reason: 'unpaid_cancellation',
    orderId: input.orderId,
    profileId,
    giftCodeId: result.giftCodeId,
  });
  const before = await auditRows();
  expect(
    await service.releaseByOrder(input.orderId, undefined, {
      actorUserId: releaseActor,
      ip: '127.0.0.1',
    })
  ).toEqual({ released: 0 });
  expect(await auditRows()).toEqual(before);
});
it.each([undefined, '', '   '])(
  'refuses missing actor %j before a financial or audit write',
  async (user) => {
    const input = await seed();
    const before = await auditRows();
    await expect(service.redeem({ ...input, actorUserId: user as never })).rejects.toBeInstanceOf(
      BadRequestException
    );
    await expect(
      service.releaseByOrder(input.orderId, undefined, {
        actorUserId: user as never,
        ip: '127.0.0.1',
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      (
        await db.pool.query('SELECT * FROM gift_code_redemptions WHERE order_id=$1', [
          input.orderId,
        ])
      ).rows
    ).toEqual([]);
    expect(await auditRows()).toEqual(before);
  }
);
it('rolls back redemption when its required audit fails', async () => {
  const input = await seed();
  const before = await auditRows();
  await failAudit('redeemed');
  try {
    await expect(service.redeem(input)).rejects.toMatchObject({ code: 'P0001' });
  } finally {
    await removeFailure();
  }
  expect(
    (await db.pool.query('SELECT * FROM gift_code_redemptions WHERE order_id=$1', [input.orderId]))
      .rows
  ).toEqual([]);
  expect(await auditRows()).toEqual(before);
  const created = await service.redeem(input);
  await check(created.id, 'redeemed', null, 'consumed', actor);
});
it('rolls back release and preserves consumed history when its required audit fails', async () => {
  const input = await seed();
  const redemption = await service.redeem(input);
  const before = await auditRows();
  const ledger = (
    await db.pool.query('SELECT * FROM gift_code_redemptions WHERE id=$1', [redemption.id])
  ).rows;
  await failAudit('released');
  try {
    await expect(
      service.releaseByOrder(input.orderId, undefined, {
        actorUserId: releaseActor,
        ip: '127.0.0.1',
      })
    ).rejects.toMatchObject({ code: 'P0001' });
  } finally {
    await removeFailure();
  }
  expect(
    (await db.pool.query('SELECT * FROM gift_code_redemptions WHERE id=$1', [redemption.id])).rows
  ).toEqual(ledger);
  expect(await auditRows()).toEqual(before);
  expect(
    await service.releaseByOrder(input.orderId, undefined, {
      actorUserId: releaseActor,
      ip: '127.0.0.1',
    })
  ).toEqual({ released: 1 });
  await check(redemption.id, 'released', 'consumed', 'released', releaseActor);
});
it('keeps redemption and audit under the caller transaction rollback', async () => {
  const input = await seed();
  const before = await auditRows();
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const created = await service.redeem(input, client);
    expect(created.status).toBe('consumed');
    expect(
      (
        await client.query("SELECT * FROM audit_log WHERE metadata::jsonb->>'entityId'=$1", [
          created.id,
        ])
      ).rows
    ).toHaveLength(1);
    expect(
      (
        await db.pool.query('SELECT * FROM gift_code_redemptions WHERE order_id=$1', [
          input.orderId,
        ])
      ).rows
    ).toEqual([]);
    await client.query('ROLLBACK');
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  expect(
    (await db.pool.query('SELECT * FROM gift_code_redemptions WHERE order_id=$1', [input.orderId]))
      .rows
  ).toEqual([]);
  expect(await auditRows()).toEqual(before);
});
