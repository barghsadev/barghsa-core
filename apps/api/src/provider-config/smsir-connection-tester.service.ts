import { Injectable, Inject, Optional } from '@nestjs/common'
import type { SmsirConfig } from './smsir-config.schema'

/**
 * SMS.ir connection tester (T-09.06.02).
 *
 * Validates that a draft SMS.ir configuration is structurally sound and that
 * the configured credentials are usable:
 *
 * 1. Config must already parse (`parseSmsirConfig`) — enforced by the caller.
 * 2. Credentials must be non-empty and the sender line present.
 * 3. When a live SMS.ir API client is available, a low-cost account check is
 *    performed (e.g. GET the account credit) to prove the API key works and
 *    that the `low_credit_threshold` semantics are meaningful.
 *
 * The SMS.ir base URL is application-managed via `SMSIR_API_BASE` (defaults to
 * `https://api.sms.ir`) and is NOT admin-configurable, so a malicious or buggy
 * admin payload cannot redirect requests to an arbitrary endpoint.
 *
 * Results are safe, non-secret success/failure diagnostics; the API key is
 * never surfaced.
 */

export interface SmsirTestResult {
  ok: boolean
  /** Safe, non-secret human-readable error when `ok` is false. */
  error?: string
}

/** An SMS.ir account/credit info response (non-secret). */
export interface SmsirCreditResponse {
  credit?: number
  message?: string
}

/** Minimal SMS.ir REST client surface. Injected so tests can override it. */
export interface SmsirApiClientLike {
  getCredit: (apiKey: string, baseUrl: string) => Promise<SmsirCreditResponse>
}

/** Injection token to override the SMS.ir HTTP client (used by tests). */
export const SMSIR_API_CLIENT = Symbol('SMSIR_API_CLIENT')

export const SMSIR_API_BASE_ENV = 'SMSIR_API_BASE'
const DEFAULT_SMSIR_BASE = 'https://api.sms.ir'
const REQUEST_TIMEOUT_MS = 15_000

const defaultApiClient: SmsirApiClientLike = {
  async getCredit(apiKey, baseUrl) {
    const res = await fetch(`${baseUrl}/api/credit`, {
      headers: {
        'x-api-key': apiKey,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (res.status === 200 || res.status === 201) {
      const body = (await res.json()) as SmsirCreditResponse
      return body
    }
    return { message: await safeApiError(res) }
  },
}

async function safeApiError(res: Response): Promise<string> {
  let detail = ''
  try {
    const body = (await res.json()) as { message?: string; detail?: string }
    detail = body.detail ?? body.message ?? ''
  } catch {
    /* non-JSON error body */
  }
  return `SMS.ir request failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}`
}

@Injectable()
export class SmsirConnectionTesterService {
  private readonly client: SmsirApiClientLike

  constructor(
    @Optional()
    @Inject(SMSIR_API_CLIENT)
    injectedClient?: SmsirApiClientLike,
  ) {
    this.client = injectedClient ?? defaultApiClient
  }

  /** Resolve the application-managed SMS.ir base URL (not admin-editable). */
  private baseUrl(): string {
    const env = typeof process !== 'undefined' ? (process.env[SMSIR_API_BASE_ENV] ?? '') : ''
    return env.trim() || DEFAULT_SMSIR_BASE
  }

  /**
   * Run the connection test. Local config validation always runs; the live
   * credential check runs only when a real client is wired. Tester never
   * throws; returns a safe, non-secret result.
   */
  async test(config: SmsirConfig): Promise<SmsirTestResult> {
    // 1. Credential presence (structural integrity).
    if (!config.api_key || config.api_key.trim().length === 0) {
      return { ok: false, error: 'SMS.ir API key is missing' }
    }
    if (!config.sender || config.sender.trim().length === 0) {
      return { ok: false, error: 'SMS.ir sender/line number is missing' }
    }

    // 2. Live credential check.
    try {
      const credit = await this.client.getCredit(config.api_key, this.baseUrl())
      if (credit.message && !credit.message.toLowerCase().includes('ok')) {
        return { ok: false, error: `SMS.ir credential check failed: ${credit.message}` }
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return { ok: false, error: `SMS.ir credential check failed: ${detail}` }
    }

    return { ok: true }
  }
}