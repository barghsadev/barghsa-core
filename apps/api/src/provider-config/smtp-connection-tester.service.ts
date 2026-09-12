import { isTransientEmailError } from '@barghsa/shared/notification-delivery';
import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import nodemailer from 'nodemailer';
import type { SmtpConfig } from './smtp-config.schema';
import { SmtpDestinationBlockedError, SmtpNetworkGuard } from './smtp-network-guard';

/**
 * Live SMTP connection tester (E-05, T-05.06.02).
 *
 * Verifies the SMTP connection, then sends a test email and requires the server
 * to accept its verified staff recipient. A handshake alone is insufficient. The SSRF
 * network guard runs first so private/internal destinations are rejected before
 * any socket is opened unless the deployment allow-list exempts them.
 */

export interface SmtpTestResult {
  ok: boolean;
  /** Safe, non-secret human-readable error when `ok` is false. */
  error?: string;
  transient?: boolean;
}

/** Shape minimally exposed by a transport so tests can inject a fake. */
export interface SmtpTransportLike {
  verify: () => Promise<boolean>;
  sendMail: (
    message: nodemailer.SendMailOptions
  ) => Promise<{ accepted?: unknown[]; rejected?: unknown[] }>;
  close?: () => void;
}

export type SmtpTransportFactory = (config: SmtpConfig, checkedHost: string) => SmtpTransportLike;

/** Injection token to override the nodemailer builder (used by tests). */
export const SMTP_TRANSPORT_FACTORY = Symbol('SMTP_TRANSPORT_FACTORY');

/** Injection token to override the SSRF guard (used by tests). */
export const SMTP_NETWORK_GUARD = Symbol('SMTP_NETWORK_GUARD');

const defaultTransportFactory: SmtpTransportFactory = (config, checkedHost) => {
  const implicitTls = config.security === 'TLS';
  return nodemailer.createTransport({
    host: checkedHost,
    port: config.port,
    // 'TLS'  -> implicit TLS tunnel on connect.
    // 'STARTTLS' -> plaintext then upgrade (secure:false + requireTLS).
    secure: implicitTls,
    requireTLS: !implicitTls,
    tls: { servername: config.host, minVersion: 'TLSv1.2' },
    connectionTimeout: config.connection_timeout * 1000,
    greetingTimeout: config.connection_timeout * 1000,
    socketTimeout: config.command_timeout * 1000,
    ...(config.username || config.password
      ? { auth: { user: config.username ?? '', pass: config.password ?? '' } }
      : {}),
  });
};

/** Strip credential material that nodemailer may embed in an error message. */
function sanitizeError(err: unknown, config: SmtpConfig): string {
  let message = err instanceof Error ? err.message : String(err);
  if (config.password) message = message.split(config.password).join('••••');
  if (config.username) message = message.split(config.username).join('***');
  const trimmed = message.slice(0, 1000);
  return trimmed || 'SMTP handshake failed';
}

@Injectable()
export class SmtpConnectionTesterService {
  private readonly logger = new Logger(SmtpConnectionTesterService.name);
  private readonly guard: SmtpNetworkGuard;

  constructor(
    @Optional()
    @Inject(SMTP_TRANSPORT_FACTORY)
    private readonly transportFactory?: SmtpTransportFactory,
    @Optional()
    @Inject(SMTP_NETWORK_GUARD)
    injectedGuard?: SmtpNetworkGuard
  ) {
    this.guard = injectedGuard ?? new SmtpNetworkGuard();
  }

  /** Verify SMTP and send to the staff contact already checked by the caller. */
  async test(
    config: SmtpConfig,
    recipient: string,
    beforeSend?: () => Promise<void>
  ): Promise<SmtpTestResult> {
    if (!recipient?.trim())
      return { ok: false, error: 'A verified recipient is required for the SMTP test' };
    // SSRF guard first: never dial a private/internal destination unless allowed.
    let checkedHost: string;
    try {
      checkedHost = await this.guard.resolveAllowedHost(config.host);
    } catch (err) {
      if (err instanceof SmtpDestinationBlockedError) {
        return { ok: false, error: err.detail };
      }
      return { ok: false, error: (err as Error).message, transient: isTransientEmailError(err) };
    }

    const factory = this.transportFactory ?? defaultTransportFactory;
    const transport = factory(config, checkedHost);
    try {
      const verified = await transport.verify();
      if (!verified) return { ok: false, error: 'SMTP verification returned no confirmation' };
      await beforeSend?.();
      const result = await transport.sendMail({
        from: config.from_name?.trim()
          ? { name: config.from_name.trim(), address: config.from_email }
          : config.from_email,
        to: recipient,
        ...(config.reply_to ? { replyTo: config.reply_to } : {}),
        subject: 'Barghsa connection test',
        text: 'This is a test email from Barghsa to confirm the SMTP email provider configuration.',
      });
      const accepted = result.accepted?.some((value) => {
        const address =
          typeof value === 'string'
            ? value
            : value && typeof value === 'object' && 'address' in value
              ? value.address
              : null;
        return (
          typeof address === 'string' &&
          address.trim().toLowerCase() === recipient.trim().toLowerCase()
        );
      });
      return accepted && !result.rejected?.length
        ? { ok: true }
        : { ok: false, error: 'SMTP server did not accept the test recipient' };
    } catch (err) {
      const message = sanitizeError(err, config);
      this.logger.warn(`SMTP connection test failed for ${config.host}: ${message}`);
      return { ok: false, error: message, transient: isTransientEmailError(err) };
    } finally {
      transport.close?.();
    }
  }
}
