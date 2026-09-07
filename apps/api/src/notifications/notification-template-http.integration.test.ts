import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
const headers: Record<string, Record<string, string>> = {};
const grant = JSON.stringify(['admin:notifications:edit']);
const actions = ['create', 'update', 'publish', 'unpublish', 'delete'] as const;
type Action = (typeof actions)[number];

beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    `INSERT INTO staff_roles(role_id,name,description,permissions)
     VALUES ('template-editor','Template editor','Fixture',$1),
            ('template-viewer','Template viewer','Fixture','[]')`,
    [grant]
  );
  for (const user of ['editor', 'editor-two', 'viewer']) {
    const id = `template-${user}`;
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ($1,$2,'test-only',true)",
      [id, `${id}@example.test`]
    );
    await http.pool.query('INSERT INTO user_roles(user_id,role_id) VALUES ($1,$2)', [
      id,
      user === 'viewer' ? 'template-viewer' : 'template-editor',
    ]);
    const session = randomUUID(),
      csrf = randomUUID();
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
       VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '1 hour',NOW())`,
      [session, id, csrf, randomUUID()]
    );
    headers[user] = {
      Cookie: `barghsa_session=${session}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    };
  }
}, 40000);
afterAll(async () => {
  await http?.close();
}, 15000);
beforeEach(async () => {
  await http.pool.query("DELETE FROM notification_templates WHERE event_key LIKE 'fix.template.%'");
  await http.pool.query("DELETE FROM audit_log WHERE user_id LIKE 'template-%'");
  await http.pool.query("UPDATE staff_roles SET permissions=$1 WHERE role_id='template-editor'", [
    grant,
  ]);
});

async function seed(action: Action, event = `fix.template.${randomUUID()}`) {
  const id = randomUUID();
  if (action !== 'create')
    await http.pool.query(
      `INSERT INTO notification_templates(id,event_key,channel,locale,body_template,variables,status,is_active,version,created_by,published_at)
     VALUES ($1,$2,'email','en','Original message','[]',$3,$4,1,'template-editor',CASE WHEN $4 THEN NOW() END)`,
      [id, event, action === 'unpublish' ? 'active' : 'draft', action === 'unpublish']
    );
  return { id, event };
}
function write(action: Action, value: { id: string; event: string }, user = 'editor') {
  const path =
    action === 'create'
      ? ''
      : `/${value.id}${action === 'publish' || action === 'unpublish' ? `/${action}` : ''}`;
  return fetch(`${http.base}/api/admin/notifications/templates${path}`, {
    method: action === 'update' ? 'PUT' : action === 'delete' ? 'DELETE' : 'POST',
    headers: headers[user]!,
    body: JSON.stringify(
      action === 'create'
        ? {
            eventKey: value.event,
            channel: 'email',
            locale: 'en',
            bodyTemplate: 'Original message',
            variables: [],
          }
        : action === 'update'
          ? { bodyTemplate: 'Updated message' }
          : {}
    ),
  });
}
async function snapshot() {
  return {
    templates: (
      await http.pool.query(
        "SELECT * FROM notification_templates WHERE event_key LIKE 'fix.template.%' ORDER BY id"
      )
    ).rows,
    audits: (
      await http.pool.query(
        "SELECT * FROM audit_log WHERE user_id LIKE 'template-%' AND event LIKE 'notification_template_%' ORDER BY id"
      )
    ).rows,
  };
}
async function waitForLocks(count: number) {
  await expect
    .poll(
      async () =>
        Number(
          (
            await http.pool.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'"
            )
          ).rows[0].count
        ),
      { timeout: 3000 }
    )
    .toBeGreaterThanOrEqual(count);
}

for (const action of actions) {
  it(`${action}: denies a caller without the template capability`, async () => {
    const value = await seed(action),
      before = await snapshot();
    expect((await write(action, value, 'viewer')).status).toBe(403);
    expect(await snapshot()).toEqual(before);
  });
  it(`${action}: persists a mutation audit in the same transaction`, async () => {
    const value = await seed(action);
    expect((await write(action, value)).status).toBe(
      action === 'create' ? 201 : action === 'delete' ? 204 : 200
    );
    const state = await snapshot();
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0].user_id).toBe('template-editor');
    expect(state.audits[0].event).toBe(
      `notification_template_${{ create: 'created', update: 'updated', publish: 'published', unpublish: 'unpublished', delete: 'deleted' }[action]}`
    );
  });
  it(`${action}: rolls back state when its audit fails`, async () => {
    const value = await seed(action),
      before = await snapshot();
    await http.pool.query(
      "CREATE OR REPLACE FUNCTION reject_template_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit failure'; END $$; CREATE TRIGGER reject_template_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_template_audit()"
    );
    try {
      expect((await write(action, value)).status).toBe(500);
      expect(await snapshot()).toEqual(before);
    } finally {
      await http.pool.query('DROP TRIGGER reject_template_audit ON audit_log');
    }
  });
  it(`${action}: rejects a capability revoked while the write waits`, async () => {
    const value = await seed(action),
      before = await snapshot();
    const blocker = await http.pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query('LOCK TABLE notification_templates IN SHARE MODE');
      await blocker.query(
        "UPDATE staff_roles SET permissions='[]' WHERE role_id='template-editor'"
      );
      pending = write(action, value);
      await waitForLocks(1);
      await blocker.query('COMMIT');
      expect((await pending).status).toBe(403);
      expect(await snapshot()).toEqual(before);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await pending;
    }
  });
}

it('serializes competing draft creation by different editors', async () => {
  const value = await seed('create');
  const blocker = await http.pool.connect();
  let pending: Promise<Response>[] = [];
  try {
    await blocker.query('BEGIN');
    await blocker.query('LOCK TABLE notification_templates IN SHARE MODE');
    pending = [write('create', value), write('create', value, 'editor-two')];
    await waitForLocks(2);
    await blocker.query('COMMIT');
    expect((await Promise.all(pending)).map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    expect((await snapshot()).templates).toHaveLength(1);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await Promise.all(pending);
  }
});

it('does not edit a draft that became active while its update waited', async () => {
  const value = await seed('update');
  const blocker = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query(
      "UPDATE notification_templates SET status='active',is_active=true,published_at=NOW() WHERE id=$1",
      [value.id]
    );
    pending = write('update', value);
    await waitForLocks(1);
    await blocker.query('COMMIT');
    expect((await pending).status).toBe(400);
    const state = await snapshot();
    expect(state.templates[0].body_template).toBe('Original message');
    expect(state.templates[0].status).toBe('active');
    expect(state.audits).toHaveLength(0);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await pending;
  }
});
