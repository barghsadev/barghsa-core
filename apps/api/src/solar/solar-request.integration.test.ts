import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
import { expectSubmissionAudit } from '../test/submission-audit.js';
import {
  expectOrderSubmitted,
  expectSubmissionNotificationRollback,
} from '../test/order-submission-notifications.js';
import { ReviewSnapshotService } from '../finance/review-snapshot.service.js';

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

async function submitReviewed(input: Record<string, unknown>, headers = customerHeaders) {
  const preview = await request('/api/solar/requests/review', 'POST', input, headers);
  expect(preview.status, http.logs()).toBe(201);
  const review = (await preview.json()) as { hash: string };
  return request(
    '/api/solar/requests',
    'POST',
    { ...input, expectedReviewHash: review.hash },
    headers
  );
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

it('saves and resumes a scoped solar draft without losing incomplete fields', async () => {
  const path = `/api/solar/requests/draft?profileId=${profileId}`;
  expect(await (await request(path, 'GET')).json()).toMatchObject({ currentStep: 1, data: null });
  expect((await request(path, 'GET', undefined, otherHeaders)).status).toBe(404);
  const data = {
    buildingType: 'non_household',
    propertyForm: 'apartment',
    structuralFrame: 'steel',
    buildingCompletionDate: '',
    totalUnits: '',
    siteCategory: 'industrial',
    installationSurface: 'rooftop',
    usableAreaSqm: '250',
    siteAddressId: addressId,
    siteRelationship: 'tenant',
    siteDescription: 'Roof survey pending',
    gridType: 'off_grid',
    billIdentifier: '',
  };
  expect(
    (
      await request(
        '/api/solar/requests/draft',
        'PUT',
        { profileId, currentStep: 1, data },
        otherHeaders
      )
    ).status
  ).toBe(404);
  expect(
    (
      await request('/api/solar/requests/draft', 'PUT', {
        profileId,
        currentStep: 1,
        data: { ...data, buildingType: 'invalid' },
      })
    ).status
  ).toBe(400);
  const saved = await request('/api/solar/requests/draft', 'PUT', {
    profileId,
    currentStep: 1,
    data,
  });
  expect(saved.status, http.logs()).toBe(200);
  expect(await saved.json()).toMatchObject({ currentStep: 1, data });
  expect(
    (await request('/api/solar/requests/draft', 'PUT', { profileId, currentStep: 1, data })).status
  ).toBe(200);
  expect(
    (
      await http.pool.query(
        "SELECT COUNT(*)::int AS count FROM audit_log WHERE event='solar.request.draft_saved'"
      )
    ).rows[0]?.count
  ).toBe(1);
  for (const currentStep of [0, 5, 1.5])
    expect(
      (await request('/api/solar/requests/draft', 'PUT', { profileId, currentStep, data })).status
    ).toBe(400);
  const advanced = await request('/api/solar/requests/draft', 'PUT', {
    profileId,
    currentStep: 4,
    data,
  });
  expect(advanced.status, http.logs()).toBe(200);
  expect(await advanced.json()).toMatchObject({ currentStep: 4, data });
  expect(await (await request(path, 'GET')).json()).toMatchObject({ currentStep: 4, data });
  expect(
    (await request('/api/solar/requests/draft', 'PUT', { profileId, currentStep: 4, data })).status
  ).toBe(200);
  expect(
    (
      await http.pool.query(
        "SELECT metadata FROM audit_log WHERE event='solar.request.draft_saved' ORDER BY created_at"
      )
    ).rows.map((row) => JSON.parse(row.metadata).step)
  ).toEqual([1, 4]);
  await http.pool.query(
    "UPDATE solar_customer_drafts SET updated_at=NOW()-INTERVAL '8 days' WHERE profile_id=$1",
    [profileId]
  );
  expect(await (await request(path, 'GET')).json()).toMatchObject({ data: null });
  expect(
    (await request('/api/solar/requests/draft', 'PUT', { profileId, currentStep: 1, data })).status
  ).toBe(200);
}, 60_000);

it('submits both solar request types, captures agreement, and creates no contract or invoice', async () => {
  const buildingInput = {
    profileId,
    submissionKey: randomUUID(),
    buildingType: 'building_apartment',
    siteAddressId: addressId,
    propertyForm: 'apartment',
    structuralFrame: 'steel',
    buildingCompletionDate: '2018-01-01',
    totalUnits: 12,
    gridType: 'on_grid',
    billIdentifier: '123456789',
    agreementAccepted: true,
  };
  const badBill = await request('/api/solar/requests/review', 'POST', {
    ...buildingInput,
    billIdentifier: undefined,
  });
  expect(badBill.status).toBe(400);
  expect(
    (
      await request('/api/solar/requests/review', 'POST', {
        ...buildingInput,
        siteAddressId: undefined,
      })
    ).status
  ).toBe(400);
  expect((await request('/api/solar/requests', 'POST', buildingInput)).status).toBe(400);
  expect(
    (await request('/api/solar/requests/review', 'POST', buildingInput, otherHeaders)).status
  ).toBe(404);
  const buildingPreview = await request('/api/solar/requests/review', 'POST', buildingInput);
  expect(buildingPreview.status, http.logs()).toBe(201);
  const householdPreview = (await buildingPreview.json()) as { hash: string };
  expect(householdPreview).toMatchObject({
    data: {
      createsContract: false,
      createsInvoice: false,
      siteAddress: 'Test solar site',
      siteAddressSnapshot: {
        id: addressId,
        full_address: 'Test solar site',
        postal_code: '1234567890',
        province_id: expect.any(String),
        city_id: expect.any(String),
      },
    },
  });
  await http.pool.query("UPDATE addresses SET postal_code='9876543210' WHERE id=$1", [addressId]);
  expect(
    (
      await request('/api/solar/requests', 'POST', {
        ...buildingInput,
        expectedReviewHash: householdPreview.hash,
      })
    ).status
  ).toBe(409);
  await http.pool.query("UPDATE addresses SET postal_code='1234567890' WHERE id=$1", [addressId]);
  const badHouseholdAddress = await request('/api/solar/requests/review', 'POST', {
    ...buildingInput,
    siteAddressId: randomUUID(),
  });
  expect(badHouseholdAddress.status).toBe(400);
  await expectSubmissionNotificationRollback(http.pool, () => submitReviewed(buildingInput));
  const buildingResponse = await submitReviewed(buildingInput);
  expect(buildingResponse.status, http.logs()).toBe(201);
  const building = (await buildingResponse.json()) as { requestId: string; status: string };
  expect(building.status).toBe('submitted');
  expect(
    await (await request(`/api/solar/requests/draft?profileId=${profileId}`, 'GET')).json()
  ).toMatchObject({ data: null });
  const retry = await submitReviewed(buildingInput);
  expect(retry.status, http.logs()).toBe(201);
  expect(await retry.json()).toMatchObject(building);
  await expectOrderSubmitted(http.pool, {
    service: 'solar',
    id: building.requestId,
    profileId,
    owner: 'solar-customer',
    table: 'solar_construction_requests',
    route: '/solar/requests',
  });
  await expectSubmissionAudit(http.pool, {
    event: 'solar.request.submitted',
    actor: 'solar-customer',
    entity: 'solar_construction_request',
    id: building.requestId,
    state: 'submitted',
  });
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
  expect((details.request.submission_review as { hash: string }).hash).toMatch(/^[a-f0-9]{64}$/);
  const mismatchedReplay = await request('/api/solar/requests', 'POST', {
    ...buildingInput,
    totalUnits: 13,
    expectedReviewHash: (details.request.submission_review as { hash: string }).hash,
  });
  expect(mismatchedReplay.status).toBe(409);

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
  const badSite = await request('/api/solar/requests/review', 'POST', {
    ...siteInput,
    siteAddressId: randomUUID(),
  });
  expect(badSite.status).toBe(400);
  const sitePreviewResponse = await request('/api/solar/requests/review', 'POST', siteInput);
  expect(sitePreviewResponse.status, http.logs()).toBe(201);
  const sitePreview = (await sitePreviewResponse.json()) as {
    hash: string;
    data: { siteAddress: string };
  };
  expect(sitePreview.data.siteAddress).toBe('Test solar site');
  await http.pool.query("UPDATE addresses SET full_address='Changed site' WHERE id=$1", [
    addressId,
  ]);
  const staleSite = await request('/api/solar/requests', 'POST', {
    ...siteInput,
    expectedReviewHash: sitePreview.hash,
  });
  expect(staleSite.status).toBe(409);
  await http.pool.query("UPDATE addresses SET full_address='Test solar site' WHERE id=$1", [
    addressId,
  ]);
  const siteResponse = await submitReviewed(siteInput);
  expect(siteResponse.status, http.logs()).toBe(201);
  const site = (await siteResponse.json()) as { requestId: string };
  const siteDetail = await request(`/api/solar/requests/${site.requestId}`, 'GET');
  expect(siteDetail.status, http.logs()).toBe(200);
  expect(
    ((await siteDetail.json()) as { request: Record<string, unknown> }).request.site_address
  ).toBe('Test solar site');
  await http.pool.query("UPDATE addresses SET full_address='New site label' WHERE id=$1", [
    addressId,
  ]);
  const historicalDetail = await request(`/api/solar/requests/${site.requestId}`, 'GET');
  expect(historicalDetail.status, http.logs()).toBe(200);
  expect(
    ((await historicalDetail.json()) as { request: Record<string, unknown> }).request.site_address
  ).toBe('Test solar site');
  const householdHistory = await request(`/api/solar/requests/${building.requestId}`, 'GET');
  expect(await householdHistory.json()).toMatchObject({
    request: {
      site_address: 'Test solar site',
      submission_review: {
        data: {
          siteAddressSnapshot: {
            id: addressId,
            full_address: 'Test solar site',
            postal_code: '1234567890',
          },
        },
      },
    },
  });
  const replayPreview = await request('/api/solar/requests/review', 'POST', siteInput);
  expect(replayPreview.status, http.logs()).toBe(201);
  expect((await replayPreview.json()) as { hash: string }).toMatchObject({
    hash: sitePreview.hash,
  });
  expect((await submitReviewed(siteInput)).status).toBe(201);
  await http.pool.query("UPDATE addresses SET full_address='Test solar site' WHERE id=$1", [
    addressId,
  ]);
  const listResponse = await request(`/api/solar/requests?profileId=${profileId}`, 'GET');
  expect(listResponse.status, http.logs()).toBe(200);
  const listed = (await listResponse.json()) as {
    requests: Array<{ id: string; contract_id: string | null; contract_published: boolean }>;
    nextBefore: string | null;
  };
  expect(listed.requests).toHaveLength(2);
  expect(listed.nextBefore).toBeNull();
  const ascending = new URLSearchParams({ profileId, sort: 'submitted_at:asc' });
  const sorted = await request(`/api/solar/requests?${ascending}`, 'GET');
  expect(sorted.status, http.logs()).toBe(200);
  expect(
    ((await sorted.json()) as { requests: { id: string }[] }).requests.map((r) => r.id)
  ).toEqual(listed.requests.map((r) => r.id).reverse());
  ascending.set('before', listed.requests[1]!.id);
  expect(await (await request(`/api/solar/requests?${ascending}`, 'GET')).json()).toMatchObject({
    requests: [{ id: listed.requests[0]!.id }],
    nextBefore: null,
  });
  const search = new URLSearchParams({ profileId, q: site.requestId, statuses: 'submitted' });
  const searched = await request(`/api/solar/requests?${search}`, 'GET');
  expect(searched.status, http.logs()).toBe(200);
  expect(await searched.json()).toMatchObject({
    requests: [{ id: site.requestId }],
    nextBefore: null,
  });
  search.set('q', '%');
  expect(await (await request(`/api/solar/requests?${search}`, 'GET')).json()).toEqual({
    requests: [],
    nextBefore: null,
  });
  search.set('before', site.requestId);
  expect((await request(`/api/solar/requests?${search}`, 'GET')).status).toBe(404);
  search.delete('before');
  search.delete('q');
  search.set('sort', 'status:asc');
  expect((await request(`/api/solar/requests?${search}`, 'GET')).status).toBe(400);
  const filtered = await request(
    `/api/solar/requests?profileId=${profileId}&statuses=submitted,uploading_documents`,
    'GET'
  );
  expect(filtered.status, http.logs()).toBe(200);
  expect(((await filtered.json()) as { requests: unknown[] }).requests).toHaveLength(2);
  const rangeId = listed.requests[0]!.id;
  const oldTime = (
    await http.pool.query<{ submitted_at: Date }>(
      'SELECT submitted_at FROM solar_construction_requests WHERE id=$1',
      [rangeId]
    )
  ).rows[0]!.submitted_at;
  const start = '2027-01-01T10:00:00.000Z';
  const end = '2027-01-01T10:00:01.000Z';
  await http.pool.query('UPDATE solar_construction_requests SET submitted_at=$2 WHERE id=$1', [
    rangeId,
    start,
  ]);
  const range = new URLSearchParams({ profileId: profileId, from: start, to: end });
  const ranged = await request(`/api/solar/requests?${range}`, 'GET');
  expect(ranged.status, http.logs()).toBe(200);
  expect(await ranged.json()).toMatchObject({ requests: [{ id: rangeId }], nextBefore: null });
  range.set('to', start);
  expect((await request(`/api/solar/requests?${range}`, 'GET')).status).toBe(400);
  range.delete('from');
  range.set('before', rangeId);
  expect((await request(`/api/solar/requests?${range}`, 'GET')).status).toBe(404);
  range.set('from', 'invalid-date');
  expect((await request(`/api/solar/requests?${range}`, 'GET')).status).toBe(400);
  await http.pool.query('UPDATE solar_construction_requests SET submitted_at=$2 WHERE id=$1', [
    rangeId,
    oldTime,
  ]);
  const noMatch = await request(
    `/api/solar/requests?profileId=${profileId}&statuses=approved`,
    'GET'
  );
  expect(await noMatch.json()).toEqual({ requests: [], nextBefore: null });
  expect(
    (
      await request(
        `/api/solar/requests?profileId=${profileId}&statuses=approved&before=${listed.requests[0]!.id}`,
        'GET'
      )
    ).status
  ).toBe(404);
  expect(
    (await request(`/api/solar/requests?profileId=${profileId}&statuses=unknown`, 'GET')).status
  ).toBe(400);
  const olderResponse = await request(
    `/api/solar/requests?profileId=${profileId}&before=${listed.requests[0]!.id}`,
    'GET'
  );
  expect(olderResponse.status, http.logs()).toBe(200);
  expect(
    ((await olderResponse.json()) as { requests: Array<{ id: string }> }).requests.map(
      (row) => row.id
    )
  ).toEqual([listed.requests[1]!.id]);
  expect(
    (await request(`/api/solar/requests?profileId=${profileId}&before=bad`, 'GET')).status
  ).toBe(400);
  expect(
    (await request(`/api/solar/requests?profileId=${profileId}&before=${randomUUID()}`, 'GET'))
      .status
  ).toBe(404);
  expect(listed.requests.find((row) => row.id === building.requestId)).toMatchObject({
    contract_id: null,
    contract_published: false,
  });
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
  const extra = await submitReviewed({
    ...buildingInput,
    submissionKey: randomUUID(),
  });
  expect(extra.status, http.logs()).toBe(201);
  const fifth = await submitReviewed({
    ...buildingInput,
    submissionKey: randomUUID(),
  });
  expect(fifth.status, http.logs()).toBe(201);
  const limited = await submitReviewed({
    ...buildingInput,
    submissionKey: randomUUID(),
  });
  expect(limited.status, http.logs()).toBe(429);
  expect(await limited.json()).toMatchObject({ error: { code: 'RATE_LIMIT:EXCEEDED' } });
  const replayAtLimit = await submitReviewed(buildingInput);
  expect(replayAtLimit.status, http.logs()).toBe(201);
  expect(await replayAtLimit.json()).toEqual(building);

  const otherProfile = (
    await http.pool.query<{ id: string }>(
      "INSERT INTO profiles(user_id,profile_type,status) VALUES('solar-customer','LEGAL','ACTIVE') RETURNING id"
    )
  ).rows[0]!.id;
  const otherAddressId = (
    await http.pool.query<{ id: string }>(
      'INSERT INTO addresses(profile_id,province_id,city_id,full_address,postal_code,main_address) SELECT $1,province_id,city_id,full_address,postal_code,true FROM addresses WHERE id=$2 RETURNING id',
      [otherProfile, addressId]
    )
  ).rows[0]!.id;
  await http.pool.query(
    "INSERT INTO profile_agents(profile_id,user_id,role) VALUES($1,'solar-other','Manager')",
    [otherProfile]
  );
  const independent = await submitReviewed({
    ...buildingInput,
    profileId: otherProfile,
    siteAddressId: otherAddressId,
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
    submitReviewed({
      ...buildingInput,
      profileId: otherProfile,
      siteAddressId: otherAddressId,
      submissionKey: randomUUID(),
    }),
    submitReviewed(
      {
        ...buildingInput,
        profileId: otherProfile,
        siteAddressId: otherAddressId,
        submissionKey: randomUUID(),
      },
      otherHeaders
    ),
  ]);
  expect(simultaneous.map((response) => response.status).sort(), http.logs()).toEqual([201, 429]);
}, 60_000);

it('replays a legacy household signed receipt without adding address fields or changing its hash', async () => {
  const input = {
    profileId,
    submissionKey: randomUUID(),
    buildingType: 'building_apartment',
    propertyForm: 'villa',
    structuralFrame: 'concrete',
    buildingCompletionDate: '2020-01-01',
    gridType: 'off_grid',
    agreementAccepted: true,
  };
  const stored = new ReviewSnapshotService().create(
    { action: 'solar.request.submit', profileId, resourceId: input.submissionKey },
    {
      submission: input,
      siteAddress: null,
      agreementVersion: 'solar-construction-request-v1',
      agreementText: 'شرایط ثبت قرارداد را می‌پذیرم.',
      createsContract: false,
      createsInvoice: false,
    }
  );
  const row = (
    await http.pool.query<{ id: string }>(
      `INSERT INTO solar_construction_requests(profile_id,submitted_by,submission_key,status,building_type,grid_type,property_form,structural_frame,building_completion_date,agreement_accepted,agreement_version,agreement_snapshot,agreement_accepted_at,submission_review)
     VALUES($1,'solar-customer',$2,'submitted','building_apartment','off_grid','villa','concrete','2020-01-01',true,'solar-construction-request-v1','شرایط ثبت قرارداد را می‌پذیرم.',NOW(),$3::jsonb) RETURNING id`,
      [profileId, input.submissionKey, JSON.stringify(stored)]
    )
  ).rows[0]!;
  const preview = await request('/api/solar/requests/review', 'POST', input);
  expect(preview.status, http.logs()).toBe(201);
  expect(await preview.json()).toEqual(stored);
  const replay = await request('/api/solar/requests', 'POST', {
    ...input,
    expectedReviewHash: stored.hash,
  });
  expect(replay.status, http.logs()).toBe(201);
  expect(await replay.json()).toEqual({ requestId: row.id, status: 'submitted' });
  expect(
    (
      await http.pool.query(
        'SELECT submission_review FROM solar_construction_requests WHERE id=$1',
        [row.id]
      )
    ).rows[0]!.submission_review
  ).toEqual(stored);
}, 60_000);

it('keeps an unsigned legacy site address unknown after the saved address changes', async () => {
  const key = randomUUID();
  const row = (
    await http.pool.query<{ id: string }>(
      `INSERT INTO solar_construction_requests(profile_id,submitted_by,submission_key,status,building_type,grid_type,site_category,installation_surface,usable_area_sqm,site_address_id,site_relationship,agreement_accepted,agreement_version,agreement_snapshot,agreement_accepted_at)
     VALUES($1,'solar-customer',$2,'submitted','non_household','off_grid','industrial','rooftop',100,$3,'owner',true,'legacy-v1','Legacy terms',NOW()) RETURNING id`,
      [profileId, key, addressId]
    )
  ).rows[0]!;
  await http.pool.query(
    "UPDATE addresses SET full_address='Mutable present-day site' WHERE id=$1",
    [addressId]
  );
  const response = await request(`/api/solar/requests/${row.id}`, 'GET');
  expect(response.status, http.logs()).toBe(200);
  expect(await response.json()).toMatchObject({
    request: { id: row.id, site_address: null, submission_review: null },
  });
  expect(
    (await request(`/api/solar/requests/${row.id}`, 'GET', undefined, otherHeaders)).status
  ).toBe(404);
  expect(
    (
      await http.pool.query(
        'SELECT submission_review,site_address_id FROM solar_construction_requests WHERE id=$1',
        [row.id]
      )
    ).rows
  ).toEqual([{ submission_review: null, site_address_id: addressId }]);
}, 60_000);
