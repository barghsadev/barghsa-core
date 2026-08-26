import { createIsolatedTestDb, dropTestSchema } from './src/test/testDb'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runSeed } from './src/seed/index'

const MIGRATION_PATH = resolve(__dirname, 'drizzle/0000_init_uuidv7_function.sql')
const PRODUCTS_MIGRATION_PATH = resolve(__dirname, 'drizzle/0014_recreate_products_schema.sql')

async function main() {
  process.env['ADMIN_BOOTSTRAP_SECRET'] = 'test-secret'
  process.env['ADMIN_BOOTSTRAP_EMAIL'] = 'admin@test.example'
  
  const ctx = await createIsolatedTestDb()

  const migrationSql = readFileSync(MIGRATION_PATH, 'utf-8').trim()
  await ctx.pool.query(migrationSql)

  const productsMigrationSql = readFileSync(PRODUCTS_MIGRATION_PATH, 'utf-8').trim()
  await ctx.pool.query(productsMigrationSql)

  await ctx.db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT,
      mobile TEXT,
      password_hash TEXT NOT NULL,
      locale TEXT NOT NULL DEFAULT 'fa',
      must_change_password BOOLEAN NOT NULL DEFAULT false,
      is_admin BOOLEAN NOT NULL DEFAULT false,
      password_change_token TEXT,
      password_change_token_expires_at TIMESTAMPTZ,
      notification_preferences TEXT NOT NULL DEFAULT 'IN_APP',
      timezone TEXT NOT NULL DEFAULT 'Asia/Tehran',
      last_accepted_tos_version TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  // Create provinces table
  await ctx.db.execute(`
    CREATE TABLE IF NOT EXISTS provinces (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
      name_fa TEXT NOT NULL,
      name_en TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  const result = await runSeed(false, ctx.db)
  console.log('ok:', result.ok)
  console.log('errors:', JSON.stringify(result.errors, null, 2))
  console.log('results:', JSON.stringify(result.results, null, 2))

  await ctx.pool.end()
  await dropTestSchema(ctx.schemaName)
}

main().catch(console.error)
