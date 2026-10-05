import type { Ticket, TicketStatus } from '../components/TicketQueueRecords.js';
import { documentUrl } from './documents.js';
export interface TicketIntakeValues {
  subject: string;
  body: string;
  category: string;
  priority: string;
  profileId: string;
  record: string;
  files: File[];
}
export interface TicketReplyValues {
  body: string;
  files: File[];
}
export interface TicketStatusValues {
  status: string;
  reason: string;
}
export interface TicketAssignmentValues {
  teamId: string;
  assigneeId: string;
}
export type TicketOwner =
  'intake' | 'reply-public' | 'reply-internal' | 'status' | 'assignment' | 'reopen' | 'closure';
export interface TicketCoordination {
  claim(owner: TicketOwner): boolean;
  release(owner: TicketOwner): void;
  isLocked(owner?: TicketOwner): boolean;
  isCurrent(): boolean;
  denied(): void;
}
export interface TicketCommand {
  owner: TicketOwner;
  path: string;
  method: 'POST' | 'PATCH' | 'PUT';
  status: 200 | 201;
  body: Record<string, unknown>;
  confirmed(value: unknown): boolean;
  accepted(value: unknown): void | Promise<void>;
  fields?: ((names: unknown[]) => boolean) | undefined;
}
export type TicketCommandSender = (command: TicketCommand) => Promise<boolean>;
export const ticketStatuses = [
  'open',
  'in_progress',
  'waiting_customer',
  'waiting_staff',
  'resolved',
  'closed',
] as const;
export const ticketTransitions: Record<TicketStatus, TicketStatus[]> = {
  open: ['in_progress'],
  in_progress: ['waiting_customer', 'waiting_staff', 'resolved'],
  waiting_customer: ['in_progress'],
  waiting_staff: ['in_progress'],
  resolved: ['closed'],
  closed: [],
};
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const account = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v.length <= 512;
const reference = (v: unknown) => v === null || uuid(v);
const date = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(v) &&
  Number.isFinite(Date.parse(v));
const sealed = (v: unknown, prefix: string): v is string =>
  typeof v === 'string' &&
  new RegExp(
    `^${prefix}/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{64}$`,
    'i'
  ).test(v);
export function ticketRecord(value: unknown, expectedId?: string): Ticket | null {
  if (
    !object(value) ||
    !uuid(value.id) ||
    (expectedId !== undefined && value.id !== expectedId) ||
    !account(value.userId) ||
    typeof value.subject !== 'string' ||
    !value.subject.trim() ||
    value.subject.length > 200 ||
    typeof value.body !== 'string' ||
    value.body.length > 10000 ||
    typeof value.category !== 'string' ||
    !['general', 'billing', 'orders', 'privacy'].includes(value.category) ||
    typeof value.priority !== 'string' ||
    !['normal', 'high'].includes(value.priority) ||
    !ticketStatuses.includes(value.status as TicketStatus) ||
    !reference(value.profileId) ||
    !reference(value.relatedEntityId) ||
    ![null, 'order', 'contract', 'invoice'].includes(value.relatedEntityType as string | null) ||
    !reference(value.assignedTeamId) ||
    !(value.assignedTo === null || account(value.assignedTo)) ||
    !date(value.createdAt) ||
    !date(value.updatedAt) ||
    !Array.isArray(value.attachments) ||
    value.attachments.length > 5 ||
    !value.attachments.every((key) => sealed(key, 'ticket-attachments')) ||
    new Set(value.attachments).size !== value.attachments.length
  )
    return null;
  if (
    Boolean(value.relatedEntityId) !== Boolean(value.relatedEntityType) ||
    (value.relatedEntityId && !value.profileId)
  )
    return null;
  return value as unknown as Ticket;
}
function sameTicket(receipt: Ticket, source: Ticket) {
  return (
    receipt.id === source.id &&
    receipt.userId === source.userId &&
    receipt.profileId === source.profileId &&
    receipt.subject === source.subject &&
    receipt.body === source.body &&
    receipt.category === source.category &&
    receipt.priority === source.priority &&
    receipt.relatedEntityId === source.relatedEntityId &&
    receipt.relatedEntityType === source.relatedEntityType &&
    JSON.stringify(receipt.attachments) === JSON.stringify(source.attachments)
  );
}
export function ticketIntakeReceipt(
  value: unknown,
  actor: string,
  body: Record<string, unknown>
): value is Ticket {
  const receipt = ticketRecord(value);
  return (
    !!receipt &&
    receipt.userId === actor &&
    receipt.subject === body.subject &&
    receipt.body === body.body &&
    receipt.category === body.category &&
    receipt.priority === body.priority &&
    receipt.profileId === (body.profileId ?? null) &&
    receipt.relatedEntityId === (body.relatedEntityId ?? null) &&
    receipt.relatedEntityType === (body.relatedEntityType ?? null) &&
    receipt.attachments.length ===
      (Array.isArray(body.attachments) ? body.attachments.length : 0) &&
    ((receipt.status === 'open' && receipt.assignedTo === null) ||
      (receipt.status === 'in_progress' && receipt.assignedTo !== null))
  );
}
export function ticketStatusReceipt(value: unknown, source: Ticket, status: string): boolean {
  const receipt = ticketRecord(value, source.id);
  return !!receipt && sameTicket(receipt, source) && receipt.status === status;
}
export function ticketAssignmentReceipt(
  value: unknown,
  source: Ticket,
  assigneeId: string,
  teamId: string
): boolean {
  const receipt = ticketRecord(value, source.id);
  return (
    !!receipt &&
    sameTicket(receipt, source) &&
    receipt.assignedTo === assigneeId &&
    receipt.assignedTeamId === (teamId || null) &&
    receipt.status !== 'open'
  );
}
export function ticketReplyReceipt(
  value: unknown,
  ticketId: string,
  actor: string,
  staff: boolean,
  body: Record<string, unknown>
): boolean {
  if (
    !object(value) ||
    !uuid(value.id) ||
    value.ticketId !== ticketId ||
    value.authorId !== actor ||
    value.body !== body.body ||
    value.visibility !== body.visibility ||
    value.bodyFormat !== body.bodyFormat ||
    value.authorContext !== (staff ? 'staff' : 'customer') ||
    !date(value.createdAt) ||
    !date(value.updatedAt) ||
    !Number.isSafeInteger(value.attachmentCount) ||
    value.attachmentCount !== (Array.isArray(body.attachments) ? body.attachments.length : 0) ||
    !Array.isArray(value.attachments) ||
    value.attachments.length > Number(value.attachmentCount)
  )
    return false;
  const indices = new Set<number>(),
    keys = new Set<string>();
  for (const file of value.attachments) {
    if (
      !object(file) ||
      !sealed(file.key, 'ticket-reply-attachments') ||
      keys.has(file.key) ||
      typeof file.fileName !== 'string' ||
      !file.fileName ||
      typeof file.contentType !== 'string' ||
      !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.contentType) ||
      !Number.isSafeInteger(file.fileIndex) ||
      Number(file.fileIndex) < 0 ||
      Number(file.fileIndex) >= Number(value.attachmentCount) ||
      indices.has(Number(file.fileIndex)) ||
      typeof file.url !== 'string'
    )
      return false;
    try {
      documentUrl(file.url);
    } catch {
      return false;
    }
    indices.add(Number(file.fileIndex));
    keys.add(file.key);
  }
  return (
    value.author === null ||
    (object(value.author) &&
      (value.author.displayName === null || typeof value.author.displayName === 'string') &&
      (value.author.avatarUrl === null || typeof value.author.avatarUrl === 'string'))
  );
}
export interface TicketOptions {
  profiles: { id: string; title: string | null }[];
  records: { id: string; type: string; created_at: string }[];
  hasMoreRecords?: boolean;
}
export interface TicketTeam {
  id: string;
  name: string;
  members: string[];
}
export interface TicketAssignee {
  id: string;
  name: string;
}
export function ticketOptions(value: unknown): TicketOptions | null {
  if (
    !object(value) ||
    !Array.isArray(value.profiles) ||
    !Array.isArray(value.records) ||
    !(value.hasMoreRecords === undefined || typeof value.hasMoreRecords === 'boolean')
  )
    return null;
  if (
    !value.profiles.every(
      (p) => object(p) && uuid(p.id) && (p.title === null || typeof p.title === 'string')
    ) ||
    !value.records.every(
      (r) =>
        object(r) &&
        uuid(r.id) &&
        typeof r.type === 'string' &&
        ['order', 'contract', 'invoice'].includes(r.type) &&
        date(r.created_at)
    ) ||
    new Set(value.profiles.map((p) => p.id)).size !== value.profiles.length ||
    new Set(value.records.map((r) => r.type + ':' + r.id)).size !== value.records.length
  )
    return null;
  return value as unknown as TicketOptions;
}
export function ticketAssignmentOptions(
  people: unknown,
  groups: unknown
): { people: TicketAssignee[]; groups: TicketTeam[] } | null {
  if (
    !Array.isArray(people) ||
    !Array.isArray(groups) ||
    !people.every((p) => object(p) && account(p.id) && typeof p.name === 'string') ||
    !groups.every(
      (g) =>
        object(g) &&
        uuid(g.id) &&
        typeof g.name === 'string' &&
        Array.isArray(g.members) &&
        g.members.every(account) &&
        new Set(g.members).size === g.members.length
    ) ||
    new Set(people.map((p) => p.id)).size !== people.length ||
    new Set(groups.map((g) => g.id)).size !== groups.length
  )
    return null;
  return { people: people as TicketAssignee[], groups: groups as TicketTeam[] };
}
