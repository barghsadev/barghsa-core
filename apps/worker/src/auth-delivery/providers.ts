import { createEmailSender } from '@barghsa/shared/notification-delivery';
import { PostgresRateLimiterStore } from '@barghsa/shared/rate-limit';
import type { Pool } from 'pg';
import {
  decryptProviderSecret,
  SmsirConfigSchema,
  sendSmsirVerification,
} from '@barghsa/shared/auth-delivery';

export interface AuthMessage {
  id: string;
  destination: string;
  code: string;
  purpose: string;
  activationUrl?: string;
}

/** Dependencies are supplied by controlled provider tests, never by request data. */
export function createAuthSender(pool: Pool, request: typeof fetch = fetch) {
  return async (message: AuthMessage): Promise<string> => {
    const activation = message.purpose === 'staff_activation';
    if (
      !(activation
        ? /^[a-f0-9]{64}$/.test(message.code) && typeof message.activationUrl === 'string'
        : /^\d{6}$/.test(message.code))
    )
      throw new Error('Invalid auth message');
    const email = message.destination.includes('@');
    if (activation && !email) throw new Error('Activation requires email');
    const subject = activation
      ? 'فعال‌سازی حساب برق‌آسا / Activate your Barghsa account'
      : 'کد تأیید برق‌آسا / Barghsa verification code';
    const text = activation
      ? `برای فعال‌سازی حساب و تعیین رمز عبور، این پیوند را باز کنید. اعتبار: ۲۴ ساعت.
Open this link to activate your account and set your password. It expires in 24 hours.
${message.activationUrl}`
      : `کد تأیید برق‌آسا: ${message.code}\nBarghsa verification code: ${message.code}\nاین کد را با کسی به اشتراک نگذارید. Do not share this code.`;
    if (email)
      return createEmailSender(
        pool,
        request
      )({ destination: message.destination, subject, text, idempotencyKey: message.id });
    const providers = await pool.query<{ id: string; transport: string; config: unknown }>(
      "SELECT id, transport, config FROM sms_provider_configs WHERE status='active' AND last_test_status='passed'"
    );
    const provider = providers.rows[0];
    if (providers.rows.length !== 1 || !provider) throw new Error('Auth provider unavailable');
    if (provider.transport === 'smsir' && !email) {
      const config = SmsirConfigSchema.parse(provider.config);
      const mapping = config.template_mappings?.find(
        (item) => item.event_key === `otp:${message.purpose}`
      );
      if (
        !mapping ||
        !/^\d+$/.test(mapping.template_id) ||
        !mapping.variables?.code ||
        Object.keys(mapping.variables).some((key) => key !== 'code')
      ) {
        throw new Error('OTP SMS template mapping unavailable');
      }
      const mobile = message.destination.replace(/^\+98/, '0');
      if (!/^09\d{9}$/.test(mobile)) throw new Error('Invalid SMS destination');
      const quota = await new PostgresRateLimiterStore((sql, params) =>
        pool.query(sql, params)
      ).incrementSecurity(`provider:smsir:${provider.id}`, config.throughput_limit, 60_000);
      if (!quota.allowed) throw new Error('SMS provider quota reached');
      return sendSmsirVerification(
        decryptProviderSecret(config.api_key),
        process.env.SMSIR_API_BASE || 'https://api.sms.ir',
        mobile,
        mapping.template_id,
        [{ name: mapping.variables.code, value: message.code }],
        request,
        config.timeout * 1000
      );
    }
    throw new Error('Auth provider transport mismatch');
  };
}
