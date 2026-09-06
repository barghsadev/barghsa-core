import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql, eq } from 'drizzle-orm';
import { createMigratedTestDb } from '../test/migrated-db';
import { runSeed } from './index';
import { products } from '../schema/products';
import { users } from '../schema/users';
import { notificationTemplates } from '../schema/notification-templates';
import { buildSeedTemplates } from './notification-templates';
import { NOTIFICATION_TYPE_REGISTRY } from '@barghsa/shared/notifications';

/**
 * Integration tests for the seed runner (T-02.04.05, updated for T-03.01.01.01).
 *
 * Each test runs against an isolated PostgreSQL schema (via Testcontainers)
 * so no test state leaks between runs.
 */

describe('seed verification', () => {
  let ctx: Awaited<ReturnType<typeof createMigratedTestDb>>;

  beforeAll(async () => {
    ctx = await createMigratedTestDb();
  }, 30000);

  afterAll(async () => {
    await ctx.close();
  });

  it('creates 4 default electricity products with correct systemKey and null price', async () => {
    const result = await runSeed(false, ctx.db);
    expect(result.ok).toBe(true);

    const allProducts = await ctx.db
      .select()
      .from(products)
      .where(sql`system_key IS NOT NULL`)
      .orderBy(products.systemKey);

    expect(allProducts).toHaveLength(4);

    const expectedKeys = ['thermal', 'green', 'free_market', 'energy_saving'];
    for (const expectedKey of expectedKeys) {
      const product = allProducts.find((p) => p.systemKey === expectedKey);
      expect(product).toBeDefined();
      expect(product!.price).toBeNull();
      expect(product!.type).toBe('electricity');
      expect(product!.status).toBe('inactive');
      expect(product!.title).toEqual(
        expect.objectContaining({ fa: expect.any(String), en: expect.any(String) })
      );
    }
  });

  it('does not create duplicate system products when seed is re-run', async () => {
    const result = await runSeed(false, ctx.db);
    expect(result.ok).toBe(true);

    // Verify the seeder reports skipped, not created.
    const productResult = result.results.find((r) => r.entity === 'products');
    expect(productResult).toBeDefined();
    expect(productResult!.skipped).toBe(4);
    expect(productResult!.created).toBe(0);

    // Database still has exactly 4 system products.
    const countResult = await ctx.db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM products WHERE system_key IS NOT NULL`
    );
    expect(countResult.rows[0]?.count).toBe(4);
  });

  it('creates an admin user when bootstrap env vars are provided', async () => {
    const originalSecret = process.env['ADMIN_BOOTSTRAP_SECRET'];
    const originalKey = process.env['ADMIN_BOOTSTRAP_KEY'];
    const originalEmail = process.env['ADMIN_BOOTSTRAP_EMAIL'];
    const originalPassword = process.env['ADMIN_BOOTSTRAP_PASSWORD'];

    try {
      process.env['ADMIN_BOOTSTRAP_PASSWORD'] = 'Fixture-only-password-123!';
      process.env['ADMIN_BOOTSTRAP_SECRET'] = 'test-secret';
      process.env['ADMIN_BOOTSTRAP_KEY'] = 'test-key';
      process.env['ADMIN_BOOTSTRAP_EMAIL'] = 'admin@test.example';

      const result = await runSeed(false, ctx.db);
      expect(result.ok).toBe(true);

      const adminResult = result.results.find((r) => r.entity === 'admin_bootstrap');
      expect(adminResult).toBeDefined();
      expect(adminResult!.created).toBe(1);

      // Verify the user exists in the database.
      const adminUser = await ctx.db
        .select()
        .from(users)
        .where(eq(users.username, 'admin@test.example'))
        .limit(1);

      expect(adminUser).toHaveLength(1);
      expect(adminUser[0]!.isAdmin).toBe(true);
      expect(adminUser[0]!.mustChangePassword).toBe(true);
      expect(adminUser[0]!.locale).toBe('fa');
    } finally {
      if (originalKey === undefined) delete process.env.ADMIN_BOOTSTRAP_KEY;
      else process.env.ADMIN_BOOTSTRAP_KEY = originalKey;
      if (originalPassword === undefined) delete process.env.ADMIN_BOOTSTRAP_PASSWORD;
      else process.env.ADMIN_BOOTSTRAP_PASSWORD = originalPassword;
      if (originalSecret !== undefined) {
        process.env['ADMIN_BOOTSTRAP_SECRET'] = originalSecret;
      } else {
        delete process.env['ADMIN_BOOTSTRAP_SECRET'];
      }
      if (originalEmail !== undefined) {
        process.env['ADMIN_BOOTSTRAP_EMAIL'] = originalEmail;
      } else {
        delete process.env['ADMIN_BOOTSTRAP_EMAIL'];
      }
    }
  });

  it('skips admin bootstrap when env vars are not set', async () => {
    delete process.env['ADMIN_BOOTSTRAP_SECRET'];
    delete process.env['ADMIN_BOOTSTRAP_EMAIL'];

    const result = await runSeed(false, ctx.db);
    expect(result.ok).toBe(true);

    const adminResult = result.results.find((r) => r.entity === 'admin_bootstrap');
    expect(adminResult).toBeDefined();
    expect(adminResult!.skipped).toBe(1);
    expect(adminResult!.created).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Database constraint tests (T-02.04.06, updated for T-03.01.01.01)
  // -----------------------------------------------------------------------

  /**
   * System product constraint triggers are already applied via the
   * 0014_recreate_products_schema.sql migration.
   */
  describe('system product constraints', () => {
    it('prevents deletion of system-defined electricity products', async () => {
      // Fetch a system product.
      const [systemProduct] = await ctx.db
        .select({ id: products.id, systemKey: products.systemKey })
        .from(products)
        .where(sql`system_key IS NOT NULL`)
        .limit(1);

      expect(systemProduct).toBeDefined();

      // Attempt to delete it — should throw.
      await expect(
        ctx.db.delete(products).where(eq(products.id, systemProduct!.id))
      ).rejects.toThrow(/cannot delete system-defined/i);

      // Verify the row still exists.
      const remaining = await ctx.db
        .select({ id: products.id })
        .from(products)
        .where(eq(products.id, systemProduct!.id))
        .limit(1);

      expect(remaining).toHaveLength(1);
    });

    it('prevents changing system_key on system-defined products', async () => {
      const [systemProduct] = await ctx.db
        .select({ id: products.id, systemKey: products.systemKey })
        .from(products)
        .where(sql`system_key IS NOT NULL`)
        .limit(1);

      expect(systemProduct).toBeDefined();

      // Attempt to change system_key — should throw.
      await expect(
        ctx.db
          .update(products)
          .set({ systemKey: 'hacked_type' })
          .where(eq(products.id, systemProduct!.id))
      ).rejects.toThrow(/cannot change system_key/i);
    });

    it('prevents inserting a 5th system-defined electricity product', async () => {
      // Attempt to insert a bogus 5th system product — should throw.
      await expect(
        ctx.db.insert(products).values({
          systemKey: 'nuclear',
          title: { fa: 'برق هسته‌ای', en: 'Nuclear Electricity' },
          type: 'electricity',
          status: 'inactive',
        })
      ).rejects.toThrow(/cannot insert more than 4/i);
    });

    it('allows inserting admin-created products (null system_key)', async () => {
      // Admin-created products have system_key = NULL — should succeed.
      await expect(
        ctx.db.insert(products).values({
          systemKey: null,
          title: { fa: 'برق سفارشی', en: 'Custom Electricity' },
          type: 'electricity',
          status: 'active',
        })
      ).resolves.not.toThrow();
    });

    it('allows updating price and status on system products', async () => {
      const [systemProduct] = await ctx.db
        .select({ id: products.id })
        .from(products)
        .where(sql`system_key IS NOT NULL`)
        .limit(1);

      expect(systemProduct).toBeDefined();

      // Updating price and status must succeed.
      await expect(
        ctx.db
          .update(products)
          .set({ price: BigInt(500000), status: 'active' })
          .where(eq(products.id, systemProduct!.id))
      ).resolves.not.toThrow();
    });
  });
});

// -------------------------------------------------------------------------
// Notification template seeding (T-05.04.05)
// -------------------------------------------------------------------------

describe('notification template seeding', () => {
  let ctx: Awaited<ReturnType<typeof createMigratedTestDb>>;

  beforeAll(async () => {
    ctx = await createMigratedTestDb();
  }, 30000);

  afterAll(async () => {
    await ctx.close();
  });

  it('seeds an active version-1 template for every event × channel × locale', async () => {
    const result = await runSeed(false, ctx.db);
    expect(result.ok).toBe(true);

    const tplResult = result.results.find((r) => r.entity === 'notification_templates');
    expect(tplResult).toBeDefined();
    expect(tplResult!.errors).toHaveLength(0);

    const expectedCount = buildSeedTemplates().length;
    // A fresh DB has no pre-existing templates, so every catalog row is created.
    expect(tplResult!.created).toBe(expectedCount);

    const rows = await ctx.db.select().from(notificationTemplates);
    expect(rows).toHaveLength(expectedCount);

    // Every row must be an active version 1 usable by the engine.
    for (const row of rows) {
      expect(row.version).toBe(1);
      expect(row.status).toBe('active');
      expect(row.isActive).toBe(true);
      expect(row.locale).toMatch(/^(fa|en)$/);
      expect(row.channel).toMatch(/^(email|sms|in_app)$/);
    }

    // Both locales present for a representative event (OTP) across all channels.
    const otp = rows.filter((r) => r.eventKey === 'auth.otp_sent');
    expect(otp.map((r) => `${r.locale}:${r.channel}`).sort()).toEqual([
      'en:email',
      'en:in_app',
      'en:sms',
      'fa:email',
      'fa:in_app',
      'fa:sms',
    ]);
  });

  it('is idempotent: re-running skips already-seeded combos', async () => {
    await runSeed(false, ctx.db);
    const result = await runSeed(false, ctx.db);

    const tplResult = result.results.find((r) => r.entity === 'notification_templates');
    expect(tplResult).toBeDefined();
    expect(tplResult!.errors).toHaveLength(0);
    expect(tplResult!.created).toBe(0);
    expect(tplResult!.skipped).toBe(buildSeedTemplates().length);

    // No duplicates were created.
    const countResult = await ctx.db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM notification_templates`
    );
    expect(countResult.rows[0]?.count).toBe(buildSeedTemplates().length);
  });

  it('covers a template for every event key in the authoritative registry', async () => {
    const rows = await ctx.db
      .select({ eventKey: notificationTemplates.eventKey })
      .from(notificationTemplates);
    const seededKeys = new Set(rows.map((r) => r.eventKey));

    // The authoritative source of business events is NOTIFICATION_TYPE_REGISTRY
    // in @barghsa/shared (mirrors the E-05 appendix), NOT the seed catalog —
    // comparing against the seed itself would be tautological.
    const registryKeys = Object.keys(NOTIFICATION_TYPE_REGISTRY);
    for (const key of registryKeys) {
      expect(seededKeys.has(key), `missing seed template for registry event "${key}"`).toBe(true);
    }

    // Every seeded event must also be a known registry event (no drift/typos).
    for (const key of seededKeys) {
      expect(
        key in NOTIFICATION_TYPE_REGISTRY,
        `seeded event "${key}" is not in the notified registry`
      ).toBe(true);
    }
  });

  it('every placeholder used in body/subject is declared in the allow-list', () => {
    const placeholders = (s: string): string[] =>
      [...s.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]!);

    for (const row of buildSeedTemplates()) {
      const allowed = new Set(row.variables.map((v) => v.name));
      const used = new Set<string>();
      for (const p of placeholders(row.bodyTemplate)) used.add(p);
      if (row.subject) for (const p of placeholders(row.subject)) used.add(p);

      // Every placeholder used must be declared in the allow-list.
      for (const p of used) {
        expect(
          allowed.has(p),
          `${row.eventKey}/${row.channel}/${row.locale} uses undeclared {{${p}}}`
        ).toBe(true);
      }
    }
  });
});
