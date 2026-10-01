const validDate = (input: unknown): input is string =>
  typeof input === 'string' && input.includes('T') && Number.isFinite(Date.parse(input));
export interface NotificationVariable {
  name: string;
  description: string | null;
}

export interface NotificationTemplate {
  id: string;
  eventKey: string;
  channel: 'email' | 'sms' | 'in_app';
  locale: 'fa' | 'en';
  subject: string | null;
  bodyTemplate: string;
  variables: NotificationVariable[];
  status: 'draft' | 'active' | 'archived';
  isActive: boolean;
  version: number;
  publishedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export function responseRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function validTemplate(value: unknown): value is NotificationTemplate {
  const row = responseRecord(value);
  return (
    !!row &&
    typeof row.id === 'string' &&
    /^[a-zA-Z0-9_-]{1,100}$/.test(row.id) &&
    typeof row.eventKey === 'string' &&
    /^[^\s]{1,100}$/.test(row.eventKey) &&
    typeof row.bodyTemplate === 'string' &&
    (row.subject === null || typeof row.subject === 'string') &&
    ['email', 'sms', 'in_app'].includes(String(row.channel)) &&
    ['en', 'fa'].includes(String(row.locale)) &&
    ['draft', 'active', 'archived'].includes(String(row.status)) &&
    typeof row.isActive === 'boolean' &&
    Number.isSafeInteger(row.version) &&
    Number(row.version) > 0 &&
    (row.publishedAt === null || validDate(row.publishedAt)) &&
    validDate(row.createdAt) &&
    validDate(row.updatedAt) &&
    (row.createdBy === null || (typeof row.createdBy === 'string' && row.createdBy.length > 0)) &&
    row.isActive === (row.status === 'active') &&
    Array.isArray(row.variables) &&
    row.variables.every((variable) => {
      const v = responseRecord(variable);
      return (
        !!v &&
        typeof v.name === 'string' &&
        v.name.length > 0 &&
        (v.description === null || typeof v.description === 'string')
      );
    })
  );
}

export function templateBasis(row: NotificationTemplate): string {
  return JSON.stringify([
    row.id,
    row.eventKey,
    row.channel,
    row.locale,
    row.subject,
    row.bodyTemplate,
    row.variables.map((v) => [v.name, v.description]),
    row.status,
    row.isActive,
    row.version,
    row.publishedAt,
    row.updatedAt,
  ]);
}
export interface TosVersion {
  revision?: string;
  id: string;
  versionId: string;
  contentFa: string;
  contentEn: string;
  changeType: 'major' | 'minor' | null;
  status: 'draft' | 'published';
  isActive: boolean;
  publishedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export function isVersion(value: unknown): value is TosVersion {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const date = (input: unknown) => typeof input === 'string' && Number.isFinite(Date.parse(input));
  return (
    (v.revision === undefined ||
      (typeof v.revision === 'string' && /^[a-f0-9]{64}$/.test(v.revision))) &&
    typeof v.id === 'string' &&
    /^[a-zA-Z0-9_-]{1,100}$/.test(v.id) &&
    typeof v.versionId === 'string' &&
    v.versionId.trim().length > 0 &&
    v.versionId.length <= 50 &&
    typeof v.contentFa === 'string' &&
    typeof v.contentEn === 'string' &&
    (v.status === 'draft' || v.status === 'published') &&
    (v.changeType === null || v.changeType === 'major' || v.changeType === 'minor') &&
    typeof v.isActive === 'boolean' &&
    (!v.isActive || v.status === 'published') &&
    (v.createdBy === null || typeof v.createdBy === 'string') &&
    date(v.createdAt) &&
    date(v.updatedAt) &&
    (v.status === 'published' ? date(v.publishedAt) : v.publishedAt === null)
  );
}
