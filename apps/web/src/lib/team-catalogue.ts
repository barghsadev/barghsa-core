export const TEAM_ROLES = ['Manager', 'Finance', 'Legal'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];
export interface TeamEntry {
  id: string;
  type: 'agent' | 'invitation';
  userId: string | null;
  username: string | null;
  name: string | null;
  role: string;
  status: string;
  joinedAt: string | null;
  createdAt: string;
  invitedAt?: string | null;
  /** Recorded account sign-in, not presence or profile activity history. */
  lastActiveAt?: string | null;
  message?: string | null;
}
export interface Team {
  profileId: string;
  agents: TeamEntry[];
  canTransferOwnership: boolean;
  profileName?: string;
}
export interface OwnershipTransfer {
  id: string;
  profileId: string;
  profileName: string;
  expiresAt: string;
  direction: 'incoming' | 'outgoing';
}
export interface TeamProfiles {
  activeProfileId: string | null;
  profiles: { id: string; profileType: string; title?: string | null }[];
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v);
const date = (v: unknown): v is string =>
  typeof v === 'string' && v.includes('T') && Number.isFinite(Date.parse(v));
const nullableText = (v: unknown) => v === null || typeof v === 'string';
export function validTeamProfiles(v: unknown): v is TeamProfiles {
  return (
    record(v) &&
    (v.activeProfileId === null || id(v.activeProfileId)) &&
    Array.isArray(v.profiles) &&
    v.profiles.every(
      (p) =>
        record(p) &&
        id(p.id) &&
        typeof p.profileType === 'string' &&
        p.profileType.length > 0 &&
        (p.title === undefined || nullableText(p.title))
    ) &&
    new Set(v.profiles.map((p) => p.id)).size === v.profiles.length &&
    (v.activeProfileId === null || v.profiles.some((p) => p.id === v.activeProfileId))
  );
}
export function validTeam(v: unknown): v is Team {
  if (
    !record(v) ||
    !id(v.profileId) ||
    typeof v.canTransferOwnership !== 'boolean' ||
    (v.profileName !== undefined && typeof v.profileName !== 'string') ||
    !Array.isArray(v.agents)
  )
    return false;
  const ids = new Set<string>(),
    memberships = new Set<string>();
  return v.agents.every((entry) => {
    if (
      !record(entry) ||
      !id(entry.id) ||
      ids.has(entry.id) ||
      !nullableText(entry.username) ||
      !nullableText(entry.name) ||
      !date(entry.createdAt) ||
      (entry.invitedAt !== undefined && entry.invitedAt !== null && !date(entry.invitedAt)) ||
      (entry.lastActiveAt !== undefined &&
        entry.lastActiveAt !== null &&
        !date(entry.lastActiveAt)) ||
      (entry.message !== undefined &&
        entry.message !== null &&
        (typeof entry.message !== 'string' || entry.message.length > 1000))
    )
      return false;
    ids.add(entry.id);
    if (entry.type === 'agent') {
      const key = `${entry.userId}:${entry.role}`;
      if (
        !id(entry.userId) ||
        !['Owner', ...TEAM_ROLES].includes(String(entry.role)) ||
        entry.status !== 'Active' ||
        (entry.joinedAt !== null && !date(entry.joinedAt)) ||
        memberships.has(key)
      )
        return false;
      memberships.add(key);
      return true;
    }
    return (
      entry.type === 'invitation' &&
      entry.userId === null &&
      entry.name === null &&
      typeof entry.username === 'string' &&
      entry.username.trim().length > 0 &&
      TEAM_ROLES.includes(entry.role as TeamRole) &&
      entry.status === 'Pending' &&
      (entry.lastActiveAt === undefined || entry.lastActiveAt === null) &&
      entry.joinedAt === null
    );
  });
}
export function validTransfers(v: unknown): v is { transfers: OwnershipTransfer[] } {
  return (
    record(v) &&
    Array.isArray(v.transfers) &&
    v.transfers.every(
      (row) =>
        record(row) &&
        id(row.id) &&
        id(row.profileId) &&
        typeof row.profileName === 'string' &&
        row.profileName.trim().length > 0 &&
        date(row.expiresAt) &&
        ['incoming', 'outgoing'].includes(String(row.direction))
    ) &&
    new Set(v.transfers.map((row) => row.id)).size === v.transfers.length
  );
}
export const transferBasis = (row: OwnershipTransfer) =>
  JSON.stringify([row.id, row.profileId, row.profileName, row.expiresAt, row.direction]);
/** Compare membership and permission metadata, ignoring unrelated response fields and ordering. */
export const teamBasis = (team: Team) =>
  JSON.stringify([
    team.profileId,
    team.canTransferOwnership,
    team.profileName ?? '',
    team.agents
      .map((row) => [
        row.id,
        row.type,
        row.userId,
        row.role,
        row.status,
        row.username,
        row.name,
        row.joinedAt,
        row.createdAt,
        row.message ?? null,
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  ]);
