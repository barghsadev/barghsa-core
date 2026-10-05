import { expect, it } from 'vitest';
import { passwordRecoveryDictionaries, passwordRecoveryText } from './password-recovery-forms.js';
it('provides complete English/Persian native recovery feedback', () => {
  expect(Object.keys(passwordRecoveryDictionaries.en).sort()).toEqual(
    Object.keys(passwordRecoveryDictionaries.fa).sort()
  );
  for (const locale of ['en', 'fa'] as const)
    for (const key of Object.keys(passwordRecoveryDictionaries.en))
      expect(passwordRecoveryText(key, locale)).not.toBe(key);
});
