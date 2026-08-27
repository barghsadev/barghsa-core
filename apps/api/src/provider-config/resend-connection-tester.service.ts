import { Injectable, Inject, Logger, Optional } from '@nestjs/common'
import type { ResendConfig } from './resend-config.schema'

/**
 * Live Resend connection tester (E-05, T-05.06.03).
 *
 * Validates the configured sending domain is verified in the target Resend
 * account, then sends a real test email to the admin's address through the
 * Resend HTTP API (`POST /emails`). Results are safe, non-secret success or
 * failure diagnostics; the API key is never surfaced.
 */

export interface ResendTestResult {
  ok: boolean
  /** Safe, non-secret human-readable error when `ok` is false. */
  error?: string
}

/** A domain record returned by the Resend `/domains` endpoint. */
export interface ResendDomainRecord {
  id: string
  name: string
  status: string
}

/** Shape of the Resend `/emails` POST response. */
export interface ResendEmailResponse {
  /** Present on success. */
  id?: string
  /** Provider error message (Resend returns `message`, sometimes nested). */
  message?: string
}

/**
 * Minimal Resend REST client surface. Injected so tests can override it without
 * real credentials (`RESEND_API_CLIENT`).
 */
export interface ResendApiClientLike {
  listDomains: (apiKey: string) => Promise<ResendDomainRecord[]>
  sendEmail: (
    apiKey: string,
    payload: { from: string; to: string; subject: string; text?: string },
  ) => Promise<ResendEmailResponse>
}

/** Injection token to override the Resend HTTP client (used by tests). */
export const RESEND_API_CLIENT = Symbol('RESEND_API_CLIENT')

const RESEND_API_BASE = 'https://api.resend.com'

const defaultApiClient: ResendApiClientLike = {
  async listDomains(apiKey) {
    const res = await fetch(`${RESEND_API_BASE}/domains`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      throw new Error(await safeApiError(res, 'listing domains'))
    }
    const body = (await res.json()) as { data?: ResendDomainRecord[] }
    return body.data ?? []
  },
  async sendEmail(apiKey, payload) {
    const res = await fetch(`${RESEND_API_BASE}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    })
    if (res.status === 200 || res.status === 201) {
      const body = (await res.json()) as { id?: string }
      return body.id ? { id: body.id } : {}
    }
    return await safeApiError(res, 'sending test email').then((msg) => ({ message: msg }))
  },
}

/** Extract a safe error message from a non-2xx Resend response. */
async function safeApiError(res: Response, action?: string): Promise<string> {
  let detail = ''
  try {
    const body = (await res.json()) as { message?: string }
    detail = body.message ?? ''
  } catch {
    /* non-JSON error body */
  }
  const prefix = action ? `${action}` : 'Resend request'
  return `${prefix} failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}`
}

/** Strip the API key credential material that Resend may echo back. */
function redactApiKey(message: string, apiKey: string): string {
  if (!apiKey) return message
  return message.split(apiKey).join('••••')
}

@Injectable()
export class ResendConnectionTesterService {
  private readonly logger = new Logger(ResendConnectionTesterService.name)
  private readonly client: ResendApiClientLike

  constructor(
    @Optional()
    @Inject(RESEND_API_CLIENT)
    injectedClient?: ResendApiClientLike,
  ) {
    this.client = injectedClient ?? defaultApiClient
  }

  /** Domain to verify: explicit `sending_domain`, else the `from_email` domain. */
  private targetDomain(config: ResendConfig): string {
    if (config.sending_domain?.trim()) return config.sending_domain.trim()
    const at = config.from_email.lastIndexOf('@')
    return at >= 0 ? config.from_email.slice(at + 1) : config.from_email
  }

  /**
   * Validate domain verification, then send a real test email through Resend to
   * the admin's address. Never throws; returns a safe, non-secret result.
   */
  async test(config: ResendConfig, recipient: string): Promise<ResendTestResult> {
    const domain = this.targetDomain(config)

    // 1. Validate domain verification.
    let domains: ResendDomainRecord[]
    try {
      domains = await this.client.listDomains(config.api_key)
    } catch (err) {
      const message = redactApiKey((err as Error).message, config.api_key)
      this.logger.warn(`Resend domain lookup failed for ${domain}: ${message}`)
      return { ok: false, error: `Could not verify sending domain: ${message}` }
    }
    const match = domains.find((d) => d.name.toLowerCase() === domain.toLowerCase())
    if (!match) {
      return {
        ok: false,
        error: `Sending domain "${domain}" is not registered in this Resend account.`,
      }
    }
    if (match.status !== 'verified') {
      return {
        ok: false,
        error: `Sending domain "${domain}" is not verified yet (status: ${match.status}). Complete DNS verification in Resend first.`,
      }
    }

    // 2. Send a real test email to the admin's address.
    const from = config.from_name?.trim()
      ? `"${config.from_name.trim()}" <${config.from_email}>`
      : config.from_email
    try {
      const result = await this.client.sendEmail(config.api_key, {
        from,
        to: recipient,
        subject: 'Barghsa connection test',
        text: 'This is a test email from Barghsa to confirm the Resend email provider configuration.',
      })
      if (result.id) return { ok: true }
      const message = redactApiKey(result.message ?? 'Resend did not confirm delivery', config.api_key)
      this.logger.warn(`Resend test-send failed: ${message}`)
      return { ok: false, error: message }
    } catch (err) {
      const message = redactApiKey((err as Error).message, config.api_key)
      this.logger.warn(`Resend test-send failed: ${message}`)
      return { ok: false, error: message }
    }
  }
}