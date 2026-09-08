import { createServer, type Server } from 'node:http';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
let storageServer: Server;
const objects = new Map<string, Buffer>();
const headers: Record<string, Record<string, string>> = {};
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
      res.setHeader('ETag', '"test-etag"');
      res.end();
      return;
    }
    const bytes = objects.get(key);
    if (!bytes) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', bytes.length);
    res.end(bytes);
  });
  await new Promise<void>((resolve) => storageServer.listen(0, '127.0.0.1', resolve));
  const port = (storageServer.address() as { port: number }).port;
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!, `http://127.0.0.1:${port}`);
  for (const user of ['creator', 'reviewer']) {
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash,is_admin) VALUES ($1,$2,'test-only',true)",
      [user, `${user}@example.test`]
    );
    const id = randomUUID(),
      csrf = randomUUID();
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
      VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
      [id, user, csrf, randomUUID()]
    );
    headers[user] = {
      Cookie: `barghsa_session=${id}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    };
  }
}, 40000);
afterAll(async () => {
  await http?.close();
  await new Promise<void>((resolve) => storageServer?.close(() => resolve()));
});
async function profile() {
  const id = randomUUID();
  await http.pool.query(
    "INSERT INTO profiles(id,user_id,profile_type,status,first_name) VALUES ($1,'creator','INDIVIDUAL','VERIFIED','Original')",
    [id]
  );
  return id;
}
async function create(id: string, extra: Record<string, unknown> = {}) {
  const key = `uploads/document/${randomUUID()}.pdf`,
    bytes = Buffer.from('%PDF-1.7\nOriginal evidence\n%%EOF');
  objects.set(key, bytes);
  await http.pool.query(
    `INSERT INTO storage_records(storage_key,status,metadata,file_size,content_type,category,file_name)
    VALUES ($1,'active',$2::jsonb,$3,'application/pdf','document','evidence.pdf')`,
    [
      key,
      JSON.stringify({
        verified: true,
        uploadedBy: 'creator',
        profileId: id,
        purpose: 'verification_evidence',
      }),
      bytes.length,
    ]
  );
  return fetch(`${http.base}/api/crm/profiles/${id}/verification-cases`, {
    method: 'POST',
    headers: headers.creator!,
    body: JSON.stringify({
      fieldName: 'first_name',
      currentValue: 'Forged old value',
      requestedValue: 'Corrected',
      reason: 'Document checked',
      evidenceUrls: [key],
      ...extra,
    }),
  });
}
async function review(id: string, decision: string, user = 'reviewer') {
  return fetch(`${http.base}/api/crm/verification-cases/${id}/status`, {
    method: 'PUT',
    headers: headers[user]!,
    body: JSON.stringify({ decision, reviewerNotes: 'Evidence checked' }),
  });
}

for (const action of ['create', 'approve'] as const) {
  it(`rejects identity ${action} after the actor loses permission during a profile lock wait`, async () => {
    const target = await profile();
    const actor = action === 'create' ? 'creator' : 'reviewer';
    let caseId: string | undefined;
    if (action === 'approve') {
      const created = await create(target);
      expect(created.status).toBe(201);
      caseId = ((await created.json()) as { id: string }).id;
      expect((await review(caseId, 'Under Review')).status).toBe(200);
    }
    const before = (
      await http.pool.query(
        "SELECT COUNT(*)::int AS count FROM audit_log WHERE metadata::jsonb->>'profileId'=$1",
        [target]
      )
    ).rows[0].count;
    const blocker = await http.pool.connect();
    let request: Promise<Response> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [target]);
      const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      request = action === 'create' ? create(target) : review(caseId!, 'Approved');
      await expect
        .poll(
          async () =>
            (
              await http.pool.query(
                'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1::integer=ANY(pg_blocking_pids(pid))) AS waiting',
                [pid]
              )
            ).rows[0].waiting
        )
        .toBe(true);
      await http.pool.query('UPDATE users SET is_admin=false WHERE user_id=$1', [actor]);
      await blocker.query('ROLLBACK');
      expect((await request).status).toBe(403);
      expect(
        (await http.pool.query('SELECT first_name FROM profiles WHERE id=$1', [target])).rows[0]
          .first_name
      ).toBe('Original');
      const cases = await http.pool.query(
        'SELECT status FROM verification_cases WHERE profile_id=$1',
        [target]
      );
      expect(cases.rows).toEqual(action === 'create' ? [] : [{ status: 'Under Review' }]);
      expect(
        (
          await http.pool.query(
            "SELECT COUNT(*)::int AS count FROM audit_log WHERE metadata::jsonb->>'profileId'=$1",
            [target]
          )
        ).rows[0].count
      ).toBe(before);
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await request?.catch(() => undefined);
      await http.pool.query('UPDATE users SET is_admin=true WHERE user_id=$1', [actor]);
    }
  });
}
it('serializes creation, records the actual original value and prevents creator review', async () => {
  const target = await profile();
  const results = await Promise.all(Array.from({ length: 5 }, () => create(target)));
  expect(results.map((response) => response.status).sort(), http.logs()).toEqual([
    201, 409, 409, 409, 409,
  ]);
  const row = (
    await http.pool.query('SELECT * FROM verification_cases WHERE profile_id=$1', [target])
  ).rows[0];
  expect(row.current_value).toBe('Original');
  expect((await review(row.id, 'Under Review', 'creator')).status).toBe(403);
  expect((await review(row.id, 'Under Review')).status).toBe(200);
  expect((await create(target)).status).toBe(409);
  const decisions = await Promise.all(Array.from({ length: 5 }, () => review(row.id, 'Approved')));
  expect(decisions.map((response) => response.status).sort()).toEqual([200, 409, 409, 409, 409]);
  expect(
    (await http.pool.query('SELECT first_name FROM profiles WHERE id=$1', [target])).rows[0]
      .first_name
  ).toBe('Corrected');
  expect(
    (
      await http.pool.query(
        "SELECT id FROM audit_log WHERE event='verification_case_reviewed' AND metadata::jsonb->>'caseId'=$1 AND metadata::jsonb->>'decision'='Approved'",
        [row.id]
      )
    ).rows
  ).toHaveLength(1);
});
it('rejects stale evidence, archived targets, invalid fields and malformed payloads', async () => {
  const target = await profile();
  expect((await create(target, { fieldName: 'email' })).status).toBe(400);
  expect(
    (await create(target, { fieldName: 'national_id', requestedValue: '0000000000' })).status
  ).toBe(400);
  expect((await create(target, { requestedValue: { bad: true } })).status).toBe(400);
  const created = await create(target),
    data = (await created.json()) as { id: string };
  expect(created.status).toBe(201);
  expect((await review(data.id, 'Under Review')).status).toBe(200);
  await http.pool.query("UPDATE profiles SET first_name='Changed after request' WHERE id=$1", [
    target,
  ]);
  expect((await review(data.id, 'Approved')).status).toBe(409);
  await http.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [target]);
  expect((await review(data.id, 'Approved')).status).toBe(409);
  expect((await create(target)).status).toBe(404);
});
it('rolls back the identity change when its review audit fails', async () => {
  const target = await profile(),
    created = await create(target),
    data = (await created.json()) as { id: string };
  expect((await review(data.id, 'Under Review')).status).toBe(200);
  await http.pool
    .query(`CREATE FUNCTION fail_correction_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.event='verification_case_reviewed' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_correction_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_correction_audit()`);
  try {
    expect((await review(data.id, 'Approved')).status).toBe(500);
    expect(
      (await http.pool.query('SELECT first_name FROM profiles WHERE id=$1', [target])).rows[0]
        .first_name
    ).toBe('Original');
    expect(
      (await http.pool.query('SELECT status FROM verification_cases WHERE id=$1', [data.id]))
        .rows[0].status
    ).toBe('Under Review');
  } finally {
    await http.pool.query(
      'DROP TRIGGER fail_correction_audit ON audit_log; DROP FUNCTION fail_correction_audit()'
    );
  }
  expect((await review(data.id, 'Approved')).status).toBe(200);
});
it('requires step-up for creation and review', async () => {
  const target = await profile(),
    created = await create(target),
    data = (await created.json()) as { id: string };
  await http.pool.query('UPDATE sessions SET step_up_verified_at=NULL');
  try {
    expect((await create(target)).status).toBe(403);
    expect((await review(data.id, 'Under Review')).status).toBe(403);
  } finally {
    await http.pool.query('UPDATE sessions SET step_up_verified_at=NOW()');
  }
});
it('seals evidence bytes and returns authorized short-lived downloads for the fixed copy', async () => {
  const target = await profile(),
    response = await create(target);
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  const row = (
    await http.pool.query('SELECT evidence_urls FROM verification_cases WHERE id=$1', [id])
  ).rows[0];
  const keys = JSON.parse(row.evidence_urls) as string[];
  expect(keys).toHaveLength(1);
  expect(keys[0]).toMatch(/^verification-evidence\//);
  const sealed = (
    await http.pool.query('SELECT metadata,status FROM storage_records WHERE storage_key=$1', [
      keys[0],
    ])
  ).rows[0];
  expect(sealed.status).toBe('immutable');
  objects.set(sealed.metadata.sourceKey, Buffer.from('%PDF-1.7\nReplaced source'));
  const detail = await fetch(`${http.base}/api/crm/verification-cases/${id}`, {
    headers: headers.reviewer!,
  });
  expect(detail.status).toBe(200);
  const data = (await detail.json()) as { evidenceDownloadUrls: string[] };
  expect(data.evidenceDownloadUrls).toHaveLength(1);
  const signed = new URL(data.evidenceDownloadUrls[0]!);
  expect(signed.searchParams.get('X-Amz-Expires')).toBe('300');
  expect(await (await fetch(signed)).text()).toContain('Original evidence');
});
it('refuses another user’s evidence and refuses approval of legacy unsealed evidence', async () => {
  const target = await profile(),
    key = `uploads/document/${randomUUID()}.pdf`;
  objects.set(key, Buffer.from('%PDF-1.7\nEvidence'));
  await http.pool.query(
    `INSERT INTO storage_records(storage_key,status,metadata,file_size,content_type,category)
    VALUES ($1,'active',$2::jsonb,17,'application/pdf','document')`,
    [
      key,
      JSON.stringify({
        verified: true,
        uploadedBy: 'reviewer',
        profileId: target,
        purpose: 'verification_evidence',
      }),
    ]
  );
  expect((await create(target, { evidenceUrls: [key] })).status).toBe(400);
  const id = randomUUID();
  await http.pool.query(
    `INSERT INTO verification_cases(id,profile_id,field_name,current_value,requested_value,evidence_urls,reason,status,created_by)
    VALUES ($1,$2,'first_name','Original','Changed','[]','Legacy case','Under Review','creator')`,
    [id, target]
  );
  expect((await review(id, 'Approved')).status).toBe(409);
  expect(
    (await http.pool.query('SELECT first_name FROM profiles WHERE id=$1', [target])).rows[0]
      .first_name
  ).toBe('Original');
});
it('automatically assigns a correction to an eligible reviewer other than its creator and records a private notice', async () => {
  const team = randomUUID();
  await http.pool.query("INSERT INTO staff_teams(id,name) VALUES ($1,'Identity reviewers')", [
    team,
  ]);
  for (const user of ['creator', 'reviewer'])
    await http.pool.query('INSERT INTO staff_team_members(team_id,user_id) VALUES ($1,$2)', [
      team,
      user,
    ]);
  await http.pool.query(
    `INSERT INTO app_config(key,value) VALUES ('admin.staff_assignment_rules',$1::jsonb)
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
    [JSON.stringify({ verification_case: { teamId: team, strategy: 'round_robin' } })]
  );
  const target = await profile(),
    response = await create(target);
  expect(response.status, http.logs()).toBe(201);
  const { id } = (await response.json()) as { id: string };
  expect(
    (
      await http.pool.query(
        'SELECT assigned_to,assigned_team_id FROM verification_cases WHERE id=$1',
        [id]
      )
    ).rows[0]
  ).toEqual({ assigned_to: 'reviewer', assigned_team_id: team });
  const detail = await fetch(`${http.base}/api/crm/verification-cases/${id}`, {
    headers: headers.reviewer!,
  });
  expect(await detail.json()).toMatchObject({
    assignedTo: 'reviewer',
    assignedName: 'reviewer@example.test',
  });
  const notices = (
    await http.pool.query(
      "SELECT recipient_user_id,link_route FROM in_app_notifications WHERE link_route LIKE '%'||$1||'%'",
      [target]
    )
  ).rows;
  expect(notices).toEqual([
    { recipient_user_id: 'reviewer', link_route: `/admin/crm/corrections?profileId=${target}` },
  ]);
  expect((await review(id, 'Under Review', 'creator')).status).toBe(403);
  await http.pool.query("UPDATE users SET disabled_at=NOW() WHERE user_id='reviewer'");
  try {
    const fallback = await create(await profile());
    expect(fallback.status).toBe(201);
    const data = (await fallback.json()) as { id: string };
    expect(
      (await http.pool.query('SELECT assigned_to FROM verification_cases WHERE id=$1', [data.id]))
        .rows[0].assigned_to
    ).toBeNull();
  } finally {
    await http.pool.query("UPDATE users SET disabled_at=NULL WHERE user_id='reviewer'");
  }
});

async function archive(id: string) {
  return fetch(`${http.base}/api/crm/profiles/${id}`, {
    method: 'DELETE',
    headers: headers.reviewer!,
    body: JSON.stringify({ reason: 'Closure requested' }),
  });
}
it('blocks archival until outstanding corrections are resolved', async () => {
  const target = await profile(),
    response = await create(target),
    { id } = (await response.json()) as { id: string };
  expect((await archive(target)).status).toBe(409);
  expect((await review(id, 'Under Review')).status).toBe(200);
  expect((await archive(target)).status).toBe(409);
  expect((await review(id, 'Rejected')).status).toBe(200);
  expect((await archive(target)).status, http.logs()).toBe(200);
  expect(
    (await http.pool.query('SELECT archived,first_name FROM profiles WHERE id=$1', [target]))
      .rows[0]
  ).toEqual({ archived: true, first_name: 'Original' });
});
it('allows only independent rejection of legacy cases on archived profiles and keeps it atomic', async () => {
  const target = await profile(),
    response = await create(target),
    { id } = (await response.json()) as { id: string };
  await http.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [target]);
  expect((await review(id, 'Under Review')).status).toBe(409);
  expect((await review(id, 'Approved')).status).toBe(409);
  expect((await review(id, 'Rejected', 'creator')).status).toBe(403);
  await http.pool
    .query(`CREATE FUNCTION fail_archived_case_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.event='verification_case_reviewed' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_archived_case_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_archived_case_audit()`);
  try {
    expect((await review(id, 'Rejected')).status).toBe(500);
    expect(
      (await http.pool.query('SELECT status FROM verification_cases WHERE id=$1', [id])).rows[0]
        .status
    ).toBe('Open');
  } finally {
    await http.pool.query(
      'DROP TRIGGER fail_archived_case_audit ON audit_log; DROP FUNCTION fail_archived_case_audit()'
    );
  }
  expect((await review(id, 'Rejected')).status).toBe(200);
  expect((await review(id, 'Rejected')).status).toBe(409);
  expect(
    (await http.pool.query('SELECT archived,first_name FROM profiles WHERE id=$1', [target]))
      .rows[0]
  ).toEqual({ archived: true, first_name: 'Original' });
});
for (const correctionFirst of [false, true])
  it(`serializes archival with correction creation (correction first=${correctionFirst})`, async () => {
    const target = await profile(),
      client = await http.pool.connect();
    let operation: Promise<Response> | undefined;
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [target]);
      operation = correctionFirst ? archive(target) : create(target);
      await expect
        .poll(async () =>
          Number(
            (
              await http.pool.query(`SELECT count(*) AS count FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM profiles WHERE id=$1%FOR UPDATE%'`)
            ).rows[0].count
          )
        )
        .toBe(1);
      if (correctionFirst) {
        await client.query(
          `INSERT INTO verification_cases(id,profile_id,field_name,requested_value,evidence_urls,reason,status,created_by)
        VALUES ($1,$2,'first_name','Updated','[]','Concurrent case','Open','creator')`,
          [randomUUID(), target]
        );
      } else await client.query('UPDATE profiles SET archived=true WHERE id=$1', [target]);
      await client.query('COMMIT');
      expect((await operation).status).toBe(correctionFirst ? 409 : 404);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await operation;
    }
  });
