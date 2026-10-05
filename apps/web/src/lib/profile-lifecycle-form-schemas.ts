import { z } from 'zod/mini';
import type { ClosureValues } from './profile-lifecycle-form.js';
export const inactiveClosureSchema = z.custom<ClosureValues>();
export function profileClosureSchema(
  copy: (key: 'confirmationRequired' | 'passwordRequired') => string
) {
  return z.custom<ClosureValues>().check((ctx) => {
    if (ctx.value?.confirmed !== true)
      ctx.issues.push({
        code: 'custom',
        input: ctx.value?.confirmed,
        path: ['confirmed'],
        message: copy('confirmationRequired'),
      });
    if (typeof ctx.value?.password !== 'string' || !ctx.value.password)
      ctx.issues.push({
        code: 'custom',
        input: ctx.value?.password,
        path: ['password'],
        message: copy('passwordRequired'),
      });
  });
}
