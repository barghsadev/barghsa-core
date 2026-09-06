import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { startHttpFixture } from '../test/http-fixture.js'

let http: Awaited<ReturnType<typeof startHttpFixture>>
let storageServer: Server
const objects = new Map<string, Buffer>()
const headers: Record<string, Record<string, string>> = {}
beforeAll(async () => {
  storageServer = createServer(async (req,res) => {
    const key = decodeURIComponent(new URL(req.url!,'http://localhost').pathname).replace('/test-evidence/','')
    if (req.method === 'PUT') {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      objects.set(key,Buffer.concat(chunks));res.setHeader('ETag','"test"');res.end();return
    }
    const bytes = objects.get(key)
    if (!bytes) { res.statusCode=404;res.end();return }
    res.setHeader('Content-Length',bytes.length);res.setHeader('Content-Type','application/pdf');res.end(bytes)
  })
  await new Promise<void>(resolve => storageServer.listen(0,'127.0.0.1',resolve))
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!,`http://127.0.0.1:${(storageServer.address() as { port: number }).port}`)
  for (const user of ['staff', 'customer', 'disabled', 'inactive', 'assigned']) {
    await http.pool.query(`INSERT INTO users(user_id,username,password_hash,is_admin,disabled_at,activation_token)
      VALUES ($1,$2,'test-only',$3,$4,$5)`, [user, `${user}@example.test`, !['customer','assigned'].includes(user),
      user === 'disabled' ? new Date() : null, user === 'inactive' ? 'pending-activation' : null])
    const id = randomUUID(), csrf = randomUUID()
    await http.pool.query(`INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
      VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')`, [id,user,csrf,randomUUID()])
    headers[user] = { Cookie: `barghsa_session=${id}`, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }
  }
  await http.pool.query("INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ('test-assigned','Assigned support','Test role','[\"tickets:assigned\"]')")
  await http.pool.query("INSERT INTO user_roles(user_id,role_id) VALUES ('assigned','test-assigned')")
}, 40000)
// Each scenario has its own rate-limit budget in this disposable database.
beforeEach(async () => { await http.pool.query('DELETE FROM rate_limit_counters') })
afterAll(async () => { await http?.close(); await new Promise<void>(resolve => storageServer?.close(() => resolve())) })
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
function status(id: string, value: unknown, user = 'staff') {
  const path = user === 'staff' ? 'staff/tickets' : 'tickets'
  return fetch(`${http.base}/api/${path}/${id}/status`, { method: 'PATCH', headers: headers[user]!, body: JSON.stringify({ status: value }) })
}
function comment(id: string, body: unknown, visibility: unknown = 'public', user = 'staff') {
  const path = user === 'staff' ? 'staff/tickets' : 'tickets'
  return fetch(`${http.base}/api/${path}/${id}/comments`, { method: 'POST', headers: headers[user]!, body: JSON.stringify({ body, visibility }) })
}
it('enforces the support lifecycle, hides internal notes, and resumes work after a customer reply', async () => {
  const id = await ticket()
  expect((await status(id,'closed')).status).toBe(409)
  expect((await status(id,'in_progress')).status).toBe(409)
  expect((await assign(id)).status).toBe(200)
  expect((await comment(id,'Private staff reasoning','internal')).status).toBe(201)
  expect((await comment(id,'Please send the details')).status).toBe(201)
  expect((await status(id,'waiting_customer')).status).toBe(200)
  const customerNotes = await fetch(`${http.base}/api/tickets/${id}/comments`,{ headers: headers.customer! })
  expect(customerNotes.status).toBe(200)
  expect(await customerNotes.text()).not.toContain('Private staff reasoning')
  expect((await comment(id,'Trying an internal note','internal','customer')).status).toBe(403)
  expect((await comment(id,'Here are the details','public','customer')).status).toBe(201)
  expect((await http.pool.query('SELECT status FROM tickets WHERE id=$1',[id])).rows[0].status).toBe('in_progress')
  expect((await status(id,'waiting_staff')).status).toBe(200)
  expect((await status(id,'in_progress')).status).toBe(200)
  expect((await status(id,'resolved')).status).toBe(200)
  expect((await comment(id,'Requires reopening','public','customer')).status).toBe(409)
  expect((await status(id,'closed')).status).toBe(200)
  expect((await status(id,'open','customer')).status).toBe(200)
  expect((await status(id,'resolved','customer')).status).toBe(403)
  expect((await comment(id,{ bad: true })).status).toBe(400)
  expect((await comment(id,'text','secret')).status).toBe(400)
  expect((await status(id,{ bad: true })).status).toBe(400)
})
it('prevents access to another customer’s ticket and keeps customer endpoints public even for staff owners', async () => {
  const id = await ticket()
  await http.pool.query("UPDATE tickets SET user_id='staff' WHERE id=$1",[id])
  expect((await comment(id,'Private staff reasoning','internal')).status).toBe(201)
  expect((await comment(id,'Wrong owner','public','customer')).status).toBe(404)
  expect((await status(id,'open','customer')).status).toBe(404)
  const ownerResponse = await fetch(`${http.base}/api/tickets/${id}/comments`,{ headers: headers.staff! })
  expect(ownerResponse.status).toBe(200)
  expect(await ownerResponse.text()).not.toContain('Private staff reasoning')
})
it('rolls back comments and status changes when their audits fail, and serializes competing transitions', async () => {
  const id = await ticket()
  await assign(id)
  await http.pool.query(`CREATE FUNCTION fail_ticket_mutation_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.event IN ('ticket_comment_added','ticket_status_changed') THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_ticket_mutation_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_ticket_mutation_audit()`)
  try {
    expect((await status(id,'resolved')).status).toBe(500)
    expect((await comment(id,'Not committed')).status).toBe(500)
    expect((await http.pool.query('SELECT status FROM tickets WHERE id=$1',[id])).rows[0].status).toBe('in_progress')
    expect((await http.pool.query('SELECT id FROM ticket_comments WHERE ticket_id=$1',[id])).rows).toHaveLength(0)
  } finally { await http.pool.query('DROP TRIGGER fail_ticket_mutation_audit ON audit_log; DROP FUNCTION fail_ticket_mutation_audit()') }
  const responses = await Promise.all([status(id,'resolved'),status(id,'waiting_customer')])
  expect(responses.map(row=>row.status).sort()).toEqual([200,409])
  expect((await http.pool.query("SELECT id FROM audit_log WHERE event='ticket_status_changed' AND metadata::jsonb->>'ticketId'=$1",[id])).rows).toHaveLength(1)
})
function createTicket(body: unknown, user = 'customer') {
  return fetch(`${http.base}/api/tickets`,{method:'POST',headers:headers[user]!,body:JSON.stringify(body)})
}
it('validates creation fields and scopes profile and related invoice links to the owner', async () => {
  const own = randomUUID(), other = randomUUID(), invoice = randomUUID()
  await http.pool.query(`INSERT INTO profiles(id,user_id,profile_type,status) VALUES ($1,'customer','INDIVIDUAL','VERIFIED'),($2,'staff','INDIVIDUAL','VERIFIED')`,[own,other])
  await http.pool.query("INSERT INTO invoices(id,profile_id,order_id,total_amount) VALUES ($1,$2,NULL,100)",[invoice,own])
  const base = {subject:'A question',body:'Please help'}
  expect((await createTicket({...base,subject:{bad:true}})).status).toBe(400)
  expect((await createTicket({...base,priority:'urgent'})).status).toBe(400)
  expect((await createTicket({...base,profileId:other})).status).toBe(404)
  expect((await createTicket({...base,relatedEntityType:'invoice',relatedEntityId:invoice})).status).toBe(400)
  expect((await createTicket({...base,profileId:own,relatedEntityType:'invoice',relatedEntityId:randomUUID()})).status).toBe(404)
  const response = await createTicket({...base,profileId:own,relatedEntityType:'invoice',relatedEntityId:invoice})
  expect(response.status,http.logs()).toBe(201)
  expect(await response.json()).toMatchObject({profileId:own,relatedEntityId:invoice,attachments:[]})
  await http.pool.query('UPDATE profiles SET archived=true WHERE id=$1',[own])
  expect((await createTicket({...base,profileId:own})).status).toBe(404)
})
it('persists a fixed attachment copy and releases downloads only to the owner or staff', async () => {
  const key=`uploads/document/${randomUUID()}.pdf`, bytes=Buffer.from('%PDF-1.7\nOriginal support attachment\n%%EOF')
  objects.set(key,bytes)
  await http.pool.query(`INSERT INTO storage_records(storage_key,status,metadata,file_size,content_type,category,file_name)
    VALUES ($1,'active',$2::jsonb,$3,'application/pdf','document','help.pdf')`,[key,JSON.stringify({verified:true,uploadedBy:'staff',purpose:'ticket_attachment'}),bytes.length])
  expect((await createTicket({subject:'No access',body:'Another user file',attachments:[key]})).status).toBe(400)
  const response=await createTicket({subject:'Attachment',body:'Details',attachments:[key]},'staff')
  expect(response.status,http.logs()).toBe(201)
  const row=await response.json() as {id:string;attachments:string[]}
  expect(row.attachments[0]).toMatch(/^ticket-attachments\//)
  objects.set(key,Buffer.from('%PDF-1.7\nReplaced original'))
  expect((await fetch(`${http.base}/api/tickets/${row.id}`,{headers:headers.customer!})).status).toBe(404)
  const detail=await fetch(`${http.base}/api/tickets/${row.id}`,{headers:headers.staff!})
  expect(detail.status).toBe(200)
  const data=await detail.json() as {attachmentDownloadUrls:string[]}
  const url=new URL(data.attachmentDownloadUrls[0]!)
  expect(url.searchParams.get('X-Amz-Expires')).toBe('300')
  expect(await (await fetch(url)).text()).toContain('Original support attachment')
})
it('rolls back ticket creation when its audit fails and leaves existing tickets on the empty attachment default', async () => {
  const id=await ticket()
  expect((await http.pool.query('SELECT attachments FROM tickets WHERE id=$1',[id])).rows[0].attachments).toEqual([])
  await http.pool.query(`CREATE FUNCTION fail_ticket_create_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.event='ticket_created' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_ticket_create_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_ticket_create_audit()`)
  try {
    expect((await createTicket({subject:'Audit failure ticket',body:'Details'},'staff')).status).toBe(500)
    expect((await http.pool.query("SELECT id FROM tickets WHERE subject='Audit failure ticket'")).rows).toHaveLength(0)
  } finally {await http.pool.query('DROP TRIGGER fail_ticket_create_audit ON audit_log; DROP FUNCTION fail_ticket_create_audit()')}
  expect((await createTicket({subject:'Audit failure ticket',body:'Details'},'staff')).status).toBe(201)
})
it('limits assigned-only staff to their current tickets and refuses reassignment to another account', async () => {
  const mine=await ticket(), other=await ticket()
  expect((await assign(mine,'assigned')).status).toBe(200)
  const list=await fetch(`${http.base}/api/staff/tickets?assignedTo=staff`,{headers:headers.assigned!})
  expect(list.status).toBe(200)
  expect((await list.json() as {data:{id:string}[]}).data.map(row=>row.id)).toEqual([mine])
  const call=(id:string,suffix='',method='GET',body?:unknown)=>fetch(`${http.base}/api/staff/tickets/${id}${suffix}`,{
    method,headers:headers.assigned!,...(body ? {body:JSON.stringify(body)} : {}),
  })
  expect((await call(mine)).status).toBe(200)
  expect((await call(other)).status).toBe(404)
  expect((await call(other,'/comments')).status).toBe(404)
  expect((await call(other,'/comments','POST',{body:'Forbidden',visibility:'internal'})).status).toBe(404)
  expect((await call(other,'/status','PATCH',{status:'resolved'})).status).toBe(404)
  expect((await call(other,'/assign','PUT',{})).status).toBe(404)
  expect((await call(mine,'/assign','PUT',{assigneeId:'staff'})).status).toBe(403)
  expect((await call(mine,'/comments','POST',{body:'Own ticket note',visibility:'internal'})).status).toBe(201)
  expect((await call(mine,'/status','PATCH',{status:'waiting_customer'})).status).toBe(200)
  expect((await assign(mine,'staff')).status).toBe(200)
  expect((await call(mine,'/comments')).status).toBe(404)
  expect((await call(mine,'/comments','POST',{body:'Stale access'})).status).toBe(404)
})
it('rechecks assigned-only permission after waiting on a concurrent reassignment', async () => {
  const id=await ticket(),client=await http.pool.connect()
  await assign(id,'assigned')
  let response:Promise<Response>|undefined
  try {
    await client.query('BEGIN')
    await client.query("UPDATE tickets SET assigned_to='staff' WHERE id=$1",[id])
    response=fetch(`${http.base}/api/staff/tickets/${id}/comments`,{method:'POST',headers:headers.assigned!,body:JSON.stringify({body:'Stale private note',visibility:'internal'})})
    const deadline=Date.now()+5000
    let waiting=false
    while(Date.now()<deadline){
      const rows=await http.pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT * FROM tickets WHERE id=%'")
      if(rows.rows.length){waiting=true;break}
      await new Promise(resolve=>setTimeout(resolve,20))
    }
    expect(waiting).toBe(true)
    await client.query('COMMIT')
    expect((await response).status).toBe(404)
    expect((await http.pool.query('SELECT id FROM ticket_comments WHERE ticket_id=$1',[id])).rows).toHaveLength(0)
  } finally {await client.query('ROLLBACK');client.release();await response}
})
it('offers only owned profiles and exposes eligible assignees only to full ticket managers', async () => {
  const response=await fetch(`${http.base}/api/tickets/options`,{headers:headers.customer!})
  expect(response.status).toBe(200)
  const options=await response.json() as {profiles:{id:string}[]}
  const foreign=randomUUID()
  await http.pool.query("INSERT INTO profiles(id,user_id,profile_type,status) VALUES ($1,'staff','INDIVIDUAL','VERIFIED')",[foreign])
  expect(options.profiles.map(profile=>profile.id)).not.toContain(foreign)
  expect((await fetch(`${http.base}/api/tickets/options?profileId=${foreign}`,{headers:headers.customer!})).status).toBe(404)
  expect((await fetch(`${http.base}/api/staff/tickets/assignees`,{headers:headers.assigned!})).status).toBe(403)
  const staff=await fetch(`${http.base}/api/staff/tickets/assignees`,{headers:headers.staff!})
  expect(staff.status).toBe(200)
  const assignees=await staff.json() as {id:string;name:string}[]
  expect(assignees.map(person=>person.id).sort()).toEqual(['assigned','staff'])
  expect(assignees.every(person=>Object.keys(person).sort().join(',')==='id,name')).toBe(true)
})
it('paginates older related records without exposing another profile',async()=>{
  const profile=randomUUID()
  await http.pool.query("INSERT INTO profiles(id,user_id,profile_type,status) VALUES ($1,'customer','INDIVIDUAL','VERIFIED')",[profile])
  await http.pool.query('INSERT INTO invoices(profile_id,order_id,total_amount) SELECT $1,NULL,100 FROM generate_series(1,25)',[profile])
  const get=(page:number)=>fetch(`${http.base}/api/tickets/options?profileId=${profile}&recordPage=${page}`,{headers:headers.customer!})
  const first=await (await get(1)).json() as {records:{id:string}[];hasMoreRecords:boolean}
  const second=await (await get(2)).json() as {records:{id:string}[];hasMoreRecords:boolean}
  expect(first.records).toHaveLength(20);expect(first.hasMoreRecords).toBe(true)
  expect(second.records).toHaveLength(5);expect(second.hasMoreRecords).toBe(false)
  expect(new Set([...first.records,...second.records].map(row=>row.id)).size).toBe(25)
  expect((await get(1.5)).status).toBe(400)
})
it('keeps ticket notices private, bilingual and free of internal conversation text',async()=>{
  const id=await ticket()
  await assign(id,'assigned')
  await http.pool.query("DELETE FROM in_app_notifications WHERE link_route LIKE '%'||$1||'%'",[id])
  expect((await comment(id,'Confidential internal detail','internal')).status).toBe(201)
  const internal=(await http.pool.query("SELECT recipient_user_id,localized_content,link_route FROM in_app_notifications WHERE link_route LIKE '%'||$1||'%'",[id])).rows
  expect(internal).toHaveLength(1)
  expect(internal[0].recipient_user_id).toBe('assigned')
  expect(internal[0].link_route).toBe(`/admin/tickets?ticketId=${id}`)
  expect(JSON.stringify(internal)).not.toContain('Confidential internal detail')
  expect(internal[0].localized_content.en.title).toBe('New internal ticket note')
  expect(internal[0].localized_content.fa.title).not.toBe(internal[0].localized_content.en.title)
  expect((await comment(id,'Public solution','public')).status).toBe(201)
  const customer=(await http.pool.query("SELECT recipient_user_id,localized_content,link_route FROM in_app_notifications WHERE recipient_user_id='customer' AND link_route LIKE '%'||$1||'%'",[id])).rows
  expect(customer).toHaveLength(1)
  expect(customer[0].link_route).toBe(`/tickets?ticketId=${id}`)
  expect(customer[0].localized_content.en.title).toBe('New ticket reply')
  await http.pool.query("DELETE FROM user_roles WHERE user_id='assigned'")
  try {
    expect((await comment(id,'Customer update','public','customer')).status).toBe(201)
    expect((await http.pool.query("SELECT id FROM in_app_notifications WHERE recipient_user_id='assigned' AND link_route LIKE '%'||$1||'%'",[id])).rows).toHaveLength(2)
  } finally {await http.pool.query("INSERT INTO user_roles(user_id,role_id) VALUES ('assigned','test-assigned')")}
})
it('rolls back a reply and its audit when its private notification cannot be saved',async()=>{
  const id=await ticket()
  await assign(id)
  await http.pool.query(`CREATE FUNCTION fail_ticket_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.link_route LIKE '%ticketId=%' THEN RAISE EXCEPTION 'test notice failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_ticket_notice BEFORE INSERT ON in_app_notifications FOR EACH ROW EXECUTE FUNCTION fail_ticket_notice()`)
  try {
    expect((await comment(id,'Not saved')).status).toBe(500)
    expect((await http.pool.query('SELECT id FROM ticket_comments WHERE ticket_id=$1',[id])).rows).toHaveLength(0)
    expect((await http.pool.query("SELECT id FROM audit_log WHERE event='ticket_comment_added' AND metadata::jsonb->>'ticketId'=$1",[id])).rows).toHaveLength(0)
  } finally {await http.pool.query('DROP TRIGGER fail_ticket_notice ON in_app_notifications; DROP FUNCTION fail_ticket_notice()')}
  expect((await comment(id,'Saved on retry')).status).toBe(201)
})
it('records team assignment, rejects non-members and disabled teams, and clears team attribution on direct assignment',async()=>{
  const id=await ticket(),team=randomUUID()
  await http.pool.query('INSERT INTO staff_teams(id,name) VALUES ($1,$2)',[team,`Team ${team}`])
  await http.pool.query("INSERT INTO staff_team_members(team_id,user_id) VALUES ($1,'assigned')",[team])
  const send=(assigneeId:string)=>fetch(`${http.base}/api/staff/tickets/${id}/assign`,{method:'PUT',headers:headers.staff!,body:JSON.stringify({assigneeId,teamId:team})})
  expect((await send('staff')).status).toBe(409)
  expect((await send('assigned')).status).toBe(200)
  expect((await http.pool.query('SELECT assigned_team_id,assigned_to FROM tickets WHERE id=$1',[id])).rows[0]).toEqual({assigned_team_id:team,assigned_to:'assigned'})
  await http.pool.query('UPDATE staff_teams SET is_active=false WHERE id=$1',[team])
  expect((await send('assigned')).status).toBe(404)
  expect((await assign(id,'staff')).status).toBe(200)
  expect((await http.pool.query('SELECT assigned_team_id FROM tickets WHERE id=$1',[id])).rows[0].assigned_team_id).toBeNull()
})
it('rechecks team membership after waiting for a team edit to commit',async()=>{
  const id=await ticket(),team=randomUUID(),client=await http.pool.connect()
  await http.pool.query('INSERT INTO staff_teams(id,name) VALUES ($1,$2)',[team,`Team ${team}`])
  await http.pool.query("INSERT INTO staff_team_members(team_id,user_id) VALUES ($1,'assigned')",[team])
  let response:Promise<Response>|undefined
  try {
    await client.query('BEGIN')
    await client.query('SELECT id FROM staff_teams WHERE id=$1 FOR UPDATE',[team])
    await client.query('DELETE FROM staff_team_members WHERE team_id=$1',[team])
    response=fetch(`${http.base}/api/staff/tickets/${id}/assign`,{method:'PUT',headers:headers.staff!,body:JSON.stringify({assigneeId:'assigned',teamId:team})})
    const deadline=Date.now()+5000
    let waiting=false
    while(Date.now()<deadline){
      const rows=await http.pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM staff_teams WHERE id=%'")
      if(rows.rows.length){waiting=true;break}
      await new Promise(resolve=>setTimeout(resolve,20))
    }
    expect(waiting).toBe(true)
    await client.query('COMMIT')
    expect((await response).status).toBe(409)
    expect((await http.pool.query('SELECT assigned_to FROM tickets WHERE id=$1',[id])).rows[0].assigned_to).toBeNull()
  } finally {await client.query('ROLLBACK');client.release();await response}
})
it('reads configured response targets only into the staff queue',async()=>{
  await http.pool.query(`INSERT INTO app_config(key,value) VALUES ('admin.service_response_targets','{"ticket":2}')
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`)
  const staff=await fetch(`${http.base}/api/staff/tickets`,{headers:headers.staff!})
  expect((await staff.json() as {responseTargetHours:number}).responseTargetHours).toBe(2)
  const customer=await fetch(`${http.base}/api/tickets`,{headers:headers.customer!})
  expect(await customer.json()).not.toHaveProperty('responseTargetHours')
})
