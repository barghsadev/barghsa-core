import { expect, it } from 'vitest';
import { en, fa, t } from './app.js';

it('localizes the independent increase editors and captured retries in both languages', () => {
  const keys = Object.keys(en).filter((key) =>
    /electricity\.(increaseForm|increaseDecisionForm)\./.test(key)
  );
  expect(keys.sort()).toEqual(
    Object.keys(fa)
      .filter((key) => /electricity\.(increaseForm|increaseDecisionForm)\./.test(key))
      .sort()
  );
  expect(keys).toHaveLength(13);
  for (const key of keys) {
    expect(t(key, 'en')).not.toBe(key);
    expect(t(key, 'fa')).not.toBe(key);
    expect(t(key, 'en')).not.toBe(t(key, 'fa'));
  }
  expect(t('electricity.increaseDecisionForm.reasonHelp', 'en')).toContain('Approval does not use');
  expect(t('electricity.increaseForm.quantityInvalid', 'en')).toContain('19 digits');
});
