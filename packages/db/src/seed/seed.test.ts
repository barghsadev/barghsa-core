import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql, eq } from 'drizzle-orm';
import { createMigratedTestDb } from '../test/migrated-db';
import { runSeed, seedNotificationTemplates } from './index';
import { products } from '../schema/products';
import { users } from '../schema/users';
import { notificationTemplates } from '../schema/notification-templates';
import { buildSeedTemplates } from './notification-templates';
import { NOTIFICATION_TYPE_REGISTRY } from '@barghsa/shared/notifications';
import { renderTemplate, collectVariables, validateTemplate } from '@barghsa/shared/notifications';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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

    const limits = (await ctx.pool.query('SELECT min_kwh,max_kwh FROM electricity_product_limits'))
      .rows;
    expect(limits).toHaveLength(4);
    expect(limits.every((row) => row.min_kwh === '0' && row.max_kwh === '0')).toBe(true);
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
      ).rejects.toMatchObject({
        cause: { message: expect.stringMatching(/cannot delete system-defined/i) },
      });

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
      ).rejects.toMatchObject({
        cause: { message: expect.stringMatching(/cannot change system_key/i) },
      });
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
      ).rejects.toMatchObject({
        cause: { message: expect.stringMatching(/four system keys/i) },
      });
    });

    it('allows inserting non-electricity admin products (null system_key)', async () => {
      // Admin-created products have system_key = NULL — should succeed.
      await expect(
        ctx.db.insert(products).values({
          systemKey: null,
          title: { fa: 'تجهیزات', en: 'Hardware' },
          type: 'hardware',
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

  it('covers every Appendix channel and locale and renders each declared variable contract', () => {
    const rows = buildSeedTemplates();
    const appendix = readFileSync(
      resolve(__dirname, '../../../../kanban/epics/05-notifications-documents-ai.md'),
      'utf8'
    )
      .split('## 3. Appendix: Business Notification Events')[1]!
      .split('## 4.')[0]!;
    const events = [...appendix.matchAll(/^\| `([^`]+)` \| [^|]+ \| [^|]+ \| ([^|]+) \|/gm)];
    expect(events.length).toBe(35);
    for (const [, event, channels] of events) {
      for (const channel of channels!
        .split(',')
        .flatMap((value) =>
          value.trim().toLowerCase() === 'any'
            ? ['email', 'sms', 'in_app']
            : [value.trim().toLowerCase().replace('in-app', 'in_app')]
        )) {
        for (const locale of ['fa', 'en']) {
          expect(
            rows.filter(
              (row) => row.eventKey === event && row.channel === channel && row.locale === locale
            ),
            `${event}/${channel}/${locale}`
          ).toHaveLength(1);
        }
      }
    }
    for (const row of rows) {
      const names = row.variables.map((variable) => variable.name);
      expect(row.variables.every((variable) => variable.description.trim())).toBe(true);
      const data = Object.fromEntries(
        names.map((name) => [name, '<img src=x onerror=attack()> & "sample"'])
      );
      for (const template of [row.subject, row.bodyTemplate].filter(
        (value): value is string => value !== null
      )) {
        expect(validateTemplate(template, names)).toEqual([]);
        const rendered = renderTemplate(template, names, {
          data: { ...data, internalSecret: 'DO_NOT_EXPOSE' },
        });
        expect(rendered.missing).toEqual([]);
        expect(rendered.unknown).toEqual([]);
        expect(rendered.output).not.toContain('<img');
        expect(rendered.output).not.toContain('DO_NOT_EXPOSE');
        if (collectVariables(template).length) expect(rendered.output).toContain('&lt;img');
        expect(renderTemplate(template, names).missing.sort()).toEqual(
          collectVariables(template).sort()
        );
      }
    }
  });

  it('runs the notification data migration without seeding products, geography or admins', async () => {
    const isolated = await createMigratedTestDb();
    try {
      const { stdout } = await promisify(execFile)('pnpm', ['db:migrate:notification-templates'], {
        cwd: resolve(__dirname, '../..'),
        env: { ...process.env, PGDIRECT_URL: isolated.connectionString },
        timeout: 15000,
      });
      expect(stdout).toContain(
        `[seed:notification_templates] created ${buildSeedTemplates().length}`
      );
      expect(stdout).not.toContain('[seed:products]');
      expect((await isolated.db.select().from(notificationTemplates)).length).toBe(
        buildSeedTemplates().length
      );
      expect(await isolated.db.select().from(products)).toEqual([]);
      expect(await isolated.db.select().from(users)).toEqual([]);
      expect(
        (await isolated.pool.query('SELECT count(*)::int AS count FROM provinces')).rows[0]?.count
      ).toBe(0);
    } finally {
      await isolated.close();
    }
  }, 20000);

  it('preserves customized drafts and archived families, including force runs', async () => {
    const family = 'auth.password_changed';
    await ctx.db.delete(notificationTemplates).where(eq(notificationTemplates.eventKey, family));
    await ctx.pool.query(`INSERT INTO notification_templates
      (event_key,channel,locale,body_template,version,status,is_active)
      VALUES ('auth.password_changed','email','en','Custom draft',1,'draft',false),
             ('auth.password_changed','email','fa','Custom archive',2,'archived',false)`);
    const before = (
      await ctx.pool.query(
        "SELECT * FROM notification_templates WHERE event_key=$1 AND channel='email' ORDER BY locale",
        [family]
      )
    ).rows;
    const result = await seedNotificationTemplates(ctx.db, true);
    expect(result.errors).toEqual([]);
    const after = (
      await ctx.pool.query(
        "SELECT * FROM notification_templates WHERE event_key=$1 AND channel='email' ORDER BY locale",
        [family]
      )
    ).rows;
    expect(after).toEqual(before);
  });

  it('serializes concurrent seeders without duplicate versions or errors', async () => {
    await ctx.db.delete(notificationTemplates);
    const results = await Promise.all([
      seedNotificationTemplates(ctx.db, false),
      seedNotificationTemplates(ctx.db, false),
    ]);
    expect(results.flatMap((result) => result.errors)).toEqual([]);
    expect(results.reduce((sum, result) => sum + result.created, 0)).toBe(
      buildSeedTemplates().length
    );
    expect((await ctx.db.select().from(notificationTemplates)).length).toBe(
      buildSeedTemplates().length
    );
  });

  it('rolls back the entire catalog when a template insert fails', async () => {
    await ctx.db.delete(notificationTemplates);
    await ctx.pool
      .query(`CREATE FUNCTION reject_seed_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.event_key='auth.password_changed' THEN RAISE EXCEPTION 'seed fixture rejection'; END IF;
      RETURN NEW; END $$;
      CREATE TRIGGER reject_seed_fixture BEFORE INSERT ON notification_templates
      FOR EACH ROW EXECUTE FUNCTION reject_seed_fixture()`);
    try {
      const result = await seedNotificationTemplates(ctx.db, false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.created).toBe(0);
      expect(await ctx.db.select().from(notificationTemplates)).toEqual([]);
    } finally {
      await ctx.pool.query(
        'DROP TRIGGER reject_seed_fixture ON notification_templates; DROP FUNCTION reject_seed_fixture()'
      );
    }
  });
});

describe('seed concurrency and force boundaries', () => {
  it('counts actual inserts under concurrent runs without duplicating products or geography', async () => {
    const ctx = await createMigratedTestDb();
    try {
      const results = await Promise.all(Array.from({ length: 3 }, () => runSeed(false, ctx.db)));
      expect(results.every((result) => result.ok)).toBe(true);
      for (const [entity, count] of [
        ['products', 4],
        ['geography', 31],
      ] as const) {
        const rows = results.map((result) => result.results.find((row) => row.entity === entity)!);
        expect(rows.reduce((sum, row) => sum + row.created, 0)).toBe(count);
        expect(rows.reduce((sum, row) => sum + row.skipped, 0)).toBe(count * 2);
      }
      expect((await ctx.pool.query('SELECT count(*)::int AS n FROM products')).rows[0].n).toBe(4);
      expect((await ctx.pool.query('SELECT count(*)::int AS n FROM provinces')).rows[0].n).toBe(31);
    } finally {
      await ctx.close();
    }
  }, 30000);

  it('force restores only mutable seed labels and preserves product business fields', async () => {
    const ctx = await createMigratedTestDb();
    try {
      expect((await runSeed(false, ctx.db)).ok).toBe(true);
      await expect(
        ctx.pool.query('UPDATE electricity_product_limits SET min_kwh=-1,max_kwh=0')
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        ctx.pool.query('UPDATE electricity_product_limits SET max_kwh=-1')
      ).rejects.toMatchObject({ code: '23514' });
      await ctx.pool.query(
        "UPDATE provinces SET name_fa='Custom',status='inactive' WHERE name_en='Tehran'"
      );
      await ctx.pool.query(
        `UPDATE products SET price=9007199254740993,status='active',title='{"fa":"سفارشی","en":"Custom"}' WHERE system_key='thermal'`
      );
      await ctx.pool.query('UPDATE electricity_product_limits SET min_kwh=5,max_kwh=10');
      const limitsBefore = (
        await ctx.pool.query('SELECT * FROM electricity_product_limits ORDER BY id')
      ).rows;
      const productsBefore = (await ctx.pool.query('SELECT * FROM products ORDER BY id')).rows;
      expect((await runSeed(false, ctx.db)).ok).toBe(true);
      expect(
        (await ctx.pool.query("SELECT name_fa FROM provinces WHERE name_en='Tehran'")).rows[0]
          .name_fa
      ).toBe('Custom');
      const forced = await runSeed(true, ctx.db);
      expect(forced.ok).toBe(true);
      expect(forced.results.find((row) => row.entity === 'geography')).toMatchObject({
        created: 0,
        updated: 1,
        skipped: 30,
      });
      expect(
        (await ctx.pool.query("SELECT name_fa,status FROM provinces WHERE name_en='Tehran'"))
          .rows[0]
      ).toEqual({ name_fa: 'تهران', status: 'inactive' });
      expect((await ctx.pool.query('SELECT * FROM products ORDER BY id')).rows).toEqual(
        productsBefore
      );
      expect(
        (await ctx.pool.query('SELECT * FROM electricity_product_limits ORDER BY id')).rows
      ).toEqual(limitsBefore);
    } finally {
      await ctx.close();
    }
  }, 30000);

  it('blocks null/unknown electricity identities and product-type deletion bypasses', async () => {
    const ctx = await createMigratedTestDb();
    try {
      expect((await runSeed(false, ctx.db)).ok).toBe(true);
      for (const key of [null, 'nuclear']) {
        await expect(
          ctx.pool.query(
            `INSERT INTO products(type,system_key,title) VALUES ('electricity',$1,'{}')`,
            [key]
          )
        ).rejects.toMatchObject({ code: 'P0001' });
      }
      await expect(
        ctx.pool.query("UPDATE products SET type='hardware' WHERE system_key='thermal'")
      ).rejects.toMatchObject({ code: 'P0001' });
      await expect(
        ctx.pool.query("UPDATE products SET system_key=NULL WHERE system_key='thermal'")
      ).rejects.toMatchObject({ code: 'P0001' });
      await expect(
        ctx.pool.query("DELETE FROM products WHERE system_key='thermal'")
      ).rejects.toMatchObject({ code: 'P0001' });
      const hardware = (
        await ctx.pool.query(
          `INSERT INTO products(type,title) VALUES ('hardware','{}') RETURNING id`
        )
      ).rows[0].id;
      await expect(
        ctx.pool.query("UPDATE products SET type='electricity' WHERE id=$1", [hardware])
      ).rejects.toMatchObject({ code: 'P0001' });
      await ctx.pool.query('DELETE FROM products WHERE id=$1', [hardware]);
      expect((await ctx.pool.query('SELECT count(*)::int AS n FROM products')).rows[0].n).toBe(4);
    } finally {
      await ctx.close();
    }
  }, 30000);
});

it('preserves legacy electricity identities and refuses to seed duplicate replacements', async () => {
  const ctx = await createMigratedTestDb();
  try {
    // Reproduce a row admitted by the old trigger, without changing production data.
    await ctx.pool.query(
      'ALTER TABLE products DISABLE TRIGGER trg_prevent_extra_system_product_insert'
    );
    await ctx.pool.query(
      `INSERT INTO products(type,system_key,title) VALUES ('electricity','green_electricity','{}')`
    );
    await ctx.pool.query(
      'ALTER TABLE products ENABLE TRIGGER trg_prevent_extra_system_product_insert'
    );
    const before = (await ctx.pool.query('SELECT * FROM products')).rows;
    const result = await runSeed(false, ctx.db);
    expect(result.ok).toBe(false);
    expect(result.results.find((row) => row.entity === 'products')).toMatchObject({
      created: 0,
      skipped: 0,
      errors: [expect.stringContaining('reconciliation')],
    });
    expect((await ctx.pool.query('SELECT * FROM products')).rows).toEqual(before);
  } finally {
    await ctx.close();
  }
}, 30000);

it('rolls back geography and truthful counts when a province insert fails', async () => {
  const ctx = await createMigratedTestDb();
  try {
    await ctx.pool
      .query(`CREATE FUNCTION reject_seed_province() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.name_en='Tehran' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_seed_province BEFORE INSERT ON provinces FOR EACH ROW EXECUTE FUNCTION reject_seed_province()`);
    const result = await runSeed(false, ctx.db);
    expect(result.ok).toBe(false);
    expect(result.results.find((row) => row.entity === 'geography')).toMatchObject({
      created: 0,
      skipped: 0,
      updated: 0,
      errors: [expect.any(String)],
    });
    expect((await ctx.pool.query('SELECT id FROM provinces')).rows).toEqual([]);
    await ctx.pool.query('DROP TRIGGER reject_seed_province ON provinces');
    expect((await runSeed(false, ctx.db)).ok).toBe(true);
    expect((await ctx.pool.query('SELECT count(*)::int AS n FROM provinces')).rows[0].n).toBe(31);
  } finally {
    await ctx.close();
  }
}, 30000);
