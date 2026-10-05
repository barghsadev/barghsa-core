import { z } from 'zod/mini';
import type {
  NotificationChannel,
  NotificationValues,
  MarketingValues,
  TimezoneValues,
} from './preference-settings-form.js';
type Copy = (key: string) => string;
const issue = (path: string, message: string, input: unknown) => ({
  code: 'custom' as const,
  path: [path],
  message,
  input,
});
export function notificationSettingsSchema(copy: Copy, available: readonly NotificationChannel[]) {
  return z.custom<NotificationValues>().check((ctx) => {
    const raw = ctx.value;
    for (const key of ['IN_APP', 'EMAIL', 'SMS'] as const)
      if (
        !raw ||
        typeof raw[key] !== 'boolean' ||
        (key === 'IN_APP' ? raw[key] !== true : raw[key] && !available.includes(key))
      )
        ctx.issues.push(issue(key, copy('channelInvalid'), raw?.[key]));
  });
}
export function marketingSettingsSchema(copy: Copy) {
  return z.custom<MarketingValues>().check((ctx) => {
    for (const key of ['email', 'sms'] as const)
      if (!ctx.value || typeof ctx.value[key] !== 'boolean')
        ctx.issues.push(issue(key, copy('consentInvalid'), ctx.value?.[key]));
  });
}
export function timezoneSettingsSchema(copy: Copy, offered: readonly string[]) {
  return z.custom<TimezoneValues>().check((ctx) => {
    if (
      !ctx.value ||
      typeof ctx.value.timezone !== 'string' ||
      !offered.includes(ctx.value.timezone)
    )
      ctx.issues.push(issue('timezone', copy('timezoneInvalid'), ctx.value?.timezone));
  });
}

export function inactivePreferenceSettingsSchema<Values>() {
  return z.custom<Values>().check((ctx) => {
    ctx.issues.push(issue('root', '', ctx.value));
  });
}
