import { test, expect } from '@playwright/test'
const id='11111111-1111-4111-8111-111111111111'
function detail(targetAdmin:boolean,allowed:boolean) {return {
  profile:{id,profileType:'INDIVIDUAL',status:'ACTIVE',title:'Customer profile',contactEmail:'office@example.test',contactMobile:'+989121234567',firstName:'Example',lastName:'Customer',nationalId:null,createdAt:'2026-08-01T12:00:00Z',updatedAt:'2026-08-01T12:00:00Z'},
  user:{userId:'customer',username:'customer@example.test',email:'signin@example.test',mobile:'+989121234568',lastLogin:null,isAdmin:targetAdmin,createdAt:'2026-08-01T12:00:00Z'},
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
test('verification requires a reason when removing approval and archive blockers remain visible',async({page})=>{
  await page.addInitScript(()=>{new MutationObserver(()=>{if(document.documentElement)document.documentElement.lang='en'}).observe(document,{childList:true})})
  await page.route('**/api/**',route=>route.fulfill({status:404,json:{}}))
  const profile=detail(false,true);profile.profile.status='VERIFIED'
  await page.route(`**/api/crm/profiles/${id}`,route=>route.request().method()==='DELETE'?route.fulfill({status:409,json:{error:{code:'CRM:PROFILE:DELETION_BLOCKED'}}}):route.fulfill({json:profile}))
  await page.route(`**/api/crm/profiles/${id}/verify`,route=>{
    expect(route.request().postDataJSON()).toEqual({action:'reverify',reason:'Evidence expired'})
    profile.profile.status='PENDING_VERIFICATION'
    return route.fulfill({json:{success:true}})
  })
  await page.goto(`/admin/crm/profiles/${id}`)
  await expect(page.getByRole('button',{name:'Review verification change'})).toBeDisabled()
  await page.getByLabel('Verification action', {exact:true}).selectOption('reverify')
  await page.getByLabel('Reason (required to remove or renew verification)').fill('Evidence expired')
  await page.getByRole('button',{name:'Review verification change'}).click()
  await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click()
  await expect(page.getByRole('heading',{level:1})).toContainText('Pending verification')
  await page.getByRole('button',{name:'Archive profile',exact:true}).click()
  await page.getByRole('dialog').locator('textarea').fill('Closure requested')
  await page.getByRole('dialog').getByRole('button',{name:'Archive profile',exact:true}).click()
  await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('wallet balances')
  await expect(page).toHaveURL(new RegExp(`/admin/crm/profiles/${id}$`))
})

for (const locale of ['fa', 'en'] as const) test(`CRM edits profile contacts while sign-in contacts stay read-only (${locale})`, async ({ page }) => {
  await page.addInitScript((lang) => {
    new MutationObserver(() => { document.documentElement.lang = lang }).observe(document, { childList: true })
  }, locale)
  const current = detail(false, true)
  let fail = true
  const writes: unknown[] = []
  await page.route('**/api/**', route => route.fulfill({ status: 404, json: {} }))
  await page.route(`**/api/crm/profiles/${id}`, route => {
    if (route.request().method() !== 'PUT') return route.fulfill({ json: current })
    const body = route.request().postDataJSON()
    writes.push(body)
    if (fail) return route.fulfill({ status: 500, json: { error: { code: 'SERVER_ERROR' } } })
    current.profile.contactEmail = body.email.trim().toLowerCase()
    current.profile.contactMobile = '+98' + body.mobile.slice(1)
    return route.fulfill({ json: current })
  })
  await page.goto(`/admin/crm/profiles/${id}`)
  await page.getByRole('tab', { name: locale === 'fa' ? 'جزئیات پروفایل' : 'Profile Details', exact: true }).click()
  await page.getByRole('button', { name: locale === 'fa' ? 'ویرایش' : 'Edit', exact: true }).click()
  const email = page.getByLabel(locale === 'fa' ? 'ایمیل' : 'Email', { exact: true })
  const mobile = page.getByLabel(locale === 'fa' ? 'شماره موبایل' : 'Mobile', { exact: true })
  await expect(email).toHaveValue('office@example.test')
  await expect(mobile).toHaveValue('+989121234567')
  await expect(page.getByText('signin@example.test', { exact: true })).toBeVisible()
  await expect(page.locator('input[value="signin@example.test"]')).toHaveCount(0)
  await email.fill('NEW-OFFICE@example.test')
  await mobile.fill('09121234569')
  await page.getByRole('button', { name: locale === 'fa' ? 'ذخیره تغییرات' : 'Save Changes', exact: true }).click()
  const confirm = page.getByRole('dialog').getByRole('button', { name: locale === 'fa' ? 'تأیید' : 'Confirm', exact: true })
  await confirm.click()
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible()
  await expect(email).toHaveValue('NEW-OFFICE@example.test')
  await expect(mobile).toHaveValue('09121234569')
  fail = false
  await confirm.click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('new-office@example.test', { exact: true })).toBeVisible()
  await expect(page.getByText('+989121234569', { exact: true })).toBeVisible()
  await expect(page.getByText('signin@example.test', { exact: true })).toBeVisible()
  expect(writes).toEqual(Array(2).fill({ title: 'Customer profile', email: 'NEW-OFFICE@example.test', mobile: '09121234569' }))
})
