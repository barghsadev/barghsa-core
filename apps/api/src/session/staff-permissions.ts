import type { AuthenticatedRequest } from './session.guard.js'

/** Permission data comes from current database roles on every authenticated request. */
export function hasStaffPermission(request: AuthenticatedRequest, permission: string): boolean {
  const session = request.session
  return Boolean(session && (session.isAdmin === true
    || session.permissions?.includes('*') || session.permissions?.includes(permission)))
}

/** Invalid stored role data never grants permission. */
export function resolveStaffPermissions(storedRoles: unknown): string[] {
  if (!Array.isArray(storedRoles)) return []
  const permissions = new Set<string>()
  for (const stored of storedRoles) {
    try {
      const values: unknown = typeof stored === 'string' ? JSON.parse(stored) : stored
      if (Array.isArray(values) && values.every((value) => typeof value === 'string')) {
        for (const value of values) permissions.add(value)
      }
    } catch { /* Invalid role JSON grants no capabilities. */ }
  }
  return [...permissions].sort()
}
