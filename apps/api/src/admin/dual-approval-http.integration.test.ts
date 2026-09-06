import { afterAll, beforeAll, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { startHttpFixture } from '../test/http-fixture.js'
let http: Awaited<ReturnType<typeof startHttpFixture>>
const headers: Record<string,Record<string,string>>={}
beforeAll(async()=>{
  if(!process.env.TEST_DATABASE_URL)throw new Error('PostgreSQL setup did not run')
  http=await startHttpFixture(process.env.TEST_DATABASE_URL)
  for(const [user,role] of [['initiator','role-finance'],['reviewer','role-finance'],['support','role-customer-support']]) {
    await http.pool.query('INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ($1,$2,$3,true)',[user,`${user}@example.test`,'test-only'])
    await http.pool.query('INSERT INTO user_roles(user_id,role_id) VALUES ($1,$2)',[user,role])
    const id=randomUUID(),csrf=randomUUID()
    await http.pool.query(`INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
      VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')`,[id,user,csrf,randomUUID()])
    headers[user!]={Cookie:`barghsa_session=${id}`,'X-CSRF-Token':csrf,'Content-Type':'application/json'}
  }
},40000)
afterAll(async()=>{await http?.close()})
async function seed(){return (await http.pool.query(`INSERT INTO approval_requests(action_type,amount_irr,initiator_id,reason)
  VALUES ('bank_payment_confirmation',100000,'initiator','Verified bank deposit') RETURNING id`)).rows[0].id as string}
async function decide(user:string,id:string,action='approve') {return fetch(`${http.base}/api/admin/approval-requests/${id}/${action}`,{method:'POST',headers:headers[user]!,body:JSON.stringify({reason:'Rejected after review'})})}
it('requires recent step-up for financial approval and rejection, preserving pending requests',async()=>{
  for(const action of ['approve','reject']) {
    const id=await seed()
    await http.pool.query("UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='reviewer'")
    const response=await decide('reviewer',id,action)
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({error:{code:'AUTHZ:STEP_UP_REQUIRED'}})
    await http.pool.query("UPDATE sessions SET step_up_verified_at=NOW()-INTERVAL '16 minutes' WHERE user_id='reviewer'")
    expect((await decide('reviewer',id,action)).status).toBe(403)
    expect((await http.pool.query('SELECT status FROM approval_requests WHERE id=$1',[id])).rows[0].status).toBe('pending')
    await http.pool.query("UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='reviewer'")
    expect((await decide('reviewer',id,action)).status).toBe(200)
    expect((await http.pool.query('SELECT status,reviewer_id FROM approval_requests WHERE id=$1',[id])).rows[0])
      .toEqual({status:action==='approve'?'approved':'rejected',reviewer_id:'reviewer'})
    expect((await decide('reviewer',id,action)).status).toBe(409)
  }
})
it('requires a different currently eligible reviewer even after step-up',async()=>{
  const id=await seed()
  await http.pool.query('UPDATE sessions SET step_up_verified_at=NOW()')
  expect((await decide('initiator',id)).status).toBe(403)
  expect((await decide('support',id)).status).toBe(403)
  await http.pool.query("DELETE FROM user_roles WHERE user_id='reviewer'")
  expect((await decide('reviewer',id)).status).toBe(403)
  expect((await http.pool.query('SELECT status FROM approval_requests WHERE id=$1',[id])).rows[0].status).toBe('pending')
})
it('requires step-up to initiate and permits queue reads without it',async()=>{
  await http.pool.query("UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='initiator'")
  expect((await fetch(`${http.base}/api/admin/approval-requests`,{headers:headers.initiator!})).status).toBe(200)
  const response=await fetch(`${http.base}/api/admin/approval-requests`,{method:'POST',headers:headers.initiator!,body:'{}'})
  expect(response.status).toBe(403)
  expect(await response.json()).toMatchObject({error:{code:'AUTHZ:STEP_UP_REQUIRED'}})
})
