import { Injectable, Inject, Logger, Optional } from '@nestjs/common'
import nodemailer from 'nodemailer'
import type { SmtpConfig } from './smtp-config.schema'
import {
  SmtpDestinationBlockedError,
  SmtpNetworkGuard,
} from './smtp-network-guard'

/**
 * Live SMTP connection tester (E-05, T-05.06.02).
 *
 * Performs an actual SMTP handshake against the configured host using
 * `nodemailer`'s `transport.verify()`, which issues CONNECT → EHLO → (AUTH when
 * credentials are provided) and reports a granular success/failure. The SSRF
 * network guard runs first so private/internal destinations are rejected before
 * any socket is opened unless the deployment allow-list exempts them.
 */

export interface SmtpTestResult {
  ok: boolean
  /** Safe, non-secret human-readable error when `ok` is false. */
  error?: string
}

/** Shape minimally exposed by a transport so tests can inject a fake. */
export interface SmtpTransportLike {
  verify: () => Promise<boolean>
  close?: () => void
}

export type SmtpTransportFactory = (config: SmtpConfig) => SmtpTransportLike

/** Injection token to override the nodemailer builder (used by tests). */
export const SMTP_TRANSPORT_FACTORY = Symbol('SMTP_TRANSPORT_FACTORY')

/** Injection token to override the SSRF guard (used by tests). */
export const SMTP_NETWORK_GUARD = Symbol('SMTP_NETWORK_GUARD')

const defaultTransportFactory: SmtpTransportFactory = (config) => {
  const implicitTls = config.security === 'TLS'
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    // 'TLS'  -> implicit TLS tunnel on connect.
    // 'STARTTLS' -> plaintext then upgrade (secure:false + requireTLS).
    secure: implicitTls,
    requireTLS: !implicitTls,
    connectionTimeout: config.connection_timeout * 1000,
    greetingTimeout: config.connection_timeout * 1000,
    socketTimeout: config.command_timeout * 1000,
    ...(config.username || config.password
      ? { auth: { user: config.username ?? '', pass: config.password ?? '' } }
      : {}),
  })
}

/** Strip credential material that nodemailer may embed in an error message. */
function sanitizeError(err: unknown, config: SmtpConfig): string {
  let message = err instanceof Error ? err.message : String(err)
  if (config.password) message = message.split(config.password).join('••••')
  if (config.username) message = message.split(config.username).join('***')
  const trimmed = message.slice(0, 1000)
  return trimmed || err instanceof Error ? message : 'SMTP handshake failed'
}

@Injectable()
export class SmtpConnectionTesterService {
  private readonly logger = new Logger(SmtpConnectionTesterService.name)
  private readonly guard: SmtpNetworkGuard

  constructor(
    @Optional()
    @Inject(SMTP_TRANSPORT_FACTORY)
    private readonly transportFactory?: SmtpTransportFactory,
    @Optional()
    @Inject(SMTP_NETWORK_GUARD)
    injectedGuard?: SmtpNetworkGuard,
  ) {
    this.guard = injectedGuard ?? new SmtpNetworkGuard()
  }

  /** Validate + run the live SMTP handshake; never throws for connection errors. */
  async test(config: SmtpConfig): Promise<SmtpTestResult> {
    // SSRF guard first: never dial a private/internal destination unless allowed.
    try {
      await this.guard.assertHostAllowed(config.host)
    } catch (err) {
      if (err instanceof SmtpDestinationBlockedError) {
        return { ok: false, error: err.detail }
      }
      return { ok: false, error: (err as Error).message }
    }

    const factory = this.transportFactory ?? defaultTransportFactory
    const transport = factory(config)
    try {
      const verified = await transport.verify()
      if (verified) return { ok: true }
      return { ok: false, error: 'SMTP verification returned no confirmation' }
    } catch (err) {
      const message = sanitizeError(err, config)
      this.logger.warn(`SMTP connection test failed for ${config.host}: ${message}`)
      return { ok: false, error: message }
    } finally {
      transport.close?.()
    }
  }
}
