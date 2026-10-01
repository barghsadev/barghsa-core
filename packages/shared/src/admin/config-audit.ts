export const CONFIG_AUDIT_FIELDS = {
  branding: [
    'appTitle',
    'appTitleFa',
    'slogan',
    'supportEmail',
    'supportPhone',
    'supportMobile',
    'primaryColor',
    'secondaryColor',
    'accentColor',
    'backgroundColor',
    'darkBackgroundColor',
    'fontFamily',
    'borderRadiusRem',
    'spacingScale',
    'logoUrl',
    'faviconUrl',
    'darkMode',
    'numberStyle',
  ],
  otp: ['ttlSeconds'],
  'service-response-targets': ['ticket', 'verification_case'],
} as const;
export type ConfigAuditScope = keyof typeof CONFIG_AUDIT_FIELDS;
export type ConfigAuditValue = string | number | boolean | null;
export interface ConfigAuditSnapshot {
  recorded: boolean;
  value: ConfigAuditValue;
}
export interface ConfigAuditEntry {
  id: string;
  actorId: string | null;
  createdAt: string;
  event: 'updated' | 'draft_created' | 'activated';
  version: number | null;
  detailsAvailable: boolean;
  changes: { field: string; previous: ConfigAuditSnapshot; current: ConfigAuditSnapshot }[];
}
export interface ConfigAuditPage {
  scope: ConfigAuditScope;
  items: ConfigAuditEntry[];
  nextCursor: string | null;
}
export const CONFIG_AUDIT_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
export const CONFIG_AUDIT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isConfigAuditTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !CONFIG_AUDIT_TIMESTAMP.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 19) === value.slice(0, 19);
}
export function isConfigAuditScope(value: unknown): value is ConfigAuditScope {
  return value === 'branding' || value === 'otp' || value === 'service-response-targets';
}
export function isConfigAuditValue(value: unknown): value is ConfigAuditValue {
  return (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'string' && value.length <= 2048) ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function snapshot(value: unknown): value is ConfigAuditSnapshot {
  return (
    object(value) &&
    typeof value.recorded === 'boolean' &&
    isConfigAuditValue(value.value) &&
    (value.recorded || value.value === null)
  );
}
export function isConfigAuditPage(value: unknown): value is ConfigAuditPage {
  if (
    !object(value) ||
    !isConfigAuditScope(value.scope) ||
    !Array.isArray(value.items) ||
    value.items.length > 50 ||
    (value.nextCursor !== null &&
      (typeof value.nextCursor !== 'string' || !/^[\w-]{1,512}$/.test(value.nextCursor)))
  )
    return false;
  const fields: readonly string[] = CONFIG_AUDIT_FIELDS[value.scope];
  const ids = new Set<string>();
  return value.items.every((entry: unknown) => {
    if (
      !object(entry) ||
      typeof entry.id !== 'string' ||
      !CONFIG_AUDIT_ID.test(entry.id) ||
      ids.has(entry.id) ||
      (entry.actorId !== null &&
        (typeof entry.actorId !== 'string' ||
          !entry.actorId.length ||
          entry.actorId.length > 128)) ||
      !isConfigAuditTimestamp(entry.createdAt) ||
      (entry.event !== 'updated' &&
        entry.event !== 'draft_created' &&
        entry.event !== 'activated') ||
      (entry.version !== null &&
        (typeof entry.version !== 'number' ||
          !Number.isSafeInteger(entry.version) ||
          entry.version < 1 ||
          entry.version > 2147483647)) ||
      typeof entry.detailsAvailable !== 'boolean' ||
      !Array.isArray(entry.changes) ||
      entry.changes.length > fields.length
    )
      return false;
    ids.add(entry.id);
    const changed = new Set<string>();
    return entry.changes.every((change: unknown) => {
      if (
        !object(change) ||
        typeof change.field !== 'string' ||
        !fields.includes(change.field) ||
        changed.has(change.field) ||
        !snapshot(change.previous) ||
        !snapshot(change.current)
      )
        return false;
      changed.add(change.field);
      return true;
    });
  });
}
