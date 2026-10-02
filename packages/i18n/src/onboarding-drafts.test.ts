import { expect, it } from 'vitest';
import { fa, en, t } from './onboarding-drafts.js';
it('has matching, non-empty translations and safe lookups', () => {
  expect(Object.keys(fa).sort()).toEqual(Object.keys(en).sort());
  for (const locale of ['en', 'fa'] as const)
    for (const key of Object.keys(fa) as (keyof typeof fa)[]) {
      expect(t(key, locale)).toBe((locale === 'fa' ? fa : en)[key]);
      expect(t(key, locale).trim()).not.toBe('');
    }
});
