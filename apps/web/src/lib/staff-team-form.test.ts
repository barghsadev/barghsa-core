import { expect, it } from 'vitest';
import {
  emptyTeamDraft,
  teamBody,
  teamInvalidFields,
  routingInvalidFields,
  routingValues,
  routingBody,
  validTeams,
  validMembers,
  validRouting,
  matchesTeamReceipt,
  teamBasis,
  routingBasis,
} from './staff-team-form.js';
import {
  staffTeam,
  staffTeamId,
  staffMember,
  staffRoutingRules,
} from '../test/staff-directory-fixtures.js';
it.each([
  [{ name: ' ' }, ['name']],
  [{ name: 'a'.repeat(81) }, ['name']],
  [{ description: 'a'.repeat(2001) }, ['description']],
  [{ tags: 'finance, finance' }, ['tags']],
  [{ tags: 'a'.repeat(41) }, ['tags']],
  [{ tags: Array.from({ length: 21 }, (_, i) => String(i)).join(',') }, ['tags']],
  [{ members: ['missing'] }, ['members']],
  [{ members: [staffMember.id, staffMember.id] }, ['members']],
  [{ leadUserId: staffMember.id }, ['leadUserId']],
] as const)('validates owned team fields before capture (%j)', (change, fields) => {
  const draft = {
    ...emptyTeamDraft(),
    name: 'Support',
    ...change,
    members: [...('members' in change ? change.members : [])],
  };
  expect(teamInvalidFields(draft, [staffMember.id])).toEqual(fields);
});
it('captures trimmed values and null descriptions without changing the raw draft', () => {
  const draft = {
    ...emptyTeamDraft(),
    name: ' Support ',
    description: ' ',
    tags: ' finance, billing ',
    members: [staffMember.id],
    leadUserId: staffMember.id,
  };
  expect(teamInvalidFields(draft, [staffMember.id])).toEqual([]);
  expect(teamBody(draft)).toEqual({
    name: 'Support',
    description: null,
    skillTags: ['finance', 'billing'],
    memberUserIds: [staffMember.id],
    leadUserId: staffMember.id,
  });
  expect(draft.tags).toBe(' finance, billing ');
});
it('rejects duplicate, withdrawn and malformed priority chains while preserving manual defaults', () => {
  const active = routingValues({
    ...staffRoutingRules,
    ticket: {
      teamId: staffTeamId,
      strategy: 'load',
      fallbacks: [{ teamId: staffTeamId, strategy: 'expertise' }],
    },
  });
  expect(routingInvalidFields(active, [staffTeamId])).toEqual(['ticketRule']);
  active.ticketRule.fallbacks = [];
  expect(routingInvalidFields(active, [])).toEqual(['ticketRule']);
  expect(routingInvalidFields(routingValues(staffRoutingRules), [])).toEqual([]);
  expect(routingBody(routingValues(staffRoutingRules))).toEqual(staffRoutingRules);
});
it('accepts only complete directory, candidate and configuration reads', () => {
  expect(validTeams([staffTeam])).toBe(true);
  expect(validTeams([staffTeam, staffTeam])).toBe(false);
  expect(validTeams([{ ...staffTeam, description: undefined }])).toBe(false);
  expect(
    validMembers({
      items: [{ id: staffMember.id, name: staffMember.name }],
      selected: [staffMember],
      hasMore: false,
    })
  ).toBe(true);
  expect(validMembers({ items: [staffMember], selected: [], hasMore: false })).toBe(true);
  expect(
    validMembers({ items: [{ ...staffMember, eligible: 'yes' }], selected: [], hasMore: false })
  ).toBe(false);
  expect(
    validMembers({
      items: [staffMember],
      selected: [{ ...staffMember, eligible: false }],
      hasMore: false,
    })
  ).toBe(false);
  expect(validRouting(staffRoutingRules)).toBe(true);
  expect(validRouting({ ticket: {} })).toBe(false);
});
it('checks team receipt identity, members, tags, lead and activity; timestamp and member ordering do not change a basis', () => {
  const body = {
    name: staffTeam.name,
    description: staffTeam.description,
    skillTags: staffTeam.skillTags,
    memberUserIds: staffTeam.memberUserIds,
    leadUserId: staffTeam.leadUserId,
  };
  expect(matchesTeamReceipt(body, staffTeam, staffTeam)).toBe(true);
  for (const change of [
    { id: '33333333-3333-4333-8333-333333333333' },
    { name: 'Other' },
    { isActive: false },
    { skillTags: [] },
    { memberUserIds: [] },
    { leadUserId: null },
  ])
    expect(matchesTeamReceipt(body, { ...staffTeam, ...change }, staffTeam)).toBe(false);
  expect(teamBasis({ ...staffTeam, memberUserIds: [...staffTeam.memberUserIds].reverse() })).toBe(
    teamBasis(staffTeam)
  );
  expect(routingBasis(staffRoutingRules)).toBe(routingBasis(structuredClone(staffRoutingRules)));
});
