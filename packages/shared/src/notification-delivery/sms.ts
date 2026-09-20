import {
  SmsirConfigSchema,
  decryptProviderSecret,
  sendSmsirVerification,
} from '../auth-delivery/index.js';
import { resolvePath } from '../notifications/template-engine.js';
import { PostgresRateLimiterStore } from '../rate-limit/index.js';
import type { DeliveryPool } from './email.js';
import type { DeliveryExecutor } from './execution.js';

export interface SmsMessage {
  providerId: string;
  destination: string;
  templateId: string;
  parameters: Array<{ name: string; value: string }>;
}

export async function prepareSmsMessage(
  pool: DeliveryPool,
  destination: string,
  eventKey: string,
  allowList: string[],
  data: Record<string, unknown>,
  locale?: 'fa' | 'en'
): Promise<SmsMessage> {
  if (!/^(?:\+98|0)9\d{9}$/.test(destination)) throw new Error('Invalid SMS destination');
  const rows = (
    await pool.query(
      "SELECT id,transport,config FROM sms_provider_configs WHERE status='active' AND last_test_status='passed'"
    )
  ).rows;
  if (rows.length !== 1 || rows[0]!.transport !== 'smsir' || typeof rows[0]!.id !== 'string')
    throw new Error('SMS provider unavailable');
  const config = SmsirConfigSchema.parse(rows[0]!.config);
  const candidates = config.template_mappings?.filter((item) => item.event_key === eventKey) ?? [];
  const localized = locale ? candidates.filter((item) => item.locale === locale) : [];
  const mappings = localized.length
    ? localized
    : candidates.filter((item) => item.locale === undefined);
  if (mappings.length !== 1) throw new Error('SMS template mapping unavailable');
  const mapping = mappings[0]!;
  if (!mapping.variables || !Object.keys(mapping.variables).length)
    throw new Error('SMS template variables unavailable');
  const parameters = Object.entries(mapping.variables).map(([variable, name]) => {
    if (!allowList.includes(variable)) throw new Error('SMS mapping variable is not approved');
    const value = resolvePath(data, variable);
    if ((typeof value !== 'string' && typeof value !== 'number') || String(value).length === 0)
      throw new Error('SMS template data incomplete');
    return { name, value: String(value) };
  });
  if (new Set(parameters.map((item) => item.name)).size !== parameters.length)
    throw new Error('Duplicate SMS provider parameter');
  return {
    providerId: rows[0]!.id as string,
    destination,
    templateId: mapping.template_id,
    parameters,
  };
}

export function createSmsSender(
  pool: DeliveryPool,
  request: typeof fetch = fetch,
  execute?: DeliveryExecutor
) {
  return async (message: SmsMessage, signal?: AbortSignal): Promise<string> => {
    signal?.throwIfAborted();
    if (
      !/^(?:\+98|0)9\d{9}$/.test(message.destination) ||
      !message.parameters.length ||
      !/^\d+$/.test(message.templateId) ||
      !Number.isSafeInteger(Number(message.templateId)) ||
      Number(message.templateId) <= 0
    )
      throw new Error('Invalid SMS message');
    const rows = (
      await pool.query(
        "SELECT id,transport,config FROM sms_provider_configs WHERE status='active' AND last_test_status='passed'"
      )
    ).rows;
    if (rows.length !== 1 || rows[0]!.id !== message.providerId || rows[0]!.transport !== 'smsir')
      throw new Error('SMS provider changed; delivery requires reconciliation');
    const config = SmsirConfigSchema.parse(rows[0]!.config);
    const quota = await new PostgresRateLimiterStore((sql, params) =>
      pool.query(sql, params)
    ).incrementSecurity(`provider:smsir:${message.providerId}`, config.throughput_limit, 60_000);
    if (!quota.allowed) throw new Error('SMS provider quota reached');
    signal?.throwIfAborted();
    const apiKey = decryptProviderSecret(config.api_key);
    const send = () =>
      sendSmsirVerification(
        apiKey,
        process.env.SMSIR_API_BASE || 'https://api.sms.ir',
        message.destination,
        message.templateId,
        message.parameters,
        request,
        config.timeout * 1000,
        signal
      );
    return execute ? execute({ id: message.providerId, transport: 'smsir' }, send) : send();
  };
}
