export const customerCorrectionsApi = '/api/admin/notifications/customer-corrections';
export const customerCorrectionsRoute =
  '/admin/failed-notifications/corrections/{-$correctionId}/{-$action}';

export interface CustomerCorrection {
  id: string;
  address: string;
  profileId: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

export interface CustomerCorrectionAccess {
  canView: boolean;
  canRetry: boolean;
}

export interface CustomerCorrectionSearch {
  completed?: boolean;
  offset?: number;
}

export const isCorrectionId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function isCustomerCorrection(value: unknown): value is CustomerCorrection {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  const date = (item: unknown) => typeof item === 'string' && Number.isFinite(Date.parse(item));
  return (
    isCorrectionId(row.id) &&
    typeof row.address === 'string' &&
    row.address.length > 0 &&
    (row.profileId === null || isCorrectionId(row.profileId)) &&
    date(row.createdAt) &&
    (row.resolvedAt === null
      ? row.resolutionNote === null
      : date(row.resolvedAt) && typeof row.resolutionNote === 'string')
  );
}

export function sameCorrection(first: CustomerCorrection, second: CustomerCorrection) {
  return (
    first.id === second.id &&
    first.profileId === second.profileId &&
    first.address === second.address &&
    first.createdAt === second.createdAt
  );
}

export async function readCustomerCorrectionAccess(
  signal: AbortSignal
): Promise<CustomerCorrectionAccess> {
  const response = await fetch('/api/admin/failed-notifications/access', { signal });
  if (response.status === 401 || response.status === 403)
    return { canView: false, canRetry: false };
  const access = await response.json();
  if (!response.ok || typeof access?.canView !== 'boolean' || typeof access?.canRetry !== 'boolean')
    throw new Error('Invalid correction access');
  return access;
}
