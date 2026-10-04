import { expect, it } from 'vitest';
import {
  matchesMembership,
  memberIdsBasis,
  type MembershipCommand,
} from './catalogue-membership.js';
const group = '01900000-0000-7000-8000-000000000001',
  member = '01900000-0000-7000-8000-000000000002',
  other = '01900000-0000-7000-8000-000000000003';
const command: MembershipCommand = {
  groupId: group,
  memberId: member,
  expected: 'present',
  choicesRequired: true,
};
it('verifies fresh membership presence and absence with exact group identity', () => {
  expect(matchesMembership({ id: group, members: [{ id: member }] }, command)).toBe(true);
  expect(matchesMembership({ id: other, members: [{ id: member }] }, command)).toBe(false);
  expect(matchesMembership({ id: group, members: [] }, command)).toBe(false);
  expect(matchesMembership({ id: group, members: [] }, { ...command, expected: 'absent' })).toBe(
    true
  );
  expect(
    matchesMembership({ id: group, members: [{ id: member }] }, { ...command, expected: 'absent' })
  ).toBe(false);
});
it.each([null, -12, 0, 1000])('requires exact stored priority override %s', (expected) => {
  const value = { id: group, members: [{ id: member, priorityOverride: expected }] };
  expect(matchesMembership(value, { ...command, expected })).toBe(true);
  expect(
    matchesMembership({ id: group, members: [{ id: member }] }, { ...command, expected })
  ).toBe(false);
  expect(matchesMembership(value, { ...command, expected: expected === null ? 0 : null })).toBe(
    false
  );
});
it.each([
  {},
  { id: group, members: [{ id: '' }] },
  { id: group },
  { id: group, members: [{}] },
  { id: group, members: [{ id: member }, { id: member }] },
])('rejects incomplete or ambiguous detail %#', (value) => {
  expect(matchesMembership(value, command)).toBe(false);
});
it('ignores member order and presentation metadata in the membership basis', () => {
  expect(memberIdsBasis([{ id: 'a' }, { id: 'b' }])).toBe(
    memberIdsBasis([{ id: 'b' }, { id: 'a' }])
  );
});
