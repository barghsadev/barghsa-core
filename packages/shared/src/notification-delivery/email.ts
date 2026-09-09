import { EmailCircuitBreaker } from './email-breaker.js';
import { lookup } from 'node:dns/promises';
import { createHash } from 'node:crypto';
import nodemailer from 'nodemailer';
import { z } from 'zod';
import { DeliveryRejected, type DeliveryExecutor } from './execution.js';
import {
  decryptProviderSecret,
  ResendConfigSchema,
  SmtpConfigSchema,
  SmtpNetworkGuard,
} from '../auth-delivery/index.js';

export interface DeliveryPool {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}
export interface EmailMessage {
  destination: string;
  subject: string;
  html?: string;
  text?: string;
  idempotencyKey: string;
  signal?: AbortSignal;
  expectedProviderId?: string;
}

/** Server-only sender shared by queued notifications and staff template tests. */
export function createEmailSender(
  pool: DeliveryPool,
  request: typeof fetch = fetch,
  execute?: DeliveryExecutor
) {
  return async (message: EmailMessage): Promise<string> => {
    if (
      !z.string().email().safeParse(message.destination).success ||
      /[\r\n]/.test(message.subject) ||
      !message.idempotencyKey ||
      (!message.html && !message.text)
    ) {
      throw new Error('Invalid email message');
    }
    message.signal?.throwIfAborted();
    const suppressed = await pool.query(
      'SELECT id FROM email_suppressions WHERE lower(address)=lower($1) LIMIT 1',
      [message.destination]
    );
    if (suppressed.rows.length) throw new Error('Email address suppressed');
    const providers = await pool.query(
      "SELECT id,transport,config FROM email_provider_configs WHERE status='active' AND last_test_status='passed'"
    );
    if (providers.rows.length !== 1) throw new Error('Email provider unavailable');
    const provider = providers.rows[0]!;
    if (message.expectedProviderId && provider.id !== message.expectedProviderId)
      throw new Error('Email provider changed; delivery requires reconciliation');
    if (typeof provider.id !== 'string') throw new Error('Email provider identity unavailable');
    const breaker = new EmailCircuitBreaker(pool);
    const decision = await breaker.decision(provider.id);
    if (!decision.allow) throw new Error('Email provider circuit is open');
    const send = async (): Promise<string> => {
      const signal = message.signal
        ? AbortSignal.any([message.signal, AbortSignal.timeout(25_000)])
        : AbortSignal.timeout(25_000);
      if (provider.transport === 'resend') {
        const config = ResendConfigSchema.parse(provider.config);
        const authorization = `Bearer ${decryptProviderSecret(config.api_key)}`;
        const deliver = async () => {
          const response = await request('https://api.resend.com/emails', {
            method: 'POST',
            redirect: 'error',
            signal,
            headers: {
              Authorization: authorization,
              'Content-Type': 'application/json',
              'Idempotency-Key': message.idempotencyKey,
            },
            body: JSON.stringify({
              from: config.from_email,
              to: [message.destination],
              subject: message.subject,
              ...(message.html ? { html: message.html } : {}),
              ...(message.text ? { text: message.text } : {}),
              reply_to: config.reply_to,
            }),
          });
          if (!response.ok) throw new Error('Email provider rejected message');
          const body = (await response.json()) as { id?: unknown };
          if (typeof body.id !== 'string' || !body.id.trim())
            throw new Error('Email provider returned no receipt');
          return body.id;
        };
        return execute
          ? execute({ id: provider.id as string, transport: 'resend' }, deliver)
          : deliver();
      }
      if (provider.transport !== 'smtp') throw new Error('Email transport unavailable');
      const config = SmtpConfigSchema.parse(provider.config);
      const addresses = await lookup(config.host, { all: true });
      await new SmtpNetworkGuard({
        resolve: async () => addresses.map((item) => item.address),
      }).assertHostAllowed(config.host);
      signal.throwIfAborted();
      const address = addresses[0]?.address;
      if (!address) throw new Error('SMTP host unavailable');
      const transport = nodemailer.createTransport({
        host: address,
        port: config.port,
        secure: config.security === 'TLS',
        requireTLS: true,
        tls: { servername: config.host, minVersion: 'TLSv1.2' },
        auth: config.username
          ? { user: config.username, pass: decryptProviderSecret(config.password ?? '') }
          : undefined,
        connectionTimeout: Math.min(config.connection_timeout * 1000, 10_000),
        greetingTimeout: 10_000,
        socketTimeout: Math.min(config.command_timeout * 1000, 15_000),
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      const deliver = async () => {
        signal.throwIfAborted();
        let abort!: () => void;
        const cancelled = new Promise<never>((_, reject) => {
          abort = () => {
            transport.close();
            reject(new Error('Email delivery cancelled'));
          };
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) abort();
        });
        try {
          signal.throwIfAborted();
          const result = await Promise.race([
            cancelled,
            transport.sendMail({
              from: { name: config.from_name ?? 'Barghsa', address: config.from_email },
              to: message.destination,
              replyTo: config.reply_to,
              subject: message.subject,
              ...(message.html ? { html: message.html } : {}),
              ...(message.text ? { text: message.text } : {}),
              messageId: `<${createHash('sha256').update(message.idempotencyKey).digest('hex')}@${config.from_email.split('@')[1]}>`,
            }),
          ]);
          if (!result.accepted?.length && result.rejected?.length === 1)
            throw new DeliveryRejected('SMTP recipient rejected');
          if (result.accepted?.length !== 1 || result.rejected?.length || !result.messageId)
            throw new Error('SMTP returned an uncertain outcome');
          return result.messageId;
        } finally {
          signal.removeEventListener('abort', abort);
        }
      };
      try {
        return await (execute
          ? execute({ id: provider.id as string, transport: 'smtp' }, deliver)
          : deliver());
      } finally {
        transport.close();
      }
    };
    let receipt: string;
    try {
      receipt = await send();
    } catch (error) {
      await breaker
        .recordOutcome(provider.id, {
          ok: false,
          ...(decision.probeToken ? { probeToken: decision.probeToken } : {}),
        })
        .catch(() => {});
      throw error;
    }
    await breaker
      .recordOutcome(provider.id, {
        ok: true,
        ...(decision.probeToken ? { probeToken: decision.probeToken } : {}),
      })
      .catch(() => {});
    return receipt;
  };
}
