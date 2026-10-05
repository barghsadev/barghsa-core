import { expect, it } from 'vitest';
import { en, fa, tTicketForms } from './ticket-forms.js';
it('provides matching English and Persian ticket form messages', () => {
  expect(Object.keys(en).sort()).toEqual(Object.keys(fa).sort());
  for (const key of Object.keys(en)) {
    expect(tTicketForms(key, 'en')).toBe(en[key]);
    expect(tTicketForms(key, 'fa')).toBe(fa[key]);
    expect(fa[key]).toMatch(/[آ-ی]/);
  }
});
