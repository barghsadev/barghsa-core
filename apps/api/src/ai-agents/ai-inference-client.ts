import { HttpException } from '@nestjs/common';
import {
  completeChat,
  type ChatCompletionInput,
  type ChatCompletionResult,
} from '@barghsa/shared/ai-models';

function unavailable(): HttpException {
  return new HttpException({ statusCode: 503, error: 'AI_INFERENCE_UNAVAILABLE' }, 503);
}

function validResult(value: unknown): value is ChatCompletionResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  const usage = result.tokenUsage;
  return (
    typeof result.reply === 'string' &&
    result.reply.trim().length > 0 &&
    result.reply.length <= 32_000 &&
    (usage === null ||
      (typeof usage === 'object' &&
        usage !== null &&
        Number.isSafeInteger((usage as Record<string, unknown>).input) &&
        Number((usage as Record<string, unknown>).input) >= 0 &&
        Number.isSafeInteger((usage as Record<string, unknown>).output) &&
        Number((usage as Record<string, unknown>).output) >= 0))
  );
}

/** Provider I/O lives in the dedicated AI process whenever it is configured. */
export async function completeViaAiWorker(
  modelId: string,
  input: ChatCompletionInput
): Promise<ChatCompletionResult> {
  const base = process.env.AI_INFERENCE_URL;
  if (!base && process.env.NODE_ENV === 'test') return completeChat(input);
  const secret = process.env.AI_INFERENCE_SHARED_SECRET;
  if (!base || !secret) throw unavailable();
  let url: URL;
  try {
    url = new URL('/complete', base);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid scheme');
  } catch {
    throw unavailable();
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ai-inference-token': secret },
      body: JSON.stringify({
        modelId,
        expected: {
          providerType: input.providerType,
          baseUrl: input.baseUrl,
          modelName: input.modelName,
        },
        request: {
          messages: input.messages,
          temperature: input.temperature,
          maxTokens: input.maxTokens,
        },
      }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    throw unavailable();
  }
  if (response.status === 503) {
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    if (body?.error === 'AI_INFERENCE_BUSY')
      throw new HttpException({ statusCode: 503, error: 'AI_INFERENCE_BUSY' }, 503);
    throw unavailable();
  }
  if (response.status === 502) throw new Error('ai_completion_provider_unavailable');
  if (response.status !== 200) throw unavailable();
  const body = await response.json().catch(() => null);
  if (!validResult(body)) throw unavailable();
  return body;
}

export function isAiInfrastructureError(error: unknown): boolean {
  if (!(error instanceof HttpException)) return false;
  const body = error.getResponse();
  return (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    (body.error === 'AI_INFERENCE_BUSY' || body.error === 'AI_INFERENCE_UNAVAILABLE')
  );
}

export async function readAiWorkerHealth(): Promise<{
  status: 'ok' | 'unavailable';
  active: number | null;
  maxConcurrency: number | null;
  saturated: boolean | null;
}> {
  const base = process.env.AI_INFERENCE_URL;
  const unavailable = {
    status: 'unavailable' as const,
    active: null,
    maxConcurrency: null,
    saturated: null,
  };
  if (!base) return unavailable;
  try {
    const response = await fetch(new URL('/health/ready', base), {
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) return unavailable;
    const body = (await response.json()) as Record<string, unknown>;
    if (
      body.status !== 'ok' ||
      !Number.isSafeInteger(body.active) ||
      !Number.isSafeInteger(body.maxConcurrency) ||
      typeof body.saturated !== 'boolean'
    )
      return unavailable;
    return {
      status: 'ok',
      active: Number(body.active),
      maxConcurrency: Number(body.maxConcurrency),
      saturated: body.saturated,
    };
  } catch {
    return unavailable;
  }
}
