import { expect, it } from 'vitest';
import { documentText, en, fa } from './documents.js';

it('provides a nonempty Persian and English label for every document control and state', () => {
  expect(Object.keys(fa).sort()).toEqual(Object.keys(en).sort());
  for (const key of Object.keys(en)) {
    expect(documentText(key, 'en')).toBe(en[key as keyof typeof en]);
    expect(documentText(key, 'fa')).toBe(fa[key as keyof typeof fa]);
    expect(documentText(key, 'en').trim()).not.toBe('');
    expect(documentText(key, 'fa')).toMatch(/[\u0600-\u06ff]/);
  }
  expect(documentText('unknown-key', 'en')).toBe('unknown-key');
});
