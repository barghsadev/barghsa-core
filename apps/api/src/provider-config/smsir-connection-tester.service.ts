import { Injectable, Inject, Optional } from '@nestjs/common'
import type { SmsirConfig } from './smsir-config.schema'

/**
 * SMS.ir connection tester (T-09.06.02).
 *
 * Validates that a draft SMS.ir configuration is structurally sound and that
 * the configured credentials are usable:
 *
 * 1. Config must already parse (`parseSmsirConfig`) — enforced by the caller.
 * 2. Credentials must be non-empty and the sender (line number) present.
 * 3. A low-cost account credit check proves the API key works.
 * 4. When a recipient mobile number is supplied (the admin's verified mobile),
 *    a live test-send is performed through the mapped SMS.ir template via the
 *    verify-code endpoint (`POST /v1/send/verify`). A successful send proves
 *    BOTH that the template Id exists AND that the mapped variables are
 *    accepted by the template — this is the acceptance criterion "Activation
 *    validates template IDs and variable availability".
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

/** Outcome of an SMS.ir verify-code (template) send attempt. */
export interface SmsirSendVerifyResponse {
  /** Present on success (SMS.ir message id). */
  message_id?: number | string
  /** Provider error message on failure. */
  message?: string
}

/** One parameter substitution for a template send: SMS.ir param name -> value. */
export interface SmsirTemplateParameter {
  name: string
  value: string | number
}

/**
 * Payload for the SMS.ir verify-code endpoint (`POST /v1/send/verify`):
 * `mobile_number`, `template_id`, and the template parameters as name/value
 * pairs — the keys MUST match the parameter names declared on the SMS.ir
 * template, so a successful send doubles as template/variable validation.
 */
export interface SmsirSendVerifyPayload {
  mobile_number: string
  template_id: string
  parameters: SmsirTemplateParameter[]
}

/** Minimal SMS.ir REST client surface. Injected so tests can override it. */
export interface SmsirApiClientLike {
  getCredit: (apiKey: string, baseUrl: string) => Promise<SmsirCreditResponse>
  sendVerifyCode: (
    apiKey: string,
    baseUrl: string,
    payload: SmsirSendVerifyPayload,
  ) => Promise<SmsirSendVerifyResponse>
}

/** Injection token to override the SMS.ir HTTP client (used by tests). */
export const SMSIR_API_CLIENT = Symbol('SMSIR_API_CLIENT')

export const SMSIR_API_BASE_ENV = 'SMSIR_API_BASE'
const DEFAULT_SMSIR_BASE = 'https://api.sms.ir'
const REQUEST_TIMEOUT_MS = 15_000

const defaultApiClient: SmsirApiClientLike = {
  async getCredit(apiKey, baseUrl) {
    const res = await fetch(`${baseUrl}/v1/credit`, {
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
  async sendVerifyCode(apiKey, baseUrl, payload) {
    const res = await fetch(`${baseUrl}/v1/send/verify`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (res.status === 200 || res.status === 201) {
      const body = (await res.json()) as SmsirSendVerifyResponse
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
   * credential check runs only when a real client is wired. When `recipient`
   * (the admin's verified mobile) is supplied, a live test-send is performed
   * through the mapped SMS.ir template, which validates the template Id and
   * its variable names against the actual SMS.ir template. Tester never
   * throws; returns a safe, non-secret result.
   *
   * @param config validated SmsirConfig
   * @param recipient optional admin mobile number to receive a real test SMS
   * @param eventKey optional mapped event to send; falls back to the first mapping
   */
  async test(
    config: SmsirConfig,
    recipient?: string,
    eventKey?: string,
  ): Promise<SmsirTestResult> {
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

    // 3. Template mapping sanity (none required for a bare credential test).
    const mappings = config.template_mappings ?? []
    const badMapping = mappings.find(
      (m) => !m.template_id || m.template_id.trim().length === 0,
    )
    if (badMapping) {
      return {
        ok: false,
        error: `SMS.ir template mapping for event "${badMapping.event_key}" has no template_id`,
      }
    }

    // 4. Live test-send: validates the mapped template id + variable names
    // against the real SMS.ir template (acceptance criterion "Activation
    // validates template IDs and variable availability").
    if (recipient && recipient.trim().length > 0) {
      const target = eventKey
        ? mappings.find((m) => m.event_key === eventKey)
        : mappings[0]
      if (!target) {
        return {
          ok: false,
          error: eventKey
            ? `No SMS.ir template mapping exists for event "${eventKey}"`
            : 'No SMS.ir template mapping exists to test-send against',
        }
      }
      const variables = Object.entries(target.variables ?? {}).map(
        ([internal, smsirName]) => ({ name: smsirName, value: `test-${internal}` }) as const,
      )
      try {
        const outcome = await this.client.sendVerifyCode(config.api_key, this.baseUrl(), {
          mobile_number: recipient.trim(),
          template_id: target.template_id,
          parameters: variables,
        })
        if (outcome.message && !String(outcome.message_id ?? '').match(/\d+/)) {
          return { ok: false, error: `SMS.ir test-send failed: ${outcome.message}` }
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        return { ok: false, error: `SMS.ir test-send failed: ${detail}` }
      }
    }

    return { ok: true }
  }
}
