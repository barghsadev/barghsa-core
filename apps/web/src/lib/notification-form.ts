import {
  formatWindowTime,
  isValidTimeZone,
  validateWindowConfig,
  validateTemplate,
  type DeliveryWindowConfig,
} from '@barghsa/shared/notifications';
import type { NotificationVariable } from './content-catalogues.js';

export interface NotificationDraft {
  eventKey: string;
  channel: 'email' | 'sms' | 'in_app';
  locale: 'en' | 'fa';
  subject: string;
  bodyTemplate: string;
  variables: string;
}
export const emptyNotificationDraft: NotificationDraft = {
  eventKey: '',
  channel: 'email',
  locale: 'en',
  subject: '',
  bodyTemplate: '',
  variables: '',
};
/** Preserve the editor's established deduplication and legacy variable descriptions. */
export function parseVariablesText(text: string): NotificationVariable[] {
  const out: NotificationVariable[] = [],
    seen = new Set<string>();
  for (const raw of text.split(/[,\n]/)) {
    const entry = raw.trim();
    if (!entry) continue;
    const colon = entry.indexOf(':'),
      name = (colon === -1 ? entry : entry.slice(0, colon)).trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, description: colon === -1 ? null : entry.slice(colon + 1).trim() || null });
  }
  return out;
}
export function notificationInvalidFields(draft: NotificationDraft): (keyof NotificationDraft)[] {
  const fields: (keyof NotificationDraft)[] = [],
    variables = parseVariablesText(draft.variables),
    allowed = variables.map((v) => v.name);
  if (!draft.eventKey || draft.eventKey.length > 100 || /\s/.test(draft.eventKey))
    fields.push('eventKey');
  if (!['email', 'sms', 'in_app'].includes(draft.channel)) fields.push('channel');
  if (!['en', 'fa'].includes(draft.locale)) fields.push('locale');
  if (draft.subject.length > 200 || validateTemplate(draft.subject, allowed).length)
    fields.push('subject');
  if (!draft.bodyTemplate.trim() || validateTemplate(draft.bodyTemplate, allowed).length)
    fields.push('bodyTemplate');
  if (
    draft.variables.split(/[,\n]/).some((raw) => raw.trim() && !raw.split(':')[0]?.trim()) ||
    variables.some((v) => v.name.length > 100 || (v.description?.length ?? 0) > 500)
  )
    fields.push('variables');
  return fields;
}
export interface WindowDraft {
  timezone: string;
  startHour: string;
  endHour: string;
}
export function windowValues(config: DeliveryWindowConfig): WindowDraft {
  return {
    timezone: config.timezone,
    startHour: formatWindowTime(config.startHour),
    endHour: formatWindowTime(config.endHour),
  };
}
function hour(raw: string): number {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(raw)) return NaN;
  return Number(raw.slice(0, 2)) + Number(raw.slice(3)) / 60;
}
export function windowBody(draft: WindowDraft): DeliveryWindowConfig {
  return {
    timezone: draft.timezone,
    startHour: hour(draft.startHour),
    endHour: hour(draft.endHour),
  };
}
export function windowInvalidFields(draft: WindowDraft): (keyof WindowDraft)[] {
  const fields: (keyof WindowDraft)[] = [],
    value = windowBody(draft);
  if (!isValidTimeZone(value.timezone)) fields.push('timezone');
  if (!Number.isFinite(value.startHour)) fields.push('startHour');
  if (!Number.isFinite(value.endHour)) fields.push('endHour');
  if (!fields.length && !validateWindowConfig(value).ok) fields.push('endHour');
  return fields;
}
export function validWindow(value: unknown): value is DeliveryWindowConfig {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as DeliveryWindowConfig).startHour === 'number' &&
    typeof (value as DeliveryWindowConfig).endHour === 'number' &&
    validateWindowConfig(value).ok
  );
}
export const windowBasis = (config: DeliveryWindowConfig) =>
  JSON.stringify([config.timezone, config.startHour, config.endHour]);
