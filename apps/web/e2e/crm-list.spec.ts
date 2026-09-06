import { test, expect } from '@playwright/test'
const user = { userId:'user-one',username:'person@example.test',registrationDate:'2026-08-01T00:00:00.000001Z',lastLogin:null,profileCount:1,hasVerifiedProfile:false,profiles:[{id:'11111111-1111-4111-8111-111111111111',profileType:'INDIVIDUAL',status:'PENDING_VERIFICATION',title:'Example profile'}] }
for(const locale of ['en','fa']) test(`CRM filters, profile links and cursor navigation (${locale})`,async({page})=>{
  await page.addInitScript(value=>{new MutationObserver(()=>{if(document.documentElement)document.documentElement.lang=value}).observe(document,{childList:true})},locale)
  await page.route('**/api/**',route=>route.fulfill({status:404,json:{}}))
  const requests: URL[]=[]
  await page.route('**/api/crm/users?*',route=>{
    const url=new URL(route.request().url());requests.push(url)
    return route.fulfill({json:{users:url.searchParams.get('cursor')?[]:[user],cursor:url.searchParams.get('cursor')?null:'page-two',hasMore:!url.searchParams.get('cursor')}})
  })
  await page.goto('/admin/crm?verification=PENDING')
  await expect(page.getByRole('heading',{level:1})).toHaveText(locale==='fa'?'کاربران مدیریت مشتریان':'CRM users')
  await expect(page.getByRole('heading',{name:user.username})).toBeVisible()
  expect(requests.at(-1)!.searchParams.get('verification')).toBe('PENDING')
  await page.getByRole('button',{name:locale==='fa'?'پروفایل‌ها: 1':'Profiles: 1'}).click()
  await expect(page.getByRole('link',{name:/Example profile/})).toHaveAttribute('href',`/admin/crm/profiles/${user.profiles[0]!.id}`)
  await page.getByRole('button',{name:locale==='fa'?'بستن همه':'Collapse all',exact:true}).click()
  await expect(page.getByRole('link',{name:/Example profile/})).toHaveCount(0)
  await page.getByRole('button',{name:locale==='fa'?'بعدی':'Next',exact:true}).click()
  await expect(page.getByText(locale==='fa'?'کاربری با این مشخصات پیدا نشد.':'No matching users.')).toBeVisible()
  expect(requests.at(-1)!.searchParams.get('cursor')).toBe('page-two')
  await page.locator('#crm-type').selectOption('LEGAL')
  await expect(page.getByRole('heading',{name:user.username})).toBeVisible()
  expect(requests.at(-1)!.searchParams.has('cursor')).toBe(false)
  await page.locator('#crm-search').fill('Example')
  await expect.poll(()=>requests.at(-1)!.searchParams.get('search')).toBe('Example')
  await page.getByRole('button',{name:locale==='fa'?'پاک کردن فیلترها':'Clear filters',exact:true}).click()
  await expect.poll(()=>requests.at(-1)!.searchParams.has('verification')).toBe(false)
})
test('CRM access errors remain errors and can be retried',async({page})=>{
  await page.addInitScript(()=>{new MutationObserver(()=>{if(document.documentElement)document.documentElement.lang='en'}).observe(document,{childList:true})})
  await page.route('**/api/**',route=>route.fulfill({status:404,json:{}}))
  let allowed=false
  await page.route('**/api/crm/users?*',route=>route.fulfill(allowed?{json:{users:[],cursor:null,hasMore:false}}:{status:403,json:{}}))
  await page.goto('/admin/crm')
  await expect(page.getByRole('alert')).toContainText('Check your access')
  allowed=true
  await page.getByRole('button',{name:'Refresh',exact:true}).click()
  await expect(page.getByText('No matching users.')).toBeVisible()
})
