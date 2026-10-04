import { expect, it } from 'vitest';
import { en, fa, t } from './app.js';

it('localizes electricity corrections and staff decision ownership in both dictionaries', () => {
  const keys = Object.keys(en).filter((key) =>
    /electricity\.(correctionForm|staffReasonForm)\./.test(key)
  );
  expect(keys.sort()).toEqual(
    Object.keys(fa)
      .filter((key) => /electricity\.(correctionForm|staffReasonForm)\./.test(key))
      .sort()
  );
  expect(keys).toHaveLength(16);
  for (const key of keys) {
    expect(t(key, 'en')).not.toBe(key);
    expect(t(key, 'fa')).not.toBe(key);
    expect(t(key, 'en')).not.toBe(t(key, 'fa'));
  }
  expect(t('electricity.staffReasonForm.help', 'en')).toContain('Approval does not use');
  expect(t('electricity.staffReasonForm.invalid', 'en')).toContain('1,000');
  expect(t('electricity.correctionForm.uncertain', 'en')).toContain('same correction');
});
