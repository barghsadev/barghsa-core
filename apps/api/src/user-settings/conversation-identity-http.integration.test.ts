import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
import { activityNames } from '../common/activity-identity.js';
import { runMigrations } from '../../../../packages/db/src/migrate.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>, server: Server;
const objects = new Map<string, Buffer>();
const image = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk1cAAAAASUVORK5CYII=',
  'base64'
);
const path = '/api/user/settings/conversation-identity';
beforeAll(async () => {
  server = createServer(async (req, res) => {
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
    res.setHeader('Content-Type', 'image/png');
    res.end(bytes);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  http = await startHttpFixture(
    process.env.TEST_DATABASE_URL!,
    `http://127.0.0.1:${(server.address() as { port: number }).port}`
  );
}, 40000);
afterAll(async () => {
  await http?.close();
  await new Promise<void>((done) => server?.close(() => done()));
});
beforeEach(async () => {
  await http.pool.query(
    'DELETE FROM rate_limit_counters; DELETE FROM rate_limit_windows WHERE NOT security'
  );
});
async function actor(staff = false) {
  const id = randomUUID(),
    sessionId = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_admin) VALUES ($1,$2,'test-only',$3)",
    [id, `${id}@private.example.test`, staff]
  );
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,operating_context)
    VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',$5)`,
    [sessionId, id, csrf, randomUUID(), staff ? 'staff' : 'customer']
  );
  return {
    id,
    sessionId,
    headers: {
      Cookie: `barghsa_session=${sessionId}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    },
  };
}
type Actor = Awaited<ReturnType<typeof actor>>;
const read = (user: Actor) => fetch(`${http.base}${path}`, { headers: user.headers });
const save = (user: Actor, body: Record<string, unknown>) =>
  fetch(`${http.base}${path}`, {
    method: 'PUT',
    headers: user.headers,
    body: JSON.stringify(body),
  });
async function upload(user: Actor, extra: Record<string, unknown> = {}) {
  const body = {
    fileName: 'portrait.png',
    contentType: 'image/png',
    fileSize: image.length,
    category: 'image',
    purpose: 'conversation_avatar',
    ...extra,
  };
  const issued = await fetch(`${http.base}/api/upload/presigned-url`, {
    method: 'POST',
    headers: user.headers,
    body: JSON.stringify(body),
  });
  if (!issued.ok) return { response: issued, key: '' };
  const value = (await issued.json()) as { key: string; presignedUrl: string };
  expect(
    (
      await fetch(value.presignedUrl, {
        method: 'PUT',
        body: image,
        headers: { 'Content-Type': 'image/png' },
      })
    ).ok
  ).toBe(true);
  const verified = await fetch(`${http.base}/api/upload/${encodeURIComponent(value.key)}/verify`, {
    method: 'POST',
    headers: user.headers,
  });
  expect(verified.status, http.logs()).toBe(200);
  expect(await verified.json()).toMatchObject({ status: 'confirmed' });
  return {
    key: value.key,
    response: await fetch(`${http.base}/api/upload/${encodeURIComponent(value.key)}/record`, {
      method: 'POST',
      headers: user.headers,
      body: JSON.stringify(body),
    }),
  };
}
async function verifiedKey(user: Actor, bytes = image, metadata: Record<string, unknown> = {}) {
  const key = `uploads/image/${randomUUID()}.png`;
  objects.set(key, bytes);
  await http.pool.query(
    `INSERT INTO storage_records(storage_key,status,file_name,content_type,file_size,category,metadata)
    VALUES ($1,'active','portrait.png','image/png',$2,'image',$3::jsonb)`,
    [
      key,
      bytes.length,
      JSON.stringify({
        verified: true,
        purpose: 'conversation_avatar',
        uploadedBy: user.id,
        ...metadata,
      }),
    ]
  );
  return key;
}
for (const staff of [false, true]) {
  it(`supports opted-in names/photos and exact retry without duplicate copies/audits (${staff ? 'staff' : 'customer'})`, async () => {
    const user = await actor(staff);
    expect(await (await read(user)).json()).toEqual({
      displayName: null,
      avatarUrl: null,
      avatarUploadKey: null,
      revision: 0,
      shareInActivity: false,
    });
    const file = await upload(user);
    expect(file.response.status, http.logs()).toBe(200);
    const body = { displayName: '  آرش Example  ', avatarUploadKey: file.key, revision: 0 };
    const response = await save(user, body);
    expect(response.status, http.logs()).toBe(200);
    const saved = (await response.json()) as { avatarUrl: string };
    expect(saved).toMatchObject({
      displayName: 'آرش Example',
      revision: 1,
      avatarUploadKey: file.key,
    });
    const url = new URL(saved.avatarUrl);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    objects.set(file.key, Buffer.from('overwritten source'));
    expect(Buffer.from(await (await fetch(url)).arrayBuffer())).toEqual(image);
    expect((await save(user, body)).status).toBe(200);
    expect(
      (
        await http.pool.query(
          "SELECT * FROM audit_log WHERE user_id=$1 AND event='conversation_identity_changed'",
          [user.id]
        )
      ).rows
    ).toHaveLength(1);
    expect(
      (
        await http.pool.query(
          "SELECT * FROM storage_records WHERE status='immutable' AND metadata->>'uploadedBy'=$1",
          [user.id]
        )
      ).rows
    ).toHaveLength(1);
    const cleared = await save(user, { displayName: null, avatarUploadKey: null, revision: 1 });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({
      displayName: null,
      avatarUrl: null,
      avatarUploadKey: null,
      revision: 2,
      shareInActivity: false,
    });
  });
}
it('requires authentication and CSRF, rejects actor override and rejects disabled/inactive accounts', async () => {
  expect((await fetch(`${http.base}${path}`)).status).toBe(401);
  const user = await actor();
  expect(
    (
      await fetch(`${http.base}${path}`, {
        method: 'PUT',
        headers: { Cookie: user.headers.Cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'Name', revision: 0 }),
      })
    ).status
  ).toBe(403);
  expect(
    (await save(user, { displayName: 'Name', revision: 0, userId: randomUUID() })).status
  ).toBe(400);
  await http.pool.query('UPDATE users SET disabled_at=NOW() WHERE user_id=$1', [user.id]);
  expect((await read(user)).status).toBe(401);
  const inactive = await actor();
  await http.pool.query("UPDATE users SET activation_token='pending' WHERE user_id=$1", [
    inactive.id,
  ]);
  expect((await save(inactive, { displayName: 'Name', revision: 0 })).status).toBe(401);
});
it.each(['', 'x'.repeat(81), 'name\nline', 'name\u202ehidden', 'name\u2066hidden'])(
  'rejects invalid or directional-control names (%j)',
  async (displayName) => {
    expect((await save(await actor(), { displayName, revision: 0 })).status).toBe(400);
  }
);
it('accepts Persian join controls, renders literal markup safely and never invents a login name', async () => {
  const user = await actor();
  const response = await save(user, { displayName: 'نام\u200cنمایشی <script>', revision: 0 });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    displayName: 'نام\u200cنمایشی <script>',
    avatarUrl: null,
  });
});
it('detects conflicting changes, preserves existing photo on name-only edits and allows only one concurrent revision', async () => {
  const user = await actor();
  const key = await verifiedKey(user);
  expect(
    (await save(user, { displayName: 'First', avatarUploadKey: key, revision: 0 })).status
  ).toBe(200);
  const responses = await Promise.all(
    ['Second', 'Third'].map((displayName) => save(user, { displayName, revision: 1 }))
  );
  expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
  expect(await (await read(user)).json()).toMatchObject({ revision: 2, avatarUploadKey: key });
  expect((await save(user, { displayName: 'Stale', revision: 0 })).status).toBe(409);
});
it('rejects cross-user, wrong-purpose, unverified and profile-scoped photo sources', async () => {
  const user = await actor(),
    other = await actor();
  for (const key of [
    await verifiedKey(other),
    await verifiedKey(user, image, { purpose: 'ticket_attachment' }),
    await verifiedKey(user, image, { verified: false }),
    await verifiedKey(user, image, { profileId: randomUUID() }),
  ])
    expect(
      (await save(user, { displayName: 'Name', avatarUploadKey: key, revision: 0 })).status
    ).toBe(400);
  expect(await (await read(user)).json()).toMatchObject({ revision: 0, avatarUrl: null });
});
it('rejects invalid image bytes, size changes and actual files above the 2 MB cap', async () => {
  const user = await actor();
  for (const bytes of [
    Buffer.from('%PDF-1.7 evidence'),
    Buffer.concat([image, Buffer.alloc(2 * 1024 * 1024)]),
  ]) {
    const key = await verifiedKey(user, bytes);
    expect(
      (await save(user, { displayName: 'Name', avatarUploadKey: key, revision: 0 })).status
    ).toBe(400);
  }
  const key = await verifiedKey(user);
  objects.set(key, Buffer.concat([image, Buffer.from('changed')]));
  expect(
    (await save(user, { displayName: 'Name', avatarUploadKey: key, revision: 0 })).status
  ).toBe(400);
});
it('rejects scoped, oversized and non-image presigns in either operating context', async () => {
  for (const staff of [false, true]) {
    const user = await actor(staff);
    for (const extra of [
      { profileId: randomUUID() },
      { ticketId: randomUUID() },
      { fileSize: 2 * 1024 * 1024 + 1 },
      { contentType: 'application/pdf', category: 'document', fileName: 'file.pdf' },
    ])
      expect((await upload(user, extra)).response.status).toBe(400);
  }
});
it('projects only shared author identity after ticket authorization and visibility filtering', async () => {
  const customer = await actor(),
    staff = await actor(true),
    internalAuthor = await actor(true),
    outsider = await actor();
  expect((await save(customer, { displayName: 'Customer alias', revision: 0 })).status).toBe(200);
  const key = await verifiedKey(staff);
  expect(
    (await save(staff, { displayName: 'Public support', avatarUploadKey: key, revision: 0 })).status
  ).toBe(200);
  expect(
    (await save(internalAuthor, { displayName: 'Secret colleague', revision: 0 })).status
  ).toBe(200);
  const id = randomUUID();
  await http.pool.query(
    "INSERT INTO tickets(id,user_id,subject,body) VALUES ($1,$2,'Help','Question')",
    [id, customer.id]
  );
  await http.pool.query(
    `INSERT INTO ticket_comments(ticket_id,author_id,body,visibility,author_context) VALUES
    ($1,$2,'Question','public','customer'),($1,$3,'Answer','public','staff'),($1,$4,'Private','internal','staff')`,
    [id, customer.id, staff.id, internalAuthor.id]
  );
  const result = await fetch(`${http.base}/api/tickets/${id}/comments`, {
    headers: customer.headers,
  });
  expect(result.status).toBe(200);
  const comments = (await result.json()) as { authorId: string; author: unknown }[];
  expect(comments).toHaveLength(2);
  expect(comments.find((comment) => comment.authorId === customer.id)!.author).toEqual({
    displayName: 'Customer alias',
    avatarUrl: null,
  });
  expect(comments.find((comment) => comment.authorId === staff.id)!.author).toEqual({
    displayName: 'Public support',
    avatarUrl: expect.stringContaining('conversation-avatars'),
  });
  expect(JSON.stringify(comments)).not.toMatch(
    /Secret colleague|private.example.test|sourceKey|avatarUploadKey/
  );
  expect(
    (await fetch(`${http.base}/api/tickets/${id}/comments`, { headers: outsider.headers })).status
  ).toBe(404);
  const staffRead = await fetch(`${http.base}/api/staff/tickets/${id}/comments`, {
    headers: staff.headers,
  });
  expect(staffRead.status).toBe(200);
  expect(JSON.stringify(await staffRead.json())).toContain('Secret colleague');
  await http.pool.query('UPDATE users SET disabled_at=NOW() WHERE user_id=$1', [staff.id]);
  const after = await (
    await fetch(`${http.base}/api/tickets/${id}/comments`, { headers: customer.headers })
  ).json();
  expect(
    (after as { authorId: string; author: unknown }[]).find(
      (comment) => comment.authorId === staff.id
    )!.author
  ).toBeNull();
});
it('revalidates the live session after an account lock wait and leaves no write after revocation', async () => {
  const user = await actor(),
    lock = await http.pool.connect();
  try {
    await lock.query('BEGIN');
    await lock.query('SELECT user_id FROM users WHERE user_id=$1 FOR UPDATE', [user.id]);
    const pending = save(user, { displayName: 'Late edit', revision: 0 });
    await http.pool.query('SELECT pg_sleep(0.15)');
    await http.pool.query('UPDATE sessions SET revoked_at=NOW() WHERE session_id=$1', [
      user.sessionId,
    ]);
    await lock.query('COMMIT');
    expect((await pending).status).toBe(401);
    expect(
      (await http.pool.query('SELECT * FROM conversation_identities WHERE user_id=$1', [user.id]))
        .rows
    ).toEqual([]);
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
  }
});
it('rolls back identity and immutable copy when the audit write fails, preserving cleanup intent', async () => {
  const user = await actor(),
    key = await verifiedKey(user);
  await http.pool
    .query(`CREATE FUNCTION reject_identity_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.event='conversation_identity_changed' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_identity_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_identity_audit();`);
  try {
    expect(
      (await save(user, { displayName: 'Rollback', avatarUploadKey: key, revision: 0 })).status
    ).toBe(500);
    expect(
      (await http.pool.query('SELECT * FROM conversation_identities WHERE user_id=$1', [user.id]))
        .rows
    ).toEqual([]);
    const copies = (
      await http.pool.query(
        "SELECT status,metadata FROM storage_records WHERE metadata->>'sourceKey'=$1",
        [key]
      )
    ).rows;
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({
      status: 'removed',
      metadata: { provisionalCopy: true, deletionRequested: true },
    });
  } finally {
    await http.pool.query(
      'DROP TRIGGER reject_identity_audit ON audit_log; DROP FUNCTION reject_identity_audit()'
    );
  }
});
it('reruns the production migration journal without duplicating identity tables or altering users', async () => {
  const user = await actor();
  const before = (await http.pool.query('SELECT * FROM users WHERE user_id=$1', [user.id])).rows;
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = `/${(await http.pool.query('SELECT current_database() AS name')).rows[0].name}`;
  const migration = await runMigrations({ connection: { pgdirectUrl: url.toString() } });
  expect(migration.ok).toBe(true);
  expect((await http.pool.query('SELECT * FROM users WHERE user_id=$1', [user.id])).rows).toEqual(
    before
  );
  expect(await (await read(user)).json()).toMatchObject({ revision: 0, displayName: null });
});

it('clears the stored photo reference even when a removed storage record no longer exposes a source key', async () => {
  const user = await actor(),
    key = await verifiedKey(user);
  expect(
    (await save(user, { displayName: 'Alias', avatarUploadKey: key, revision: 0 })).status
  ).toBe(200);
  await http.pool.query(
    "UPDATE storage_records SET status='removed' WHERE metadata->>'sourceKey'=$1",
    [key]
  );
  expect(await (await read(user)).json()).toMatchObject({
    avatarUrl: null,
    avatarUploadKey: null,
    revision: 1,
  });
  const result = await save(user, { displayName: 'Alias', avatarUploadKey: null, revision: 1 });
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({
    avatarUrl: null,
    avatarUploadKey: null,
    revision: 2,
  });
  expect(
    (
      await http.pool.query('SELECT avatar_key FROM conversation_identities WHERE user_id=$1', [
        user.id,
      ])
    ).rows[0]
  ).toEqual({ avatar_key: null });
});

for (const staff of [false, true]) {
  it(`keeps activity names separately opted in, revision-bound and revocable (${staff ? 'staff' : 'customer'})`, async () => {
    const user = await actor(staff),
      other = await actor();
    const support = await save(user, { displayName: 'Support only', revision: 0 });
    expect(await support.json()).toMatchObject({ revision: 1, shareInActivity: false });
    expect(await activityNames(http.pool, [user.id, null, user.id])).toEqual(new Map());
    expect(
      (await save(user, { displayName: 'Support only', shareInActivity: 'true', revision: 1 }))
        .status
    ).toBe(400);
    const opted = { displayName: 'Chosen <name> نام', shareInActivity: true, revision: 1 };
    expect((await save(user, opted)).status).toBe(200);
    expect((await save(user, opted)).status).toBe(200);
    expect((await save(user, { ...opted, shareInActivity: false })).status).toBe(409);
    expect(
      (
        await http.pool.query(
          "SELECT id FROM audit_log WHERE user_id=$1 AND event='conversation_identity_changed'",
          [user.id]
        )
      ).rows
    ).toHaveLength(2);
    expect(
      (await save(other, { displayName: 'Other opted name', shareInActivity: true, revision: 0 }))
        .status
    ).toBe(200);
    expect(await activityNames(http.pool, [user.id, null, user.id])).toEqual(
      new Map([[user.id, opted.displayName]])
    );
    // Older clients editing a support name must not silently change the separate consent.
    const renamed = await save(user, { displayName: 'Renamed', revision: 2 });
    expect(await renamed.json()).toMatchObject({ revision: 3, shareInActivity: true });
    expect(await activityNames(http.pool, [user.id])).toEqual(new Map([[user.id, 'Renamed']]));
    expect(
      (await save(user, { displayName: 'Renamed', shareInActivity: false, revision: 3 })).status
    ).toBe(200);
    expect(await activityNames(http.pool, [user.id])).toEqual(new Map());
    expect(
      (await save(user, { displayName: 'Renamed', shareInActivity: true, revision: 4 })).status
    ).toBe(200);
    expect(await (await save(user, { displayName: null, revision: 5 })).json()).toMatchObject({
      displayName: null,
      shareInActivity: false,
      revision: 6,
    });
    expect(await activityNames(http.pool, [user.id])).toEqual(new Map());
    await http.pool.query('UPDATE users SET disabled_at=NOW() WHERE user_id=$1', [other.id]);
    expect(await activityNames(http.pool, [other.id])).toEqual(new Map());
    await http.pool.query(
      "UPDATE users SET disabled_at=NULL,activation_token='pending' WHERE user_id=$1",
      [other.id]
    );
    expect(await activityNames(http.pool, [other.id])).toEqual(new Map());
  });
}
