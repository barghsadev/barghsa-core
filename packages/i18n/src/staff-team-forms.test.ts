import { expect, it } from 'vitest';
import { fa, en, tStaffTeams } from './staff-team-forms.js';
import { fa as originalFa, en as originalEn } from './admin-ui.js';

const revisedTeamCopy = new Set([
  'admin.teams.leadHelp',
  'admin.teams.tagsHelp',
  'admin.teams.memberError',
  'admin.teams.fallbackHelp',
]);

it('has matching bilingual route copy and preserves team labels outside the revised guidance', () => {
  expect(Object.keys(fa).sort()).toEqual(Object.keys(en).sort());
  for (const [original, current] of [
    [originalFa, fa],
    [originalEn, en],
  ] as const)
    for (const [key, value] of Object.entries(original))
      if (key.startsWith('admin.teams.') && !revisedTeamCopy.has(key))
        expect(current[key], key).toBe(value);
  for (const key of revisedTeamCopy) {
    expect(en[key]?.trim(), key).toBeTruthy();
    expect(fa[key]?.trim(), key).toBeTruthy();
    expect(fa[key], key).not.toBe(en[key]);
  }
  expect(en['admin.teams.leadHelp']).toContain('administrators get the alert');
  expect(en['admin.teams.tagsHelp']).toContain('up to 20 tags');
  expect(en['admin.teams.fallbackHelp']).toContain('Work stays unassigned');
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
