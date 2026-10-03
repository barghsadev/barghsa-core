import { ProviderRequestError, type EmailProvider, type Transport } from './email-providers-api.js';
import type { SmsConfig, SmsProvider } from './sms-providers-api.js';
export interface SmtpForm {
  host: string;
  port: string;
  security: 'TLS' | 'STARTTLS';
  username: string;
  password: string;
  connectionTimeout: string;
  commandTimeout: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
}

export interface ResendForm {
  apiKey: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  sendingDomain: string;
}

export type TransportForm = SmtpForm | ResendForm;

export const EMPTY_SMTP: SmtpForm = {
  host: '',
  port: '587',
  security: 'STARTTLS',
  username: '',
  password: '',
  connectionTimeout: '10',
  commandTimeout: '15',
  fromName: '',
  fromEmail: '',
  replyTo: '',
};

export const EMPTY_RESEND: ResendForm = {
  apiKey: '',
  fromName: '',
  fromEmail: '',
  replyTo: '',
  sendingDomain: '',
};

export function savedForm(provider: EmailProvider): TransportForm {
  const value = provider.maskedConfig;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProviderRequestError();
  const config = value as Record<string, unknown>;
  const field = (key: string, required = false): string => {
    const value = config[key] === undefined ? '' : config[key];
    if (typeof value !== 'string' || (required && !value.trim())) throw new ProviderRequestError();
    return value;
  };
  const integer = (key: string, fallback: number, max: number): string => {
    const value = config[key] === undefined ? fallback : config[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max)
      throw new ProviderRequestError();
    return String(value);
  };
  const common = {
    fromName: field('from_name'),
    fromEmail: field('from_email', true),
    replyTo: field('reply_to'),
  };
  if (provider.transport === 'resend') {
    return { ...common, apiKey: '', sendingDomain: field('sending_domain') };
  }
  const security = config.security === undefined ? 'STARTTLS' : config.security;
  if (security !== 'TLS' && security !== 'STARTTLS') throw new ProviderRequestError();
  return {
    ...common,
    host: field('host', true),
    port: integer('port', 587, 65535),
    security,
    username: field('username'),
    password: '',
    connectionTimeout: integer('connection_timeout', 10, 600),
    commandTimeout: integer('command_timeout', 15, 600),
  };
}

export function smtpConfig(form: SmtpForm): Record<string, unknown> {
  const config: Record<string, unknown> = {
    host: form.host,
    port: Number(form.port),
    security: form.security,
    connection_timeout: Number(form.connectionTimeout),
    command_timeout: Number(form.commandTimeout),
    from_email: form.fromEmail,
  };
  if (form.username) config.username = form.username;
  if (form.password) config.password = form.password;
  if (form.fromName) config.from_name = form.fromName;
  if (form.replyTo) config.reply_to = form.replyTo;
  return config;
}

export function resendConfig(form: ResendForm): Record<string, unknown> {
  const config: Record<string, unknown> = {
    from_email: form.fromEmail,
  };
  // Only include the API key when a new value was provided. When editing, an
  // empty apiKey means "keep the stored key" (server merges the patch over the
  // existing config), mirroring how the SMTP password is treated.
  if (form.apiKey) config.api_key = form.apiKey;
  if (form.fromName) config.from_name = form.fromName;
  if (form.replyTo) config.reply_to = form.replyTo;
  if (form.sendingDomain) config.sending_domain = form.sendingDomain;
  return config;
}

export type Variable = { id: string; internal: string; parameter: string };
export type Mapping = {
  id: string;
  event: string;
  locale: 'all' | 'fa' | 'en';
  template: string;
  variables: Variable[];
};
export type SmsEditor = {
  id: string | null;
  label: string;
  key: string;
  keyConfigured: boolean;
  sender: string;
  timeout: string;
  throughput: string;
  credit: string;
  mappings: Mapping[];
};
export const variable = (): Variable => ({ id: crypto.randomUUID(), internal: '', parameter: '' });
export const mapping = (): Mapping => ({
  id: crypto.randomUUID(),
  event: '',
  locale: 'all',
  template: '',
  variables: [variable()],
});
export function editorFor(row?: SmsProvider, clone = false): SmsEditor {
  return {
    id: clone ? null : (row?.id ?? null),
    label: row?.label ?? '',
    key: '',
    keyConfigured: !clone && !!row?.keyConfigured,
    sender: row?.config.sender ?? '',
    timeout: String(row?.config.timeout ?? 15),
    throughput: String(row?.config.throughput_limit ?? 100),
    credit: String(row?.config.low_credit_threshold ?? 0),
    mappings: row?.config.template_mappings.map((m) => ({
      id: crypto.randomUUID(),
      event: m.event_key,
      locale: m.locale ?? 'all',
      template: m.template_id,
      variables: Object.entries(m.variables).map(([internal, parameter]) => ({
        id: crypto.randomUUID(),
        internal,
        parameter,
      })),
    })) ?? [mapping()],
  };
}
export function configFor(editor: SmsEditor): SmsConfig {
  const integer = (value: string, min: number, max: number) => {
    const n = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(n) || n < min || n > max)
      throw new Error('invalid');
    return n;
  };
  if (
    !editor.label.trim() ||
    !editor.sender.trim() ||
    (!editor.keyConfigured && !editor.key.trim())
  )
    throw new Error('invalid');
  const seen = new Set<string>();
  return {
    sender: editor.sender.trim(),
    timeout: integer(editor.timeout, 1, 300),
    throughput_limit: integer(editor.throughput, 1, 10000),
    low_credit_threshold: integer(editor.credit, 0, 1_000_000_000),
    template_mappings: editor.mappings.map((m) => {
      const identity = `${m.event.trim()}:${m.locale}`;
      if (!m.event.trim() || !/^[1-9]\d*$/.test(m.template.trim()) || seen.has(identity))
        throw new Error('invalid');
      seen.add(identity);
      const names = new Set<string>(),
        parameters = new Set<string>();
      const pairs = m.variables.map((v) => {
        const name = v.internal.trim(),
          parameter = v.parameter.trim();
        if (
          !name ||
          !parameter ||
          names.has(name) ||
          parameters.has(parameter) ||
          ['__proto__', 'constructor', 'prototype'].some((part) => name.split('.').includes(part))
        )
          throw new Error('invalid');
        names.add(name);
        parameters.add(parameter);
        return [name, parameter];
      });
      if (!pairs.length) throw new Error('invalid');
      return {
        event_key: m.event.trim(),
        ...(m.locale === 'all' ? {} : { locale: m.locale }),
        template_id: m.template.trim(),
        variables: Object.fromEntries(pairs),
      };
    }),
  };
}

export type EmailDraft = SmtpForm & ResendForm & { label: string };
export const emptyEmailDraft = (): EmailDraft => ({ ...EMPTY_SMTP, ...EMPTY_RESEND, label: '' });
export function integerIn(raw: string, min: number, max: number) {
  const n = Number(raw);
  return /^\d+$/.test(raw) && Number.isSafeInteger(n) && n >= min && n <= max;
}
const emailAddress = (raw: string) =>
  raw.length <= 320 &&
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(
    raw
  ) &&
  !raw.startsWith('.') &&
  !raw.includes('..');
export function emailInvalidFields(
  d: EmailDraft,
  transport: Transport,
  editing: boolean
): (keyof EmailDraft)[] {
  const errors: (keyof EmailDraft)[] = [];
  const invalid = (key: keyof EmailDraft, condition: boolean) => {
    if (condition) errors.push(key);
  };
  invalid('label', !d.label.trim() || d.label.trim().length > 120);
  if (transport === 'smtp') {
    invalid('host', !d.host.trim() || d.host.length > 253);
    invalid('port', !integerIn(d.port, 1, 65535));
    invalid('security', !['TLS', 'STARTTLS'].includes(d.security));
    invalid('connectionTimeout', !integerIn(d.connectionTimeout, 1, 600));
    invalid('commandTimeout', !integerIn(d.commandTimeout, 1, 600));
    invalid('username', d.username.length > 255);
    invalid('password', d.password.length > 2048);
  } else {
    invalid('apiKey', (!editing && !d.apiKey.trim()) || d.apiKey.length > 1024);
    invalid(
      'sendingDomain',
      d.sendingDomain.length > 253 || (!!d.sendingDomain && !d.sendingDomain.trim())
    );
  }
  invalid('fromName', d.fromName.length > 255);
  invalid('fromEmail', !emailAddress(d.fromEmail));
  invalid('replyTo', !!d.replyTo && !emailAddress(d.replyTo));
  return errors;
}
export function smsInvalidFields(d: SmsEditor, events: string[]): (keyof SmsEditor)[] {
  const errors: (keyof SmsEditor)[] = [];
  const invalid = (key: keyof SmsEditor, condition: boolean) => {
    if (condition) errors.push(key);
  };
  invalid('label', !d.label.trim() || d.label.trim().length > 120);
  invalid('sender', !d.sender.trim() || d.sender.trim().length > 64);
  invalid('timeout', !integerIn(d.timeout, 1, 300));
  invalid('throughput', !integerIn(d.throughput, 1, 10000));
  invalid('credit', !integerIn(d.credit, 0, 1_000_000_000));
  invalid('key', (!d.keyConfigured && !d.key.trim()) || d.key.length > 1024);
  const seen = new Set<string>();
  invalid(
    'mappings',
    !d.mappings.length ||
      d.mappings.some((m) => {
        const identity = `${m.event.trim()}:${m.locale}`;
        const names = new Set<string>(),
          parameters = new Set<string>();
        const bad =
          !events.includes(m.event.trim()) ||
          m.event.trim().length > 128 ||
          !['all', 'fa', 'en'].includes(m.locale) ||
          !/^[1-9]\d*$/.test(m.template.trim()) ||
          m.template.trim().length > 128 ||
          seen.has(identity) ||
          !m.variables.length ||
          m.variables.some((v) => {
            const name = v.internal.trim(),
              parameter = v.parameter.trim();
            const invalid =
              !name ||
              !parameter ||
              name.length > 255 ||
              parameter.length > 255 ||
              names.has(name) ||
              parameters.has(parameter) ||
              ['__proto__', 'constructor', 'prototype'].some((part) =>
                name.split('.').includes(part)
              );
            names.add(name);
            parameters.add(parameter);
            return invalid;
          });
        seen.add(identity);
        return bad;
      })
  );
  return errors;
}

/** Empty public optional fields explicitly remove a previously saved value; secrets remain omitted. */
export function emailConfigFor(draft: EmailDraft, transport: Transport, previous?: EmailProvider) {
  const config = transport === 'smtp' ? smtpConfig(draft) : resendConfig(draft);
  const saved = previous?.maskedConfig;
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
    for (const [publicKey, draftKey] of Object.entries({
      from_name: 'fromName',
      reply_to: 'replyTo',
      ...(transport === 'smtp' ? { username: 'username' } : { sending_domain: 'sendingDomain' }),
    })) {
      if ((saved as Record<string, unknown>)[publicKey] && !draft[draftKey as keyof EmailDraft])
        config[publicKey] = null;
    }
  }
  return config;
}
