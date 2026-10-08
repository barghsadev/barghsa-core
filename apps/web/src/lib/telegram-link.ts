import { settingsUuid } from './settings-form.js';
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is string =>
  typeof v === 'string' && /^[1-9]\d{0,15}$/.test(v) && Number(v) <= 2 ** 52 - 1;
export type TelegramStatus = {
  available: boolean;
  profileId: string;
  link: { id: string; profile_id: string; telegram_user_id: string } | null;
  intent: {
    id: string;
    status: 'pending' | 'claimed';
    telegram_user_id: string | null;
    expires_at: string;
  } | null;
  latestDelivery: {
    status:
      'queued' | 'processing' | 'ready' | 'sending' | 'sent' | 'denied' | 'failed' | 'unknown';
  } | null;
};
export function telegramStatus(value: unknown): TelegramStatus | null {
  if (!object(value) || typeof value.available !== 'boolean' || !settingsUuid(value.profileId))
    return null;
  const link = value.link,
    intent = value.intent;
  if (
    link !== null &&
    (!object(link) ||
      !settingsUuid(link.id) ||
      !settingsUuid(link.profile_id) ||
      !id(link.telegram_user_id))
  )
    return null;
  if (
    intent !== null &&
    (!object(intent) ||
      !settingsUuid(intent.id) ||
      !['pending', 'claimed'].includes(String(intent.status)) ||
      !(intent.status === 'pending'
        ? intent.telegram_user_id === null
        : id(intent.telegram_user_id)) ||
      typeof intent.expires_at !== 'string' ||
      !Number.isFinite(Date.parse(intent.expires_at)))
  )
    return null;
  const latest = value.latestDelivery;
  if (
    latest !== null &&
    (!object(latest) ||
      !['queued', 'processing', 'ready', 'sending', 'sent', 'denied', 'failed', 'unknown'].includes(
        String(latest.status)
      ))
  )
    return null;
  return {
    available: value.available,
    profileId: value.profileId,
    link:
      link === null
        ? null
        : { id: link.id, profile_id: link.profile_id, telegram_user_id: link.telegram_user_id },
    intent:
      intent === null
        ? null
        : {
            id: intent.id,
            status: intent.status,
            telegram_user_id: intent.telegram_user_id,
            expires_at: intent.expires_at,
          },
    latestDelivery: latest === null ? null : { status: latest.status },
  } as TelegramStatus;
}
export function telegramLinkReceipt(value: unknown): { id: string; url: string } | null {
  if (
    !object(value) ||
    !settingsUuid(value.id) ||
    typeof value.url !== 'string' ||
    !/^https:\/\/t\.me\/barghsa_dev_bot\?start=[A-Za-z0-9_-]{43}$/.test(value.url)
  )
    return null;
  return { id: value.id, url: value.url };
}
export function telegramCode(value: string) {
  return value
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - '۰'.charCodeAt(0)))
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - '٠'.charCodeAt(0)))
    .trim();
}
