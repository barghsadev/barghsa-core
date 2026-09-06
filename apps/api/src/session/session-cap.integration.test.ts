import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createMigratedTestDb } from '../../../../packages/db/src/test/migrated-db'
import { SessionService } from './session.service.js'
const holder = vi.hoisted(() => ({ pool: null as import('pg').Pool | null }))
vi.mock('@barghsa/db', async original => ({ ...await original<typeof import('@barghsa/db')>(), getDbPool: () => holder.pool! }))
let db: Awaited<ReturnType<typeof createMigratedTestDb>>
const service = new SessionService()
beforeEach(async () => {
  db = await createMigratedTestDb(); holder.pool = db.pool
  await db.pool.query("INSERT INTO users(user_id,username,password_hash) VALUES ('cap-user','cap@example.test','test-only')")
},30000)
afterEach(async () => { holder.pool = null; await db?.close() })
async function usable() {
  return (await db.pool.query(`SELECT session_id FROM sessions WHERE user_id='cap-user' AND revoked_at IS NULL
    AND expires_at>NOW() AND idle_deadline>NOW()`)).rows
}
it('caps concurrent standalone creation from an empty account at fifty usable sessions', async () => {
  const created = await Promise.all(Array.from({ length:65 }, () => service.createSession('cap-user',false)))
  expect(created).toHaveLength(65)
  expect(await usable()).toHaveLength(50)
  expect((await db.pool.query("SELECT session_id FROM sessions WHERE revoked_at IS NOT NULL")).rows).toHaveLength(15)
  expect((await db.pool.query('SELECT id FROM refresh_tokens')).rows).toHaveLength(65)
})
it('repairs an existing excess and revokes the oldest sessions in deterministic order', async () => {
  const ids = Array.from({ length:60 }, () => randomUUID()).sort()
  for (const id of ids) await db.pool.query(`INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,created_at)
    VALUES ($1,'cap-user',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes','2026-01-01')`,[id,randomUUID(),randomUUID()])
  await service.createSession('cap-user',false)
  expect(await usable()).toHaveLength(50)
  expect((await db.pool.query('SELECT session_id FROM sessions WHERE revoked_at IS NOT NULL ORDER BY session_id')).rows.map(row => row.session_id)).toEqual(ids.slice(0,11))
})
it('rechecks account eligibility after waiting for concurrent disable and commits no session', async () => {
  const client = await db.pool.connect()
  let creating: Promise<unknown> | undefined
  try {
    await client.query('BEGIN')
    await client.query("UPDATE users SET disabled_at=NOW() WHERE user_id='cap-user'")
    creating = service.createSession('cap-user',false)
    const rejected = expect(creating).rejects.toMatchObject({ status:401 })
    await expect.poll(async () => Number((await db.pool.query(`SELECT count(*) AS count FROM pg_stat_activity WHERE datname=current_database()
      AND wait_event_type='Lock' AND query='SELECT auth_version,disabled_at FROM users WHERE user_id=$1 FOR UPDATE'`)).rows[0].count)).toBe(1)
    await client.query('COMMIT'); await rejected
    expect(await usable()).toHaveLength(0)
    expect((await db.pool.query('SELECT id FROM refresh_tokens')).rows).toHaveLength(0)
  } finally { await client.query('ROLLBACK'); client.release(); await creating?.catch(() => {}) }
})
it('rolls back cap eviction if the new refresh credential cannot commit', async () => {
  await Promise.all(Array.from({ length:50 }, () => service.createSession('cap-user',false)))
  const original = (await usable()).map(row => row.session_id).sort()
  await db.pool.query(`CREATE FUNCTION fail_cap_refresh() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test refresh failure'; END $$;
    CREATE TRIGGER fail_cap_refresh BEFORE INSERT ON refresh_tokens FOR EACH ROW EXECUTE FUNCTION fail_cap_refresh()`)
  await expect(service.createSession('cap-user',false)).rejects.toMatchObject({ status:500 })
  expect((await usable()).map(row => row.session_id).sort()).toEqual(original)
  expect((await db.pool.query('SELECT id FROM refresh_tokens')).rows).toHaveLength(50)
})
