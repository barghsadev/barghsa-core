import { expect, it } from 'vitest';
import { tConsultation } from './consultation.js';
it('provides distinct bilingual owned form help, limits and honest recovery', () => {
  const keys = [
    'intakeForm',
    'productInvalid',
    'productHelp',
    'confirmationInvalid',
    'confirmationHelp',
    'intakeUnconfirmed',
    'informationInvalid',
    'informationHelp',
    'informationUnconfirmed',
    'informationReload',
    'validationUnavailable',
    'reasonFormTitle',
    'reasonInvalid2000',
    'paidReasonInvalid1000',
    'reasonHelp',
    'paidReasonHelp',
    'actionUnconfirmed',
  ];
  for (const key of keys) {
    expect(tConsultation(key, 'en')).not.toBe(key);
    expect(tConsultation(key, 'fa')).not.toBe(key);
    expect(tConsultation(key, 'en')).not.toBe(tConsultation(key, 'fa'));
  }
  expect(tConsultation('reasonInvalid2000', 'en')).toContain('2,000');
  expect(tConsultation('paidReasonInvalid1000', 'en')).toContain('1,000');
  expect(tConsultation('intakeUnconfirmed', 'en')).toContain('same request');
  expect(tConsultation('informationUnconfirmed', 'en')).toContain('before sending again');
});
