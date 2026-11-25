import { datePickerAtTime, datePickerCalendarDate } from '@barghsa/ui';
import { RECONCILIATION_STATUSES, RECONCILIATION_SEVERITIES } from '@barghsa/shared/admin';
import { isInvoiceUuid } from './invoice-uuid.js';

export interface ReconciliationItem {
  id: string;
  exceptionType: string;
  severity: string;
  status: string;
  description: string;
  details: Record<string, unknown> | null;
  assignedToUsername: string | null;
  resolvedByUsername: string | null;
  resolutionNote: string | null;
  createdAt: string;
}
export type ReconciliationVerb = 'investigate' | 'resolve' | 'close';
export type ReconciliationFilterDraft = {
  status: string;
  severity: string;
  from: string;
  before: string;
};
export type ReconciliationNoteDraft = { note: string };
export function reconciliationBounds(
  value: ReconciliationFilterDraft,
  zone: string,
  applied?: Record<string, string>
) {
  const instant = (raw: string, key: string): Date | undefined => {
    if (!raw) return undefined;
    const previous = applied?.[key];
    if (previous && raw === reconciliationLocalTime(previous, zone)) return new Date(previous);
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(raw);
    if (!match) return undefined;
    const date = datePickerCalendarDate(match[1]!, zone);
    return date && datePickerAtTime(date, Number(match[2]), Number(match[3]), zone);
  };
  return {
    from: instant(value.from, 'createdFrom'),
    before: instant(value.before, 'createdBefore'),
  };
}
export function reconciliationFilterErrors(
  value: ReconciliationFilterDraft,
  zone: string,
  applied?: Record<string, string>
): (keyof ReconciliationFilterDraft)[] {
  const errors: (keyof ReconciliationFilterDraft)[] = [];
  if (value.status && !(RECONCILIATION_STATUSES as readonly string[]).includes(value.status))
    errors.push('status');
  if (value.severity && !(RECONCILIATION_SEVERITIES as readonly string[]).includes(value.severity))
    errors.push('severity');
  const bounds = reconciliationBounds(value, zone, applied);
  if (value.from && !bounds.from) errors.push('from');
  if (
    (value.before && !bounds.before) ||
    (bounds.from && bounds.before && bounds.from >= bounds.before)
  )
    errors.push('before');
  return errors;
}
export function reconciliationNoteErrors(value: ReconciliationNoteDraft): 'note'[] {
  return !value.note.trim() || value.note.trim().length > 1000 ? ['note'] : [];
}
export function reconciliationAllowed(status: string, verb: ReconciliationVerb): boolean {
  return verb === 'investigate'
    ? status === 'open'
    : verb === 'resolve'
      ? ['open', 'investigating'].includes(status)
      : ['open', 'investigating', 'resolved'].includes(status);
}
export function isReconciliationItem(value: unknown): value is ReconciliationItem {
  if (!value || typeof value !== 'object') return false;
  const row = value as ReconciliationItem;
  const nullableText = (value: unknown) => value === null || typeof value === 'string';
  return (
    typeof row.id === 'string' &&
    isInvoiceUuid(row.id) &&
    (RECONCILIATION_STATUSES as readonly string[]).includes(row.status) &&
    (RECONCILIATION_SEVERITIES as readonly string[]).includes(row.severity) &&
    typeof row.description === 'string' &&
    typeof row.exceptionType === 'string' &&
    (row.details === null || (typeof row.details === 'object' && !Array.isArray(row.details))) &&
    nullableText(row.assignedToUsername) &&
    nullableText(row.resolvedByUsername) &&
    nullableText(row.resolutionNote) &&
    typeof row.createdAt === 'string' &&
    Number.isFinite(Date.parse(row.createdAt))
  );
}
export function matchesReconciliationReceipt(
  value: unknown,
  before: ReconciliationItem,
  verb: ReconciliationVerb,
  note: string
): boolean {
  if (!isReconciliationItem(value)) return false;
  const status = { investigate: 'investigating', resolve: 'resolved', close: 'closed' }[verb];
  const expectedNote =
    verb === 'resolve'
      ? note.trim()
      : verb === 'close'
        ? (before.resolutionNote ?? note.trim())
        : before.resolutionNote;
  return value.id === before.id && value.status === status && value.resolutionNote === expectedNote;
}
export function reconciliationLinks(details: ReconciliationItem['details']) {
  const links: { label: 'walletLink' | 'invoiceLink'; href: string }[] = [];
  if (typeof details?.walletId === 'string' && isInvoiceUuid(details.walletId))
    links.push({
      label: 'walletLink',
      href: `/admin/wallet-ledger/${details.walletId.trim().toLowerCase()}`,
    });
  if (typeof details?.invoiceId === 'string' && isInvoiceUuid(details.invoiceId))
    links.push({
      label: 'invoiceLink',
      href: `/admin/invoices/${details.invoiceId.trim().toLowerCase()}`,
    });
  return links;
}

export function reconciliationApiQuery(filters: Record<string, string>): string {
  const params = new URLSearchParams();
  if (filters.status !== 'all') params.set('status', filters.status || 'open');
  for (const key of ['severity', 'createdFrom', 'createdBefore'])
    if (filters[key]) params.set(key, filters[key]);
  return params.toString();
}
/** Display an applied UTC bound without changing its seconds or milliseconds. */
export function reconciliationLocalTime(value: string, timezone: string): string {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const read = (key: string) => parts.find((part) => part.type === key)?.value;
  return `${read('year')}-${read('month')}-${read('day')}T${read('hour')}:${read('minute')}`;
}
