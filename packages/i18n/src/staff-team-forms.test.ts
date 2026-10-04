import { expect, it } from 'vitest';
import { fa, en, tStaffTeams } from './staff-team-forms.js';
import { fa as originalFa, en as originalEn } from './admin-ui.js';

it('has matching bilingual route copy and preserves every existing team label', () => {
  expect(Object.keys(fa).sort()).toEqual(Object.keys(en).sort());
  for (const [original, current] of [
    [originalFa, fa],
    [originalEn, en],
  ] as const)
    for (const [key, value] of Object.entries(original))
      if (key.startsWith('admin.teams.')) expect(current![key]).toBe(value);
});
it('resolves field feedback and retained-draft guidance in both languages', () => {
  for (const locale of ['fa', 'en'] as const)
    for (const key of [
      'invalidName',
      'invalidTags',
      'invalidRule',
      'staleTeam',
      'staleRules',
      'unverified',
      'consultation',
    ]) {
      const value = tStaffTeams(`admin.teams.${key}`, locale);
      expect(value).not.toContain('admin.teams.');
      expect(value.trim()).not.toBe('');
    }
});
