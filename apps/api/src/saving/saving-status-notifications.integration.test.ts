import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
import {
  expectSavingStatusDeliveries,
  expectSavingStatusRollback,
  savingDeliverySnapshot,
} from '../test/saving-status-notification-proof.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
let customerHeaders: Record<string, string>;
let staffHeaders: Record<string, string>;
let _changeOutsiderHeaders: Record<string, string>;
let input: {
  profileId: string;
  savingPlanId: string;
  hardwareProductId: string;
  billIdentifier: string;
  installationAddressId: string;
  agreementVersionId: string;
};
let _legalProfileId: string;

function request(path: string, method: string, body?: unknown, headers = customerHeaders) {
  return fetch(`${http.base}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function decisionReview(orderId: string, action: 'approve' | 'reject', reason = '') {
  const response = await request(
    `/api/staff/saving/orders/${orderId}/financial-review`,
    'POST',
    { action, reason },
    staffHeaders
  );
  expect(response.status, http.logs()).toBe(200);
  return (await response.json()) as {
    hash: string;
    data: { outcome: string; refundAmount: string; invoiceId: string };
  };
}

beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    `INSERT INTO staff_roles(role_id,name,description,permissions)
     VALUES('saving-order-admin','Saving order','Test role','["admin:catalogue:edit","admin:financial:edit","contracts:read","contracts:write","invoices:write"]')`
  );
  for (const [user, staff] of [
    ['saving-order-buyer', false],
    ['saving-order-staff', true],
    ['saving-change-outsider', false],
  ] as const) {
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES($1,$2,'test-only',$3)",
      [user, `${user}@example.test`, staff]
    );
    if (staff)
      await http.pool.query(
        "INSERT INTO user_roles(user_id,role_id) VALUES($1,'saving-order-admin')",
        [user]
      );
    const session = randomUUID(),
      csrf = randomUUID();
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
       VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
      [session, user, csrf, randomUUID()]
    );
    const headers = {
      Cookie: `barghsa_session=${session}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    };
    if (staff) staffHeaders = headers;
    else if (user === 'saving-change-outsider') _changeOutsiderHeaders = headers;
    else customerHeaders = headers;
  }
  const profileId = (
    await http.pool.query<{ id: string }>(
      "INSERT INTO profiles(user_id,profile_type,status,is_default) VALUES('saving-order-buyer','INDIVIDUAL','ACTIVE',true) RETURNING id"
    )
  ).rows[0]!.id;
  _legalProfileId = (
    await http.pool.query<{ id: string }>(
      "INSERT INTO profiles(user_id,profile_type,status,is_default) VALUES('saving-order-buyer','LEGAL','ACTIVE',false) RETURNING id"
    )
  ).rows[0]!.id;
  const provinceId = (
    await http.pool.query<{ id: string }>(
      "INSERT INTO provinces(name_fa,name_en) VALUES('استان تست','Test Province') RETURNING id"
    )
  ).rows[0]!.id;
  const cityId = (
    await http.pool.query<{ id: string }>(
      "INSERT INTO cities(province_id,name_fa,name_en) VALUES($1,'شهر تست','Test City') RETURNING id",
      [provinceId]
    )
  ).rows[0]!.id;
  const addressId = (
    await http.pool.query<{ id: string }>(
      `INSERT INTO addresses(profile_id,province_id,city_id,full_address,postal_code,main_address)
     VALUES($1,$2,$3,'Test installation address','1234567890',true) RETURNING id`,
      [profileId, provinceId, cityId]
    )
  ).rows[0]!.id;
  const hardwareResponse = await request(
    '/api/admin/catalogue/products',
    'POST',
    {
      type: 'hardware',
      title: { fa: 'دستگاه', en: 'Device' },
      description: { fa: 'تجهیز', en: 'Equipment' },
      price: '200000',
      status: 'active',
    },
    staffHeaders
  );
  expect(hardwareResponse.status, http.logs()).toBe(201);
  const hardware = (await hardwareResponse.json()) as { id: string };
  const inventory = await request(
    `/api/admin/catalogue/hardware/${hardware.id}/inventory`,
    'PUT',
    { stockTracking: true, stockCount: 2, reservationMinutes: 30 },
    staffHeaders
  );
  expect(inventory.status, http.logs()).toBe(200);
  expect(await inventory.json()).toMatchObject({
    stockTracking: true,
    stockCount: 2,
    reservedCount: 0,
  });
  const inventoryRead = await request(
    `/api/admin/catalogue/hardware/${hardware.id}/inventory`,
    'GET',
    undefined,
    staffHeaders
  );
  expect(inventoryRead.status, http.logs()).toBe(200);
  expect(await inventoryRead.json()).toMatchObject({ reservationMinutes: 30 });
  const planResponse = await request(
    '/api/admin/catalogue/products',
    'POST',
    {
      type: 'saving_plan',
      title: { fa: 'طرح', en: 'Plan' },
      description: { fa: 'صرفه‌جویی', en: 'Saving' },
      price: '100000',
      status: 'inactive',
      hardwareIds: [hardware.id],
    },
    staffHeaders
  );
  expect(planResponse.status, http.logs()).toBe(201);
  const plan = (await planResponse.json()) as { id: string };
  const draftResponse = await request(
    `/api/admin/catalogue/saving-plans/${plan.id}/agreements/draft`,
    'POST',
    { title: 'Test terms', body: 'The customer agrees to the plan.' },
    staffHeaders
  );
  expect(draftResponse.status, http.logs()).toBe(201);
  const agreement = (await draftResponse.json()) as { id: string };
  expect(
    (
      await request(
        `/api/admin/catalogue/saving-plans/${plan.id}/agreements/${agreement.id}/activate`,
        'POST',
        undefined,
        staffHeaders
      )
    ).status,
    http.logs()
  ).toBe(201);
  expect(
    (
      await request(
        `/api/admin/catalogue/products/${plan.id}`,
        'PUT',
        { status: 'active' },
        staffHeaders
      )
    ).status,
    http.logs()
  ).toBe(200);
  await http.pool.query(
    `INSERT INTO vat_configurations(category,rate,effective_from,created_by)
     VALUES('saving_plan',900,NOW()-INTERVAL '1 day','saving-order-staff')`
  );
  input = {
    profileId,
    savingPlanId: plan.id,
    hardwareProductId: hardware.id,
    billIdentifier: '1234567890123',
    installationAddressId: addressId,
    agreementVersionId: agreement.id,
  };
}, 60000);

afterAll(async () => {
  await http?.close();
}, 15000);

it('atomically recovers saving review and revision sinks for the current owner within real request limits', async () => {
  const quoted = await request('/api/saving/orders/quote', 'POST', input);
  expect(quoted.status, http.logs()).toBe(201);
  const submitted = await request('/api/saving/orders', 'POST', {
    ...input,
    idempotencyKey: randomUUID(),
    expectedQuoteDigest: ((await quoted.json()) as { reviewDigest: string }).reviewDigest,
    agreementAccepted: true,
    hardwareConfirmed: true,
    submitForStaffReview: true,
  });
  expect(submitted.status, http.logs()).toBe(201);
  const id = ((await submitted.json()) as { savingOrderId: string }).savingOrderId;
  const next = randomUUID(),
    session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES($1,$2,'fixture')",
    [next, next + '@example.test']
  );
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')",
    [session, next, csrf, randomUUID()]
  );
  await http.pool.query('UPDATE profiles SET user_id=$2 WHERE id=$1', [input.profileId, next]);
  customerHeaders = {
    Cookie: 'barghsa_session=' + session,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  };
  const staffDetail = await request(
    '/api/staff/saving/orders/' + id,
    'GET',
    undefined,
    staffHeaders
  );
  expect(staffDetail.status, http.logs()).toBe(200);
  const version = ((await staffDetail.json()) as { versionId: string }).versionId;
  const approval = {
    idempotencyKey: randomUUID(),
    expectedVersionId: version,
    expectedReviewHash: (await decisionReview(id, 'approve')).hash,
  };
  const approve = () =>
    request('/api/staff/saving/orders/' + id + '/approve', 'POST', approval, staffHeaders);
  await expectSavingStatusRollback(http.pool, id, 'approved', approve);
  expect((await approve()).status, http.logs()).toBe(200);
  await expectSavingStatusDeliveries(http.pool, id, next, ['approved']);
  const before = await savingDeliverySnapshot(http.pool, id);
  expect((await approve()).status, http.logs()).toBe(200);
  expect(await savingDeliverySnapshot(http.pool, id)).toEqual(before);
  const address = (
    await http.pool.query(
      "INSERT INTO addresses(profile_id,province_id,city_id,full_address,postal_code) SELECT profile_id,province_id,city_id,'Revised installation address','1122334455' FROM addresses WHERE id=$1 RETURNING id",
      [input.installationAddressId]
    )
  ).rows[0].id;
  const change = { hardwareProductId: input.hardwareProductId, installationAddressId: address };
  const revisedQuote = await request('/api/saving/orders/' + id + '/change-quote', 'POST', change);
  expect(revisedQuote.status, http.logs()).toBe(201);
  const command = {
    ...change,
    idempotencyKey: randomUUID(),
    expectedQuoteDigest: ((await revisedQuote.json()) as { reviewDigest: string }).reviewDigest,
  };
  const revise = () => request('/api/saving/orders/' + id + '/change', 'POST', command);
  await expectSavingStatusRollback(http.pool, id, 'awaiting_staff_review', revise);
  const changed = await revise();
  expect(changed.status, http.logs()).toBe(201);
  const response = await changed.json();
  await expectSavingStatusDeliveries(http.pool, id, next, ['approved', 'awaiting_staff_review']);
  const revisedBefore = await savingDeliverySnapshot(http.pool, id);
  const replay = await revise();
  expect(replay.status, http.logs()).toBe(201);
  expect(await replay.json()).toEqual(response);
  expect(await savingDeliverySnapshot(http.pool, id)).toEqual(revisedBefore);
  const currentVersion = (
    (await (
      await request('/api/staff/saving/orders/' + id, 'GET', undefined, staffHeaders)
    ).json()) as { versionId: string }
  ).versionId;
  const reapproval = await request(
    '/api/staff/saving/orders/' + id + '/approve',
    'POST',
    {
      idempotencyKey: randomUUID(),
      expectedVersionId: currentVersion,
      expectedReviewHash: (await decisionReview(id, 'approve')).hash,
    },
    staffHeaders
  );
  expect(reapproval.status, http.logs()).toBe(200);
  await expectSavingStatusDeliveries(http.pool, id, next, [
    'approved',
    'awaiting_staff_review',
    'approved',
  ]);
  expect(
    (
      await http.pool.query(
        "SELECT * FROM in_app_notifications WHERE profile_id=$1 AND recipient_user_id='saving-order-buyer' AND type='order.status_changed'",
        [input.profileId]
      )
    ).rows
  ).toEqual([]);
});
