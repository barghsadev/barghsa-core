import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { createDirectDbPool } from '../index'
import { products } from '../schema/products'
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
 * Seed default electricity products.
 *
 * Uses `ON CONFLICT (system_type) DO NOTHING` for idempotency — re-running
 * the seed multiple times does not create duplicates.  System-type products
 * are immutable (not affected by `--force`).
 *
 * Extended by T-02.04.02 to add the four default electricity products with
 * their Persian titles and metadata.
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
        .where(eq(products.systemType, product.systemType))
        .limit(1)

      if (existing.length > 0) {
        result.skipped++
        continue
      }

      await db.insert(products).values(product).onConflictDoNothing({
        target: products.systemType,
      })

      result.created++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      result.errors.push(`product[${product.systemType}]: ${message}`)
    }
  }

  return result
}

/**
 * Return the system-defined electricity products.
 *
 * T-02.04.02 fills this with the four specific products (thermal, green,
 * free_market, energy_saving) and their Persian titles.
 *
 * Each product:
 *   systemType — unique system identifier
 *   titleFa   — Persian display name
 *   productType — always 'electricity'
 *   isActive  — false (admin must activate)
 *   minKwh, maxKwh — '0' (no limit)
 */
function getSystemProducts(): Array<{
  systemType: string
  titleFa: string
  productType: string
  isActive: boolean
  minKwh: string
  maxKwh: string
}> {
  return []
}

// ---------------------------------------------------------------------------
// Registered seeders — add new seeders here as the schema grows.
// ---------------------------------------------------------------------------

const seeders: Seeder[] = [
  seedProducts,
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
 */
export async function runSeed(force: boolean = false): Promise<SeedRunResult> {
  const pool = createDirectDbPool()
  const db = drizzle(pool)
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
    await pool.end()
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
