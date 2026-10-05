import { z } from 'zod/mini';
import type {
  TicketIntakeValues,
  TicketReplyValues,
  TicketStatusValues,
  TicketAssignmentValues,
} from './ticket-form.js';
type Copy = (key: string) => string;
const issue = (path: string, message: string, input: unknown) => ({
  code: 'custom' as const,
  path: [path],
  message,
  input,
});
const text = (value: unknown, max: number) =>
  typeof value === 'string' && !!value.trim() && value.trim().length <= max;
const isFile = (value: unknown): value is File =>
  typeof File !== 'undefined' && value instanceof File;
export const inactiveTicketSchema = z.custom<never>().check((ctx) => {
  ctx.issues.push(issue('root', '', ctx.value));
});
export function ticketIntakeSchema(
  copy: Copy,
  profile: (id: string) => boolean,
  record: (id: string) => boolean,
  file: (value: File) => boolean
) {
  return z.custom<TicketIntakeValues>().check((ctx) => {
    const v = ctx.value;
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      ctx.issues.push(issue('root', copy('validationUnavailable'), v));
      return;
    }
    if (!text(v.subject, 200)) ctx.issues.push(issue('subject', copy('subjectInvalid'), v.subject));
    if (!text(v.body, 10000)) ctx.issues.push(issue('body', copy('bodyInvalid'), v.body));
    if (!['general', 'billing', 'orders', 'privacy'].includes(v.category))
      ctx.issues.push(issue('category', copy('categoryInvalid'), v.category));
    if (!['normal', 'high'].includes(v.priority))
      ctx.issues.push(issue('priority', copy('priorityInvalid'), v.priority));
    if (typeof v.profileId !== 'string' || !profile(v.profileId))
      ctx.issues.push(issue('profileId', copy('profileInvalid'), v.profileId));
    if (typeof v.record !== 'string' || !record(v.record))
      ctx.issues.push(issue('record', copy('recordInvalid'), v.record));
    if (
      !Array.isArray(v.files) ||
      v.files.length > 5 ||
      v.files.some((f) => !isFile(f) || !file(f))
    )
      ctx.issues.push(issue('files', copy('filesInvalid'), v.files));
  });
}
export function ticketReplySchema(copy: Copy, file: (value: File) => boolean) {
  return z.custom<TicketReplyValues>().check((ctx) => {
    const v = ctx.value;
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      ctx.issues.push(issue('root', copy('validationUnavailable'), v));
      return;
    }
    if (typeof v.body !== 'string' || v.body.length > 10000 || (!v.body.trim() && !v.files?.length))
      ctx.issues.push(issue('body', copy('replyInvalid'), v.body));
    if (
      !Array.isArray(v.files) ||
      v.files.length > 5 ||
      v.files.some((f) => !isFile(f) || !file(f))
    )
      ctx.issues.push(issue('files', copy('filesInvalid'), v.files));
  });
}
export function ticketStatusSchema(copy: Copy, offered: () => readonly string[]) {
  return z.custom<TicketStatusValues>().check((ctx) => {
    if (!ctx.value || typeof ctx.value !== 'object' || Array.isArray(ctx.value)) {
      ctx.issues.push(issue('root', copy('validationUnavailable'), ctx.value));
      return;
    }
    if (!offered().includes(ctx.value.status))
      ctx.issues.push(issue('status', copy('statusInvalid'), ctx.value.status));
    if (!text(ctx.value.reason, 2000))
      ctx.issues.push(issue('reason', copy('reasonInvalid'), ctx.value.reason));
  });
}
export function ticketAssignmentSchema(
  copy: Copy,
  team: (id: string) => boolean,
  person: (id: string, teamId: string) => boolean
) {
  return z.custom<TicketAssignmentValues>().check((ctx) => {
    const v = ctx.value;
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      ctx.issues.push(issue('root', copy('validationUnavailable'), v));
      return;
    }
    if (typeof v.teamId !== 'string' || !team(v.teamId))
      ctx.issues.push(issue('teamId', copy('teamInvalid'), v.teamId));
    if (!text(v.assigneeId, 512) || typeof v.teamId !== 'string' || !person(v.assigneeId, v.teamId))
      ctx.issues.push(issue('assigneeId', copy('assigneeInvalid'), v.assigneeId));
  });
}
