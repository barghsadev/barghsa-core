import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
import type { ContractService } from './contract.service.js';
import type { ContractCancellationService } from './contract-cancellation.service.js';
type Intent = Awaited<ReturnType<ContractCancellationService['get']>>;
interface RequestDto {
  id: string;
  status: string;
  contractState: string;
}
type ContractDto = Awaited<ReturnType<ContractService['get']>>;
let http: Awaited<ReturnType<typeof startHttpFixture>>;
const headers: Record<string, Record<string, string>> = {};
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await login('request-legal', 'role-legal-contracts');
  await login('request-support', 'role-customer-support');
  await login('request-finance', 'role-finance');
}, 40000);
afterAll(async () => {
  await http?.close();
});
async function login(user: string, role?: string) {
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES($1,$1,'test',$2)",
    [user, !!role]
  );
  if (role)
    await http.pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [user, role]);
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW()-INTERVAL '1 second')",
    [session, user, csrf, randomUUID()]
  );
  headers[user] = {
    Cookie: `barghsa_session=${session}`,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  };
  return user;
}
function send(path: string, method = 'GET', body?: unknown, user = 'request-legal') {
  return fetch(http.base + '/api/' + path, {
    method,
    headers: headers[user]!,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function fixture() {
  const owner = await login(randomUUID()),
    profile = randomUUID();
  await http.pool.query(
    "INSERT INTO profiles(id,user_id,is_default,profile_type) VALUES($1,$2,true,'LEGAL')",
    [profile, owner]
  );
  const response = await send('admin/contracts', 'POST', {
    profileId: profile,
    serviceType: 'electricity',
    content: { price: '9007199254740993' },
    changeDescription: 'Initial',
    idempotencyKey: randomUUID(),
  });
  expect(response.status).toBe(201);
  return { owner, profile, row: (await response.json()) as ContractDto };
}
const command = (version: string) => ({ expectedVersionId: version, idempotencyKey: randomUUID() });
const action = (id: string, which: string, body: unknown) =>
  send('admin/contracts/' + id + '/' + which, 'POST', body);
async function publish(f: Awaited<ReturnType<typeof fixture>>) {
  expect((await action(f.row.id, 'submit', command(f.row.currentVersionId))).status).toBe(200);
  expect((await action(f.row.id, 'publish', command(f.row.currentVersionId))).status).toBe(200);
}
async function customer(f: Awaited<ReturnType<typeof fixture>>, suffix = '', user = f.owner) {
  return send('contracts/' + f.row.id + suffix, 'GET', undefined, user);
}
beforeEach(async () => {
  await http.pool.query(
    "INSERT INTO app_config(key,value) VALUES('finance.dual_approval_threshold','{\"threshold_irr\":0}') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value"
  );
});
const requestBody = (f: Awaited<ReturnType<typeof fixture>>) => ({
  ...command(f.row.currentVersionId),
  reason: 'Please end service',
  preferredDestination: 'external_bank',
});
async function submit(
  f: Awaited<ReturnType<typeof fixture>>,
  body = requestBody(f),
  user = f.owner
) {
  return send('contracts/' + f.row.id + '/cancellation-requests', 'POST', body, user);
}
async function prepare(f: Awaited<ReturnType<typeof fixture>>, customerRequestId?: string) {
  const preview = (await (
    await send('admin/contracts/' + f.row.id + '/cancellation-preview')
  ).json()) as { fingerprint: string };
  return send('admin/contracts/' + f.row.id + '/cancellations', 'POST', {
    ...command(f.row.currentVersionId),
    expectedFingerprint: preview.fingerprint,
    reason: 'Approved customer request',
    refundDecision: { mode: 'full_wallet' },
    ...(customerRequestId ? { customerRequestId } : {}),
  });
}
async function execute(f: Awaited<ReturnType<typeof fixture>>, intentId: string) {
  return send('admin/contracts/' + f.row.id + '/cancellations/execute', 'POST', {
    intentId,
    idempotencyKey: randomUUID(),
  });
}
async function reject(id: string, reason = 'Please contact support', user = 'request-legal') {
  return send(
    'admin/contract-cancellation-requests/' + id + '/reject',
    'POST',
    { reason, idempotencyKey: randomUUID() },
    user
  );
}
it('creates only a staff review request, preserves exact retries and exposes it to authorized staff', async () => {
  const f = await fixture();
  await publish(f);
  const body = requestBody(f);
  const response = await submit(f, body);
  expect(response.status, await response.clone().text()).toBe(201);
  const request = (await response.json()) as RequestDto;
  expect(request).toMatchObject({
    status: 'Pending',
    reason: body.reason,
    preferredDestination: 'external_bank',
  });
  expect(await (await submit(f, body)).json()).toEqual(request);
  expect((await submit(f)).status).toBe(409);
  expect(
    (await http.pool.query('SELECT state FROM contracts WHERE id=$1', [f.row.id])).rows[0].state
  ).toBe('AwaitingCustomerAcceptance');
  expect(
    (
      await http.pool.query('SELECT count(*)::int AS n FROM refunds WHERE profile_id=$1', [
        f.profile,
      ])
    ).rows[0].n
  ).toBe(0);
  expect(await (await customer(f, '/cancellation-requests')).json()).toMatchObject({
    request: { id: request.id },
    canRequest: false,
  });
  const queue = (await (await send('admin/contract-cancellation-requests')).json()) as {
    requests: RequestDto[];
  };
  expect(queue.requests.some((r: { id: string }) => r.id === request.id)).toBe(true);
  expect(
    (await send('admin/contract-cancellation-requests', 'GET', undefined, 'request-support')).status
  ).toBe(403);
  expect(
    (
      await http.pool.query(
        "SELECT count(*)::int AS n FROM audit_log WHERE event='contract.cancellation_requested' AND metadata::jsonb->>'requestId'=$1",
        [request.id]
      )
    ).rows[0].n
  ).toBe(1);
});
it('keeps drafts and other profiles private and rejects stale or malformed submissions', async () => {
  const f = await fixture(),
    other = await fixture();
  expect((await submit(f)).status).toBe(404);
  await publish(f);
  expect((await submit(f, requestBody(f), other.owner)).status).toBe(404);
  expect((await customer(f, '/cancellation-requests', other.owner)).status).toBe(404);
  expect((await submit(f, { ...requestBody(f), expectedVersionId: randomUUID() })).status).toBe(
    409
  );
  expect((await submit(f, { ...requestBody(f), reason: ' ' })).status).toBe(400);
  expect(
    (await fetch(http.base + '/api/contracts/' + f.row.id + '/cancellation-requests')).status
  ).toBe(401);
});
it('requires current password verification and customer signing authority', async () => {
  const f = await fixture();
  await publish(f);
  await http.pool.query('UPDATE sessions SET step_up_verified_at=NULL WHERE user_id=$1', [f.owner]);
  expect((await submit(f)).status).toBe(403);
  await http.pool.query(
    "UPDATE sessions SET step_up_verified_at=NOW()-INTERVAL '1 second' WHERE user_id=$1",
    [f.owner]
  );
  const agent = await login(randomUUID());
  await http.pool.query(
    "INSERT INTO profile_agents(profile_id,user_id,role) VALUES($1,$2,'Finance')",
    [f.profile, agent]
  );
  await http.pool.query('INSERT INTO user_profile_contexts(profile_id,user_id) VALUES($1,$2)', [
    f.profile,
    agent,
  ]);
  expect((await submit(f, requestBody(f), agent)).status).toBe(404);
  expect((await customer(f, '/cancellation-requests', agent)).status).toBe(404);
});
it('rejects with an explanation, keeps service unchanged and permits a new request', async () => {
  const f = await fixture();
  await publish(f);
  const r = (await (await submit(f)).json()) as RequestDto;
  expect((await reject(r.id, ' ')).status).toBe(400);
  expect((await reject(r.id, 'No', 'request-support')).status).toBe(403);
  const response = await reject(r.id);
  expect(response.status, await response.clone().text()).toBe(201);
  expect(await response.json()).toMatchObject({
    status: 'Rejected',
    resolutionReason: 'Please contact support',
  });
  expect(await (await customer(f, '/cancellation-requests')).json()).toMatchObject({
    request: { status: 'Rejected' },
    canRequest: true,
  });
  expect((await reject(r.id)).status).toBe(409);
  expect((await submit(f)).status).toBe(201);
  expect(
    (await http.pool.query('SELECT state FROM contracts WHERE id=$1', [f.row.id])).rows[0].state
  ).toBe('AwaitingCustomerAcceptance');
});
it('fulfills a bound request only after cancellation and mandatory wallet obligations commit', async () => {
  const f = await fixture();
  await publish(f);
  await http.pool.query('INSERT INTO wallets(profile_id) VALUES($1)', [f.profile]);
  await http.pool.query(
    "INSERT INTO invoices(id,profile_id,contract_id,state,total_amount,paid_amount) VALUES($1,$2,$3,'Paid',100,100)",
    [randomUUID(), f.profile, f.row.id]
  );
  await http.pool.query(
    "UPDATE app_config SET value='{\"threshold_irr\":100}' WHERE key='finance.dual_approval_threshold'"
  );
  const r = (await (await submit(f)).json()) as RequestDto,
    p = await prepare(f, r.id);
  expect(p.status, await p.clone().text()).toBe(201);
  const intent = (await p.json()) as Intent;
  expect(intent).toMatchObject({ customerRequestId: r.id, status: 'awaiting_approval' });
  expect((await execute(f, intent.id)).status).toBe(409);
  expect(await (await customer(f, '/cancellation-requests')).json()).toMatchObject({
    request: { status: 'Pending' },
  });
  expect(
    (
      await send(
        'admin/approval-requests/' + intent.approvalRequestId + '/approve',
        'POST',
        {},
        'request-finance'
      )
    ).status
  ).toBe(200);
  const result = await execute(f, intent.id);
  expect(result.status, await result.clone().text()).toBe(201);
  expect(await result.json()).toMatchObject({
    state: 'Cancelled',
    refunds: [{ destination: 'wallet', amount: '100' }],
  });
  expect(await (await customer(f, '/cancellation-requests')).json()).toMatchObject({
    request: { status: 'Fulfilled', resolutionReason: 'Approved customer request' },
    canRequest: false,
  });
  expect(
    (
      await http.pool.query(
        "SELECT count(*)::int AS n FROM audit_log WHERE event='contract.cancellation_request_fulfilled' AND metadata::jsonb->>'requestId'=$1",
        [r.id]
      )
    ).rows[0].n
  ).toBe(1);
});
it('cannot execute a decision after rejection and reports independent termination truthfully', async () => {
  const f = await fixture();
  await publish(f);
  const r = (await (await submit(f)).json()) as RequestDto,
    intent = (await (await prepare(f, r.id)).json()) as Intent;
  expect((await reject(r.id)).status).toBe(201);
  expect(
    await (await send('admin/contracts/' + f.row.id + '/cancellations/' + intent.id)).json()
  ).toMatchObject({ status: 'rejected', customerRequestId: r.id });
  expect((await execute(f, intent.id)).status).toBe(409);
  await submit(f);
  const independent = (await (await prepare(f)).json()) as Intent;
  expect((await execute(f, independent.id)).status).toBe(201);
  expect(await (await customer(f, '/cancellation-requests')).json()).toMatchObject({
    request: { status: 'Closed', contractState: 'Cancelled' },
    canRequest: false,
  });
});
it('serializes competing submissions without duplicate review tasks', async () => {
  const f = await fixture();
  await publish(f);
  const responses = await Promise.all([submit(f), submit(f)]);
  expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
});
it('rolls back a request when its notification cannot be persisted', async () => {
  const f = await fixture();
  await publish(f);
  await http.pool.query(
    "CREATE FUNCTION fail_cancel_request_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'notice unavailable'; END $$"
  );
  await http.pool.query(
    'CREATE TRIGGER fail_cancel_request_notice BEFORE INSERT ON in_app_notifications FOR EACH ROW EXECUTE FUNCTION fail_cancel_request_notice()'
  );
  try {
    expect((await submit(f)).status).toBe(500);
  } finally {
    await http.pool.query('DROP TRIGGER fail_cancel_request_notice ON in_app_notifications');
  }
  expect(
    (
      await http.pool.query(
        'SELECT count(*)::int AS n FROM contract_cancellation_requests WHERE contract_id=$1',
        [f.row.id]
      )
    ).rows[0].n
  ).toBe(0);
  expect((await submit(f)).status).toBe(201);
});
it('rolls back fulfillment and cancellation together if the customer notice fails', async () => {
  const f = await fixture();
  await publish(f);
  const r = (await (await submit(f)).json()) as RequestDto,
    intent = (await (await prepare(f, r.id)).json()) as Intent;
  await http.pool.query(
    "CREATE FUNCTION fail_cancel_fulfillment_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'notice unavailable'; END $$"
  );
  await http.pool.query(
    'CREATE TRIGGER fail_cancel_fulfillment_notice BEFORE INSERT ON in_app_notifications FOR EACH ROW EXECUTE FUNCTION fail_cancel_fulfillment_notice()'
  );
  try {
    expect((await execute(f, intent.id)).status).toBe(500);
  } finally {
    await http.pool.query('DROP TRIGGER fail_cancel_fulfillment_notice ON in_app_notifications');
  }
  expect(await (await customer(f, '/cancellation-requests')).json()).toMatchObject({
    request: { status: 'Pending', contractState: 'AwaitingCustomerAcceptance' },
  });
  expect(
    (
      await http.pool.query(
        'SELECT count(*)::int AS n FROM contract_cancellations WHERE contract_id=$1',
        [f.row.id]
      )
    ).rows[0].n
  ).toBe(0);
  expect((await execute(f, intent.id)).status).toBe(201);
});
it('serializes rejection against cancellation and retains the winning outcome', async () => {
  const f = await fixture();
  await publish(f);
  const r = (await (await submit(f)).json()) as RequestDto,
    intent = (await (await prepare(f, r.id)).json()) as Intent;
  const responses = await Promise.all([reject(r.id), execute(f, intent.id)]);
  expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
  const latest = (await (await customer(f, '/cancellation-requests')).json()) as {
    request: RequestDto;
  };
  expect(['Rejected', 'Fulfilled']).toContain(latest.request.status);
  expect(latest.request.contractState).toBe(
    latest.request.status === 'Fulfilled' ? 'Cancelled' : 'AwaitingCustomerAcceptance'
  );
});
it('returns current request status on submission replay and blocks mismatched retry payloads', async () => {
  const f = await fixture();
  await publish(f);
  const body = requestBody(f);
  const r = (await (await submit(f, body)).json()) as RequestDto;
  await reject(r.id);
  expect(await (await submit(f, body)).json()).toMatchObject({ id: r.id, status: 'Rejected' });
  expect((await submit(f, { ...body, reason: 'Changed payload' })).status).toBe(409);
});
it('requires CSRF and denies a staff user whose cancellation permission was revoked', async () => {
  const f = await fixture();
  await publish(f);
  const response = await fetch(
    http.base + '/api/contracts/' + f.row.id + '/cancellation-requests',
    {
      method: 'POST',
      headers: { Cookie: headers[f.owner]!.Cookie!, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody(f)),
    }
  );
  expect(response.status).toBe(403);
  const r = (await (await submit(f)).json()) as RequestDto,
    staff = await login(randomUUID(), 'role-legal-contracts');
  await http.pool.query('DELETE FROM user_roles WHERE user_id=$1', [staff]);
  expect((await reject(r.id, 'Decline', staff)).status).toBe(403);
  expect(
    (await http.pool.query('SELECT status FROM contract_cancellation_requests WHERE id=$1', [r.id]))
      .rows[0].status
  ).toBe('Pending');
});
