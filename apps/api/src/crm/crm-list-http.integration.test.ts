import { beforeAll, afterAll, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { startHttpFixture } from '../test/http-fixture.js'
let http: Awaited<ReturnType<typeof startHttpFixture>>
let cookie: string
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!)
  await http.pool.query("INSERT INTO users(user_id,username,password_hash,is_admin) VALUES ('crm-admin','crm-admin@example.test','test-only',true)")
  const session = randomUUID()
  await http.pool.query(`INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
    VALUES ($1,'crm-admin',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')`, [session,randomUUID(),randomUUID()])
  cookie = `barghsa_session=${session}`
  for (let n=0;n<7;n++) {
    await http.pool.query(`INSERT INTO users(user_id,username,password_hash,created_at)
      VALUES ($1,$2,'test-only',$3::timestamptz)`, [`crm-page-${n}`,`crm-page-${n}@example.test`, `2026-08-01T10:00:00.${n<4?'000001':String(n).padStart(6,'0')}Z`])
    await http.pool.query(`INSERT INTO profiles(id,user_id,profile_type,status,first_name,last_name) VALUES ($1,$2,'INDIVIDUAL',$3,'Example','Family')`,[randomUUID(),`crm-page-${n}`,n===0?'PENDING_VERIFICATION':n===1?'SUSPENDED':n===2?'VERIFIED':'ACTIVE'])
  }
},40000)
afterAll(async()=>{ await http?.close() })
async function list(params: Record<string,string>) {
  return fetch(`${http.base}/api/crm/users?${new URLSearchParams(params)}`,{headers:{Cookie:cookie}})
}
for (const order of ['asc','desc']) it(`paginates text user IDs and microseconds without omissions (${order})`,async()=>{
  const seen: string[]=[]
  let cursor=''
  do {
    const response = await list({search:'crm-page-',order,limit:'2',...(cursor?{cursor}:{})})
    expect(response.status).toBe(200)
    const data=await response.json()
    seen.push(...data.users.map((user:{userId:string})=>user.userId))
    cursor=data.cursor??''
    expect(seen.length).toBeLessThanOrEqual(7)
  } while(cursor)
  expect(seen).toEqual(Array.from({length:7},(_,n)=>`crm-page-${order==='asc'?n:6-n}`))
})
it('uses actual profile states, supports surname search, and refuses invalid cursors/dates',async()=>{
  for(const [verification,id] of [['PENDING','crm-page-0'],['DISABLED','crm-page-1'],['VERIFIED','crm-page-2']]) {
    const response=await list({search:'Family',verification:verification!})
    expect(response.status).toBe(200)
    expect((await response.json()).users.map((user:{userId:string})=>user.userId)).toEqual([id])
  }
  expect((await list({cursor:'bad'})).status).toBe(400)
  expect((await list({dateFrom:'bad'})).status).toBe(400)
  expect((await list({dateFrom:'2026-09-01',dateTo:'2026-08-01'})).status).toBe(400)
})
