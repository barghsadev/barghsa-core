/**
 * Notification template rendering engine (T-05.04.02).
 *
 * A small, dependency-free, strictly-serialized template engine for
 * notification subject/body strings. It:
 *
 *  - Recognizes the `{{variable_name}}` syntax (flat `{{name}}` or dotted
 *    `{{user.profileLink}}`).
 *  - Enforces a per-template allow-list: a placeholder is substituted ONLY if
 *    its key is allow-listed. Anything else is rendered verbatim (escaped),
 *    never with caller-supplied data. This is what makes "unknown variable =>
 *    literal text" a *safety* property, not a bug.
 *  - Resolves dotted paths against the data context using strict OWN + safe
 *    property traversal. It NEVER exposes internal JS state: lookups refuse
 *    `__proto__`, `constructor`, `prototype` at any path level, and only read
 *    own, enumerable, string-typed properties — so template variables cannot
 *    reach prototype chains, non-enumerable internals, or symbol properties.
 *  - Escapes injected variable *values* for HTML-safe email/SMS output so a
 *    malicious value cannot smuggle `<script>`/attribute markup into a
 *    delivery.
 *  - Never evaluates arbitrary expressions, never calls functions, and never
 *    interpolates values that are not present in the (allow-listed) key even
 *    when the data object happens to carry extra fields.
 *
 * The engine is intentionally pure: it performs no I/O and imports nothing.
 */

/** Reserved JS/prototype property names that must never be resolved. */
const BLOCKED_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'prototype',
  'constructor',
  'hasOwnProperty',
])

/** Characters allowed in a variable name (matches the DB schema contract). */
const NAME_RE = /^[A-Za-z0-9_.]+$/

/** Matches a single `{{...}}` placeholder (captures the raw inner name). */
const PLACEHOLDER_RE = /{{([^{}]+)}}/g

/**
 * Escape a string for safe HTML/text output, preventing injection of
 * arbitrary markup/script via template variable values.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Resolve a dotted variable name against a data context using only safe,
 * own, enumerable property access.
 *
 * Returns `undefined` for:
 *  - any segment that is blocked (prototype/constructor/internal),
 *  - a path that climbs into a non-object (numbers, strings, null),
 *  - a path whose property is non-enumerable, or
 *  - `Symbol`-keyed / inherited members.
 */
export function resolvePath(root: unknown, path: string): unknown {
  if (path === '') return undefined
  const segments = path.split('.')
  let node: unknown = root
  for (const segment of segments) {
    // Guard object-internal keys at every level.
    if (!NAME_RE.test(segment) || BLOCKED_KEYS.has(segment)) return undefined
    if (node === null || node === undefined) return undefined
    if (typeof node !== 'object') return undefined
    const desc = Object.getOwnPropertyDescriptor(
      node as Record<string, unknown>,
      segment,
    )
    // Refuse inherited + non-enumerable + symbol properties entirely.
    if (!desc || !desc.enumerable) return undefined
    node = (node as Record<string, unknown>)[segment]
  }
  return node
}

export interface RenderOptions {
  /** Map of variable name -> value available at render time. */
  data?: Record<string, unknown> | null | undefined
}

export interface RenderResult {
  /** The fully rendered, escaped output string. */
  output: string
  /**
   * Variable names that appeared in the template but had no (defined) value
   * in `data`. Useful for highlighting missing required variables in preview.
   */
  missing: string[]
  /**
   * Raw `{{...}}` placeholders that are NOT allow-listed. These are rendered
   * verbatim (escaped) and recorded here for diagnostics.
   */
  unknown: string[]
}

/** Collect every distinct variable name appearing in a template body. */
export function collectVariables(template: string): string[] {
  const names = new Set<string>()
  const re = /{{([^{}]+)}}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(template)) !== null) {
    const raw = m[1]!.trim()
    if (NAME_RE.test(raw)) names.add(raw)
  }
  return [...names]
}

/**
 * Render a template body/subject, substituting allow-listed variables with
 * escaped values drawn only from `data`.
 *
 * Safety contract:
 *  - Only allow-listed names are substituted. Allow-list membership is the
 *    only way data reaches the output.
 *  - Values are HTML-escaped before being placed in the output.
 *  - Missing/null/undefined allow-listed values render as empty string.
 *  - Unknown or blocked placeholders render as their escaped literal and are
 *    surfaced in `result.unknown`.
 */
export function renderTemplate(
  template: string,
  allowList: Iterable<string>,
  options?: RenderOptions,
): RenderResult {
  const allowed = new Set<string>(allowList)
  const data: Record<string, unknown> = options?.data ?? {}
  const missing = new Set<string>()
  const unknown = new Set<string>()

  const output = template.replace(PLACEHOLDER_RE, (match, raw: string) => {
    const name = raw.trim()
    if (!NAME_RE.test(name) || !allowed.has(name)) {
      // Unknown placeholder: never substitute, echo escaped literal.
      unknown.add(name)
      return escapeHtml(match)
    }
    const value = resolvePath(data, name)
    if (value === undefined || value === null) {
      missing.add(name)
      return ''
    }
    if (typeof value === 'object' || typeof value === 'function') {
      // Never stringify internal object/function shapes into a message.
      missing.add(name)
      return ''
    }
    return escapeHtml(String(value))
  })

  return {
    output,
    missing: [...missing],
    unknown: [...unknown],
  }
}

/**
 * Validate that a template body is well-formed and only references
 * allow-listed variables. Returns a list of problems; empty when valid.
 */
export function validateTemplate(
  template: string,
  allowList: Iterable<string>,
): { message: string; variable?: string }[] {
  const allowed = new Set<string>(allowList)
  const problems: { message: string; variable?: string }[] = []

  const opens = (template.match(/\{\{/g) ?? []).length
  const closes = (template.match(/\}\}/g) ?? []).length
  if (opens !== closes) {
    problems.push({ message: 'Template contains an unclosed {{...}} placeholder' })
  }

  const re = /\{\{([^{}]+)\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(template)) !== null) {
    const name = m[1]!.trim()
    if (!NAME_RE.test(name)) {
      problems.push({ message: `Invalid variable name "${name}" in template`, variable: name })
    } else if (!allowed.has(name)) {
      problems.push({ message: `Variable "${name}" is not in the allow-list`, variable: name })
    }
  }
  return problems
}