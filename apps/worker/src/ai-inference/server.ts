import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import {
  AiModelSecrets,
  completeChat,
  type ChatCompletionInput,
  type ChatCompletionResult,
} from '@barghsa/shared/ai-models';

interface ModelRow {
  provider_type: ChatCompletionInput['providerType'];
  base_url: string;
  model_name: string;
  api_token: string | null;
  is_enabled: boolean;
  last_test_status: 'pending' | 'passed' | 'failed';
}

interface CompletionRequest {
  modelId: string;
  expected: Pick<ChatCompletionInput, 'providerType' | 'baseUrl' | 'modelName'>;
  request: Pick<ChatCompletionInput, 'messages' | 'temperature' | 'maxTokens'>;
}

function reply(res: ServerResponse, status: number, body: object): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function authorized(req: IncomingMessage, secret: string): boolean {
  const provided = req.headers['x-ai-inference-token'];
  if (typeof provided !== 'string') return false;
  const actual = Buffer.from(provided);
  const expected = Buffer.from(secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readRequest(req: IncomingMessage): Promise<CompletionRequest> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 512 * 1024) throw new Error('request_too_large');
    chunks.push(buffer);
  }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as CompletionRequest;
  if (
    !body ||
    typeof body.modelId !== 'string' ||
    !/^[0-9a-f-]{36}$/i.test(body.modelId) ||
    !body.expected ||
    typeof body.expected.providerType !== 'string' ||
    typeof body.expected.baseUrl !== 'string' ||
    typeof body.expected.modelName !== 'string' ||
    !body.request ||
    !Array.isArray(body.request.messages) ||
    typeof body.request.temperature !== 'number' ||
    typeof body.request.maxTokens !== 'number' ||
    'apiToken' in body ||
    'apiToken' in body.expected ||
    'apiToken' in body.request
  )
    throw new Error('invalid_request');
  return body;
}

/** Internal-only provider I/O process; no model token is accepted in the HTTP body. */
export function createAiInferenceServer(options: {
  pool: Pick<Pool, 'query'>;
  secret: string;
  secrets?: AiModelSecrets;
  completion?: (input: ChatCompletionInput) => Promise<ChatCompletionResult>;
  maxConcurrency?: number;
}) {
  if (options.secret.length < 32)
    throw new Error('AI_INFERENCE_SHARED_SECRET must be at least 32 characters');
  const secrets = options.secrets ?? new AiModelSecrets();
  const completion = options.completion ?? completeChat;
  const maxConcurrency = options.maxConcurrency ?? 10;
  if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 100)
    throw new Error('Invalid AI inference concurrency limit');
  let active = 0;
  const server = createServer(async (req, res) => {
    const path = (req.url ?? '').split('?')[0];
    if (req.method === 'GET' && path === '/health/live') {
      reply(res, 200, { status: 'ok', service: 'ai-inference' });
      return;
    }
    if (req.method === 'GET' && path === '/health/ready') {
      try {
        await options.pool.query('SELECT 1');
        reply(res, 200, {
          status: 'ok',
          service: 'ai-inference',
          active,
          maxConcurrency,
          saturated: active >= maxConcurrency,
        });
      } catch {
        reply(res, 503, { status: 'unavailable', service: 'ai-inference' });
      }
      return;
    }
    if (req.method !== 'POST' || path !== '/complete') {
      reply(res, 404, { error: 'NOT_FOUND' });
      return;
    }
    if (!authorized(req, options.secret)) {
      reply(res, 401, { error: 'AUTHN:UNAUTHORIZED' });
      return;
    }
    if (active >= maxConcurrency) {
      reply(res, 503, { error: 'AI_INFERENCE_BUSY' });
      return;
    }
    active += 1;
    let providerStarted = false;
    try {
      const body = await readRequest(req);
      const model = (
        await options.pool.query<ModelRow>(
          'SELECT provider_type,base_url,model_name,api_token,is_enabled,last_test_status FROM ai_models WHERE id=$1',
          [body.modelId]
        )
      ).rows[0];
      if (
        !model ||
        model.is_enabled !== true ||
        model.last_test_status !== 'passed' ||
        model.provider_type !== body.expected.providerType ||
        model.base_url !== body.expected.baseUrl ||
        model.model_name !== body.expected.modelName
      ) {
        reply(res, 409, { error: 'AI_MODEL_CHANGED' });
        return;
      }
      const apiToken = model.api_token ? secrets.decryptToken(model.api_token) : null;
      providerStarted = true;
      const result = await completion({
        providerType: model.provider_type,
        baseUrl: model.base_url,
        modelName: model.model_name,
        apiToken,
        messages: body.request.messages,
        temperature: body.request.temperature,
        maxTokens: body.request.maxTokens,
      });
      reply(res, 200, result);
    } catch (error) {
      if (error instanceof Error && error.message === 'request_too_large')
        reply(res, 413, { error: 'VALIDATION:INPUT:INVALID' });
      else if (
        error instanceof SyntaxError ||
        (error instanceof Error && error.message === 'invalid_request')
      )
        reply(res, 400, { error: 'VALIDATION:INPUT:INVALID' });
      else if (providerStarted) reply(res, 502, { error: 'AI_INFERENCE_PROVIDER_FAILED' });
      else reply(res, 503, { error: 'AI_INFERENCE_UNAVAILABLE' });
    } finally {
      active -= 1;
    }
  });
  server.requestTimeout = 30_000;
  return server;
}
