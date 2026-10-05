import { expect, it } from 'vitest';
import { registrationFormKeys, registrationFormText } from './registration-forms.js';
it('provides both languages for every registration form key', () => {
  for (const key of registrationFormKeys)
    for (const locale of ['en', 'fa'] as const)
      expect(registrationFormText(key, locale)).not.toBe(key);
});
