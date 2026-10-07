import { NotificationsService } from '../notifications/notifications.service.js';
import {
  expectTicketDelivery,
  expectTicketNoticeRollback,
  ticketDeliverySnapshot,
} from '../test/ticket-notification-proof.js';
import type { TicketCommentRow } from './tickets.service.js';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let storageServer: Server;
const objects = new Map<string, Buffer>();
const headers: Record<string, Record<string, string>> = {};
const transientActors: string[] = [];
beforeAll(async () => {
  storageServer = createServer(async (req, res) => {
    const address = new URL(req.url!, 'http://localhost');
    if (address.searchParams.get('list-type') === '2') {
      const prefix = address.searchParams.get('prefix') ?? '';
      res.setHeader('Content-Type', 'application/xml');
      res.end(
        `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>false</IsTruncated>${[
          ...objects.entries(),
        ]
          .filter(([key]) => key.startsWith(prefix))
          .map(
            ([key, bytes]) => `<Contents><Key>${key}</Key><Size>${bytes.length}</Size></Contents>`
          )
          .join('')}</ListBucketResult>`
      );
      return;
    }
    const key = decodeURIComponent(address.pathname).replace('/test-evidence/', '');
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
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,operating_context)
      VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',$5)`,
      [id, user, csrf, randomUUID(), user === 'customer' ? 'customer' : 'staff']
    );
    headers[user] = {
      Cookie: `barghsa_session=${id}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    };
  }
  const customerSession = randomUUID(),
    customerCsrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,operating_context) VALUES ($1,'staff',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes','customer')",
    [customerSession, customerCsrf, randomUUID()]
  );
  headers.staffCustomer = {
    Cookie: `barghsa_session=${customerSession}`,
    'X-CSRF-Token': customerCsrf,
    'Content-Type': 'application/json',
  };
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

it('lists only the current user’s active-profile open tickets before pagination', async () => {
  const actor = await freshActor(false);
  const activeProfile = randomUUID(),
    otherProfile = randomUUID();
  await http.pool.query(
    `INSERT INTO profiles(id,user_id,is_default) VALUES ($1,$3,true),($2,$3,false)`,
    [activeProfile, otherProfile, actor.userId]
  );
  const ids = Array.from({ length: 5 }, () => randomUUID());
  await http.pool.query(
    `INSERT INTO tickets(id,user_id,profile_id,subject,body,status) VALUES
      ($1,$6,$7,'Open','Details','open'),
      ($2,$6,$7,'Waiting','Details','waiting_staff'),
      ($3,$6,$7,'Resolved','Details','resolved'),
      ($4,$6,$8,'Other profile','Details','open'),
      ($5,'customer',$7,'Other user','Details','open')`,
    [...ids, actor.userId, activeProfile, otherProfile]
  );

  const response = await fetch(
    `${http.base}/api/tickets?status=active&scope=active&limit=1&page=1`,
    { headers: actor.headers }
  );
  expect(response.status).toBe(200);
  const result = (await response.json()) as {
    total: number;
    totalPages: number;
    data: { id: string }[];
  };
  expect(result.total).toBe(2);
  expect(result.totalPages).toBe(2);
  expect(result.data).toHaveLength(1);
  expect(ids.slice(0, 2)).toContain(result.data[0]!.id);

  const invalid = await fetch(`${http.base}/api/tickets?scope=${otherProfile}`, {
    headers: actor.headers,
  });
  expect(invalid.status).toBe(400);
});
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
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,operating_context)
     VALUES ($1,$2,$3,$4,clock_timestamp()+$5*INTERVAL '1 second',NOW()+INTERVAL '30 minutes',$6)
     RETURNING expires_at`,
    [sessionId, userId, csrfToken, randomUUID(), expiresInSeconds, admin ? 'staff' : 'customer']
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

async function grantStaffRole(userId: string, roleId: string) {
  await http.pool.query('INSERT INTO user_roles(user_id,role_id) VALUES ($1,$2)', [userId, roleId]);
  await http.pool.query("UPDATE sessions SET operating_context='staff' WHERE user_id=$1", [userId]);
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
    await grantStaffRole(actor.userId, roleId);
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
    await grantStaffRole(actor.userId, roleId);
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
  await grantStaffRole(actor.userId, roleId);
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
      canApproveClosure: false,
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
  await grantStaffRole(actor.userId, roleId);
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
    await grantStaffRole(actor.userId, roleId);
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
function status(id: string, value: unknown, user = 'staff', reason?: string) {
  const path = user === 'staff' ? 'staff/tickets' : 'tickets';
  return fetch(`${http.base}/api/${path}/${id}/status`, {
    method: 'PATCH',
    headers: headers[user]!,
    body: JSON.stringify({ status: value, ...(reason !== undefined ? { reason } : {}) }),
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
it('stores a trimmed staff status reason once and keeps audit reasoning out of customer responses', async () => {
  const id = await ticket();
  await assign(id);
  const reason = '  Customer confirmed delivery.\nResolved after follow-up.  ';
  expect((await status(id, 'resolved', 'staff', reason)).status).toBe(200);
  const audit = await http.pool.query(
    "SELECT user_id,metadata::jsonb AS metadata FROM audit_log WHERE event='ticket_status_changed' AND metadata::jsonb->>'ticketId'=$1",
    [id]
  );
  expect(audit.rows).toHaveLength(1);
  expect(audit.rows[0].user_id).toBe('staff');
  expect(audit.rows[0].metadata).toMatchObject({
    ticketId: id,
    from: 'in_progress',
    to: 'resolved',
    reason: reason.trim(),
  });
  expect((await status(id, 'resolved', 'staff', 'A repeated request')).status).toBe(200);
  const after = await http.pool.query(
    "SELECT metadata::jsonb AS metadata FROM audit_log WHERE event='ticket_status_changed' AND metadata::jsonb->>'ticketId'=$1",
    [id]
  );
  expect(after.rows).toHaveLength(1);
  expect(after.rows[0].metadata.reason).toBe(reason.trim());
  const customer = await fetch(`${http.base}/api/tickets/${id}`, { headers: headers.customer! });
  expect(customer.status).toBe(200);
  expect(await customer.text()).not.toContain('Customer confirmed delivery');
});
it('rejects invalid staff status reasons and preserves write and assignment permissions', async () => {
  const id = await ticket();
  await assign(id);
  for (const reason of ['', '   ', null, 1, 'x'.repeat(2001)]) {
    const response = await fetch(`${http.base}/api/staff/tickets/${id}/status`, {
      method: 'PATCH',
      headers: headers.staff!,
      body: JSON.stringify({ status: 'resolved', reason }),
    });
    expect(response.status).toBe(400);
  }
  expect(
    (
      await fetch(`${http.base}/api/staff/tickets/${id}/status`, {
        method: 'PATCH',
        headers: headers.customer!,
        body: JSON.stringify({ status: 'resolved', reason: 'Not authorized' }),
      })
    ).status
  ).toBe(403);
  expect(
    (
      await fetch(`${http.base}/api/staff/tickets/${id}/status`, {
        method: 'PATCH',
        headers: headers.assigned!,
        body: JSON.stringify({ status: 'resolved', reason: 'Not my assignment' }),
      })
    ).status
  ).toBe(404);
  expect(
    (await http.pool.query('SELECT status FROM tickets WHERE id=$1', [id])).rows[0].status
  ).toBe('in_progress');
  expect(
    (
      await http.pool.query(
        "SELECT id FROM audit_log WHERE event='ticket_status_changed' AND metadata::jsonb->>'ticketId'=$1",
        [id]
      )
    ).rows
  ).toHaveLength(0);
});
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
    headers: headers.staffCustomer!,
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
    expect((await status(id, 'resolved', 'staff', 'Audit must commit this reason')).status).toBe(
      500
    );
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
    'staffCustomer'
  );
  expect(response.status, http.logs()).toBe(201);
  const row = (await response.json()) as { id: string; attachments: string[] };
  expect(row.attachments[0]).toMatch(/^ticket-attachments\//);
  objects.set(key, Buffer.from('%PDF-1.7\nReplaced original'));
  expect(
    (await fetch(`${http.base}/api/tickets/${row.id}`, { headers: headers.customer! })).status
  ).toBe(404);
  const detail = await fetch(`${http.base}/api/tickets/${row.id}`, {
    headers: headers.staffCustomer!,
  });
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
      (await createTicket({ subject: 'Audit failure ticket', body: 'Details' }, 'staffCustomer'))
        .status
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
    (await createTicket({ subject: 'Audit failure ticket', body: 'Details' }, 'staffCustomer'))
      .status
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

async function replyUpload(
  id: string,
  user = 'customer',
  extra: Record<string, unknown> = {},
  bytes: Buffer = Buffer.from('%PDF-1.7\nReply evidence')
) {
  const context = { purpose: 'ticket_reply_attachment', ticketId: id, ...extra };
  const meta = {
    fileName: 'reply.pdf',
    contentType: 'application/pdf',
    fileSize: bytes.length,
    category: 'document',
    ...context,
  };
  const issued = await fetch(`${http.base}/api/upload/presigned-url`, {
    method: 'POST',
    headers: headers[user]!,
    body: JSON.stringify(meta),
  });
  if (issued.status !== 201 && issued.status !== 200) return { response: issued, key: '' };
  const value = (await issued.json()) as { key: string; presignedUrl: string };
  objects.set(value.key, bytes);
  const verified = await fetch(`${http.base}/api/upload/${encodeURIComponent(value.key)}/verify`, {
    method: 'POST',
    headers: headers[user]!,
  });
  expect(verified.status, http.logs()).toBe(200);
  const recorded = await fetch(`${http.base}/api/upload/${encodeURIComponent(value.key)}/record`, {
    method: 'POST',
    headers: headers[user]!,
    body: JSON.stringify(meta),
  });
  return { response: recorded, key: value.key };
}
async function postReply(id: string, user: string, input: Record<string, unknown>) {
  return fetch(
    `${http.base}/api/${user === 'customer' || user === 'staffCustomer' ? 'tickets' : 'staff/tickets'}/${id}/comments`,
    { method: 'POST', headers: headers[user]!, body: JSON.stringify(input) }
  );
}

async function previewPdfBytes() {
  const pdf = new PDFDocument();
  const chunks: Buffer[] = [];
  pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
  const complete = new Promise<Buffer>((resolve) =>
    pdf.on('end', () => resolve(Buffer.concat(chunks)))
  );
  pdf.text('First page of verified support evidence');
  pdf.addPage().text('Second page is not in the thumbnail');
  pdf.end();
  return complete;
}
async function previewReplyFixture(internal = false) {
  const bytes = await previewPdfBytes();
  const id = await ticket(),
    upload = await replyUpload(id, internal ? 'staff' : 'customer', {}, bytes);
  expect(upload.response.status, http.logs()).toBe(200);
  const result = await postReply(id, internal ? 'staff' : 'customer', {
    body: 'Verified evidence',
    visibility: internal ? 'internal' : 'public',
    attachments: [upload.key],
  });
  expect(result.status, http.logs()).toBe(201);
  return { id, reply: (await result.json()) as TicketCommentRow };
}
function previewReply(id: string, commentId: string, index: number | string, user = 'customer') {
  const base = user === 'customer' ? 'tickets' : 'staff/tickets';
  return fetch(
    `${http.base}/api/${base}/${id}/comments/${commentId}/attachments/${index}/preview`,
    { headers: headers[user]! }
  );
}

it('projects and previews original ticket files with stable indices and current ticket/storage authority', async () => {
  const bytes = await previewPdfBytes(),
    sourceKey = `uploads/document/${randomUUID()}.pdf`;
  objects.set(sourceKey, bytes);
  await http.pool.query(
    `INSERT INTO storage_records(storage_key,status,metadata,file_size,content_type,category,file_name)
    VALUES ($1,'active',$2::jsonb,$3,'application/pdf','document','original.pdf')`,
    [
      sourceKey,
      JSON.stringify({ verified: true, uploadedBy: 'customer', purpose: 'ticket_attachment' }),
      bytes.length,
    ]
  );
  const created = await createTicket({
    subject: 'Original evidence',
    body: 'Details',
    attachments: [sourceKey],
  });
  expect(created.status, http.logs()).toBe(201);
  const row = (await created.json()) as { id: string; attachments: string[] };
  const read = (user = 'customer', index = 0) =>
    fetch(
      `${http.base}/api/${user === 'customer' ? 'tickets' : 'staff/tickets'}/${row.id}/attachments/${index}/preview`,
      { headers: headers[user]! }
    );
  for (const user of ['customer', 'staff']) {
    const detail = await fetch(
      `${http.base}/api/${user === 'customer' ? 'tickets' : 'staff/tickets'}/${row.id}`,
      { headers: headers[user]! }
    );
    expect(await detail.json()).toMatchObject({
      attachmentFiles: [{ fileName: 'original.pdf', contentType: 'application/pdf', fileIndex: 0 }],
    });
    expect((await read(user)).status, http.logs()).toBe(200);
  }
  expect((await read('assigned')).status).toBe(404);
  await http.pool.query(
    "UPDATE tickets SET assigned_to='assigned',attachments=$2::jsonb WHERE id=$1",
    [row.id, JSON.stringify(['ticket-attachments/missing', row.attachments[0]])]
  );
  const detail = await fetch(`${http.base}/api/tickets/${row.id}`, { headers: headers.customer! });
  const projected = (await detail.json()) as { attachmentDownloadUrls: string[] };
  expect(projected).toMatchObject({ attachmentFiles: [{ fileIndex: 1 }] });
  expect(projected.attachmentDownloadUrls).toHaveLength(1);
  expect((await read('assigned', 0)).status).toBe(404);
  expect((await read('assigned', 1)).status).toBe(200);
  const stranger = await freshActor(false);
  expect(
    (
      await fetch(`${http.base}/api/tickets/${row.id}/attachments/1/preview`, {
        headers: stranger.headers,
      })
    ).status
  ).toBe(404);
  await http.pool.query("UPDATE storage_records SET status='removed' WHERE storage_key=$1", [
    row.attachments[0],
  ]);
  expect((await read('customer', 1)).status).toBe(404);
  const removedDetail = await fetch(`${http.base}/api/tickets/${row.id}`, {
    headers: headers.customer!,
  });
  expect(await removedDetail.json()).toMatchObject({
    attachmentFiles: [],
    attachmentDownloadUrls: [],
  });
});

it('generates transient PDF review images in both contexts without reserving or persisting any bytes', async () => {
  const bytes = await previewPdfBytes();
  const storageRows = (await http.pool.query('SELECT COUNT(*) AS count FROM storage_records'))
    .rows[0]!.count;
  const storedObjects = objects.size;
  for (const user of ['customer', 'staff']) {
    const response = await fetch(`${http.base}/api/upload/preview`, {
      method: 'POST',
      headers: { ...headers[user], 'Content-Type': 'application/pdf' },
      body: new Uint8Array(bytes),
    });
    expect(response.status, http.logs()).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/png');
    expect(response.headers.get('cache-control')).toContain('no-store');
    const image = Buffer.from(await response.arrayBuffer());
    expect(image.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(image.length).toBeLessThan(5 * 1024 * 1024);
  }
  expect(
    (await http.pool.query('SELECT COUNT(*) AS count FROM storage_records')).rows[0]!.count
  ).toBe(storageRows);
  expect(objects.size).toBe(storedObjects);
});

it('rejects unauthenticated, CSRF-invalid, non-PDF, oversized and malformed transient preview input', async () => {
  const bytes = await previewPdfBytes();
  const send = (headers: Record<string, string>, body = bytes) =>
    fetch(`${http.base}/api/upload/preview`, {
      method: 'POST',
      headers,
      body: new Uint8Array(body),
    });
  expect((await send({ 'Content-Type': 'application/pdf' })).status).toBe(401);
  expect(
    (
      await send({
        ...headers.customer!,
        'Content-Type': 'application/pdf',
        'X-CSRF-Token': 'incorrect',
      })
    ).status
  ).toBe(403);
  expect((await send({ ...headers.customer!, 'Content-Type': 'text/plain' })).status).toBe(400);
  expect(
    (
      await send(
        { ...headers.customer!, 'Content-Type': 'application/pdf' },
        Buffer.from('<script>not PDF</script>')
      )
    ).status
  ).toBe(400);
  expect(
    (
      await send(
        { ...headers.customer!, 'Content-Type': 'application/pdf' },
        Buffer.alloc(10 * 1024 * 1024 + 1)
      )
    ).status
  ).toBe(413);
  expect(
    (
      await send(
        { ...headers.customer!, 'Content-Type': 'application/pdf' },
        Buffer.from('%PDF-malformed')
      )
    ).status
  ).toBe(503);
});

it('renders bounded first-page PNGs for current customer/staff/assigned scopes and rechecks cached authorization', async () => {
  const { id, reply } = await previewReplyFixture();
  expect(reply.attachments[0]!.fileIndex).toBe(0);
  for (const user of ['customer', 'staff']) {
    const response = await previewReply(id, reply.id, 0, user);
    expect(response.status, http.logs()).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/png');
    expect(response.headers.get('cache-control')).toBe(
      'private, no-cache, no-store, must-revalidate'
    );
    expect(response.headers.get('vary')).toContain('Cookie');
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(bytes.length).toBeLessThan(5 * 1024 * 1024);
  }
  expect((await previewReply(id, reply.id, 0, 'assigned')).status).toBe(404);
  await http.pool.query("UPDATE tickets SET assigned_to='assigned' WHERE id=$1", [id]);
  expect((await previewReply(id, reply.id, 0, 'assigned')).status).toBe(200);
  await http.pool.query("UPDATE tickets SET assigned_to='staff' WHERE id=$1", [id]);
  expect((await previewReply(id, reply.id, 0, 'assigned')).status).toBe(404);
  const stranger = await freshActor(false);
  expect(
    (
      await fetch(`${http.base}/api/tickets/${id}/comments/${reply.id}/attachments/0/preview`, {
        headers: stranger.headers,
      })
    ).status
  ).toBe(404);
  expect(
    (await fetch(`${http.base}/api/tickets/${id}/comments/${reply.id}/attachments/0/preview`))
      .status
  ).toBe(401);
});

it('never serves internal, cross-ticket, unavailable or unbound reply bytes, even after preview caching', async () => {
  const { id, reply } = await previewReplyFixture(true);
  expect((await previewReply(id, reply.id, 0)).status).toBe(404);
  expect((await previewReply(id, reply.id, 0, 'staff')).status).toBe(200);
  const other = await ticket();
  expect((await previewReply(other, reply.id, 0, 'staff')).status).toBe(404);
  for (const index of [-1, 5, '1.5', 'NaN'])
    expect((await previewReply(id, reply.id, index, 'staff')).status).toBe(400);
  expect((await previewReply(id, randomUUID(), 0, 'staff')).status).toBe(404);
  expect((await previewReply(id, reply.id, 1, 'staff')).status).toBe(404);
  const key = reply.attachments[0]!.key;
  await http.pool.query(
    "UPDATE storage_records SET metadata=jsonb_set(metadata,'{ticketId}',to_jsonb($2::text)) WHERE storage_key=$1",
    [key, other]
  );
  expect((await previewReply(id, reply.id, 0, 'staff')).status).toBe(404);
  await http.pool.query(
    "UPDATE storage_records SET metadata=jsonb_set(metadata,'{ticketId}',to_jsonb($2::text)),status='removed' WHERE storage_key=$1",
    [key, id]
  );
  expect((await previewReply(id, reply.id, 0, 'staff')).status).toBe(404);
});

it('retains original attachment indices when unavailable files are omitted from the projection', async () => {
  const { id, reply } = await previewReplyFixture();
  const key = reply.attachments[0]!.key;
  await http.pool.query('UPDATE ticket_comments SET attachments=$2 WHERE id=$1', [
    reply.id,
    JSON.stringify(['ticket-reply-attachments/missing', key]),
  ]);
  const read = await fetch(`${http.base}/api/tickets/${id}/comments`, {
    headers: headers.customer!,
  });
  const rows = (await read.json()) as TicketCommentRow[];
  expect(rows[0]!.attachments).toHaveLength(1);
  expect(rows[0]!.attachments[0]!.fileIndex).toBe(1);
  expect((await previewReply(id, reply.id, 0)).status).toBe(404);
  expect((await previewReply(id, reply.id, 1)).status).toBe(200);
});

it('rejects revoked permissions and expired sessions before reading a cached ticket derivative', async () => {
  const { id, reply } = await previewReplyFixture(true);
  const actor = await freshActor(false);
  await grantStaffRole(actor.userId, 'test-assigned');
  await http.pool.query('UPDATE tickets SET assigned_to=$2 WHERE id=$1', [id, actor.userId]);
  const read = () =>
    fetch(`${http.base}/api/staff/tickets/${id}/comments/${reply.id}/attachments/0/preview`, {
      headers: actor.headers,
    });
  expect((await read()).status).toBe(200);
  await http.pool.query('DELETE FROM user_roles WHERE user_id=$1', [actor.userId]);
  expect((await read()).status).toBe(403);
  await grantStaffRole(actor.userId, 'test-assigned');
  await http.pool.query(
    "UPDATE sessions SET expires_at=NOW()-INTERVAL '1 second' WHERE session_id=$1",
    [actor.sessionId]
  );
  expect((await read()).status).toBe(401);
});

it('reports renderer failures safely without returning original PDF bytes or storage details', async () => {
  const id = await ticket(),
    upload = await replyUpload(id);
  expect(upload.response.status).toBe(200);
  const reply = (await (
    await postReply(id, 'customer', { body: 'Malformed PDF', attachments: [upload.key] })
  ).json()) as TicketCommentRow;
  const response = await previewReply(id, reply.id, 0);
  expect(response.status).toBe(503);
  const body = await response.text();
  expect(body).not.toContain(reply.attachments[0]!.key);
  expect(body).not.toContain('Reply evidence');
});
it('uploads and seals customer/staff reply files, keeps internal evidence private and preserves legacy text', async () => {
  const id = await ticket('waiting_customer');
  const upload = await replyUpload(id);
  expect(upload.response.status, http.logs()).toBe(200);
  const sent = await postReply(id, 'customer', {
    body: '**Customer answer**',
    bodyFormat: 'markdown',
    attachments: [upload.key],
    submissionId: randomUUID(),
  });
  expect(sent.status, http.logs()).toBe(201);
  const reply = (await sent.json()) as TicketCommentRow;
  expect(reply).toMatchObject({ bodyFormat: 'markdown', authorContext: 'customer' });
  expect(reply.attachments).toHaveLength(1);
  expect(reply.attachments[0]!).toMatchObject({
    fileName: 'reply.pdf',
    contentType: 'application/pdf',
  });
  expect(reply.attachments[0]!.key).toMatch(/^ticket-reply-attachments\//);
  const signed = new URL(reply.attachments[0]!.url);
  expect(signed.searchParams.get('X-Amz-Expires')).toBe('300');
  objects.set(upload.key, Buffer.from('%PDF-1.7\nReplaced source'));
  expect(await (await fetch(signed)).text()).toContain('Reply evidence');
  const internalUpload = await replyUpload(id, 'staff');
  expect(internalUpload.response.status, http.logs()).toBe(200);
  expect(
    (
      await postReply(id, 'staff', {
        body: '',
        visibility: 'internal',
        attachments: [internalUpload.key],
      })
    ).status
  ).toBe(201);
  expect((await postReply(id, 'staff', { body: '**Literal old syntax**' })).status).toBe(201);
  const customerRead = (await (
    await fetch(`${http.base}/api/tickets/${id}/comments`, { headers: headers.customer! })
  ).json()) as TicketCommentRow[];
  expect(customerRead).toHaveLength(2);
  expect(customerRead[1]).toMatchObject({
    bodyFormat: 'plain',
    authorContext: 'staff',
    attachments: [],
  });
  expect(JSON.stringify(customerRead)).not.toContain(internalUpload.key);
  const staffRead = (await (
    await fetch(`${http.base}/api/staff/tickets/${id}/comments`, { headers: headers.staff! })
  ).json()) as TicketCommentRow[];
  expect(staffRead).toHaveLength(3);
  expect(staffRead[1]).toMatchObject({ visibility: 'internal' });
  expect(staffRead[1]!.attachments).toHaveLength(1);
  expect(
    (await http.pool.query('SELECT status FROM tickets WHERE id=$1', [id])).rows[0]!.status
  ).toBe('in_progress');
});
it('authorizes reply uploads against current owner, assignment, operating context, profile and lifecycle', async () => {
  const id = await ticket();
  expect((await replyUpload(id, 'assigned')).response.status).toBe(404);
  expect((await replyUpload(id, 'staffCustomer')).response.status).toBe(404);
  expect((await replyUpload(id, 'customer', { profileId: randomUUID() })).response.status).toBe(
    400
  );
  expect(
    (await replyUpload(id, 'customer', { purpose: 'ticket_attachment' })).response.status
  ).toBe(400);
  await assign(id, 'assigned');
  const issued = await replyUpload(id, 'assigned');
  expect(issued.response.status, http.logs()).toBe(200);
  expect(
    (
      await fetch(`${http.base}/api/upload/${encodeURIComponent(issued.key)}/record`, {
        method: 'POST',
        headers: headers.assigned!,
        body: JSON.stringify({ purpose: 'ticket_reply_attachment', ticketId: await ticket() }),
      })
    ).status
  ).toBe(409);
  await assign(id, 'staff');
  expect(
    (await postReply(id, 'assigned', { body: 'Revoked assignment', attachments: [issued.key] }))
      .status
  ).toBe(404);
  expect((await replyUpload(await ticket('closed'))).response.status).toBe(400);
  expect((await replyUpload(await ticket('resolved'))).response.status).toBe(400);
});
it('rejects cross-ticket, cross-uploader, unverified and duplicate reply attachments and invalid formats', async () => {
  const id = await ticket(),
    other = await ticket();
  const upload = await replyUpload(id);
  expect(upload.response.status).toBe(200);
  for (const [target, user, options] of [
    [other, 'customer', {}],
    [id, 'staff', {}],
    [id, 'customer', { attachments: [upload.key, upload.key] }],
    [id, 'customer', { bodyFormat: 'html' }],
    [id, 'customer', { visibility: 'internal' }],
  ] as const) {
    const response = await postReply(target, user, {
      body: 'Reply',
      attachments: [upload.key],
      ...options,
    });
    expect(response.status).toBe(options.visibility === 'internal' ? 403 : 400);
  }
  await http.pool.query(
    `UPDATE storage_records SET metadata=metadata || '{"verified":false}'::jsonb WHERE storage_key=$1`,
    [upload.key]
  );
  expect(
    (await postReply(id, 'customer', { body: 'Unverified', attachments: [upload.key] })).status
  ).toBe(400);
  expect(
    (await http.pool.query('SELECT id FROM ticket_comments WHERE ticket_id=$1', [id])).rows
  ).toHaveLength(0);
});
it('deduplicates concurrent/lost reply acknowledgements, conflicts on changed content and rechecks authority before replay', async () => {
  const id = await ticket();
  await assign(id, 'assigned');
  const upload = await replyUpload(id, 'assigned');
  expect(upload.response.status).toBe(200);
  const input = {
    body: 'One durable reply',
    bodyFormat: 'markdown',
    attachments: [upload.key],
    submissionId: randomUUID(),
  };
  const responses = await Promise.all([
    postReply(id, 'assigned', input),
    postReply(id, 'assigned', input),
  ]);
  expect(responses.map((response) => response.status)).toEqual([201, 201]);
  const rows = await Promise.all(
    responses.map(async (response) => (await response.json()) as TicketCommentRow)
  );
  expect(rows[0]!.id).toBe(rows[1]!.id);
  expect(rows[0]!.attachments[0]!.key).toBe(rows[1]!.attachments[0]!.key);
  expect(
    (
      await http.pool.query(
        `SELECT id FROM audit_log WHERE event='ticket_comment_added' AND metadata::jsonb->>'ticketId'=$1`,
        [id]
      )
    ).rows
  ).toHaveLength(1);
  expect((await postReply(id, 'assigned', { ...input, body: 'Changed' })).status).toBe(409);
  await http.pool.query("UPDATE tickets SET status='closed' WHERE id=$1", [id]);
  expect((await postReply(id, 'assigned', input)).status).toBe(201);
  await assign(id, 'staff');
  expect((await postReply(id, 'assigned', input)).status).toBe(404);
});
it('rolls back reply sealing and retry identity when its audit fails', async () => {
  const id = await ticket();
  const upload = await replyUpload(id);
  expect(upload.response.status).toBe(200);
  const input = { body: 'Atomic reply', attachments: [upload.key], submissionId: randomUUID() };
  await http.pool
    .query(`CREATE FUNCTION fail_reply_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.event='ticket_comment_added' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_reply_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_reply_audit()`);
  try {
    expect((await postReply(id, 'customer', input)).status).toBe(500);
    expect(
      (await http.pool.query('SELECT id FROM ticket_comments WHERE ticket_id=$1', [id])).rows
    ).toHaveLength(0);
    expect(
      (
        await http.pool.query(
          `SELECT status,metadata FROM storage_records WHERE metadata->>'ticketId'=$1 AND storage_key LIKE 'ticket-reply-attachments/%'`,
          [id]
        )
      ).rows
    ).toEqual([
      expect.objectContaining({
        status: 'removed',
        metadata: expect.objectContaining({ provisionalCopy: true, deletionRequested: true }),
      }),
    ]);
  } finally {
    await http.pool.query(
      'DROP TRIGGER fail_reply_audit ON audit_log; DROP FUNCTION fail_reply_audit()'
    );
  }
  expect((await postReply(id, 'customer', input)).status).toBe(201);
});

async function linkedRecordFixture() {
  const actor = await freshActor(false),
    profileId = randomUUID();
  await http.pool.query('INSERT INTO profiles(id,user_id,is_default) VALUES($1,$2,true)', [
    profileId,
    actor.userId,
  ]);
  const contractId = randomUUID(),
    versionId = randomUUID();
  const client = await http.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "INSERT INTO contracts(id,profile_id,service_type,current_version_id) VALUES($1,$2,'electricity',$3)",
      [contractId, profileId, versionId]
    );
    await client.query(
      "INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by) VALUES($1,$2,1,'{\"text\":\"Published terms\"}','Initial','staff')",
      [versionId, contractId]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  const invoiceId = randomUUID();
  await http.pool.query('INSERT INTO invoices(id,profile_id,total_amount) VALUES($1,$2,100)', [
    invoiceId,
    profileId,
  ]);
  return { actor, profileId, contractId, versionId, invoiceId };
}
function linkedRequest(
  f: Awaited<ReturnType<typeof linkedRecordFixture>>,
  kind: string,
  id: string,
  profileId = f.profileId
) {
  return fetch(`${http.base}/api/tickets`, {
    method: 'POST',
    headers: f.actor.headers,
    body: JSON.stringify({
      subject: 'Business record question',
      body: 'Please help',
      profileId,
      relatedEntityType: kind,
      relatedEntityId: id,
    }),
  });
}
async function publishLinkedContract(f: Awaited<ReturnType<typeof linkedRecordFixture>>) {
  await http.pool.query("UPDATE contracts SET state='AwaitingStaffReview' WHERE id=$1", [
    f.contractId,
  ]);
  await http.pool.query(
    "INSERT INTO contract_publications(contract_id,version_id,published_by) VALUES($1,$2,'staff')",
    [f.contractId, f.versionId]
  );
}
it('offers only published owned contracts and validates their profile and record type during ticket creation', async () => {
  const f = await linkedRecordFixture(),
    other = await linkedRecordFixture();
  const options = async (profileId = f.profileId) =>
    fetch(`${http.base}/api/tickets/options?profileId=${profileId}`, { headers: f.actor.headers });
  expect(((await (await options()).json()) as { records: unknown[] }).records).not.toContainEqual(
    expect.objectContaining({ id: f.contractId })
  );
  expect((await linkedRequest(f, 'contract', f.contractId)).status).toBe(404);
  await publishLinkedContract(f);
  await publishLinkedContract(other);
  expect(((await (await options()).json()) as { records: unknown[] }).records).toContainEqual(
    expect.objectContaining({ id: f.contractId, type: 'contract' })
  );
  expect((await options(other.profileId)).status).toBe(404);
  expect((await linkedRequest(f, 'contract', other.contractId)).status).toBe(404);
  expect((await linkedRequest(f, 'contract', f.invoiceId)).status).toBe(404);
  const created = await linkedRequest(f, 'contract', f.contractId.toUpperCase());
  expect(created.status, http.logs()).toBe(201);
  const ticket = (await created.json()) as { id: string };
  const expected = {
    sourceId: f.contractId.toUpperCase(),
    destination: 'contract',
    id: f.contractId,
  };
  for (const [path, auth] of [
    [`/api/tickets/${ticket.id}`, f.actor.headers],
    [`/api/staff/tickets/${ticket.id}`, headers.staff!],
  ] as const) {
    const response = await fetch(http.base + path, { headers: auth });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { relatedRecord: unknown }).relatedRecord).toEqual(expected);
  }
  expect(
    (await fetch(`${http.base}/api/staff/tickets/${ticket.id}`, { headers: headers.assigned! }))
      .status
  ).toBe(404);
  expect(
    (await fetch(`${http.base}/api/tickets/${ticket.id}`, { headers: other.actor.headers })).status
  ).toBe(404);
  for (const [path, auth] of [
    ['/api/tickets', f.actor.headers],
    ['/api/staff/tickets', headers.staff!],
  ] as const) {
    const response = await fetch(http.base + path, { headers: auth });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { data: unknown[] }).data).toContainEqual(
      expect.objectContaining({ id: ticket.id, relatedRecord: expected })
    );
  }
});
it('does not disclose draft destinations or references after profile ownership changes or archival', async () => {
  const f = await linkedRecordFixture(),
    id = await ticket();
  await http.pool.query(
    'UPDATE tickets SET user_id=$2,profile_id=$3,related_entity_type=$4,related_entity_id=$5 WHERE id=$1',
    [id, f.actor.userId, f.profileId, 'contract', f.contractId]
  );
  const read = async () => {
    const response = await fetch(`${http.base}/api/tickets/${id}`, { headers: f.actor.headers });
    expect(response.status).toBe(200);
    return (await response.json()) as { relatedRecord: unknown };
  };
  expect((await read()).relatedRecord).toBeNull();
  await publishLinkedContract(f);
  expect((await read()).relatedRecord).toMatchObject({ id: f.contractId });
  await http.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [f.profileId]);
  expect((await read()).relatedRecord).toBeNull();
  await http.pool.query("UPDATE profiles SET archived=false,user_id='staff' WHERE id=$1", [
    f.profileId,
  ]);
  expect((await read()).relatedRecord).toBeNull();
});
it('resolves electricity and saving details with distinct IDs while keeping unsupported legacy orders unavailable', async () => {
  const f = await linkedRecordFixture();
  const products = (
    await http.pool.query(
      'INSERT INTO products(type,title,price,status) VALUES(\'saving_plan\',\'{"en":"Plan","fa":"طرح"}\',100000,\'active\'),(\'hardware\',\'{"en":"Hardware","fa":"دستگاه"}\',100000,\'active\') RETURNING id,type'
    )
  ).rows;
  const plan = products.find((row) => row.type === 'saving_plan')!.id,
    hardware = products.find((row) => row.type === 'hardware')!.id;
  const agreement = (
    await http.pool.query(
      "INSERT INTO saving_plan_agreement_versions(plan_id,title,body,created_by) VALUES($1,'Terms','Agreement','staff') RETURNING id",
      [plan]
    )
  ).rows[0].id;
  const province = (
    await http.pool.query(
      "INSERT INTO provinces(name_fa,name_en) VALUES('استان آزمایشی','Test') RETURNING id"
    )
  ).rows[0].id;
  const city = (
    await http.pool.query(
      "INSERT INTO cities(province_id,name_fa,name_en) VALUES($1,'شهر آزمایشی','Test') RETURNING id",
      [province]
    )
  ).rows[0].id;
  const address = (
    await http.pool.query(
      "INSERT INTO addresses(profile_id,province_id,city_id,full_address,postal_code) VALUES($1,$2,$3,'Address','1234567890') RETURNING id",
      [f.profileId, province, city]
    )
  ).rows[0].id;
  const order = async (type: string) =>
    (
      await http.pool.query(
        "INSERT INTO orders(user_id,profile_id,product_id,order_type,status,snapshot_province_id,snapshot_city_id,snapshot_full_address,snapshot_postal_code) VALUES($1,$2,$3,$4,'PENDING',$5,$6,'Address','1234567890') RETURNING id",
        [f.actor.userId, f.profileId, plan, type, province, city]
      )
    ).rows[0].id as string;
  const electricity = await order('electricity'),
    savingParent = await order('savings'),
    legacy = await order('solar'),
    draft = await order('electricity');
  await http.pool.query(
    "INSERT INTO electricity_orders(id,profile_id,settings_snapshot) VALUES($1,$2,'{}')",
    [electricity, f.profileId]
  );
  await http.pool.query(
    "INSERT INTO electricity_orders(id,profile_id,settings_snapshot) VALUES($1,$2,'{}')",
    [draft, f.profileId]
  );
  await http.pool.query('INSERT INTO electricity_contracts(order_id,contract_id) VALUES($1,$2)', [
    electricity,
    f.contractId,
  ]);
  await http.pool.query('UPDATE invoices SET contract_id=$2 WHERE id=$1', [
    f.invoiceId,
    f.contractId,
  ]);
  await http.pool.query(
    'UPDATE contract_activation_requirements SET initial_invoice_id=$2 WHERE version_id=$1',
    [f.versionId, f.invoiceId]
  );
  const saving = (
    await http.pool.query(
      "INSERT INTO saving_orders(order_id,profile_id,saving_plan_id,hardware_product_id,bill_identifier,installation_address_id,agreement_version_id,agreement_snapshot,address_snapshot,pricing_snapshot,verification_result) VALUES($1,$2,$3,$4,'1234567890123',$5,$6,'Agreement','{}','{}','{}') RETURNING id",
      [savingParent, f.profileId, plan, hardware, address, agreement]
    )
  ).rows[0].id;
  expect(saving).not.toBe(savingParent);
  const expectations = [
    [
      'order',
      electricity,
      { sourceId: electricity, destination: 'electricity_order', id: electricity },
    ],
    ['order', savingParent, { sourceId: savingParent, destination: 'saving_order', id: saving }],
    ['order', legacy, null],
    ['order', draft, null],
    ['invoice', f.invoiceId, { sourceId: f.invoiceId, destination: 'invoice', id: f.invoiceId }],
  ] as const;
  const created: { id: string; relatedRecord: unknown }[] = [];
  for (const [kind, source, expected] of expectations) {
    const response = await linkedRequest(f, kind, source);
    expect(response.status, http.logs()).toBe(201);
    const row = (await response.json()) as { id: string };
    created.push({ id: row.id, relatedRecord: expected });
    for (const [prefix, auth] of [
      ['/api/tickets', f.actor.headers],
      ['/api/staff/tickets', headers.staff!],
    ] as const) {
      const detail = await fetch(`${http.base}${prefix}/${row.id}`, { headers: auth });
      expect(detail.status).toBe(200);
      expect(((await detail.json()) as { relatedRecord: unknown }).relatedRecord).toEqual(expected);
    }
  }
  for (const [prefix, auth] of [
    ['/api/tickets', f.actor.headers],
    ['/api/staff/tickets', headers.staff!],
  ] as const) {
    const list = await fetch(`${http.base}${prefix}?limit=100`, { headers: auth });
    expect(list.status).toBe(200);
    const rows = ((await list.json()) as { data: unknown[] }).data;
    for (const expected of created) expect(rows).toContainEqual(expect.objectContaining(expected));
  }
});

// Durable form commands reuse the same compiled HTTP/PostgreSQL and storage fixture above.
type DurableTicketIdentity = Pick<import('./tickets.service.js').TicketRow, 'id'>;
type TicketFormErrorResponse = { error: { fields?: readonly string[] } };
function durableTicketCommand(
  path: string,
  method: string,
  body: unknown,
  actorHeaders = headers.staff!
) {
  return fetch(http.base + path, { method, headers: actorHeaders, body: JSON.stringify(body) });
}
async function durableTicketEffects(id: string) {
  return {
    audits: (
      await http.pool.query(
        "SELECT event,metadata::jsonb AS metadata FROM audit_log WHERE metadata::jsonb->>'ticketId'=$1 OR metadata::jsonb->>'itemId'=$1 ORDER BY id",
        [id]
      )
    ).rows,
    notices: (
      await http.pool.query(
        "SELECT id,recipient_user_id,localized_content FROM in_app_notifications WHERE link_route LIKE '%'||$1||'%' ORDER BY id",
        [id]
      )
    ).rows,
  };
}
it('deduplicates original ticket creation and auto-assignment without replaying later eligibility', async () => {
  const f = await linkedRecordFixture();
  await publishLinkedContract(f);
  const team = randomUUID(),
    key = randomUUID();
  const priorConfig = (
    await http.pool.query(
      "SELECT value,version FROM app_config WHERE key='admin.staff_assignment_rules'"
    )
  ).rows[0];
  await http.pool.query('INSERT INTO staff_teams(id,name) VALUES($1,$2)', [
    team,
    `Durable ${team}`,
  ]);
  await http.pool.query(
    "INSERT INTO staff_team_members(team_id,user_id) VALUES($1,'staff'),($1,'assigned')",
    [team]
  );
  await http.pool.query(
    "INSERT INTO app_config(key,value) VALUES('admin.staff_assignment_rules',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
    [JSON.stringify({ ticket: { teamId: team, strategy: 'round_robin' } })]
  );
  const body = {
    subject: '  Captured intake  ',
    body: '  Original details  ',
    profileId: f.profileId,
    relatedEntityType: 'contract',
    relatedEntityId: f.contractId,
    idempotencyKey: key,
  };
  try {
    const responses = await Promise.all(
      [0, 1].map(() => durableTicketCommand('/api/tickets', 'POST', body, f.actor.headers))
    );
    expect(
      responses.map((r) => r.status),
      http.logs()
    ).toEqual([201, 201]);
    const receipts = await Promise.all(responses.map((r) => r.json()));
    expect(receipts[1]).toEqual(receipts[0]);
    const first = receipts[0] as {
      id: string;
      status: string;
      assignedTo: string;
      attachments: unknown[];
    };
    expect(first.status).toBe('in_progress');
    expect(first.assignedTo).toBe('assigned');
    await expectTicketDelivery(http.pool, first.id, 'ticket.assigned', 'created', [
      { user: 'assigned', context: 'staff' },
    ]);
    expect(first.attachments).toEqual([]);
    expect(first).not.toHaveProperty('idempotencyKey');
    const effects = await durableTicketEffects(first.id);
    expect(effects.audits.map((row) => row.event).sort()).toEqual([
      'ticket_created',
      'work_auto_assigned',
    ]);
    expect(effects.notices.length).toBeGreaterThan(0);
    const cursor = (
      await http.pool.query(
        'SELECT last_user_id,updated_at FROM staff_assignment_cursors WHERE team_id=$1',
        [team]
      )
    ).rows;
    await http.pool.query("UPDATE tickets SET status='closed' WHERE id=$1", [first.id]);
    expect(
      (
        await http.pool.query(
          'SELECT contract_id FROM contract_publications WHERE contract_id=$1',
          [f.contractId]
        )
      ).rows
    ).toEqual([{ contract_id: f.contractId }]);
    await http.pool.query('UPDATE staff_teams SET is_active=false WHERE id=$1', [team]);
    const replay = await durableTicketCommand('/api/tickets', 'POST', body, f.actor.headers);
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(first);
    expect(await durableTicketEffects(first.id)).toEqual(effects);
    expect(
      (
        await http.pool.query(
          'SELECT last_user_id,updated_at FROM staff_assignment_cursors WHERE team_id=$1',
          [team]
        )
      ).rows
    ).toEqual(cursor);
    expect(
      (await http.pool.query('SELECT status FROM tickets WHERE id=$1', [first.id])).rows[0].status
    ).toBe('closed');
    expect(
      (
        await durableTicketCommand(
          '/api/tickets',
          'POST',
          { ...body, body: 'Altered' },
          f.actor.headers
        )
      ).status
    ).toBe(409);
    const other = await freshActor(false);
    const isolated = await durableTicketCommand(
      '/api/tickets',
      'POST',
      { subject: 'Separate actor', body: 'Separate original', idempotencyKey: key },
      other.headers
    );
    expect(isolated.status).toBe(201);
    expect(((await isolated.json()) as DurableTicketIdentity).id).not.toBe(first.id);
    await http.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [f.profileId]);
    const denied = await durableTicketCommand('/api/tickets', 'POST', body, f.actor.headers);
    expect(denied.status).toBe(404);
    expect(JSON.stringify(await denied.json())).not.toContain('Original details');
  } finally {
    if (priorConfig)
      await http.pool.query(
        "UPDATE app_config SET value=$1::jsonb,version=$2 WHERE key='admin.staff_assignment_rules'",
        [JSON.stringify(priorConfig.value), priorConfig.version]
      );
    else await http.pool.query("DELETE FROM app_config WHERE key='admin.staff_assignment_rules'");
  }
});
it('replays original staff and customer status receipts without reverting later states or reasons', async () => {
  const id = await ticket('in_progress');
  await http.pool.query("UPDATE tickets SET assigned_to='assigned' WHERE id=$1", [id]);
  const body = {
    status: 'resolved',
    reason: '  Captured decision  ',
    idempotencyKey: randomUUID(),
  };
  const send = () => durableTicketCommand(`/api/staff/tickets/${id}/status`, 'PATCH', body);
  const responses = await Promise.all([send(), send()]);
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
  const receipts = await Promise.all(responses.map((r) => r.json()));
  expect(receipts[1]).toEqual(receipts[0]);
  const effects = await durableTicketEffects(id);
  expect(effects.audits.filter((r) => r.event === 'ticket_status_changed')).toHaveLength(1);
  expect(effects.audits[0].metadata.reason).toBe('Captured decision');
  expect(receipts[0]).not.toHaveProperty('reason');
  await http.pool.query("UPDATE tickets SET status='closed' WHERE id=$1", [id]);
  expect(await (await send()).json()).toEqual(receipts[0]);
  expect(await durableTicketEffects(id)).toEqual(effects);
  expect(
    (
      await durableTicketCommand(`/api/staff/tickets/${id}/status`, 'PATCH', {
        ...body,
        reason: 'Changed',
      })
    ).status
  ).toBe(409);
  expect(
    (await http.pool.query('SELECT status FROM tickets WHERE id=$1', [id])).rows[0].status
  ).toBe('closed');
  const customer = { status: 'open', ignored: 'legacy body', idempotencyKey: body.idempotencyKey };
  const customerSend = () =>
    durableTicketCommand(`/api/tickets/${id}/status`, 'PATCH', customer, headers.customer!);
  const opened = await customerSend();
  expect(opened.status).toBe(200);
  const original = await opened.json();
  const customerEffects = await durableTicketEffects(id);
  await http.pool.query("UPDATE tickets SET status='resolved' WHERE id=$1", [id]);
  expect(await (await customerSend()).json()).toEqual(original);
  expect(await durableTicketEffects(id)).toEqual(customerEffects);
  expect(
    (await http.pool.query('SELECT status FROM tickets WHERE id=$1', [id])).rows[0].status
  ).toBe('resolved');
  expect(
    (
      await durableTicketCommand(
        `/api/tickets/${id}/status`,
        'PATCH',
        { ...customer, status: 'closed' },
        headers.customer!
      )
    ).status
  ).toBe(403);
});
it('replays assignment originals after target eligibility changes without another audit or notice', async () => {
  const id = await ticket(),
    team = randomUUID(),
    target = await freshActor(false);
  await grantStaffRole(target.userId, 'test-assigned');
  await http.pool.query('INSERT INTO staff_teams(id,name) VALUES($1,$2)', [
    team,
    `Durable ${team}`,
  ]);
  await http.pool.query('INSERT INTO staff_team_members(team_id,user_id) VALUES($1,$2)', [
    team,
    target.userId,
  ]);
  const body = { assigneeId: target.userId, teamId: team, idempotencyKey: randomUUID() };
  const send = () => durableTicketCommand(`/api/staff/tickets/${id}/assign`, 'PUT', body);
  const responses = await Promise.all([send(), send()]);
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
  const receipts = await Promise.all(responses.map((r) => r.json()));
  expect(receipts[1]).toEqual(receipts[0]);
  expect(receipts[0]).toMatchObject({
    assignedTo: target.userId,
    assignedTeamId: team,
    status: 'in_progress',
  });
  const effects = await durableTicketEffects(id);
  expect(effects.audits.filter((r) => r.event === 'ticket_assigned')).toHaveLength(1);
  await http.pool.query('UPDATE staff_teams SET is_active=false WHERE id=$1', [team]);
  await http.pool.query('UPDATE users SET disabled_at=NOW() WHERE user_id=$1', [target.userId]);
  await http.pool.query(
    "UPDATE tickets SET assigned_to='staff',assigned_team_id=NULL,status='resolved' WHERE id=$1",
    [id]
  );
  const replay = await send();
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual(receipts[0]);
  expect(await durableTicketEffects(id)).toEqual(effects);
  expect(
    (
      await http.pool.query('SELECT assigned_to,assigned_team_id,status FROM tickets WHERE id=$1', [
        id,
      ])
    ).rows[0]
  ).toEqual({ assigned_to: 'staff', assigned_team_id: null, status: 'resolved' });
  expect(
    (
      await durableTicketCommand(`/api/staff/tickets/${id}/assign`, 'PUT', {
        ...body,
        assigneeId: 'staff',
      })
    ).status
  ).toBe(409);
});
it('rejects cached ticket receipts after current assigned scope or staff grants are lost', async () => {
  const actor = await freshActor(false),
    id = await ticket('in_progress');
  await grantStaffRole(actor.userId, 'test-assigned');
  await http.pool.query('UPDATE tickets SET assigned_to=$1 WHERE id=$2', [actor.userId, id]);
  const assignment = { idempotencyKey: randomUUID() };
  const statusBody = {
    status: 'waiting_customer',
    reason: 'Captured',
    idempotencyKey: randomUUID(),
  };
  const assignSend = () =>
    durableTicketCommand(`/api/staff/tickets/${id}/assign`, 'PUT', assignment, actor.headers);
  const statusSend = () =>
    durableTicketCommand(`/api/staff/tickets/${id}/status`, 'PATCH', statusBody, actor.headers);
  expect((await assignSend()).status).toBe(200);
  expect((await statusSend()).status).toBe(200);
  const effects = await durableTicketEffects(id);
  await http.pool.query("UPDATE tickets SET assigned_to='staff' WHERE id=$1", [id]);
  expect((await assignSend()).status).toBe(404);
  expect((await statusSend()).status).toBe(404);
  await http.pool.query('UPDATE tickets SET assigned_to=$1 WHERE id=$2', [actor.userId, id]);
  await http.pool.query('DELETE FROM user_roles WHERE user_id=$1', [actor.userId]);
  for (const send of [assignSend, statusSend]) {
    const denied = await send();
    expect(denied.status).toBe(403);
    const response = JSON.stringify(await denied.json());
    expect(response).not.toContain('A question');
    expect(response).not.toContain('fields');
  }
  expect(await durableTicketEffects(id)).toEqual(effects);
});
it('rejects an original cached create if its session expires while current authority waits', async () => {
  const actor = await freshActor(false),
    body = {
      subject: 'Frozen private intake',
      body: 'Private original',
      idempotencyKey: randomUUID(),
    };
  const send = () => durableTicketCommand('/api/tickets', 'POST', body, actor.headers);
  const first = await send();
  expect(first.status).toBe(201);
  const original = (await first.json()) as DurableTicketIdentity;
  const effects = await durableTicketEffects(original.id);
  const client = await http.pool.connect();
  let response: Promise<Response> | undefined,
    finished = false;
  try {
    await client.query('BEGIN');
    await client.query('SELECT user_id FROM users WHERE user_id=$1 FOR NO KEY UPDATE', [
      actor.userId,
    ]);
    const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
    response = send().finally(() => {
      finished = true;
    });
    await blockedOrFinished(pid, () => finished);
    expect(finished).toBe(false);
    await http.pool.query(
      "UPDATE sessions SET expires_at=clock_timestamp()-INTERVAL '1 second' WHERE session_id=$1",
      [actor.sessionId]
    );
    await client.query('COMMIT');
    const denied = await response;
    expect(denied.status).toBe(401);
    expect(JSON.stringify(await denied.json())).not.toMatch(
      /Private original|Frozen private|fields/
    );
    expect(await durableTicketEffects(original.id)).toEqual(effects);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await response;
  }
});
it.each(['create', 'status', 'assignment'] as const)(
  'rolls back durable %s cache and effects when its audit fails, then retries the same command',
  async (action) => {
    const actor = await freshActor(action !== 'create'),
      id = await ticket('in_progress'),
      key = randomUUID();
    await http.pool.query("UPDATE tickets SET assigned_to='staff' WHERE id=$1", [id]);
    const command =
      action === 'create'
        ? {
            path: '/api/tickets',
            method: 'POST',
            body: { subject: 'Atomic durable', body: 'Details', idempotencyKey: key },
            kind: 'ticket_create',
          }
        : action === 'status'
          ? {
              path: `/api/staff/tickets/${id}/status`,
              method: 'PATCH',
              body: { status: 'resolved', reason: 'Atomic', idempotencyKey: key },
              kind: 'ticket_staff_status',
            }
          : {
              path: `/api/staff/tickets/${id}/assign`,
              method: 'PUT',
              body: { assigneeId: 'assigned', idempotencyKey: key },
              kind: 'ticket_assignment',
            };
    const effects = await durableTicketEffects(id);
    await http.pool
      .query(`CREATE FUNCTION fail_durable_ticket_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.event IN ('ticket_created','ticket_assigned','ticket_status_changed') THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_durable_ticket_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_durable_ticket_audit()`);
    try {
      expect(
        (await durableTicketCommand(command.path, command.method, command.body, actor.headers))
          .status
      ).toBe(500);
      expect(
        (
          await http.pool.query(
            'SELECT response FROM idempotency_keys WHERE entity_type=$1 AND idempotency_key=$2',
            [command.kind, `${actor.userId}:${key}`]
          )
        ).rows
      ).toEqual([]);
      expect(
        (await http.pool.query('SELECT status,assigned_to FROM tickets WHERE id=$1', [id])).rows[0]
      ).toEqual({ status: 'in_progress', assigned_to: 'staff' });
      expect(
        (await http.pool.query('SELECT id FROM tickets WHERE user_id=$1', [actor.userId])).rows
      ).toEqual([]);
      expect(await durableTicketEffects(id)).toEqual(effects);
    } finally {
      await http.pool.query(
        'DROP TRIGGER fail_durable_ticket_audit ON audit_log; DROP FUNCTION fail_durable_ticket_audit()'
      );
    }
    expect(
      (await durableTicketCommand(command.path, command.method, command.body, actor.headers)).status
    ).toBe(action === 'create' ? 201 : 200);
    expect(
      (
        await http.pool.query(
          'SELECT response FROM idempotency_keys WHERE entity_type=$1 AND idempotency_key=$2',
          [command.kind, `${actor.userId}:${key}`]
        )
      ).rows
    ).toHaveLength(1);
  }
);
it('rolls back a keyed assignment and its original receipt when the private notice cannot commit', async () => {
  const id = await ticket(),
    body = { assigneeId: 'assigned', idempotencyKey: randomUUID() };
  const effects = await durableTicketEffects(id);
  await http.pool
    .query(`CREATE FUNCTION fail_durable_ticket_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.link_route LIKE '%tickets?ticketId=%' THEN RAISE EXCEPTION 'test failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_durable_ticket_notice BEFORE INSERT ON in_app_notifications FOR EACH ROW EXECUTE FUNCTION fail_durable_ticket_notice()`);
  try {
    expect(
      (await durableTicketCommand(`/api/staff/tickets/${id}/assign`, 'PUT', body)).status
    ).toBe(500);
    expect(
      (
        await http.pool.query(
          "SELECT response FROM idempotency_keys WHERE entity_type='ticket_assignment' AND idempotency_key=$1",
          [`staff:${body.idempotencyKey}`]
        )
      ).rows
    ).toEqual([]);
    expect(
      (await http.pool.query('SELECT assigned_to,status FROM tickets WHERE id=$1', [id])).rows[0]
    ).toEqual({ assigned_to: null, status: 'open' });
    expect(await durableTicketEffects(id)).toEqual(effects);
  } finally {
    await http.pool.query(
      'DROP TRIGGER fail_durable_ticket_notice ON in_app_notifications; DROP FUNCTION fail_durable_ticket_notice()'
    );
  }
  expect((await durableTicketCommand(`/api/staff/tickets/${id}/assign`, 'PUT', body)).status).toBe(
    200
  );
});
it('projects only owned ticket form leaves after current authority and leaves protected failures generic', async () => {
  const f = await linkedRecordFixture(),
    id = await ticket('in_progress');
  await http.pool.query("UPDATE tickets SET assigned_to='assigned' WHERE id=$1", [id]);
  const cases = [
    {
      path: '/api/tickets',
      method: 'POST',
      actor: f.actor.headers,
      field: 'subject',
      body: { subject: ' ', body: 'Details', profileId: f.profileId },
    },
    {
      path: `/api/tickets/${id}/comments`,
      method: 'POST',
      actor: headers.customer!,
      field: 'body',
      body: { body: ' ' },
    },
    {
      path: `/api/staff/tickets/${id}/status`,
      method: 'PATCH',
      actor: headers.staff!,
      field: 'reason',
      body: { status: 'resolved', reason: ' ' },
    },
  ];
  const effects = await durableTicketEffects(id);
  for (const item of cases) {
    const owned = await durableTicketCommand(item.path, item.method, item.body, item.actor);
    expect(owned.status).toBe(400);
    expect(((await owned.json()) as TicketFormErrorResponse).error.fields).toEqual([item.field]);
    const mixed = await durableTicketCommand(
      item.path,
      item.method,
      { ...item.body, PRIVATE: 'PRIVATE' },
      item.actor
    );
    expect(mixed.status).toBe(400);
    const generic = (await mixed.json()) as TicketFormErrorResponse;
    expect(generic.error.fields).toBeUndefined();
    expect(JSON.stringify(generic)).not.toContain('PRIVATE');
  }
  const foreign = await durableTicketCommand(
    `/api/tickets/${id}/comments`,
    'POST',
    { body: '' },
    f.actor.headers
  );
  expect(foreign.status).toBe(404);
  expect(((await foreign.json()) as TicketFormErrorResponse).error.fields).toBeUndefined();
  await http.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [f.profileId]);
  const stale = await durableTicketCommand(
    '/api/tickets',
    'POST',
    { subject: '', body: 'Details', profileId: f.profileId },
    f.actor.headers
  );
  expect(stale.status).toBe(404);
  expect(((await stale.json()) as TicketFormErrorResponse).error.fields).toBeUndefined();
  const protectedInput = await durableTicketCommand(`/api/staff/tickets/${id}/status`, 'PATCH', {
    status: 'resolved',
    reason: '',
    idempotencyKey: 'PRIVATE',
  });
  expect(protectedInput.status).toBe(400);
  expect(((await protectedInput.json()) as TicketFormErrorResponse).error.fields).toBeUndefined();
  expect(await durableTicketEffects(id)).toEqual(effects);
});

it('persists private canonical reply delivery with both channels, atomic rollback and exact comment replay', async () => {
  const id = await ticket();
  await assign(id, 'assigned');
  const command = {
    body: 'Private solution must stay in conversation',
    visibility: 'public',
    submissionId: randomUUID(),
  };
  const work = () => postReply(id, 'staff', command);
  await expectTicketNoticeRollback(http.pool, id, 'ticket.new_reply', work);
  const response = await work();
  expect(response.status, http.logs()).toBe(201);
  const reply = (await response.json()) as TicketCommentRow;
  await expectTicketDelivery(http.pool, id, 'ticket.new_reply', reply.id, [
    { user: 'customer', context: 'customer' },
    { user: 'assigned', context: 'staff' },
  ]);
  const before = await ticketDeliverySnapshot(http.pool, id);
  expect(JSON.stringify(before)).not.toContain(command.body);
  expect((await work()).status).toBe(201);
  expect(await ticketDeliverySnapshot(http.pool, id)).toEqual(before);
  expect((await comment(id, 'Hidden internal note', 'internal')).status).toBe(201);
  expect(await ticketDeliverySnapshot(http.pool, id)).toEqual(before);
  const customerReply = await postReply(id, 'customer', {
    body: 'Customer reply is also private',
    visibility: 'public',
    submissionId: randomUUID(),
  });
  expect(customerReply.status, http.logs()).toBe(201);
  const customerComment = (await customerReply.json()) as TicketCommentRow;
  const row = (
    await http.pool.query('SELECT * FROM notification_outbox WHERE idempotency_key=$1', [
      `ticket.new_reply:${id}:${customerComment.id}:assigned`,
    ])
  ).rows;
  expect(row).toHaveLength(1);
  expect(row[0].channels).toEqual(['in_app', 'email']);
  expect(
    (
      await http.pool.query(
        'SELECT user_id FROM notification_outbox WHERE idempotency_key LIKE $1',
        [`ticket.new_reply:${id}:${customerComment.id}:%`]
      )
    ).rows
  ).toEqual([{ user_id: 'assigned' }]);
});
it('persists the assigned-only canonical inbox with audit identity and recovers/replays atomic assignment', async () => {
  const id = await ticket(),
    body = { assigneeId: 'assigned', idempotencyKey: randomUUID() };
  const work = () => durableTicketCommand(`/api/staff/tickets/${id}/assign`, 'PUT', body);
  await expectTicketNoticeRollback(http.pool, id, 'ticket.assigned', work);
  expect((await work()).status, http.logs()).toBe(200);
  const audit = (
    await http.pool.query(
      "SELECT id FROM audit_log WHERE event='ticket_assigned' AND metadata::jsonb->>'ticketId'=$1",
      [id]
    )
  ).rows;
  expect(audit).toHaveLength(1);
  await expectTicketDelivery(http.pool, id, 'ticket.assigned', audit[0].id, [
    { user: 'assigned', context: 'staff' },
  ]);
  const before = await ticketDeliverySnapshot(http.pool, id);
  expect((await work()).status).toBe(200);
  expect(await ticketDeliverySnapshot(http.pool, id)).toEqual(before);
  expect(
    (
      await http.pool.query(
        "SELECT type FROM in_app_notifications WHERE recipient_user_id='customer' AND link_route=$1",
        [`/tickets?ticketId=${id}`]
      )
    ).rows
  ).toEqual([{ type: 'general' }]);
});

it('preserves read/content/receipts on a matching private ticket occurrence and rejects scope collisions', async () => {
  const id = await ticket();
  await assign(id, 'assigned');
  const response = await postReply(id, 'staff', {
    body: 'Private answer',
    visibility: 'public',
    submissionId: randomUUID(),
  });
  expect(response.status).toBe(201);
  const row = (
    await http.pool.query(
      "SELECT * FROM notification_outbox WHERE event_key='ticket.new_reply' AND payload->>'ticketNumber'=$1 AND user_id='customer'",
      [id]
    )
  ).rows[0];
  await http.pool.query(
    "UPDATE in_app_notifications SET is_read=true,read_at=NOW() WHERE delivery_key='outbox:'||$1::text",
    [row.id]
  );
  const before = await ticketDeliverySnapshot(http.pool, id);
  const params = {
    userId: 'customer',
    operatingContext: 'customer' as const,
    type: 'general' as const,
    title: 'Replacement is forbidden',
    link: `/tickets?ticketId=${id}`,
    eventKey: 'ticket.new_reply' as const,
    occurrenceKey: row.idempotency_key,
    payload: { ticketNumber: id },
  };
  const client = await http.pool.connect();
  try {
    await client.query('BEGIN');
    expect(await new NotificationsService().createTicketBusinessEvent(params, client)).toBe(false);
    await client.query('COMMIT');
    expect(await ticketDeliverySnapshot(http.pool, id)).toEqual(before);
    await client.query('BEGIN');
    await expect(
      new NotificationsService().createTicketBusinessEvent(
        { ...params, userId: 'staff', operatingContext: 'staff' },
        client
      )
    ).rejects.toThrow('conflicts with saved delivery');
    await client.query('ROLLBACK');
    expect(await ticketDeliverySnapshot(http.pool, id)).toEqual(before);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});
