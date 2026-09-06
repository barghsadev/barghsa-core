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
