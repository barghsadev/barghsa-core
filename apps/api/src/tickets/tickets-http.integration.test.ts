import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let storageServer: Server;
const objects = new Map<string, Buffer>();
const headers: Record<string, Record<string, string>> = {};
const transientActors: string[] = [];
beforeAll(async () => {
  storageServer = createServer(async (req, res) => {
    const key = decodeURIComponent(new URL(req.url!, 'http://localhost').pathname).replace(
      '/test-evidence/',
      ''
    );
    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      objects.set(key, Buffer.concat(chunks));
      res.setHeader('ETag', '"test"');
      res.end();
      return;
    }
    const bytes = objects.get(key);
    if (!bytes) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader('Content-Length', bytes.length);
    res.setHeader('Content-Type', 'application/pdf');
    res.end(bytes);
  });
  await new Promise<void>((resolve) => storageServer.listen(0, '127.0.0.1', resolve));
  http = await startHttpFixture(
    process.env.TEST_DATABASE_URL!,
    `http://127.0.0.1:${(storageServer.address() as { port: number }).port}`
  );
  for (const user of ['staff', 'customer', 'disabled', 'inactive', 'assigned']) {
    await http.pool.query(
      `INSERT INTO users(user_id,username,password_hash,is_admin,disabled_at,activation_token)
      VALUES ($1,$2,'test-only',$3,$4,$5)`,
      [
        user,
        `${user}@example.test`,
        !['customer', 'assigned'].includes(user),
        user === 'disabled' ? new Date() : null,
        user === 'inactive' ? 'pending-activation' : null,
      ]
    );
    const id = randomUUID(),
      csrf = randomUUID();
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
      VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')`,
      [id, user, csrf, randomUUID()]
    );
    headers[user] = {
      Cookie: `barghsa_session=${id}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    };
  }
  await http.pool.query(
    "INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ('test-assigned','Assigned support','Test role','[\"tickets:assigned\"]')"
  );
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES ('assigned','test-assigned')"
  );
}, 40000);
// Each scenario has its own rate-limit budget in this disposable database.
beforeEach(async () => {
  await http.pool.query(
    'DELETE FROM rate_limit_counters; DELETE FROM rate_limit_windows WHERE NOT security'
  );
});
afterEach(async () => {
  if (transientActors.length) {
    await http.pool.query('UPDATE users SET disabled_at=NOW() WHERE user_id=ANY($1::text[])', [
      transientActors,
    ]);
    transientActors.length = 0;
  }
});
afterAll(async () => {
  await http?.close();
  await new Promise<void>((resolve) => storageServer?.close(() => resolve()));
});
async function ticket(status = 'open') {
  const id = randomUUID();
  await http.pool.query(
    `INSERT INTO tickets(id,user_id,subject,body,status)
    VALUES ($1,'customer','Help','A question',$2)`,
    [id, status]
  );
  return id;
}
function assign(id: string, assigneeId: unknown = 'staff', user = 'staff') {
  return fetch(`${http.base}/api/staff/tickets/${id}/assign`, {
    method: 'PUT',
    headers: headers[user]!,
    body: JSON.stringify({ assigneeId }),
  });
}

async function freshActor(admin: boolean, expiresInSeconds = 3600) {
  const userId = randomUUID(),
    sessionId = randomUUID(),
    csrfToken = randomUUID();
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_admin) VALUES ($1,$2,'test-only',$3)",
    [userId, `${userId}@example.test`, admin]
  );
  transientActors.push(userId);
  const session = await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
     VALUES ($1,$2,$3,$4,clock_timestamp()+$5*INTERVAL '1 second',NOW()+INTERVAL '30 minutes')
     RETURNING expires_at`,
    [sessionId, userId, csrfToken, randomUUID(), expiresInSeconds]
  );
  return {
    userId,
    sessionId,
    expiresAt: session.rows[0].expires_at as Date,
    headers: {
      Cookie: `barghsa_session=${sessionId}`,
      'X-CSRF-Token': csrfToken,
      'Content-Type': 'application/json',
    },
  };
}

async function blockedOrFinished(blockerPid: number, finished: () => boolean) {
  await expect
    .poll(
      async () =>
        finished() ||
        (
          await http.pool.query(
            'SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))',
            [blockerPid]
          )
        ).rows.length > 0,
      { timeout: 5000, interval: 20 }
    )
    .toBe(true);
}

it('returns only scoped customer contacts and current profile metadata to assigned staff', async () => {
  const customer = await freshActor(false),
    profileId = randomUUID(),
    id = await ticket();
  await http.pool.query('UPDATE users SET email=$2,mobile=$3 WHERE user_id=$1', [
    customer.userId,
    'ticket-owner@example.test',
    '+989121234567',
  ]);
  await http.pool.query(
    "INSERT INTO profiles(id,user_id,first_name,last_name) VALUES ($1,$2,'Ticket','Owner')",
    [profileId, customer.userId]
  );
  await http.pool.query(
    "UPDATE tickets SET user_id=$2,profile_id=$3,assigned_to='assigned' WHERE id=$1",
    [id, customer.userId, profileId]
  );
  const response = await fetch(`${http.base}/api/staff/tickets/${id}`, {
    headers: headers.assigned!,
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { customer: unknown };
  expect(body.customer).toEqual({
    userId: customer.userId,
    username: `${customer.userId}@example.test`,
    email: 'ticket-owner@example.test',
    mobile: '+989121234567',
    profile: { id: profileId, title: 'Ticket Owner' },
  });
  expect(
    (await fetch(`${http.base}/api/staff/tickets/${id}`, { headers: headers.customer! })).status
  ).toBe(403);
  await http.pool.query("UPDATE tickets SET assigned_to='staff' WHERE id=$1", [id]);
  const forbidden = await fetch(`${http.base}/api/staff/tickets/${id}`, {
    headers: headers.assigned!,
  });
  expect(forbidden.status).toBe(404);
  expect(JSON.stringify(await forbidden.json())).not.toContain('ticket-owner@example.test');
});

it.each(['transferred', 'archived'] as const)(
  'does not expose a %s profile through a historical ticket',
  async (state) => {
    const profileId = randomUUID(),
      id = await ticket();
    await http.pool.query(
      "INSERT INTO profiles(id,user_id,title) VALUES ($1,'customer','Original title')",
      [profileId]
    );
    await http.pool.query('UPDATE tickets SET profile_id=$2 WHERE id=$1', [id, profileId]);
    if (state === 'transferred')
      await http.pool.query(
        "UPDATE profiles SET user_id='staff',title='New owner private title' WHERE id=$1",
        [profileId]
      );
    else await http.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [profileId]);
    const response = await fetch(`${http.base}/api/staff/tickets/${id}`, {
      headers: headers.staff!,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { customer: { profile: unknown } };
    expect(body.customer.profile).toBeNull();
    expect(JSON.stringify(body)).not.toContain('New owner private title');
  }
);

it('keeps staff customer metadata out of customer list and detail responses', async () => {
  const id = await ticket();
  const detail = await fetch(`${http.base}/api/tickets/${id}`, { headers: headers.customer! });
  expect(detail.status).toBe(200);
  expect(await detail.json()).not.toHaveProperty('customer');
  const list = await fetch(`${http.base}/api/tickets`, { headers: headers.customer! });
  expect(list.status).toBe(200);
  const body = (await list.json()) as { data: Record<string, unknown>[] };
  expect(body.data.length).toBeGreaterThan(0);
  expect(body.data.every((row) => !('customer' in row) && !('customer_username' in row))).toBe(
    true
  );
});

it.each(['general', 'billing', 'orders', undefined])(
  'persists and returns the selected ticket category (%s)',
  async (category) => {
    const subject = `Category ${randomUUID()}`;
    const response = await fetch(`${http.base}/api/tickets`, {
      method: 'POST',
      headers: headers.customer!,
      body: JSON.stringify({
        subject,
        body: 'A categorized question',
        ...(category ? { category } : {}),
      }),
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string; category: string };
    expect(created.category).toBe(category ?? 'general');
    for (const prefix of ['/api/tickets', '/api/staff/tickets']) {
      const actorHeaders = prefix.includes('/staff/') ? headers.staff! : headers.customer!;
      const detail = await fetch(`${http.base}${prefix}/${created.id}`, { headers: actorHeaders });
      expect(detail.status).toBe(200);
      expect(await detail.json()).toMatchObject({ category: category ?? 'general' });
      const list = await fetch(`${http.base}${prefix}?search=${encodeURIComponent(subject)}`, {
        headers: actorHeaders,
      });
      expect(list.status).toBe(200);
      expect(await list.json()).toMatchObject({
        data: [{ id: created.id, category: category ?? 'general' }],
      });
    }
    expect(
      (
        await http.pool.query(
          "SELECT metadata::jsonb->>'category' AS category FROM audit_log WHERE event='ticket_created' AND metadata::jsonb->>'ticketId'=$1",
          [created.id]
        )
      ).rows[0]
    ).toEqual({ category: category ?? 'general' });
  }
);

it.each(['technical', '', null])('rejects unsupported ticket categories (%s)', async (category) => {
  const response = await fetch(`${http.base}/api/tickets`, {
    method: 'POST',
    headers: headers.customer!,
    body: JSON.stringify({ subject: 'Invalid category', body: 'Details', category }),
  });
  expect(response.status).toBe(400);
});

it.each(['', '/detail', '/comments'] as const)(
  'denies a staff ticket read after its grant is revoked while waiting (%s)',
  async (view) => {
    const actor = await freshActor(false),
      id = await ticket(),
      roleId = randomUUID();
    await http.pool.query(
      `INSERT INTO staff_roles(role_id,name,description,permissions)
       VALUES ($1,$1,'Ticket reader','["tickets:read"]')`,
      [roleId]
    );
    await http.pool.query('INSERT INTO user_roles(user_id,role_id) VALUES ($1,$2)', [
      actor.userId,
      roleId,
    ]);
    await http.pool.query(
      "INSERT INTO ticket_comments(ticket_id,author_id,body,visibility) VALUES ($1,'staff','Private note','internal')",
      [id]
    );
    const client = await http.pool.connect();
    let response: Promise<Response> | undefined,
      finished = false;
    try {
      await client.query('BEGIN');
      await client.query("UPDATE staff_roles SET permissions='[]' WHERE role_id=$1", [roleId]);
      await client.query('LOCK TABLE tickets IN ACCESS EXCLUSIVE MODE');
      const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
      const suffix = view === '/detail' ? `/${id}` : view === '/comments' ? `/${id}/comments` : '';
      response = fetch(`${http.base}/api/staff/tickets${suffix}`, {
        headers: actor.headers,
      }).finally(() => {
        finished = true;
      });
      await blockedOrFinished(pid, () => finished);
      await client.query('COMMIT');
      const result = await response;
      expect(result.status).toBe(403);
      expect(await result.text()).not.toContain('Private note');
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await response;
    }
  }
);

it.each(['', '/detail', '/comments'] as const)(
  'uses the current assigned-only scope for a staff ticket read (%s)',
  async (view) => {
    const actor = await freshActor(false),
      own = await ticket(),
      other = await ticket(),
      roleId = randomUUID();
    await http.pool.query('UPDATE tickets SET assigned_to=$1 WHERE id=$2', [actor.userId, own]);
    await http.pool.query(
      `INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ($1,$1,'Ticket reader','["tickets:read"]')`,
      [roleId]
    );
    await http.pool.query('INSERT INTO user_roles(user_id,role_id) VALUES ($1,$2)', [
      actor.userId,
      roleId,
    ]);
    const client = await http.pool.connect();
    let response: Promise<Response> | undefined,
      finished = false;
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE staff_roles SET permissions='["tickets:assigned"]' WHERE role_id=$1`,
        [roleId]
      );
      await client.query('LOCK TABLE tickets IN ACCESS EXCLUSIVE MODE');
      const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
      const suffix =
        view === '/detail' ? `/${other}` : view === '/comments' ? `/${other}/comments` : '';
      response = fetch(`${http.base}/api/staff/tickets${suffix}`, {
        headers: actor.headers,
      }).finally(() => {
        finished = true;
      });
      await blockedOrFinished(pid, () => finished);
      await client.query('COMMIT');
      const result = await response;
      expect(result.status).toBe(view ? 404 : 200);
      if (!view) {
        const queue = (await result.json()) as {
          data: { id: string }[];
          viewer: { canWrite: boolean; canAssignOthers: boolean };
        };
        expect(queue.data.map((row) => row.id)).toEqual([own]);
        expect(queue.viewer).toMatchObject({ canWrite: true, canAssignOthers: false });
      }
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await response;
    }
  }
);

it('reports current read-only capabilities after a staff permission change', async () => {
  const actor = await freshActor(false),
    roleId = randomUUID();
  await http.pool.query(
    `INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ($1,$1,'Ticket reader','["tickets:read","tickets:write"]')`,
    [roleId]
  );
  await http.pool.query('INSERT INTO user_roles(user_id,role_id) VALUES ($1,$2)', [
    actor.userId,
    roleId,
  ]);
  const client = await http.pool.connect();
  let response: Promise<Response> | undefined,
    finished = false;
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE staff_roles SET permissions='["tickets:read"]' WHERE role_id=$1`, [
      roleId,
    ]);
    await client.query('LOCK TABLE tickets IN ACCESS EXCLUSIVE MODE');
    const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
    response = fetch(`${http.base}/api/staff/tickets`, { headers: actor.headers }).finally(() => {
      finished = true;
    });
    await blockedOrFinished(pid, () => finished);
    await client.query('COMMIT');
    const result = await response;
    expect(result.status).toBe(200);
    expect(((await result.json()) as { viewer: unknown }).viewer).toEqual({
      userId: actor.userId,
      canWrite: false,
      canAssignOthers: false,
    });
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await response;
  }
});

it.each(['list', 'detail', 'comments', 'options'] as const)(
  'does not return a customer ticket %s read after its session expires',
  async (view) => {
    const id = await ticket(),
      actor = await freshActor(false, 2);
    await http.pool.query('UPDATE tickets SET user_id=$1 WHERE id=$2', [actor.userId, id]);
    const client = await http.pool.connect();
    let response: Promise<Response> | undefined,
      finished = false;
    try {
      await client.query('BEGIN');
      await client.query(
        view === 'options'
          ? 'LOCK TABLE profiles IN ACCESS EXCLUSIVE MODE'
          : 'LOCK TABLE tickets IN ACCESS EXCLUSIVE MODE'
      );
      const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
      const suffix =
        view === 'detail'
          ? `/${id}`
          : view === 'comments'
            ? `/${id}/comments`
            : view === 'options'
              ? '/options'
              : '';
      response = fetch(`${http.base}/api/tickets${suffix}`, { headers: actor.headers }).finally(
        () => {
          finished = true;
        }
      );
      await blockedOrFinished(pid, () => finished);
      expect(finished).toBe(false);
      await http.pool.query(
        'SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp())))+0.05)',
        [actor.expiresAt]
      );
      await client.query('COMMIT');
      const result = await response;
      expect(result.status).toBe(401);
      expect(await result.text()).not.toContain('A question');
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await response;
    }
  }
);

it('rejects customer creation after account disablement commits while authorization waits', async () => {
  const actor = await freshActor(false),
    client = await http.pool.connect();
  let response: Promise<Response> | undefined,
    finished = false;
  try {
    await client.query('BEGIN');
    await client.query('UPDATE users SET disabled_at=NOW() WHERE user_id=$1', [actor.userId]);
    const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
    response = fetch(`${http.base}/api/tickets`, {
      method: 'POST',
      headers: actor.headers,
      body: JSON.stringify({ subject: 'Revoked request', body: 'Must not create' }),
    }).finally(() => {
      finished = true;
    });
    await blockedOrFinished(pid, () => finished);
    await client.query('COMMIT');
    expect((await response).status).toBe(401);
    expect(
      (await http.pool.query('SELECT id FROM tickets WHERE user_id=$1', [actor.userId])).rows
    ).toHaveLength(0);
    expect(
      (
        await http.pool.query(
          "SELECT id FROM audit_log WHERE user_id=$1 AND event='ticket_created'",
          [actor.userId]
        )
      ).rows
    ).toHaveLength(0);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await response;
  }
});

it('rejects staff status changes after the current ticket grant is revoked during authorization', async () => {
  const actor = await freshActor(false),
    id = await ticket('in_progress');
  const roleId = randomUUID();
  await http.pool.query(
    `INSERT INTO staff_roles(role_id,name,description,permissions)
     VALUES ($1,$1,'Test ticket writer','["tickets:write"]')`,
    [roleId]
  );
  await http.pool.query('INSERT INTO user_roles(user_id,role_id) VALUES ($1,$2)', [
    actor.userId,
    roleId,
  ]);
  await http.pool.query("UPDATE tickets SET assigned_to='staff' WHERE id=$1", [id]);
  const client = await http.pool.connect();
  let response: Promise<Response> | undefined,
    finished = false;
  try {
    await client.query('BEGIN');
    await client.query("UPDATE staff_roles SET permissions='[]' WHERE role_id=$1", [roleId]);
    await client.query('SELECT id FROM tickets WHERE id=$1 FOR UPDATE', [id]);
    const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
    response = fetch(`${http.base}/api/staff/tickets/${id}/status`, {
      method: 'PATCH',
      headers: actor.headers,
      body: JSON.stringify({ status: 'resolved' }),
    }).finally(() => {
      finished = true;
    });
    await blockedOrFinished(pid, () => finished);
    await client.query('COMMIT');
    expect((await response).status).toBe(403);
    expect(
      (await http.pool.query('SELECT status FROM tickets WHERE id=$1', [id])).rows[0].status
    ).toBe('in_progress');
    expect(
      (
        await http.pool.query(
          "SELECT id FROM audit_log WHERE user_id=$1 AND event='ticket_status_changed'",
          [actor.userId]
        )
      ).rows
    ).toHaveLength(0);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await response;
  }
});

it.each(['status', 'comment', 'assignment'] as const)(
  'applies a newly assigned-only grant to the staff %s command',
  async (action) => {
    const actor = await freshActor(false),
      id = await ticket('in_progress'),
      roleId = randomUUID();
    await http.pool.query("UPDATE tickets SET assigned_to='staff' WHERE id=$1", [id]);
    await http.pool.query(
      `INSERT INTO staff_roles(role_id,name,description,permissions)
       VALUES ($1,$1,'Downgraded ticket writer','["tickets:write"]')`,
      [roleId]
    );
    await http.pool.query('INSERT INTO user_roles(user_id,role_id) VALUES ($1,$2)', [
      actor.userId,
      roleId,
    ]);
    const client = await http.pool.connect();
    let response: Promise<Response> | undefined,
      finished = false;
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE staff_roles SET permissions='["tickets:assigned"]' WHERE role_id=$1`,
        [roleId]
      );
      const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
      const command =
        action === 'status'
          ? { path: 'status', method: 'PATCH', body: { status: 'resolved' } }
          : action === 'comment'
            ? {
                path: 'comments',
                method: 'POST',
                body: { body: 'No longer permitted', visibility: 'internal' },
              }
            : { path: 'assign', method: 'PUT', body: { assigneeId: 'staff' } };
      response = fetch(`${http.base}/api/staff/tickets/${id}/${command.path}`, {
        method: command.method,
        headers: actor.headers,
        body: JSON.stringify(command.body),
      }).finally(() => {
        finished = true;
      });
      await blockedOrFinished(pid, () => finished);
      await client.query('COMMIT');
      expect((await response).status).toBe(action === 'assignment' ? 403 : 404);
      expect(
        (await http.pool.query('SELECT status,assigned_to FROM tickets WHERE id=$1', [id])).rows[0]
      ).toEqual({ status: 'in_progress', assigned_to: 'staff' });
      expect(
        (await http.pool.query('SELECT id FROM ticket_comments WHERE ticket_id=$1', [id])).rows
      ).toHaveLength(0);
      expect(
        (
          await http.pool.query(
            "SELECT id FROM audit_log WHERE user_id=$1 AND event LIKE 'ticket_%'",
            [actor.userId]
          )
        ).rows
      ).toHaveLength(0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await response;
    }
  }
);

it.each(['create', 'assign', 'status'] as const)(
  'rolls back ticket %s and its audit if the session expires before commit',
  async (action) => {
    const actor = await freshActor(action !== 'create'),
      id = await ticket('in_progress');
    await http.pool.query("UPDATE tickets SET assigned_to='staff' WHERE id=$1", [id]);
    await http.pool
      .query(`CREATE FUNCTION expire_ticket_actor() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.event IN ('ticket_created','ticket_assigned','ticket_status_changed') THEN
        UPDATE sessions SET expires_at=clock_timestamp()-INTERVAL '1 second' WHERE user_id=NEW.user_id;
      END IF; RETURN NEW; END $$;
      CREATE TRIGGER expire_ticket_actor AFTER INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION expire_ticket_actor()`);
    try {
      const command =
        action === 'create'
          ? {
              path: '/api/tickets',
              method: 'POST',
              body: { subject: 'Expiry', body: 'Must roll back' },
            }
          : action === 'assign'
            ? {
                path: `/api/staff/tickets/${id}/assign`,
                method: 'PUT',
                body: { assigneeId: 'staff' },
              }
            : {
                path: `/api/staff/tickets/${id}/status`,
                method: 'PATCH',
                body: { status: 'resolved' },
              };
      const response = await fetch(http.base + command.path, {
        method: command.method,
        headers: actor.headers,
        body: JSON.stringify(command.body),
      });
      expect(response.status, http.logs()).toBe(401);
      expect(
        (await http.pool.query('SELECT status,assigned_to FROM tickets WHERE id=$1', [id])).rows[0]
      ).toEqual({ status: 'in_progress', assigned_to: 'staff' });
      expect(
        (await http.pool.query('SELECT id FROM tickets WHERE user_id=$1', [actor.userId])).rows
      ).toHaveLength(0);
      expect(
        (
          await http.pool.query(
            "SELECT id FROM audit_log WHERE user_id=$1 AND event LIKE 'ticket_%'",
            [actor.userId]
          )
        ).rows
      ).toHaveLength(0);
    } finally {
      await http.pool.query(
        'DROP TRIGGER expire_ticket_actor ON audit_log; DROP FUNCTION expire_ticket_actor()'
      );
    }
  }
);

it('rolls back a customer reply when its session expires while the ticket is locked', async () => {
  const id = await ticket(),
    client = await http.pool.connect();
  let response: Promise<Response> | undefined,
    finished = false;
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM tickets WHERE id=$1 FOR UPDATE', [id]);
    const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
    const actor = await freshActor(false, 2);
    // Ownership belongs to this actor before the request begins.
    await client.query('UPDATE tickets SET user_id=$1 WHERE id=$2', [actor.userId, id]);
    // The locked row must already be visible with the current owner.
    await client.query('COMMIT');
    await client.query('BEGIN');
    await client.query('SELECT id FROM tickets WHERE id=$1 FOR UPDATE', [id]);
    response = fetch(`${http.base}/api/tickets/${id}/comments`, {
      method: 'POST',
      headers: actor.headers,
      body: JSON.stringify({ body: 'Expired reply' }),
    }).finally(() => {
      finished = true;
    });
    await blockedOrFinished(pid, () => finished);
    expect(finished).toBe(false);
    await http.pool.query(
      'SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp())))+0.05)',
      [actor.expiresAt]
    );
    await client.query('COMMIT');
    expect((await response).status).toBe(401);
    expect(
      (await http.pool.query('SELECT id FROM ticket_comments WHERE ticket_id=$1', [id])).rows
    ).toHaveLength(0);
    expect(
      (
        await http.pool.query(
          "SELECT id FROM audit_log WHERE user_id=$1 AND event='ticket_comment_added'",
          [actor.userId]
        )
      ).rows
    ).toHaveLength(0);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await response;
  }
});
it('rejects unknown, customer, disabled and pending-activation assignees without changing the ticket', async () => {
  const id = await ticket();
  for (const target of ['missing', 'customer', 'disabled', 'inactive', '', { bad: true }]) {
    expect((await assign(id, target)).status, http.logs()).toBe(400);
  }
  expect((await assign(id, 'staff', 'customer')).status).toBe(403);
  const row = (await http.pool.query('SELECT assigned_to,status FROM tickets WHERE id=$1', [id]))
    .rows[0];
  expect(row).toEqual({ assigned_to: null, status: 'open' });
  expect(
    (
      await http.pool.query(
        "SELECT id FROM audit_log WHERE event='ticket_assigned' AND metadata::jsonb->>'ticketId'=$1",
        [id]
      )
    ).rows
  ).toHaveLength(0);
});
it('assigns eligible staff, advances open tickets and preserves a resolved status', async () => {
  const open = await ticket(),
    resolved = await ticket('resolved');
  expect((await assign(open)).status).toBe(200);
  expect((await assign(resolved)).status).toBe(200);
  expect(
    (await http.pool.query('SELECT status FROM tickets WHERE id=$1', [open])).rows[0].status
  ).toBe('in_progress');
  expect(
    (await http.pool.query('SELECT status FROM tickets WHERE id=$1', [resolved])).rows[0].status
  ).toBe('resolved');
  expect((await assign(randomUUID())).status).toBe(404);
});
it('uses the current status after waiting on a concurrent ticket change', async () => {
  const id = await ticket(),
    client = await http.pool.connect();
  let response: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query("UPDATE tickets SET status='resolved' WHERE id=$1", [id]);
    response = assign(id);
    // Wait for the actual assignment UPDATE to block on this transaction.
    const deadline = Date.now() + 5000;
    let waiting = false;
    while (Date.now() < deadline) {
      const active = await http.pool.query(
        "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'UPDATE tickets SET assigned_to=%'"
      );
      if (active.rows.length) {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(waiting).toBe(true);
    await client.query('COMMIT');
    expect((await response).status).toBe(200);
    const row = (await http.pool.query('SELECT assigned_to,status FROM tickets WHERE id=$1', [id]))
      .rows[0];
    expect(row).toEqual({ assigned_to: 'staff', status: 'resolved' });
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await response;
  }
});
it('rolls back assignment when recording its audit fails', async () => {
  const id = await ticket();
  await http.pool
    .query(`CREATE FUNCTION fail_ticket_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.event='ticket_assigned' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_ticket_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_ticket_audit()`);
  try {
    expect((await assign(id)).status).toBe(500);
    const row = (await http.pool.query('SELECT assigned_to,status FROM tickets WHERE id=$1', [id]))
      .rows[0];
    expect(row).toEqual({ assigned_to: null, status: 'open' });
  } finally {
    await http.pool.query(
      'DROP TRIGGER fail_ticket_audit ON audit_log; DROP FUNCTION fail_ticket_audit()'
    );
  }
  expect((await assign(id)).status).toBe(200);
});
function status(id: string, value: unknown, user = 'staff') {
  const path = user === 'staff' ? 'staff/tickets' : 'tickets';
  return fetch(`${http.base}/api/${path}/${id}/status`, {
    method: 'PATCH',
    headers: headers[user]!,
    body: JSON.stringify({ status: value }),
  });
}
function comment(id: string, body: unknown, visibility: unknown = 'public', user = 'staff') {
  const path = user === 'staff' ? 'staff/tickets' : 'tickets';
  return fetch(`${http.base}/api/${path}/${id}/comments`, {
    method: 'POST',
    headers: headers[user]!,
    body: JSON.stringify({ body, visibility }),
  });
}
it('enforces the support lifecycle, hides internal notes, and resumes work after a customer reply', async () => {
  const id = await ticket();
  expect((await status(id, 'closed')).status).toBe(409);
  expect((await status(id, 'in_progress')).status).toBe(409);
  expect((await assign(id)).status).toBe(200);
  expect((await comment(id, 'Private staff reasoning', 'internal')).status).toBe(201);
  expect((await comment(id, 'Please send the details')).status).toBe(201);
  expect((await status(id, 'waiting_customer')).status).toBe(200);
  const customerNotes = await fetch(`${http.base}/api/tickets/${id}/comments`, {
    headers: headers.customer!,
  });
  expect(customerNotes.status).toBe(200);
  expect(await customerNotes.text()).not.toContain('Private staff reasoning');
  expect((await comment(id, 'Trying an internal note', 'internal', 'customer')).status).toBe(403);
  expect((await comment(id, 'Here are the details', 'public', 'customer')).status).toBe(201);
  expect(
    (await http.pool.query('SELECT status FROM tickets WHERE id=$1', [id])).rows[0].status
  ).toBe('in_progress');
  expect((await status(id, 'waiting_staff')).status).toBe(200);
  expect((await status(id, 'in_progress')).status).toBe(200);
  expect((await status(id, 'resolved')).status).toBe(200);
  expect((await comment(id, 'Requires reopening', 'public', 'customer')).status).toBe(409);
  expect((await status(id, 'closed')).status).toBe(200);
  expect((await status(id, 'open', 'customer')).status).toBe(200);
  expect((await status(id, 'resolved', 'customer')).status).toBe(403);
  expect((await comment(id, { bad: true })).status).toBe(400);
  expect((await comment(id, 'text', 'secret')).status).toBe(400);
  expect((await status(id, { bad: true })).status).toBe(400);
});
it('prevents access to another customer’s ticket and keeps customer endpoints public even for staff owners', async () => {
  const id = await ticket();
  await http.pool.query("UPDATE tickets SET user_id='staff' WHERE id=$1", [id]);
  expect((await comment(id, 'Private staff reasoning', 'internal')).status).toBe(201);
  expect((await comment(id, 'Wrong owner', 'public', 'customer')).status).toBe(404);
  expect((await status(id, 'open', 'customer')).status).toBe(404);
  const ownerResponse = await fetch(`${http.base}/api/tickets/${id}/comments`, {
    headers: headers.staff!,
  });
  expect(ownerResponse.status).toBe(200);
  expect(await ownerResponse.text()).not.toContain('Private staff reasoning');
});
it('rolls back comments and status changes when their audits fail, and serializes competing transitions', async () => {
  const id = await ticket();
  await assign(id);
  await http.pool
    .query(`CREATE FUNCTION fail_ticket_mutation_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.event IN ('ticket_comment_added','ticket_status_changed') THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_ticket_mutation_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_ticket_mutation_audit()`);
  try {
    expect((await status(id, 'resolved')).status).toBe(500);
    expect((await comment(id, 'Not committed')).status).toBe(500);
    expect(
      (await http.pool.query('SELECT status FROM tickets WHERE id=$1', [id])).rows[0].status
    ).toBe('in_progress');
    expect(
      (await http.pool.query('SELECT id FROM ticket_comments WHERE ticket_id=$1', [id])).rows
    ).toHaveLength(0);
  } finally {
    await http.pool.query(
      'DROP TRIGGER fail_ticket_mutation_audit ON audit_log; DROP FUNCTION fail_ticket_mutation_audit()'
    );
  }
  const responses = await Promise.all([status(id, 'resolved'), status(id, 'waiting_customer')]);
  expect(responses.map((row) => row.status).sort()).toEqual([200, 409]);
  expect(
    (
      await http.pool.query(
        "SELECT id FROM audit_log WHERE event='ticket_status_changed' AND metadata::jsonb->>'ticketId'=$1",
        [id]
      )
    ).rows
  ).toHaveLength(1);
});
function createTicket(body: unknown, user = 'customer') {
  return fetch(`${http.base}/api/tickets`, {
    method: 'POST',
    headers: headers[user]!,
    body: JSON.stringify(body),
  });
}
it('validates creation fields and scopes profile and related invoice links to the owner', async () => {
  const own = randomUUID(),
    other = randomUUID(),
    invoice = randomUUID();
  await http.pool.query(
    `INSERT INTO profiles(id,user_id,profile_type,status) VALUES ($1,'customer','INDIVIDUAL','VERIFIED'),($2,'staff','INDIVIDUAL','VERIFIED')`,
    [own, other]
  );
  await http.pool.query(
    'INSERT INTO invoices(id,profile_id,order_id,total_amount) VALUES ($1,$2,NULL,100)',
    [invoice, own]
  );
  const base = { subject: 'A question', body: 'Please help' };
  expect((await createTicket({ ...base, subject: { bad: true } })).status).toBe(400);
  expect((await createTicket({ ...base, priority: 'urgent' })).status).toBe(400);
  expect((await createTicket({ ...base, profileId: other })).status).toBe(404);
  expect(
    (await createTicket({ ...base, relatedEntityType: 'invoice', relatedEntityId: invoice })).status
  ).toBe(400);
  expect(
    (
      await createTicket({
        ...base,
        profileId: own,
        relatedEntityType: 'invoice',
        relatedEntityId: randomUUID(),
      })
    ).status
  ).toBe(404);
  const response = await createTicket({
    ...base,
    profileId: own,
    relatedEntityType: 'invoice',
    relatedEntityId: invoice,
  });
  expect(response.status, http.logs()).toBe(201);
  expect(await response.json()).toMatchObject({
    profileId: own,
    relatedEntityId: invoice,
    attachments: [],
  });
  await http.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [own]);
  expect((await createTicket({ ...base, profileId: own })).status).toBe(404);
});
it('persists a fixed attachment copy and releases downloads only to the owner or staff', async () => {
  const key = `uploads/document/${randomUUID()}.pdf`,
    bytes = Buffer.from('%PDF-1.7\nOriginal support attachment\n%%EOF');
  objects.set(key, bytes);
  await http.pool.query(
    `INSERT INTO storage_records(storage_key,status,metadata,file_size,content_type,category,file_name)
    VALUES ($1,'active',$2::jsonb,$3,'application/pdf','document','help.pdf')`,
    [
      key,
      JSON.stringify({ verified: true, uploadedBy: 'staff', purpose: 'ticket_attachment' }),
      bytes.length,
    ]
  );
  expect(
    (await createTicket({ subject: 'No access', body: 'Another user file', attachments: [key] }))
      .status
  ).toBe(400);
  const response = await createTicket(
    { subject: 'Attachment', body: 'Details', attachments: [key] },
    'staff'
  );
  expect(response.status, http.logs()).toBe(201);
  const row = (await response.json()) as { id: string; attachments: string[] };
  expect(row.attachments[0]).toMatch(/^ticket-attachments\//);
  objects.set(key, Buffer.from('%PDF-1.7\nReplaced original'));
  expect(
    (await fetch(`${http.base}/api/tickets/${row.id}`, { headers: headers.customer! })).status
  ).toBe(404);
  const detail = await fetch(`${http.base}/api/tickets/${row.id}`, { headers: headers.staff! });
  expect(detail.status).toBe(200);
  const data = (await detail.json()) as { attachmentDownloadUrls: string[] };
  const url = new URL(data.attachmentDownloadUrls[0]!);
  expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
  expect(await (await fetch(url)).text()).toContain('Original support attachment');
});
it('rolls back ticket creation when its audit fails and leaves existing tickets on the empty attachment default', async () => {
  const id = await ticket();
  expect(
    (await http.pool.query('SELECT attachments FROM tickets WHERE id=$1', [id])).rows[0].attachments
  ).toEqual([]);
  await http.pool
    .query(`CREATE FUNCTION fail_ticket_create_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.event='ticket_created' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_ticket_create_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_ticket_create_audit()`);
  try {
    expect(
      (await createTicket({ subject: 'Audit failure ticket', body: 'Details' }, 'staff')).status
    ).toBe(500);
    expect(
      (await http.pool.query("SELECT id FROM tickets WHERE subject='Audit failure ticket'")).rows
    ).toHaveLength(0);
  } finally {
    await http.pool.query(
      'DROP TRIGGER fail_ticket_create_audit ON audit_log; DROP FUNCTION fail_ticket_create_audit()'
    );
  }
  expect(
    (await createTicket({ subject: 'Audit failure ticket', body: 'Details' }, 'staff')).status
  ).toBe(201);
});
it('limits assigned-only staff to their current tickets and refuses reassignment to another account', async () => {
  const mine = await ticket(),
    other = await ticket();
  expect((await assign(mine, 'assigned')).status).toBe(200);
  const list = await fetch(`${http.base}/api/staff/tickets?assignedTo=staff`, {
    headers: headers.assigned!,
  });
  expect(list.status).toBe(200);
  expect(((await list.json()) as { data: { id: string }[] }).data.map((row) => row.id)).toEqual([
    mine,
  ]);
  const call = (id: string, suffix = '', method = 'GET', body?: unknown) =>
    fetch(`${http.base}/api/staff/tickets/${id}${suffix}`, {
      method,
      headers: headers.assigned!,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  expect((await call(mine)).status).toBe(200);
  expect((await call(other)).status).toBe(404);
  expect((await call(other, '/comments')).status).toBe(404);
  expect(
    (await call(other, '/comments', 'POST', { body: 'Forbidden', visibility: 'internal' })).status
  ).toBe(404);
  expect((await call(other, '/status', 'PATCH', { status: 'resolved' })).status).toBe(404);
  expect((await call(other, '/assign', 'PUT', {})).status).toBe(404);
  expect((await call(mine, '/assign', 'PUT', { assigneeId: 'staff' })).status).toBe(403);
  expect(
    (await call(mine, '/comments', 'POST', { body: 'Own ticket note', visibility: 'internal' }))
      .status
  ).toBe(201);
  expect((await call(mine, '/status', 'PATCH', { status: 'waiting_customer' })).status).toBe(200);
  expect((await assign(mine, 'staff')).status).toBe(200);
  expect((await call(mine, '/comments')).status).toBe(404);
  expect((await call(mine, '/comments', 'POST', { body: 'Stale access' })).status).toBe(404);
});
it('rechecks assigned-only permission after waiting on a concurrent reassignment', async () => {
  const id = await ticket(),
    client = await http.pool.connect();
  await assign(id, 'assigned');
  let response: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query("UPDATE tickets SET assigned_to='staff' WHERE id=$1", [id]);
    response = fetch(`${http.base}/api/staff/tickets/${id}/comments`, {
      method: 'POST',
      headers: headers.assigned!,
      body: JSON.stringify({ body: 'Stale private note', visibility: 'internal' }),
    });
    const deadline = Date.now() + 5000;
    let waiting = false;
    while (Date.now() < deadline) {
      const rows = await http.pool.query(
        "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT * FROM tickets WHERE id=%'"
      );
      if (rows.rows.length) {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(waiting).toBe(true);
    await client.query('COMMIT');
    expect((await response).status).toBe(404);
    expect(
      (await http.pool.query('SELECT id FROM ticket_comments WHERE ticket_id=$1', [id])).rows
    ).toHaveLength(0);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await response;
  }
});
it('offers only owned profiles and exposes eligible assignees only to full ticket managers', async () => {
  const response = await fetch(`${http.base}/api/tickets/options`, { headers: headers.customer! });
  expect(response.status).toBe(200);
  const options = (await response.json()) as { profiles: { id: string }[] };
  const foreign = randomUUID();
  await http.pool.query(
    "INSERT INTO profiles(id,user_id,profile_type,status) VALUES ($1,'staff','INDIVIDUAL','VERIFIED')",
    [foreign]
  );
  expect(options.profiles.map((profile) => profile.id)).not.toContain(foreign);
  expect(
    (
      await fetch(`${http.base}/api/tickets/options?profileId=${foreign}`, {
        headers: headers.customer!,
      })
    ).status
  ).toBe(404);
  expect(
    (await fetch(`${http.base}/api/staff/tickets/assignees`, { headers: headers.assigned! })).status
  ).toBe(403);
  const staff = await fetch(`${http.base}/api/staff/tickets/assignees`, {
    headers: headers.staff!,
  });
  expect(staff.status).toBe(200);
  const assignees = (await staff.json()) as { id: string; name: string }[];
  expect(assignees.map((person) => person.id).sort()).toEqual(['assigned', 'staff']);
  expect(assignees.every((person) => Object.keys(person).sort().join(',') === 'id,name')).toBe(
    true
  );
});
it('paginates older related records without exposing another profile', async () => {
  const profile = randomUUID();
  await http.pool.query(
    "INSERT INTO profiles(id,user_id,profile_type,status) VALUES ($1,'customer','INDIVIDUAL','VERIFIED')",
    [profile]
  );
  await http.pool.query(
    'INSERT INTO invoices(profile_id,order_id,total_amount) SELECT $1,NULL,100 FROM generate_series(1,25)',
    [profile]
  );
  const get = (page: number) =>
    fetch(`${http.base}/api/tickets/options?profileId=${profile}&recordPage=${page}`, {
      headers: headers.customer!,
    });
  const first = (await (await get(1)).json()) as {
    records: { id: string }[];
    hasMoreRecords: boolean;
  };
  const second = (await (await get(2)).json()) as {
    records: { id: string }[];
    hasMoreRecords: boolean;
  };
  expect(first.records).toHaveLength(20);
  expect(first.hasMoreRecords).toBe(true);
  expect(second.records).toHaveLength(5);
  expect(second.hasMoreRecords).toBe(false);
  expect(new Set([...first.records, ...second.records].map((row) => row.id)).size).toBe(25);
  expect((await get(1.5)).status).toBe(400);
});
it('keeps ticket notices private, bilingual and free of internal conversation text', async () => {
  const id = await ticket();
  await assign(id, 'assigned');
  await http.pool.query("DELETE FROM in_app_notifications WHERE link_route LIKE '%'||$1||'%'", [
    id,
  ]);
  expect((await comment(id, 'Confidential internal detail', 'internal')).status).toBe(201);
  const internal = (
    await http.pool.query(
      "SELECT recipient_user_id,localized_content,link_route FROM in_app_notifications WHERE link_route LIKE '%'||$1||'%'",
      [id]
    )
  ).rows;
  expect(internal).toHaveLength(1);
  expect(internal[0].recipient_user_id).toBe('assigned');
  expect(internal[0].link_route).toBe(`/admin/tickets?ticketId=${id}`);
  expect(JSON.stringify(internal)).not.toContain('Confidential internal detail');
  expect(internal[0].localized_content.en.title).toBe('New internal ticket note');
  expect(internal[0].localized_content.fa.title).not.toBe(internal[0].localized_content.en.title);
  expect((await comment(id, 'Public solution', 'public')).status).toBe(201);
  const customer = (
    await http.pool.query(
      "SELECT recipient_user_id,localized_content,link_route FROM in_app_notifications WHERE recipient_user_id='customer' AND link_route LIKE '%'||$1||'%'",
      [id]
    )
  ).rows;
  expect(customer).toHaveLength(1);
  expect(customer[0].link_route).toBe(`/tickets?ticketId=${id}`);
  expect(customer[0].localized_content.en.title).toBe('New ticket reply');
  await http.pool.query("DELETE FROM user_roles WHERE user_id='assigned'");
  try {
    expect((await comment(id, 'Customer update', 'public', 'customer')).status).toBe(201);
    expect(
      (
        await http.pool.query(
          "SELECT id FROM in_app_notifications WHERE recipient_user_id='assigned' AND link_route LIKE '%'||$1||'%'",
          [id]
        )
      ).rows
    ).toHaveLength(2);
  } finally {
    await http.pool.query(
      "INSERT INTO user_roles(user_id,role_id) VALUES ('assigned','test-assigned')"
    );
  }
});
it('rolls back a reply and its audit when its private notification cannot be saved', async () => {
  const id = await ticket();
  await assign(id);
  await http.pool
    .query(`CREATE FUNCTION fail_ticket_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.link_route LIKE '%ticketId=%' THEN RAISE EXCEPTION 'test notice failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_ticket_notice BEFORE INSERT ON in_app_notifications FOR EACH ROW EXECUTE FUNCTION fail_ticket_notice()`);
  try {
    expect((await comment(id, 'Not saved')).status).toBe(500);
    expect(
      (await http.pool.query('SELECT id FROM ticket_comments WHERE ticket_id=$1', [id])).rows
    ).toHaveLength(0);
    expect(
      (
        await http.pool.query(
          "SELECT id FROM audit_log WHERE event='ticket_comment_added' AND metadata::jsonb->>'ticketId'=$1",
          [id]
        )
      ).rows
    ).toHaveLength(0);
  } finally {
    await http.pool.query(
      'DROP TRIGGER fail_ticket_notice ON in_app_notifications; DROP FUNCTION fail_ticket_notice()'
    );
  }
  expect((await comment(id, 'Saved on retry')).status).toBe(201);
});
it('records team assignment, rejects non-members and disabled teams, and clears team attribution on direct assignment', async () => {
  const id = await ticket(),
    team = randomUUID();
  await http.pool.query('INSERT INTO staff_teams(id,name) VALUES ($1,$2)', [team, `Team ${team}`]);
  await http.pool.query("INSERT INTO staff_team_members(team_id,user_id) VALUES ($1,'assigned')", [
    team,
  ]);
  const send = (assigneeId: string) =>
    fetch(`${http.base}/api/staff/tickets/${id}/assign`, {
      method: 'PUT',
      headers: headers.staff!,
      body: JSON.stringify({ assigneeId, teamId: team }),
    });
  expect((await send('staff')).status).toBe(409);
  expect((await send('assigned')).status).toBe(200);
  expect(
    (await http.pool.query('SELECT assigned_team_id,assigned_to FROM tickets WHERE id=$1', [id]))
      .rows[0]
  ).toEqual({ assigned_team_id: team, assigned_to: 'assigned' });
  await http.pool.query('UPDATE staff_teams SET is_active=false WHERE id=$1', [team]);
  expect((await send('assigned')).status).toBe(404);
  expect((await assign(id, 'staff')).status).toBe(200);
  expect(
    (await http.pool.query('SELECT assigned_team_id FROM tickets WHERE id=$1', [id])).rows[0]
      .assigned_team_id
  ).toBeNull();
});
it('rechecks team membership after waiting for a team edit to commit', async () => {
  const id = await ticket(),
    team = randomUUID(),
    client = await http.pool.connect();
  await http.pool.query('INSERT INTO staff_teams(id,name) VALUES ($1,$2)', [team, `Team ${team}`]);
  await http.pool.query("INSERT INTO staff_team_members(team_id,user_id) VALUES ($1,'assigned')", [
    team,
  ]);
  let response: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM staff_teams WHERE id=$1 FOR UPDATE', [team]);
    await client.query('DELETE FROM staff_team_members WHERE team_id=$1', [team]);
    response = fetch(`${http.base}/api/staff/tickets/${id}/assign`, {
      method: 'PUT',
      headers: headers.staff!,
      body: JSON.stringify({ assigneeId: 'assigned', teamId: team }),
    });
    const deadline = Date.now() + 5000;
    let waiting = false;
    while (Date.now() < deadline) {
      const rows = await http.pool.query(
        "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM staff_teams WHERE id=%'"
      );
      if (rows.rows.length) {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(waiting).toBe(true);
    await client.query('COMMIT');
    expect((await response).status).toBe(409);
    expect(
      (await http.pool.query('SELECT assigned_to FROM tickets WHERE id=$1', [id])).rows[0]
        .assigned_to
    ).toBeNull();
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await response;
  }
});
it('reads configured response targets only into the staff queue', async () => {
  await http.pool
    .query(`INSERT INTO app_config(key,value) VALUES ('admin.service_response_targets','{"ticket":2}')
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`);
  const staff = await fetch(`${http.base}/api/staff/tickets`, { headers: headers.staff! });
  expect(((await staff.json()) as { responseTargetHours: number }).responseTargetHours).toBe(2);
  const customer = await fetch(`${http.base}/api/tickets`, { headers: headers.customer! });
  expect(await customer.json()).not.toHaveProperty('responseTargetHours');
});

it('rejects malformed ticket IDs on every customer and staff detail action', async () => {
  for (const [prefix, user] of [
    ['/api/tickets', 'customer'],
    ['/api/staff/tickets', 'staff'],
  ] as const) {
    const actions: [string, string, unknown][] = [
      ['GET', '', undefined],
      ['GET', '/comments', undefined],
      ['PATCH', '/status', { status: 'closed' }],
      ['POST', '/comments', { body: 'A reply' }],
      ...(user === 'staff'
        ? [['PUT', '/assign', { assigneeId: 'staff' }] as [string, string, unknown]]
        : []),
    ];
    for (const [method, suffix, body] of actions) {
      const response = await fetch(`${http.base}${prefix}/malformed-id${suffix}`, {
        method,
        headers: headers[user]!,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      expect(response.status, `${method} ${prefix}${suffix}: ${await response.text()}`).toBe(400);
    }
    expect(
      (await fetch(`${http.base}${prefix}/${randomUUID()}`, { headers: headers[user]! })).status
    ).toBe(404);
  }
});
it('validates list pagination and filters before SQL on customer and staff paths', async () => {
  for (const [prefix, user] of [
    ['/api/tickets', 'customer'],
    ['/api/staff/tickets', 'staff'],
  ] as const) {
    for (const query of [
      'page=1.5',
      'page=NaN',
      'page=Infinity',
      'page=-1',
      'page=0',
      'page=100001',
      'page=',
      'page=1&page=2',
      'limit=0',
      'limit=1.5',
      'limit=101',
      'limit=Infinity',
      'limit=2&limit=3',
      'search=x&search=y',
      'sortBy=unknown',
      'sortOrder=ascending',
      'status=unknown',
    ]) {
      expect(
        (await fetch(`${http.base}${prefix}?${query}`, { headers: headers[user]! })).status,
        `${prefix}?${query}`
      ).toBe(400);
    }
    const defaults = await fetch(`${http.base}${prefix}`, { headers: headers[user]! });
    expect(defaults.status).toBe(200);
    expect(await defaults.json()).toMatchObject({ page: 1, limit: 20 });
    const empty = await fetch(`${http.base}${prefix}?page=100000&limit=100`, {
      headers: headers[user]!,
    });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toMatchObject({ data: [], page: 100000, limit: 100 });
  }
});
