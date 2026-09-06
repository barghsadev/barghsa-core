import { test, expect } from '@playwright/test'
const id='11111111-1111-4111-8111-111111111111'
function detail(targetAdmin:boolean,allowed:boolean) {return {
  profile:{id,profileType:'INDIVIDUAL',status:'ACTIVE',title:'Customer profile',firstName:'Example',lastName:'Customer',nationalId:null,createdAt:'2026-08-01T12:00:00Z',updatedAt:'2026-08-01T12:00:00Z'},
  user:{userId:'customer',username:'customer@example.test',email:null,mobile:null,lastLogin:null,isAdmin:targetAdmin,createdAt:'2026-08-01T12:00:00Z'},
  viewerPermissions:{canEdit:allowed,canVerify:allowed,canManageUser:allowed},legalInfo:null,addresses:[],sessions:{count:0,lastActive:null,entries:[]},siblingProfiles:[],
}}
for(const allowed of [true,false]) test(`CRM actions follow viewer access, not customer admin flag (${allowed})`,async({page})=>{
  await page.addInitScript(()=>{new MutationObserver(()=>{if(document.documentElement)document.documentElement.lang='en'}).observe(document,{childList:true})})
  await page.route('**/api/**',route=>route.fulfill({status:404,json:{}}))
  await page.route(`**/api/crm/profiles/${id}`,route=>route.fulfill({json:detail(!allowed,allowed)}))
  await page.goto(`/admin/crm/profiles/${id}`)
  await expect(page.getByRole('heading',{level:1})).toContainText('Individual')
  await expect(page.getByRole('button',{name:'Edit',exact:true})).toHaveCount(allowed?1:0)
  await expect(page.getByRole('button',{name:'Force Password Change',exact:true})).toHaveCount(allowed?1:0)
  await expect(page.getByRole('button',{name:'Expire Sessions',exact:true})).toHaveCount(allowed?1:0)
})
test('session expiry preserves customer and reason through password confirmation',async({page})=>{
  await page.addInitScript(()=>{new MutationObserver(()=>{if(document.documentElement)document.documentElement.lang='en'}).observe(document,{childList:true})})
  await page.route('**/api/**',route=>route.fulfill({status:404,json:{}}))
  await page.route(`**/api/crm/profiles/${id}`,route=>route.fulfill({json:detail(false,true)}))
  let verified=false
  const bodies:unknown[]=[]
  await page.route('**/api/crm/users/customer/expire-sessions',route=>{
    bodies.push(route.request().postDataJSON())
    return route.fulfill(verified?{json:{success:true}}:{status:403,json:{requiresStepUp:true}})
  })
  await page.route('**/api/auth/step-up',route=>{verified=true;return route.fulfill({json:{verified:true}})})
  await page.goto(`/admin/crm/profiles/${id}`)
  await page.getByRole('button',{name:'Expire Sessions',exact:true}).click()
  await page.getByRole('dialog').locator('textarea').fill('Lost device')
  await page.getByRole('dialog').getByRole('button',{name:'Expire Sessions',exact:true}).click()
  await expect(page.getByRole('dialog')).toContainText('customer@example.test')
  await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click()
  await page.getByRole('dialog').getByLabel('Confirm your password').fill('Test-password-123!')
  await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(bodies).toEqual([{reason:'Lost device'},{reason:'Lost device'}])
})
