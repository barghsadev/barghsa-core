export interface OnboardingDraftSummary {
  id: string;
  profileType: 'INDIVIDUAL' | 'LEGAL';
  name: string | null;
  createdAt: string;
  updatedAt: string | null;
  hasDraft: boolean;
  expired: boolean;
}
export interface OnboardingDraftPage {
  drafts: OnboardingDraftSummary[];
  nextAfter: string | null;
}
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const date = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T/.test(value) &&
  Number.isFinite(Date.parse(value));

export function parseOnboardingDraftPage(
  input: unknown,
  after: string | null
): OnboardingDraftPage {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid drafts');
  const page = input as Record<string, unknown>;
  if (
    !Array.isArray(page.drafts) ||
    page.drafts.length > 50 ||
    (page.nextAfter !== null && !uuid(page.nextAfter))
  )
    throw new Error('Invalid draft page');
  let previous = after?.toLowerCase() ?? null;
  const drafts = page.drafts.map((input): OnboardingDraftSummary => {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Error('Invalid draft');
    const row = input as Record<string, unknown>;
    if (
      !uuid(row.id) ||
      (previous !== null && row.id.toLowerCase() >= previous) ||
      (row.profileType !== 'INDIVIDUAL' && row.profileType !== 'LEGAL') ||
      (row.name !== null && (typeof row.name !== 'string' || row.name.length > 250)) ||
      !date(row.createdAt) ||
      (row.updatedAt !== null && !date(row.updatedAt)) ||
      typeof row.hasDraft !== 'boolean' ||
      typeof row.expired !== 'boolean' ||
      (row.hasDraft ? row.updatedAt === null : row.updatedAt !== null || row.expired)
    )
      throw new Error('Invalid draft');
    previous = row.id.toLowerCase();
    return {
      id: row.id,
      profileType: row.profileType,
      name: row.name as string | null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt as string | null,
      hasDraft: row.hasDraft,
      expired: row.expired,
    };
  });
  if (
    page.nextAfter !== null &&
    (drafts.length !== 50 || page.nextAfter.toLowerCase() !== previous)
  )
    throw new Error('Invalid draft cursor');
  return { drafts, nextAfter: page.nextAfter as string | null };
}
