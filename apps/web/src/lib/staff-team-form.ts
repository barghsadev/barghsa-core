import {
  STAFF_ASSIGNMENT_WORK_TYPES,
  validateStaffAssignmentRules,
  validateStaffTeamInput,
  toStaffAssignmentRules,
  type StaffAssignmentRules,
  type StaffTeamInput,
} from '@barghsa/shared/admin';
import { record } from './catalogue-form.js';

export interface Team extends StaffTeamInput {
  id: string;
  isActive: boolean;
}
export interface Member {
  id: string;
  name: string;
  eligible?: boolean;
}
/** Search items are implicitly eligible; selected rows report eligibility explicitly. */
export const memberBasis = (member: Member) =>
  JSON.stringify([member.id, member.name, member.eligible ?? true]);
export interface TeamDraft {
  name: string;
  description: string;
  tags: string;
  members: string[];
  leadUserId: string | null;
}
export interface RoutingDraft {
  ticketRule: StaffAssignmentRules['ticket'];
  verificationCaseRule: StaffAssignmentRules['verification_case'];
}
export const ruleField = (type: keyof StaffAssignmentRules) =>
  type === 'ticket' ? 'ticketRule' : 'verificationCaseRule';
export const routingValues = (rules: StaffAssignmentRules): RoutingDraft => ({
  ticketRule: structuredClone(rules.ticket),
  verificationCaseRule: structuredClone(rules.verification_case),
});
export const routingBody = (draft: RoutingDraft): StaffAssignmentRules => ({
  ticket: structuredClone(draft.ticketRule),
  verification_case: structuredClone(draft.verificationCaseRule),
});
export const emptyTeamDraft = (): TeamDraft => ({
  name: '',
  description: '',
  tags: '',
  members: [],
  leadUserId: null,
});
export const teamValues = (team: Team): TeamDraft => ({
  name: team.name,
  description: team.description ?? '',
  tags: team.skillTags.join(', '),
  members: [...team.memberUserIds],
  leadUserId: team.leadUserId ?? null,
});
export const teamBody = (draft: TeamDraft): StaffTeamInput => ({
  name: draft.name.trim(),
  description: draft.description.trim() || null,
  skillTags: draft.tags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean),
  memberUserIds: [...draft.members],
  leadUserId: draft.leadUserId,
});
const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
export function validTeam(value: unknown): value is Team {
  return (
    record(value) &&
    uuid(value.id) &&
    typeof value.isActive === 'boolean' &&
    (value.description === null || typeof value.description === 'string') &&
    Array.isArray(value.skillTags) &&
    Array.isArray(value.memberUserIds) &&
    validateStaffTeamInput(value).ok
  );
}
export function validTeams(value: unknown): value is Team[] {
  return (
    Array.isArray(value) &&
    value.every(validTeam) &&
    new Set(value.map((team) => team.id)).size === value.length
  );
}
export function validMembers(
  value: unknown
): value is { items: Member[]; selected: Member[]; hasMore: boolean } {
  const rows = (list: unknown): list is Member[] =>
    Array.isArray(list) &&
    list.every(
      (row) =>
        record(row) &&
        typeof row.id === 'string' &&
        !!row.id.trim() &&
        typeof row.name === 'string' &&
        !!row.name.trim() &&
        (row.eligible === undefined || typeof row.eligible === 'boolean')
    ) &&
    new Set(list.map((row) => row.id)).size === list.length;
  if (
    !record(value) ||
    !rows(value.items) ||
    !rows(value.selected) ||
    typeof value.hasMore !== 'boolean'
  )
    return false;
  const items = value.items,
    selected = value.selected;
  return selected.every((row) => {
    const item = items.find((candidate) => candidate.id === row.id);
    return !item || (item.name === row.name && (item.eligible ?? true) === (row.eligible ?? true));
  });
}
export function validRouting(value: unknown): value is StaffAssignmentRules {
  return (
    record(value) &&
    validateStaffAssignmentRules(value).ok &&
    STAFF_ASSIGNMENT_WORK_TYPES.every((type) => {
      const rule = value[type];
      return (
        record(rule) &&
        Object.hasOwn(rule, 'teamId') &&
        Object.hasOwn(rule, 'strategy') &&
        (rule.teamId === null || uuid(rule.teamId)) &&
        (!Array.isArray(rule.fallbacks) ||
          rule.fallbacks.every((choice) => record(choice) && uuid(choice.teamId)))
      );
    })
  );
}
const setBasis = (values: string[]) => JSON.stringify([...values].sort());
export const routingBasis = (rules: StaffAssignmentRules) =>
  JSON.stringify(toStaffAssignmentRules(rules));
export const teamBasis = (team: Team) =>
  JSON.stringify([
    team.id,
    team.name,
    team.description,
    setBasis(team.skillTags),
    setBasis(team.memberUserIds),
    team.leadUserId ?? null,
    team.isActive,
  ]);
export function matchesTeamReceipt(body: StaffTeamInput, result: unknown, selected: Team | null) {
  return (
    validTeam(result) &&
    (!selected || result.id === selected.id) &&
    result.isActive === (selected?.isActive ?? true) &&
    result.name === body.name &&
    result.description === body.description &&
    setBasis(result.skillTags) === setBasis(body.skillTags) &&
    setBasis(result.memberUserIds) === setBasis(body.memberUserIds) &&
    (result.leadUserId ?? null) === (body.leadUserId ?? null)
  );
}
export function teamInvalidFields(draft: TeamDraft, eligible: string[]): (keyof TeamDraft)[] {
  const body = teamBody(draft),
    fields: (keyof TeamDraft)[] = [];
  const blank = { name: 'Team', description: null, skillTags: [], memberUserIds: [] };
  if (!validateStaffTeamInput({ ...blank, name: body.name }).ok) fields.push('name');
  if (draft.description.length > 2000) fields.push('description');
  if (!validateStaffTeamInput({ ...blank, skillTags: body.skillTags }).ok) fields.push('tags');
  if (
    !validateStaffTeamInput({ ...blank, memberUserIds: body.memberUserIds }).ok ||
    draft.members.some((id) => !eligible.includes(id))
  )
    fields.push('members');
  if (
    draft.leadUserId !== null &&
    (!draft.members.includes(draft.leadUserId) || !eligible.includes(draft.leadUserId))
  )
    fields.push('leadUserId');
  return fields;
}
export function routingInvalidFields(
  draft: RoutingDraft,
  active: string[]
): (keyof RoutingDraft)[] {
  return STAFF_ASSIGNMENT_WORK_TYPES.filter((type) => {
    const rule = draft[ruleField(type)];
    return (
      !validateStaffAssignmentRules({ [type]: rule }).ok ||
      (rule.teamId !== null && !active.includes(rule.teamId)) ||
      rule.fallbacks?.some((choice) => !active.includes(choice.teamId))
    );
  }).map(ruleField);
}
