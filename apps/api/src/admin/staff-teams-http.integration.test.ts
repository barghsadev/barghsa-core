import {randomUUID} from 'node:crypto'
import {beforeAll,afterAll,it,expect} from 'vitest'
import {startHttpFixture} from '../test/http-fixture.js'
let http:Awaited<ReturnType<typeof startHttpFixture>>
const headers:Record<string,Record<string,string>>={}
beforeAll(async()=>{
  http=await startHttpFixture(process.env.TEST_DATABASE_URL!)
  for(const user of ['admin','customer','member','disabled']){
    await http.pool.query(`INSERT INTO users(user_id,username,password_hash,is_admin,is_staff,disabled_at)
      VALUES ($1,$2,'test-only',$3,$4,$5)`,[user,`${user}@example.test`,user==='admin',user!=='customer',user==='disabled'?new Date():null])
    const session=randomUUID(),csrf=randomUUID()
    await http.pool.query(`INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
      VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,[session,user,csrf,randomUUID()])
    headers[user]={Cookie:`barghsa_session=${session}`,'X-CSRF-Token':csrf,'Content-Type':'application/json'}
  }
},40000)
afterAll(async()=>{await http?.close()})
function call(path:string,method='GET',body?:unknown,user='admin'){
  return fetch(`${http.base}/api/admin/${path}`,{method,headers:headers[user]!,...(body!==undefined?{body:JSON.stringify(body)}:{})})
}
async function team(){
  const response=await call('staff-teams','POST',{name:`Team ${randomUUID()}`,memberUserIds:['member'],skillTags:['billing']})
  expect(response.status,http.logs()).toBe(201)
  return await response.json() as {id:string;name:string}
}
it('requires current capability and password confirmation for every team/rule mutation',async()=>{
  const created=await team()
  await http.pool.query("UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='admin'")
  try {
    for(const [path,method,body] of [
      ['staff-teams','POST',{name:'Forbidden'}],
      [`staff-teams/${created.id}`,'PUT',{name:'Forbidden'}],
      [`staff-teams/${created.id}`,'DELETE',undefined],
      ['config/assignment-rules','PUT',{ticket:{teamId:created.id,strategy:'load'}}],
    ] as const){expect((await call(path,method,body)).status).toBe(403)}
  } finally{await http.pool.query("UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='admin'")}
  expect((await call('staff-teams','POST',{name:'Forbidden'},'customer')).status).toBe(403)
  expect((await call('staff-teams')).status).toBe(200)
})
it('rejects customer/disabled members, malformed updates and invalid routing teams',async()=>{
  for(const member of ['customer','disabled','missing']){
    expect((await call('staff-teams','POST',{name:`Bad ${member}`,memberUserIds:[member]})).status).toBe(400)
  }
  const created=await team()
  expect((await call(`staff-teams/${created.id}`,'PUT',[])).status).toBe(400)
  expect((await call('staff-teams/not-an-id','DELETE')).status).toBe(400)
  for(const teamId of ['not-an-id',randomUUID()]){
    expect((await call('config/assignment-rules','PUT',{ticket:{teamId,strategy:'round_robin'}})).status).toBe(400)
  }
  await http.pool.query('UPDATE staff_teams SET is_active=false WHERE id=$1',[created.id])
  expect((await call('config/assignment-rules','PUT',{ticket:{teamId:created.id,strategy:'load'}})).status).toBe(400)
})
it('serializes the first concurrent routing-rule writes and records the actual previous version',async()=>{
  const created=await team()
  await http.pool.query("DELETE FROM app_config WHERE key='admin.staff_assignment_rules'")
  const results=await Promise.all(Array.from({length:5},()=>call('config/assignment-rules','PUT',{ticket:{teamId:created.id,strategy:'round_robin'}})))
  expect(results.map(response=>response.status),http.logs()).toEqual([200,200,200,200,200])
  expect((await http.pool.query("SELECT version FROM app_config WHERE key='admin.staff_assignment_rules'")).rows[0].version).toBe(5)
  const audits=(await http.pool.query("SELECT metadata::jsonb AS metadata FROM audit_log WHERE event='config_change' AND metadata::jsonb->>'key'='admin.staff_assignment_rules' ORDER BY (metadata::jsonb->>'version')::int")).rows
  expect(audits.map(row=>row.metadata.previousVersion)).toEqual([0,1,2,3,4])
  expect(audits.map(row=>row.metadata.version)).toEqual([1,2,3,4,5])
})
it('preserves team membership when its audit fails and permits a successful retry',async()=>{
  const created=await team()
  await http.pool.query(`CREATE FUNCTION fail_team_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.event='team_update' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_team_update BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_team_update()`)
  try{
    expect((await call(`staff-teams/${created.id}`,'PUT',{name:'Changed',memberUserIds:[]})).status).toBe(500)
    expect((await http.pool.query('SELECT name FROM staff_teams WHERE id=$1',[created.id])).rows[0].name).toBe(created.name)
    expect((await http.pool.query('SELECT user_id FROM staff_team_members WHERE team_id=$1',[created.id])).rows).toEqual([{user_id:'member'}])
  }finally{await http.pool.query('DROP TRIGGER fail_team_update ON audit_log; DROP FUNCTION fail_team_update()')}
  expect((await call(`staff-teams/${created.id}`,'PUT',{name:'Changed',memberUserIds:[]})).status).toBe(200)
  expect((await call(`staff-teams/${created.id}`,'DELETE')).status).toBe(200)
  expect((await http.pool.query('SELECT id FROM staff_teams WHERE id=$1',[created.id])).rows).toHaveLength(0)
})

it('searches eligible members and retains named existing members after disablement',async()=>{
  const created=await team()
  expect((await call('staff-teams/members', 'GET',undefined,'customer')).status).toBe(403)
  expect((await call('staff-teams/members?teamId=bad')).status).toBe(400)
  const response=await call(`staff-teams/members?q=member&teamId=${created.id}`)
  expect(await response.json()).toMatchObject({items:[{id:'member',name:'member@example.test'}],hasMore:false,selected:[{id:'member',eligible:true}]})
  await http.pool.query("UPDATE users SET disabled_at=NOW() WHERE user_id='member'")
  try {
    const data=await (await call(`staff-teams/members?q=member&teamId=${created.id}`)).json() as {items:unknown[];selected:unknown[]}
    expect(data.items).toEqual([])
    expect(data.selected).toEqual([{id:'member',name:'member@example.test',eligible:false}])
  } finally { await http.pool.query("UPDATE users SET disabled_at=NULL WHERE user_id='member'") }
})

it('requires a current team member as lead, preserves it on partial updates and clears it explicitly',async()=>{
  const response=await call('staff-teams','POST',{name:'Lead team',memberUserIds:['member'],leadUserId:'member'})
  expect(response.status).toBe(201)
  const created=await response.json() as {id:string;leadUserId:string}
  expect(created.leadUserId).toBe('member')
  expect((await call('staff-teams','POST',{name:'Lead team'})).status).toBe(409)
  expect((await call('staff-teams','POST',{name:'Invalid lead',memberUserIds:['member'],leadUserId:'admin'})).status).toBe(400)
  expect(await (await call(`staff-teams/${created.id}`,'PUT',{name:'Lead renamed'})).json()).toMatchObject({leadUserId:'member'})
  expect((await call(`staff-teams/${created.id}`,'PUT',{memberUserIds:[]})).status).toBe(400)
  expect((await call(`staff-teams/${created.id}`,'PUT',{memberUserIds:[],leadUserId:null})).status).toBe(200)
  expect((await http.pool.query('SELECT lead_user_id FROM staff_teams WHERE id=$1',[created.id])).rows[0].lead_user_id).toBeNull()
})
