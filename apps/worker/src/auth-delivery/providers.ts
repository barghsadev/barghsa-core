import {
  createEmailSender,
  createSmsSender,
  loadEmailBranding,
  normalizeEmailBranding,
  renderBrandedEmail,
  type EmailBranding,
} from '@barghsa/shared/notification-delivery';
import { escapeHtml } from '@barghsa/shared/notifications';
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { SmsirConfigSchema } from '@barghsa/shared/auth-delivery';

export interface AuthMessage {
  /** Worker diagnostics only; never part of a customer message. */
  correlationId?: string;
  id: string;
  destination: string;
  code: string;
  purpose: string;
  activationUrl?: string;
  /** Frozen by the durable worker; null preserves already-attempted legacy messages. */
  emailBranding?: EmailBranding | null;
}

export function staffActivationUrl(value: unknown, invitation: string): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const localHttp =
      process.env.NODE_ENV !== 'production' &&
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1'].includes(url.hostname);
    if (
      (url.protocol === 'https:' || localHttp) &&
      !url.username &&
      !url.password &&
      !url.search &&
      url.pathname === '/activate' &&
      url.hash === `#invitation=${invitation}`
    )
      return url.href;
  } catch {
    // An invalid URL must never reach the provider.
  }
  return null;
}

/** Dependencies are supplied by controlled provider tests, never by request data. */
export function createAuthSender(pool: Pool, request: typeof fetch = fetch) {
  return async (message: AuthMessage): Promise<string> => {
    const activation = message.purpose === 'staff_activation';
    const link =
      activation && /^v2_[a-f0-9]{64}$/.test(message.code)
        ? staffActivationUrl(
            message.activationUrl,
            createHash('sha256').update(message.code).digest('hex')
          )
        : null;
    if (!(activation ? link : /^\d{6}$/.test(message.code)))
      throw new Error('Invalid auth message');
    const email = message.destination.includes('@');
    if (activation && !email) throw new Error('Activation requires email');
    let subject = activation
      ? 'فعال‌سازی حساب برق‌آسا / Activate your Barghsa account'
      : 'کد تأیید برق‌آسا / Barghsa verification code';
    let text = activation
      ? `برای فعال‌سازی حساب، پیوند زیر را باز کنید و کد را در فرم وارد کنید. اعتبار: ۲۴ ساعت.
Open the invitation and enter the code in the form to activate your account. It expires in 24 hours.
${link}

کد فعال‌سازی / Activation code:
${message.code}
این کد را با کسی به اشتراک نگذارید. Do not share this code.`
      : `کد تأیید برق‌آسا: ${message.code}\nBarghsa verification code: ${message.code}\nاین کد را با کسی به اشتراک نگذارید. Do not share this code.`;
    if (email) {
      const brand =
        message.emailBranding === null
          ? null
          : message.emailBranding
            ? normalizeEmailBranding(message.emailBranding)
            : await loadEmailBranding(pool);
      if (brand) {
        const persianTitle = brand.appTitleFa || brand.appTitle;
        subject = activation
          ? `فعال‌سازی حساب ${persianTitle} / Activate your ${brand.appTitle} account`
          : `کد تأیید ${persianTitle} / ${brand.appTitle} verification code`;
        if (!activation)
          text = `کد تأیید ${persianTitle}: ${message.code}\n${brand.appTitle} verification code: ${message.code}\nاین کد را با کسی به اشتراک نگذارید. Do not share this code.`;
      }
      return createEmailSender(
        pool,
        request
      )({
        destination: message.destination,
        subject,
        text,
        ...(brand
          ? {
              html: renderBrandedEmail(
                `<p style="white-space:pre-wrap">${escapeHtml(text)}</p>`,
                brand,
                'fa'
              ),
            }
          : {}),
        idempotencyKey: message.id,
      });
    }
    const providers = await pool.query<{ id: string; transport: string; config: unknown }>(
      "SELECT id, transport, config FROM sms_provider_configs WHERE status='active' AND last_test_status='passed'"
    );
    const provider = providers.rows[0];
    if (providers.rows.length !== 1 || !provider) throw new Error('Auth provider unavailable');
    if (provider.transport === 'smsir' && !email) {
      const config = SmsirConfigSchema.parse(provider.config);
      const mapping =
        config.template_mappings?.find((item) => item.event_key === `otp:${message.purpose}`) ??
        (message.purpose === 'step_up'
          ? config.template_mappings?.find((item) => item.event_key === 'otp:login')
          : undefined);
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
      return createSmsSender(
        pool,
        request
      )({
        providerId: provider.id,
        destination: mobile,
        templateId: mapping.template_id,
        parameters: [{ name: mapping.variables.code, value: message.code }],
      });
    }
    throw new Error('Auth provider transport mismatch');
  };
}
