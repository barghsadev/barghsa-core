import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { SolarPostalTrackingCommand } from './solar-postal-tracking.validation.js';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
const headers: Record<string, Record<string, string>> = {};
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    `INSERT INTO staff_roles(role_id,name,description,permissions) VALUES('tracking-writer','Tracking writer','Test','["orders:read","orders:write"]'),('tracking-reader','Tracking reader','Test','["orders:read"]')`
  );
}, 40000);
afterAll(async () => {
  await http?.close();
});
async function login(role?: string) {
  const user = randomUUID(),
    session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES($1,$1,'test-only',$2)",
    [user, !!role]
  );
  if (role)
    await http.pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [user, role]);
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at,operating_context) VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW()-INTERVAL '1 second',$5)",
    [session, user, csrf, randomUUID(), role ? 'staff' : 'customer']
  );
  headers[user] = {
    Cookie: `barghsa_session=${session}`,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  };
  return user;
}
async function fixture() {
  const owner = await login(),
    actor = await login('tracking-writer');
  const profile = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status) VALUES($1,'INDIVIDUAL','ACTIVE') RETURNING id",
      [owner]
    )
  ).rows[0].id as string;
  const request = (
    await http.pool.query(
      "INSERT INTO solar_construction_requests(profile_id,submitted_by,submission_key,status,building_type,grid_type,property_form,structural_frame,building_completion_date,agreement_accepted,agreement_version,agreement_snapshot,agreement_accepted_at) VALUES($1,$2,$3,'waiting_for_postal_submission','building_apartment','off_grid','villa','concrete','2020-01-01',true,'fixture-v1','Accepted fixture terms',NOW()) RETURNING id",
      [profile, owner, randomUUID()]
    )
  ).rows[0].id as string;
  await http.pool.query(
    "INSERT INTO solar_construction_postal(request_id,status,courier,tracking_number,send_date) VALUES($1,'shipped','Parcel Co','TRACK-123','2026-01-02')",
    [request]
  );
  return { owner, actor, profile, request };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function send(
  user: string,
  path: string,
  method = 'GET',
  body?: unknown,
  extra?: Record<string, string>
) {
  return fetch(http.base + '/api/' + path, {
    method,
    headers: { ...headers[user], ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const path = (f: Fixture) => `admin/solar/requests/${f.request}/postal/tracking`;
const command = (revision = 0): SolarPostalTrackingCommand => ({
  estimatedArrivalDate: '2026-01-05',
  trackingUrl: 'https://courier.example.org/track/TRACK-123',
  note: 'The courier estimates arrival on January 5. Originals are still awaiting staff confirmation.',
  expectedRevision: revision,
  idempotencyKey: randomUUID(),
});
async function preview(f: Fixture, input = command()) {
  const response = await send(f.actor, path(f) + '/review', 'POST', input);
  expect(response.status, (await response.clone().text()) + http.logs()).toBe(200);
  const review = (await response.json()) as { hash: string; data: Record<string, unknown> };
  return { input: { ...input, expectedReviewHash: review.hash }, review };
}
const record = (f: Fixture, input: unknown, user = f.actor) => send(user, path(f), 'POST', input);
async function row(f: Fixture) {
  return (
    await http.pool.query('SELECT * FROM solar_construction_postal WHERE request_id=$1', [
      f.request,
    ])
  ).rows[0];
}
async function counts(f: Fixture) {
  return (
    await http.pool.query(
      "SELECT (SELECT count(*)::int FROM audit_log WHERE event='solar.postal.tracking_updated' AND metadata::jsonb->>'requestId'=$1) AS audit,(SELECT count(*)::int FROM in_app_notifications WHERE recipient_user_id=$2 AND profile_id=$3) AS notifications",
      [f.request, f.owner, f.profile]
    )
  ).rows[0];
}
it('records a reviewed public update once, preserves the shipment stage, and exposes only customer-safe fields', async () => {
  const f = await fixture();
  expect(await (await send(f.actor, path(f))).json()).toMatchObject({
    canEdit: true,
    revision: 0,
    estimatedArrivalDate: null,
  });
  const { input, review } = await preview(f);
  expect(review.data).toMatchObject({
    courier: 'Parcel Co',
    trackingNumber: 'TRACK-123',
    sendDate: '2026-01-02',
    previousEstimatedArrivalDate: null,
    customerVisible: true,
    confirmsReceipt: false,
    createsContract: false,
    collectsPayment: false,
  });
  const saved = await record(f, input);
  expect(saved.status, (await saved.clone().text()) + http.logs()).toBe(200);
  const result = await saved.json();
  expect(result).toMatchObject({
    revision: 1,
    estimatedArrivalDate: '2026-01-05',
    note: input.note,
    postalStatus: 'shipped',
    requestStatus: 'waiting_for_postal_submission',
  });
  expect(await (await record(f, input)).json()).toEqual(result);
  expect(await counts(f)).toEqual({ audit: 1, notifications: 1 });
  const customer = await send(f.owner, `solar/requests/${f.request}/postal`);
  expect(customer.status, http.logs()).toBe(200);
  const value = (await customer.json()) as { postal: Record<string, unknown> };
  expect(value.postal).toMatchObject({
    estimated_arrival_date: '2026-01-05',
    tracking_url: input.trackingUrl,
    tracking_note: input.note,
    send_date: '2026-01-02',
  });
  expect(value.postal).not.toHaveProperty('tracking_revision');
  expect(value.postal).not.toHaveProperty('staff_confirmed_by');
  expect(JSON.stringify(value)).not.toContain(f.actor);
  expect((await send(await login(), `solar/requests/${f.request}/postal`)).status).toBe(404);
  expect((await record(f, { ...input, note: 'Changed replay' })).status).toBe(409);
  expect((await record(f, { ...input, expectedReviewHash: '0'.repeat(64) })).status).toBe(409);
});
it('rejects stale reviews, invalid arrival dates, unchanged content, and tampered review values without side effects', async () => {
  const f = await fixture(),
    { input } = await preview(f);
  expect((await record(f, { ...input, expectedReviewHash: '0'.repeat(64) })).status).toBe(409);
  expect((await record(f, { ...input, note: 'Different content' })).status).toBe(409);
  expect(
    (
      await send(f.actor, path(f) + '/review', 'POST', {
        ...command(),
        estimatedArrivalDate: '2026-01-01',
      })
    ).status
  ).toBe(409);
  await http.pool.query(
    "UPDATE solar_construction_postal SET tracking_number='NEW-PARCEL' WHERE request_id=$1",
    [f.request]
  );
  expect((await record(f, input)).status).toBe(409);
  expect(await counts(f)).toEqual({ audit: 0, notifications: 0 });
  const fresh = await preview(f, command(1));
  expect((await record(f, fresh.input)).status).toBe(200);
  expect(
    (
      await send(f.actor, path(f) + '/review', 'POST', {
        ...command(2),
        idempotencyKey: randomUUID(),
      })
    ).status
  ).toBe(409);
});
it('enforces live staff role, context, session, step-up and CSRF on writes and replays', async () => {
  const f = await fixture(),
    reader = await login('tracking-reader'),
    { input } = await preview(f);
  expect(await (await send(reader, path(f))).json()).toMatchObject({ canEdit: false });
  expect((await record(f, input, reader)).status).toBe(403);
  expect((await send(f.owner, path(f))).status).toBe(403);
  expect((await send(f.actor, path(f), 'POST', input, { 'X-CSRF-Token': 'wrong' })).status).toBe(
    403
  );
  await http.pool.query('UPDATE sessions SET step_up_verified_at=NULL WHERE user_id=$1', [f.actor]);
  const missingStepUp = await record(f, input);
  expect(missingStepUp.status).toBe(403);
  expect(await missingStepUp.json()).toMatchObject({ requiresStepUp: true });
  await http.pool.query('UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id=$1', [
    f.actor,
  ]);
  expect((await record(f, input)).status).toBe(200);
  await http.pool.query("UPDATE sessions SET operating_context='customer' WHERE user_id=$1", [
    f.actor,
  ]);
  expect((await record(f, input)).status).toBe(403);
  await http.pool.query("UPDATE sessions SET operating_context='staff' WHERE user_id=$1", [
    f.actor,
  ]);
  await http.pool.query('DELETE FROM user_roles WHERE user_id=$1', [f.actor]);
  expect((await record(f, input)).status).toBe(403);
  expect((await send(f.actor, path(f))).status).toBe(403);
  expect(await counts(f)).toEqual({ audit: 1, notifications: 1 });
});
it('clears arrival estimates on receipt or issues and clears all tracking data when a parcel is resent', async () => {
  const f = await fixture(),
    { input } = await preview(f);
  expect((await record(f, input)).status).toBe(200);
  await http.pool.query(
    "UPDATE solar_construction_postal SET status='incomplete' WHERE request_id=$1",
    [f.request]
  );
  expect(await row(f)).toMatchObject({
    estimated_arrival_date: null,
    tracking_note: null,
    tracking_recorded_at: null,
    tracking_url: input.trackingUrl,
    tracking_revision: 2,
  });
  expect((await send(f.actor, path(f) + '/review', 'POST', command(2))).status).toBe(409);
  await http.pool.query(
    "UPDATE solar_construction_postal SET status='shipped',tracking_number='RESEND-456',send_date='2026-01-06' WHERE request_id=$1",
    [f.request]
  );
  expect(await row(f)).toMatchObject({
    estimated_arrival_date: null,
    tracking_url: null,
    tracking_note: null,
    tracking_revision: 3,
  });
  const newInput = await preview(f, {
    ...command(3),
    estimatedArrivalDate: null,
    trackingUrl: null,
    note: 'No arrival estimate is available for this parcel.',
  });
  expect((await record(f, newInput.input)).status).toBe(200);
  await http.pool.query(
    "UPDATE solar_construction_postal SET status='received',staff_confirmed_by=$2,staff_confirmed_at=NOW() WHERE request_id=$1",
    [f.request, f.actor]
  );
  expect(await row(f)).toMatchObject({
    estimated_arrival_date: null,
    tracking_note: null,
    tracking_recorded_at: null,
    tracking_revision: 5,
  });
  expect(await (await send(f.actor, path(f))).json()).toMatchObject({ canEdit: false });
});
it('rolls back tracking, audit, idempotency and notification together when notification storage fails', async () => {
  const f = await fixture(),
    { input } = await preview(f);
  await http.pool.query(
    `CREATE FUNCTION fail_tracking_notification() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Test notification failure'; RETURN NEW; END $$`
  );
  await http.pool.query(
    'CREATE TRIGGER fail_tracking_notification BEFORE INSERT ON in_app_notifications FOR EACH ROW EXECUTE FUNCTION fail_tracking_notification()'
  );
  try {
    expect((await record(f, input)).status).toBe(500);
    expect(await row(f)).toMatchObject({ tracking_revision: 0, estimated_arrival_date: null });
    expect(await counts(f)).toEqual({ audit: 0, notifications: 0 });
  } finally {
    await http.pool.query('DROP TRIGGER fail_tracking_notification ON in_app_notifications');
    await http.pool.query('DROP FUNCTION fail_tracking_notification()');
  }
  expect((await record(f, input)).status).toBe(200);
  expect(await counts(f)).toEqual({ audit: 1, notifications: 1 });
});
it('returns a recoverable conflict for a locked profile and revalidates archived profiles before saving', async () => {
  const f = await fixture(),
    { input } = await preview(f),
    blocker = await http.pool.connect();
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [f.profile]);
    expect((await record(f, input)).status).toBe(409);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
  }
  await http.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [f.profile]);
  expect((await record(f, input)).status).toBe(409);
  expect(await counts(f)).toEqual({ audit: 0, notifications: 0 });
  await http.pool.query('UPDATE profiles SET archived=false WHERE id=$1', [f.profile]);
  expect((await record(f, input)).status).toBe(200);
});
it('accepts one competing reviewed update, rejects the other revision, and permits an exact retry', async () => {
  const f = await fixture(),
    one = await preview(f),
    two = await preview(f, { ...command(), note: 'Another reviewed arrival estimate.' });
  const responses = await Promise.all([record(f, one.input), record(f, two.input)]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  const winner = responses[0]!.status === 200 ? one : two;
  expect((await record(f, winner.input)).status).toBe(200);
  expect(await counts(f)).toEqual({ audit: 1, notifications: 1 });
});
