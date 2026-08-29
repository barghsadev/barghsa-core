/**
 * Upload policy contract (T-09.12.05, shared between the admin API and
 * the upload enforcement path).
 *
 * Upload policies are administered per **category** (the canonical admin
 * set: documents, images, videos). Each policy whitelists the allowed
 * file formats (lowercase `.ext` tokens) and caps the maximum file size.
 *
 * Deployment-safe boundaries: policies are written through the admin API
 * which bounds every value to the deployment-level limits in
 * `apps/api/src/upload/upload.config.ts` (extension superset +
 * per-category size cap, itself ≤ {@link GLOBAL_MAX_UPLOAD_POLICY_SIZE_BYTES}).
 * At upload time the enforcement path resolves the *effective* policy as
 * `min(DB policy, deployment config)` — the database can only narrow what
 * the deployment allows, never widen it.
 *
 * Policy rows are versioned with effective windows (same semantics as VAT
 * configuration, T-09.12.02):
 *   - `effective_from` (inclusive)
 *   - `effective_until` (exclusive; null = open/current)
 * At most one open (null effective_until) row exists per category, enforced
 * by a DB EXCLUDE constraint (migration 0050) and the admin service's
 * window logic. Adding a new policy for a category closes the previously
 * open one at the new effective_from.
 */

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/** Canonical admin-configurable upload policy categories (T-09.12.05). */
export const UPLOAD_POLICY_CATEGORIES = ['document', 'image', 'video'] as const

export type UploadPolicyCategory = (typeof UPLOAD_POLICY_CATEGORIES)[number]

/** Whether a raw value is a known upload policy category key. */
export function isUploadPolicyCategory(raw: unknown): raw is UploadPolicyCategory {
  return typeof raw === 'string' && (UPLOAD_POLICY_CATEGORIES as readonly string[]).includes(raw)
}

// ---------------------------------------------------------------------------
// Extension whitelist validation
// ---------------------------------------------------------------------------

/** Max distinct extensions kept per policy — guards against pathological lists. */
export const MAX_UPLOAD_POLICY_EXTENSIONS = 50

/**
 * A valid extension token: a leading dot followed by 1..10 lowercase
 * alphanumerics (e.g. `.pdf`, `.docx`, `.mp4`). Never a path separator,
 * wildcard, uppercase, or empty string — extension checks in the upload
 * path compare exact tokens, so the whitelist format must stay canonical.
 */
export const UPLOAD_POLICY_EXTENSION_PATTERN = /^\.[a-z0-9]{1,10}$/

/** Whether a raw value is a valid policy extension token (lowercase, dotted). */
export function isValidPolicyExtension(raw: unknown): raw is string {
  return typeof raw === 'string' && UPLOAD_POLICY_EXTENSION_PATTERN.test(raw)
}

/**
 * Normalize a raw extension list: trim, lowercase, drop empties/invalid
 * tokens, dedupe preserving first-occurrence order. The result is what the
 * admin service stores and the upload path compares against.
 */
export function normalizePolicyExtensions(raw: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of raw) {
    const token = entry.trim().toLowerCase()
    if (!isValidPolicyExtension(token) || seen.has(token)) continue
    seen.add(token)
    result.push(token)
  }
  return result
}

// ---------------------------------------------------------------------------
// Size bounds
// ---------------------------------------------------------------------------

/** Minimum policy max-size: 1 byte (a zero-byte cap would deny everything). */
export const MIN_UPLOAD_POLICY_SIZE_BYTES = 1

/**
 * Deployment-safe hard cap for any admin-configured max size (100 MB).
 * No policy row may exceed this regardless of category; the admin API
 * additionally applies the tighter per-category deployment cap (e.g.
 * documents 10 MB) from `apps/api/src/upload/upload.config.ts`.
 */
export const GLOBAL_MAX_UPLOAD_POLICY_SIZE_BYTES = 100 * 1024 * 1024

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

/**
 * A versioned upload policy row as stored in `upload_policies` and exposed
 * by the admin API.
 */
export interface UploadPolicyDto {
  id: string
  /** Canonical admin category key ('document' | 'image' | 'video'). */
  category: UploadPolicyCategory
  /** Lowercase `.ext` whitelist (1..50 entries). */
  allowedExtensions: string[]
  /** Maximum file size in bytes (1 B .. 100 MB hard cap, per-category deployment cap tighter). */
  maxSizeBytes: number
  /** Effective window — `effectiveFrom` inclusive. */
  effectiveFrom: string
  /** Effective window end — exclusive; null = open/current. */
  effectiveUntil: string | null
  /** Admin who recorded this policy. */
  createdBy: string
  createdAt: string
  updatedAt: string
  /**
   * Derived status for the admin UI/table:
   * - `current` — active now
   * - `scheduled` — future effective date (not yet active)
   * - `expired` — ended in the past
   */
  status: 'current' | 'scheduled' | 'expired'
}

/**
 * Derive the display status of a versioned policy window at `at`
 * (default now). Same semantics as `vatWindowStatus` (T-09.12.02).
 */
export function uploadPolicyWindowStatus(
  effectiveFrom: Date | string,
  effectiveUntil: Date | string | null,
  at: Date = new Date(),
): 'current' | 'scheduled' | 'expired' {
  const from = effectiveFrom instanceof Date ? effectiveFrom : new Date(effectiveFrom)
  const until = effectiveUntil == null ? null : effectiveUntil instanceof Date ? effectiveUntil : new Date(effectiveUntil)
  if (from.getTime() > at.getTime()) return 'scheduled'
  if (until !== null && until.getTime() <= at.getTime()) return 'expired'
  return 'current'
}
