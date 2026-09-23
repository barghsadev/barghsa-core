import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
const headers: Record<string, Record<string, string>> = {};
let profileId: string;
let orderId: string;

beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    `INSERT INTO staff_roles(role_id,name,description,permissions) VALUES
     ('business-work-all','All business work','Test','["orders:read","contracts:read","invoices:read","legal:read","admin:financial:edit"]'),
     ('business-work-contracts','Contracts only','Test','["contracts:read"]'),
     ('business-work-finance','Finance only','Test','["admin:financial:edit"]')`
  );
  for (const [user, role, isStaff] of [
    ['work-admin', 'business-work-all', true],
    ['work-contracts', 'business-work-contracts', true],
    ['work-finance', 'business-work-finance', true],
    ['work-customer', null, false],
  ] as const) {
    await http.pool.query(
      'INSERT INTO users(user_id,username,password_hash,is_staff) VALUES($1,$2,$3,$4)',
      [user, `${user}@business-work.test`, 'test-only', isStaff]
    );
    if (role)
      await http.pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [user, role]);
    const session = randomUUID();
    const csrf = randomUUID();
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
       VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')`,
      [session, user, csrf, randomUUID()]
    );
    headers[user] = { Cookie: `barghsa_session=${session}`, 'X-CSRF-Token': csrf };
  }
  profileId = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status,is_default) VALUES('work-customer','LEGAL','ACTIVE',true) RETURNING id"
    )
  ).rows[0].id as string;
  const consultationProductId = (
    await http.pool.query(
      "SELECT id FROM products WHERE system_key='electricity_generation_station'"
    )
  ).rows[0].id as string;
  await http.pool.query(
    `INSERT INTO consultation_requests(profile_id,product_id,product_snapshot,submitted_by,submission_key)
     VALUES($1,$2,'{}'::jsonb,'work-customer',$3)`,
    [profileId, consultationProductId, randomUUID()]
  );
  orderId = randomUUID();
  await http.pool.query(
    `INSERT INTO orders(id,user_id,profile_id,product_id,order_type,
      snapshot_province_id,snapshot_city_id,snapshot_full_address,snapshot_postal_code)
     VALUES($1,'work-customer',$2,$3,'electricity','1','1','Test address','1234567890')`,
    [orderId, profileId, consultationProductId]
  );
  await http.pool.query(
    `INSERT INTO electricity_orders(id,profile_id,status,settings_snapshot,
      total_kwh,average_power_kw,green_rule_applied,submitted_by)
     VALUES($1,$2,'awaiting_staff_review','{}'::jsonb,100,1,false,'work-customer')`,
    [orderId, profileId]
  );
  await http.pool.query(
    `INSERT INTO solar_construction_requests(profile_id,submitted_by,submission_key,
      building_type,grid_type,property_form,structural_frame,building_completion_date,
      agreement_accepted,agreement_version,agreement_snapshot,agreement_accepted_at)
     VALUES($1,'work-customer',$2,'building_apartment','off_grid','villa','concrete',
      '2020-01-01',true,'v1','Test agreement',NOW())`,
    [profileId, randomUUID()]
  );
}, 40000);

afterAll(async () => {
  await http?.close();
}, 15000);

it('returns live pending counts and hides categories outside staff permissions', async () => {
  const path = `${http.base}/api/admin/dashboard/business-work-counts`;
  const all = await fetch(path, { headers: headers['work-admin']! });
  expect(all.status, http.logs()).toBe(200);
  expect(await all.json()).toEqual({
    consultations: 1,
    electricityOrders: 1,
    solarRequests: 1,
    documentReviews: 0,
    refundObligations: 0,
    failedRefundObligations: 0,
  });
  const contracts = await fetch(path, { headers: headers['work-contracts']! });
  expect(contracts.status, http.logs()).toBe(200);
  expect(await contracts.json()).toEqual({
    consultations: null,
    electricityOrders: 1,
    solarRequests: null,
    documentReviews: 0,
    refundObligations: null,
    failedRefundObligations: null,
  });
  const finance = await fetch(path, { headers: headers['work-finance']! });
  expect(finance.status, http.logs()).toBe(200);
  expect(await finance.json()).toEqual({
    consultations: null,
    electricityOrders: null,
    solarRequests: null,
    documentReviews: null,
    refundObligations: 0,
    failedRefundObligations: 0,
  });
  expect((await fetch(path, { headers: headers['work-customer']! })).status).toBe(403);
});

it('counts unresolved obligations and flags failed refunds for finance', async () => {
  const invoiceId = randomUUID();
  const refundId = randomUUID();
  await http.pool.query(
    `INSERT INTO invoices(id,profile_id,order_id,state,total_amount,paid_amount)
     VALUES($1,$2,$3,'Paid',100,100)`,
    [invoiceId, profileId, orderId]
  );
  await http.pool.query(
    `INSERT INTO refunds(id,invoice_id,profile_id,amount,state,destination,idempotency_key)
     VALUES($1,$2,$3,100,'Requested','wallet',$4)`,
    [refundId, invoiceId, profileId, randomUUID()]
  );
  await http.pool.query(
    `INSERT INTO refund_obligations(order_id,invoice_id,profile_id,refund_id,
      total_paid_amount,idempotency_key,authorized_by,reason)
     VALUES($1,$2,$3,$4,100,$5,'work-admin','Order rejected after payment')`,
    [orderId, invoiceId, profileId, refundId, randomUUID()]
  );
  const path = `${http.base}/api/admin/dashboard/business-work-counts`;
  const initial = await (await fetch(path, { headers: headers['work-finance']! })).json();
  expect(initial).toMatchObject({ refundObligations: 1, failedRefundObligations: 0 });
  await http.pool.query("UPDATE refunds SET state='Approved' WHERE id=$1", [refundId]);
  await http.pool.query("UPDATE refunds SET state='Processing' WHERE id=$1", [refundId]);
  await http.pool.query("UPDATE refunds SET state='Failed' WHERE id=$1", [refundId]);
  const failed = await (await fetch(path, { headers: headers['work-finance']! })).json();
  expect(failed).toMatchObject({ refundObligations: 1, failedRefundObligations: 1 });
  expect(await (await fetch(path, { headers: headers['work-contracts']! })).json()).toMatchObject({
    refundObligations: null,
    failedRefundObligations: null,
  });
});
