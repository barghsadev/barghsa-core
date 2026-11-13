import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
import type { AdminService } from './admin.service.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
const headers: Record<string, Record<string, string>> = {};
const ttl = 'wizard-draft-ttl';
const templates = 'electricity-contract-template';
type History = Awaited<ReturnType<AdminService['electricityRecoveryHistory']>>;
type Draft = Awaited<ReturnType<AdminService['stageElectricityRecovery']>>;

beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    `INSERT INTO staff_roles(role_id,name,description,permissions)
     VALUES ('test-settings-recovery','Configuration test','Fixture','["admin:catalogue:edit"]')`
  );
  for (const [user, granted, verified] of [
    ['editor', true, true],
    ['reviewer', true, false],
    ['ungranted', false, true],
  ] as const) {
    const session = randomUUID();
    const csrf = randomUUID();
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES($1,$2,'test-only',true)",
      [user, `${user}@example.test`]
    );
    if (granted)
      await http.pool.query(
        "INSERT INTO user_roles(user_id,role_id) VALUES($1,'test-settings-recovery')",
        [user]
      );
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
       VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',CASE WHEN $5 THEN NOW() END)`,
      [session, user, csrf, randomUUID(), verified]
    );
    headers[user] = {
      cookie: `barghsa_session=${session}`,
      'x-csrf-token': csrf,
      'content-type': 'application/json',
    };
  }
}, 40_000);

afterAll(async () => http?.close(), 15_000);

function request(setting: string, path = '', body?: object, user = 'editor') {
  return fetch(`${http.base}/api/admin/config/${setting}${path}`, {
    headers: headers[user]!,
    ...(body && { method: path ? 'POST' : 'PUT', body: JSON.stringify(body) }),
  });
}

it('stages a prior retention value without affecting live drafts and activates it once', async () => {
  expect((await request('electricity-order-draft-ttl', '', { days: 7 })).status).toBe(200);
  expect((await request(ttl, '', { days: 13 })).status).toBe(200);
  expect((await request(ttl, '/rollback-history', undefined, 'ungranted')).status).toBe(403);
  const history = await request(ttl, '/rollback-history');
  expect(history.status).toBe(200);
  const page = (await history.json()) as History;
  expect(page).toEqual({
    baseVersion: 2,
    items: [{ id: expect.any(String), version: 1, config: { days: 7 } }],
    draft: null,
    nextBeforeVersion: null,
  });
  const stage = { sourceId: page.items[0]!.id, expectedVersion: 2 };
  expect((await request(ttl, '/rollback-draft', stage, 'reviewer')).status).toBe(403);
  expect((await request(ttl, '/rollback-draft', { ...stage, days: 1 })).status).toBe(400);
  expect((await request(ttl, '/rollback-draft', { ...stage, expectedVersion: 1 })).status).toBe(
    409
  );
  const result = await request(ttl, '/rollback-draft', stage);
  expect(result.status).toBe(201);
  const draft = (await result.json()) as Draft;
  expect(draft).toEqual({
    id: expect.any(String),
    baseVersion: 2,
    sourceId: stage.sourceId,
    sourceVersion: 1,
    config: { days: 7 },
  });
  expect(await (await request(ttl, '/rollback-draft', stage)).json()).toEqual(draft);
  expect(await (await request(ttl)).json()).toEqual({ days: 13 });
  const activate = { draftId: draft.id, expectedVersion: 2 };
  expect((await request(ttl, '/rollback-activate', activate, 'reviewer')).status).toBe(403);
  const outcomes = await Promise.all([
    request(ttl, '/rollback-activate', activate),
    request(ttl, '/rollback-activate', activate),
  ]);
  expect(outcomes.map(({ status }) => status).sort()).toEqual([200, 409]);
  expect(await outcomes.find(({ status }) => status === 200)!.json()).toEqual({
    version: 3,
    draftId: draft.id,
    config: { days: 7 },
  });
  expect(await (await request(ttl)).json()).toEqual({ days: 7 });
  const audits = await http.pool.query(
    "SELECT metadata::jsonb AS data FROM audit_log WHERE event='config_change' AND metadata::jsonb->>'draftId'=$1",
    [draft.id]
  );
  expect(audits.rows).toEqual([
    {
      data: {
        key: 'electricity.order_draft_ttl_days',
        previousValue: 13,
        previousVersion: 2,
        newValue: 7,
        version: 3,
        action: 'rollback_activated',
        draftId: draft.id,
        sourceId: stage.sourceId,
        sourceVersion: 1,
        stepUpVerified: true,
        stepUpVerifiedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      },
    },
  ]);
});

it('validates a template again at activation and preserves an explicit no-template selection', async () => {
  const templateId = randomUUID();
  const versionId = randomUUID();
  await http.pool.query(
    "INSERT INTO contract_templates(id,name,created_by) VALUES($1,'Fixture','editor')",
    [templateId]
  );
  await http.pool.query(
    `INSERT INTO contract_template_versions(id,template_id,version_number,storage_key,file_name,placeholders,created_by)
     VALUES($1,$2,1,'fixture/template.txt','template.txt',ARRAY['customerName'],'editor')`,
    [versionId, templateId]
  );
  for (const id of [versionId, null, null])
    expect((await request(templates, '', { versionId: id })).status).toBe(200);
  const { items } = (await (await request(templates, '/rollback-history')).json()) as History;
  expect(items).toEqual([
    { id: expect.any(String), version: 2, config: { versionId: null } },
    { id: expect.any(String), version: 1, config: { versionId } },
  ]);
  expect(
    (await request(templates, '/rollback-draft', { sourceId: randomUUID(), expectedVersion: 3 }))
      .status
  ).toBe(404);
  const staged = await request(templates, '/rollback-draft', {
    sourceId: items[1]!.id,
    expectedVersion: 3,
  });
  expect(staged.status).toBe(201);
  const draft = (await staged.json()) as Draft;
  await http.pool.query("UPDATE contract_templates SET status='inactive' WHERE id=$1", [
    templateId,
  ]);
  expect(
    (await request(templates, '/rollback-activate', { draftId: draft.id, expectedVersion: 3 }))
      .status
  ).toBe(400);
  expect(await (await request(templates)).json()).toMatchObject({ selectedVersionId: null });
  expect(
    (
      await http.pool.query(
        "SELECT version FROM app_config WHERE key='electricity.contract_template_version_id'"
      )
    ).rows
  ).toEqual([{ version: 3 }]);
  const cleared = await request(templates, '/rollback-draft', {
    sourceId: items[0]!.id,
    expectedVersion: 3,
  });
  expect(cleared.status).toBe(201);
  const replacement = (await cleared.json()) as Draft;
  expect(
    (await request(templates, '/rollback-activate', { draftId: draft.id, expectedVersion: 3 }))
      .status
  ).toBe(409);
  const activated = await request(templates, '/rollback-activate', {
    draftId: replacement.id,
    expectedVersion: 3,
  });
  expect(activated.status).toBe(200);
  expect(await activated.json()).toEqual({
    version: 4,
    draftId: replacement.id,
    config: { versionId: null },
  });
});
