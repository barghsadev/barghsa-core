import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let customerHeaders: Record<string, string>;
let otherHeaders: Record<string, string>;
let profileId: string;
let addressId: string;

function request(path: string, method: string, body?: unknown, headers = customerHeaders) {
  return fetch(`${http.base}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  for (const user of ['solar-customer', 'solar-other']) {
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash) VALUES($1,$2,'test-only')",
      [user, `${user}@example.test`]
    );
    const session = randomUUID(),
      csrf = randomUUID();
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
       VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')`,
      [session, user, csrf, randomUUID()]
    );
    const headers = {
      Cookie: `barghsa_session=${session}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    };
    if (user === 'solar-customer') customerHeaders = headers;
    else otherHeaders = headers;
  }
  profileId = (
    await http.pool.query<{ id: string }>(
      "INSERT INTO profiles(user_id,profile_type,status,is_default) VALUES('solar-customer','INDIVIDUAL','ACTIVE',true) RETURNING id"
    )
  ).rows[0]!.id;
  const province = (
    await http.pool.query<{ id: string }>(
      "INSERT INTO provinces(name_fa,name_en) VALUES('استان تست','Test Province') RETURNING id"
    )
  ).rows[0]!.id;
  const city = (
    await http.pool.query<{ id: string }>(
      "INSERT INTO cities(province_id,name_fa,name_en) VALUES($1,'شهر تست','Test City') RETURNING id",
      [province]
    )
  ).rows[0]!.id;
  addressId = (
    await http.pool.query<{ id: string }>(
      `INSERT INTO addresses(profile_id,province_id,city_id,full_address,postal_code,main_address)
     VALUES($1,$2,$3,'Test solar site','1234567890',true) RETURNING id`,
      [profileId, province, city]
    )
  ).rows[0]!.id;
}, 60_000);

afterAll(async () => {
  await http?.close();
});

it('submits both solar request types, captures agreement, and creates no contract or invoice', async () => {
  const buildingInput = {
    profileId,
    submissionKey: randomUUID(),
    buildingType: 'building_apartment',
    propertyForm: 'apartment',
    structuralFrame: 'steel',
    buildingCompletionDate: '2018-01-01',
    totalUnits: 12,
    gridType: 'on_grid',
    billIdentifier: '123456789',
    agreementAccepted: true,
  };
  const badBill = await request('/api/solar/requests', 'POST', {
    ...buildingInput,
    billIdentifier: undefined,
  });
  expect(badBill.status).toBe(400);
  const buildingResponse = await request('/api/solar/requests', 'POST', buildingInput);
  expect(buildingResponse.status, http.logs()).toBe(201);
  const building = (await buildingResponse.json()) as { requestId: string; status: string };
  expect(building.status).toBe('submitted');
  const retry = await request('/api/solar/requests', 'POST', buildingInput);
  expect(retry.status, http.logs()).toBe(201);
  expect(await retry.json()).toMatchObject(building);
  const detailsResponse = await request(`/api/solar/requests/${building.requestId}`, 'GET');
  expect(detailsResponse.status, http.logs()).toBe(200);
  const details = (await detailsResponse.json()) as { request: Record<string, unknown> };
  expect(details.request).toMatchObject({
    status: 'submitted',
    building_type: 'building_apartment',
    total_units: 12,
    agreement_accepted: true,
    agreement_version: 'solar-construction-request-v1',
    agreement_snapshot: 'شرایط ثبت قرارداد را می‌پذیرم.',
  });
  expect(details.request.agreement_accepted_at).toBeTruthy();

  const siteInput = {
    profileId,
    submissionKey: randomUUID(),
    buildingType: 'non_household',
    siteCategory: 'agricultural',
    installationSurface: 'land',
    usableAreaSqm: 250,
    siteAddressId: addressId,
    siteRelationship: 'owner',
    gridType: 'off_grid',
    agreementAccepted: true,
  };
  const badSite = await request('/api/solar/requests', 'POST', {
    ...siteInput,
    siteAddressId: randomUUID(),
  });
  expect(badSite.status).toBe(400);
  const siteResponse = await request('/api/solar/requests', 'POST', siteInput);
  expect(siteResponse.status, http.logs()).toBe(201);
  const site = (await siteResponse.json()) as { requestId: string };
  const siteDetail = await request(`/api/solar/requests/${site.requestId}`, 'GET');
  expect(siteDetail.status, http.logs()).toBe(200);
  expect(
    ((await siteDetail.json()) as { request: Record<string, unknown> }).request.site_address
  ).toBe('Test solar site');
  const listResponse = await request(`/api/solar/requests?profileId=${profileId}`, 'GET');
  expect(listResponse.status, http.logs()).toBe(200);
  expect(((await listResponse.json()) as { requests: unknown[] }).requests).toHaveLength(2);
  expect(
    (await request(`/api/solar/requests/${site.requestId}`, 'GET', undefined, otherHeaders)).status
  ).toBe(404);
  expect(
    (await request(`/api/solar/requests?profileId=${profileId}`, 'GET', undefined, otherHeaders))
      .status
  ).toBe(404);
  expect(
    (await http.pool.query('SELECT count(*)::int AS count FROM contracts')).rows[0]!.count
  ).toBe(0);
  expect(
    (await http.pool.query('SELECT count(*)::int AS count FROM invoices')).rows[0]!.count
  ).toBe(0);
  expect(
    (
      await http.pool.query(
        "SELECT count(*)::int AS count FROM audit_log WHERE event='solar.request.submitted'"
      )
    ).rows[0]!.count
  ).toBe(2);

  const products = await request(`/api/consultations/products?profileId=${profileId}`, 'GET');
  expect(products.status, http.logs()).toBe(200);
  const productId = ((await products.json()) as { products: Array<{ id: string }> }).products[0]!
    .id;
  const consultation = await request('/api/consultations/requests', 'POST', {
    profileId,
    productId,
    submissionKey: randomUUID(),
  });
  expect(consultation.status, http.logs()).toBe(201);
  const extra = await request('/api/solar/requests', 'POST', {
    ...buildingInput,
    submissionKey: randomUUID(),
  });
  expect(extra.status, http.logs()).toBe(201);
  const fifth = await request('/api/solar/requests', 'POST', {
    ...buildingInput,
    submissionKey: randomUUID(),
  });
  expect(fifth.status, http.logs()).toBe(201);
  const limited = await request('/api/solar/requests', 'POST', {
    ...buildingInput,
    submissionKey: randomUUID(),
  });
  expect(limited.status, http.logs()).toBe(429);
  expect(await limited.json()).toMatchObject({ error: { code: 'RATE_LIMIT:EXCEEDED' } });
  const replayAtLimit = await request('/api/solar/requests', 'POST', buildingInput);
  expect(replayAtLimit.status, http.logs()).toBe(201);
  expect(await replayAtLimit.json()).toEqual(building);

  const otherProfile = (
    await http.pool.query<{ id: string }>(
      "INSERT INTO profiles(user_id,profile_type,status) VALUES('solar-customer','LEGAL','ACTIVE') RETURNING id"
    )
  ).rows[0]!.id;
  await http.pool.query(
    "INSERT INTO profile_agents(profile_id,user_id,role) VALUES($1,'solar-other','Manager')",
    [otherProfile]
  );
  const independent = await request('/api/solar/requests', 'POST', {
    ...buildingInput,
    profileId: otherProfile,
    submissionKey: randomUUID(),
  });
  expect(independent.status, http.logs()).toBe(201);
  for (let index = 0; index < 3; index++) {
    const next = await request('/api/consultations/requests', 'POST', {
      profileId: otherProfile,
      productId,
      submissionKey: randomUUID(),
    });
    expect(next.status, http.logs()).toBe(201);
  }
  const simultaneous = await Promise.all([
    request('/api/solar/requests', 'POST', {
      ...buildingInput,
      profileId: otherProfile,
      submissionKey: randomUUID(),
    }),
    request(
      '/api/solar/requests',
      'POST',
      { ...buildingInput, profileId: otherProfile, submissionKey: randomUUID() },
      otherHeaders
    ),
  ]);
  expect(simultaneous.map((response) => response.status).sort(), http.logs()).toEqual([201, 429]);
}, 60_000);
