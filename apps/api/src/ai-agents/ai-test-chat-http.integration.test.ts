import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
import type { TestChatResponse } from './ai-test-chat.service.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let provider: ReturnType<typeof createServer>;
let agentId: string;
let modelId: string;
let headers: Record<string, string>;
let completions = 0;
let providerReply = 'A test answer';
let providerFailure = false;
let failCompletionMessage: string | null = null;
let lastChatMessages: Array<{ role: string; content: string }> = [];
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
    const payload = JSON.parse(Buffer.concat(chunks).toString()) as {
      messages: Array<{ role: string; content: string }>;
    };
    lastChatMessages = payload.messages;
    completions++;
    if (providerFailure || payload.messages.at(-1)?.content === failCompletionMessage) {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'temporarily unavailable' }));
      return;
    }
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        choices: [{ message: { content: providerReply } }],
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
  modelId = (
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
    attribution: 'general_guidance',
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

it('audits staff authorization denials and invalid requests without invoking the model', async () => {
  const sessionId = randomUUID();
  const csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ('test-chat-unprivileged','test-chat-unprivileged@example.test','test-only',true)"
  );
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
     VALUES ($1,'test-chat-unprivileged',$2,$3,now()+interval '1 day',now()+interval '1 hour')`,
    [sessionId, csrf, randomUUID()]
  );
  const before = completions;
  const denied = await fetch(`${http.base}/api/admin/ai/test-chat`, {
    method: 'POST',
    headers: {
      cookie: `barghsa_session=${sessionId}`,
      'x-csrf-token': csrf,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ agentId, requestId: randomUUID(), message: 'password: deniedsecret' }),
  });
  expect(denied.status).toBe(403);
  const deniedAudit = await http.pool.query<{
    authorization_result: string;
    input: { message: string; redactionCategories: string[] };
    output: { status: number };
    correlation_id: string;
  }>(
    "SELECT authorization_result,input,output,correlation_id FROM ai_audit_log WHERE user_id='test-chat-unprivileged'"
  );
  expect(deniedAudit.rows).toMatchObject([
    {
      authorization_result: 'denied',
      input: { message: 'password: [REDACTED]', redactionCategories: ['credential'] },
      output: { status: 403 },
      correlation_id: denied.headers.get('x-correlation-id'),
    },
  ]);
  const invalid = await send({ agentId: 'invalid', message: 'bad' });
  expect(invalid.status).toBe(400);
  expect(
    (
      await http.pool.query<{ output: { status: number } }>(
        `SELECT output FROM ai_audit_log
         WHERE user_id='test-chat-admin' AND output->>'code'='VALIDATION:PARSE:ZOD_ERROR'`
      )
    ).rows
  ).toMatchObject([{ output: { status: 400 } }]);
  expect(completions).toBe(before);
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
    const storageKey = `test-chat/${randomUUID()}`;
    await http.pool.query('INSERT INTO storage_records(storage_key,file_name) VALUES ($1,$2)', [
      storageKey,
      `Source ${index + 1}.txt`,
    ]);
    const documentId = (
      await http.pool.query<{ id: string }>(
        `INSERT INTO kb_documents(kb_id,storage_key,file_name,created_by,processing_status)
         VALUES ($1,$2,$3,'test-chat-admin','ready') RETURNING id`,
        [kbId, storageKey, `Source ${index + 1}.txt`]
      )
    ).rows[0]!.id;
    await http.pool.query(
      'INSERT INTO kb_chunks(kb_id,document_id,chunk_index,content,embedding) VALUES ($1,$2,0,$3,$4::vector)',
      [kbId, documentId, `Excerpt ${index + 1}`, JSON.stringify(Array(1536).fill(0.1))]
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
      expect.objectContaining({
        kbId: ids[0],
        documentTitle: 'Source 1.txt',
        excerpt: 'Excerpt 1',
      }),
      expect.objectContaining({
        kbId: ids[1],
        documentTitle: 'Source 2.txt',
        excerpt: 'Excerpt 2',
      }),
    ])
  );
  expect(result.sources).toHaveLength(2);
  expect(result.attribution).toBe('retrieved_context');
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
    attribution: 'retrieved_context',
    remaining_quota: 9,
    token_usage: { input: 7, output: 3 },
  });
  expect(result.conversation_id).toMatch(/^[a-f0-9-]{36}$/);
  const replay = await request();
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual(result);
}, 30000);

it('redacts prompt, stored turn and returned answer before exposing them', async () => {
  await http.pool.query(
    "SELECT rate_limit_rolling_reset(true,'ai:test-chat:user:test-chat-admin')"
  );
  await http.pool.query("UPDATE ai_agents SET link_mode='any_kb' WHERE id=$1", [agentId]);
  await http.pool.query(
    `UPDATE kb_chunks SET content='Document password: kbsecret'
      WHERE kb_id=(SELECT kb_id FROM ai_agent_kbs WHERE agent_id=$1 LIMIT 1)`,
    [agentId]
  );
  providerReply = 'Card 6037991234567890';
  const requestId = randomUUID();
  const response = await send({ agentId, requestId, message: 'My password is hunter2' });
  expect(response.status).toBe(200);
  const result = (await response.json()) as TestChatResponse;
  expect(result.reply).toBe('Card [REDACTED]');
  expect(result.sources.some((source) => source.excerpt.includes('[REDACTED]'))).toBe(true);
  expect(lastChatMessages.at(-1)?.content).toBe('My password is [REDACTED]');
  expect(lastChatMessages.some((message) => message.content.includes('hunter2'))).toBe(false);
  expect(lastChatMessages.some((message) => message.content.includes('kbsecret'))).toBe(false);
  const turn = await http.pool.query<{ user_message: string; reply: string }>(
    'SELECT user_message,reply FROM ai_test_chat_turns WHERE request_id=$1',
    [requestId]
  );
  expect(turn.rows).toEqual([
    { user_message: 'My password is [REDACTED]', reply: 'Card [REDACTED]' },
  ]);
  const audit = await http.pool.query<{
    input: { message: string; redactionCategories: string[] };
    output: { reply: string; status: number };
    authorization_result: string;
    correlation_id: string;
    token_usage: { input: number; output: number };
  }>(
    `SELECT input,output,authorization_result,correlation_id,token_usage
       FROM ai_audit_log WHERE input->>'requestId'=$1`,
    [requestId]
  );
  expect(audit.rows).toMatchObject([
    {
      input: { message: 'My password is [REDACTED]', redactionCategories: ['credential'] },
      output: { reply: 'Card [REDACTED]', status: 200 },
      authorization_result: 'allowed',
      correlation_id: response.headers.get('x-correlation-id'),
      token_usage: { input: 7, output: 3 },
    },
  ]);
  const completed = completions;
  await http.pool.query(
    `UPDATE ai_test_chat_turns
        SET reply='Token: oldsecret',
            response=jsonb_set(response,'{reply}',to_jsonb('Token: oldsecret'::text))
      WHERE request_id=$1`,
    [requestId]
  );
  const replay = await send({ agentId, requestId, message: 'My password is hunter2' });
  expect(replay.status).toBe(200);
  expect(await replay.json()).toMatchObject({ reply: 'Token: [REDACTED]' });
  expect(completions).toBe(completed);
  expect(
    (await http.pool.query("SELECT id FROM ai_audit_log WHERE input->>'requestId'=$1", [requestId]))
      .rows
  ).toHaveLength(2);
  providerReply = 'A test answer';
}, 30000);

it('prevents update, delete and truncate of AI audit records', async () => {
  const id = (await http.pool.query<{ id: string }>('SELECT id FROM ai_audit_log LIMIT 1')).rows[0]!
    .id;
  await expect(
    http.pool.query('UPDATE ai_audit_log SET tool_name=$2 WHERE id=$1', [id, 'changed'])
  ).rejects.toMatchObject({ code: '55000' });
  await expect(http.pool.query('DELETE FROM ai_audit_log WHERE id=$1', [id])).rejects.toMatchObject(
    {
      code: '55000',
    }
  );
  await expect(http.pool.query('TRUNCATE ai_audit_log')).rejects.toMatchObject({ code: '55000' });
});

it('opens a per-model circuit after provider failures and recovers with one probe', async () => {
  providerFailure = true;
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      await http.pool.query(
        "SELECT rate_limit_rolling_reset(true,'ai:test-chat:user:test-chat-admin')"
      );
      const response = await send({ agentId, requestId: randomUUID(), message: 'Check model' });
      expect(response.status).toBe(503);
    }
    expect(
      (
        await http.pool.query(
          'SELECT degraded,window_failures FROM ai_model_circuit_states WHERE id=$1',
          [modelId]
        )
      ).rows[0]
    ).toMatchObject({ degraded: true, window_failures: 5 });
    const attempts = completions;
    const blocked = await send({ agentId, requestId: randomUUID(), message: 'Still down?' });
    expect(blocked.status).toBe(503);
    expect(await blocked.json()).toMatchObject({ error: { code: 'AI_MODEL_CIRCUIT_OPEN' } });
    expect(completions).toBe(attempts);
    expect(
      (
        await http.pool.query(
          "SELECT kind FROM provider_health_events WHERE channel='ai' AND provider_id=$1",
          [modelId]
        )
      ).rows
    ).toEqual([{ kind: 'circuit_open' }]);
  } finally {
    providerFailure = false;
  }
  await http.pool.query(
    "UPDATE ai_model_circuit_states SET cooldown_until=NOW()-INTERVAL '1 second' WHERE id=$1",
    [modelId]
  );
  failCompletionMessage = 'Recovery fails';
  const beforeFailedRecovery = completions;
  const failedRecovery = await send({
    agentId,
    requestId: randomUUID(),
    message: failCompletionMessage,
  });
  expect(failedRecovery.status).toBe(503);
  expect(completions).toBe(beforeFailedRecovery + 2);
  expect(
    (await http.pool.query('SELECT degraded FROM ai_model_circuit_states WHERE id=$1', [modelId]))
      .rows[0]
  ).toMatchObject({ degraded: true });
  failCompletionMessage = null;
  await http.pool.query(
    "UPDATE ai_model_circuit_states SET cooldown_until=NOW()-INTERVAL '1 second' WHERE id=$1",
    [modelId]
  );
  const attempts = completions;
  const recovered = await send({ agentId, requestId: randomUUID(), message: 'Recovered?' });
  expect(recovered.status).toBe(200);
  expect(completions).toBe(attempts + 2);
  expect(
    (await http.pool.query('SELECT degraded FROM ai_model_circuit_states WHERE id=$1', [modelId]))
      .rows[0]
  ).toMatchObject({ degraded: false });
  expect(
    (
      await http.pool.query(
        "SELECT kind FROM provider_health_events WHERE channel='ai' AND provider_id=$1 ORDER BY created_at,id",
        [modelId]
      )
    ).rows
  ).toEqual([{ kind: 'circuit_open' }, { kind: 'circuit_recovered' }]);
}, 30000);

it('requires a retrieved source when a response policy demands one', async () => {
  await http.pool.query(
    "SELECT rate_limit_rolling_reset(true,'ai:test-chat:user:test-chat-admin')"
  );
  const policyId = randomUUID();
  await http.pool.query('DELETE FROM ai_agent_kbs WHERE agent_id=$1', [agentId]);
  await http.pool.query(
    `INSERT INTO ai_policies(id,title,policy_type,rules,created_by)
     VALUES ($1,'Source required','response_style','{"tone":"brief","requireSources":true}','test-chat-admin')`,
    [policyId]
  );
  await http.pool.query('INSERT INTO ai_agent_policies(agent_id,policy_id) VALUES ($1,$2)', [
    agentId,
    policyId,
  ]);
  const before = completions;
  const requestId = randomUUID();
  const response = await send({ agentId, requestId, message: 'Electricity?' });
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({
    error: { code: 'AI_TEST_CHAT_POLICY_BLOCKED', reason: 'source_required', policyRef: policyId },
  });
  expect(completions).toBe(before);
  expect(
    (
      await http.pool.query<{ output: { status: number; code: string } }>(
        `SELECT output FROM ai_audit_log WHERE input->>'requestId'=$1`,
        [requestId]
      )
    ).rows
  ).toMatchObject([{ output: { status: 422, code: 'AI_TEST_CHAT_POLICY_BLOCKED' } }]);
  await http.pool.query('DELETE FROM ai_agent_policies WHERE agent_id=$1 AND policy_id=$2', [
    agentId,
    policyId,
  ]);
  await http.pool.query('DELETE FROM ai_policies WHERE id=$1', [policyId]);
}, 30000);

it('resolves group priority, filters input/output and applies policy rate limits', async () => {
  await http.pool.query(
    "SELECT rate_limit_rolling_reset(true,'ai:test-chat:user:test-chat-admin')"
  );
  await http.pool.query("UPDATE ai_agents SET link_mode='any_kb' WHERE id=$1", [agentId]);
  const groupId = randomUUID();
  const jsonPolicy = randomUUID();
  const plainPolicy = randomUUID();
  const filterPolicy = randomUUID();
  const limitPolicy = randomUUID();
  await http.pool.query(
    "INSERT INTO ai_policy_groups(id,title,created_by) VALUES ($1,'Preview rules','test-chat-admin')",
    [groupId]
  );
  await http.pool.query(
    `INSERT INTO ai_policies(id,title,policy_type,rules,priority,created_by)
       VALUES ($1,'JSON','output_format','{"format":"json_object"}',20,'test-chat-admin'),
              ($2,'Plain','output_format','{"format":"plain_text"}',-10,'test-chat-admin'),
              ($3,'Filter','content_filter','{"blockedTerms":["secret"]}',0,'test-chat-admin'),
              ($4,'Limit','rate_limit','{"maxRequests":1,"windowSeconds":60}',0,'test-chat-admin')`,
    [jsonPolicy, plainPolicy, filterPolicy, limitPolicy]
  );
  await http.pool.query(
    `INSERT INTO ai_policy_group_members(group_id,policy_id,priority_override)
       VALUES ($1,$2,-20),($1,$3,NULL),($1,$4,NULL),($1,$5,NULL)`,
    [groupId, jsonPolicy, plainPolicy, filterPolicy, limitPolicy]
  );
  await http.pool.query('INSERT INTO ai_agent_policy_groups(agent_id,group_id) VALUES ($1,$2)', [
    agentId,
    groupId,
  ]);
  const beforeInputBlock = completions;
  const inputBlocked = await send({ agentId, requestId: randomUUID(), message: 'A secret' });
  expect(inputBlocked.status).toBe(422);
  expect(await inputBlocked.json()).toMatchObject({
    error: {
      code: 'AI_TEST_CHAT_POLICY_BLOCKED',
      policyRef: filterPolicy,
      reason: 'input_filtered',
    },
  });
  expect(completions).toBe(beforeInputBlock);
  providerReply = '{"secret":true}';
  const outputBlocked = await send({ agentId, requestId: randomUUID(), message: 'Allowed' });
  expect(outputBlocked.status).toBe(422);
  expect(await outputBlocked.json()).toMatchObject({
    error: {
      code: 'AI_TEST_CHAT_POLICY_BLOCKED',
      policyRef: filterPolicy,
      reason: 'output_filtered',
    },
  });
  providerReply = '{"ok":true}';
  await http.pool.query('SELECT rate_limit_rolling_reset(true,$1)', [
    `ai:policy:${limitPolicy}:agent:${agentId}:user:test-chat-admin`,
  ]);
  const accepted = await send({ agentId, requestId: randomUUID(), message: 'Allowed again' });
  expect(accepted.status).toBe(200);
  const result = (await accepted.json()) as TestChatResponse;
  expect(result.reply).toBe('{"ok":true}');
  expect(result.policyResults[0]).toMatchObject({ id: jsonPolicy, priority: -20 });
  const limited = await send({ agentId, requestId: randomUUID(), message: 'Another allowed' });
  expect(limited.status).toBe(429);
  expect(await limited.json()).toMatchObject({
    error: { code: 'RATE_LIMIT:EXCEEDED', policyRef: limitPolicy },
  });
  expect(limited.headers.get('retry-after')).not.toBeNull();
  providerReply = 'A test answer';
}, 30000);
