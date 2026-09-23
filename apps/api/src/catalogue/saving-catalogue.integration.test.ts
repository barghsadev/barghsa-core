import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let staffHeaders: Record<string, string>;
let customerHeaders: Record<string, string>;

beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    `INSERT INTO staff_roles(role_id,name,description,permissions)
     VALUES('saving-catalogue-admin','Saving catalogue','Test role','["admin:catalogue:edit"]')`
  );
  for (const [user, staff] of [
    ['saving-editor', true],
    ['saving-customer', false],
  ] as const) {
    await http.pool.query(
      `INSERT INTO users(user_id,username,password_hash,is_staff)
       VALUES($1,$2,'test-only',$3)`,
      [user, `${user}@example.test`, staff]
    );
    if (staff)
      await http.pool.query(
        "INSERT INTO user_roles(user_id,role_id) VALUES($1,'saving-catalogue-admin')",
        [user]
      );
    const sessionId = randomUUID(),
      csrf = randomUUID();
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
       VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
      [sessionId, user, csrf, randomUUID()]
    );
    const headers = {
      Cookie: `barghsa_session=${sessionId}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    };
    if (staff) staffHeaders = headers;
    else customerHeaders = headers;
  }
}, 40000);

afterAll(async () => {
  await http?.close();
}, 15000);

function admin(path: string, method = 'GET', body?: unknown, headers = staffHeaders) {
  return fetch(`${http.base}/api/admin/catalogue/${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function browse() {
  return fetch(`${http.base}/api/saving/plans`, { headers: customerHeaders });
}

it('configures a saving plan, publishes an immutable agreement, and discloses it in customer browsing', async () => {
  const hardwareResponse = await admin('products', 'POST', {
    type: 'hardware',
    title: { fa: 'دستگاه نمونه', en: 'Sample device' },
    description: { fa: 'تجهیز آزمایشی', en: 'Test equipment' },
    price: '200000',
    status: 'active',
  });
  expect(hardwareResponse.status, http.logs()).toBe(201);
  const hardware = (await hardwareResponse.json()) as { id: string };
  const planBody = {
    type: 'saving_plan',
    title: { fa: 'طرح نمونه', en: 'Sample plan' },
    description: { fa: 'صرفه‌جویی', en: 'Saving energy' },
    price: '100000',
    status: 'inactive',
  };
  expect((await admin('products', 'POST', planBody)).status).toBe(400);
  expect(
    (await admin('products', 'POST', { ...planBody, hardwareIds: [randomUUID()] })).status
  ).toBe(400);
  const create = await admin('products', 'POST', { ...planBody, hardwareIds: [hardware.id] });
  expect(create.status, http.logs()).toBe(201);
  const plan = (await create.json()) as { id: string };
  const path = `saving-plans/${plan.id}`;
  expect(await (await admin(`${path}/configuration`)).json()).toMatchObject({
    hardwareIds: [hardware.id],
    agreements: [],
  });
  expect(await (await browse()).json()).toMatchObject({
    plans: [
      expect.objectContaining({
        id: plan.id,
        available: false,
        agreement: null,
        hardware: [expect.objectContaining({ id: hardware.id, price: '200000' })],
      }),
    ],
  });
  expect((await admin(`products/${plan.id}`, 'PUT', { status: 'active' })).status).toBe(409);

  const draftResponse = await admin(`${path}/agreements/draft`, 'POST', {
    title: 'Plan agreement',
    body: 'The customer accepts the current plan and equipment.',
  });
  expect(draftResponse.status, http.logs()).toBe(201);
  const first = (await draftResponse.json()) as { id: string };
  expect(await (await browse()).json()).toMatchObject({
    plans: [expect.objectContaining({ id: plan.id, agreement: null })],
  });
  expect((await admin(`${path}/agreements/${first.id}/activate`, 'POST')).status).toBe(201);
  expect((await admin(`products/${plan.id}`, 'PUT', { status: 'active' })).status).toBe(200);
  expect(await (await browse()).json()).toMatchObject({
    plans: [
      expect.objectContaining({
        id: plan.id,
        available: true,
        agreement: expect.objectContaining({ versionId: first.id, title: 'Plan agreement' }),
      }),
    ],
  });
  await expect(
    http.pool.query("UPDATE saving_plan_agreement_versions SET body='rewritten' WHERE id=$1", [
      first.id,
    ])
  ).rejects.toMatchObject({ code: '23514' });

  const secondDraft = await admin(`${path}/agreements/draft`, 'POST', {
    title: 'Revised terms',
    body: 'New terms for future orders.',
  });
  expect(secondDraft.status, http.logs()).toBe(201);
  const second = (await secondDraft.json()) as { id: string };
  expect(await (await browse()).json()).toMatchObject({
    plans: [
      expect.objectContaining({ agreement: expect.objectContaining({ versionId: first.id }) }),
    ],
  });
  expect((await admin(`${path}/agreements/${second.id}/activate`, 'POST')).status).toBe(201);
  const history = (await (await admin(`${path}/configuration`)).json()) as {
    agreements: Array<{ id: string; status: string; body: string }>;
  };
  expect(history.agreements).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: first.id,
        status: 'superseded',
        body: 'The customer accepts the current plan and equipment.',
      }),
      expect.objectContaining({
        id: second.id,
        status: 'active',
        body: 'New terms for future orders.',
      }),
    ])
  );
  expect(await (await browse()).json()).toMatchObject({
    plans: [
      expect.objectContaining({ agreement: expect.objectContaining({ versionId: second.id }) }),
    ],
  });
  expect(
    (
      await admin(
        `${path}/agreements/draft`,
        'POST',
        { title: 'No', body: 'Permission' },
        customerHeaders
      )
    ).status
  ).toBe(403);
  await http.pool.query(
    "UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='saving-editor'"
  );
  expect(
    (await admin(`${path}/agreements/draft`, 'POST', { title: 'Blocked', body: 'No step up' }))
      .status
  ).toBe(403);
  await expect(
    http.pool.query('INSERT INTO saving_plan_hardware(plan_id,hardware_id) VALUES($1,$2)', [
      hardware.id,
      plan.id,
    ])
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    http.pool.query("UPDATE products SET type='consultation' WHERE id=$1", [plan.id])
  ).rejects.toMatchObject({ code: '23514' });
}, 40000);
