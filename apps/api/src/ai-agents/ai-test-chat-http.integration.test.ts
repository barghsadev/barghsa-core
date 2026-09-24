import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
import type { TestChatResponse } from './ai-test-chat.service.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let provider: ReturnType<typeof createServer>;
let agentId: string;
let headers: Record<string, string>;
let completions = 0;
const previousEmbeddingBase = process.env.KB_EMBEDDING_BASE_URL;

beforeAll(async () => {
  provider = createServer((request, response) => {
    if (request.url === '/v1/embeddings') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ data: [{ index: 0, embedding: Array(1536).fill(0.1) }] }));
      return;
    }
    if (request.url !== '/v1/chat/completions') {
      response.writeHead(404).end();
      return;
    }
    completions++;
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        choices: [{ message: { content: 'A test answer' } }],
        usage: { prompt_tokens: 7, completion_tokens: 3 },
      })
    );
  });
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const address = provider.address();
  if (!address || typeof address === 'string') throw new Error('No provider port');
  process.env.KB_EMBEDDING_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!, undefined, '', 10, '127.0.0.1');
  await http.pool.query(
    `INSERT INTO staff_roles(role_id,name,description,permissions)
       VALUES ('test-chat-editor','Test chat editor','Test','["admin:ai:agents"]');
     INSERT INTO users(user_id,username,password_hash,is_staff)
       VALUES ('test-chat-admin','test-chat-admin@example.test','test-only',true);
     INSERT INTO user_roles(user_id,role_id) VALUES ('test-chat-admin','test-chat-editor')`
  );
  const sessionId = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
     VALUES ($1,'test-chat-admin',$2,$3,now()+interval '1 day',now()+interval '1 hour')`,
    [sessionId, csrf, randomUUID()]
  );
  headers = {
    cookie: `barghsa_session=${sessionId}`,
    'x-csrf-token': csrf,
    'content-type': 'application/json',
  };
  const modelId = (
    await http.pool.query<{ id: string }>(
      `INSERT INTO ai_models(title,provider_type,base_url,model_name,created_by,is_enabled,last_test_status)
     VALUES ('Local','openai_compatible',$1,'test','test-chat-admin',true,'passed') RETURNING id`,
      [`http://127.0.0.1:${address.port}/v1`]
    )
  ).rows[0]!.id;
  agentId = (
    await http.pool.query<{ id: string }>(
      `INSERT INTO ai_agents(title,model_id,created_by,system_prompt)
     VALUES ('Preview',$1,'test-chat-admin','Answer briefly') RETURNING id`,
      [modelId]
    )
  ).rows[0]!.id;
}, 30000);

afterAll(async () => {
  await http?.close();
  await new Promise<void>((resolve) => provider?.close(() => resolve()));
  if (previousEmbeddingBase === undefined) delete process.env.KB_EMBEDDING_BASE_URL;
  else process.env.KB_EMBEDDING_BASE_URL = previousEmbeddingBase;
});

function send(body: unknown) {
  return fetch(`${http.base}/api/admin/ai/test-chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

it('isolates a test conversation, replays idempotently, and enforces per-admin quota', async () => {
  const requestId = randomUUID();
  const body = { agentId, requestId, message: 'Hello' };
  const first = await send(body);
  expect(first.status).toBe(200);
  const result = (await first.json()) as TestChatResponse;
  expect(result).toMatchObject({
    reply: 'A test answer',
    sources: [],
    tokenUsage: { input: 7, output: 3 },
    remainingQuota: 9,
  });
  expect(result.conversationId).toMatch(/^[a-f0-9-]{36}$/);
  const replay = await send(body);
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual(result);
  expect(completions).toBe(1);
  expect((await send({ ...body, message: 'Different' })).status).toBe(409);
  for (let i = 0; i < 9; i++) {
    const response = await send({
      agentId,
      requestId: randomUUID(),
      conversationId: result.conversationId,
      message: `Hello ${i}`,
    });
    expect(response.status).toBe(200);
  }
  const limited = await send({ agentId, requestId: randomUUID(), message: 'Extra' });
  expect(limited.status).toBe(429);
  expect(limited.headers.get('retry-after')).not.toBeNull();
  expect(completions).toBe(10);
}, 30000);

it('requires every linked knowledge base in all-KB mode and returns its excerpts', async () => {
  await http.pool.query(
    "SELECT rate_limit_rolling_reset(true,'ai:test-chat:user:test-chat-admin')"
  );
  await http.pool.query("UPDATE ai_agents SET link_mode='all_kbs' WHERE id=$1", [agentId]);
  const ids: string[] = [];
  for (const [index, state] of ['ready', 'empty'].entries()) {
    const kbId = (
      await http.pool.query<{ id: string }>(
        `INSERT INTO knowledge_bases(title,created_by,is_enabled,content_state,vector_embedding_model)
       VALUES ($1,'test-chat-admin',$2,$3,'embed-1536') RETURNING id`,
        [`Source ${index + 1}`, state === 'ready', state]
      )
    ).rows[0]!.id;
    ids.push(kbId);
    await http.pool.query('INSERT INTO ai_agent_kbs(agent_id,kb_id) VALUES ($1,$2)', [
      agentId,
      kbId,
    ]);
    await http.pool.query(
      'INSERT INTO kb_chunks(kb_id,chunk_index,content,embedding) VALUES ($1,0,$2,$3::vector)',
      [kbId, `Excerpt ${index + 1}`, JSON.stringify(Array(1536).fill(0.1))]
    );
  }
  expect((await send({ agentId, requestId: randomUUID(), message: 'Sources?' })).status).toBe(409);
  await http.pool.query(
    "UPDATE knowledge_bases SET content_state='ready',is_enabled=true WHERE id=$1",
    [ids[1]]
  );
  const response = await send({ agentId, requestId: randomUUID(), message: 'Sources?' });
  expect(response.status).toBe(200);
  const result = (await response.json()) as TestChatResponse;
  expect(result.sources).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kbId: ids[0], excerpt: 'Excerpt 1' }),
      expect.objectContaining({ kbId: ids[1], excerpt: 'Excerpt 2' }),
    ])
  );
  expect(result.sources).toHaveLength(2);
}, 30000);

it('serves the versioned snake-case contract with session replay', async () => {
  await http.pool.query(
    "SELECT rate_limit_rolling_reset(true,'ai:test-chat:user:test-chat-admin')"
  );
  const requestId = randomUUID();
  const body = { agent_id: agentId, message: 'Versioned preview', request_id: requestId };
  const request = () =>
    fetch(`${http.base}/api/v1/admin/ai/test-chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  const first = await request();
  expect(first.status).toBe(200);
  const result = (await first.json()) as { conversation_id: string; reply: string };
  expect(result).toMatchObject({
    reply: 'A test answer',
    remaining_quota: 9,
    token_usage: { input: 7, output: 3 },
  });
  expect(result.conversation_id).toMatch(/^[a-f0-9-]{36}$/);
  const replay = await request();
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual(result);
}, 30000);
