/**
 * Notification template preview helpers (E-05, T-05.04.03).
 *
 * Client-side mirror of the server's template engine (apps/api
 * notification-template.service.ts / template-engine.ts) so the admin preview
 * pane matches what is validated and rendered on save. Keep render rules in
 * lockstep with the server:
 *
 *  - `{{variable.name}}` placeholders are replaced ONLY when their name is in
 *    the template's allow-list.
 *  - Values are HTML-escaped for safe email/SMS/in-app text output.
 *  - An allow-listed variable that has no value is rendered as an empty string
 *    and reported as "missing" (key present in the preview history but no
 *    value was supplied).
 *  - A placeholder whose name is NOT allow-listed is rendered as its escaped
 *    literal and reported as "unknown" so admins can spot undeclared
 *    variables ("missing required variables").
 *
 * These helpers are intentionally pure (no I/O) so they are unit-testable and
 * safe to reuse across the admin UI.
 */

export interface TemplateVariable {
  name: string
  description?: string | null
}

export interface TemplatePreviewRenderResult {
  /** Fully rendered, HTML-escaped output string. */
  output: string
  /** Allow-listed variables used in the template that have no value. */
  missingRequired: string[]
  /** `{{name}}` placeholders used but NOT in the allow-list. */
  undeclared: string[]
}

/** Reserved JS/prototype property names that must never be resolved (mirrors server). */
const BLOCKED_KEYS = new Set<string>([
  '__proto__',
  'prototype',
  'constructor',
  'hasOwnProperty',
])
const NAME_RE = /^[A-Za-z0-9_.]+$/

/** Escape a string for safe HTML/text output, preventing script/markup injection. */
export function escapeHtmlTemplate(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** True when the variable name is a safe, non-prototype property path. */
export function isValidVariableName(name: string): boolean {
  if (!NAME_RE.test(name)) return false
  for (const seg of name.split('.')) {
    if (BLOCKED_KEYS.has(seg)) return false
  }
  return true
}

/** Extract the allow-listed variable names from a variable definition list. */
export function templateVariableNames(
  variables: TemplateVariable[] | null | undefined,
): string[] {
  return (variables ?? [])
    .map((v) => v.name.trim())
    .filter((n) => n !== '' && isValidVariableName(n))
}

/** Collect every distinct `{{name}}` placeholder referenced by template text. */
export function collectPlaceholders(template: string): string[] {
  const names = new Set<string>()
  const re = /{{([^{}]+)}}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(template)) !== null) {
    const raw = m[1]!.trim()
    if (isValidVariableName(raw)) names.add(raw)
  }
  return [...names]
}

/** Resolve a dotted variable path against a data context using only own keys. */
function resolve(data: Record<string, string>, path: string): string | undefined {
  const segments = path.split('.')
  // Mirror the server: refuse prototype/constructor property access at any level.
  for (const seg of segments) {
    if (BLOCKED_KEYS.has(seg)) return undefined
  }
  // Sample data is built with flat keys (e.g. `order.amount`), so check the
  // full path as a direct own property before attempting dotted traversal.
  if (Object.prototype.hasOwnProperty.call(data, path)) {
    return data[path]
  }
  let node: unknown = data
  for (const seg of segments) {
    if (node === null || node === undefined) return undefined
    if (typeof node !== 'object') return undefined
    const desc = Object.getOwnPropertyDescriptor(node, seg)
    if (!desc || !desc.enumerable) return undefined
    node = (node as Record<string, unknown>)[seg]
  }
  return typeof node === 'string' ? node : undefined
}

/**
 * Render a template body/subject against sample (or caller-supplied) data.
 * Mirrors the server engine's allow-list + HTML-escaping behaviour.
 */
export function renderTemplatePreview(
  template: string,
  variables: TemplateVariable[] | null | undefined,
  data?: Record<string, string>,
): TemplatePreviewRenderResult {
  const allowed = new Set(templateVariableNames(variables))
  const ctx = data ?? buildSampleData(variables)
  const missing = new Set<string>()
  const undeclared = new Set<string>()

  const output = template.replace(/{{([^{}]+)}}/g, (match, raw: string) => {
    const name = raw.trim()
    if (!isValidVariableName(name) || !allowed.has(name)) {
      undeclared.add(name)
      return escapeHtmlTemplate(match)
    }
    const value = resolve(ctx, name)
    if (value === undefined || value === '') {
      missing.add(name)
      return ''
    }
    return escapeHtmlTemplate(value)
  })

  return {
    output,
    missingRequired: [...missing],
    undeclared: [...undeclared],
  }
}

/** Build sample values for every allow-listed variable (same strategy as the server). */
export function buildSampleData(
  variables: TemplateVariable[] | null | undefined,
): Record<string, string> {
  const data: Record<string, string> = {}
  for (const v of variables ?? []) {
    const key = v.name.trim()
    if (key) data[key] = key.replace(/([A-Z])/g, ' $1').trim().toLowerCase()
  }
  return data
}