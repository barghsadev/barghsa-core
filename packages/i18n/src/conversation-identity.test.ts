import { expect, it } from 'vitest';
import { fa, en, t } from './conversation-identity.js';
import { t as appText } from './app.js';

it('keeps deferred editor messages complete in both languages and aligned with the shared menu title', () => {
  expect(Object.keys(fa).sort()).toEqual(Object.keys(en).sort());
  for (const locale of ['en', 'fa'] as const) {
    const dictionary = locale === 'fa' ? fa : en;
    for (const [key, value] of Object.entries(dictionary)) {
      expect(value.trim()).not.toBe('');
      expect(t(key, locale)).toBe(value);
    }
    expect(t('conversationIdentity.title', locale)).toBe(
      appText('conversationIdentity.title', locale)
    );
    for (const key of ['missing.translation', 'constructor', 'toString', '__proto__'])
      expect(t(key, locale)).toBe(key);
  }
  expect(t('conversationIdentity.paymentActivityHelp')).toBe(
    fa['conversationIdentity.paymentActivityHelp']
  );
  expect(Reflect.apply(t, undefined, ['conversationIdentity.paymentActivityHelp', 'invalid'])).toBe(
    en['conversationIdentity.paymentActivityHelp']
  );
});
