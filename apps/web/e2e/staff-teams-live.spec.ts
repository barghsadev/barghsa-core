import { test, expect } from '@playwright/test'
import { fork, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { setup as buildApi } from '../../api/src/test/build-http-app'
let child: ChildProcess
let http: {base:string;session:string;csrf:string}
test.beforeAll(async()=>{
  test.setTimeout(90000)
  buildApi()
  const require=createRequire(fileURLToPath(new URL('../../../packages/db/package.json',import.meta.url)))
  child=fork(require.resolve('tsx/cli'),[fileURLToPath(new URL('../../api/scripts/team-ui-fixture.ts',import.meta.url))],{silent:true})
  let logs=''
  for(const stream of [child.stdout,child.stderr])stream?.on('data',data=>{logs=(logs+String(data)).slice(-10000)})
  http=await new Promise((done,reject)=>{
    const timer=setTimeout(()=>reject(new Error(logs||'Fixture timeout')),60000)
    child.once('message',message=>{clearTimeout(timer);done(message as typeof http)})
    child.once('error',error=>{clearTimeout(timer);reject(error)})
    child.once('exit',()=>{clearTimeout(timer);reject(new Error(logs||'Fixture exited'))})
  })
})
test.afterAll(async()=>{
  if(child&&child.exitCode===null&&child.connected)await new Promise<void>(done=>{
    const timer=setTimeout(()=>child.kill('SIGTERM'),15000)
    child.once('exit',()=>{clearTimeout(timer);done()});child.send('stop')
  })
})

for(const locale of ['en','fa'])test(`team UI persists through the migrated API (${locale})`,async({page})=>{
  await page.addInitScript(value=>{new MutationObserver(()=>{if(document.documentElement)document.documentElement.lang=value}).observe(document,{childList:true})},locale)
  // Forward to the isolated API without mocking any application response.
  await page.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url())
    const response=await route.fetch({url:`${http.base}${url.pathname}${url.search}`,headers:{...request.headers(),
      host:new URL(http.base).host,origin:'https://app.example.test',cookie:`barghsa_session=${http.session}`,'x-csrf-token':http.csrf}})
    await route.fulfill({response})
  })
  const fa=locale==='fa',name=`Team live ${locale}`
  await page.goto('/admin/staff-teams')
  await page.getByLabel(fa?'نام تیم':'Team name',{exact:true}).fill(name)
  await page.getByLabel('Member UI',{exact:true}).check()
  await page.getByRole('button',{name:fa?'ذخیره تیم':'Save team',exact:true}).click()
  await page.getByRole('dialog').getByRole('button',{name:fa?'تأیید':'Confirm',exact:true}).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const apiHeaders={cookie:`barghsa_session=${http.session}`}
  const team=((await (await page.request.get(`${http.base}/api/admin/staff-teams`,{headers:apiHeaders})).json()) as Array<{id:string;name:string;memberUserIds:string[]}>).find(item=>item.name===name)!
  expect(team).toBeTruthy()
  expect(team.memberUserIds).toEqual(['team-ui-member'])
  await page.getByLabel(fa?'تیم مسئول':'Assigned team',{exact:true}).first().selectOption(team.id)
  await page.getByRole('button',{name:fa?'ذخیره قوانین تخصیص':'Save assignment rules',exact:true}).click()
  await page.getByRole('dialog').getByRole('button',{name:fa?'تأیید':'Confirm',exact:true}).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect((await (await page.request.get(`${http.base}/api/admin/config/assignment-rules`,{headers:apiHeaders})).json()).ticket.teamId).toBe(team.id)
  await page.reload()
  await expect(page.getByLabel(fa?'تیم مسئول':'Assigned team',{exact:true}).first()).toHaveValue(team.id)
  await page.getByRole('button',{name:fa?'ویرایش تیم':'Edit team',exact:true}).click()
  await page.getByLabel(fa?'نام تیم':'Team name',{exact:true}).fill(`${name} revised`)
  await page.getByRole('button',{name:fa?'ذخیره تیم':'Save team',exact:true}).click()
  await page.getByRole('dialog').getByRole('button',{name:fa?'تأیید':'Confirm',exact:true}).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('heading',{name:`${name} revised`,exact:true})).toBeVisible()
  await page.screenshot({path:`/tmp/barghsa-staff-teams-${locale}.png`,fullPage:true})
  await page.getByRole('button',{name:fa?'حذف تیم':'Delete team',exact:true}).click()
  await page.getByRole('dialog').getByRole('button',{name:fa?'تأیید':'Confirm',exact:true}).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(await (await page.request.get(`${http.base}/api/admin/staff-teams`,{headers:apiHeaders})).json()).toEqual([])
})
