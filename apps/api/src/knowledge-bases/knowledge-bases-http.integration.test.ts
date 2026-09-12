import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
let headers: Record<string, string>;
let ids: { kb: string; group: string };
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    "INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ('kb-editor','KB editor','Test role','[\"admin:ai:kb\"]')"
  );
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ('kb-admin','kb-admin@example.test','test-only',true)"
  );
  await http.pool.query("INSERT INTO user_roles(user_id,role_id) VALUES ('kb-admin','kb-editor')");
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at) VALUES ($1,'kb-admin',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '1 hour',NOW())",
    [session, csrf, randomUUID()]
  );
  headers = {
    cookie: `barghsa_session=${session}`,
    'x-csrf-token': csrf,
    'content-type': 'application/json',
  };
}, 30000);
afterAll(async () => {
  await http?.close();
});
beforeEach(async () => {
  await http.pool.query(
    "DELETE FROM knowledge_bases; DELETE FROM kb_groups; DELETE FROM storage_records WHERE storage_key LIKE 'kb-test/%'; DELETE FROM audit_log WHERE event LIKE 'kb_%'"
  );
  ids = {
    kb: (
      await http.pool.query(
        "INSERT INTO knowledge_bases(title,description,created_by) VALUES ('Original KB','original','kb-admin') RETURNING id"
      )
    ).rows[0].id,
    group: (
      await http.pool.query(
        "INSERT INTO kb_groups(title,description,created_by) VALUES ('Original group','original','kb-admin') RETURNING id"
      )
    ).rows[0].id,
  };
  await http.pool.query('INSERT INTO kb_group_members(group_id,kb_id) VALUES ($1,$2)', [
    ids.group,
    ids.kb,
  ]);
});
const entities = [
  { kind: 'kb', table: 'knowledge_bases', path: 'knowledge-bases', title: 'Original KB' },
  { kind: 'group', table: 'kb_groups', path: 'kb-groups', title: 'Original group' },
] as const;
const cases = entities.flatMap((entity) =>
  (['create', 'update', 'delete'] as const).map((action) => ({ ...entity, action }))
);
function request(entry: (typeof cases)[number]) {
  return fetch(
    `${http.base}/api/admin/${entry.path}${entry.action === 'create' ? '' : `/${ids[entry.kind]}`}`,
    {
      method: { create: 'POST', update: 'PUT', delete: 'DELETE' }[entry.action],
      headers,
      ...(entry.action === 'delete'
        ? {}
        : { body: JSON.stringify({ title: 'Changed', description: 'changed' }) }),
    }
  );
}
it.each(cases)('rolls back $kind $action and cascades when the audit fails', async (entry) => {
  await http.pool.query(
    "CREATE OR REPLACE FUNCTION reject_kb_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test KB audit failure'; END $$; CREATE TRIGGER reject_kb_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.event LIKE 'kb_%') EXECUTE FUNCTION reject_kb_audit()"
  );
  try {
    expect((await request(entry)).status).toBe(500);
    expect((await http.pool.query(`SELECT id,title,description FROM ${entry.table}`)).rows).toEqual(
      [{ id: ids[entry.kind], title: entry.title, description: 'original' }]
    );
    expect((await http.pool.query('SELECT group_id,kb_id FROM kb_group_members')).rows).toEqual([
      { group_id: ids.group, kb_id: ids.kb },
    ]);
  } finally {
    await http.pool.query('DROP TRIGGER reject_kb_audit ON audit_log');
  }
});
it.each(cases)('rechecks current authority for $kind $action', async (entry) => {
  const client = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query("SELECT user_id FROM users WHERE user_id='kb-admin' FOR UPDATE");
    pending = request(entry);
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
    await client.query("DELETE FROM user_roles WHERE user_id='kb-admin'");
    await client.query('COMMIT');
    expect((await pending).status).toBe(403);
    expect((await http.pool.query(`SELECT id,title FROM ${entry.table}`)).rows).toEqual([
      { id: ids[entry.kind], title: entry.title },
    ]);
    expect(
      (await http.pool.query("SELECT id FROM audit_log WHERE event LIKE 'kb_%'")).rows
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
      "INSERT INTO user_roles(user_id,role_id) VALUES ('kb-admin','kb-editor') ON CONFLICT DO NOTHING"
    );
  }
});
it.each(entities)(
  'persists $kind edits, counts memberships and deletes only its links',
  async (entry) => {
    expect((await request({ ...entry, action: 'create' })).status).toBe(201);
    const response = await request({ ...entry, action: 'update' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      title: 'Changed',
      description: 'changed',
      ...(entry.kind === 'kb' ? { documentCount: 0, groupCount: 1 } : { memberCount: 1 }),
    });
    expect((await request({ ...entry, action: 'delete' })).status).toBe(204);
    expect((await http.pool.query('SELECT * FROM kb_group_members')).rows).toHaveLength(0);
    expect(
      (
        await http.pool.query(
          `SELECT id FROM ${entry.kind === 'kb' ? 'kb_groups' : 'knowledge_bases'}`
        )
      ).rows
    ).toHaveLength(1);
    expect(
      (await http.pool.query("SELECT id FROM audit_log WHERE event LIKE 'kb_%'")).rows
    ).toHaveLength(3);
  }
);

type LinkAction = 'attach' | 'detach' | 'add' | 'remove';
async function prepareLink(action: LinkAction) {
  const key = `kb-test/${randomUUID()}`;
  await http.pool.query(
    "INSERT INTO storage_records(storage_key,file_name,content_type,file_size,status,metadata) VALUES ($1,'Test.pdf','application/pdf',1024,'active','{\"uploadedBy\":\"kb-admin\"}')",
    [key]
  );
  let documentId = randomUUID();
  if (action === 'detach')
    documentId = (
      await http.pool.query(
        "INSERT INTO kb_documents(kb_id,storage_key,file_name,created_by) VALUES ($1,$2,'Test.pdf','kb-admin') RETURNING id",
        [ids.kb, key]
      )
    ).rows[0].id;
  if (action === 'add') await http.pool.query('DELETE FROM kb_group_members');
  return { key, documentId };
}
function linkRequest(action: LinkAction, item: { key: string; documentId: string }) {
  const path =
    action === 'attach'
      ? `knowledge-bases/${ids.kb}/documents`
      : action === 'detach'
        ? `knowledge-bases/${ids.kb}/documents/${item.documentId}`
        : action === 'add'
          ? `kb-groups/${ids.group}/members`
          : `kb-groups/${ids.group}/members/${ids.kb}`;
  return fetch(`${http.base}/api/admin/${path}`, {
    method: action === 'attach' || action === 'add' ? 'POST' : 'DELETE',
    headers,
    ...(action === 'attach'
      ? { body: JSON.stringify({ storageKey: item.key }) }
      : action === 'add'
        ? { body: JSON.stringify({ kbId: ids.kb }) }
        : {}),
  });
}
async function assertLinkUnchanged(action: LinkAction) {
  expect((await http.pool.query('SELECT id FROM kb_documents')).rows).toHaveLength(
    action === 'detach' ? 1 : 0
  );
  expect((await http.pool.query('SELECT group_id FROM kb_group_members')).rows).toHaveLength(
    action === 'add' ? 0 : 1
  );
  expect(
    (await http.pool.query("SELECT id FROM audit_log WHERE event LIKE 'kb_%'")).rows
  ).toHaveLength(0);
}
it.each(['attach', 'detach', 'add', 'remove'] as const)(
  'rolls back %s when auditing fails',
  async (action) => {
    const item = await prepareLink(action);
    await http.pool.query(
      "CREATE OR REPLACE FUNCTION reject_kb_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test KB audit failure'; END $$; CREATE TRIGGER reject_kb_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.event LIKE 'kb_%') EXECUTE FUNCTION reject_kb_audit()"
    );
    try {
      expect((await linkRequest(action, item)).status).toBe(500);
      await assertLinkUnchanged(action);
    } finally {
      await http.pool.query('DROP TRIGGER reject_kb_audit ON audit_log');
    }
  }
);
it.each(['attach', 'detach', 'add', 'remove'] as const)(
  'rechecks current authority for %s',
  async (action) => {
    const item = await prepareLink(action),
      client = await http.pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await client.query('BEGIN');
      await client.query("SELECT user_id FROM users WHERE user_id='kb-admin' FOR UPDATE");
      pending = linkRequest(action, item);
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
      await client.query("DELETE FROM user_roles WHERE user_id='kb-admin'");
      await client.query('COMMIT');
      expect((await pending).status).toBe(403);
      await assertLinkUnchanged(action);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pending;
      await http.pool.query(
        "INSERT INTO user_roles(user_id,role_id) VALUES ('kb-admin','kb-editor') ON CONFLICT DO NOTHING"
      );
    }
  }
);
it.each(['attach', 'detach', 'add', 'remove'] as const)(
  'persists %s and retains the stored file',
  async (action) => {
    const item = await prepareLink(action);
    expect((await linkRequest(action, item)).status).toBe(action === 'attach' ? 200 : 204);
    expect((await http.pool.query('SELECT id FROM kb_documents')).rows).toHaveLength(
      action === 'attach' ? 1 : 0
    );
    expect((await http.pool.query('SELECT group_id FROM kb_group_members')).rows).toHaveLength(
      action === 'remove' ? 0 : 1
    );
    expect(
      (await http.pool.query('SELECT status FROM storage_records WHERE storage_key=$1', [item.key]))
        .rows
    ).toEqual([{ status: 'active' }]);
    expect(
      (await http.pool.query("SELECT id FROM audit_log WHERE event LIKE 'kb_%'")).rows
    ).toHaveLength(1);
  }
);
it("requires storage administration for another user's document", async () => {
  const item = await prepareLink('attach');
  await http.pool.query(
    'UPDATE storage_records SET metadata=\'{"uploadedBy":"other-user"}\' WHERE storage_key=$1',
    [item.key]
  );
  expect((await linkRequest('attach', item)).status).toBe(403);
  await assertLinkUnchanged('attach');
  try {
    await http.pool.query(
      'UPDATE staff_roles SET permissions=\'["admin:ai:kb","admin:storage:edit"]\' WHERE role_id=\'kb-editor\''
    );
    expect((await linkRequest('attach', item)).status).toBe(200);
  } finally {
    await http.pool.query(
      "UPDATE staff_roles SET permissions='[\"admin:ai:kb\"]' WHERE role_id='kb-editor'"
    );
  }
});
it('rejects storage removal committed while attachment waits for its lock', async () => {
  const item = await prepareLink('attach'),
    client = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query("UPDATE storage_records SET status='removed' WHERE storage_key=$1", [
      item.key,
    ]);
    pending = linkRequest('attach', item);
    await expect
      .poll(async () =>
        Number(
          (
            await http.pool.query(
              "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM storage_records%FOR SHARE%' "
            )
          ).rows[0].count
        )
      )
      .toBe(1);
    await client.query('COMMIT');
    expect((await pending).status).toBe(409);
    await assertLinkUnchanged('attach');
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pending;
  }
});
it.each(['provisionalUpload', 'deletionRequested'])(
  'rejects an active record carrying %s',
  async (flag) => {
    const item = await prepareLink('attach');
    await http.pool.query(
      'UPDATE storage_records SET metadata=metadata||jsonb_build_object($2::text,true) WHERE storage_key=$1',
      [item.key, flag]
    );
    expect((await linkRequest('attach', item)).status).toBe(409);
    await assertLinkUnchanged('attach');
  }
);
it.each(['attach', 'add'] as const)(
  'repeating %s writes one link and one audit',
  async (action) => {
    const item = await prepareLink(action);
    expect((await linkRequest(action, item)).status).toBe(action === 'attach' ? 200 : 204);
    expect((await linkRequest(action, item)).status).toBe(action === 'attach' ? 200 : 204);
    expect(
      (await http.pool.query("SELECT id FROM audit_log WHERE event LIKE 'kb_%'")).rows
    ).toHaveLength(1);
  }
);

const malformedRoutes = [
  ['GET', 'knowledge-bases/invalid'],
  ['PUT', 'knowledge-bases/invalid'],
  ['DELETE', 'knowledge-bases/invalid'],
  ['POST', 'knowledge-bases/invalid/documents'],
  ['DELETE', 'knowledge-bases/invalid/documents/invalid'],
  ['GET', 'kb-groups/invalid'],
  ['PUT', 'kb-groups/invalid'],
  ['DELETE', 'kb-groups/invalid'],
  ['POST', 'kb-groups/invalid/members'],
  ['DELETE', 'kb-groups/invalid/members/invalid'],
] as const;
it.each(malformedRoutes)('rejects malformed IDs on %s %s', async (method, path) => {
  expect((await fetch(`${http.base}/api/admin/${path}`, { method, headers })).status).toBe(400);
});
it('validates nested document and member IDs', async () => {
  for (const path of [
    `knowledge-bases/${ids.kb}/documents/invalid`,
    `kb-groups/${ids.group}/members/invalid`,
  ]) {
    expect(
      (await fetch(`${http.base}/api/admin/${path}`, { method: 'DELETE', headers })).status
    ).toBe(400);
  }
});
it.each(entities)(
  'rejects invalid $kind metadata without writes and trims valid titles',
  async (entry) => {
    for (const method of ['POST', 'PUT']) {
      for (const body of [
        { title: '   ' },
        { title: 'Valid', unexpected: true },
        { title: 'x'.repeat(121) },
        { description: 'x'.repeat(2001) },
      ]) {
        expect(
          (
            await fetch(
              `${http.base}/api/admin/${entry.path}${method === 'PUT' ? `/${ids[entry.kind]}` : ''}`,
              { method, headers, body: JSON.stringify(body) }
            )
          ).status
        ).toBe(400);
      }
    }
    expect((await http.pool.query(`SELECT title FROM ${entry.table}`)).rows).toEqual([
      { title: entry.title },
    ]);
    expect(
      (await http.pool.query("SELECT id FROM audit_log WHERE event LIKE 'kb_%'")).rows
    ).toHaveLength(0);
    const response = await fetch(`${http.base}/api/admin/${entry.path}/${ids[entry.kind]}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ title: '  Trimmed title  ' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ title: 'Trimmed title' });
  }
);
it('rejects malformed link payloads without writing links or audit entries', async () => {
  for (const body of [{ kbId: 'invalid' }, { kbId: ids.kb, unexpected: true }]) {
    expect(
      (
        await fetch(`${http.base}/api/admin/kb-groups/${ids.group}/members`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        })
      ).status
    ).toBe(400);
  }
  for (const body of [{ storageKey: '   ' }, { storageKey: 'key', unexpected: true }]) {
    expect(
      (
        await fetch(`${http.base}/api/admin/knowledge-bases/${ids.kb}/documents`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        })
      ).status
    ).toBe(400);
  }
  expect((await http.pool.query('SELECT id FROM kb_documents')).rows).toHaveLength(0);
  expect(
    (await http.pool.query("SELECT id FROM audit_log WHERE event LIKE 'kb_%'")).rows
  ).toHaveLength(0);
});

it('lists only completed owned documents and filters by file name', async () => {
  const base = await prepareLink('attach');
  await http.pool.query(
    "UPDATE storage_records SET file_name='Meter guide.pdf' WHERE storage_key=$1",
    [base.key]
  );
  for (const [suffix, status, metadata] of [
    ['foreign', 'active', { uploadedBy: 'other' }],
    ['pending', 'active', { uploadedBy: 'kb-admin', provisionalUpload: true }],
    ['deleting', 'active', { uploadedBy: 'kb-admin', deletionRequested: 'true' }],
    ['removed', 'removed', { uploadedBy: 'kb-admin' }],
  ] as const) {
    await http.pool.query(
      'INSERT INTO storage_records(storage_key,status,file_name,metadata) VALUES ($1,$2,$3,$4)',
      [`kb-test/${suffix}`, status, 'Meter guide.pdf', JSON.stringify(metadata)]
    );
  }
  const response = await fetch(
    `${http.base}/api/admin/knowledge-bases/documents/available?search=Meter`,
    { headers }
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual([
    expect.objectContaining({ storageKey: base.key, fileName: 'Meter guide.pdf' }),
  ]);
  expect(
    await (
      await fetch(`${http.base}/api/admin/knowledge-bases/documents/available?search=unmatched`, {
        headers,
      })
    ).json()
  ).toEqual([]);
  expect(
    (
      await fetch(
        `${http.base}/api/admin/knowledge-bases/documents/available?search=${'x'.repeat(201)}`,
        { headers }
      )
    ).status
  ).toBe(400);
});

// Change session proof after the write, before COMMIT, to exercise rollback.
async function invalidateSessionDuringAudit(change: string, run: () => Promise<void>) {
  await http.pool.query(`
    CREATE OR REPLACE FUNCTION invalidate_knowledge_bases_session() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN UPDATE sessions SET ${change} WHERE user_id='kb-admin'; RETURN NEW; END $$;
    CREATE TRIGGER invalidate_session BEFORE INSERT ON audit_log FOR EACH ROW
    WHEN (NEW.event LIKE 'kb_%') EXECUTE FUNCTION invalidate_knowledge_bases_session()`);
  try {
    await run();
  } finally {
    await http.pool.query('DROP TRIGGER invalidate_session ON audit_log');
    await http.pool.query(
      "UPDATE sessions SET expires_at=NOW()+INTERVAL '1 day', idle_deadline=NOW()+INTERVAL '1 hour', step_up_verified_at=NOW(), revoked_at=NULL, csrf_token=$1 WHERE user_id='kb-admin'",
      [headers['x-csrf-token']]
    );
  }
}

it.each(cases)('rolls back $kind $action when the session expires before commit', async (entry) => {
  await invalidateSessionDuringAudit(
    "expires_at=clock_timestamp()-INTERVAL '1 second'",
    async () => {
      expect((await request(entry)).status).toBe(401);
      expect((await http.pool.query(`SELECT id,title FROM ${entry.table}`)).rows).toEqual([
        { id: ids[entry.kind], title: entry.title },
      ]);
      expect((await http.pool.query('SELECT group_id,kb_id FROM kb_group_members')).rows).toEqual([
        { group_id: ids.group, kb_id: ids.kb },
      ]);
      expect(
        (await http.pool.query("SELECT id FROM audit_log WHERE event LIKE 'kb_%'")).rows
      ).toHaveLength(0);
    }
  );
});
it.each(['attach', 'detach', 'add', 'remove'] as const)(
  'rolls back %s when the session expires before commit',
  async (action) => {
    const item = await prepareLink(action);
    await invalidateSessionDuringAudit(
      "expires_at=clock_timestamp()-INTERVAL '1 second'",
      async () => {
        expect((await linkRequest(action, item)).status).toBe(401);
        await assertLinkUnchanged(action);
      }
    );
  }
);
it.each([
  ["csrf_token='rotated-proof'", 403],
  ['step_up_verified_at=NULL', 403],
  ['revoked_at=clock_timestamp()', 401],
] as const)(
  'rejects changed session proof %s before committing a KB update',
  async (change, status) => {
    await invalidateSessionDuringAudit(change, async () => {
      expect(
        (await request(cases.find((entry) => entry.kind === 'kb' && entry.action === 'update')!))
          .status
      ).toBe(status);
      expect((await http.pool.query('SELECT title FROM knowledge_bases')).rows).toEqual([
        { title: 'Original KB' },
      ]);
      expect(
        (await http.pool.query("SELECT id FROM audit_log WHERE event LIKE 'kb_%'")).rows
      ).toHaveLength(0);
    });
  }
);

it('records current step-up proof on the mutation audit', async () => {
  const verifiedAt = new Date(Date.now() - 60_000);
  await http.pool.query("UPDATE sessions SET step_up_verified_at=$1 WHERE user_id='kb-admin'", [
    verifiedAt,
  ]);
  expect((await request(cases[0]!)).ok).toBe(true);
  const rows = (
    await http.pool.query(
      "SELECT metadata::jsonb AS metadata FROM audit_log WHERE event LIKE 'kb_%'"
    )
  ).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0].metadata).toMatchObject({
    stepUpVerified: true,
    stepUpVerifiedAt: verifiedAt.toISOString(),
  });
});
