import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest';
import { createServer, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
const providerReplies: ServerResponse[] = [];
const provider = createServer((_request, response) => {
  providerReplies.push(response);
});
let providerBase: string;
const headers: Record<string, Record<string, string>> = {};
beforeAll(async () => {
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const address = provider.address();
  if (!address || typeof address === 'string') throw new Error('Missing local provider port');
  providerBase = `http://127.0.0.1:${address.port}/v1`;
  http = await startHttpFixture(
    process.env.TEST_DATABASE_URL!,
    undefined,
    '',
    10,
    '127.0.0.1',
    true
  );
  await http.pool.query(
    `INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ('test-ai-model','Jobs','Test role','["admin:ai:models","admin:ai:models"]'),('test-ai-model-view','View jobs','Test role','["admin:ai:models"]')`
  );
  for (const [user, role] of [
    ['operator', 'test-ai-model'],
    ['viewer', 'test-ai-model-view'],
    ['other', null],
  ] as const) {
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ($1,$2,'test-only',true)",
      [user, `${user}@example.test`]
    );
    if (role)
      await http.pool.query('INSERT INTO user_roles(user_id,role_id) VALUES ($1,$2)', [user, role]);
    const session = randomUUID(),
      csrf = randomUUID();
    await http.pool.query(
      "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at) VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())",
      [session, user, csrf, randomUUID()]
    );
    headers[user] = {
      Cookie: `barghsa_session=${session}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    };
  }
}, 40000);
afterAll(async () => {
  for (const response of providerReplies) response.destroy();
  provider.closeAllConnections();
  await new Promise<void>((resolve) => provider.close(() => resolve()));
  await http?.close();
}, 15000);
const path = '/api/admin/ai-models';
const input = {
  title: 'Local model',
  providerType: 'openai_compatible',
  baseUrl: 'https://model.example.test/v1',
  modelName: 'test-model',
  apiToken: 'local-secret-never-returned',
};
beforeEach(async () => {
  await http.pool.query('DELETE FROM ai_model_test_jobs; DELETE FROM ai_models');
  await http.pool.query("DELETE FROM audit_log WHERE event LIKE 'ai_model_%'");
});
function request(suffix = '', method = 'GET', body?: unknown) {
  return fetch(`${http.base}${path}${suffix}`, {
    method,
    headers: headers.operator!,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function seed() {
  return (
    await http.pool.query(
      "INSERT INTO ai_models(title,provider_type,base_url,model_name,created_by) VALUES ('Original','openai_compatible','https://model.example.test/v1','original-model','operator') RETURNING id"
    )
  ).rows[0].id as string;
}
it.each(['create', 'update', 'delete'])(
  'rolls back %s when its audit write fails',
  async (action) => {
    const id = await seed();
    await http.pool.query(
      "CREATE OR REPLACE FUNCTION reject_ai_model_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test AI audit failure'; END $$; CREATE TRIGGER reject_ai_model_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.event LIKE 'ai_model_%') EXECUTE FUNCTION reject_ai_model_audit()"
    );
    try {
      const response =
        action === 'create'
          ? await request('', 'POST', input)
          : action === 'update'
            ? await request(`/${id}`, 'PUT', { title: 'Changed' })
            : await request(`/${id}`, 'DELETE');
      expect(response.status).toBe(500);
      const rows = (await http.pool.query('SELECT id,title FROM ai_models')).rows;
      expect(rows).toEqual([{ id, title: 'Original' }]);
    } finally {
      await http.pool.query('DROP TRIGGER reject_ai_model_audit ON audit_log');
    }
  }
);
it.each(['create', 'update', 'delete'])('rejects revoked authority during %s', async (action) => {
  const id = await seed(),
    client = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query("SELECT user_id FROM users WHERE user_id='operator' FOR UPDATE");
    pending =
      action === 'create'
        ? request('', 'POST', input)
        : action === 'update'
          ? request(`/${id}`, 'PUT', { title: 'Changed' })
          : request(`/${id}`, 'DELETE');
    await expect
      .poll(async () =>
        Number(
          (
            await http.pool.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM users u JOIN sessions s%FOR UPDATE OF u%' "
            )
          ).rows[0].count
        )
      )
      .toBe(1);
    await client.query("DELETE FROM user_roles WHERE user_id='operator'");
    await client.query('COMMIT');
    expect((await pending).status).toBe(403);
    expect((await http.pool.query('SELECT id,title FROM ai_models')).rows).toEqual([
      { id, title: 'Original' },
    ]);
    expect(
      (await http.pool.query("SELECT id FROM audit_log WHERE event LIKE 'ai_model_%'")).rows
    ).toHaveLength(0);
    expect(
      (
        await http.pool.query(
          "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'"
        )
      ).rows
    ).toHaveLength(0);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pending;
    await http.pool.query(
      "INSERT INTO user_roles(user_id,role_id) VALUES ('operator','test-ai-model') ON CONFLICT DO NOTHING"
    );
  }
});
it('encrypts tokens, retains masked credentials, clears stale test results and supports explicit removal', async () => {
  const response = await request('', 'POST', input);
  expect(response.status).toBe(201);
  const created = (await response.json()) as { id: string; apiTokenMasked: string };
  expect(JSON.stringify(created)).not.toContain(input.apiToken);
  const encrypted = (
    await http.pool.query('SELECT api_token FROM ai_models WHERE id=$1', [created.id])
  ).rows[0].api_token;
  expect(encrypted).toMatch(/^v1:/);
  expect(encrypted).not.toContain(input.apiToken);
  await http.pool.query(
    "UPDATE ai_models SET last_test_status='passed',last_tested_at=NOW() WHERE id=$1",
    [created.id]
  );
  expect(
    (
      await request(`/${created.id}`, 'PUT', {
        title: 'New title',
        apiToken: created.apiTokenMasked,
      })
    ).status
  ).toBe(200);
  expect(
    (await http.pool.query('SELECT api_token FROM ai_models WHERE id=$1', [created.id])).rows[0]
      .api_token
  ).toBe(encrypted);
  await http.pool.query(
    "UPDATE ai_models SET last_test_status='passed',last_tested_at=NOW() WHERE id=$1",
    [created.id]
  );
  const changed = await request(`/${created.id}`, 'PUT', { modelName: 'new-model' });
  expect(changed.status).toBe(200);
  expect(await changed.json()).toMatchObject({
    status: 'unknown',
    lastTestedAt: null,
    lastTestError: null,
  });
  expect((await request(`/${created.id}`, 'PUT', { apiToken: '' })).status).toBe(200);
  expect(
    (await http.pool.query('SELECT api_token FROM ai_models WHERE id=$1', [created.id])).rows[0]
      .api_token
  ).toBeNull();
  expect((await request(`/${created.id}`, 'DELETE')).status).toBe(204);
  expect(
    JSON.stringify(
      (await http.pool.query("SELECT metadata FROM audit_log WHERE event LIKE 'ai_model_%'")).rows
    )
  ).not.toContain(input.apiToken);
});

it('preserves models referenced by an agent and records no deletion audit', async () => {
  const id = await seed();
  const agent = (
    await http.pool.query(
      "INSERT INTO ai_agents(title,model_id,created_by) VALUES ('Dependent agent',$1,'operator') RETURNING id",
      [id]
    )
  ).rows[0].id;
  try {
    expect((await request(`/${id}`, 'DELETE')).status).toBe(409);
    expect((await http.pool.query('SELECT id FROM ai_models WHERE id=$1', [id])).rows).toHaveLength(
      1
    );
    expect(
      (await http.pool.query("SELECT id FROM audit_log WHERE event='ai_model_deleted'")).rows
    ).toHaveLength(0);
  } finally {
    await http.pool.query('DELETE FROM ai_agents WHERE id=$1', [agent]);
  }
});

it.each(['edit', 'delete', 'revoke', 'audit failure', 'success'] as const)(
  'binds connection results to current model and authority: %s',
  async (action) => {
    const id = await seed();
    await http.pool.query('UPDATE ai_models SET base_url=$1 WHERE id=$2', [providerBase, id]);
    const count = providerReplies.length;
    let pending: Promise<Response> | undefined;
    try {
      pending = request(`/${id}/test`, 'POST');
      await expect.poll(() => providerReplies.length).toBe(count + 1);
      // The slow provider must not keep a database transaction open.
      expect(
        (
          await http.pool.query(
            "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'"
          )
        ).rows
      ).toHaveLength(0);
      if (action === 'edit') {
        // Deliberately preserve updated_at: version checks must not lose precision.
        await http.pool.query("UPDATE ai_models SET model_name='new-model' WHERE id=$1", [id]);
      } else if (action === 'delete') {
        await http.pool.query('DELETE FROM ai_models WHERE id=$1', [id]);
      } else if (action === 'revoke') {
        await http.pool.query("DELETE FROM user_roles WHERE user_id='operator'");
      } else if (action === 'audit failure') {
        await http.pool.query(
          "CREATE OR REPLACE FUNCTION reject_ai_model_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test AI audit failure'; END $$; CREATE TRIGGER reject_ai_model_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.event LIKE 'ai_model_%') EXECUTE FUNCTION reject_ai_model_audit()"
        );
      }
      providerReplies[count]!.writeHead(200, { 'content-type': 'application/json' });
      providerReplies[count]!.end(
        JSON.stringify({ choices: [{ message: { content: 'local pong' } }] })
      );
      const response = await pending;
      expect(response.status).toBe(
        { edit: 409, delete: 404, revoke: 403, 'audit failure': 500, success: 200 }[action]
      );
      const rows = (
        await http.pool.query('SELECT last_test_status FROM ai_models WHERE id=$1', [id])
      ).rows;
      expect(rows).toEqual(
        action === 'delete'
          ? []
          : [{ last_test_status: action === 'success' ? 'passed' : 'pending' }]
      );
      expect(
        (await http.pool.query("SELECT id FROM audit_log WHERE event='ai_model_tested'")).rows
      ).toHaveLength(action === 'success' ? 1 : 0);
      if (action === 'success')
        expect(await response.json()).toMatchObject({
          test: { ok: true, responsePreview: 'local pong' },
        });
    } finally {
      providerReplies[count]?.end();
      await pending;
      if (action === 'audit failure')
        await http.pool.query('DROP TRIGGER IF EXISTS reject_ai_model_audit ON audit_log');
      await http.pool.query(
        "INSERT INTO user_roles(user_id,role_id) VALUES ('operator','test-ai-model') ON CONFLICT DO NOTHING"
      );
    }
  }
);

it('does not overwrite a completed competing test', async () => {
  const id = await seed();
  await http.pool.query('UPDATE ai_models SET base_url=$1 WHERE id=$2', [providerBase, id]);
  const count = providerReplies.length;
  const first = request(`/${id}/test`, 'POST');
  let second: Promise<Response> | undefined;
  try {
    await expect.poll(() => providerReplies.length).toBe(count + 1);
    second = request(`/${id}/test`, 'POST');
    await expect.poll(() => providerReplies.length).toBe(count + 2);
    providerReplies[count + 1]!.end(
      JSON.stringify({ choices: [{ message: { content: 'newer result' } }] })
    );
    expect((await second).status).toBe(200);
    providerReplies[count]!.writeHead(500);
    providerReplies[count]!.end('{}');
    expect((await first).status).toBe(409);
    expect(
      (await http.pool.query('SELECT last_test_status FROM ai_models WHERE id=$1', [id])).rows
    ).toEqual([{ last_test_status: 'passed' }]);
    expect(
      (await http.pool.query("SELECT id FROM audit_log WHERE event='ai_model_tested'")).rows
    ).toHaveLength(1);
  } finally {
    providerReplies[count]?.end();
    providerReplies[count + 1]?.end();
    await Promise.all([first, second]);
  }
});

it.each(['GET', 'PUT', 'DELETE', 'POST'])('rejects malformed model IDs for %s', async (method) => {
  const response = await request(
    `/not-a-uuid${method === 'POST' ? '/test' : ''}`,
    method,
    method === 'PUT' ? { title: 'changed' } : undefined
  );
  expect(response.status).toBe(400);
});

it.each([
  { title: '   ' },
  { modelName: '  ' },
  { baseUrl: 'https://user:password@model.example.test/v1' },
  { baseUrl: 'https://model.example.test/v1?key=secret' },
  { baseUrl: 'https://model.example.test/v1#fragment' },
  { unknownField: true },
])('rejects invalid model fields on create and update: %j', async (invalid) => {
  expect((await request('', 'POST', { ...input, ...invalid })).status).toBe(400);
  const id = await seed();
  expect((await request(`/${id}`, 'PUT', invalid)).status).toBe(400);
  expect(
    (await http.pool.query("SELECT id FROM audit_log WHERE event LIKE 'ai_model_%'")).rows
  ).toHaveLength(0);
});

it.each(['baseUrl', 'providerType'] as const)(
  'requires explicit credential choice before changing %s',
  async (field) => {
    const created = await request('', 'POST', input);
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const change =
      field === 'baseUrl'
        ? { baseUrl: 'https://different.example.test/v1' }
        : { providerType: 'anthropic' };
    for (const token of [undefined, '********rned']) {
      const response = await request(`/${id}`, 'PUT', {
        ...change,
        ...(token === undefined ? {} : { apiToken: token }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: 'AI_MODEL_TOKEN_REENTRY_REQUIRED' },
      });
    }
    expect(
      (await http.pool.query("SELECT id FROM audit_log WHERE event='ai_model_updated'")).rows
    ).toHaveLength(0);
    expect((await request(`/${id}`, 'PUT', { ...change, apiToken: '' })).status).toBe(200);
    expect(
      (await http.pool.query('SELECT api_token FROM ai_models WHERE id=$1', [id])).rows
    ).toEqual([{ api_token: null }]);
  }
);

async function expireDuringAudit(run: () => Promise<void>) {
  await http.pool
    .query(`CREATE OR REPLACE FUNCTION expire_settings_session() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN UPDATE sessions SET expires_at=clock_timestamp()-INTERVAL '1 second' WHERE user_id='operator'; RETURN NEW; END $$;
    CREATE TRIGGER expire_settings_session BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.event LIKE 'ai_model_%') EXECUTE FUNCTION expire_settings_session()`);
  try {
    await run();
  } finally {
    await http.pool.query('DROP TRIGGER expire_settings_session ON audit_log');
    await http.pool.query(
      "UPDATE sessions SET expires_at=NOW()+INTERVAL '1 day',idle_deadline=NOW()+INTERVAL '1 hour',step_up_verified_at=NOW(),revoked_at=NULL,csrf_token=$1 WHERE user_id='operator'",
      [headers.operator!['X-CSRF-Token']]
    );
  }
}

it.each(['create', 'update', 'delete'] as const)(
  'rejects model %s when session expires before commit',
  async (action) => {
    const id = await seed();
    await expireDuringAudit(async () => {
      const response =
        action === 'create'
          ? await request('', 'POST', input)
          : action === 'update'
            ? await request(`/${id}`, 'PUT', { title: 'Changed' })
            : await request(`/${id}`, 'DELETE');
      expect(response.status).toBe(401);
      expect((await http.pool.query('SELECT id,title FROM ai_models')).rows).toEqual([
        { id, title: 'Original' },
      ]);
      expect(
        (await http.pool.query("SELECT id FROM audit_log WHERE event LIKE 'ai_model_%'")).rows
      ).toHaveLength(0);
    });
  }
);
it.each([
  ["expires_at=clock_timestamp()-INTERVAL '1 second'", 401],
  ['revoked_at=clock_timestamp()', 401],
  ["csrf_token='rotated-proof'", 403],
  ['step_up_verified_at=NULL', 403],
] as const)(
  'rejects result after provider wait when session proof changes: %s',
  async (change, status) => {
    const id = await seed();
    await http.pool.query('UPDATE ai_models SET base_url=$1 WHERE id=$2', [providerBase, id]);
    const count = providerReplies.length;
    const pending = request(`/${id}/test`, 'POST');
    try {
      await expect.poll(() => providerReplies.length).toBe(count + 1);
      await http.pool.query(`UPDATE sessions SET ${change} WHERE user_id='operator'`);
      providerReplies[count]!.end(
        JSON.stringify({ choices: [{ message: { content: 'local pong' } }] })
      );
      expect((await pending).status).toBe(status);
      expect(
        (await http.pool.query('SELECT last_test_status FROM ai_models WHERE id=$1', [id])).rows
      ).toEqual([{ last_test_status: 'pending' }]);
      expect(
        (await http.pool.query("SELECT id FROM audit_log WHERE event='ai_model_tested'")).rows
      ).toHaveLength(0);
    } finally {
      providerReplies[count]?.end();
      await pending;
      await http.pool.query(
        "UPDATE sessions SET expires_at=NOW()+INTERVAL '1 day',idle_deadline=NOW()+INTERVAL '1 hour',step_up_verified_at=NOW(),revoked_at=NULL,csrf_token=$1 WHERE user_id='operator'",
        [headers.operator!['X-CSRF-Token']]
      );
    }
  }
);

it('records current step-up proof on the mutation audit', async () => {
  const verifiedAt = new Date(Date.now() - 60_000);
  await http.pool.query("UPDATE sessions SET step_up_verified_at=$1 WHERE user_id='operator'", [
    verifiedAt,
  ]);
  expect((await request('', 'POST', input)).ok).toBe(true);
  const rows = (
    await http.pool.query(
      "SELECT metadata::jsonb AS metadata FROM audit_log WHERE event LIKE 'ai_model_%'"
    )
  ).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0].metadata).toMatchObject({
    stepUpVerified: true,
    stepUpVerifiedAt: verifiedAt.toISOString(),
  });
});
