import { beforeAll,afterAll,it,expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { startHttpFixture } from '../test/http-fixture.js'
let http: Awaited<ReturnType<typeof startHttpFixture>>
const headers:Record<string,Record<string,string>>={}
beforeAll(async()=>{
  http=await startHttpFixture(process.env.TEST_DATABASE_URL!)
  for(const user of ['creator','reviewer']) {
    await http.pool.query("INSERT INTO users(user_id,username,password_hash,is_admin) VALUES ($1,$2,'test-only',true)",[user,`${user}@example.test`])
    const id=randomUUID(),csrf=randomUUID()
    await http.pool.query(`INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
      VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,[id,user,csrf,randomUUID()])
    headers[user]={Cookie:`barghsa_session=${id}`,'X-CSRF-Token':csrf,'Content-Type':'application/json'}
  }
},40000)
afterAll(async()=>{await http?.close()})
async function profile() {
  const id=randomUUID()
  await http.pool.query("INSERT INTO profiles(id,user_id,profile_type,status,first_name) VALUES ($1,'creator','INDIVIDUAL','VERIFIED','Original')",[id])
  return id
}
async function create(id:string,extra:Record<string,unknown>={}) {return fetch(`${http.base}/api/crm/profiles/${id}/verification-cases`,{method:'POST',headers:headers.creator!,body:JSON.stringify({fieldName:'first_name',currentValue:'Forged old value',requestedValue:'Corrected',reason:'Document checked',...extra})})}
async function review(id:string,decision:string,user='reviewer') {return fetch(`${http.base}/api/crm/verification-cases/${id}/status`,{method:'PUT',headers:headers[user]!,body:JSON.stringify({decision,reviewerNotes:'Evidence checked'})})}
it('serializes creation, records the actual original value and prevents creator review',async()=>{
  const target=await profile()
  const results=await Promise.all(Array.from({length:5},()=>create(target)))
  expect(results.map(response=>response.status).sort()).toEqual([201,409,409,409,409])
  const row=(await http.pool.query('SELECT * FROM verification_cases WHERE profile_id=$1',[target])).rows[0]
  expect(row.current_value).toBe('Original')
  expect((await review(row.id,'Under Review','creator')).status).toBe(403)
  expect((await review(row.id,'Under Review')).status).toBe(200)
  expect((await create(target)).status).toBe(409)
  const decisions=await Promise.all(Array.from({length:5},()=>review(row.id,'Approved')))
  expect(decisions.map(response=>response.status).sort()).toEqual([200,409,409,409,409])
  expect((await http.pool.query('SELECT first_name FROM profiles WHERE id=$1',[target])).rows[0].first_name).toBe('Corrected')
  expect((await http.pool.query("SELECT id FROM audit_log WHERE event='verification_case_reviewed' AND metadata::jsonb->>'caseId'=$1 AND metadata::jsonb->>'decision'='Approved'",[row.id])).rows).toHaveLength(1)
})
it('rejects stale evidence, archived targets, invalid fields and malformed payloads',async()=>{
  const target=await profile()
  expect((await create(target,{fieldName:'email'})).status).toBe(400)
  expect((await create(target,{fieldName:'national_id',requestedValue:'0000000000'})).status).toBe(400)
  expect((await create(target,{requestedValue:{bad:true}})).status).toBe(400)
  const created=await create(target), data=await created.json() as {id:string}
  expect(created.status).toBe(201)
  expect((await review(data.id,'Under Review')).status).toBe(200)
  await http.pool.query("UPDATE profiles SET first_name='Changed after request' WHERE id=$1",[target])
  expect((await review(data.id,'Approved')).status).toBe(409)
  await http.pool.query('UPDATE profiles SET archived=true WHERE id=$1',[target])
  expect((await review(data.id,'Approved')).status).toBe(404)
  expect((await create(target)).status).toBe(404)
})
it('rolls back the identity change when its review audit fails',async()=>{
  const target=await profile(), created=await create(target), data=await created.json() as {id:string}
  expect((await review(data.id,'Under Review')).status).toBe(200)
  await http.pool.query(`CREATE FUNCTION fail_correction_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.event='verification_case_reviewed' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_correction_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_correction_audit()`)
  try {
    expect((await review(data.id,'Approved')).status).toBe(500)
    expect((await http.pool.query('SELECT first_name FROM profiles WHERE id=$1',[target])).rows[0].first_name).toBe('Original')
    expect((await http.pool.query('SELECT status FROM verification_cases WHERE id=$1',[data.id])).rows[0].status).toBe('Under Review')
  } finally { await http.pool.query('DROP TRIGGER fail_correction_audit ON audit_log; DROP FUNCTION fail_correction_audit()') }
  expect((await review(data.id,'Approved')).status).toBe(200)
})
it('requires step-up for creation and review',async()=>{
  const target=await profile(), created=await create(target), data=await created.json() as {id:string}
  await http.pool.query('UPDATE sessions SET step_up_verified_at=NULL')
  try {
    expect((await create(target)).status).toBe(403)
    expect((await review(data.id,'Under Review')).status).toBe(403)
  } finally {await http.pool.query('UPDATE sessions SET step_up_verified_at=NOW()')}
})
