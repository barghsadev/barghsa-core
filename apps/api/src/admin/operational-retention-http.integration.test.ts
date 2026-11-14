import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { defaultOperationalRetention } from '@barghsa/shared/admin';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
const headers = new Map<string, Record<string, string>>();
const path = '/api/admin/config/operational-retention';
const key = 'observability.operational_retention';

beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  for (const [user, permission, steppedUp] of [
    ['editor', 'admin:config:write', true],
    ['reader', 'admin:config:read', true],
    ['stale', 'admin:config:write', false],
    ['other', 'admin:catalogue:edit', true],
  ] as const) {
    await http.pool.query(
      'INSERT INTO staff_roles(role_id,name,description,permissions) VALUES($1,$1,$1,$2::jsonb)',
      [user, JSON.stringify([permission])]
    );
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES($1,$2,'test-only',true)",
      [user, `${user}@example.test`]
    );
    await http.pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$1)', [user]);
    const session = randomUUID();
    const csrf = randomUUID();
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
       VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',$5)`,
      [session, user, csrf, randomUUID(), steppedUp ? new Date() : null]
    );
    headers.set(user, {
      Cookie: `barghsa_session=${session}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    });
  }
}, 40_000);
afterAll(async () => {
  await http?.close();
}, 15_000);

const read = (user: string, suffix = '') =>
  fetch(http.base + path + suffix, { headers: new Headers(headers.get(user)) });
function save(user: string, body: object, includeCsrf = true) {
  const requestHeaders = new Headers(headers.get(user));
  if (!includeCsrf) requestHeaders.delete('X-CSRF-Token');
  return fetch(http.base + path, {
    method: 'PUT',
    headers: requestHeaders,
    body: JSON.stringify(body),
  });
}
function recover(user: string, action: 'draft' | 'activate', body: object, includeCsrf = true) {
  const requestHeaders = new Headers(headers.get(user));
  if (!includeCsrf) requestHeaders.delete('X-CSRF-Token');
  return fetch(`${http.base}${path}/rollback-${action}`, {
    method: 'POST',
    headers: requestHeaders,
    body: JSON.stringify(body),
  });
}

it('restricts access, validates legal boundaries and serializes audited policy saves', async () => {
  expect((await read('anonymous')).status).toBe(401);
  expect((await read('other', '/export')).status).toBe(403);
  expect(await (await read('reader')).json()).toEqual({
    version: 0,
    policy: defaultOperationalRetention,
    canEdit: false,
  });
  const policy = { ...defaultOperationalRetention, searchableLogsDays: 45, ordinaryTracesDays: 12 };
  const input = { expectedVersion: 0, policy };
  expect((await save('reader', input)).status).toBe(403);
  expect((await save('stale', input)).status).toBe(403);
  expect((await save('editor', input, false)).status).toBe(403);
  for (const invalid of [
    { legalAuditDays: 1 },
    { searchableLogsDays: 29 },
    { metricsArchiveDays: 399 },
    { ordinaryTracesDays: 31 },
    { priorityTracesDays: 29 },
    { searchableLogsDays: 42.5 },
  ]) {
    expect((await save('editor', { ...input, policy: { ...policy, ...invalid } })).status).toBe(
      400
    );
  }
  const results = await Promise.all([save('editor', input), save('editor', input)]);
  expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
  const receipt = { version: 1, policy, canEdit: true };
  expect(await results.find((result) => result.ok)!.json()).toEqual(receipt);
  const download = await read('reader', '/export');
  expect(download.status).toBe(200);
  expect(download.headers.get('cache-control')).toBe(
    'private, no-cache, no-store, must-revalidate'
  );
  expect(download.headers.get('content-disposition')).toBe(
    'attachment; filename="operational-retention.json"'
  );
  expect(await download.json()).toEqual({ ...receipt, canEdit: false });
  const { rows } = await http.pool.query(
    "SELECT user_id,metadata::jsonb AS metadata FROM audit_log WHERE event='config_change' AND metadata::jsonb->>'key'=$1",
    [key]
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    user_id: 'editor',
    metadata: {
      previous: { version: 0, policy: defaultOperationalRetention },
      next: { version: 1, policy },
    },
  });

  expect((await read('reader', '/rollback-history')).status).toBe(403);
  expect((await read('editor', '/rollback-history?beforeVersion=0')).status).toBe(400);
  const laterPolicy = { ...policy, searchableLogsDays: 60 };
  expect((await save('editor', { expectedVersion: 1, policy: laterPolicy })).status).toBe(200);
  const history = await read('editor', '/rollback-history');
  expect(history.status).toBe(200);
  expect(history.headers.get('cache-control')).toContain('no-store');
  const body = (await history.json()) as { items: { id: string }[] };
  expect(body).toEqual({
    baseVersion: 2,
    items: [{ id: expect.any(String), version: 1, config: policy }],
    draft: null,
    nextBeforeVersion: null,
  });
  expect(await (await read('editor', '/rollback-history?beforeVersion=1')).json()).toMatchObject({
    items: [],
  });
  const sourceId = body.items[0]!.id;
  const stage = { expectedVersion: 2, sourceId };
  expect((await recover('reader', 'draft', stage)).status).toBe(403);
  expect((await recover('stale', 'draft', stage)).status).toBe(403);
  expect((await recover('editor', 'draft', stage, false)).status).toBe(403);
  expect((await recover('editor', 'draft', { ...stage, policy })).status).toBe(400);
  expect((await recover('editor', 'draft', { ...stage, sourceId: randomUUID() })).status).toBe(404);
  const staged = await recover('editor', 'draft', stage);
  expect(staged.status).toBe(201);
  const draft = (await staged.json()) as { id: string };
  expect(draft).toEqual({
    id: expect.any(String),
    baseVersion: 2,
    sourceId,
    sourceVersion: 1,
    config: policy,
  });
  expect(await (await recover('editor', 'draft', stage)).json()).toEqual(draft);
  expect(await (await read('editor')).json()).toEqual({
    version: 2,
    policy: laterPolicy,
    canEdit: true,
  });
  expect(await (await read('editor', '/rollback-history')).json()).toMatchObject({ draft });

  const activation = { expectedVersion: 2, draftId: draft.id };
  expect((await recover('stale', 'activate', activation)).status).toBe(403);
  expect((await recover('editor', 'activate', activation, false)).status).toBe(403);
  expect(
    (await recover('editor', 'activate', { ...activation, draftId: randomUUID() })).status
  ).toBe(409);
  const activations = await Promise.all([
    recover('editor', 'activate', activation),
    recover('editor', 'activate', activation),
  ]);
  expect(activations.map((result) => result.status).sort()).toEqual([200, 409]);
  expect(await activations.find((result) => result.ok)!.json()).toEqual({
    version: 3,
    config: policy,
    draftId: draft.id,
  });
  expect(await (await read('editor', '/export')).json()).toEqual({
    version: 3,
    policy,
    canEdit: true,
  });
  expect(await (await read('editor', '/rollback-history')).json()).toMatchObject({ draft: null });
  const audits = await http.pool.query(
    `SELECT event,metadata::jsonb AS data FROM audit_log WHERE metadata IS JSON OBJECT
     AND metadata::jsonb->>'key'=$1 AND event IN ('config_change','operational_retention.rollback_draft')
     ORDER BY created_at,id`,
    [key]
  );
  expect(audits.rows.map((row) => row.event)).toEqual([
    'config_change',
    'config_change',
    'operational_retention.rollback_draft',
    'config_change',
  ]);
  expect(audits.rows[3].data).toMatchObject({
    action: 'activate',
    draftId: draft.id,
    restoredFrom: { id: sourceId, version: 1 },
    previous: { version: 2, policy: laterPolicy },
    next: { version: 3, policy },
  });
  await http.pool.query("UPDATE app_config SET value='{}'::jsonb WHERE key=$1", [key]);
  expect((await read('editor')).status).toBe(503);
  expect((await save('editor', { ...input, expectedVersion: 3 })).status).toBe(503);
});
