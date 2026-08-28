/**
 * Contract template domain helpers (T-09.12.04).
 *
 * Placeholder extraction is the shared contract between the admin API
 * (uploads) and any future consumer (contract generation, previews):
 * the same regex + normalization is used everywhere, so a template that
 * the admin UI shows with `{{customerName}}` renders with the exact
 * same key in the generator.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CONTRACT_TEMPLATE_STATUSES = ['active', 'inactive'] as const
export type ContractTemplateStatus = (typeof CONTRACT_TEMPLATE_STATUSES)[number]

export const CONTRACT_TEMPLATE_STATUS_DEFAULT: ContractTemplateStatus = 'active'

/** Max placeholders kept per version — guards against pathological files. */
export const MAX_CONTRACT_TEMPLATE_PLACEHOLDERS = 100

/**
 * Placeholder regex: `{{ name }}` with an optional single layer of
 * whitespace inside the braces. Name charset: letters, digits,
 * underscore; must START with a letter (so `{{2fa}}` does not match —
 * it reads as a number, not a placeholder). This mirrors the
 * conventional Mustache/Handlebars variable syntax without pulling in a
 * template engine.
 */
export const CONTRACT_TEMPLATE_PLACEHOLDER_PATTERN =
  /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Extract unique placeholder names from template file content.
 *
 * - Matches every `{{name}}` / `{{ name }}` token;
 * - Deduplicates (first occurrence wins, order preserved);
 * - Caps the result at {@link MAX_CONTRACT_TEMPLATE_PLACEHOLDERS};
 * - Returns an empty array for content without placeholders (never
 *   null/undefined).
 */
export function extractContractTemplatePlaceholders(content: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const match of content.matchAll(CONTRACT_TEMPLATE_PLACEHOLDER_PATTERN)) {
    const name = (match[1] ?? '').trim()
    if (name !== '' && !seen.has(name)) {
      seen.add(name)
      result.push(name)
      if (result.length >= MAX_CONTRACT_TEMPLATE_PLACEHOLDERS) break
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// DTO types (shared between controller and service)
// ---------------------------------------------------------------------------

export interface ContractTemplateVersionDto {
  versionNumber: number
  storageKey: string
  fileName: string
  contentType: string | null
  fileSize: number | null
  placeholders: string[]
  createdBy: string
  createdAt: string
}

export interface ContractTemplateDto {
  id: string
  name: string
  description: string | null
  status: ContractTemplateStatus
  createdBy: string
  createdAt: string
  updatedAt: string
  /** Total version count (0 for a template with no uploads yet). */
  versionCount: number
  /** Highest version, if any. */
  latestVersion: ContractTemplateVersionDto | null
}