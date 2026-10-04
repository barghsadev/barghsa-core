import { record } from './catalogue-form.js';
export interface RelationOwner {
  fields: (fields: unknown[]) => boolean;
  verified: (basis: string) => void;
  reset: () => void;
}
export interface MembershipCommand {
  groupId: string;
  memberId: string;
  expected: 'present' | 'absent' | number | null;
  owner?: RelationOwner;
  choicesRequired: boolean;
}
export const memberIdsBasis = (members: { id: string }[]) =>
  JSON.stringify(members.map((row) => row.id).sort());
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function matchesMembership(value: unknown, command: MembershipCommand): boolean {
  if (
    !uuid(command.groupId) ||
    !uuid(command.memberId) ||
    !record(value) ||
    value.id !== command.groupId ||
    !Array.isArray(value.members)
  )
    return false;
  const ids = value.members.map((row) => (record(row) ? row.id : null));
  if (ids.some((id) => !uuid(id)) || new Set(ids).size !== ids.length) return false;
  const member = value.members.find((row) => record(row) && row.id === command.memberId);
  if (command.expected === 'absent') return member === undefined;
  if (!record(member)) return false;
  return command.expected === 'present' || member.priorityOverride === command.expected;
}
