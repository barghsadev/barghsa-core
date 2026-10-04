import { expect, it } from 'vitest';
import { ErrorCodes } from '@barghsa/shared/errors';
import { commentFormSchema } from './order-comment-form-schemas.js';
import {
  parseCommentPage,
  prependCommentPage,
  matchedCommentReceipt,
  definitiveCommentRejection,
  publicCommentError,
} from './order-comment-form.js';

const orderId = '11111111-1111-4111-8111-111111111111';
const actor = '22222222-2222-4222-8222-222222222222';
const row = (id = '99999999-9999-4999-8999-999999999999') => ({
  id,
  orderId,
  authorUserId: actor,
  authorName: 'account@example.test',
  authorRole: 'customer',
  body: 'Message',
  visibility: 'public',
  createdAt: '2026-10-05T10:00:00.123Z',
});
const messages = { body: 'Body invalid', visibility: 'Visibility invalid' };

it('checks trimmed body bounds and validates visibility only for electricity staff', () => {
  const schema = commentFormSchema(true, messages);
  const raw = { body: `  ${'x'.repeat(10_000)}  `, visibility: 'internal' };
  expect(schema.parse(raw)).toEqual(raw);
  expect(schema.safeParse({ ...raw, body: 'x'.repeat(10_001) }).success).toBe(false);
  expect(schema.safeParse({ body: ' \n ', visibility: 'public' }).success).toBe(false);
  expect(schema.safeParse({ body: 'Message', visibility: '' }).success).toBe(false);
  expect(schema.safeParse({ body: 'Message', visibility: 'unknown' }).success).toBe(false);
  expect(
    commentFormSchema(false, messages).parse({ body: ' Message ', visibility: 'internal' })
  ).toEqual({ body: ' Message ', visibility: 'internal' });
});

it('validates complete visible pages while preserving equal-millisecond server order', () => {
  const first = row();
  const second = row('33333333-3333-4333-8333-333333333333');
  const page = { comments: [first, second], nextBefore: first.id };
  expect(
    parseCommentPage(page, 'electricity', orderId, false)?.comments.map((item) => item.id)
  ).toEqual([first.id, second.id]);
  for (const changed of [
    { ...first, orderId: actor },
    { ...first, authorUserId: '' },
    { ...first, authorRole: 'unknown' },
    { ...first, authorName: null },
    { ...first, body: '' },
    { ...first, createdAt: '2026-02-30T00:00:00.000Z' },
    { ...first, visibility: 'internal' },
    { ...first, visibility: ['public'] },
  ])
    expect(
      parseCommentPage({ comments: [changed], nextBefore: null }, 'electricity', orderId, false)
    ).toBeNull();
  expect(
    parseCommentPage({ comments: [first, first], nextBefore: null }, 'electricity', orderId, true)
  ).toBeNull();
  expect(
    parseCommentPage({ comments: [first], nextBefore: actor }, 'electricity', orderId, true)
  ).toBeNull();
  expect(
    parseCommentPage(
      { comments: [first, { ...second, createdAt: '2026-10-04T00:00:00.000Z' }], nextBefore: null },
      'electricity',
      orderId,
      true
    )
  ).toBeNull();
});

it('retains chronological older pages and rejects overlaps without inventing same-millisecond UUID ordering', () => {
  const older = row();
  const current = row('33333333-3333-4333-8333-333333333333');
  const left = parseCommentPage(
    { comments: [older], nextBefore: null },
    'electricity',
    orderId,
    true
  )!;
  const right = parseCommentPage(
    { comments: [current], nextBefore: null },
    'electricity',
    orderId,
    true
  )!;
  expect(prependCommentPage(left.comments, right.comments)?.map((item) => item.id)).toEqual([
    older.id,
    current.id,
  ]);
  expect(prependCommentPage(left.comments, left.comments)).toBeNull();
  expect(
    prependCommentPage(
      [{ ...left.comments[0]!, createdAt: '2026-10-06T00:00:00.000Z' }],
      right.comments
    )
  ).toBeNull();
});

it('requires full actor/body/visibility/time receipt evidence and permits staff accounts in customer context', () => {
  const expected = { kind: 'electricity' as const, orderId, actor, staff: false, body: 'Message' };
  expect(matchedCommentReceipt(row(), expected)?.id).toBe(row().id);
  expect(
    matchedCommentReceipt({ ...row(), authorUserId: 'buyer' }, { ...expected, actor: 'buyer' })
      ?.authorUserId
  ).toBe('buyer');
  expect(matchedCommentReceipt({ ...row(), authorRole: 'staff' }, expected)?.authorRole).toBe(
    'staff'
  );
  for (const changed of [
    { ...row(), authorUserId: orderId },
    { ...row(), body: 'Different' },
    { ...row(), id: 'bad' },
    { ...row(), createdAt: 'bad' },
    { ...row(), visibility: 'internal' },
  ])
    expect(matchedCommentReceipt(changed, expected)).toBeNull();
  expect(
    matchedCommentReceipt(row(), { ...expected, staff: true, visibility: 'public' })
  ).toBeNull();
  expect(
    matchedCommentReceipt(
      { ...row(), authorRole: 'staff', visibility: 'internal' },
      { ...expected, staff: true, visibility: 'internal' }
    )
  ).not.toBeNull();
});

it('keeps saving rows and commands free of visibility metadata', () => {
  const { visibility: _visibility, ...saving } = row();
  const expected = { kind: 'saving' as const, orderId, actor, staff: false, body: 'Message' };
  expect(matchedCommentReceipt(saving, expected)).toEqual(saving);
  expect(
    parseCommentPage({ comments: [saving], nextBefore: null }, 'saving', orderId, false)
  ).not.toBeNull();
  expect(matchedCommentReceipt(row(), expected)).toBeNull();
});

it('accepts only complete known public rejection envelopes', () => {
  const error = {
    code: ErrorCodes.VALIDATION_INPUT_INVALID.code,
    message: 'Invalid',
    correlationId: actor,
    fields: ['body'],
  };
  expect(definitiveCommentRejection({ error })).toEqual(error);
  expect(
    definitiveCommentRejection({ error: { ...error, code: 'VALIDATION:INPUT_INVALID' } })
  ).not.toBeNull();
  expect(definitiveCommentRejection({ error: { code: error.code, fields: ['body'] } })).toBeNull();
  expect(definitiveCommentRejection({ error: { ...error, code: 'UNKNOWN' } })).toBeNull();
  expect(
    publicCommentError({ error: { ...error, code: ErrorCodes.NOT_FOUND_RESOURCE.code } })?.code
  ).toBe(ErrorCodes.NOT_FOUND_RESOURCE.code);
});
