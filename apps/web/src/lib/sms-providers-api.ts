import {
  providerRequest,
  ProviderRequestError,
  type Status,
  type TestStatus,
} from './email-providers-api.js';

export interface SmsMapping {
  event_key: string;
  template_id: string;
  variables: Record<string, string>;
}
export interface SmsConfig {
  sender: string;
  timeout: number;
  throughput_limit: number;
  low_credit_threshold: number;
  template_mappings: SmsMapping[];
}
export interface SmsProvider {
  id: string;
  label: string;
  status: Status;
  lastTestStatus: TestStatus;
  createdAt: string;
  keyConfigured: boolean;
  config: SmsConfig;
}

export function smsRequest(
  path: string,
  method: 'GET' | 'POST' | 'PUT' = 'GET',
  body?: unknown,
  signal?: AbortSignal
) {
  return providerRequest(path, method, body, signal, 'sms');
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProviderRequestError();
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new ProviderRequestError();
  return value;
}
function number(value: unknown, fallback: number, min: number, max: number): number {
  const n = value === undefined ? fallback : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max)
    throw new ProviderRequestError();
  return n;
}
export function readSmsProvider(
  value: unknown,
  expected?: { status: Status; id?: string }
): SmsProvider {
  const row = record(value),
    c = record(row.maskedConfig);
  if (
    row.transport !== 'smsir' ||
    !['draft', 'active', 'superseded', 'disabled'].includes(String(row.status)) ||
    !['pending', 'passed', 'failed'].includes(String(row.lastTestStatus))
  )
    throw new ProviderRequestError();
  const id = string(row.id),
    createdAt = string(row.createdAt);
  if (
    !Number.isFinite(Date.parse(createdAt)) ||
    (expected &&
      (row.status !== expected.status || (expected.id !== undefined && id !== expected.id)))
  )
    throw new ProviderRequestError();
  const mappings = c.template_mappings ?? [];
  if (!Array.isArray(mappings)) throw new ProviderRequestError();
  return {
    id,
    label: string(row.label),
    status: row.status as Status,
    lastTestStatus: row.lastTestStatus as TestStatus,
    createdAt,
    // Never copy the masked credential into form state or send it back on update.
    keyConfigured: typeof c.api_key === 'string' && c.api_key.length > 0,
    config: {
      sender: string(c.sender),
      timeout: number(c.timeout, 15, 1, 300),
      throughput_limit: number(c.throughput_limit, 100, 1, 10000),
      low_credit_threshold: number(c.low_credit_threshold, 0, 0, 1_000_000_000),
      template_mappings: mappings.map((value) => {
        const mapping = record(value),
          variables = record(mapping.variables ?? {});
        return {
          event_key: string(mapping.event_key),
          template_id: string(mapping.template_id),
          variables: Object.fromEntries(
            Object.entries(variables).map(([key, v]) => [string(key), string(v)])
          ),
        };
      }),
    },
  };
}
export async function loadSmsProviders(signal: AbortSignal) {
  const [rows, events] = await Promise.all([
    smsRequest('', 'GET', undefined, signal),
    smsRequest('/template-event-keys', 'GET', undefined, signal),
  ]);
  if (!Array.isArray(rows) || !Array.isArray(events)) throw new ProviderRequestError();
  const providers = rows.map((row) => readSmsProvider(row));
  if (new Set(providers.map((row) => row.id)).size !== providers.length)
    throw new ProviderRequestError();
  return { providers, events: [...new Set(events.map(string))].sort() };
}
export function sameSmsConfig(a: SmsConfig, b: SmsConfig) {
  const canonical = (c: SmsConfig) => ({
    ...c,
    template_mappings: c.template_mappings.map((m) => ({
      ...m,
      variables: Object.entries(m.variables).sort(([a], [b]) => a.localeCompare(b)),
    })),
  });
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
