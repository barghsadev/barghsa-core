import { HttpException } from '@nestjs/common';
import {
  validateStaffTeamInput,
  validateStaffAssignmentRules,
  STAFF_ASSIGNMENT_WORK_TYPES,
} from '@barghsa/shared/admin';
import { ErrorCodes } from '@barghsa/shared/errors';
import { InputFieldException } from '../common/input-field.exception.js';

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const generic = () => new HttpException({ error: ErrorCodes.VALIDATION_INPUT_INVALID.code }, 400);
/** Preserve partial updates. Only the owned public form field identifiers leave the server. */
export function assertStaffTeamFields(body: unknown, partial = false) {
  const names = {
    name: 'name',
    description: 'description',
    skillTags: 'tags',
    memberUserIds: 'members',
    leadUserId: 'leadUserId',
  };
  if (!record(body) || Object.keys(body).some((key) => !Object.hasOwn(names, key))) throw generic();
  const fields: string[] = [],
    blank = { name: 'Team', description: null, skillTags: [], memberUserIds: [] };
  for (const key of ['name', 'description', 'skillTags', 'memberUserIds'] as const) {
    if (partial && body[key] === undefined) continue;
    if (!validateStaffTeamInput({ ...blank, [key]: body[key] }).ok) fields.push(names[key]);
  }
  if (
    body.leadUserId !== undefined &&
    body.leadUserId !== null &&
    (typeof body.leadUserId !== 'string' ||
      !body.leadUserId.trim() ||
      ((!partial || body.memberUserIds !== undefined) &&
        (!Array.isArray(body.memberUserIds) || !body.memberUserIds.includes(body.leadUserId))))
  )
    fields.push('leadUserId');
  if (fields.length) throw new InputFieldException(fields);
}
export function assertStaffRoutingFields(body: unknown) {
  if (
    !record(body) ||
    Object.keys(body).some((key) => !STAFF_ASSIGNMENT_WORK_TYPES.some((type) => type === key))
  )
    throw generic();
  const fields = STAFF_ASSIGNMENT_WORK_TYPES.filter(
    (type) => !validateStaffAssignmentRules({ [type]: body[type] }).ok
  ).map(
    (type) =>
      ({
        ticket: 'ticketRule',
        verification_case: 'verificationCaseRule',
        consultation: 'consultationRule',
      })[type]
  );
  if (fields.length) throw new InputFieldException(fields);
}
