import { fork, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { AiModelSecrets } from '@barghsa/shared/ai-models';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let child: ChildProcess | undefined;
let provider: ReturnType<typeof createServer>;
let base: string;
let databaseUrl: string;
let modelId: string;
let headers: Record<string, string>;
let calls = 0;
let entered: (() => void) | undefined;
let release: (() => void) | undefined;
let output = '';
let echoCredential = false;
const modelKey = 'a5'.repeat(32);
const secret = 'local-process-secret-' + 'a'.repeat(32);

beforeAll(async () => {
  const reserved = createServer();
  reserved.listen(0, '127.0.0.1');
  await once(reserved, 'listening');
  const port = reserved.address();
  if (!port || typeof port === 'string') throw new Error('Missing worker port');
  base = `http://127.0.0.1:${port.port}`;
  await new Promise<void>((done) => reserved.close(() => done()));
  const priorUrl = process.env.AI_INFERENCE_URL;
  const priorSecret = process.env.AI_INFERENCE_SHARED_SECRET;
  process.env.AI_INFERENCE_URL = base;
  process.env.AI_INFERENCE_SHARED_SECRET = secret;
  try {
    http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  } finally {
    if (priorUrl === undefined) delete process.env.AI_INFERENCE_URL;
    else process.env.AI_INFERENCE_URL = priorUrl;
    if (priorSecret === undefined) delete process.env.AI_INFERENCE_SHARED_SECRET;
    else process.env.AI_INFERENCE_SHARED_SECRET = priorSecret;
  }
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = '/' + (await http.pool.query('SELECT current_database() AS name')).rows[0].name;
  databaseUrl = url.toString();
  await http.pool.query(`
    INSERT INTO users(user_id,username,password_hash,is_staff)
      VALUES ('process-admin','process-admin@example.test','test-only',true);
    INSERT INTO staff_roles(role_id,name,description,permissions)
      VALUES ('process-role','AI health','Test','["admin:ai:models"]');
    INSERT INTO user_roles(user_id,role_id) VALUES ('process-admin','process-role');
  `);
  const session = randomUUID();
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
     VALUES ($1,'process-admin',$2,$3,now()+interval '1 day',now()+interval '1 hour')`,
    [session, randomUUID(), randomUUID()]
  );
  headers = { cookie: `barghsa_session=${session}` };
  provider = createServer(async (request, response) => {
    for await (const _chunk of request) {
      /* Consume the bounded request body. */
    }
    calls++;
    if (entered) {
      entered();
      await new Promise<void>((done) => {
        release = done;
      });
    }
    response.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: echoCredential
                ? `Provider saw ${String(request.headers.authorization).replace(/^Bearer /, '')}`
                : 'From separate process',
            },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      })
    );
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const address = provider.address();
  if (!address || typeof address === 'string') throw new Error('Missing provider port');
  modelId = (
    await http.pool.query<{ id: string }>(
      `INSERT INTO ai_models(title,provider_type,base_url,model_name,created_by,is_enabled,last_test_status)
     VALUES ('Process model','openai_compatible',$1,'process-test','process-admin',true,'passed') RETURNING id`,
      [`http://127.0.0.1:${address.port}/v1`]
    )
  ).rows[0]!.id;
}, 30_000);

async function stopAi() {
  if (!child || child.exitCode !== null) return;
  const stopped = once(child, 'exit');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child?.kill('SIGKILL'), 5_000);
  try {
    expect((await stopped)[0]).toBe(0);
  } finally {
    clearTimeout(timer);
  }
}
afterAll(async () => {
  release?.();
  await stopAi();
  await http?.close();
  await new Promise<void>((done) => provider?.close(() => done()));
});
async function startAi() {
  child = fork(resolve(__dirname, '../../../worker/dist/ai-inference/main.js'), [], {
    silent: true,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      PGDIRECT_URL: databaseUrl,
      AI_INFERENCE_HOST: '127.0.0.1',
      AI_INFERENCE_PORT: new URL(base).port,
      AI_INFERENCE_SHARED_SECRET: secret,
      AI_INFERENCE_MAX_CONCURRENCY: '1',
      AI_MODEL_BASE_URL_ALLOWLIST: '127.0.0.1',
      AI_MODEL_ENCRYPTION_KEY: modelKey,
      NODE_ENV: 'production',
    },
  });
  for (const stream of [child.stdout, child.stderr])
    stream?.on('data', (bytes) => {
      output = (output + String(bytes)).slice(-2000);
    });
  await expect
    .poll(
      async () => {
        if (child?.exitCode !== null) throw new Error(`Worker exited: ${output}`);
        return fetch(`${base}/health/ready`)
          .then((r) => r.status)
          .catch(() => 0);
      },
      { timeout: 10_000, interval: 50 }
    )
    .toBe(200);
}
async function aiHealth() {
  const response = await fetch(`${http.base}/api/ai/health`, { headers });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({ status: expect.any(String), worker: expect.any(Object) });
  return body as {
    status: string;
    worker: {
      status: string;
      active: number | null;
      maxConcurrency: number | null;
      saturated: boolean | null;
    };
    models: Array<{ id: string; status: string }>;
  };
}
async function coreReady() {
  return (await fetch(`${http.base}/api/health/ready`, { signal: AbortSignal.timeout(3_000) }))
    .status;
}
async function complete() {
  const model = (await http.pool.query('SELECT base_url FROM ai_models WHERE id=$1', [modelId]))
    .rows[0];
  return fetch(`${base}/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ai-inference-token': secret },
    body: JSON.stringify({
      modelId,
      expected: {
        providerType: 'openai_compatible',
        baseUrl: model.base_url,
        modelName: 'process-test',
      },
      request: { messages: [{ role: 'user', content: 'Hello' }], temperature: 0, maxTokens: 32 },
    }),
  });
}

it('starts and restarts the compiled AI process without changing core readiness or its API process', async () => {
  const apiPid = http.process.pid;
  expect(await coreReady()).toBe(200);
  expect((await aiHealth()).status).toBe('unavailable');
  await startAi();
  expect((await aiHealth()).worker).toMatchObject({ status: 'ok', maxConcurrency: 1 });
  expect((await aiHealth()).models).toEqual([{ id: modelId, status: 'closed' }]);
  await stopAi();
  expect(await coreReady()).toBe(200);
  expect((await aiHealth()).status).toBe('unavailable');
  await startAi();
  expect((await aiHealth()).status).toBe('ok');
  expect(await coreReady()).toBe(200);
  expect(http.process.pid).toBe(apiPid);
}, 30_000);

it('reports real worker saturation while core readiness stays healthy and recovers after completion', async () => {
  const started = new Promise<void>((done) => {
    entered = done;
  });
  const first = complete();
  try {
    await started;
    const health = await aiHealth();
    expect(health.status).toBe('saturated');
    expect(health.worker).toMatchObject({ active: 1, saturated: true });
    expect(await coreReady()).toBe(200);
    const rejected = await complete();
    expect(rejected.status).toBe(503);
    expect(await rejected.json()).toEqual({ error: 'AI_INFERENCE_BUSY' });
    expect(calls).toBe(1);
  } finally {
    entered = undefined;
    release?.();
  }
  const response = await first;
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ reply: 'From separate process' });
  expect((await aiHealth()).worker).toMatchObject({ active: 0, saturated: false });
  expect(await coreReady()).toBe(200);
}, 15_000);

it('keeps an opaque rotated provider credential out of the real worker response', async () => {
  if (!child || child.exitCode !== null) await startAi();
  const token = 'rotated.[opaque]+provider-credential';
  const encrypted = new AiModelSecrets(Buffer.from(modelKey, 'hex')).encryptToken(token);
  await http.pool.query('UPDATE ai_models SET api_token=$2 WHERE id=$1', [modelId, encrypted]);
  echoCredential = true;
  try {
    const response = await complete();
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toEqual({
      reply: 'Provider saw [REDACTED]',
      tokenUsage: { input: 1, output: 1 },
    });
    expect(JSON.stringify(result)).not.toContain(token);
  } finally {
    echoCredential = false;
  }
});
