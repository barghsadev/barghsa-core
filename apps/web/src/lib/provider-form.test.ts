import { expect, it } from 'vitest';
import {
  emptyEmailDraft,
  emailInvalidFields,
  editorFor,
  smsInvalidFields,
  smtpConfig,
  resendConfig,
  configFor,
  emailConfigFor,
} from './provider-form.js';
it('SMTP rejects blank, fractional and out-of-range numeric drafts without coercing them', () => {
  const draft = {
    ...emptyEmailDraft(),
    label: 'SMTP',
    host: 'mail.example.test',
    fromEmail: 'sender@example.test',
  };
  expect(emailInvalidFields(draft, 'smtp', false)).toEqual([]);
  for (const port of ['', '0', '65536', '2.5', '1e2'])
    expect(emailInvalidFields({ ...draft, port }, 'smtp', false)).toContain('port');
  expect(smtpConfig(draft).password).toBeUndefined();
});
it('Resend requires a key on creation and omits it on an edit', () => {
  const draft = { ...emptyEmailDraft(), label: 'Resend', fromEmail: 'sender@example.test' };
  expect(emailInvalidFields(draft, 'resend', false)).toEqual(['apiKey']);
  expect(emailInvalidFields(draft, 'resend', true)).toEqual([]);
  expect(resendConfig(draft).api_key).toBeUndefined();
  expect(emailInvalidFields({ ...draft, fromEmail: 'invalid' }, 'resend', true)).toContain(
    'fromEmail'
  );
});
it('SMS validates boundaries, available events, distinct pairs and unique variable mappings', () => {
  const draft = {
    ...editorFor(),
    label: 'SMS',
    sender: '3000',
    key: 'fixture-key',
    mappings: [
      {
        id: 'm',
        event: 'auth.otp',
        locale: 'all' as const,
        template: '42',
        variables: [{ id: 'v', internal: 'code', parameter: 'CODE' }],
      },
    ],
  };
  expect(smsInvalidFields(draft, ['auth.otp'])).toEqual([]);
  expect(configFor(draft).template_mappings).toHaveLength(1);
  for (const mappings of [
    [],
    [...draft.mappings, ...draft.mappings],
    [{ ...draft.mappings[0]!, event: 'missing' }],
    [
      {
        ...draft.mappings[0]!,
        variables: [{ id: 'v', internal: 'constructor.code', parameter: 'CODE' }],
      },
    ],
  ])
    expect(smsInvalidFields({ ...draft, mappings }, ['auth.otp'])).toContain('mappings');
  expect(
    smsInvalidFields({ ...draft, timeout: '301', throughput: '0', credit: '-1' }, ['auth.otp'])
  ).toEqual(['timeout', 'throughput', 'credit']);
});

it('empty optional public fields clear saved values without sending a stored credential', () => {
  const draft = { ...emptyEmailDraft(), label: 'Resend', fromEmail: 'sender@example.test' };
  const config = emailConfigFor(draft, 'resend', {
    id: 'saved',
    label: 'Resend',
    transport: 'resend',
    status: 'draft',
    lastTestStatus: 'pending',
    maskedConfig: {
      reply_to: 'reply@example.test',
      sending_domain: 'example.test',
      api_key: '********cret',
    },
  });
  expect(config).toEqual({
    from_email: 'sender@example.test',
    reply_to: null,
    sending_domain: null,
  });
});
