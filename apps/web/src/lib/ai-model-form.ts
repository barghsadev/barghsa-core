export interface Model {
  id: string;
  title: string;
  providerType: 'openai_compatible' | 'anthropic';
  baseUrl: string;
  modelName: string;
  config: { max_tokens: number; temperature: number };
  isEnabled: boolean;
  apiTokenMasked: string;
  status: 'reachable' | 'unreachable' | 'unknown';
  lastTestedAt: string | null;
  lastTestError: string | null;
  lastTestLatencyMs: number | null;
  circuitOpen: boolean;
  circuitCooldownUntil: string | null;
  budget: {
    monthlyTokenLimit: number | null;
    monthlyCostLimitMicros: number | null;
    inputPricePerMillionMicros: number;
    outputPricePerMillionMicros: number;
    usedInputTokens: number;
    usedOutputTokens: number;
    usedCostMicros: number;
    periodStart: string;
    alertedAt: string | null;
  } | null;
}
export interface BudgetDraft {
  modelId: string;
  modelTitle: string;
  monthlyTokenLimit: string;
  monthlyCostUsd: string;
  inputPriceUsd: string;
  outputPriceUsd: string;
}
export interface Draft {
  id?: string;
  title: string;
  providerType: Model['providerType'];
  baseUrl: string;
  modelName: string;
  maxTokens: string;
  temperature: string;
  apiToken: string;
  tokenChoice: 'keep' | 'replace' | 'clear';
  masked: string;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
const maskedToken = (value: string) =>
  value.startsWith('*') && value.replace(/^\*+/, '').length <= 4;
const nonnegativeInteger = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export function validModels(value: unknown): value is Model[] {
  return (
    Array.isArray(value) &&
    value.every((m) => {
      if (!record(m) || Object.hasOwn(m, 'apiToken')) return false;
      const budget = m.budget;
      return (
        ['id', 'title', 'baseUrl', 'modelName', 'apiTokenMasked'].every(
          (k) => typeof m[k] === 'string'
        ) &&
        typeof m.id === 'string' &&
        m.id.trim().length > 0 &&
        typeof m.apiTokenMasked === 'string' &&
        (m.apiTokenMasked === '' ||
          m.apiTokenMasked === '[encrypted]' ||
          maskedToken(m.apiTokenMasked)) &&
        ['openai_compatible', 'anthropic'].includes(String(m.providerType)) &&
        typeof m.isEnabled === 'boolean' &&
        ['reachable', 'unreachable', 'unknown'].includes(String(m.status)) &&
        record(m.config) &&
        nonnegativeInteger(m.config.max_tokens) &&
        Number(m.config.max_tokens) >= 1 &&
        Number(m.config.max_tokens) <= 4096 &&
        typeof m.config.temperature === 'number' &&
        Number.isFinite(m.config.temperature) &&
        m.config.temperature >= 0 &&
        m.config.temperature <= 2 &&
        (budget === null ||
          (record(budget) &&
            ['monthlyTokenLimit', 'monthlyCostLimitMicros'].every(
              (k) => budget[k] === null || (nonnegativeInteger(budget[k]) && Number(budget[k]) > 0)
            ) &&
            [
              'inputPricePerMillionMicros',
              'outputPricePerMillionMicros',
              'usedInputTokens',
              'usedOutputTokens',
              'usedCostMicros',
            ].every((k) => nonnegativeInteger(budget[k]))))
      );
    }) &&
    new Set(value.map((m) => m.id)).size === value.length
  );
}
export function modelBasis(model: Model, kind: 'model' | 'budget' | 'command') {
  if (kind === 'budget')
    return JSON.stringify({
      monthlyTokenLimit: model.budget?.monthlyTokenLimit ?? null,
      monthlyCostLimitMicros: model.budget?.monthlyCostLimitMicros ?? null,
      inputPricePerMillionMicros: model.budget?.inputPricePerMillionMicros ?? 0,
      outputPricePerMillionMicros: model.budget?.outputPricePerMillionMicros ?? 0,
    });
  return JSON.stringify({
    title: model.title,
    providerType: model.providerType,
    baseUrl: model.baseUrl,
    modelName: model.modelName,
    config: [model.config.max_tokens, model.config.temperature],
    isEnabled: model.isEnabled,
    apiTokenMasked: model.apiTokenMasked,
    ...(kind === 'command' ? { status: model.status } : {}),
  });
}
export const blank = (): Draft => ({
  title: '',
  providerType: 'openai_compatible',
  baseUrl: '',
  modelName: '',
  maxTokens: '256',
  temperature: '0',
  apiToken: '',
  tokenChoice: 'replace',
  masked: '',
});
export function modelDraftFor(model: Model): Draft {
  return {
    id: model.id,
    title: model.title,
    providerType: model.providerType,
    baseUrl: model.baseUrl,
    modelName: model.modelName,
    maxTokens: String(model.config.max_tokens),
    temperature: String(model.config.temperature),
    apiToken: '',
    tokenChoice: 'keep',
    masked: model.apiTokenMasked,
  };
}
export function budgetDraftFor(model: Model): BudgetDraft {
  return {
    modelId: model.id,
    modelTitle: model.title,
    monthlyTokenLimit: model.budget?.monthlyTokenLimit?.toString() ?? '',
    monthlyCostUsd:
      model.budget?.monthlyCostLimitMicros == null
        ? ''
        : String(model.budget.monthlyCostLimitMicros / 1_000_000),
    inputPriceUsd: String((model.budget?.inputPricePerMillionMicros ?? 0) / 1_000_000),
    outputPriceUsd: String((model.budget?.outputPricePerMillionMicros ?? 0) / 1_000_000),
  };
}
const whole = (value: string, min: number, max: number) =>
  value.trim() !== '' &&
  Number.isSafeInteger(Number(value)) &&
  Number(value) >= min &&
  Number(value) <= max;
/** Parse decimal USD without rounding away a submitted fraction of a microdollar. */
export function usdMicros(value: string): number | null {
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) return null;
  const [units, rawFraction = ''] = value.trim().split('.');
  const fraction = rawFraction.replace(/0+$/, '');
  if (fraction.length > 6) return null;
  const result = Number(units || '0') * 1_000_000 + Number(fraction.padEnd(6, '0'));
  return Number.isSafeInteger(result) ? result : null;
}
export function invalidModelFields(draft: Draft, stored?: Model): (keyof Draft)[] {
  const invalid: (keyof Draft)[] = [];
  if (!draft.title.trim() || draft.title.trim().length > 120) invalid.push('title');
  if (!['openai_compatible', 'anthropic'].includes(draft.providerType))
    invalid.push('providerType');
  try {
    const url = new URL(draft.baseUrl.trim());
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      draft.baseUrl.trim().length > 500
    )
      invalid.push('baseUrl');
  } catch {
    invalid.push('baseUrl');
  }
  if (!draft.modelName.trim() || draft.modelName.trim().length > 200) invalid.push('modelName');
  if (!whole(draft.maxTokens, 1, 4096)) invalid.push('maxTokens');
  if (
    !draft.temperature.trim() ||
    !Number.isFinite(Number(draft.temperature)) ||
    Number(draft.temperature) < 0 ||
    Number(draft.temperature) > 2
  )
    invalid.push('temperature');
  if (!['keep', 'replace', 'clear'].includes(draft.tokenChoice)) invalid.push('tokenChoice');
  const destinationChanged =
    stored &&
    (draft.baseUrl.trim() !== stored.baseUrl || draft.providerType !== stored.providerType);
  const token = draft.apiToken.trim();
  if (
    draft.tokenChoice === 'replace' &&
    (draft.apiToken.length > 4000 ||
      (token.startsWith('*') && token.replace(/^\*+/, '').length <= 4) ||
      (!!stored?.apiTokenMasked && !token))
  )
    invalid.push('apiToken');
  if (destinationChanged && !!stored.apiTokenMasked && draft.tokenChoice === 'keep')
    invalid.push('tokenChoice');
  return invalid;
}
export function invalidBudgetFields(draft: BudgetDraft): (keyof BudgetDraft)[] {
  const invalid: (keyof BudgetDraft)[] = [];
  if (draft.monthlyTokenLimit.trim() && !whole(draft.monthlyTokenLimit, 1, 1_000_000_000))
    invalid.push('monthlyTokenLimit');
  const cost = usdMicros(draft.monthlyCostUsd),
    input = usdMicros(draft.inputPriceUsd),
    output = usdMicros(draft.outputPriceUsd);
  if (draft.monthlyCostUsd.trim() && (cost === null || cost < 1 || cost > 1_000_000_000_000))
    invalid.push('monthlyCostUsd');
  if (
    input === null ||
    input < 0 ||
    input > 1_000_000_000 ||
    (draft.monthlyCostUsd.trim() && input === 0)
  )
    invalid.push('inputPriceUsd');
  if (
    output === null ||
    output < 0 ||
    output > 1_000_000_000 ||
    (draft.monthlyCostUsd.trim() && output === 0)
  )
    invalid.push('outputPriceUsd');
  return invalid;
}
export function modelBody(draft: Draft) {
  return {
    title: draft.title.trim(),
    providerType: draft.providerType,
    baseUrl: draft.baseUrl.trim(),
    modelName: draft.modelName.trim(),
    config: { max_tokens: Number(draft.maxTokens), temperature: Number(draft.temperature) },
    ...(draft.tokenChoice === 'clear'
      ? { apiToken: '' }
      : draft.tokenChoice === 'replace'
        ? { apiToken: draft.apiToken }
        : {}),
  };
}
export function budgetBody(draft: BudgetDraft) {
  return {
    monthlyTokenLimit: draft.monthlyTokenLimit.trim() ? Number(draft.monthlyTokenLimit) : null,
    monthlyCostLimitMicros: draft.monthlyCostUsd.trim() ? usdMicros(draft.monthlyCostUsd) : null,
    inputPricePerMillionMicros: usdMicros(draft.inputPriceUsd)!,
    outputPricePerMillionMicros: usdMicros(draft.outputPriceUsd)!,
  };
}
export function matchesModelReceipt(value: unknown, draft: Draft): value is Model {
  return (
    validModels([value]) &&
    record(value) &&
    (!draft.id || value.id === draft.id) &&
    value.title === draft.title.trim() &&
    value.providerType === draft.providerType &&
    value.baseUrl === draft.baseUrl.trim() &&
    value.modelName === draft.modelName.trim() &&
    record(value.config) &&
    value.config.max_tokens === Number(draft.maxTokens) &&
    value.config.temperature === Number(draft.temperature) &&
    (draft.tokenChoice !== 'clear' || value.apiTokenMasked === '') &&
    (draft.tokenChoice !== 'keep' || value.apiTokenMasked === draft.masked) &&
    (draft.tokenChoice !== 'replace' ||
      (draft.apiToken.trim() ? !!value.apiTokenMasked : value.apiTokenMasked === ''))
  );
}
export function matchesBudgetReceipt(value: unknown, draft: BudgetDraft): value is Model {
  if (!validModels([value]) || !record(value) || value.id !== draft.modelId) return false;
  const body = budgetBody(draft);
  if (body.monthlyTokenLimit === null && body.monthlyCostLimitMicros === null)
    return value.budget === null;
  const budget = value.budget;
  return record(budget) && Object.entries(body).every(([key, field]) => budget[key] === field);
}
