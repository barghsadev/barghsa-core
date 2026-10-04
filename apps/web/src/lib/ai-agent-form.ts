export interface Ref {
  id: string;
  title: string;
}
export interface Agent extends Ref {
  description: string;
  modelId: string;
  modelTitle: string;
  enabled: boolean;
}
export interface Detail extends Agent {
  systemPrompt: string;
  temperature: number | null;
  maxTokens: number | null;
  linkMode: 'any_kb' | 'all_kbs';
  kbs: Ref[];
  policies: Ref[];
  kbGroups: Ref[];
  policyGroups: Ref[];
}
export interface Options {
  models: Ref[];
  kbs: Ref[];
  policies: Ref[];
  kbGroups: Ref[];
  policyGroups: Ref[];
}
export interface Draft {
  title: string;
  description: string;
  modelId: string;
  systemPrompt: string;
  temperature: string;
  maxTokens: string;
  linkMode: 'any_kb' | 'all_kbs';
  enabled: boolean;
  kbIds: string[];
  policyIds: string[];
  kbGroupIds: string[];
  policyGroupIds: string[];
}
export const sets = [
  ['kbIds', 'kbs'],
  ['policyIds', 'policies'],
  ['kbGroupIds', 'kbGroups'],
  ['policyGroupIds', 'policyGroups'],
] as const;
export const emptyOptions: Options = {
  models: [],
  kbs: [],
  policies: [],
  kbGroups: [],
  policyGroups: [],
};
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function refs(value: unknown): value is Ref[] {
  return (
    Array.isArray(value) &&
    value.every(
      (v) => record(v) && typeof v.id === 'string' && !!v.id && typeof v.title === 'string'
    ) &&
    new Set(value.map((v) => v.id)).size === value.length
  );
}
export function validAgents(value: unknown): value is Agent[] {
  return (
    Array.isArray(value) &&
    value.every(
      (v) =>
        record(v) &&
        ['id', 'title', 'description', 'modelId', 'modelTitle'].every(
          (k) => typeof v[k] === 'string'
        ) &&
        typeof v.enabled === 'boolean' &&
        !!v.id &&
        !!v.modelId
    ) &&
    new Set(value.map((v) => v.id)).size === value.length
  );
}
export function validOptions(value: unknown): value is Options {
  return (
    record(value) &&
    ['models', 'kbs', 'policies', 'kbGroups', 'policyGroups'].every((k) => refs(value[k]))
  );
}
export function validDetail(value: unknown, id: string): value is Detail {
  return (
    record(value) &&
    validAgents([value]) &&
    value.id === id &&
    typeof value.systemPrompt === 'string' &&
    (value.temperature === null ||
      (typeof value.temperature === 'number' &&
        Number.isFinite(value.temperature) &&
        value.temperature >= 0 &&
        value.temperature <= 2)) &&
    (value.maxTokens === null ||
      (typeof value.maxTokens === 'number' &&
        Number.isSafeInteger(value.maxTokens) &&
        value.maxTokens >= 1 &&
        value.maxTokens <= 8192)) &&
    ['any_kb', 'all_kbs'].includes(String(value.linkMode)) &&
    ['kbs', 'policies', 'kbGroups', 'policyGroups'].every((k) => refs(value[k]))
  );
}
export function detailSnapshot(data: Detail) {
  return JSON.stringify({
    title: data.title,
    description: data.description,
    modelId: data.modelId,
    enabled: data.enabled,
    systemPrompt: data.systemPrompt,
    temperature: data.temperature,
    maxTokens: data.maxTokens,
    linkMode: data.linkMode,
    kbs: data.kbs.map((v) => v.id).sort(),
    policies: data.policies.map((v) => v.id).sort(),
    kbGroups: data.kbGroups.map((v) => v.id).sort(),
    policyGroups: data.policyGroups.map((v) => v.id).sort(),
  });
}
export function rowBasis(row: Agent) {
  return JSON.stringify({
    id: row.id,
    title: row.title,
    description: row.description,
    modelId: row.modelId,
    enabled: row.enabled,
  });
}
export function eligible(draft: Draft, options: Options) {
  return (
    options.models.some((m) => m.id === draft.modelId) &&
    sets.every(([field, source]) =>
      draft[field].every((id) => options[source].some((item) => item.id === id))
    )
  );
}
export const blank = (): Draft => ({
  title: '',
  description: '',
  modelId: '',
  systemPrompt: '',
  temperature: '',
  maxTokens: '',
  linkMode: 'any_kb',
  enabled: true,
  kbIds: [],
  policyIds: [],
  kbGroupIds: [],
  policyGroupIds: [],
});

const uuid = (value: string) => /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export function agentDraftFor(data: Detail): Draft {
  return {
    title: data.title,
    description: data.description,
    modelId: data.modelId,
    systemPrompt: data.systemPrompt,
    temperature: data.temperature === null ? '' : String(data.temperature),
    maxTokens: data.maxTokens === null ? '' : String(data.maxTokens),
    linkMode: data.linkMode,
    enabled: data.enabled,
    kbIds: data.kbs.map((v) => v.id),
    policyIds: data.policies.map((v) => v.id),
    kbGroupIds: data.kbGroups.map((v) => v.id),
    policyGroupIds: data.policyGroups.map((v) => v.id),
  };
}
export function invalidAgentFields(draft: Draft, options: Options): (keyof Draft)[] {
  const invalid: (keyof Draft)[] = [];
  if (!draft.title.trim() || draft.title.trim().length > 120) invalid.push('title');
  if (draft.description.length > 2000) invalid.push('description');
  if (!uuid(draft.modelId) || !options.models.some((v) => v.id === draft.modelId))
    invalid.push('modelId');
  if (draft.systemPrompt.length > 8000) invalid.push('systemPrompt');
  if (
    draft.temperature.trim() &&
    (!Number.isFinite(Number(draft.temperature)) ||
      Number(draft.temperature) < 0 ||
      Number(draft.temperature) > 2)
  )
    invalid.push('temperature');
  if (
    draft.maxTokens.trim() &&
    (!Number.isSafeInteger(Number(draft.maxTokens)) ||
      Number(draft.maxTokens) < 1 ||
      Number(draft.maxTokens) > 8192)
  )
    invalid.push('maxTokens');
  if (!['any_kb', 'all_kbs'].includes(draft.linkMode)) invalid.push('linkMode');
  if (typeof draft.enabled !== 'boolean') invalid.push('enabled');
  for (const [field, source] of sets)
    if (
      draft[field].length > 200 ||
      new Set(draft[field]).size !== draft[field].length ||
      draft[field].some((id) => !uuid(id) || !options[source].some((v) => v.id === id))
    )
      invalid.push(field);
  return invalid;
}
export function agentBody(draft: Draft) {
  return {
    ...draft,
    title: draft.title.trim(),
    temperature: draft.temperature.trim() ? Number(draft.temperature) : null,
    maxTokens: draft.maxTokens.trim() ? Number(draft.maxTokens) : null,
  };
}
export function matchesAgentReceipt(value: unknown, draft: Draft, id?: string): value is Agent {
  if (
    !validAgents([value]) ||
    !record(value) ||
    typeof value.id !== 'string' ||
    !uuid(value.id) ||
    (id && value.id !== id)
  )
    return false;
  const body = agentBody(draft);
  return (
    [
      'title',
      'description',
      'modelId',
      'systemPrompt',
      'temperature',
      'maxTokens',
      'linkMode',
      'enabled',
    ] as const
  ).every((key) => value[key] === body[key]);
}
export function matchesAgentDetail(value: unknown, draft: Draft, id: string): value is Detail {
  return (
    matchesAgentReceipt(value, draft, id) &&
    validDetail(value, id) &&
    sets.every(
      ([field, source]) =>
        JSON.stringify(value[source].map((v) => v.id).sort()) ===
        JSON.stringify([...draft[field]].sort())
    )
  );
}
