import { expect, it } from 'vitest';
import { providerFormText, type ProviderFormKey } from './provider-forms.js';
for (const locale of ['fa', 'en'] as const)
  it(`provider form copy exists in ${locale}`, () => {
    const fields: ProviderFormKey[] = [
      'label',
      'host',
      'port',
      'security',
      'username',
      'passwordMessage',
      'connectionTimeout',
      'commandTimeout',
      'fromName',
      'fromEmail',
      'replyTo',
      'apiKeyMessage',
      'sendingDomain',
      'sender',
      'timeout',
      'throughput',
      'credit',
      'mappings',
      'validationUnavailable',
      'uncertain',
      'reset',
    ];
    for (const field of fields) expect(providerFormText(field, locale).trim()).not.toBe('');
    expect(providerFormText('uncertain', locale)).not.toBe(
      providerFormText('uncertain', locale === 'fa' ? 'en' : 'fa')
    );
  });
