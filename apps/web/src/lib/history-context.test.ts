import { expect, it } from 'vitest';
import { historyContextText } from './history-context.js';
it('uses recorded context and gives missing/unrecognised history an honest bilingual label', () => {
  expect(historyContextText('customer', 'en')).toBe('Customer mode');
  expect(historyContextText('staff', 'fa')).toBe('حالت کارمندی');
  for (const value of [null, undefined, 'admin', {}, true, 'unknown']) {
    expect(historyContextText(value, 'en')).toBe('Context not recorded');
    expect(historyContextText(value, 'fa')).toBe('زمینه فعالیت ثبت نشده');
  }
});
