export interface PublicTosHistory {
  versions: { id: string; versionId: string; publishedAt: string }[];
  nextCursor: string | null;
}

export function readPublicTosHistory(value: unknown): PublicTosHistory | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const uuid = (value: unknown): value is string =>
    typeof value === 'string' && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value);
  if (!Array.isArray(raw.versions) || raw.versions.length > 20) return null;
  const versions: PublicTosHistory['versions'] = [];
  const seen = new Set<string>();
  for (const item of raw.versions as unknown[]) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    if (
      !uuid(row.id) ||
      seen.has(row.id.toLowerCase()) ||
      typeof row.versionId !== 'string' ||
      !row.versionId.trim() ||
      typeof row.publishedAt !== 'string' ||
      !Number.isFinite(Date.parse(row.publishedAt))
    )
      return null;
    seen.add(row.id.toLowerCase());
    versions.push({ id: row.id, versionId: row.versionId, publishedAt: row.publishedAt });
  }
  if (!(
    raw.nextCursor === null ||
    (uuid(raw.nextCursor) && raw.nextCursor === versions.at(-1)?.id)
  ))
    return null;
  return { versions, nextCursor: raw.nextCursor };
}
