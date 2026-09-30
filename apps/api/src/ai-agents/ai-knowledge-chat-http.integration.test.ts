import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
import type { KnowledgeAnswer } from './ai-knowledge-chat.service.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let provider: ReturnType<typeof createServer>;
let headers: Record<string, string>;
let agentId: string;
let modelId: string;
let individualId: string;
let legalId: string;
let customerKbId: string;
let publicKbId: string;
let adminKbId: string;
let completions = 0;
let lastMessages: Array<{ role: string; content: string }> = [];
const previousEmbeddingBase = process.env.KB_EMBEDDING_BASE_URL;

beforeAll(async () => {
  provider = createServer(async (request, response) => {
    if (request.url === '/v1/embeddings') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ data: [{ index: 0, embedding: Array(1536).fill(0.1) }] }));
      return;
    }
    if (request.url !== '/v1/chat/completions') {
      response.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    lastMessages = (
      JSON.parse(Buffer.concat(chunks).toString()) as { messages: typeof lastMessages }
    ).messages;
    completions += 1;
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        choices: [{ message: { content: 'Use the published guide.' } }],
        usage: { prompt_tokens: 7, completion_tokens: 4 },
      })
    );
  });
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const address = provider.address();
  if (!address || typeof address === 'string') throw new Error('No provider port');
  process.env.KB_EMBEDDING_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!, undefined, '', 10, '127.0.0.1');
  await http.pool.query(
    `INSERT INTO users(user_id,username,password_hash) VALUES
       ('knowledge-user','knowledge-user@example.test','test-only'),
       ('knowledge-admin','knowledge-admin@example.test','test-only')`
  );
  const sessionId = randomUUID();
  const csrf = randomUUID();
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
     VALUES ($1,'knowledge-user',$2,$3,now()+interval '1 day',now()+interval '1 hour')`,
    [sessionId, csrf, randomUUID()]
  );
  headers = {
    cookie: `barghsa_session=${sessionId}`,
    'x-csrf-token': csrf,
    'content-type': 'application/json',
  };
  individualId = (
    await http.pool.query<{ id: string }>(
      "INSERT INTO profiles(user_id,profile_type,is_default,status,first_name,last_name) VALUES ('knowledge-user','INDIVIDUAL',true,'ACTIVE','Ava','Customer') RETURNING id"
    )
  ).rows[0]!.id;
  legalId = (
    await http.pool.query<{ id: string }>(
      "INSERT INTO profiles(user_id,profile_type,status,first_name,last_name) VALUES ('knowledge-user','LEGAL','ACTIVE','Acme','Energy') RETURNING id"
    )
  ).rows[0]!.id;
  modelId = (
    await http.pool.query<{ id: string }>(
      `INSERT INTO ai_models(title,provider_type,base_url,model_name,created_by,is_enabled,last_test_status)
       VALUES ('Knowledge','openai_compatible',$1,'test','knowledge-admin',true,'passed') RETURNING id`,
      [`http://127.0.0.1:${address.port}/v1`]
    )
  ).rows[0]!.id;
  agentId = (
    await http.pool.query<{ id: string }>(
      `INSERT INTO ai_agents(title,model_id,created_by,system_prompt)
       VALUES ('Knowledge',$1,'knowledge-admin','Use the reference passages') RETURNING id`,
      [modelId]
    )
  ).rows[0]!.id;
  await http.pool.query(
    "UPDATE ai_agent_slots SET agent_id=$1 WHERE slot_key IN ('individual_chatbot','legal_entity_chatbot')",
    [agentId]
  );
  for (const [title, audience] of [
    ['Admin secret', 'admin'],
    ['Customer guide', 'customer'],
    ['Public guide', 'public'],
  ] as const) {
    const kbId = (
      await http.pool.query<{ id: string }>(
        `INSERT INTO knowledge_bases(title,audience,created_by,is_enabled,content_state,vector_embedding_model)
         VALUES ($1,$2,'knowledge-admin',true,'ready','embed-1536') RETURNING id`,
        [title, audience]
      )
    ).rows[0]!.id;
    if (audience === 'admin') adminKbId = kbId;
    if (audience === 'customer') customerKbId = kbId;
    if (audience === 'public') publicKbId = kbId;
    await http.pool.query('INSERT INTO ai_agent_kbs(agent_id,kb_id) VALUES ($1,$2)', [
      agentId,
      kbId,
    ]);
    await http.pool.query(
      'INSERT INTO kb_chunks(kb_id,chunk_index,content,embedding) VALUES ($1,0,$2,$3::vector)',
      [kbId, `${title} content`, JSON.stringify(Array(1536).fill(0.1))]
    );
  }
}, 30_000);

afterAll(async () => {
  await http?.close();
  await new Promise<void>((resolve) => provider?.close(() => resolve()));
  if (previousEmbeddingBase === undefined) delete process.env.KB_EMBEDDING_BASE_URL;
  else process.env.KB_EMBEDDING_BASE_URL = previousEmbeddingBase;
});

function ask(body: unknown, requestHeaders = headers) {
  return fetch(`${http.base}/api/ai/knowledge/questions`, {
    method: 'POST',
    headers: requestHeaders,
    body: JSON.stringify(body),
  });
}

it('answers from customer/public sources, audits the profile, and replays one request', async () => {
  expect(
    await (await fetch(`${http.base}/api/ai/knowledge/availability`, { headers })).json()
  ).toEqual({
    available: true,
    profileId: individualId,
    profileName: 'Ava Customer',
    slotKey: 'individual_chatbot',
  });
  const requestId = randomUUID();
  const body = { requestId, message: 'What does the guide say?' };
  const first = await ask(body);
  expect(first.status).toBe(200);
  const answer = (await first.json()) as KnowledgeAnswer;
  expect(answer).toMatchObject({
    reply: 'Use the published guide.',
    attribution: 'retrieved_context',
    remainingQuota: 4,
  });
  expect(answer.sources.map((source) => source.kbId).sort()).toEqual(
    [customerKbId, publicKbId].sort()
  );
  expect(lastMessages.some((message) => message.content.includes('Admin secret'))).toBe(false);
  expect(lastMessages.some((message) => message.content.includes('profile, order, wallet'))).toBe(
    true
  );
  expect((await (await ask(body)).json()) as KnowledgeAnswer).toEqual(answer);
  expect(completions).toBe(1);
  expect((await ask({ ...body, message: 'Changed' })).status).toBe(409);
  const audit = await http.pool.query<{
    profile_id: string;
    agent_slot: string;
    input: { message: string };
  }>("SELECT profile_id,agent_slot,input FROM ai_audit_log WHERE input->>'requestId'=$1", [
    requestId,
  ]);
  expect(audit.rows[0]).toMatchObject({
    profile_id: individualId,
    agent_slot: 'individual_chatbot',
  });
}, 30_000);

it('denies revoked sources and never replays an answer under another active profile', async () => {
  const requestId = randomUUID();
  const body = { requestId, message: 'Published source?' };
  expect((await ask(body)).status).toBe(200);
  await http.pool.query("UPDATE knowledge_bases SET audience='admin' WHERE id=$1", [customerKbId]);
  expect((await ask(body)).status).toBe(409);
  await http.pool.query("UPDATE knowledge_bases SET audience='customer' WHERE id=$1", [
    customerKbId,
  ]);
  await http.pool.query('DELETE FROM ai_agent_kbs WHERE agent_id=$1 AND kb_id=$2', [
    agentId,
    customerKbId,
  ]);
  expect((await ask(body)).status).toBe(409);
  await http.pool.query('INSERT INTO ai_agent_kbs(agent_id,kb_id) VALUES ($1,$2)', [
    agentId,
    customerKbId,
  ]);
  await http.pool.query(
    `INSERT INTO user_profile_contexts(user_id,profile_id)
     VALUES ('knowledge-user',$1) ON CONFLICT (user_id) DO UPDATE SET profile_id=EXCLUDED.profile_id`,
    [legalId]
  );
  expect((await ask(body)).status).toBe(409);
  expect(
    await (await fetch(`${http.base}/api/ai/knowledge/availability`, { headers })).json()
  ).toEqual({
    available: true,
    profileId: legalId,
    profileName: 'Acme Energy',
    slotKey: 'legal_entity_chatbot',
  });
  const legal = await ask({ requestId: randomUUID(), message: 'Public source?' });
  expect(legal.status).toBe(200);
  expect(
    ((await legal.json()) as KnowledgeAnswer).sources.map((source) => source.kbId).sort()
  ).toEqual([customerKbId, publicKbId].sort());
}, 30_000);

it('requires session and CSRF, bounds concurrency, and gives a clear empty-source result', async () => {
  expect((await ask({ requestId: randomUUID(), message: 'Hello' }, {})).status).toBe(401);
  expect(
    (await ask({ requestId: randomUUID(), message: 'Hello' }, { cookie: headers.cookie! })).status
  ).toBe(403);
  const before = completions;
  const held = await http.pool.connect();
  try {
    for (let slot = 0; slot < 3; slot += 1)
      await held.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [
        `ai:knowledge:capacity:${slot}`,
      ]);
    const busy = await ask({ requestId: randomUUID(), message: 'Are you busy?' });
    expect(busy.status).toBe(503);
    expect(await busy.json()).toMatchObject({ error: { code: 'AI_KNOWLEDGE_BUSY' } });
    expect(completions).toBe(before);
  } finally {
    for (let slot = 0; slot < 3; slot += 1)
      await held.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [
        `ai:knowledge:capacity:${slot}`,
      ]);
    held.release();
  }
  await http.pool.query("UPDATE knowledge_bases SET audience='admin' WHERE id=$1", [publicKbId]);
  await http.pool.query("UPDATE knowledge_bases SET audience='customer' WHERE id=$1", [
    customerKbId,
  ]);
  await http.pool.query('DELETE FROM kb_chunks WHERE kb_id=$1', [customerKbId]);
  const noSource = await ask({ requestId: randomUUID(), message: 'No shared source' });
  expect(noSource.status).toBe(422);
  expect(completions).toBe(before);
  expect(adminKbId).toBeTruthy();
}, 30_000);

it('limits customer questions per active profile without invoking the model again', async () => {
  await http.pool.query('SELECT rate_limit_rolling_reset(true,$1)', [
    `ai:knowledge:user:knowledge-user:profile:${legalId}`,
  ]);
  const before = completions;
  for (let i = 0; i < 5; i++)
    expect((await ask({ requestId: randomUUID(), message: `No source ${i}` })).status).toBe(422);
  const limited = await ask({ requestId: randomUUID(), message: 'One more' });
  expect(limited.status).toBe(429);
  expect(limited.headers.get('retry-after')).not.toBeNull();
  expect(completions).toBe(before);
}, 30_000);

it('rejects a customer question before provider use when the assigned model budget is exhausted', async () => {
  await http.pool.query("UPDATE knowledge_bases SET audience='public' WHERE id=$1", [publicKbId]);
  await http.pool.query('SELECT rate_limit_rolling_reset(true,$1)', [
    `ai:knowledge:user:knowledge-user:profile:${legalId}`,
  ]);
  await http.pool.query(
    'INSERT INTO ai_model_budgets(model_id,monthly_token_limit) VALUES ($1,1)',
    [modelId]
  );
  const before = completions;
  const denied = await ask({ requestId: randomUUID(), message: 'What is the public guide?' });
  expect(denied.status).toBe(429);
  expect(await denied.json()).toMatchObject({ error: { code: 'AI_MODEL_BUDGET_EXHAUSTED' } });
  expect(completions).toBe(before);
}, 30_000);
