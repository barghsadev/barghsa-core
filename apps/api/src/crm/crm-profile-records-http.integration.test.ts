import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
import type {
  CrmAgentRecord,
  CrmVerificationRecord,
  CrmRecordPage,
} from './crm-profile-records.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
const company = randomUUID(),
  otherCompany = randomUUID(),
  individual = randomUUID();
let readerCookie: string, customerCookie: string;
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  for (const user of ['records-reader', 'records-owner', 'records-member']) {
    await http.pool.query('INSERT INTO users(user_id,username,password_hash) VALUES ($1,$2,$3)', [
      user,
      `${user}@example.test`,
      'secret-password-hash',
    ]);
  }
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES ('records-reader','role-crm-verification')"
  );
  for (const user of ['records-reader', 'records-member']) {
    const session = randomUUID();
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
      VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')`,
      [session, user, randomUUID(), randomUUID()]
    );
    if (user === 'records-reader') readerCookie = `barghsa_session=${session}`;
    else customerCookie = `barghsa_session=${session}`;
  }
  for (const [id, user, type, title] of [
    [company, 'records-owner', 'LEGAL', 'Selected company'],
    [otherCompany, 'records-owner', 'LEGAL', 'Other company'],
    [individual, 'records-member', 'INDIVIDUAL', 'Member profile'],
  ]) {
    await http.pool.query(
      'INSERT INTO profiles(id,user_id,profile_type,title,status) VALUES ($1,$2,$3,$4,$5)',
      [id, user, type, title, 'ACTIVE']
    );
  }
  for (const [profile, user, role] of [
    [company, 'records-owner', 'Owner'],
    [company, 'records-member', 'Manager'],
    [otherCompany, 'records-member', 'Finance'],
  ]) {
    await http.pool.query(
      'INSERT INTO profile_agents(id,profile_id,user_id,role,joined_at) VALUES ($1,$2,$3,$4,$5)',
      [randomUUID(), profile, user, role, '2026-08-01T01:00:00.000001Z']
    );
  }
  for (let n = 0; n < 21; n++) {
    await http.pool.query(
      `INSERT INTO profile_invitations(id,profile_id,username,role,invited_by,status,expires_at,created_at)
      VALUES ($1,$2,$3,'Legal','records-owner','Pending','2026-08-02T00:00:00Z',$4)`,
      [
        randomUUID(),
        company,
        n === 0 ? 'records-member@example.test' : `invite-${n}@example.test`,
        '2026-08-01T01:00:00.000001Z',
      ]
    );
  }
  for (let n = 0; n < 23; n++) {
    await http.pool.query(
      'INSERT INTO audit_log(id,user_id,event,metadata,created_at) VALUES ($1,$2,$3,$4,$5)',
      [
        randomUUID(),
        'records-reader',
        'verification_change',
        JSON.stringify({
          profileId: n === 22 ? company.toUpperCase() : company,
          previousStatus: 'ACTIVE',
          newStatus: 'VERIFIED',
          reason: `Review ${n}`,
          evidenceKey: 'secret-proof-key',
        }),
        n === 22 ? '2026-08-01T01:00:00.000002Z' : '2026-08-01T01:00:00.000001Z',
      ]
    );
  }
  await http.pool.query('INSERT INTO audit_log(id,user_id,event,metadata) VALUES ($1,$2,$3,$4)', [
    randomUUID(),
    'records-reader',
    'verification_change',
    JSON.stringify({ profileId: otherCompany, reason: 'private-other-profile' }),
  ]);
  await http.pool.query('INSERT INTO audit_log(id,user_id,event,metadata) VALUES ($1,$2,$3,$4)', [
    randomUUID(),
    'records-reader',
    'verification_change',
    'invalid legacy metadata',
  ]);
}, 40000);
afterAll(async () => http?.close());
function read(profile: string, kind: string, cursor?: string, cookie = readerCookie) {
  return fetch(
    `${http.base}/api/crm/profiles/${profile}/records/${kind}${cursor ? '?' + new URLSearchParams({ cursor }) : ''}`,
    { headers: { Cookie: cookie } }
  );
}
for (const kind of ['agents', 'verification'] as const) {
  it(`pages all ${kind} records without losing timestamp ties or exposing other profiles`, async () => {
    let cursor: string | undefined;
    const items: (CrmAgentRecord | CrmVerificationRecord)[] = [];
    do {
      const response = await read(company, kind, cursor);
      expect(response.status).toBe(200);
      const raw = await response.text();
      expect(raw).not.toContain('private-other-profile');
      expect(raw).not.toContain('secret-proof-key');
      expect(raw).not.toContain('secret-password-hash');
      const page = JSON.parse(raw) as CrmRecordPage<CrmAgentRecord | CrmVerificationRecord>;
      expect(page.items.length).toBeLessThanOrEqual(20);
      items.push(...page.items);
      cursor = page.nextCursor ?? undefined;
      expect(items.length).toBeLessThanOrEqual(23);
    } while (cursor);
    expect(items).toHaveLength(23);
    expect(new Set(items.map((item) => item.id)).size).toBe(23);
    expect(items.every((item) => item.createdAt.endsWith('Z'))).toBe(true);
    if (kind === 'agents') {
      const agents = items as CrmAgentRecord[];
      expect(
        agents.filter((row) => row.kind === 'invitation').every((row) => row.status === 'Expired')
      ).toBe(true);
      expect(agents.every((row) => row.profileId === company)).toBe(true);
      expect(agents.every((row) => !('userId' in row))).toBe(true);
    } else expect(items[0]!.createdAt).toBe('2026-08-01T01:00:00.000002Z');
  });
}
it('shows the companies an individual represents and invitations to their current sign-in contact', async () => {
  const response = await read(individual, 'agents');
  expect(response.status).toBe(200);
  const page = (await response.json()) as CrmRecordPage<CrmAgentRecord>;
  expect(page.items).toHaveLength(3);
  expect(
    page.items
      .filter((row) => row.kind === 'agent')
      .map((row) => row.role)
      .sort()
  ).toEqual(['Finance', 'Manager']);
  expect(page.items.filter((row) => row.kind === 'invitation').map((row) => row.username)).toEqual([
    'records-member@example.test',
  ]);
});
it('includes first pages in the full detail response', async () => {
  const response = await fetch(`${http.base}/api/crm/profiles/${company.toUpperCase()}`, {
    headers: { Cookie: readerCookie },
  });
  expect(response.status).toBe(200);
  const data = (await response.json()) as {
    agentRelationships: CrmRecordPage<CrmAgentRecord>;
    verificationHistory: CrmRecordPage<CrmVerificationRecord>;
  };
  expect(data.agentRelationships.items).toHaveLength(20);
  expect(data.verificationHistory.items).toHaveLength(20);
  expect(data.agentRelationships.nextCursor).toBeTruthy();
  expect(data.verificationHistory.nextCursor).toBeTruthy();
  expect(
    (await read(company.toUpperCase(), 'agents', data.agentRelationships.nextCursor!)).status
  ).toBe(200);
  expect(
    (await read(company.toUpperCase(), 'verification', data.verificationHistory.nextCursor!)).status
  ).toBe(200);
});
it('includes setup and correction decisions without returning identity values or evidence', async () => {
  const records = [
    ['profile_onboarding_completed', { fromStatus: 'DRAFT', toStatus: 'ACTIVE' }],
    [
      'verification_case_created',
      {
        currentValue: 'private-identity-before',
        requestedValue: 'private-identity-after',
        evidenceKeys: ['private-evidence-key'],
      },
    ],
    [
      'verification_case_reviewed',
      {
        decision: 'Approved',
        reviewerNotes: 'Evidence checked',
        oldValue: 'private-identity-before',
        newValue: 'private-identity-after',
      },
    ],
  ] as const;
  for (const [event, metadata] of records) {
    await http.pool.query('INSERT INTO audit_log(id,user_id,event,metadata) VALUES ($1,$2,$3,$4)', [
      randomUUID(),
      'records-reader',
      event,
      JSON.stringify({ profileId: otherCompany, ...metadata }),
    ]);
  }
  const response = await read(otherCompany, 'verification');
  expect(response.status).toBe(200);
  const raw = await response.text();
  expect(raw).not.toContain('private-identity');
  expect(raw).not.toContain('private-evidence');
  const result = JSON.parse(raw) as CrmRecordPage<CrmVerificationRecord>;
  expect(result.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        event: 'profile_onboarding_completed',
        previousStatus: 'DRAFT',
        newStatus: 'ACTIVE',
      }),
      expect.objectContaining({ event: 'verification_case_created', newStatus: 'Open' }),
      expect.objectContaining({
        event: 'verification_case_reviewed',
        newStatus: 'Approved',
        reason: 'Evidence checked',
        actor: 'records-reader@example.test',
      }),
    ])
  );
  await http.pool.query(`INSERT INTO staff_roles(role_id,name,description,permissions)
    VALUES ('records-read-only','Records read only','Test role','["crm:read"]')`);
  await http.pool.query("DELETE FROM user_roles WHERE user_id='records-reader'");
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES ('records-reader','records-read-only')"
  );
  try {
    const restricted = await read(otherCompany, 'verification');
    expect(restricted.status).toBe(200);
    const visible = (await restricted.json()) as CrmRecordPage<CrmVerificationRecord>;
    expect(visible.items.map((row) => row.event).sort()).toEqual([
      'profile_onboarding_completed',
      'verification_change',
    ]);
    const detail = await fetch(`${http.base}/api/crm/profiles/${otherCompany}`, {
      headers: { Cookie: readerCookie },
    });
    expect(detail.status).toBe(200);
    const embedded = (await detail.json()) as {
      verificationHistory: CrmRecordPage<CrmVerificationRecord>;
    };
    expect(embedded.verificationHistory.items.map((row) => row.event).sort()).toEqual([
      'profile_onboarding_completed',
      'verification_change',
    ]);
  } finally {
    await http.pool.query("DELETE FROM user_roles WHERE user_id='records-reader'");
    await http.pool.query(
      "INSERT INTO user_roles(user_id,role_id) VALUES ('records-reader','role-crm-verification')"
    );
  }
});
it('requires current CRM read access and binds cursors to their profile and record kind', async () => {
  for (const kind of ['agents', 'verification']) {
    expect((await read(company, kind, undefined, customerCookie)).status).toBe(403);
    expect((await read(company, kind, undefined, '')).status).toBe(401);
  }
  const first = (await (
    await read(company, 'verification')
  ).json()) as CrmRecordPage<CrmVerificationRecord>;
  expect((await read(otherCompany, 'verification', first.nextCursor!)).status).toBe(400);
  expect((await read(company, 'agents', first.nextCursor!)).status).toBe(400);
  expect((await read(company, 'verification', 'invalid')).status).toBe(400);
  const invalidDate = JSON.parse(Buffer.from(first.nextCursor!, 'base64url').toString('utf8'));
  invalidDate.createdAt = '2026-02-31T01:00:00Z';
  expect(
    (
      await read(
        company,
        'verification',
        Buffer.from(JSON.stringify(invalidDate)).toString('base64url')
      )
    ).status
  ).toBe(400);
  expect((await read(randomUUID(), 'verification')).status).toBe(404);
  expect((await read('invalid', 'verification')).status).toBe(400);
  expect((await read(company, 'invalid')).status).toBe(400);
  await http.pool.query("DELETE FROM user_roles WHERE user_id='records-reader'");
  expect((await read(company, 'verification')).status).toBe(403);
});
