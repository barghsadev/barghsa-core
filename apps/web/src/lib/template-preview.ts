import {
  buildTemplateSampleData,
  renderTemplate as renderSharedTemplate,
  resolvePath,
} from '@barghsa/shared/notifications';
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
  name: string;
  description?: string | null;
}

export interface TemplatePreviewRenderResult {
  /** Fully rendered, HTML-escaped output string. */
  output: string;
  /** Allow-listed variables used in the template that have no value. */
  missingRequired: string[];
  /** `{{name}}` placeholders used but NOT in the allow-list. */
  undeclared: string[];
}

/** Reserved JS/prototype property names that must never be resolved (mirrors server). */
const BLOCKED_KEYS = new Set<string>(['__proto__', 'prototype', 'constructor', 'hasOwnProperty']);
const NAME_RE = /^[A-Za-z0-9_.]+$/;

/** Escape a string for safe HTML/text output, preventing script/markup injection. */
export function escapeHtmlTemplate(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** True when the variable name is a safe, non-prototype property path. */
export function isValidVariableName(name: string): boolean {
  if (!NAME_RE.test(name)) return false;
  for (const seg of name.split('.')) {
    if (!/^[A-Za-z0-9_]+$/.test(seg) || BLOCKED_KEYS.has(seg)) return false;
  }
  return true;
}

/** Extract the allow-listed variable names from a variable definition list. */
export function templateVariableNames(variables: TemplateVariable[] | null | undefined): string[] {
  return (variables ?? [])
    .map((v) => v.name.trim())
    .filter((n) => n !== '' && isValidVariableName(n));
}

/** Collect every distinct `{{name}}` placeholder referenced by template text. */
export function collectPlaceholders(template: string): string[] {
  const names = new Set<string>();
  const re = /{{([^{}]+)}}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    const raw = m[1]!.trim();
    if (isValidVariableName(raw)) names.add(raw);
  }
  return [...names];
}

/**
 * Render a template body/subject against sample (or caller-supplied) data.
 * Mirrors the server engine's allow-list + HTML-escaping behaviour.
 */
export function renderTemplatePreview(
  template: string,
  variables: TemplateVariable[] | null | undefined,
  data?: Record<string, unknown>,
  escapeValues = true
): TemplatePreviewRenderResult {
  const allowed = templateVariableNames(variables);
  const ctx = buildTemplateSampleData(allowed, data);
  const rendered = renderSharedTemplate(template, allowed, { data: ctx, escapeValues });
  const empty = collectPlaceholders(template).filter(
    (name) => allowed.includes(name) && resolvePath(ctx, name) === ''
  );
  return {
    output: rendered.output,
    missingRequired: [...new Set([...rendered.missing, ...empty])],
    undeclared: rendered.unknown,
  };
}

/** Build nested preview values using the same helper as server test sends. */
export function buildSampleData(
  variables: TemplateVariable[] | null | undefined
): Record<string, unknown> {
  return buildTemplateSampleData(templateVariableNames(variables));
}
