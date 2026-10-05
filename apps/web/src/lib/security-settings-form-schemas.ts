import { z } from 'zod/mini';
import type { SecurityPassword } from './security-settings-form.js';
export const inactiveSecurityPasswordSchema = z.custom<SecurityPassword>();
export function securityPasswordSchema(required: boolean, message: string) {
  return z.custom<SecurityPassword>().check((ctx) => {
    if (typeof ctx.value?.password !== 'string' || (required && !ctx.value.password.length))
      ctx.issues.push({ code: 'custom', input: ctx.value?.password, path: ['password'], message });
  });
}
