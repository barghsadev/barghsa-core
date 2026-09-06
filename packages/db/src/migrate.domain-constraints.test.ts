import {beforeAll,afterAll,it,expect} from 'vitest'
import {randomUUID} from 'node:crypto'
import {readFileSync,mkdtempSync,mkdirSync,copyFileSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {Pool} from 'pg'
import {getTableConfig, PgTable} from 'drizzle-orm/pg-core'
import {is} from 'drizzle-orm'
import * as schema from './index'
import {runMigrations} from './migrate'

let management:Pool,pool:Pool
const name=`test_domain_constraints_${randomUUID().replaceAll('-','')}`
const ledger=JSON.parse(readFileSync(resolve(__dirname,'../../../audit/legacy-inline-constraints.json'),'utf8')) as Array<{table:string;name:string;definition:string;missingBeforeRepair:boolean}>
beforeAll(async()=>{
  management=new Pool({connectionString:process.env.TEST_DATABASE_URL})
  await management.query(`CREATE DATABASE "${name}"`)
  const url=new URL(process.env.TEST_DATABASE_URL!);url.pathname=`/${name}`
  expect((await runMigrations({connection:{pgdirectUrl:url.toString()}})).ok).toBe(true)
  pool=new Pool({connectionString:url.toString()})
  await pool.query("INSERT INTO users(user_id,username,password_hash) VALUES ('constraint-owner','constraint@example.test','test')")
},30000)
afterAll(async()=>{await pool?.end();if(management){await management.query(`DROP DATABASE IF EXISTS "${name}"`);await management.end()}})

it('retains every repaired constraint in the production catalog and every supported CHECK in the ORM schema',async()=>{
  const actual=(await pool.query(`SELECT t.relname AS "table",c.conname AS name FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid`)).rows
  const tables=Object.values(schema).filter(value=>is(value,PgTable)).map(table=>getTableConfig(table as PgTable))
  for(const entry of ledger.filter(entry=>entry.missingBeforeRepair)){
    expect(actual,`${entry.table}.${entry.name}`).toContainEqual({table:entry.table,name:entry.name})
    if(entry.definition.startsWith('CHECK'))expect(tables.find(table=>table.name===entry.table)?.checks.map(check=>check.name),entry.name).toContain(entry.name)
  }
})

it('rejects invalid notification/approval states and non-positive financial approvals',async()=>{
  await expect(pool.query("INSERT INTO notification_outbox(user_id,event_key,channels,idempotency_key,status) VALUES ('constraint-owner','test',ARRAY['in_app'],'invalid','invented')")).rejects.toMatchObject({code:'23514',constraint:'chk_ob_status'})
  await expect(pool.query("INSERT INTO background_jobs(job_type,attempts) VALUES ('test',0)")).rejects.toMatchObject({code:'23514',constraint:'chk_bj_attempts_ge_1'})
  await expect(pool.query("INSERT INTO approval_requests(action_type,amount_irr,initiator_id,reason) VALUES ('refund',0,'constraint-owner','test')")).rejects.toMatchObject({code:'23514',constraint:'chk_ar_amount_positive'})
  await expect(pool.query("INSERT INTO approval_requests(action_type,amount_irr,initiator_id,reason,status) VALUES ('refund',1,'constraint-owner','test','invented')")).rejects.toMatchObject({code:'23514',constraint:'chk_ar_status'})
})

it('validates upload extensions and prevents overlapping policy windows while allowing adjacent versions',async()=>{
  for(const extensions of [[],['pdf'],['.EXE'],[null],[['.pdf']],[Array(51).fill('.pdf')].flat()]){
    expect((await pool.query('SELECT barghsa_valid_upload_extensions($1::text[]) AS valid',[extensions])).rows[0].valid).toBe(false)
  }
  expect((await pool.query("SELECT barghsa_valid_upload_extensions(ARRAY['.pdf','.png']) AS valid")).rows[0].valid).toBe(true)
  const insert=(from:string,until:string|null)=>pool.query(`INSERT INTO upload_policies(category,allowed_extensions,max_size_bytes,effective_from,effective_until,created_by)
    VALUES ('document',ARRAY['.pdf'],1000,$1,$2,'constraint-owner')`,[from,until])
  await insert('2026-01-01','2026-02-01')
  await expect(insert('2026-01-15','2026-03-01')).rejects.toMatchObject({code:'23P01',constraint:'excl_upload_policies_no_overlap'})
  await insert('2026-02-01',null)
  const due=()=>pool.query(`INSERT INTO service_due_periods(service_type,default_days,effective_from,created_by)
    VALUES ('manual',7,'2026-01-01','constraint-owner')`)
  const results=await Promise.allSettled([due(),due()])
  expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1)
  expect(results.find(result=>result.status==='rejected')).toMatchObject({reason:{code:'23P01',constraint:'excl_service_due_periods_no_overlap'}})
})

it('blocks an upgrade with invalid historical data without deleting it, then retries after correction',async()=>{
  const database=`test_constraint_upgrade_${randomUUID().replaceAll('-','')}`
  const folder=mkdtempSync(resolve(tmpdir(),'barghsa-prior-migrations-'))
  const production=resolve(__dirname,'../drizzle/production')
  const journal=JSON.parse(readFileSync(resolve(production,'meta/_journal.json'),'utf8'))
  journal.entries=journal.entries.filter((entry:{tag:string})=>entry.tag<'0104_restore_inline_domain_constraints')
  mkdirSync(resolve(folder,'meta'))
  writeFileSync(resolve(folder,'meta/_journal.json'),JSON.stringify(journal))
  for(const entry of journal.entries)copyFileSync(resolve(production,`${entry.tag}.sql`),resolve(folder,`${entry.tag}.sql`))
  await management.query(`CREATE DATABASE "${database}"`)
  const url=new URL(process.env.TEST_DATABASE_URL!);url.pathname=`/${database}`
  const connection={pgdirectUrl:url.toString()},old=new Pool({connectionString:url.toString()})
  try {
    expect((await runMigrations({connection,migrationsFolder:folder})).ok).toBe(true)
    await old.query("INSERT INTO users(user_id,username,password_hash) VALUES ('legacy','legacy@example.test','test')")
    await old.query("INSERT INTO approval_requests(action_type,amount_irr,initiator_id,reason) VALUES ('refund',0,'legacy','historical')")
    expect((await runMigrations({connection})).ok).toBe(false)
    expect((await old.query('SELECT amount_irr::text AS amount FROM approval_requests')).rows).toEqual([{amount:'0'}])
    expect((await old.query("SELECT conname FROM pg_constraint WHERE conname='chk_ob_status'")).rows).toEqual([])
    await old.query('UPDATE approval_requests SET amount_irr=1')
    expect(await runMigrations({connection})).toEqual({ok:true,applied:['0104_restore_inline_domain_constraints']})
    expect(await runMigrations({connection})).toEqual({ok:true,applied:[]})
  } finally {await old.end();await management.query(`DROP DATABASE "${database}"`);rmSync(folder,{recursive:true,force:true})}
})
