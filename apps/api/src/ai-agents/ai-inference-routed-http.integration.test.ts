import { afterAll, beforeAll, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let worker: ReturnType<typeof createServer>;
let modelId: string;
let agentId: string;
let headers: Record<string, string>;
let forwarded = '';
let forwardedToken: string | undefined;
const secret = 'test-worker-secret';

beforeAll(async () => {
  worker = createServer(async (request, response) => {
    forwardedToken = request.headers['x-ai-inference-token'] as string | undefined;
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    forwarded = Buffer.concat(chunks).toString('utf8');
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({ reply: 'From isolated worker', tokenUsage: { input: 7, output: 3 } })
    );
  });
  await new Promise<void>((resolve) => worker.listen(0, '127.0.0.1', resolve));
  const address = worker.address();
  if (!address || typeof address === 'string') throw new Error('Missing worker port');
  const priorUrl = process.env.AI_INFERENCE_URL;
  const priorSecret = process.env.AI_INFERENCE_SHARED_SECRET;
  process.env.AI_INFERENCE_URL = `http://127.0.0.1:${address.port}`;
  process.env.AI_INFERENCE_SHARED_SECRET = secret;
  try {
    http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  } finally {
    if (priorUrl === undefined) delete process.env.AI_INFERENCE_URL;
    else process.env.AI_INFERENCE_URL = priorUrl;
    if (priorSecret === undefined) delete process.env.AI_INFERENCE_SHARED_SECRET;
    else process.env.AI_INFERENCE_SHARED_SECRET = priorSecret;
  }
  await http.pool.query(
    `INSERT INTO staff_roles(role_id,name,description,permissions)
       VALUES ('isolated-ai-editor','AI editor','Test','["admin:ai:agents"]');
     INSERT INTO users(user_id,username,password_hash,is_staff)
       VALUES ('isolated-ai-admin','isolated-ai-admin@example.test','test-only',true);
     INSERT INTO user_roles(user_id,role_id) VALUES ('isolated-ai-admin','isolated-ai-editor')`
  );
  const sessionId = randomUUID();
  const csrf = randomUUID();
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
     VALUES ($1,'isolated-ai-admin',$2,$3,now()+interval '1 day',now()+interval '1 hour')`,
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
       VALUES ('Isolated model','openai_compatible','https://provider.example.test/v1','test',
               'isolated-ai-admin',true,'passed') RETURNING id`
    )
  ).rows[0]!.id;
  agentId = (
    await http.pool.query<{ id: string }>(
      `INSERT INTO ai_agents(title,model_id,created_by,system_prompt)
       VALUES ('Isolated preview',$1,'isolated-ai-admin','Answer briefly') RETURNING id`,
      [modelId]
    )
  ).rows[0]!.id;
}, 30_000);

afterAll(async () => {
  await http?.close();
  await new Promise<void>((resolve) => worker?.close(() => resolve()));
});

it('forwards the preview to the internal process with no provider token', async () => {
  const response = await fetch(`${http.base}/api/admin/ai/test-chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ agentId, requestId: randomUUID(), message: 'Through worker' }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ reply: 'From isolated worker' });
  expect(forwardedToken).toBe(secret);
  expect(forwarded).toContain(modelId);
  expect(forwarded).toContain('Through worker');
  expect(forwarded).not.toContain('apiToken');
});
