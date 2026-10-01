import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
import { isConfigAuditPage } from '@barghsa/shared/admin';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
const headers: Record<string, Record<string, string>> = {};
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query('DELETE FROM brand_config');
  for (const actor of ['admin', 'reader', 'customer']) {
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash,is_admin,is_staff) VALUES($1,$2,'test-only',$3,$4)",
      [actor, `${actor}@example.test`, actor === 'admin', actor !== 'customer']
    );
    const session = randomUUID(),
      csrf = randomUUID();
    await http.pool.query(
      "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())",
      [session, actor, csrf, randomUUID()]
    );
    headers[actor] = {
      Cookie: `barghsa_session=${session}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    };
  }
  await http.pool.query(
    "INSERT INTO staff_roles(role_id,name,description,permissions) VALUES('audit-reader','Audit reader','Audit fixture',$1::jsonb)",
    [JSON.stringify(['admin:config:read'])]
  );
  await http.pool.query("INSERT INTO user_roles(user_id,role_id) VALUES('reader','audit-reader')");
}, 40000);
afterAll(async () => {
  await http?.close();
});
function call(query: string, actor = 'admin') {
  return fetch(`${http.base}/api/admin/config/audit?${query}`, { headers: headers[actor]! });
}
async function pageResponse(response: Response) {
  expect(response.status).toBe(200);
  const data: unknown = await response.json();
  if (!isConfigAuditPage(data)) throw new Error('Invalid public audit response');
  return data;
}
async function audit(event: string, metadata: unknown, at = '2026-09-30T12:00:00.000001Z') {
  const id = randomUUID();
  await http.pool.query(
    'INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,created_at) VALUES($1,$2,$3,$4::jsonb,$5,$6)',
    [id, 'admin', event, JSON.stringify(metadata), randomUUID(), at]
  );
  return id;
}
it('isolates scopes and exposes only approved field changes, not credentials or raw metadata', async () => {
  await http.pool.query(
    "INSERT INTO audit_log(id,user_id,event,metadata) VALUES($1,'admin','config_change','malformed legacy metadata')",
    [randomUUID()]
  );
  await audit('change_recorded', {
    entity: 'auth_otp',
    previous: { ttlSeconds: 300, version: 1, password: 'never-send' },
    current: { ttlSeconds: 600, version: 2, token: 'never-send' },
    ip: 'private',
    correlationId: 'private',
  });
  await audit('config_change', {
    key: 'admin.service_response_targets',
    previousValue: { ticket: 24, verification_case: 4 },
    newValue: { ticket: null, verification_case: 8 },
    version: 7,
  });
  await audit('config_change', {
    key: 'provider_credentials',
    newValue: { password: 'never-send' },
  });
  const response = await call('scope=otp', 'reader');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('private');
  expect(response.headers.get('cache-control')).toContain('no-store');
  const page = await pageResponse(response);
  expect(page.items).toHaveLength(1);
  expect(page.items[0]).toMatchObject({
    actorId: 'admin',
    version: 2,
    createdAt: '2026-09-30T12:00:00.000001Z',
    changes: [
      {
        field: 'ttlSeconds',
        previous: { recorded: true, value: 300 },
        current: { recorded: true, value: 600 },
      },
    ],
  });
  expect(JSON.stringify(page)).not.toMatch(/never-send|password|token|correlationId|private/);
  const targets = await pageResponse(await call('scope=service-response-targets'));
  expect(targets.items[0]!.changes).toEqual([
    {
      field: 'ticket',
      previous: { recorded: true, value: 24 },
      current: { recorded: true, value: null },
    },
    {
      field: 'verification_case',
      previous: { recorded: true, value: 4 },
      current: { recorded: true, value: 8 },
    },
  ]);
});
it('enforces scope-specific grants, revoked sessions and strict cursor input', async () => {
  expect((await call('scope=branding', 'reader')).status).toBe(403);
  expect((await call('scope=service-response-targets', 'reader')).status).toBe(403);
  expect((await call('scope=otp', 'customer')).status).toBe(403);
  for (const query of [
    'scope=unknown',
    'scope=otp&cursor=bad',
    'scope=otp&cursor[]=bad',
    'scope=otp&scope=branding',
  ])
    expect((await call(query)).status).toBe(400);
  await http.pool.query("UPDATE sessions SET revoked_at=NOW() WHERE user_id='reader'");
  expect((await call('scope=otp', 'reader')).status).toBe(401);
});
it('rechecks session expiry after the audit query waits for a database lock', async () => {
  const lock = await http.pool.connect();
  let response: Promise<Response> | undefined;
  try {
    await lock.query('BEGIN');
    await http.pool.query(
      "UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '3 seconds' WHERE user_id='admin'"
    );
    await lock.query('LOCK TABLE audit_log IN ACCESS EXCLUSIVE MODE');
    response = call('scope=otp');
    let blocked = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const found = await http.pool.query(
        "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%safe.data AS metadata%' LIMIT 1"
      );
      if (found.rows.length) {
        blocked = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(blocked).toBe(true);
    let expired = false;
    for (let attempt = 0; attempt < 250; attempt++) {
      const row = await http.pool.query(
        "SELECT expires_at<=clock_timestamp() AS expired FROM sessions WHERE user_id='admin'"
      );
      if (row.rows[0].expired) {
        expired = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(expired).toBe(true);
    await lock.query('COMMIT');
    expect((await response).status).toBe(401);
  } finally {
    await lock.query('ROLLBACK').catch(() => {});
    lock.release();
    await response?.catch(() => {});
    await http.pool.query(
      "UPDATE sessions SET expires_at=NOW()+INTERVAL '1 day',idle_deadline=NOW()+INTERVAL '30 minutes' WHERE user_id='admin'"
    );
  }
}, 15000);
it('uses microsecond and ID cursor ordering without omitting tied timestamps or mixing scopes', async () => {
  await http.pool.query("DELETE FROM audit_log WHERE event='change_recorded'");
  const ids: string[] = [];
  for (let index = 0; index < 53; index++)
    ids.push(
      await audit(
        'change_recorded',
        {
          entity: 'auth_otp',
          previous: { ttlSeconds: 300 },
          current: { ttlSeconds: 600, version: index + 1 },
        },
        index === 0 ? '2026-09-30T12:00:00.000002Z' : '2026-09-30T12:00:00.000001Z'
      )
    );
  const first = await pageResponse(await call('scope=otp'));
  expect(first.items).toHaveLength(50);
  expect(first.items[0]!.id).toBe(ids[0]);
  expect((await call(`scope=branding&cursor=${first.nextCursor}`)).status).toBe(400);
  const next = await pageResponse(await call(`scope=otp&cursor=${first.nextCursor}`));
  expect(next.items).toHaveLength(3);
  expect(next.nextCursor).toBeNull();
  expect(new Set([...first.items, ...next.items].map((row) => row.id))).toEqual(new Set(ids));
  expect(await (await call(`scope=otp&cursor=${first.nextCursor}`)).json()).toEqual(next);
});
it('records branding draft and publication differences atomically and keeps legacy missing values explicit', async () => {
  const save = async (config: unknown, expectedVersion: number) =>
    fetch(`${http.base}/api/admin/branding/config`, {
      method: 'PUT',
      headers: headers.admin!,
      body: JSON.stringify({ config, expectedVersion }),
    });
  const activate = async (dto: { id: string; version: number }) =>
    fetch(`${http.base}/api/admin/branding/activate`, {
      method: 'POST',
      headers: headers.admin!,
      body: JSON.stringify({ draftId: dto.id, expectedVersion: dto.version }),
    });
  const firstResponse = await save({ appTitle: 'First title' }, 0);
  expect(firstResponse.status).toBe(200);
  const first = (await firstResponse.json()) as { id: string; version: number };
  expect((await activate(first)).status).toBe(200);
  const secondResponse = await save({ appTitle: 'Second title' }, 1);
  expect(secondResponse.status).toBe(200);
  const second = (await secondResponse.json()) as { id: string; version: number };
  expect((await activate(second)).status).toBe(200);
  const page = await pageResponse(await call('scope=branding'));
  const published = page.items.find((row) => row.event === 'activated' && row.version === 2);
  expect(published!.changes).toContainEqual({
    field: 'appTitle',
    previous: { recorded: true, value: 'First title' },
    current: { recorded: true, value: 'Second title' },
  });
  const drafted = page.items.find((row) => row.event === 'draft_created' && row.version === 2);
  expect(drafted!.changes).toContainEqual({
    field: 'appTitle',
    previous: { recorded: true, value: 'First title' },
    current: { recorded: true, value: 'Second title' },
  });
  await audit('branding.draft_created', { configId: second.id, version: 2 });
  const legacy = (await pageResponse(await call('scope=branding'))).items.find(
    (row) => row.id !== drafted!.id && row.event === 'draft_created' && row.version === 2
  );
  expect(legacy!.changes).toContainEqual({
    field: 'appTitle',
    previous: { recorded: false, value: null },
    current: { recorded: true, value: 'Second title' },
  });
  await http.pool
    .query(`CREATE FUNCTION fail_brand_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected'; END $$;
    CREATE TRIGGER fail_brand_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_brand_audit()`);
  try {
    expect((await save({ appTitle: 'Rejected' }, 2)).status).toBe(500);
  } finally {
    await http.pool.query(
      'DROP TRIGGER fail_brand_audit ON audit_log; DROP FUNCTION fail_brand_audit()'
    );
  }
  expect(
    (await http.pool.query('SELECT MAX(version) AS version FROM brand_config')).rows[0].version
  ).toBe(2);
});
