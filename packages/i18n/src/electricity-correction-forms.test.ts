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
  expect(keys).toEqual([
    'electricity.correctionForm.addressInvalid',
    'electricity.correctionForm.busy',
    'electricity.correctionForm.giftInvalid',
    'electricity.correctionForm.help',
    'electricity.correctionForm.loading',
    'electricity.correctionForm.loadingRevision',
    'electricity.correctionForm.locationInvalid',
    'electricity.correctionForm.noteInvalid',
    'electricity.correctionForm.postalInvalid',
    'electricity.correctionForm.quantitiesHelp',
    'electricity.correctionForm.retry',
    'electricity.correctionForm.uncertain',
    'electricity.correctionForm.validationUnavailable',
    'electricity.staffReasonForm.help',
    'electricity.staffReasonForm.invalid',
    'electricity.staffReasonForm.retry',
    'electricity.staffReasonForm.uncertain',
    'electricity.staffReasonForm.validationUnavailable',
  ]);
  for (const key of keys) {
    expect(t(key, 'en')).not.toBe(key);
    expect(t(key, 'fa')).not.toBe(key);
    expect(t(key, 'en')).not.toBe(t(key, 'fa'));
  }
  expect(t('electricity.staffReasonForm.help', 'en')).toContain('Approval does not use');
  expect(t('electricity.staffReasonForm.invalid', 'en')).toContain('1,000');
  expect(t('electricity.correctionForm.uncertain', 'en')).toContain('same correction');
});
