import { afterEach, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { startHttpFixture } from '../test/http-fixture.js'

let http: Awaited<ReturnType<typeof startHttpFixture>> | undefined
afterEach(async()=>{await http?.close()},15000)
async function post(username:string,ip:string) {
  return fetch(`${http!.base}/api/auth/forgot-password`,{
    method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-For':ip},body:JSON.stringify({username}),
  })
}
for(const trusted of [false,true]) {
  it(`uses forwarded clients only with explicit proxy trust (${trusted})`,async()=>{
    if(!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run')
    http=await startHttpFixture(process.env.TEST_DATABASE_URL,undefined,trusted?'127.0.0.1':'')
    for(const [index,ip] of ['198.51.100.1','198.51.100.2'].entries()) {
      expect((await post(`unknown-${index}@example.test`,ip)).status).toBe(200)
    }
    const rows=(await http.pool.query("SELECT key,count FROM security_rate_limit_counters WHERE key LIKE 'forgot-password:ip:%' ORDER BY key")).rows
    expect(rows).toEqual(trusted?[
      {key:'forgot-password:ip:198.51.100.1',count:1},{key:'forgot-password:ip:198.51.100.2',count:1},
    ]:[{key:'forgot-password:ip:127.0.0.1',count:2}])
    // Destination quota is independent of the forwarded client address.
    const username='quota@example.test'
    await http.pool.query(`INSERT INTO security_rate_limit_counters(key,window_start,window_ms,count)
      VALUES ($1,$2,3600000,5)`,['password-reset:destination:'+createHash('sha256').update(username).digest('hex'),Math.floor(Date.now()/3600000)*3600000])
    expect((await post(username,'198.51.100.3')).status).toBe(429)
    expect((await post(username,'198.51.100.4')).status).toBe(429)
  },40000)
}
