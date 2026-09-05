import { PostgresRateLimiterStore } from '@barghsa/shared/rate-limit'
import { lookup } from 'node:dns/promises'
import nodemailer from 'nodemailer'
import type { Pool } from 'pg'
import {
  decryptProviderSecret, SmtpConfigSchema, ResendConfigSchema, SmsirConfigSchema,
  SmtpNetworkGuard, sendSmsirVerification,
} from '@barghsa/shared/auth-delivery'

export interface AuthMessage {
  id: string
  destination: string
  code: string
  purpose: string
  activationUrl?: string
}

/** Dependencies are supplied by controlled provider tests, never by request data. */
export function createAuthSender(pool: Pool, request: typeof fetch = fetch) {
  return async (message: AuthMessage): Promise<string> => {
    const activation = message.purpose === 'staff_activation'
    if (!(activation ? /^[a-f0-9]{64}$/.test(message.code) && typeof message.activationUrl === 'string' : /^\d{6}$/.test(message.code))) throw new Error('Invalid auth message')
    const email = message.destination.includes('@')
    const providers = await pool.query<{ transport: string; config: unknown }>(email
      ? "SELECT transport, config FROM email_provider_configs WHERE status='active' AND last_test_status='passed' AND degraded=false"
      : "SELECT transport, config FROM sms_provider_configs WHERE status='active' AND last_test_status='passed'")
    const provider = providers.rows[0]
    if (!provider) throw new Error('Auth provider unavailable')
    if (activation && !email) throw new Error('Activation requires email')
    const subject = activation ? 'فعال‌سازی حساب برق‌آسا / Activate your Barghsa account' : 'کد تأیید برق‌آسا / Barghsa verification code'
    const text = activation ? `برای فعال‌سازی حساب و تعیین رمز عبور، این پیوند را باز کنید. اعتبار: ۲۴ ساعت.
Open this link to activate your account and set your password. It expires in 24 hours.
${message.activationUrl}` : `کد تأیید برق‌آسا: ${message.code}\nBarghsa verification code: ${message.code}\nاین کد را با کسی به اشتراک نگذارید. Do not share this code.`
    if (provider.transport === 'resend' && email) {
      const config = ResendConfigSchema.parse(provider.config)
      const response = await request('https://api.resend.com/emails', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${decryptProviderSecret(config.api_key)}`, 'Content-Type': 'application/json', 'Idempotency-Key': message.id },
        body: JSON.stringify({ from: config.from_email, to: [message.destination], subject, text, reply_to: config.reply_to }),
      })
      if (!response.ok) throw new Error('Auth provider rejected message')
      const body = await response.json() as { id?: unknown }
      if (typeof body.id !== 'string' || !body.id) throw new Error('Auth provider returned no receipt')
      return body.id
    }
    if (provider.transport === 'smtp' && email) {
      const config = SmtpConfigSchema.parse(provider.config)
      // Resolve once and pin the checked address so connection DNS cannot change it.
      const addresses = await lookup(config.host, { all: true })
      await new SmtpNetworkGuard({ resolve: async () => addresses.map(item => item.address) }).assertHostAllowed(config.host)
      const address = addresses[0]?.address
      if (!address) throw new Error('SMTP host unavailable')
      const transport = nodemailer.createTransport({
        host: address, port: config.port, secure: config.security === 'TLS', requireTLS: true,
        tls: { servername: config.host, minVersion: 'TLSv1.2' },
        auth: config.username ? { user: config.username, pass: decryptProviderSecret(config.password ?? '') } : undefined,
        connectionTimeout: Math.min(config.connection_timeout * 1000, 10_000),
        greetingTimeout: 10_000, socketTimeout: Math.min(config.command_timeout * 1000, 15_000),
        disableFileAccess: true, disableUrlAccess: true,
      })
      const deadline = setTimeout(() => transport.close(), 25_000)
      try {
        const sent = await transport.sendMail({
          from: { name: config.from_name ?? 'Barghsa', address: config.from_email },
          to: message.destination, replyTo: config.reply_to, subject, text,
          messageId: `<${message.id}@${config.from_email.split('@')[1]}>`,
          headers: { 'Resend-Idempotency-Key': message.id },
        })
        if (!sent.accepted?.length || sent.rejected?.length) throw new Error('SMTP recipient rejected')
        return sent.messageId
      } finally {
        clearTimeout(deadline)
        transport.close()
      }
    }
    if (provider.transport === 'smsir' && !email) {
      const config = SmsirConfigSchema.parse(provider.config)
      const mapping = config.template_mappings?.find(item => item.event_key === `otp:${message.purpose}`)
      if (!mapping || !/^\d+$/.test(mapping.template_id) || !mapping.variables?.code || Object.keys(mapping.variables).some(key => key !== 'code')) {
        throw new Error('OTP SMS template mapping unavailable')
      }
      const mobile = message.destination.replace(/^\+98/, '0')
      if (!/^09\d{9}$/.test(mobile)) throw new Error('Invalid SMS destination')
      const quota = await new PostgresRateLimiterStore((sql, params) => pool.query(sql, params))
        .incrementSecurity('provider:smsir:auth-send', config.throughput_limit, 60_000)
      if (!quota.allowed) throw new Error('SMS provider quota reached')
      return sendSmsirVerification(decryptProviderSecret(config.api_key), process.env.SMSIR_API_BASE || 'https://api.sms.ir',
        mobile, mapping.template_id, [{ name: mapping.variables.code, value: message.code }], request, config.timeout * 1000)
    }
    throw new Error('Auth provider transport mismatch')
  }
}
