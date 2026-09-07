import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let headers: Record<string, string>;
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  http = await startHttpFixture(process.env.TEST_DATABASE_URL);
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_admin,is_staff) VALUES ('branding-review','branding-review@example.test','test-only',true,true)"
  );
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at) VALUES ($1,'branding-review',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '1 hour',NOW())",
    [session, csrf, randomUUID()]
  );
  headers = {
    cookie: `barghsa_session=${session}`,
    'x-csrf-token': csrf,
    'content-type': 'application/json',
  };
}, 40_000);
beforeEach(async () => {
  await http.pool.query('DELETE FROM brand_config');
  await http.pool.query(
    "UPDATE users SET is_admin=true WHERE user_id='branding-review'; UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='branding-review'"
  );
});
afterAll(async () => {
  await http?.close();
});
const request = (path: string, method = 'GET', body?: unknown) =>
  fetch(`${http.base}/api/${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const publicConfig = async () => {
  const response = await fetch(`${http.base}/api/public/branding/config`);
  expect(response.status).toBe(200);
  return response.json();
};
async function saved(response: Response) {
  expect(response.status).toBe(200);
  return z
    .object({
      id: z.string().uuid(),
      version: z.number().int().positive(),
      config: z.record(z.string(), z.unknown()),
    })
    .parse(await response.json());
}
it('does not publish the first draft and still lets staff preview it', async () => {
  const draft = await request('admin/branding/config', 'PUT', {
    expectedVersion: 0,
    config: { appTitle: 'Unpublished title' },
  });
  expect(draft.status).toBe(200);
  expect(await publicConfig()).toMatchObject({ appTitle: 'Barghsa' });
  expect(await (await request('admin/branding/config')).json()).toMatchObject({
    config: { appTitle: 'Unpublished title' },
    status: 'draft',
  });
});
it('publishes only after activation and retains the active values while editing the next draft', async () => {
  const first = await saved(
    await request('admin/branding/config', 'PUT', {
      expectedVersion: 0,
      config: { appTitle: 'Published title' },
    })
  );
  expect(
    (
      await request('admin/branding/activate', 'POST', {
        draftId: first.id,
        expectedVersion: first.version,
      })
    ).status
  ).toBe(200);
  expect(await publicConfig()).toMatchObject({ appTitle: 'Published title' });
  expect(
    (
      await request('admin/branding/config', 'PUT', {
        expectedVersion: first.version,
        config: { appTitle: 'Next draft' },
      })
    ).status
  ).toBe(200);
  expect(await publicConfig()).toMatchObject({ appTitle: 'Published title' });
  expect(await (await request('admin/branding/config')).json()).toMatchObject({
    config: { appTitle: 'Next draft' },
    status: 'draft',
  });
});

it('preserves published versions when a later draft is saved', async () => {
  const first = await saved(
    await request('admin/branding/config', 'PUT', {
      expectedVersion: 0,
      config: { appTitle: 'First published' },
    })
  );
  expect(
    (
      await request('admin/branding/activate', 'POST', {
        draftId: first.id,
        expectedVersion: first.version,
      })
    ).status
  ).toBe(200);
  const second = await saved(
    await request('admin/branding/config', 'PUT', {
      expectedVersion: first.version,
      config: { appTitle: 'Second published' },
    })
  );
  expect(
    (
      await request('admin/branding/activate', 'POST', {
        draftId: second.id,
        expectedVersion: second.version,
      })
    ).status
  ).toBe(200);
  const third = await request('admin/branding/config', 'PUT', {
    expectedVersion: second.version,
    config: { appTitle: 'Third draft' },
  });
  expect(third.status).toBe(200);
  const history = (
    await http.pool.query('SELECT config,status FROM brand_config WHERE id=$1', [first.id])
  ).rows[0];
  expect(history).toMatchObject({ config: { appTitle: 'First published' }, status: 'superseded' });
  expect(await publicConfig()).toMatchObject({ appTitle: 'Second published' });
});

it('rejects competing saves from the same version instead of losing one editor’s work', async () => {
  const responses = await Promise.all(
    ['First editor', 'Second editor'].map((appTitle) =>
      request('admin/branding/config', 'PUT', { expectedVersion: 0, config: { appTitle } })
    )
  );
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(
    (await http.pool.query('SELECT COUNT(*)::int AS count FROM brand_config')).rows[0].count
  ).toBe(1);
});

it('rejects a stale activation and activates the exact latest draft once', async () => {
  const first = await saved(
    await request('admin/branding/config', 'PUT', {
      expectedVersion: 0,
      config: { appTitle: 'First' },
    })
  );
  const second = await saved(
    await request('admin/branding/config', 'PUT', {
      expectedVersion: first.version,
      config: { appTitle: 'Second' },
    })
  );
  expect(
    (
      await request('admin/branding/activate', 'POST', {
        draftId: first.id,
        expectedVersion: first.version,
      })
    ).status
  ).toBe(409);
  expect(await publicConfig()).toMatchObject({ appTitle: 'Barghsa' });
  const results = await Promise.all(
    [1, 2].map(() =>
      request('admin/branding/activate', 'POST', {
        draftId: second.id,
        expectedVersion: second.version,
      })
    )
  );
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(await publicConfig()).toMatchObject({ appTitle: 'Second' });
  const audits = await http.pool.query(
    "SELECT event FROM audit_log WHERE event='branding.activated' AND metadata::jsonb->>'configId'=$1",
    [second.id]
  );
  expect(audits.rows).toHaveLength(1);
});

it('requires recent step-up and current edit permission for writes', async () => {
  await http.pool.query(
    "UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='branding-review'"
  );
  expect(
    (
      await request('admin/branding/config', 'PUT', {
        expectedVersion: 0,
        config: { appTitle: 'Forbidden' },
      })
    ).status
  ).toBe(403);
  await http.pool.query(
    "UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='branding-review'; UPDATE users SET is_admin=false WHERE user_id='branding-review'"
  );
  expect(
    (
      await request('admin/branding/config', 'PUT', {
        expectedVersion: 0,
        config: { appTitle: 'Forbidden' },
      })
    ).status
  ).toBe(403);
  expect((await http.pool.query('SELECT * FROM brand_config')).rows).toHaveLength(0);
});

it('rolls back the draft and history changes if the audit write fails', async () => {
  const first = await saved(
    await request('admin/branding/config', 'PUT', {
      expectedVersion: 0,
      config: { appTitle: 'Preserved draft' },
    })
  );
  await http.pool.query(
    "CREATE FUNCTION fail_brand_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='branding.draft_created' THEN RAISE EXCEPTION 'test brand audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_brand_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_brand_audit()"
  );
  try {
    expect(
      (
        await request('admin/branding/config', 'PUT', {
          expectedVersion: first.version,
          config: { appTitle: 'Rejected draft' },
        })
      ).status
    ).toBe(500);
    expect((await http.pool.query('SELECT id,config,status FROM brand_config')).rows).toEqual([
      { id: first.id, config: first.config, status: 'draft' },
    ]);
  } finally {
    await http.pool.query(
      'DROP TRIGGER fail_brand_audit ON audit_log; DROP FUNCTION fail_brand_audit()'
    );
  }
});
