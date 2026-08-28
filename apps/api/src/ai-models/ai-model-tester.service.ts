import { Injectable, Inject, Optional } from '@nestjs/common'
import { isBlockedIp } from '../provider-config/smtp-network-guard.js'
import { isIP } from 'node:net'
import { promises as dns } from 'node:dns'

/**
 * AI model connection tester (S-09.11, T-09.11.01).
 *
 * The admin "Test" button runs a minimal request against the configured
 * provider and returns a short response preview. The request is shaped by
 * the wire-protocol family:
 *
 * - `openai_compatible` — POST `{baseUrl}/chat/completions` with
 *   `Authorization: Bearer <token>` and a 1-token completion body.
 * - `anthropic` — POST `{baseUrl}/messages` with `x-api-key: <token>` and
 *   `anthropic-version: 2023-06-01`, body `max_tokens: 1`.
 *
 * Security posture (mirrors the SMTP/Resend/SMS.ir connection testers):
 * - SSRF guard: the base URL host is resolved and checked against
 *   private/reserved ranges before any request is attempted. A deployment
 *   allow-list (`AI_MODEL_BASE_URL_ALLOWLIST`) explicitly opts hosts out of
 *   the block (e.g. a local Ollama endpoint in development).
 * - The base URL must be http(s); other schemes are refused.
 * - Results carry only safe, non-secret diagnostics: HTTP status, a
 *   truncated provider error string, and the parsed response text preview.
 *   The API token is never surfaced, and error bodies are trimmed before
 *   they reach a log/UI.
 * - A hard timeout aborts the ping (default 15s,
 *   `AI_MODEL_TEST_TIMEOUT_MS`).
 *
 * The tester is a plain class usable by either process: the API runs it
 * synchronously for the admin test button today (same as the provider
 * connection testers), and the worker can call the same `ping()` when a
 * background reachability sweep is added.
 */

export const AI_MODEL_PROVIDER_TYPES = ['openai_compatible', 'anthropic'] as const

export type AiModelProviderType = (typeof AI_MODEL_PROVIDER_TYPES)[number]

/** Input to a connection test — fully resolved model credentials. */
export interface AiModelTestInput {
  providerType: AiModelProviderType
  baseUrl: string
  modelName: string
  /** Decrypted token; null for token-less local endpoints. */
  apiToken: string | null
}

/** Safe, non-secret connection-test outcome. */
export interface AiModelTestResult {
  ok: boolean
  /** Safe human-readable error when `ok` is false (never secrets). */
  error?: string
  /** Truncated model response text shown in the admin UI on success. */
  responsePreview?: string
  /** Round-trip latency of the request in milliseconds. */
  latencyMs: number
}

/** Result of a raw provider HTTP call, as seen by the tolerance layer. */
interface WireResponse {
  status: number
  bodyText: string
}

/** Injectable HTTP client surface (tests override it). */
export interface AiModelApiClientLike {
  request(
    input: AiModelTestInput,
    timeoutMs: number,
  ): Promise<WireResponse>
}

/** Injection token to override the HTTP client (used by tests). */
export const AI_MODEL_API_CLIENT = Symbol('AI_MODEL_API_CLIENT')

export const AI_MODEL_TEST_TIMEOUT_ENV = 'AI_MODEL_TEST_TIMEOUT_MS'
export const AI_MODEL_ALLOWLIST_ENV = 'AI_MODEL_BASE_URL_ALLOWLIST'
const DEFAULT_TIMEOUT_MS = 15_000
/** Response-preview length cap (protects the UI and logs from huge bodies). */
const PREVIEW_MAX_CHARS = 300
/** Provider error-message cap (never echo unbounded response bodies). */
const ERROR_MAX_CHARS = 300

const defaultApiClient: AiModelApiClientLike = {
  async request(input, timeoutMs) {
    const { url, headers, body } = buildRequest(input)
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    return { status: res.status, bodyText: await res.text() }
  },
}

function buildRequest(input: AiModelTestInput): {
  url: string
  headers: Record<string, string>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: Record<string, any>
} {
  const base = input.baseUrl.trim().replace(/\/+$/, '')
  if (input.providerType === 'anthropic') {
    return {
      url: `${base}/messages`,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-api-key': input.apiToken ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: {
        model: input.modelName,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      },
    }
  }
  // openai_compatible (default)
  return {
    url: `${base}/chat/completions`,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(input.apiToken ? { authorization: `Bearer ${input.apiToken}` } : {}),
    },
    body: {
      model: input.modelName,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
      stream: false,
    },
  }
}

/**
 * Extract a short human-readable preview from a successful provider
 * response. Returns undefined when the body carries no usable text.
 */
function extractPreview(providerType: AiModelProviderType, bodyText: string): string | undefined {
  if (!bodyText) return undefined
  try {
    const body = JSON.parse(bodyText) as {
      choices?: Array<{ message?: { content?: unknown } }>
      content?: Array<{ text?: unknown }>
    }
    if (providerType === 'anthropic') {
      const first = body.content?.[0]?.text
      if (typeof first === 'string' && first.length > 0) return first.slice(0, PREVIEW_MAX_CHARS)
    } else {
      const first = body.choices?.[0]?.message?.content
      if (typeof first === 'string' && first.length > 0) return first.slice(0, PREVIEW_MAX_CHARS)
    }
  } catch {
    // Non-JSON body — fall through to prefix of raw text.
  }
  const trimmed = bodyText.trim()
  return trimmed.length > 0 ? trimmed.slice(0, PREVIEW_MAX_CHARS) : undefined
}

/**
 * Extract a safe, truncated provider error message from a failure body.
 * Only JSON `error.message` / `message` fields are trusted; raw non-JSON
 * bodies are NOT echoed (a misbehaving provider could echo the token back
 * in a plain-text body).
 */
function extractErrorDetail(bodyText: string): string {
  if (!bodyText) return ''
  try {
    const body = JSON.parse(bodyText) as {
      error?: { message?: unknown } | string
      message?: unknown
    }
    const msg =
      typeof body.error === 'string'
        ? body.error
        : typeof body.error?.message === 'string'
          ? body.error.message
          : typeof body.message === 'string'
            ? body.message
            : ''
    return msg.slice(0, ERROR_MAX_CHARS)
  } catch {
    return ''
  }
}

@Injectable()
export class AiModelTesterService {
  private readonly client: AiModelApiClientLike

  constructor(
    @Optional()
    @Inject(AI_MODEL_API_CLIENT)
    injectedClient?: AiModelApiClientLike,
  ) {
    this.client = injectedClient ?? defaultApiClient
  }

  /** Resolve the ping timeout from env (bounded to [1s, 60s]). */
  private timeoutMs(): number {
    const raw = typeof process !== 'undefined' ? (process.env[AI_MODEL_TEST_TIMEOUT_ENV] ?? '') : ''
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS
    return Math.min(Math.max(parsed, 1_000), 60_000)
  }

  /** Resolve the deployment allow-list of base-URL hosts. */
  private allowlist(): readonly string[] {
    const raw = typeof process !== 'undefined' ? (process.env[AI_MODEL_ALLOWLIST_ENV] ?? '') : ''
    return raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  }

  /**
   * Run the connection test. Never throws; returns a safe result with a
   * truncated preview on success. The request is only attempted after the
   * SSRF guard accepts the base-URL host.
   */
  async test(input: AiModelTestInput): Promise<AiModelTestResult> {
    const started = Date.now()

    // 1. Structural integrity.
    if (!input.baseUrl || input.baseUrl.trim().length === 0) {
      return { ok: false, error: 'Base URL is missing', latencyMs: 0 }
    }
    if (!input.modelName || input.modelName.trim().length === 0) {
      return { ok: false, error: 'Model name is missing', latencyMs: 0 }
    }

    // 2. Scheme + SSRF guard (host resolves to a public address, or is
    //    explicitly allow-listed by the deployment).
    let url: URL
    try {
      url = new URL(input.baseUrl)
    } catch {
      return { ok: false, error: 'Base URL is not a valid URL', latencyMs: 0 }
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, error: 'Base URL must use http(s)', latencyMs: 0 }
    }
    const blocked = await this.guardHost(url.hostname)
    if (blocked) {
      return { ok: false, error: `Base URL host is not allowed: ${blocked}`, latencyMs: 0 }
    }

    // 3. Fire the ping.
    try {
      const wire = await this.client.request(input, this.timeoutMs())
      const latencyMs = Date.now() - started
      if (wire.status >= 200 && wire.status < 300) {
        const preview = extractPreview(input.providerType, wire.bodyText)
        const result: AiModelTestResult = { ok: true, latencyMs }
        if (preview !== undefined) result.responsePreview = preview
        return result
      }
      const detail = extractErrorDetail(wire.bodyText)
      return {
        ok: false,
        error: `Provider request failed (HTTP ${wire.status})${detail ? `: ${detail}` : ''}`,
        latencyMs,
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      const latencyMs = Date.now() - started
      return {
        ok: false,
        error: `Provider request failed: ${safeErrorDetail(detail)}`,
        latencyMs,
      }
    }
  }

  /**
   * SSRF guard. Returns a human-readable reason when `host` is blocked,
   * or null when the host may be dialed. Allow-listed hosts bypass the
   * private-range check.
   */
  private async guardHost(host: string): Promise<string | null> {
    const h = host.trim().toLowerCase().replace(/\.$/, '')
    if (!h) return 'empty host'
    const allowlist = this.allowlist()
    if (allowlist.includes(h)) return null
    let ips: string[]
    try {
      ips = isIP(h) !== 0 ? [h] : (await dns.lookup(h, { all: true, verbatim: true })).map((r) => r.address)
    } catch (err) {
      return `host could not be resolved: ${safeErrorDetail((err as Error).message)}`
    }
    if (ips.length === 0) return 'host resolved to no addresses'
    const blocked = ips.find(isBlockedIp)
    if (blocked !== undefined) return `resolves to blocked address ${blocked}`
    return null
  }
}

/** Trim/cap an arbitrary error string so secrets and huge bodies never leak. */
function safeErrorDetail(detail: string): string {
  return detail.slice(0, ERROR_MAX_CHARS)
}