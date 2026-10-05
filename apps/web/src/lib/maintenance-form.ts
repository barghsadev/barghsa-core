import { datePickerAtTime } from '@barghsa/ui';
import type { MaintenanceCapability } from '../hooks/useMaintenance.js';

const capabilities: MaintenanceCapability[] = [
  'electricity_checkout',
  'saving_orders',
  'solar_requests',
  'wallet_topup',
  'ai_chat',
];
export interface MaintenanceSetting {
  capability: MaintenanceCapability;
  active: boolean;
  reason: { fa: string; en: string } | null;
  estimatedUntil: string | null;
  owner: string | null;
  version: number;
  updatedAt: string | null;
}
export interface MaintenanceDraft {
  active: boolean;
  reasonFa: string;
  reasonEn: string;
  owner: string;
  deadline: { date: Date | undefined; time: string; original: string | null; changed: boolean };
}
export function maintenanceDraft(
  setting: MaintenanceSetting | null,
  zone: string
): MaintenanceDraft {
  const original = setting?.estimatedUntil ?? null;
  const date = original ? new Date(original) : undefined;
  return {
    active: setting?.active ?? false,
    reasonFa: setting?.reason?.fa ?? '',
    reasonEn: setting?.reason?.en ?? '',
    owner: setting?.owner ?? '',
    deadline: {
      date,
      time: date
        ? new Intl.DateTimeFormat('en-GB', {
            timeZone: zone,
            hourCycle: 'h23',
            hour: '2-digit',
            minute: '2-digit',
          }).format(date)
        : '00:00',
      original,
      changed: false,
    },
  };
}
export function maintenanceDeadline(
  value: MaintenanceDraft['deadline'],
  zone: string
): string | null {
  if (!value.date) return null;
  if (!value.changed && value.original) return value.original;
  const match = /^(\d{2}):(\d{2})$/.exec(value.time);
  if (!match) return null;
  return (
    datePickerAtTime(value.date, Number(match[1]), Number(match[2]), zone)?.toISOString() ?? null
  );
}
export function maintenanceErrors(
  value: MaintenanceDraft,
  zone: string,
  now = Date.now()
): (keyof MaintenanceDraft)[] {
  if (!value.active) return [];
  const invalid: (keyof MaintenanceDraft)[] = [];
  for (const name of ['reasonFa', 'reasonEn', 'owner'] as const)
    if (!value[name].trim() || value[name].trim().length > (name === 'owner' ? 100 : 500))
      invalid.push(name);
  const until = maintenanceDeadline(value.deadline, zone);
  if (!until || !(Date.parse(until) > now)) invalid.push('deadline');
  return invalid;
}
export function maintenancePayload(value: MaintenanceDraft, zone: string, expectedVersion: number) {
  return {
    active: value.active,
    reason: value.active ? { fa: value.reasonFa.trim(), en: value.reasonEn.trim() } : null,
    owner: value.active ? value.owner.trim() : null,
    estimatedUntil: value.active ? maintenanceDeadline(value.deadline, zone) : null,
    expectedVersion,
  };
}
export function isMaintenanceSetting(value: unknown): value is MaintenanceSetting {
  if (!value || typeof value !== 'object') return false;
  const row = value as MaintenanceSetting;
  const text = (value: unknown, max: number): value is string =>
    typeof value === 'string' && !!value.trim() && value.length <= max;
  const instant = (value: unknown) =>
    typeof value === 'string' && Number.isFinite(Date.parse(value));
  return (
    capabilities.includes(row.capability) &&
    typeof row.active === 'boolean' &&
    Number.isSafeInteger(row.version) &&
    row.version >= 0 &&
    (row.updatedAt === null ? row.version === 0 : instant(row.updatedAt)) &&
    (row.active
      ? !!row.reason &&
        text(row.reason.fa, 500) &&
        text(row.reason.en, 500) &&
        text(row.owner, 100) &&
        instant(row.estimatedUntil)
      : row.reason === null && row.owner === null && row.estimatedUntil === null)
  );
}
export function isMaintenanceList(value: unknown): value is MaintenanceSetting[] {
  return (
    Array.isArray(value) &&
    value.length === capabilities.length &&
    value.every(isMaintenanceSetting) &&
    new Set(value.map((row) => row.capability)).size === capabilities.length
  );
}
export function matchesMaintenanceReceipt(
  value: unknown,
  capability: MaintenanceCapability,
  body: ReturnType<typeof maintenancePayload>
): boolean {
  if (!isMaintenanceSetting(value)) return false;
  return (
    value.capability === capability &&
    value.version === body.expectedVersion + 1 &&
    value.updatedAt !== null &&
    value.active === body.active &&
    value.owner === body.owner &&
    value.reason?.fa === body.reason?.fa &&
    value.reason?.en === body.reason?.en &&
    (body.estimatedUntil === null
      ? value.estimatedUntil === null
      : value.estimatedUntil !== null &&
        Date.parse(value.estimatedUntil) === Date.parse(body.estimatedUntil))
  );
}
