import {afterEach,beforeEach,expect,it} from 'vitest'
import {randomUUID} from 'node:crypto'
import {startHttpFixture} from '../test/http-fixture.js'
let http:Awaited<ReturnType<typeof startHttpFixture>>
let headers:Record<string,string>,owned:string,finance:string,legal:string,unrelated:string
beforeEach(async()=>{
 if(!process.env.TEST_DATABASE_URL)throw new Error('PostgreSQL setup did not run')
 http=await startHttpFixture(process.env.TEST_DATABASE_URL)
 for(const user of ['viewer','owner'])await http.pool.query('INSERT INTO users(user_id,username,password_hash) VALUES ($1,$2,$3)',[user,`${user}@example.test`,'test-only'])
 const session=randomUUID(),csrf=randomUUID()
 await http.pool.query(`INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
 VALUES ($1,'viewer',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')`,[session,csrf,randomUUID()])
 headers={Cookie:`barghsa_session=${session}`,'X-CSRF-Token':csrf,'Content-Type':'application/json'}
 owned=(await http.pool.query("INSERT INTO profiles(user_id,is_default,status) VALUES ('viewer',true,'ACTIVE') RETURNING id")).rows[0].id
 finance=(await http.pool.query("INSERT INTO profiles(user_id,profile_type,is_default,status) VALUES ('owner','LEGAL',true,'VERIFIED') RETURNING id")).rows[0].id
 legal=(await http.pool.query("INSERT INTO profiles(user_id,profile_type,status) VALUES ('owner','LEGAL','ACTIVE') RETURNING id")).rows[0].id
 unrelated=(await http.pool.query("INSERT INTO profiles(user_id,profile_type,status) VALUES ('owner','LEGAL','ACTIVE') RETURNING id")).rows[0].id
 await http.pool.query("INSERT INTO profile_agents(profile_id,user_id,role) VALUES ($1,'viewer','Finance'),($2,'viewer','Legal')",[finance,legal])
 for(const id of [owned,finance,legal])await http.pool.query("INSERT INTO in_app_notifications(profile_id,type,title_i18n_key,body_i18n_key) VALUES ($1,'profile_verified','test.title','test.body')",[id])
},40000)
afterEach(async()=>{await http?.close()},15000)
function request(path:string,method='GET',body?:unknown){return fetch(`${http.base}/api/${path}`,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})})}
it('lists selectable agent profiles and switches without changing another user default',async()=>{
 const list=await request('profiles'),body=await list.json() as {profiles:{id:string}[];activeProfileId:string}
 expect(body.activeProfileId).toBe(owned)
 expect(body.profiles.map(p=>p.id).sort()).toEqual([owned,finance,legal].sort())
 expect((await request(`profiles/switch/${unrelated}`,'POST')).status).toBe(404)
 expect((await request(`profiles/switch/${finance}`,'POST')).status).toBe(200)
 expect(await (await request('profiles')).json()).toMatchObject({activeProfileId:finance})
 expect((await http.pool.query('SELECT is_default FROM profiles WHERE id=$1',[finance])).rows[0].is_default).toBe(true)
 expect((await http.pool.query('SELECT is_default FROM profiles WHERE id=$1',[owned])).rows[0].is_default).toBe(true)
 expect(await (await request('profiles/verification-status')).json()).toMatchObject({activeProfileId:finance,isVerified:true})
 expect((await request('v1/notifications/read-all','PATCH')).status).toBe(200)
 expect((await http.pool.query('SELECT profile_id FROM in_app_notifications WHERE is_read')).rows).toEqual([{profile_id:finance}])
})
it('checks wallet capability separately from profile selection',async()=>{
 expect((await request(`profiles/switch/${legal}`,'POST')).status).toBe(200)
 expect((await request('invoices')).status).toBe(404)
 expect((await request(`wallet/${legal}/create`,'POST')).status).toBe(404)
 expect((await request(`wallet/${legal}/top-ups`,'POST',{})).status).toBe(404)
 expect((await request(`wallet/${legal}/bank-receipt-top-ups`,'POST',{})).status).toBe(404)
 expect((await request(`wallet/${finance}/create`,'POST')).status).toBeLessThan(300)
 await http.pool.query("UPDATE profile_agents SET role='Manager' WHERE profile_id=$1 AND user_id='viewer'",[finance])
 expect((await request(`profiles/switch/${finance}`,'POST')).status).toBe(200)
 expect((await request('invoices')).status).toBe(200)
 const receipt=await request(`invoices/${randomUUID()}/bank-receipts`,'POST',{amount:'1000',paymentDate:'2026-09-01',payerReference:'12345678',attachmentKey:'uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf'})
 expect(receipt.status,await receipt.text()).toBe(404)
 expect((await request(`wallet/${finance}`)).status).toBe(200)
 expect((await request(`wallet/${finance}/top-ups`,'POST',{})).status).toBe(404)
})
it('does not fall back to a different profile after membership removal or archiving',async()=>{
 expect((await request(`profiles/switch/${finance}`,'POST')).status).toBe(200)
 await http.pool.query("DELETE FROM profile_agents WHERE profile_id=$1 AND user_id='viewer'",[finance])
 expect(await (await request('profiles')).json()).toMatchObject({activeProfileId:null})
 expect(await (await request('v1/notifications/unread-count')).json()).toEqual({unread_count:0})
 expect((await request(`wallet/${finance}`)).status).toBe(404)
 expect((await request(`profiles/switch/${owned}`,'POST')).status).toBe(200)
 await http.pool.query('UPDATE profiles SET archived=true WHERE id=$1',[owned])
 expect(await (await request('profiles')).json()).toMatchObject({activeProfileId:null})
 expect(await (await request('v1/notifications/unread-count')).json()).toEqual({unread_count:0})
})
it('does not grant owner privileges from a stale Owner membership',async()=>{
 await http.pool.query("INSERT INTO profile_agents(profile_id,user_id,role) VALUES ($1,'viewer','Owner')",[unrelated])
 expect((await request(`profiles/switch/${unrelated}`,'POST')).status).toBe(404)
 expect((await request(`wallet/${unrelated}/create`,'POST')).status).toBe(404)
})
