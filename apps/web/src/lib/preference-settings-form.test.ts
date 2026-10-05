import { expect, it } from 'vitest';
import {
  notificationSettings,
  notificationValues,
  notificationBody,
  notificationConfirmed,
  marketingSettings,
  marketingValues,
  marketingConfirmed,
  timezoneSettings,
} from './preference-settings-form.js';
import {
  notificationSettingsSchema,
  marketingSettingsSchema,
  timezoneSettingsSchema,
} from './preference-settings-form-schemas.js';
const copy = (key: string) => key;
it('accepts actual notification projections while rejecting duplicate, unavailable and missing mandatory channels', () => {
  const valid = notificationSettings({
    channels: ['EMAIL', 'IN_APP'],
    availableChannels: ['IN_APP', 'EMAIL'],
    secret: 'private',
  })!;
  expect(valid).toEqual({ channels: ['EMAIL', 'IN_APP'], availableChannels: ['IN_APP', 'EMAIL'] });
  for (const channels of [['EMAIL'], ['IN_APP', 'IN_APP'], ['IN_APP', 'SMS']])
    expect(notificationSettings({ channels, availableChannels: ['IN_APP', 'EMAIL'] })).toBeNull();
  const raw = notificationValues(valid);
  expect(notificationBody(raw)).toEqual({ channels: ['IN_APP', 'EMAIL'] });
  expect(notificationConfirmed(valid, raw)).toBe(true);
  expect(notificationConfirmed(valid, { ...raw, SMS: true })).toBe(false);
});
it('validates offered notification choices without changing raw boolean values', () => {
  const schema = notificationSettingsSchema(copy, ['IN_APP', 'EMAIL']);
  const raw = { IN_APP: true, EMAIL: false, SMS: false };
  expect(schema.safeParse(raw).success).toBe(true);
  expect(schema.safeParse({ ...raw, SMS: true }).success).toBe(false);
  expect(schema.safeParse({ ...raw, IN_APP: false }).success).toBe(false);
  expect(raw).toEqual({ IN_APP: true, EMAIL: false, SMS: false });
});
it('accepts actual marketing dates and proves both captured channels without leaking extra source data', () => {
  const value = marketingSettings({
    channels: {
      email: { optedIn: true, lastChangedAt: '2026-10-01T00:00:00Z', private: 'hidden' },
      sms: { optedIn: false, lastChangedAt: null },
    },
  })!;
  expect(JSON.stringify(value)).not.toContain('hidden');
  expect(marketingConfirmed(value, marketingValues(value))).toBe(true);
  expect(marketingConfirmed(value, { email: true, sms: true })).toBe(false);
  expect(
    marketingSettings({
      channels: {
        email: { optedIn: false, lastChangedAt: 'invalid' },
        sms: { optedIn: false, lastChangedAt: null },
      },
    })
  ).toBeNull();
});
it('does not coerce marketing choices', () => {
  const schema = marketingSettingsSchema(copy);
  expect(schema.safeParse({ email: false, sms: true }).success).toBe(true);
  expect(schema.safeParse({ email: 'false', sms: true }).success).toBe(false);
});
it('validates real timezone receipts but constrains new drafts to offered values', () => {
  expect(timezoneSettings({ timezone: 'UTC', secret: 'private' })).toEqual({ timezone: 'UTC' });
  expect(timezoneSettings({ timezone: 'not/a-zone' })).toBeNull();
  const schema = timezoneSettingsSchema(copy, ['Asia/Tehran', 'Europe/Istanbul']);
  expect(schema.safeParse({ timezone: 'Europe/Istanbul' }).success).toBe(true);
  expect(schema.safeParse({ timezone: 'UTC' }).success).toBe(false);
  expect(schema.safeParse({ timezone: ' Europe/Istanbul ' }).success).toBe(false);
});
