import { expect, it } from 'vitest';
import { redactAiText } from './ai-prompt-redaction.js';

it.each(['0123456789', '۰۱۲۳۴۵۶۷۸۹', '٠١٢٣٤٥٦٧٨٩'])(
  'redacts unlabelled Iranian IBANs with %s digits without retaining a suffix',
  (alphabet) => {
    const iban = 'IR820540102680020817909002'.replace(
      /[0-9]/g,
      (digit) => alphabet[Number(digit)]!
    );
    expect(redactAiText('حساب ' + iban + ' متعلق به من است')).toEqual({
      text: 'حساب [REDACTED] متعلق به من است',
      categories: ['bank_detail'],
    });
  }
);

it('redacts credentials and bank values while leaving ordinary text intact', () => {
  expect(
    redactAiText(
      'My password is hunter2 and token: abcdefgh. IBAN IR820540102680020817909002 is mine.'
    )
  ).toEqual({
    text: 'My password is [REDACTED] and token: [REDACTED]. IBAN [REDACTED] is mine.',
    categories: ['credential', 'bank_detail'],
  });
  expect(redactAiText('The order has 3 panels and costs 1000 toman')).toEqual({
    text: 'The order has 3 panels and costs 1000 toman',
    categories: [],
  });
});

it('redacts valid Iranian national IDs, Persian digits and bearer tokens', () => {
  const result = redactAiText('ID ۰۰۷۹۰۵۶۸۷۳ and Bearer abcdefghijklmnopqrstuvwxyz');
  expect(result.text).toBe('ID [REDACTED] and [REDACTED]');
  expect(result.categories).toEqual(['credential', 'national_id']);
  expect(redactAiText('Invalid 1234567890').text).toBe('Invalid 1234567890');
  expect(redactAiText('کد ملی: ۱۲۳۴۵۶۷۸۹۰ و رمز عبور: نمونه').text).toBe(
    'کد ملی: [REDACTED] و رمز عبور: [REDACTED]'
  );
});
