import { ErrorCodes } from '@barghsa/shared/errors';

export type CommentKind = 'saving' | 'electricity';
export type CommentDraft = { body: string; visibility: string };
export interface OrderComment {
  id: string;
  orderId: string;
  authorUserId: string;
  authorName: string;
  authorRole: 'staff' | 'customer';
  body: string;
  createdAt: string;
  visibility?: 'public' | 'internal';
}
export interface CommentPage {
  comments: OrderComment[];
  nextBefore: string | null;
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export const commentUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const instant = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
};
export function parseOrderComment(
  value: unknown,
  kind: CommentKind,
  orderId: string,
  staff: boolean
): OrderComment | null {
  if (
    !record(value) ||
    !commentUuid(value.id) ||
    value.orderId !== orderId ||
    typeof value.authorUserId !== 'string' ||
    !value.authorUserId ||
    typeof value.authorName !== 'string' ||
    (value.authorRole !== 'staff' && value.authorRole !== 'customer') ||
    typeof value.body !== 'string' ||
    value.body !== value.body.trim() ||
    value.body.length < 1 ||
    value.body.length > 10_000 ||
    !instant(value.createdAt) ||
    (kind === 'electricity'
      ? value.visibility !== 'public' && (!staff || value.visibility !== 'internal')
      : Object.hasOwn(value, 'visibility'))
  )
    return null;
  return {
    id: value.id,
    orderId,
    authorUserId: value.authorUserId,
    authorName: value.authorName,
    authorRole: value.authorRole,
    body: value.body,
    createdAt: value.createdAt,
    ...(kind === 'electricity' ? { visibility: value.visibility as 'public' | 'internal' } : {}),
  };
}
export function parseCommentPage(
  value: unknown,
  kind: CommentKind,
  orderId: string,
  staff: boolean
): CommentPage | null {
  if (!record(value) || !Array.isArray(value.comments) || value.comments.length > 50) return null;
  const comments = value.comments.map((row) => parseOrderComment(row, kind, orderId, staff));
  if (
    comments.some((row) => !row) ||
    new Set(comments.map((row) => row?.id)).size !== comments.length ||
    (value.nextBefore !== null &&
      (!commentUuid(value.nextBefore) || !comments.some((row) => row?.id === value.nextBefore)))
  )
    return null;
  const rows = comments.filter((row): row is OrderComment => !!row);
  // The wire timestamp loses database microseconds. Equal-millisecond rows keep server order.
  if (rows.some((row, index) => index > 0 && row.createdAt < rows[index - 1]!.createdAt))
    return null;
  return { comments: rows, nextBefore: value.nextBefore as string | null };
}
export function prependCommentPage(older: OrderComment[], current: OrderComment[]) {
  if (
    older.some((row) => current.some((present) => present.id === row.id)) ||
    (older.length > 0 && current.length > 0 && older.at(-1)!.createdAt > current[0]!.createdAt)
  )
    return null;
  return [...older, ...current];
}
export function matchedCommentReceipt(
  value: unknown,
  expected: {
    kind: CommentKind;
    orderId: string;
    actor: string;
    staff: boolean;
    body: string;
    visibility?: string | undefined;
  }
) {
  const row = parseOrderComment(value, expected.kind, expected.orderId, expected.staff);
  return row &&
    row.authorUserId === expected.actor &&
    (!expected.staff || row.authorRole === 'staff') &&
    row.body === expected.body &&
    (expected.kind !== 'electricity' ||
      row.visibility === (expected.staff ? expected.visibility : 'public'))
    ? row
    : null;
}
export function publicCommentError(value: unknown) {
  if (!record(value) || !record(value.error)) return null;
  const error = value.error;
  return typeof error.code === 'string' &&
    typeof error.message === 'string' &&
    commentUuid(error.correlationId)
    ? error
    : null;
}
export function definitiveCommentRejection(value: unknown) {
  const error = publicCommentError(value);
  return error &&
    [
      ErrorCodes.VALIDATION_INPUT_INVALID.code,
      'VALIDATION:INPUT_INVALID',
      ErrorCodes.CONFLICT_STATE.code,
      ErrorCodes.CONFLICT_VERSION.code,
    ].some((code) => code === error.code)
    ? error
    : null;
}
