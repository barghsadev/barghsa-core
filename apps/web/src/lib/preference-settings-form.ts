export type NotificationChannel = 'IN_APP' | 'EMAIL' | 'SMS';
export type NotificationValues = Record<NotificationChannel, boolean>;
export type MarketingValues = { email: boolean; sms: boolean };
export type TimezoneValues = { timezone: string };
export type NotificationSettings = {
  channels: NotificationChannel[];
  availableChannels: NotificationChannel[];
};
export type MarketingSettings = {
  channels: Record<'email' | 'sms', { optedIn: boolean; lastChangedAt: string | null }>;
};
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const channels = (value: unknown): value is NotificationChannel[] =>
  Array.isArray(value) &&
  value.includes('IN_APP') &&
  value.every((v) => ['IN_APP', 'EMAIL', 'SMS'].includes(v)) &&
  new Set(value).size === value.length;
export function notificationSettings(value: unknown): NotificationSettings | null {
  if (!object(value) || !channels(value.channels) || !channels(value.availableChannels))
    return null;
  const available = value.availableChannels;
  if (value.channels.some((v) => !available.includes(v))) return null;
  return { channels: [...value.channels], availableChannels: [...available] };
}
export function notificationValues(value: NotificationSettings): NotificationValues {
  return {
    IN_APP: true,
    EMAIL: value.channels.includes('EMAIL'),
    SMS: value.channels.includes('SMS'),
  };
}
export function notificationBody(value: NotificationValues) {
  return { channels: (['IN_APP', 'EMAIL', 'SMS'] as const).filter((v) => value[v]) };
}
export function notificationConfirmed(value: NotificationSettings, draft: NotificationValues) {
  const captured = notificationBody(draft).channels;
  return (
    value.channels.length === captured.length && captured.every((v) => value.channels.includes(v))
  );
}
export function marketingSettings(value: unknown): MarketingSettings | null {
  if (!object(value) || !object(value.channels)) return null;
  const result = {} as MarketingSettings['channels'];
  for (const key of ['email', 'sms'] as const) {
    const row = value.channels[key];
    if (
      !object(row) ||
      typeof row.optedIn !== 'boolean' ||
      !(
        row.lastChangedAt === null ||
        (typeof row.lastChangedAt === 'string' && Number.isFinite(Date.parse(row.lastChangedAt)))
      )
    )
      return null;
    result[key] = { optedIn: row.optedIn, lastChangedAt: row.lastChangedAt as string | null };
  }
  return { channels: result };
}
export function marketingValues(value: MarketingSettings): MarketingValues {
  return { email: value.channels.email.optedIn, sms: value.channels.sms.optedIn };
}
export const marketingConfirmed = (value: MarketingSettings, draft: MarketingValues) =>
  value.channels.email.optedIn === draft.email && value.channels.sms.optedIn === draft.sms;
export function timezoneSettings(value: unknown): TimezoneValues | null {
  if (!object(value) || typeof value.timezone !== 'string' || !value.timezone) return null;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value.timezone });
    return { timezone: value.timezone };
  } catch {
    return null;
  }
}
