import type { AiModelProviderType } from './tester.js';
import { guardedRequest } from './guarded-http.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionInput {
  providerType: AiModelProviderType;
  baseUrl: string;
  modelName: string;
  apiToken: string | null;
  messages: ChatMessage[];
  temperature: number;
  maxTokens: number;
}

export interface ChatCompletionResult {
  reply: string;
  tokenUsage: { input: number; output: number } | null;
}

/** Bounded completion call; provider errors and bodies never reach the caller. */
export async function completeChat(input: ChatCompletionInput): Promise<ChatCompletionResult> {
  if (
    !input.modelName.trim() ||
    !input.messages.length ||
    input.messages.length > 22 ||
    input.messages.some((message) => !message.content || message.content.length > 16_000) ||
    !Number.isFinite(input.temperature) ||
    input.temperature < 0 ||
    input.temperature > 2 ||
    !Number.isInteger(input.maxTokens) ||
    input.maxTokens < 1 ||
    input.maxTokens > 8192
  )
    throw new Error('ai_completion_invalid_request');
  const base = input.baseUrl.trim().replace(/\/+$/, '');
  const url = new URL(base);
  if (url.search || url.hash || url.username || url.password)
    throw new Error('ai_completion_invalid_destination');
  const allowlist = (process.env.AI_MODEL_BASE_URL_ALLOWLIST ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const allowHttp = allowlist.some(
    (name) => name.toLowerCase().replace(/\.$/, '') === url.hostname.toLowerCase()
  );
  const anthropic = input.providerType === 'anthropic';
  const body = anthropic
    ? {
        model: input.modelName,
        max_tokens: input.maxTokens,
        temperature: input.temperature,
        system: input.messages
          .filter((message) => message.role === 'system')
          .map((message) => message.content)
          .join('\n\n'),
        messages: input.messages.filter((message) => message.role !== 'system'),
      }
    : {
        model: input.modelName,
        max_tokens: input.maxTokens,
        temperature: input.temperature,
        messages: input.messages,
        stream: false,
      };
  const response = await guardedRequest(`${base}/${anthropic ? 'messages' : 'chat/completions'}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(anthropic
        ? { 'x-api-key': input.apiToken ?? '', 'anthropic-version': '2023-06-01' }
        : input.apiToken
          ? { authorization: `Bearer ${input.apiToken}` }
          : {}),
    },
    body: JSON.stringify(body),
    maxBytes: 1024 * 1024,
    timeoutMs: 20_000,
    allowHttp,
    allowlist,
  });
  if (response.status < 200 || response.status >= 300)
    throw new Error('ai_completion_provider_unavailable');
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(response.body.toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new Error('ai_completion_invalid_response');
  }
  const reply = anthropic
    ? Array.isArray(data.content)
      ? (data.content as Array<{ text?: unknown }>).find(
          (part) => part && typeof part.text === 'string'
        )?.text
      : undefined
    : Array.isArray(data.choices)
      ? (data.choices as Array<{ message?: { content?: unknown } }>)[0]?.message?.content
      : undefined;
  if (typeof reply !== 'string' || !reply.trim() || reply.length > 32_000)
    throw new Error('ai_completion_invalid_response');
  const usage = data.usage as Record<string, unknown> | undefined;
  const inputTokens = anthropic ? usage?.input_tokens : usage?.prompt_tokens;
  const outputTokens = anthropic ? usage?.output_tokens : usage?.completion_tokens;
  const tokenUsage =
    Number.isInteger(inputTokens) &&
    Number(inputTokens) >= 0 &&
    Number.isInteger(outputTokens) &&
    Number(outputTokens) >= 0
      ? { input: Number(inputTokens), output: Number(outputTokens) }
      : null;
  return { reply, tokenUsage };
}
