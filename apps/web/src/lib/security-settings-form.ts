export type SecurityPassword = { password: string };
export type SecuritySession = {
  sessionId: string;
  deviceInfo: { ip?: string; userAgent?: string } | null;
  location: { countryCode: string } | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  idleDeadline: string;
  isCurrentSession: boolean;
};
export type TrustedDevice = {
  id: string;
  userAgent: string | null;
  ip: string | null;
  trustedAt: string;
  expiresAt: string;
  isCurrentDevice: boolean;
};
export type SecurityOperation =
  | { kind: 'session'; target: SecuritySession }
  | { kind: 'trust'; target: TrustedDevice }
  | { kind: 'others' };
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === 'string' && !!v && v.length <= 128;
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
export function securitySessions(value: unknown): SecuritySession[] | null {
  if (!Array.isArray(value)) return null;
  const rows: SecuritySession[] = [];
  for (const v of value) {
    if (
      !object(v) ||
      !id(v.sessionId) ||
      typeof v.isCurrentSession !== 'boolean' ||
      !date(v.createdAt) ||
      !date(v.updatedAt) ||
      !date(v.expiresAt) ||
      !date(v.idleDeadline)
    )
      return null;
    const d = v.deviceInfo;
    if (
      d !== null &&
      (!object(d) ||
        (d.ip !== undefined && typeof d.ip !== 'string') ||
        (d.userAgent !== undefined && typeof d.userAgent !== 'string'))
    )
      return null;
    rows.push({
      sessionId: v.sessionId,
      deviceInfo:
        d === null
          ? null
          : {
              ...(typeof d.ip === 'string' ? { ip: d.ip } : {}),
              ...(typeof d.userAgent === 'string' ? { userAgent: d.userAgent } : {}),
            },
      location:
        object(v.location) &&
        typeof v.location.countryCode === 'string' &&
        /^[A-Z]{2}$/.test(v.location.countryCode)
          ? { countryCode: v.location.countryCode }
          : null,
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
      expiresAt: v.expiresAt,
      idleDeadline: v.idleDeadline,
      isCurrentSession: v.isCurrentSession,
    });
  }
  return new Set(rows.map((v) => v.sessionId)).size === rows.length &&
    rows.filter((v) => v.isCurrentSession).length <= 1
    ? rows
    : null;
}
export function securityTrustedDevices(value: unknown): TrustedDevice[] | null {
  if (!Array.isArray(value)) return null;
  const rows: TrustedDevice[] = [];
  for (const v of value) {
    if (
      !object(v) ||
      !id(v.id) ||
      !(v.userAgent === null || typeof v.userAgent === 'string') ||
      !(v.ip === null || typeof v.ip === 'string') ||
      !date(v.trustedAt) ||
      !date(v.expiresAt) ||
      Date.parse(v.expiresAt) <= Date.parse(v.trustedAt) ||
      typeof v.isCurrentDevice !== 'boolean'
    )
      return null;
    rows.push({
      id: v.id,
      userAgent: v.userAgent,
      ip: v.ip,
      trustedAt: v.trustedAt,
      expiresAt: v.expiresAt,
      isCurrentDevice: v.isCurrentDevice,
    });
  }
  return new Set(rows.map((v) => v.id)).size === rows.length &&
    rows.filter((v) => v.isCurrentDevice).length <= 1
    ? rows
    : null;
}
export function securityOperationAvailable(
  operation: SecurityOperation,
  sessions: SecuritySession[],
  devices: TrustedDevice[]
): boolean {
  if (sessions.filter((v) => v.isCurrentSession).length !== 1) return false;
  if (operation.kind === 'others') return sessions.some((v) => !v.isCurrentSession);
  return operation.kind === 'session'
    ? sessions.some((v) => v.sessionId === operation.target.sessionId && !v.isCurrentSession)
    : devices.some((v) => v.id === operation.target.id);
}
export function securityOperationConfirmed(
  operation: SecurityOperation,
  sessions: SecuritySession[],
  devices: TrustedDevice[]
): boolean {
  if (sessions.filter((v) => v.isCurrentSession).length !== 1) return false;
  return operation.kind === 'others'
    ? !sessions.some((v) => !v.isCurrentSession)
    : operation.kind === 'session'
      ? !sessions.some((v) => v.sessionId === operation.target.sessionId)
      : !devices.some((v) => v.id === operation.target.id);
}
export function securityReceipt(kind: SecurityOperation['kind'], value: unknown): boolean {
  if (!object(value)) return false;
  if (kind === 'trust') return value.revoked === true;
  if (kind === 'session') return value.message === 'Session revoked.';
  const count = value.revokedCount;
  return (
    typeof count === 'number' &&
    Number.isSafeInteger(count) &&
    count >= 0 &&
    value.message ===
      (count === 0 ? 'No other sessions to revoke.' : `All ${count} other session(s) revoked.`)
  );
}
export function securityStepUpReceipt(value: unknown): boolean {
  return (
    object(value) &&
    value.message === 'Step-up authentication successful.' &&
    date(value.stepUpVerifiedAt)
  );
}
