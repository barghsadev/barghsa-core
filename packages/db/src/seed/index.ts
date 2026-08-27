import { and, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { randomBytes } from 'node:crypto'
import { v7 as uuidv7 } from 'uuid'
import * as argon2 from 'argon2'
import { Pool } from 'pg'
import { createDirectDbPool } from '../index'
import { products } from '../schema/products'
import { users } from '../schema/users'
import { notificationTemplates } from '../schema/notification-templates'
import { buildSeedTemplates } from './notification-templates'
import type { DbInstance } from '../index'

// ---------------------------------------------------------------------------
// Seed runner — idempotent seed script for development and initial deployment.
//
// Uses a direct PostgreSQL connection (bypassing PgBouncer) for session-level
// features.  Designed as an extensible framework: individual seeders are
// registered in the seeders array and each returns a result summary.
//
// Usage:
//   tsx src/seed/index.ts            # normal seed
//   tsx src/seed/index.ts --force    # re-seed non-immutable data
// ---------------------------------------------------------------------------

export interface SeederResult {
  entity: string
  created: number
  skipped: number
  errors: string[]
}

export type Seeder = (db: DbInstance, force: boolean) => Promise<SeederResult>

// ---------------------------------------------------------------------------
// Seeders
// ---------------------------------------------------------------------------

/**
 * Admin bootstrap seeder (T-02.04.03).
 *
 * Creates an initial admin user when the following environment variables are
 * set:
 *
 *   ADMIN_BOOTSTRAP_SECRET — authorization secret (must be non-empty)
 *   ADMIN_BOOTSTRAP_EMAIL — email or E.164 phone for the admin account
 *   ADMIN_BOOTSTRAP_PASSWORD — (optional) temporary password; if omitted a
 *     random 32-character password is generated and printed to stderr
 *
 * The bootstrap runs only once: if any admin user already exists in the
 * database (checked by username), subsequent seed runs skip it.
 *
 * The admin user is created with `must_change_password: true` so the first
 * login forces a password change.  MFA enrollment is also enforced on first
 * login (the frontend checks the session state for unenrolled MFA).
 */
async function seedAdmin(db: DbInstance, _force: boolean): Promise<SeederResult> {
  const result: SeederResult = {
    entity: 'admin_bootstrap',
    created: 0,
    skipped: 0,
    errors: [],
  }

  const secret = process.env['ADMIN_BOOTSTRAP_SECRET']
  const email = process.env['ADMIN_BOOTSTRAP_EMAIL']

  // Guard: both SECRET and EMAIL must be set for bootstrap to run.
  if (!secret || !email) {
    result.skipped++
    return result
  }

  // Check if this admin user already exists.
  try {
    const existing = await db
      .select({ id: users.userId })
      .from(users)
      .where(eq(users.username, email))
      .limit(1)

    if (existing.length > 0) {
      result.skipped++
      return result
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    result.errors.push(`check_existing: ${message}`)
    return result
  }

  // Determine the temporary password.
  const tempPassword = process.env['ADMIN_BOOTSTRAP_PASSWORD'] ?? randomBytes(16).toString('hex')

  // Hash with the same Argon2id settings used by the API auth service.
  let passwordHash: string
  try {
    passwordHash = await argon2.hash(tempPassword)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    result.errors.push(`hash_password: ${message}`)
    return result
  }

  const userId = uuidv7()
  const now = new Date()

  try {
    await db.insert(users).values({
      userId,
      username: email,
      passwordHash,
      locale: 'fa',
      mustChangePassword: true,
      isAdmin: true,
      createdAt: now,
      updatedAt: now,
    })

    result.created++

    // Log the temporary password to stderr (visible in seed output but not
    // in stdout-based CI dashboards).  In production the operator sets a
    // known ADMIN_BOOTSTRAP_PASSWORD and the temp password is never logged.
    if (!process.env['ADMIN_BOOTSTRAP_PASSWORD']) {
      process.stderr.write(
        `[seed:admin_bootstrap] Temporary admin password for ${email}: ${tempPassword}\n`,
      )
    }

    // eslint-disable-next-line no-console
    console.log(`[seed:admin_bootstrap] Admin user created: ${userId} (${email})`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    result.errors.push(`insert_admin: ${message}`)
  }

  return result
}

/**
 * Seed default electricity products.
 *
 * Uses the `systemKey` unique constraint for idempotency — re-running
 * the seed multiple times does not create duplicates. System-type products
 * are immutable (not affected by `--force`).
 *
 * Creates the four default electricity products with localized JSONB titles.
 */
async function seedProducts(db: DbInstance, _force: boolean): Promise<SeederResult> {
  const result: SeederResult = {
    entity: 'products',
    created: 0,
    skipped: 0,
    errors: [],
  }

  const defaultProducts = getSystemProducts()

  for (const product of defaultProducts) {
    try {
      const existing = await db
        .select({ id: products.id })
        .from(products)
        .where(eq(products.systemKey, product.systemKey))
        .limit(1)

      if (existing.length > 0) {
        result.skipped++
        continue
      }

      await db.insert(products).values(product).onConflictDoNothing({
        target: products.systemKey,
      })

      result.created++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      result.errors.push(`product[${product.systemKey}]: ${message}`)
    }
  }

  return result
}

/**
 * Return the system-defined electricity products.
 *
 * Each product:
 *   systemKey — unique immutable system identifier
 *   title     — localized JSONB title
 *   type      — always 'electricity'
 *   status    — 'inactive' (admin must activate)
 */
function getSystemProducts(): Array<{
  systemKey: string
  title: { fa: string; en: string }
  type: 'electricity'
  status: 'inactive'
}> {
  return [
    {
      systemKey: 'thermal',
      title: { fa: 'برق حرارتی', en: 'Thermal Electricity' },
      type: 'electricity',
      status: 'inactive',
    },
    {
      systemKey: 'green',
      title: { fa: 'برق سبز', en: 'Green Electricity' },
      type: 'electricity',
      status: 'inactive',
    },
    {
      systemKey: 'free_market',
      title: { fa: 'برق آزاد', en: 'Free Market Electricity' },
      type: 'electricity',
      status: 'inactive',
    },
    {
      systemKey: 'energy_saving',
      title: { fa: 'برق صرفه‌جویی', en: 'Energy Saving Electricity' },
      type: 'electricity',
      status: 'inactive',
    },
  ]
}

/**
 * Seed Iranian provinces and cities (T-03.02.02).
 *
 * Uses idempotent INSERT pattern — re-running the seed does not create
 * duplicates. Only seeds the 31 Iranian provinces. Cities are added on
 * demand by admin geography management.
 */
async function seedGeography(db: DbInstance, _force: boolean): Promise<SeederResult> {
  const result: SeederResult = {
    entity: 'geography',
    created: 0,
    skipped: 0,
    errors: [],
  }

  const iranianProvinces: Array<{ nameFa: string; nameEn: string }> = [
    { nameFa: 'آذربایجان شرقی', nameEn: 'East Azerbaijan' },
    { nameFa: 'آذربایجان غربی', nameEn: 'West Azerbaijan' },
    { nameFa: 'اردبیل', nameEn: 'Ardabil' },
    { nameFa: 'اصفهان', nameEn: 'Isfahan' },
    { nameFa: 'البرز', nameEn: 'Alborz' },
    { nameFa: 'ایلام', nameEn: 'Ilam' },
    { nameFa: 'بوشهر', nameEn: 'Bushehr' },
    { nameFa: 'تهران', nameEn: 'Tehran' },
    { nameFa: 'چهارمحال و بختیاری', nameEn: 'Chaharmahal and Bakhtiari' },
    { nameFa: 'خراسان جنوبی', nameEn: 'South Khorasan' },
    { nameFa: 'خراسان رضوی', nameEn: 'Razavi Khorasan' },
    { nameFa: 'خراسان شمالی', nameEn: 'North Khorasan' },
    { nameFa: 'خوزستان', nameEn: 'Khuzestan' },
    { nameFa: 'زنجان', nameEn: 'Zanjan' },
    { nameFa: 'سمنان', nameEn: 'Semnan' },
    { nameFa: 'سیستان و بلوچستان', nameEn: 'Sistan and Baluchestan' },
    { nameFa: 'فارس', nameEn: 'Fars' },
    { nameFa: 'قزوین', nameEn: 'Qazvin' },
    { nameFa: 'قم', nameEn: 'Qom' },
    { nameFa: 'کردستان', nameEn: 'Kurdistan' },
    { nameFa: 'کرمان', nameEn: 'Kerman' },
    { nameFa: 'کرمانشاه', nameEn: 'Kermanshah' },
    { nameFa: 'کهگیلویه و بویراحمد', nameEn: 'Kohgiluyeh and Boyer-Ahmad' },
    { nameFa: 'گلستان', nameEn: 'Golestan' },
    { nameFa: 'گیلان', nameEn: 'Gilan' },
    { nameFa: 'لرستان', nameEn: 'Lorestan' },
    { nameFa: 'مازندران', nameEn: 'Mazandaran' },
    { nameFa: 'مرکزی', nameEn: 'Markazi' },
    { nameFa: 'هرمزگان', nameEn: 'Hormozgan' },
    { nameFa: 'همدان', nameEn: 'Hamadan' },
    { nameFa: 'یزد', nameEn: 'Yazd' },
  ]

  // Use raw SQL through the drizzle ORM instance to insert provinces
  // (geography tables are not registered in the Drizzle ORM schema object).
  for (const province of iranianProvinces) {
    try {
      const existing = await db.execute(
        sql`SELECT id FROM provinces WHERE name_en = ${province.nameEn} LIMIT 1`,
      )

      if (existing.rows.length > 0) {
        result.skipped++
        continue
      }

      await db.execute(
        sql`INSERT INTO provinces (id, name_fa, name_en) VALUES (gen_random_uuid(), ${province.nameFa}, ${province.nameEn})`,
      )

      result.created++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      result.errors.push(`province[${province.nameEn}]: ${message}`)
    }
  }

  return result
}

/**
 * Seed the initial notification templates (T-05.04.05).
 *
 * Creates the first version of every notification template for every business
 * event in the E-05 appendix, across both locales (fa/en) and every channel the
 * event delivers on. Seed rows are created as version 1, status `active`,
 * is_active `true`, and published_at set, so they are immediately usable by the
 * notification engine.
 *
 * Idempotency: matching is on (event_key, channel, locale). If an active
 * template already exists for a combo, that combo is skipped so re-running the
 * seed never creates duplicates or shadows admin-authored edits. Inactive
 * (archived/draft-only) combos are re-seeded to guarantee an active version
 * exists for every event.
 */
async function seedNotificationTemplates(
  db: DbInstance,
  _force: boolean,
): Promise<SeederResult> {
  const result: SeederResult = {
    entity: 'notification_templates',
    created: 0,
    skipped: 0,
    errors: [],
  }

  const templates = buildSeedTemplates()
  const now = new Date()

  for (const tpl of templates) {
    try {
      // Skip when an active template already exists for the combo.
      const existing = await db
        .select({ id: notificationTemplates.id })
        .from(notificationTemplates)
        .where(
          and(
            eq(notificationTemplates.eventKey, tpl.eventKey),
            eq(notificationTemplates.channel, tpl.channel),
            eq(notificationTemplates.locale, tpl.locale),
            eq(notificationTemplates.isActive, true),
          ),
        )
        .limit(1)

      if (existing.length > 0) {
        result.skipped++
        continue
      }

      await db.insert(notificationTemplates).values({
        id: uuidv7(),
        eventKey: tpl.eventKey,
        channel: tpl.channel,
        locale: tpl.locale,
        subject: tpl.subject,
        bodyTemplate: tpl.bodyTemplate,
        variables: tpl.variables,
        status: 'active',
        isActive: true,
        version: 1,
        publishedAt: now,
        createdAt: now,
        updatedAt: now,
      })

      result.created++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      result.errors.push(`template[${tpl.eventKey}/${tpl.channel}/${tpl.locale}]: ${message}`)
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Registered seeders — add new seeders here as the schema grows.
// ---------------------------------------------------------------------------

const seeders: Seeder[] = [
  seedProducts,
  seedAdmin,
  seedGeography,
  seedNotificationTemplates,
]

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

export interface SeedRunResult {
  ok: boolean
  results: SeederResult[]
  errors: string[]
}

/**
 * Run all registered seeders against the database.
 *
 * When `dbOverride` is provided the caller manages the connection lifecycle;
 * otherwise a new direct pool is created and closed automatically.
 */
export async function runSeed(
  force: boolean = false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dbOverride?: any,
): Promise<SeedRunResult> {
  let pool: Pool | null = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any

  if (dbOverride) {
    db = dbOverride
  } else {
    pool = createDirectDbPool()
    db = drizzle(pool)
  }

  const results: SeederResult[] = []
  const errors: string[] = []

  try {
    for (const seeder of seeders) {
      try {
        const result = await seeder(db, force)
        results.push(result)
        if (result.errors.length > 0) {
          errors.push(...result.errors.map((e) => `[${result.entity}] ${e}`))
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        errors.push(message)
      }
    }
  } finally {
    if (pool) {
      await pool.end()
    }
  }

  return {
    ok: errors.length === 0,
    results,
    errors,
  }
}

// ---------------------------------------------------------------------------
// Parse CLI args
// ---------------------------------------------------------------------------

function parseArgs(): { force: boolean } {
  const args = process.argv.slice(2)
  return {
    force: args.includes('--force'),
  }
}

async function main(): Promise<void> {
  const { force } = parseArgs()
  const result = await runSeed(force)

  for (const r of result.results) {
    const parts: string[] = []
    if (r.created > 0) parts.push(`created ${r.created}`)
    if (r.skipped > 0) parts.push(`skipped ${r.skipped}`)
    if (r.errors.length > 0) parts.push(`errors: ${r.errors.join(', ')}`)
    const summary = parts.length > 0 ? parts.join(', ') : 'no changes'
    // eslint-disable-next-line no-console
    console.log(`[seed:${r.entity}] ${summary}`)
  }

  if (!result.ok) {
    for (const err of result.errors) {
      console.error(`[seed:error] ${err}`)
    }
    process.exit(1)
  }

  process.exit(0)
}

// Allow direct invocation: `tsx src/seed/index.ts`
const isDirectRun =
  process.argv[1] != null &&
  (process.argv[1].endsWith('/seed/index.ts') ||
    process.argv[1].endsWith('\\seed\\index.ts'))
if (isDirectRun) {
  main()
}
