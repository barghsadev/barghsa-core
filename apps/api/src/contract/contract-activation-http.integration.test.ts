import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
import type { ContractService } from './contract.service.js';
type ContractDto = Awaited<ReturnType<ContractService['get']>>;
let http: Awaited<ReturnType<typeof startHttpFixture>>;
const headers: Record<string, Record<string, string>> = {};
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await login('activation-legal', 'role-legal-contracts');
  await login('activation-support', 'role-customer-support');
  await http.pool.query(
    "INSERT INTO staff_roles(role_id,name,description,permissions) VALUES('test-activation-admin','Activation admin','Test','[\"admin:catalogue:edit\",\"contracts:read\"]')"
  );
  await login('activation-admin', 'test-activation-admin');
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
function send(path: string, method = 'GET', body?: unknown, user = 'activation-legal') {
  return fetch(http.base + '/api/' + path, {
    method,
    headers: headers[user]!,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function fixture(
  serviceType = 'electricity',
  activationContext?: { initialInvoiceId: string | null; serviceStartsAt: string | null }
) {
  const owner = await login(randomUUID()),
    profile = randomUUID();
  await http.pool.query(
    "INSERT INTO profiles(id,user_id,is_default,profile_type) VALUES($1,$2,true,'LEGAL')",
    [profile, owner]
  );
  const response = await send('admin/contracts', 'POST', {
    profileId: profile,
    serviceType,
    ...(activationContext ? { activationContext } : {}),
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
import type { ContractActivationService } from './contract-activation.service.js';
type Activation = Awaited<ReturnType<ContractActivationService['get']>>;
type Rule = Awaited<ReturnType<ContractActivationService['updateRule']>>;

beforeEach(async () => {
  await http.pool.query(
    "UPDATE contract_activation_rules SET signature_required=(service_type='solar'),payment_required=(service_type='electricity'),service_start_required=false,revision=revision+1"
  );
  await http.pool.query(
    "UPDATE sessions SET step_up_verified_at=NOW()-INTERVAL '1 second' WHERE user_id='activation-admin'"
  );
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES('activation-admin','test-activation-admin') ON CONFLICT DO NOTHING"
  );
});
async function rules() {
  const response = await send(
    'admin/contract-activation-rules',
    'GET',
    undefined,
    'activation-admin'
  );
  expect(response.status).toBe(200);
  return (await response.json()) as { rules: Rule[]; canEdit: boolean };
}
async function ruleInput(type: string, extra = {}) {
  const rule = (await rules()).rules.find((r) => r.serviceType === type)!;
  return {
    expectedRevision: rule.revision,
    signatureRequired: rule.signatureRequired,
    paymentRequired: rule.paymentRequired,
    serviceStartRequired: rule.serviceStartRequired,
    idempotencyKey: randomUUID(),
    ...extra,
  };
}
const save = (type: string, body: unknown, user = 'activation-admin') =>
  send('admin/contract-activation-rules/' + type, 'PUT', body, user);
async function activation(f: Awaited<ReturnType<typeof fixture>>, staff = false, suffix = '') {
  const response = await (staff
    ? send('admin/contracts/' + f.row.id + '/activation' + suffix)
    : customer(f, '/activation' + suffix));
  expect(response.status, (await response.clone().text()) + http.logs()).toBe(200);
  return (await response.json()) as Activation;
}
async function accept(f: Awaited<ReturnType<typeof fixture>>) {
  await publish(f);
  expect(
    (
      await send(
        'contracts/' + f.row.id + '/accept',
        'POST',
        command(f.row.currentVersionId),
        f.owner
      )
    ).status
  ).toBe(200);
}
const status = (value: Activation, key: string) =>
  value.checks.find((item) => item.key === key)?.status;
it('authorizes rule reads and writes, validates schema and protects mandatory prerequisites', async () => {
  expect((await fetch(http.base + '/api/admin/contract-activation-rules')).status).toBe(401);
  expect(await (await send('admin/contract-activation-rules')).json()).toMatchObject({
    canEdit: false,
  });
  expect(
    (await send('admin/contract-activation-rules', 'GET', undefined, 'activation-support')).status
  ).toBe(403);
  const input = await ruleInput('electricity');
  expect((await save('electricity', input, 'activation-legal')).status).toBe(403);
  expect((await save('other', input)).status).toBe(400);
  expect((await save('electricity', { ...input, unknown: true })).status).toBe(400);
  expect((await save('electricity', { ...input, paymentRequired: false })).status).toBe(409);
  expect((await save('solar', await ruleInput('solar', { signatureRequired: false }))).status).toBe(
    409
  );
  const headersWithoutCsrf = { ...headers['activation-admin'] };
  delete headersWithoutCsrf['X-CSRF-Token'];
  expect(
    (
      await fetch(http.base + '/api/admin/contract-activation-rules/electricity', {
        method: 'PUT',
        headers: headersWithoutCsrf,
        body: JSON.stringify(input),
      })
    ).status
  ).toBe(403);
  await http.pool.query(
    "UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='activation-admin'"
  );
  expect((await save('electricity', input)).status).toBe(403);
});
it('serializes competing rule revisions, audits once and rechecks permission before replay', async () => {
  const input = await ruleInput('electricity', { signatureRequired: true });
  const before = (
    await http.pool.query(
      "SELECT count(*)::int AS n FROM audit_log WHERE event='contract.activation_rule_changed'"
    )
  ).rows[0].n;
  const requests = [input, { ...input, idempotencyKey: randomUUID(), serviceStartRequired: true }];
  const responses = await Promise.all(requests.map((body) => save('electricity', body)));
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  const winner = responses[0]!.status === 200 ? 0 : 1;
  const result = await responses[winner]!.json();
  expect(await (await save('electricity', requests[winner])).json()).toEqual(result);
  expect(
    (
      await http.pool.query(
        "SELECT count(*)::int AS n FROM audit_log WHERE event='contract.activation_rule_changed'"
      )
    ).rows[0].n
  ).toBe(before + 1);
  await http.pool.query("DELETE FROM user_roles WHERE user_id='activation-admin'");
  expect((await save('electricity', requests[winner])).status).toBe(403);
});
it('keeps draft and other-profile facts private and resolves savings acceptance without activating', async () => {
  const f = await fixture('savings'),
    other = await fixture('savings');
  expect((await customer(f, '/activation')).status).toBe(404);
  expect(status(await activation(f, true), 'staffApproval')).toBe('unmet');
  await publish(f);
  expect(status(await activation(f), 'customerAcceptance')).toBe('unmet');
  expect((await customer(f, '/activation', other.owner)).status).toBe(404);
  expect((await customer(f, '/activation?versionId=' + other.row.currentVersionId)).status).toBe(
    404
  );
  expect((await customer(f, '/activation?versionId=invalid')).status).toBe(400);
  expect(
    (await send('contracts/' + randomUUID() + '/activation', 'GET', undefined, f.owner)).status
  ).toBe(404);
  await send('contracts/' + f.row.id + '/accept', 'POST', command(f.row.currentVersionId), f.owner);
  const result = await activation(f);
  expect(result.ready).toBe(true);
  expect(result.state).toBe('Accepted');
  expect(status(result, 'signature')).toBe('not_required');
  expect(status(result, 'initialPayment')).toBe('not_required');
  expect(status(result, 'serviceStart')).toBe('not_required');
  await http.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [f.profile]);
  expect((await customer(f, '/activation')).status).toBe(404);
  expect((await activation(f, true)).ready).toBe(false);
});
it('keeps payment and approval separate and fails closed when initial funds are refunded', async () => {
  const f = await fixture(),
    invoice = randomUUID();
  await http.pool.query(
    "INSERT INTO invoices(id,profile_id,contract_id,type,state,total_amount,paid_amount) VALUES($1,$2,$3,'manual','Paid',100,100)",
    [invoice, f.profile, f.row.id]
  );
  const edited = await send('admin/contracts/' + f.row.id, 'PATCH', {
    ...command(f.row.currentVersionId),
    content: f.row.currentVersion.content,
    changeDescription: 'Initial invoice',
    activationContext: { initialInvoiceId: invoice, serviceStartsAt: null },
  });
  expect(edited.status).toBe(200);
  f.row = (await edited.json()) as ContractDto;
  const draft = await activation(f, true);
  expect(status(draft, 'initialPayment')).toBe('met');
  expect(draft.ready).toBe(false);
  expect(status(draft, 'staffApproval')).toBe('unmet');
  await accept(f);
  expect((await activation(f)).ready).toBe(true);
  await http.pool.query(
    "UPDATE invoices SET state='PartiallyRefunded',refunded_amount=1 WHERE id=$1",
    [invoice]
  );
  expect(status(await activation(f), 'initialPayment')).toBe('unmet');
  expect((await activation(f)).ready).toBe(false);
});
it('uses captured rules after admin changes and handles missing or future service start evidence', async () => {
  const original = await fixture('savings');
  expect(
    (
      await save(
        'savings',
        await ruleInput('savings', { signatureRequired: true, serviceStartRequired: true })
      )
    ).status
  ).toBe(200);
  const newer = await fixture('savings', {
    initialInvoiceId: null,
    serviceStartsAt: '2099-01-01T00:00:00Z',
  });
  await accept(original);
  await accept(newer);
  expect((await activation(original)).ready).toBe(true);
  const result = await activation(newer);
  expect(status(result, 'signature')).toBe('unmet');
  expect(status(result, 'serviceStart')).toBe('unmet');
  expect(result.ready).toBe(false);
  expect(
    (
      await save(
        'savings',
        await ruleInput('savings', { serviceStartRequired: true, signatureRequired: false })
      )
    ).status
  ).toBe(200);
  const past = await fixture('savings', {
      initialInvoiceId: null,
      serviceStartsAt: '2000-01-01T00:00:00Z',
    }),
    missing = await fixture('savings');
  await accept(past);
  await accept(missing);
  expect((await activation(past)).ready).toBe(true);
  expect(status(await activation(missing), 'serviceStart')).toBe('unmet');
});
