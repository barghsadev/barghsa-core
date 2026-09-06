import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { startHttpFixture } from '../test/http-fixture.js'

let http: Awaited<ReturnType<typeof startHttpFixture>>
const headers: Record<string, Record<string, string>> = {}
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!)
  for (const user of ['staff', 'customer', 'disabled', 'inactive']) {
    await http.pool.query(`INSERT INTO users(user_id,username,password_hash,is_admin,disabled_at,activation_token)
      VALUES ($1,$2,'test-only',$3,$4,$5)`, [user, `${user}@example.test`, user !== 'customer',
      user === 'disabled' ? new Date() : null, user === 'inactive' ? 'pending-activation' : null])
    const id = randomUUID(), csrf = randomUUID()
    await http.pool.query(`INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
      VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')`, [id,user,csrf,randomUUID()])
    headers[user] = { Cookie: `barghsa_session=${id}`, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }
  }
}, 40000)
afterAll(async () => { await http?.close() })
async function ticket(status = 'open') {
  const id = randomUUID()
  await http.pool.query(`INSERT INTO tickets(id,user_id,subject,body,status)
    VALUES ($1,'customer','Help','A question',$2)`, [id,status])
  return id
}
function assign(id: string, assigneeId: unknown = 'staff', user = 'staff') {
  return fetch(`${http.base}/api/staff/tickets/${id}/assign`, {
    method: 'PUT', headers: headers[user]!, body: JSON.stringify({ assigneeId }),
  })
}
it('rejects unknown, customer, disabled and pending-activation assignees without changing the ticket', async () => {
  const id = await ticket()
  for (const target of ['missing', 'customer', 'disabled', 'inactive', '', { bad: true }]) {
    expect((await assign(id,target)).status, http.logs()).toBe(400)
  }
  expect((await assign(id,'staff','customer')).status).toBe(403)
  const row = (await http.pool.query('SELECT assigned_to,status FROM tickets WHERE id=$1',[id])).rows[0]
  expect(row).toEqual({ assigned_to: null, status: 'open' })
  expect((await http.pool.query("SELECT id FROM audit_log WHERE event='ticket_assigned' AND metadata::jsonb->>'ticketId'=$1",[id])).rows).toHaveLength(0)
})
it('assigns eligible staff, advances open tickets and preserves a resolved status', async () => {
  const open = await ticket(), resolved = await ticket('resolved')
  expect((await assign(open)).status).toBe(200)
  expect((await assign(resolved)).status).toBe(200)
  expect((await http.pool.query('SELECT status FROM tickets WHERE id=$1',[open])).rows[0].status).toBe('in_progress')
  expect((await http.pool.query('SELECT status FROM tickets WHERE id=$1',[resolved])).rows[0].status).toBe('resolved')
  expect((await assign(randomUUID())).status).toBe(404)
})
it('uses the current status after waiting on a concurrent ticket change', async () => {
  const id = await ticket(), client = await http.pool.connect()
  let response: Promise<Response> | undefined
  try {
    await client.query('BEGIN')
    await client.query("UPDATE tickets SET status='resolved' WHERE id=$1",[id])
    response = assign(id)
    // Wait for the actual assignment UPDATE to block on this transaction.
    const deadline = Date.now() + 5000
    let waiting = false
    while (Date.now() < deadline) {
      const active = await http.pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'UPDATE tickets SET assigned_to=%'")
      if (active.rows.length) { waiting = true; break }
      await new Promise(resolve => setTimeout(resolve,20))
    }
    expect(waiting).toBe(true)
    await client.query('COMMIT')
    expect((await response).status).toBe(200)
    const row = (await http.pool.query('SELECT assigned_to,status FROM tickets WHERE id=$1',[id])).rows[0]
    expect(row).toEqual({ assigned_to: 'staff', status: 'resolved' })
  } finally { await client.query('ROLLBACK'); client.release(); await response }
})
it('rolls back assignment when recording its audit fails', async () => {
  const id = await ticket()
  await http.pool.query(`CREATE FUNCTION fail_ticket_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.event='ticket_assigned' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_ticket_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_ticket_audit()`)
  try {
    expect((await assign(id)).status).toBe(500)
    const row = (await http.pool.query('SELECT assigned_to,status FROM tickets WHERE id=$1',[id])).rows[0]
    expect(row).toEqual({ assigned_to: null, status: 'open' })
  } finally { await http.pool.query('DROP TRIGGER fail_ticket_audit ON audit_log; DROP FUNCTION fail_ticket_audit()') }
  expect((await assign(id)).status).toBe(200)
})
