import { z } from 'zod/mini';
import type { CommentDraft } from './order-comment-form.js';

export const inactiveCommentSchema = z.custom<CommentDraft>();
export function commentFormSchema(
  staffVisibility: boolean,
  messages: Record<keyof CommentDraft, string>
) {
  return z.custom<CommentDraft>().check((ctx) => {
    const values = ctx.value;
    const invalid = (name: keyof CommentDraft) =>
      ctx.issues.push({
        code: 'custom',
        input: values?.[name],
        path: [name],
        message: messages[name],
      });
    if (
      typeof values?.body !== 'string' ||
      !values.body.trim() ||
      values.body.trim().length > 10_000
    )
      invalid('body');
    if (staffVisibility && !['public', 'internal'].includes(values?.visibility))
      invalid('visibility');
  });
}
