/**
 * Real-PostgreSQL integration tests for the VAT calculation module
 * (T-04.1.02.04).
 *
 * Proves the resolution precedence against actual PostgreSQL vat tables:
 *   - product override wins over category default (T-09.12.02)
 *   - category default applies when no override is active
 *   - 0% fallback when neither is configured
 *   - effective-window boundaries (exclusive `effective_until`)
 *   - works on the shared pool AND a caller-owned transaction client
 *     (the invoice-generation snapshot seam).
 *
 * Runs against the full production migration chain, including foreign keys
 * and effective-window constraints.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createMigratedTestDb } from '../../../../packages/db/src/test/migrated-db';
import { VatCalculationRepository } from './vat-calculation.repository.js';
import { VatCalculationService } from './vat-calculation.service.js';

// ---- Real-DB wiring ------------------------------------------------------
const poolHolder = vi.hoisted(() => ({ pool: null as import('pg').Pool | null }));

vi.mock('@barghsa/db', () => ({
  getDbPool: () => {
    if (!poolHolder.pool) {
      throw new Error('test pool not initialized — beforeAll must run first');
    }
    return poolHolder.pool;
  },
}));

const USER_ID = 'vat-config-admin';
const CATEGORY_A = 'electricity';
const CATEGORY_ENDED_ONLY = 'consultation';
const PRODUCT_ID = '11111111-1111-7111-8111-111111111111';
const PRODUCT_B = '22222222-2222-7222-8222-222222222222';
const RATE_CAT_9 = '33333333-3333-7333-8333-333333333333';
const RATE_CAT_5 = '44444444-4444-7444-8444-444444444444';
const RATE_OVERRIDE = '55555555-5555-7555-8555-555555555555';
const RATE_ENDED_ONLY = '77777777-7777-7777-8777-777777777777';

describe('VatCalculationRepository — real PostgreSQL integration (T-04.1.02.04)', () => {
  let ctx: Awaited<ReturnType<typeof createMigratedTestDb>>;
  let repo: VatCalculationRepository;
  let service: VatCalculationService;

  beforeAll(async () => {
    ctx = await createMigratedTestDb();
    poolHolder.pool = ctx.pool;
    repo = new VatCalculationRepository();
    service = new VatCalculationService(repo);

    // Seed: two products, a 9% open category rate, a 5% scheduled category
    // rate, and a 5% override on PRODUCT_ID.
    await ctx.pool.query(
      `INSERT INTO users (user_id, username, password_hash) VALUES ('${USER_ID}', 'vat@example.test', 'test-only') ON CONFLICT (user_id) DO NOTHING`
    );
    await ctx.pool.query(
      `INSERT INTO products (id, type, title, price) VALUES
         ('${PRODUCT_ID}', '${CATEGORY_A}', '{"en":"Test product"}', 1000),
         ('${PRODUCT_B}', '${CATEGORY_A}', '{"en":"Test product B"}', 1000)
       ON CONFLICT (id) DO NOTHING`
    );
    await ctx.pool.query(
      `INSERT INTO vat_configurations (id, category, rate, effective_from, effective_until, created_by)
       VALUES
         ('${RATE_CAT_9}', '${CATEGORY_A}', 900, '2026-06-01T00:00:00Z', NULL, '${USER_ID}'),
         ('${RATE_CAT_5}', '${CATEGORY_A}', 500, '2026-01-01T00:00:00Z', '2026-06-01T00:00:00Z', '${USER_ID}'),
         ('${RATE_OVERRIDE}', 'product_override', 500, '2026-01-01T00:00:00Z', NULL, '${USER_ID}'),
         ('${RATE_ENDED_ONLY}', '${CATEGORY_ENDED_ONLY}', 800, '2026-01-01T00:00:00Z',
          '2026-06-01T00:00:00Z', '${USER_ID}')
       ON CONFLICT (id) DO NOTHING`
    );
    await ctx.pool.query(
      `INSERT INTO product_vat_overrides (id, product_id, vat_config_id, effective_from, effective_until, created_by)
       VALUES ('66666666-6666-7666-8666-666666666666', '${PRODUCT_ID}', '${RATE_OVERRIDE}',
               '2026-01-01T00:00:00Z', NULL, '${USER_ID}')
       ON CONFLICT (id) DO NOTHING`
    );
  }, 60_000);

  afterAll(async () => {
    poolHolder.pool = null;
    await ctx.close();
  });

  it('product override wins over the category default (pool executor)', async () => {
    const result = await service.resolveRate(ctx.pool, {
      productId: PRODUCT_ID,
      at: new Date('2026-08-01T00:00:00Z'),
    });
    expect(result).toEqual({ rateBasisPoints: 500, source: 'product_override' });
  });

  it('category default applies when no override exists (bare product, type-derived)', async () => {
    const result = await service.resolveRate(ctx.pool, {
      productId: PRODUCT_B,
      at: new Date('2026-08-01T00:00:00Z'),
    });
    // PRODUCT_B has no override → type `electricity` derives the category
    // and the open 9% rate applies.
    expect(result).toEqual({ rateBasisPoints: 900, source: 'category' });
  });

  it.each([
    [
      'before the linked rate starts',
      '2026-08-01T00:00:00Z',
      '2026-07-31T23:59:59.999Z',
      900,
      'category',
    ],
    [
      'when the linked rate starts',
      '2026-08-01T00:00:00Z',
      '2026-08-01T00:00:00Z',
      500,
      'product_override',
    ],
    [
      'just before the linked rate ends',
      '2026-07-01T00:00:00Z',
      '2026-08-31T23:59:59.999Z',
      500,
      'product_override',
    ],
    ['when the linked rate ends', '2026-07-01T00:00:00Z', '2026-09-01T00:00:00Z', 900, 'category'],
  ])('honours the linked rate window %s', async (_label, from, at, rate, source) => {
    const client = await ctx.pool.connect();
    try {
      await client.query('BEGIN');
      // The product assignment remains open, but its linked rate has its own validity window.
      await client.query(
        `UPDATE vat_configurations SET effective_from = $2, effective_until = $3 WHERE id = $1`,
        [RATE_OVERRIDE, from, '2026-09-01T00:00:00Z']
      );
      const result = await service.resolveRate(client, {
        productId: PRODUCT_ID,
        at: new Date(at),
      });
      expect(result).toEqual({ rateBasisPoints: rate, source });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('returns 0% when resolving a category with no active rate', async () => {
    const result = await service.resolveRate(ctx.pool, {
      category: 'hardware',
      at: new Date('2026-08-01T00:00:00Z'),
    });
    expect(result).toEqual({ rateBasisPoints: 0, source: 'fallback_zero' });
  });

  it('an ended rate does not apply (exclusive effective_until) — category with only an ended rate → 0%', async () => {
    // CATEGORY_ENDED_ONLY has exactly one rate, ended 2026-06-01. Asking
    // after that date must resolve to the 0% fallback — nothing else in
    // the category could win.
    const at = new Date('2026-07-01T00:00:00Z');
    const result = await service.resolveRate(ctx.pool, { category: CATEGORY_ENDED_ONLY, at });
    expect(result).toEqual({ rateBasisPoints: 0, source: 'fallback_zero' });
  });

  it('a rate ending exactly at `at` is not active (exclusive until boundary)', async () => {
    // The 5% 'electricity' rate ended exactly 2026-06-01T00:00:00Z; asking
    // at that instant must not return it.
    const at = new Date('2026-06-01T00:00:00Z');
    const ended = await service.resolveRate(ctx.pool, { category: CATEGORY_A, at });
    expect(ended.rateBasisPoints).not.toBe(500);
    // And one millisecond earlier it IS active.
    const active = await service.resolveRate(ctx.pool, {
      category: CATEGORY_A,
      at: new Date('2026-05-31T23:59:59.999Z'),
    });
    expect(active).toEqual({ rateBasisPoints: 500, source: 'category' });
  });

  it('resolves correctly inside a caller-owned transaction client', async () => {
    const client = await ctx.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await service.resolveRate(client, {
        productId: PRODUCT_ID,
        at: new Date('2026-08-01T00:00:00Z'),
      });
      expect(result).toEqual({ rateBasisPoints: 500, source: 'product_override' });
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  it('vatAmount math is integer-only half-up to the nearest IRR', () => {
    expect(service.vatAmount(750_000n, 900)).toBe(67_500n);
    expect(service.vatAmount(55_055n, 1000)).toBe(5_506n);
    expect(service.vatAmount(1_000_000n, 900, false)).toBe(0n);
    expect(() => service.vatAmount(-1n, 900)).toThrow(RangeError);
  });
});
