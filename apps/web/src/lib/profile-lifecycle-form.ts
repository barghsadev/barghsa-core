import { ticketStatuses } from './ticket-form.js';
export const lifecycleBlockers = {
  legalHold: ['legal', 'contactSupport'],
  unpaidInvoice: ['finance', 'payInvoice'],
  pendingRefund: ['finance', 'resolveRefund'],
  walletBalance: ['customer', 'settleWallet'],
  activeContract: ['contracts', 'completeContract'],
  activeOrder: ['contracts', 'completeContract'],
  pendingVerification: ['privacy', 'staffReview'],
  pendingWalletTransaction: ['finance', 'settleWallet'],
  activeProductWorkflow: ['contracts', 'completeContract'],
  pendingProfileAccess: ['privacy', 'staffReview'],
  securityReview: ['privacy', 'staffReview'],
} as const;
export const closureBlockers = {
  ...lifecycleBlockers,
  pendingExport: ['customer', 'prepareExport'],
  profileOwnershipChanged: ['privacy', 'staffReview'],
} as const;
export type LifecycleType = 'export' | 'closure';
export interface LifecycleBlocker {
  code: keyof typeof closureBlockers;
  count: number;
  owner: string;
  nextStep: string;
}
export interface LifecyclePreview {
  profileId: string;
  blockers: LifecycleBlocker[];
  requests: {
    ticketId: string;
    type: LifecycleType;
    status: string;
    createdAt: string;
    exportJobId: string | null;
    exportExpiresAt: string | null;
  }[];
}
export const retainedRecords = [
  'orders',
  'contracts',
  'invoices',
  'wallets',
  'refunds',
  'documents',
  'verification_cases',
  'electricity_orders',
  'saving_orders',
  'solar_requests',
  'consultations',
  'electricity_increases',
  'price_adjustments',
] as const;
export interface ClosurePreview {
  ticketId: string;
  profileId: string;
  ownerUserId: string;
  completedAt: string | null;
  anonymized: boolean | null;
  eligible: boolean;
  blockers: LifecycleBlocker[];
  retained: Record<(typeof retainedRecords)[number], number>;
  anonymizeProfile: boolean;
  exportTicketId: string | null;
  exportExpiresAt: string | null;
  previewVersion: string;
}
export interface ClosureValues {
  confirmed: boolean;
  password: string;
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const date = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(v) &&
  Number.isFinite(Date.parse(v));
const count = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const nullable = (v: unknown, valid: (v: unknown) => boolean) => v === null || valid(v);
function blockers(
  v: unknown,
  definition: Readonly<Record<string, readonly [string, string]>> = lifecycleBlockers
): v is LifecycleBlocker[] {
  if (!Array.isArray(v) || v.length !== Object.keys(definition).length) return false;
  const seen = new Set<string>();
  return v.every((b) => {
    if (
      !object(b) ||
      typeof b.code !== 'string' ||
      seen.has(b.code) ||
      !Object.hasOwn(definition, b.code) ||
      !count(b.count)
    )
      return false;
    seen.add(b.code);
    const [owner, next] = definition[b.code]!;
    return b.owner === owner && b.nextStep === next;
  });
}
export function lifecyclePreview(v: unknown): LifecyclePreview | null {
  if (
    !object(v) ||
    !uuid(v.profileId) ||
    !blockers(v.blockers) ||
    !Array.isArray(v.requests) ||
    v.requests.length > 10
  )
    return null;
  const seen = new Set<string>();
  if (
    !v.requests.every((r) => {
      if (
        !object(r) ||
        !uuid(r.ticketId) ||
        seen.has(r.ticketId) ||
        !['export', 'closure'].includes(String(r.type)) ||
        !ticketStatuses.includes(r.status as never) ||
        !date(r.createdAt) ||
        !nullable(r.exportJobId, uuid) ||
        !nullable(r.exportExpiresAt, date) ||
        (r.type === 'closure' && (r.exportJobId !== null || r.exportExpiresAt !== null))
      )
        return false;
      seen.add(r.ticketId);
      return true;
    })
  )
    return null;
  return v as unknown as LifecyclePreview;
}
export function lifecycleRequestReceipt(
  v: unknown,
  profileId: string,
  type: LifecycleType
): v is { ticketId: string; profileId: string; type: LifecycleType; created: boolean } {
  return (
    object(v) &&
    uuid(v.ticketId) &&
    v.profileId === profileId &&
    v.type === type &&
    typeof v.created === 'boolean'
  );
}
export function lifecycleExportReceipt(
  v: unknown,
  ticketId: string
): v is { ticketId: string; jobId: string; created: boolean } {
  return object(v) && v.ticketId === ticketId && uuid(v.jobId) && typeof v.created === 'boolean';
}
export function closurePreview(v: unknown, ticketId: string): ClosurePreview | null {
  if (
    !object(v) ||
    v.ticketId !== ticketId ||
    !uuid(v.ticketId) ||
    !uuid(v.profileId) ||
    typeof v.ownerUserId !== 'string' ||
    !v.ownerUserId.trim() ||
    !nullable(v.completedAt, date) ||
    !nullable(v.anonymized, (b) => typeof b === 'boolean') ||
    typeof v.eligible !== 'boolean' ||
    !blockers(v.blockers, closureBlockers) ||
    !object(v.retained) ||
    !retainedRecords.every((key) => count((v.retained as Record<string, unknown>)[key])) ||
    typeof v.anonymizeProfile !== 'boolean' ||
    !nullable(v.exportTicketId, uuid) ||
    !nullable(v.exportExpiresAt, date) ||
    typeof v.previewVersion !== 'string' ||
    !/^[0-9a-f]{64}$/.test(v.previewVersion) ||
    (v.completedAt === null ? v.anonymized !== null : typeof v.anonymized !== 'boolean')
  )
    return null;
  return v as unknown as ClosurePreview;
}
export function closureReceipt(v: unknown, source: ClosurePreview): ClosurePreview | null {
  const receipt = closurePreview(v, source.ticketId);
  if (
    !receipt ||
    !object(v) ||
    typeof v.created !== 'boolean' ||
    !receipt.completedAt ||
    receipt.profileId !== source.profileId ||
    receipt.ownerUserId !== source.ownerUserId ||
    (v.created &&
      (receipt.previewVersion !== source.previewVersion ||
        receipt.anonymized !== source.anonymizeProfile ||
        !retainedRecords.every((key) => receipt.retained[key] === source.retained[key]) ||
        receipt.exportTicketId !== source.exportTicketId))
  )
    return null;
  // A committed replay has a fresh server version; the original dry-run hash is no longer current.
  return receipt;
}
