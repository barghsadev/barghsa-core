import { fork, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
import type { KnowledgeAnswer } from './ai-knowledge-chat.service.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let provider: ReturnType<typeof createServer>;
let worker: ChildProcess | undefined;
let modelId: string;
let agentId: string;
let publicKb: string;
let staffKb: string;
let staffSession: string;
let staffCsrf: string;
let staffHeaders: Record<string, string>;
let cookie: string;
let csrf: string;
let calls = 0;
let messages: Array<{ role: string; content: string }> = [];
let beforeReply: (() => Promise<void>) | undefined;
let held: Promise<void> | undefined;
let reply = 'Published service guidance.';
const secret = 'owned-website-fixture-' + 'a'.repeat(32);
const originalEmbedding = process.env.KB_EMBEDDING_BASE_URL;

beforeAll(async () => {
  provider = createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url === '/v1/embeddings') {
      response.end(JSON.stringify({ data: [{ index: 0, embedding: Array(1536).fill(0.1) }] }));
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    messages = JSON.parse(Buffer.concat(chunks).toString()).messages as typeof messages;
    calls++;
    const mutation = beforeReply;
    beforeReply = undefined;
    await mutation?.();
    await held;
    response.end(
      JSON.stringify({
        choices: [{ message: { content: reply } }],
        usage: { prompt_tokens: 7, completion_tokens: 4 },
      })
    );
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const address = provider.address();
  if (!address || typeof address === 'string') throw new Error('Missing provider port');
  process.env.KB_EMBEDDING_BASE_URL = 'http://127.0.0.1:' + address.port + '/v1';
  const reserved = createServer();
  reserved.listen(0, '127.0.0.1');
  await once(reserved, 'listening');
  const aiAddress = reserved.address();
  if (!aiAddress || typeof aiAddress === 'string') throw new Error('Missing inference port');
  const aiBase = 'http://127.0.0.1:' + aiAddress.port;
  await new Promise<void>((done) => reserved.close(() => done()));
  const previousUrl = process.env.AI_INFERENCE_URL;
  const previousSecret = process.env.AI_INFERENCE_SHARED_SECRET;
  process.env.AI_INFERENCE_URL = aiBase;
  process.env.AI_INFERENCE_SHARED_SECRET = secret;
  try {
    http = await startHttpFixture(process.env.TEST_DATABASE_URL!, undefined, '', 10, '127.0.0.1');
  } finally {
    if (previousUrl === undefined) delete process.env.AI_INFERENCE_URL;
    else process.env.AI_INFERENCE_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.AI_INFERENCE_SHARED_SECRET;
    else process.env.AI_INFERENCE_SHARED_SECRET = previousSecret;
  }
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ('website-owner','website-owner@example.test','test-only')"
  );
  const session = randomUUID();
  csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES ($1,'website-owner',$2,$3,now()+interval '1 day',now()+interval '1 hour')",
    [session, csrf, randomUUID()]
  );
  cookie = 'barghsa_session=' + session;
  await http.pool.query(`
    INSERT INTO users(user_id,username,password_hash,is_staff)
      VALUES ('staff-guide','staff-guide@example.test','test-only',true);
    INSERT INTO staff_roles(role_id,name,description,permissions)
      VALUES ('staff-guide-role','Staff guide role','Owned fixture','["admin:ai:agents"]');
    INSERT INTO user_roles(user_id,role_id) VALUES ('staff-guide','staff-guide-role')`);
  staffSession = randomUUID();
  staffCsrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,operating_context) VALUES ($1,'staff-guide',$2,$3,now()+interval '1 day',now()+interval '1 hour','staff')",
    [staffSession, staffCsrf, randomUUID()]
  );
  staffHeaders = { cookie: 'barghsa_session=' + staffSession, 'x-csrf-token': staffCsrf };
  await http.pool.query(
    "INSERT INTO profiles(user_id,profile_type,status,is_default,first_name) VALUES ('website-owner','INDIVIDUAL','ACTIVE',true,'PROFILE_PRIVATE')"
  );
  modelId = (
    await http.pool.query<{ id: string }>(
      "INSERT INTO ai_models(title,provider_type,base_url,model_name,config,created_by,is_enabled,last_test_status) VALUES ('Website','openai_compatible',$1,'website-test','{\"temperature\":0,\"max_tokens\":64}','website-owner',true,'passed') RETURNING id",
      ['http://127.0.0.1:' + address.port + '/v1']
    )
  ).rows[0]!.id;
  agentId = (
    await http.pool.query<{ id: string }>(
      "INSERT INTO ai_agents(title,model_id,created_by,system_prompt) VALUES ('Shared knowledge',$1,'website-owner','Use the reference passages') RETURNING id",
      [modelId]
    )
  ).rows[0]!.id;
  for (const audience of ['public', 'customer', 'staff', 'admin']) {
    const id = (
      await http.pool.query<{ id: string }>(
        "INSERT INTO knowledge_bases(title,audience,created_by,is_enabled,content_state,vector_embedding_model) VALUES ($1,$2,'website-owner',true,'ready','embed-1536') RETURNING id",
        [audience === 'public' ? 'Published guide' : audience + '_PRIVATE', audience]
      )
    ).rows[0]!.id;
    if (audience === 'public') publicKb = id;
    if (audience === 'staff') staffKb = id;
    await http.pool.query('INSERT INTO ai_agent_kbs(agent_id,kb_id) VALUES ($1,$2)', [agentId, id]);
    await http.pool.query(
      'INSERT INTO kb_chunks(kb_id,chunk_index,content,embedding) VALUES ($1,0,$2,$3::vector)',
      [
        id,
        audience === 'public' ? 'PUBLIC_GUIDANCE' : audience + '_PRIVATE_CONTENT',
        JSON.stringify(Array(1536).fill(0.1)),
      ]
    );
  }
  const databaseUrl = new URL(process.env.TEST_DATABASE_URL!);
  databaseUrl.pathname =
    '/' + (await http.pool.query('SELECT current_database() AS name')).rows[0].name;
  worker = fork(resolve(__dirname, '../../../worker/dist/ai-inference/main.js'), [], {
    silent: true,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl.toString(),
      PGDIRECT_URL: databaseUrl.toString(),
      AI_INFERENCE_HOST: '127.0.0.1',
      AI_INFERENCE_PORT: String(aiAddress.port),
      AI_INFERENCE_SHARED_SECRET: secret,
      AI_MODEL_ENCRYPTION_KEY: 'a5'.repeat(32),
      AI_MODEL_BASE_URL_ALLOWLIST: '127.0.0.1',
      NODE_ENV: 'production',
    },
  });
  await vi.waitFor(
    async () => {
      expect(
        await fetch(aiBase + '/health/ready')
          .then((r) => r.status)
          .catch(() => 0)
      ).toBe(200);
    },
    { timeout: 10_000 }
  );
}, 30_000);

beforeEach(async () => {
  calls = 0;
  messages = [];
  beforeReply = undefined;
  held = undefined;
  reply = 'Published service guidance.';
  await http.pool.query("DELETE FROM rate_limit_windows WHERE key LIKE 'ai:website:%'");
  await http.pool.query("DELETE FROM rate_limit_windows WHERE key LIKE 'ai:staff:%'");
  await http.pool.query("UPDATE users SET disabled_at=NULL WHERE user_id='staff-guide'");
  await http.pool.query(
    "UPDATE staff_roles SET permissions='[\"admin:ai:agents\"]' WHERE role_id='staff-guide-role'"
  );
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES ('staff-guide','staff-guide-role') ON CONFLICT DO NOTHING"
  );
  await http.pool.query(
    "UPDATE sessions SET operating_context='staff',csrf_token=$2,revoked_at=NULL,expires_at=now()+interval '1 day',idle_deadline=now()+interval '1 hour' WHERE session_id=$1",
    [staffSession, staffCsrf]
  );
  await http.pool.query("UPDATE knowledge_bases SET audience='staff' WHERE id=$1", [staffKb]);
  await http.pool.query(
    'INSERT INTO ai_agent_kbs(agent_id,kb_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [agentId, staffKb]
  );
  await http.pool.query("UPDATE ai_agent_slots SET agent_id=$1 WHERE slot_key='staff_chatbot'", [
    agentId,
  ]);
  await http.pool.query('DELETE FROM ai_model_budgets WHERE model_id=$1', [modelId]);
  await http.pool.query('DELETE FROM ai_agent_policies WHERE agent_id=$1', [agentId]);
  await http.pool.query("UPDATE ai_agents SET enabled=true,link_mode='any_kb' WHERE id=$1", [
    agentId,
  ]);
  await http.pool.query(
    "UPDATE ai_models SET is_enabled=true,last_test_status='passed' WHERE id=$1",
    [modelId]
  );
  await http.pool.query("UPDATE knowledge_bases SET audience='public' WHERE id=$1", [publicKb]);
  await http.pool.query(
    'INSERT INTO ai_agent_kbs(agent_id,kb_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [agentId, publicKb]
  );
  await http.pool.query("UPDATE ai_agent_slots SET agent_id=$1 WHERE slot_key='website_chatbot'", [
    agentId,
  ]);
});
afterAll(async () => {
  if (worker && worker.exitCode === null) {
    const stopped = once(worker, 'exit');
    worker.kill('SIGTERM');
    await stopped;
  }
  await http?.close();
  provider?.closeAllConnections();
  await new Promise<void>((done) => provider?.close(() => done()));
  if (originalEmbedding === undefined) delete process.env.KB_EMBEDDING_BASE_URL;
  else process.env.KB_EMBEDDING_BASE_URL = originalEmbedding;
});
function ask(body: unknown, extra: Record<string, string> = {}) {
  return fetch(http.base + '/api/public/knowledge/questions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extra },
    body: JSON.stringify(body),
  });
}
it('answers anonymously through the compiled private worker using only published public knowledge', async () => {
  expect(await (await fetch(http.base + '/api/public/knowledge/availability')).json()).toEqual({
    available: true,
  });
  const result = await ask({ message: 'Explain the published guidance.' });
  expect(result.status).toBe(200);
  const body = (await result.json()) as KnowledgeAnswer;
  expect(body).toMatchObject({
    reply: 'Published service guidance.',
    attribution: 'retrieved_context',
    remainingQuota: 4,
    policyChecks: [],
    answeredAt: expect.any(String),
  });
  expect(body.sources).toMatchObject([
    { kbId: publicKb, title: 'Published guide', excerpt: 'PUBLIC_GUIDANCE' },
  ]);
  expect(JSON.stringify(messages)).toContain('PUBLIC_GUIDANCE');
  expect(JSON.stringify(messages)).not.toMatch(/PRIVATE/);
  expect(body).not.toHaveProperty('profileId');
  expect(body).not.toHaveProperty('conversationId');
  expect(calls).toBe(1);
  expect(worker?.pid).not.toBe(http.process.pid);
  expect(
    (
      await http.pool.query(
        'SELECT session_id,user_id,profile_id,authorization_result FROM ai_audit_log WHERE correlation_id=$1',
        [result.headers.get('x-correlation-id')]
      )
    ).rows
  ).toEqual([
    { session_id: null, user_id: null, profile_id: null, authorization_result: 'allowed' },
  ]);
  expect((await http.pool.query('SELECT count(*) FROM ai_test_chat_turns')).rows[0].count).toBe(
    '0'
  );
});
it('ignores an authenticated cookie and redacts sensitive values without adopting its profile', async () => {
  expect((await ask({ message: 'Question' }, { cookie })).status).toBe(403);
  expect(calls).toBe(0);
  const result = await ask(
    { message: 'password: hiddensecret IBAN IR۸۲۰۵۴۰۱۰۲۶۸۰۰۲۰۸۱۷۹۰۹۰۰۲' },
    { cookie, 'x-csrf-token': csrf }
  );
  expect(result.status).toBe(200);
  expect(JSON.stringify(messages)).not.toMatch(/hiddensecret|IR۸۲۰|PRIVATE/);
  expect(messages.at(-1)?.content).toBe('password: [REDACTED] IBAN [REDACTED]');
  expect(
    (
      await http.pool.query(
        'SELECT user_id,profile_id,input FROM ai_audit_log WHERE correlation_id=$1',
        [result.headers.get('x-correlation-id')]
      )
    ).rows
  ).toMatchObject([
    {
      user_id: null,
      profile_id: null,
      input: { redactionCategories: ['credential', 'bank_detail'] },
    },
  ]);
});
it('refuses slot, agent and profile overrides and invalid text without provider calls', async () => {
  for (const body of [
    { message: ' ', slotKey: 'staff_chatbot' },
    { message: 'Question', agentId, profileId: 'private-value' },
    { message: 'x'.repeat(1001) },
  ]) {
    const result = await ask(body);
    expect(result.status).toBe(400);
    expect(JSON.stringify(await result.json())).not.toMatch(/private-value|staff_chatbot/);
  }
  expect(calls).toBe(0);
});
it('hides an unassigned, untested or mixed all-KB website slot', async () => {
  const available = async () =>
    await (await fetch(http.base + '/api/public/knowledge/availability')).json();
  await http.pool.query("UPDATE ai_agent_slots SET agent_id=NULL WHERE slot_key='website_chatbot'");
  expect(await available()).toEqual({ available: false });
  expect((await ask({ message: 'Question' })).status).toBe(409);
  await http.pool.query("UPDATE ai_agent_slots SET agent_id=$1 WHERE slot_key='website_chatbot'", [
    agentId,
  ]);
  await http.pool.query(
    "UPDATE ai_models SET is_enabled=false,last_test_status='pending' WHERE id=$1",
    [modelId]
  );
  expect(await available()).toEqual({ available: false });
  await http.pool.query(
    "UPDATE ai_models SET is_enabled=true,last_test_status='passed' WHERE id=$1",
    [modelId]
  );
  await http.pool.query("UPDATE ai_agents SET link_mode='all_kbs' WHERE id=$1", [agentId]);
  expect(await available()).toEqual({ available: false });
  expect((await ask({ message: 'Question' })).status).toBe(409);
  expect(calls).toBe(0);
});
it.each(['slot', 'audience', 'membership', 'agent', 'model'] as const)(
  'withholds an answer after the public %s scope changes during provider work',
  async (change) => {
    beforeReply = async () => {
      if (change === 'slot')
        await http.pool.query(
          "UPDATE ai_agent_slots SET agent_id=NULL WHERE slot_key='website_chatbot'"
        );
      if (change === 'audience')
        await http.pool.query("UPDATE knowledge_bases SET audience='admin' WHERE id=$1", [
          publicKb,
        ]);
      if (change === 'membership')
        await http.pool.query('DELETE FROM ai_agent_kbs WHERE agent_id=$1 AND kb_id=$2', [
          agentId,
          publicKb,
        ]);
      if (change === 'agent')
        await http.pool.query('UPDATE ai_agents SET enabled=false WHERE id=$1', [agentId]);
      if (change === 'model')
        await http.pool.query('UPDATE ai_models SET is_enabled=false WHERE id=$1', [modelId]);
    };
    const result = await ask({ message: 'Public reference?' });
    expect(result.status).toBe(409);
    expect(JSON.stringify(await result.json())).not.toContain('Published service guidance.');
    expect(calls).toBe(1);
  }
);
it('enforces the durable public IP quota even when forwarded headers are forged', async () => {
  for (let i = 0; i < 5; i++)
    expect(
      (await ask({ message: 'Public reference ' + i }, { 'x-forwarded-for': '192.0.2.' + i }))
        .status
    ).toBe(200);
  const denied = await ask({ message: 'Extra' }, { 'x-forwarded-for': '203.0.113.99' });
  expect(denied.status).toBe(429);
  expect(Number(denied.headers.get('retry-after'))).toBeGreaterThan(0);
  expect(calls).toBe(5);
}, 30_000);
it('refuses exhausted model budgets and policy blocks without exposing private policy IDs', async () => {
  await http.pool.query(
    'INSERT INTO ai_model_budgets(model_id,monthly_token_limit) VALUES ($1,1)',
    [modelId]
  );
  expect((await ask({ message: 'Public reference' })).status).toBe(429);
  expect(calls).toBe(0);
  await http.pool.query('DELETE FROM ai_model_budgets WHERE model_id=$1', [modelId]);
  const policy = (
    await http.pool.query<{ id: string }>(
      "INSERT INTO ai_policies(title,policy_type,rules,created_by) VALUES ('Internal filter','content_filter','{\"blockedTerms\":[\"blocked\"]}','website-owner') RETURNING id"
    )
  ).rows[0]!.id;
  await http.pool.query('INSERT INTO ai_agent_policies(agent_id,policy_id) VALUES ($1,$2)', [
    agentId,
    policy,
  ]);
  const result = await ask({ message: 'A blocked question' });
  expect(result.status).toBe(422);
  const detail = await result.json();
  expect(detail).toMatchObject({ error: { code: 'AI_WEBSITE_POLICY_BLOCKED' } });
  expect(JSON.stringify(detail)).not.toContain(policy);
  expect(calls).toBe(0);
});
it('bounds public requests while core readiness remains healthy', async () => {
  let release!: () => void;
  held = new Promise<void>((done) => {
    release = done;
  });
  const first = ask({ message: 'First' });
  const second = ask({ message: 'Second' });
  try {
    await expect
      .poll(
        async () =>
          Number(
            (
              await http.pool.query(
                "SELECT cardinality(events) AS n FROM rate_limit_windows WHERE key LIKE 'ai:website:%'"
              )
            ).rows[0]?.n ?? 0
          ),
        { timeout: 5000 }
      )
      .toBe(2);
    const rejected = await ask({ message: 'Third' });
    expect(rejected.status).toBe(503);
    expect(await rejected.json()).toMatchObject({ error: { code: 'AI_WEBSITE_BUSY' } });
    expect((await fetch(http.base + '/api/health/ready')).status).toBe(200);
  } finally {
    release();
  }
  expect((await first).status).toBe(200);
  expect((await second).status).toBe(200);
  expect(calls).toBe(2);
});

function staffAsk(body: unknown = { message: 'Staff reference?' }, headers = staffHeaders) {
  return fetch(http.base + '/api/staff/knowledge/questions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
it('staff fixed slot consumes staff/public sources with session audit and no business profile or history', async () => {
  expect(
    await (
      await fetch(http.base + '/api/staff/knowledge/availability', { headers: staffHeaders })
    ).json()
  ).toEqual({ available: true });
  const result = await staffAsk();
  expect(result.status).toBe(200);
  expect(result.headers.get('cache-control')).toBe('private, no-cache, no-store, must-revalidate');
  const body = (await result.json()) as KnowledgeAnswer;
  expect(new Set(body.sources.map((s) => s.kbId))).toEqual(new Set([publicKb, staffKb]));
  expect(body).toMatchObject({
    attribution: 'retrieved_context',
    remainingQuota: 4,
    policyChecks: [],
    answeredAt: expect.any(String),
  });
  const prompt = JSON.stringify(messages);
  expect(prompt).toContain('staff_PRIVATE_CONTENT');
  expect(prompt).toContain('PUBLIC_GUIDANCE');
  expect(prompt).not.toMatch(/customer_PRIVATE|admin_PRIVATE|PROFILE_PRIVATE/);
  expect(
    (
      await http.pool.query(
        'SELECT session_id,user_id,profile_id,agent_slot,authorization_result FROM ai_audit_log WHERE correlation_id=$1',
        [result.headers.get('x-correlation-id')]
      )
    ).rows
  ).toEqual([
    {
      session_id: staffSession,
      user_id: 'staff-guide',
      profile_id: null,
      agent_slot: 'staff_chatbot',
      authorization_result: 'allowed',
    },
  ]);
  expect((await http.pool.query('SELECT count(*) FROM ai_test_chat_turns')).rows[0].count).toBe(
    '0'
  );
  expect(calls).toBe(1);
});
it('staff route rejects guests, customer context, missing CSRF and insufficient current grants before I/O', async () => {
  expect((await staffAsk(undefined, {})).status).toBe(401);
  expect((await staffAsk(undefined, { cookie })).status).toBe(403);
  expect((await staffAsk(undefined, { cookie, 'x-csrf-token': csrf })).status).toBe(403);
  expect((await staffAsk(undefined, { cookie: staffHeaders.cookie! })).status).toBe(403);
  await http.pool.query(
    "UPDATE staff_roles SET permissions='[\"admin:ai:models\"]' WHERE role_id='staff-guide-role'"
  );
  const denied = await staffAsk();
  expect(denied.status).toBe(403);
  expect(
    (
      await http.pool.query(
        'SELECT authorization_result FROM ai_audit_log WHERE correlation_id=$1',
        [denied.headers.get('x-correlation-id')]
      )
    ).rows
  ).toEqual([{ authorization_result: 'denied' }]);
  expect(
    (await fetch(http.base + '/api/staff/knowledge/availability', { headers: staffHeaders })).status
  ).toBe(403);
  expect(calls).toBe(0);
});
it('staff request rejects all agent/profile/slot overrides and hides a missing or mixed all-KB assignment', async () => {
  expect(
    (
      await staffAsk({
        message: 'Question',
        agentId,
        slotKey: 'website_chatbot',
        profileId: publicKb,
      })
    ).status
  ).toBe(400);
  await http.pool.query("UPDATE ai_agent_slots SET agent_id=NULL WHERE slot_key='staff_chatbot'");
  expect((await staffAsk()).status).toBe(409);
  await http.pool.query("UPDATE ai_agent_slots SET agent_id=$1 WHERE slot_key='staff_chatbot'", [
    agentId,
  ]);
  await http.pool.query("UPDATE ai_agents SET link_mode='all_kbs' WHERE id=$1", [agentId]);
  expect(
    await (
      await fetch(http.base + '/api/staff/knowledge/availability', { headers: staffHeaders })
    ).json()
  ).toEqual({ available: false });
  expect((await staffAsk()).status).toBe(409);
  expect(calls).toBe(0);
});
it.each(['role', 'disabled', 'revoked', 'expired', 'idle', 'csrf', 'context'] as const)(
  'staff reply is withheld after late %s authority loss',
  async (change) => {
    beforeReply = async () => {
      if (change === 'role')
        await http.pool.query("DELETE FROM user_roles WHERE user_id='staff-guide'");
      if (change === 'disabled')
        await http.pool.query("UPDATE users SET disabled_at=now() WHERE user_id='staff-guide'");
      if (change === 'revoked')
        await http.pool.query('UPDATE sessions SET revoked_at=now() WHERE session_id=$1', [
          staffSession,
        ]);
      if (change === 'expired')
        await http.pool.query(
          "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE session_id=$1",
          [staffSession]
        );
      if (change === 'idle')
        await http.pool.query(
          "UPDATE sessions SET idle_deadline=now()-interval '1 second' WHERE session_id=$1",
          [staffSession]
        );
      if (change === 'csrf')
        await http.pool.query('UPDATE sessions SET csrf_token=$2 WHERE session_id=$1', [
          staffSession,
          randomUUID(),
        ]);
      if (change === 'context')
        await http.pool.query(
          "UPDATE sessions SET operating_context='customer' WHERE session_id=$1",
          [staffSession]
        );
    };
    const result = await staffAsk();
    expect(result.status).toBe(['revoked', 'expired', 'idle'].includes(change) ? 401 : 403);
    expect(JSON.stringify(await result.json())).not.toContain(reply);
    expect(calls).toBe(1);
    expect(
      (
        await http.pool.query(
          'SELECT authorization_result FROM ai_audit_log WHERE correlation_id=$1',
          [result.headers.get('x-correlation-id')]
        )
      ).rows
    ).toEqual([{ authorization_result: 'denied' }]);
  }
);
it.each(['slot', 'audience', 'membership', 'agent', 'model'] as const)(
  'staff reply is withheld after late %s knowledge scope change',
  async (change) => {
    beforeReply = async () => {
      if (change === 'slot')
        await http.pool.query(
          "UPDATE ai_agent_slots SET agent_id=NULL WHERE slot_key='staff_chatbot'"
        );
      if (change === 'audience')
        await http.pool.query("UPDATE knowledge_bases SET audience='admin' WHERE id=$1", [staffKb]);
      if (change === 'membership')
        await http.pool.query('DELETE FROM ai_agent_kbs WHERE agent_id=$1 AND kb_id=$2', [
          agentId,
          staffKb,
        ]);
      if (change === 'agent')
        await http.pool.query('UPDATE ai_agents SET enabled=false WHERE id=$1', [agentId]);
      if (change === 'model')
        await http.pool.query('UPDATE ai_models SET is_enabled=false WHERE id=$1', [modelId]);
    };
    const result = await staffAsk();
    expect(result.status).toBe(409);
    expect(JSON.stringify(await result.json())).not.toContain(reply);
    expect(calls).toBe(1);
  }
);
it('staff quota is account-bound across sessions and independent of the public quota', async () => {
  const other = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,operating_context) VALUES ($1,'staff-guide',$2,$3,now()+interval '1 day',now()+interval '1 hour','staff')",
    [other, staffCsrf, randomUUID()]
  );
  for (let i = 0; i < 5; i++) expect((await staffAsk()).status).toBe(200);
  const denied = await staffAsk(undefined, {
    cookie: 'barghsa_session=' + other,
    'x-csrf-token': staffCsrf,
  });
  expect(denied.status).toBe(429);
  expect(Number(denied.headers.get('retry-after'))).toBeGreaterThan(0);
  expect((await ask({ message: 'Independent public request' })).status).toBe(200);
  expect(calls).toBe(6);
}, 30_000);
it('staff policy blocks hide private rule identities and redaction remains applied', async () => {
  const id = (
    await http.pool.query(
      "INSERT INTO ai_policies(title,policy_type,rules,created_by) VALUES ('Staff internal filter','content_filter','{\"blockedTerms\":[\"blocked\"]}','website-owner') RETURNING id"
    )
  ).rows[0].id as string;
  await http.pool.query('INSERT INTO ai_agent_policies(agent_id,policy_id) VALUES ($1,$2)', [
    agentId,
    id,
  ]);
  const denied = await staffAsk({ message: 'blocked' });
  expect(denied.status).toBe(422);
  const detail = await denied.json();
  expect(detail).toMatchObject({ error: { code: 'AI_KNOWLEDGE_POLICY_BLOCKED' } });
  expect(JSON.stringify(detail)).not.toContain(id);
  expect(calls).toBe(0);
  const ok = await staffAsk({ message: 'password: owned-secret' });
  expect(ok.status).toBe(200);
  expect(JSON.stringify(messages)).not.toContain('owned-secret');
});
