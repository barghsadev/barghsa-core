import { expect, it } from 'vitest';
import { InputFieldException } from '../common/input-field.exception';
import { providerInputError, validateEmailConfigPatch } from './provider-input-fields';
it('maps nested config identifiers without submitted values or paths', () => {
  const email = providerInputError(
    [{ path: ['config', 'connection_timeout'] }, { path: ['label'] }],
    'email'
  );
  expect(email.fields).toEqual(['connectionTimeout', 'label']);
  expect(JSON.stringify(email.getResponse())).not.toContain('connection_timeout');
  expect(
    providerInputError(
      [
        { path: ['config', 'template_mappings', 2, 'variables', 'code'] },
        { path: ['config', 'api_key'] },
      ],
      'sms'
    ).fields
  ).toEqual(['mappings', 'key']);
});
it('validates supplied SMTP fields while allowing partial draft and unchanged secrets', () => {
  expect(() => validateEmailConfigPatch('smtp', { host: 'smtp.example.test' })).not.toThrow();
  expect(() => validateEmailConfigPatch('smtp', { port: 2.5 })).toThrow(InputFieldException);
  expect(() => validateEmailConfigPatch('smtp', { connection_timeout: 601 })).toThrow(
    InputFieldException
  );
});
it('validates Resend patches without demanding the write-only stored key', () => {
  expect(() =>
    validateEmailConfigPatch('resend', { from_email: 'sender@example.test' })
  ).not.toThrow();
  expect(() => validateEmailConfigPatch('resend', { api_key: 'x'.repeat(1025) })).toThrow(
    InputFieldException
  );
  expect(() => validateEmailConfigPatch('resend', { reply_to: 'invalid' })).toThrow(
    InputFieldException
  );
});
