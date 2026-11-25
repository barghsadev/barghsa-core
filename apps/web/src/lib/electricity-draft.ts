export function electricityDraftPath(mode: 'simple' | 'advanced', profileId?: string) {
  const path = `/api/electricity/drafts/${mode}/guarded`;
  return profileId ? `${path}?profileId=${encodeURIComponent(profileId)}` : path;
}
