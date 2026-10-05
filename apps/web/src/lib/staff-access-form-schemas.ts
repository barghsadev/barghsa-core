import { z } from 'zod/mini';

export interface StaffCreationDraft {
  username: string;
  firstName: string;
  lastName: string;
  roleIds: string[];
  activationMethod: 'link' | 'tempPassword';
}
export interface StaffRoleDraft {
  roleIds: string[];
  reason: string;
}

export function staffCreationSchema(
  messages: Record<keyof StaffCreationDraft, string>,
  availableRoles: string[]
) {
  return z.custom<StaffCreationDraft>().check((ctx) => {
    const value = ctx.value;
    const issue = (field: keyof StaffCreationDraft) =>
      ctx.issues.push({
        code: 'custom',
        input: value[field],
        path: [field],
        message: messages[field],
      });
    const username = value.username.trim().toLowerCase();
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username);
    if (!username || username.length > 255 || !(email || /^\+[1-9]\d{6,14}$/.test(username)))
      issue('username');
    for (const field of ['firstName', 'lastName'] as const)
      if (!value[field].trim() || value[field].trim().length > 100) issue(field);
    if (value.roleIds.length > 50 || value.roleIds.some((id) => !availableRoles.includes(id)))
      issue('roleIds');
    if (
      !['link', 'tempPassword'].includes(value.activationMethod) ||
      (value.activationMethod === 'link' && !email)
    )
      issue('activationMethod');
  });
}

export function staffRoleSchema(
  messages: Record<keyof StaffRoleDraft, string>,
  availableRoles: string[]
) {
  return z.custom<StaffRoleDraft>().check((ctx) => {
    const value = ctx.value;
    for (const field of ['roleIds', 'reason'] as const) {
      const invalid =
        field === 'reason'
          ? !value.reason.trim() || value.reason.trim().length > 500
          : value.roleIds.some((id) => !availableRoles.includes(id));
      if (invalid)
        ctx.issues.push({
          code: 'custom',
          input: value[field],
          path: [field],
          message: messages[field],
        });
    }
  });
}

export function staffLookupSchema(message: string) {
  return z.custom<{ staffUserId: string }>().check((ctx) => {
    if (!ctx.value.staffUserId.trim())
      ctx.issues.push({
        code: 'custom',
        input: ctx.value.staffUserId,
        path: ['staffUserId'],
        message,
      });
  });
}
