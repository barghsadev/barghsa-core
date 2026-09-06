import { beforeEach, afterEach, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { startHttpFixture } from '../test/http-fixture.js'
let http: Awaited<ReturnType<typeof startHttpFixture>>
let profileId: string
let headers: Record<string,string>
beforeEach(async()=>{
  if(!process.env.TEST_DATABASE_URL)throw new Error('PostgreSQL setup did not run')
  http=await startHttpFixture(process.env.TEST_DATABASE_URL)
  await http.pool.query(`INSERT INTO users(user_id,username,email,mobile,password_hash,is_staff) VALUES
    ('contact-owner','owner@example.test','owner@example.test','+989121111111','account-password-hash',false),
    ('contact-staff','staff@example.test',NULL,NULL,'test-only',true)`)
  await http.pool.query("INSERT INTO user_roles(user_id,role_id) VALUES ('contact-staff','role-crm-verification')")
  const session=randomUUID(),csrf=randomUUID()
  await http.pool.query(`INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
    VALUES ($1,'contact-staff',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,[session,csrf,randomUUID()])
  headers={Cookie:`barghsa_session=${session}`,'X-CSRF-Token':csrf,'Content-Type':'application/json'}
  profileId=(await http.pool.query(`INSERT INTO profiles(user_id,title,status,contact_email,contact_mobile)
    VALUES ('contact-owner','Original','ACTIVE','original@example.test','+989122222222') RETURNING id`)).rows[0].id
},40000)
afterEach(async()=>{await http?.close()},15000)
const edit=(body:unknown,id=profileId)=>fetch(`${http.base}/api/crm/profiles/${id}`,{method:'PUT',headers,body:JSON.stringify(body)})
const read=async()=> (await http.pool.query('SELECT title,contact_email,contact_mobile FROM profiles WHERE id=$1',[profileId])).rows[0]

it('edits only profile contacts, normalizes values, preserves account credentials and isolates sibling profiles',async()=>{
  const accountBefore=(await http.pool.query("SELECT * FROM users WHERE user_id='contact-owner'")).rows[0]
  const sibling=(await http.pool.query("INSERT INTO profiles(user_id,contact_email) VALUES ('contact-owner','sibling@example.test') RETURNING id")).rows[0].id
  const response=await edit({title:'Updated',email:'  CONTACT@EXAMPLE.TEST ',mobile:'09123334444'})
  expect(response.status,await response.clone().text()).toBe(200)
  expect(await response.json()).toMatchObject({profile:{title:'Updated',contactEmail:'contact@example.test',contactMobile:'+989123334444'},user:{username:'owner@example.test',email:'owner@example.test',mobile:'+989121111111'}})
  expect((await http.pool.query("SELECT * FROM users WHERE user_id='contact-owner'")).rows[0]).toEqual(accountBefore)
  expect((await http.pool.query('SELECT contact_email FROM profiles WHERE id=$1',[sibling])).rows[0].contact_email).toBe('sibling@example.test')
  const detail=await fetch(`${http.base}/api/crm/profiles/${profileId}`,{headers})
  expect(detail.status).toBe(200)
  expect(await detail.json()).toMatchObject({profile:{contactEmail:'contact@example.test'},user:{email:'owner@example.test'}})
  expect((await edit({email:null,mobile:''})).status).toBe(200)
  expect(await read()).toMatchObject({contact_email:null,contact_mobile:null})
})

it('validates contact and identity fields and treats no-op edits as successful without an audit',async()=>{
  for(const body of [{email:'invalid'},{mobile:'1234'},{title:'x'.repeat(257)},{username:'attacker@example.test'},{nationalId:'0012345678'}]) {
    expect((await edit(body)).status).toBe(400)
  }
  expect((await edit({},'invalid-id')).status).toBe(400)
  expect((await edit({},randomUUID())).status).toBe(404)
  expect((await edit({title:'Original',email:'original@example.test',mobile:'+989122222222'})).status).toBe(200)
  expect((await http.pool.query("SELECT count(*)::int AS count FROM audit_log WHERE event='profile_updated'")).rows[0].count).toBe(0)
  await http.pool.query("DELETE FROM user_roles WHERE user_id='contact-staff'")
  expect((await edit({title:'Forbidden'})).status).toBe(403)
})

it('rolls back profile edits when their audit write fails',async()=>{
  await http.pool.query(`CREATE FUNCTION reject_contact_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.event='profile_updated' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_contact_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_contact_audit()`)
  expect((await edit({title:'Failed',email:'failed@example.test'})).status).toBe(500)
  expect(await read()).toEqual({title:'Original',contact_email:'original@example.test',contact_mobile:'+989122222222'})
  await http.pool.query('DROP TRIGGER reject_contact_audit ON audit_log')
  expect((await edit({title:'Retried'})).status).toBe(200)
})

for(const archive of [false,true])it(`locks the current profile before editing or auditing (archive=${archive})`,async()=>{
  const client=await http.pool.connect()
  let updating:Promise<Response>|undefined
  try {
    await client.query('BEGIN')
    await client.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE',[profileId])
    updating=edit({email:'latest@example.test'})
    await expect.poll(async()=>Number((await http.pool.query(`SELECT count(*) AS count FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM profiles WHERE id=$1 FOR UPDATE%'`)).rows[0].count)).toBe(1)
    await client.query('UPDATE profiles SET contact_email=$1,archived=$2 WHERE id=$3',['intervening@example.test',archive,profileId])
    await client.query('COMMIT')
    expect((await updating).status).toBe(archive?409:200)
    const audits=(await http.pool.query("SELECT metadata::jsonb AS metadata FROM audit_log WHERE event='profile_updated'")).rows
    if(archive) {expect(audits).toHaveLength(0);expect((await read()).contact_email).toBe('intervening@example.test')}
    else {expect(audits).toHaveLength(1);expect(audits[0].metadata).toMatchObject({scope:'profile_contact',before:{email:'intervening@example.test'},after:{email:'latest@example.test'}})}
  } finally {await client.query('ROLLBACK');client.release();await updating}
},15000)
