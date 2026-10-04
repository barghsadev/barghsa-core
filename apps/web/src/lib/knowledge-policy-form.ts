import { boundedCatalogueInteger, record } from './catalogue-form.js';
import { normalizeProfileDigits } from './profile-digits.js';

export type KnowledgeKind = 'knowledge-bases' | 'kb-groups';
export type PolicyKind = 'policies' | 'policy-groups';
export const policyTypes = [
  'allowed_topics',
  'disallowed_actions',
  'data_access_scope',
  'response_style',
  'content_filter',
  'output_format',
  'rate_limit',
] as const;
export type PolicyType = (typeof policyTypes)[number];
export interface KnowledgeDraft {
  id?: string;
  title: string;
  description: string;
  audience: 'admin' | 'staff' | 'customer' | 'public';
  sourceType: 'document' | 'url' | 'api';
  sourceUrl: string;
  chunkSize: string;
  chunkOverlap: string;
  vectorEmbeddingModel: string;
}
export interface PolicyDraft {
  id?: string;
  title: string;
  description: string;
  policyType: PolicyType;
  enabled: boolean;
  priority: string;
  items: string;
  tone: string;
  language: string;
  maxLength: string;
  requireSources: boolean;
  format: 'plain_text' | 'json_object';
  maxRequests: string;
  windowSeconds: string;
}
const urls = (value: string) =>
  value
    .split(/\r?\n/)
    .map((url) => url.trim())
    .filter(Boolean);
function httpsUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      value.startsWith('https://') &&
      !/\s/.test(value) &&
      url.protocol === 'https:' &&
      !!url.hostname &&
      value.length <= 2048
    );
  } catch {
    return false;
  }
}
export function policyPriority(value: string): number | null {
  const raw = normalizeProfileDigits(value).trim();
  const number = boundedCatalogueInteger(raw.startsWith('-') ? raw.slice(1) : raw, 0, 1000);
  return number === null ? null : raw.startsWith('-') ? -number : number;
}
export function invalidKnowledgeFields(
  value: KnowledgeDraft,
  kind: KnowledgeKind
): (keyof KnowledgeDraft)[] {
  const errors: (keyof KnowledgeDraft)[] = [];
  if (!value.title.trim() || value.title.trim().length > 120) errors.push('title');
  if (value.description.length > 2000) errors.push('description');
  if (kind === 'kb-groups') return errors;
  if (!['admin', 'staff', 'customer', 'public'].includes(value.audience)) errors.push('audience');
  if (!['document', 'url', 'api'].includes(value.sourceType)) errors.push('sourceType');
  if (value.sourceType === 'url') {
    const sources = urls(value.sourceUrl);
    if (!sources.length || sources.length > 20 || !sources.every(httpsUrl))
      errors.push('sourceUrl');
  } else if (value.sourceType === 'api' && !httpsUrl(value.sourceUrl.trim()))
    errors.push('sourceUrl');
  const size = boundedCatalogueInteger(value.chunkSize, 100, 4000),
    overlap = boundedCatalogueInteger(value.chunkOverlap, 0, 1000);
  if (size === null) errors.push('chunkSize');
  if (overlap === null || (size !== null && overlap >= size)) errors.push('chunkOverlap');
  if (value.vectorEmbeddingModel.trim().length > 120) errors.push('vectorEmbeddingModel');
  return errors;
}
export function knowledgeBody(value: KnowledgeDraft, kind: KnowledgeKind) {
  return {
    title: value.title.trim(),
    description: value.description,
    ...(kind === 'knowledge-bases'
      ? {
          audience: value.audience,
          sourceType: value.sourceType,
          sourceConfig:
            value.sourceType === 'url'
              ? { urls: urls(value.sourceUrl) }
              : value.sourceType === 'api'
                ? { apiUrl: value.sourceUrl.trim() }
                : {},
          chunkingStrategy: {
            size: boundedCatalogueInteger(value.chunkSize, 100, 4000),
            overlap: boundedCatalogueInteger(value.chunkOverlap, 0, 1000),
          },
          vectorEmbeddingModel: value.vectorEmbeddingModel.trim() || null,
        }
      : {}),
  };
}
const items = (value: string) =>
  value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
export function invalidPolicyFields(value: PolicyDraft, kind: PolicyKind): (keyof PolicyDraft)[] {
  const errors: (keyof PolicyDraft)[] = [];
  if (!value.title.trim() || value.title.trim().length > 120) errors.push('title');
  if (value.description.length > 2000) errors.push('description');
  if (kind === 'policy-groups') return errors;
  if (!policyTypes.includes(value.policyType)) errors.push('policyType');
  if (policyPriority(value.priority) === null) errors.push('priority');
  if (typeof value.enabled !== 'boolean') errors.push('enabled');
  if (value.policyType === 'response_style') {
    if (!value.tone.trim() || value.tone.trim().length > 200) errors.push('tone');
    if (value.language.trim().length > 50) errors.push('language');
    if (value.maxLength.trim() && boundedCatalogueInteger(value.maxLength, 1, 100000) === null)
      errors.push('maxLength');
    if (typeof value.requireSources !== 'boolean') errors.push('requireSources');
  } else if (value.policyType === 'output_format') {
    if (!['plain_text', 'json_object'].includes(value.format)) errors.push('format');
  } else if (value.policyType === 'rate_limit') {
    if (boundedCatalogueInteger(value.maxRequests, 1, 100) === null) errors.push('maxRequests');
    if (boundedCatalogueInteger(value.windowSeconds, 1, 3600) === null)
      errors.push('windowSeconds');
  } else {
    const entries = items(value.items);
    if (!entries.length || entries.length > 200 || entries.some((item) => item.length > 200))
      errors.push('items');
  }
  return errors;
}
export function policyBody(value: PolicyDraft, kind: PolicyKind) {
  const rules =
    value.policyType === 'response_style'
      ? {
          tone: value.tone.trim(),
          ...(value.language.trim() ? { language: value.language.trim() } : {}),
          ...(value.maxLength.trim()
            ? { maxLength: boundedCatalogueInteger(value.maxLength, 1, 100000) }
            : {}),
          ...(value.requireSources ? { requireSources: true } : {}),
        }
      : value.policyType === 'output_format'
        ? { format: value.format }
        : value.policyType === 'rate_limit'
          ? {
              maxRequests: boundedCatalogueInteger(value.maxRequests, 1, 100),
              windowSeconds: boundedCatalogueInteger(value.windowSeconds, 1, 3600),
            }
          : {
              [{
                allowed_topics: 'topics',
                disallowed_actions: 'actions',
                data_access_scope: 'scopes',
                content_filter: 'blockedTerms',
                response_style: 'tone',
                output_format: 'format',
                rate_limit: 'maxRequests',
              }[value.policyType]]: items(value.items),
            };
  return {
    title: value.title.trim(),
    description: value.description,
    ...(kind === 'policies'
      ? {
          policyType: value.policyType,
          rules,
          enabled: value.enabled,
          priority: policyPriority(value.priority),
        }
      : {}),
  };
}
function same(value: unknown, expected: unknown): boolean {
  if (value === expected) return true;
  if (Array.isArray(expected))
    return (
      Array.isArray(value) &&
      value.length === expected.length &&
      expected.every((v, i) => same(value[i], v))
    );
  return (
    record(value) &&
    record(expected) &&
    Object.keys(value).length === Object.keys(expected).length &&
    Object.keys(expected).every(
      (key) => Object.hasOwn(value, key) && same(value[key], expected[key])
    )
  );
}
/** DTO metadata may vary; every submitted setting and the selected identity must match. */
export function matchesAiCatalogueReceipt(
  value: unknown,
  body: Record<string, unknown>,
  id?: string
): boolean {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id) &&
    (!id || value.id === id) &&
    Object.keys(body).every((key) => Object.hasOwn(value, key) && same(value[key], body[key]))
  );
}
