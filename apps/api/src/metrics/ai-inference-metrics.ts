import promClient from 'prom-client';
import type { ChatCompletionResult } from '@barghsa/shared/ai-models';

const completionDuration = new promClient.Histogram({
  name: 'ai_model_completion_duration_seconds',
  help: 'Duration and count of admitted model completion attempts',
  labelNames: ['model_id', 'outcome'] as const,
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120],
});

const reportedTokens = new promClient.Counter({
  name: 'ai_model_reported_tokens_total',
  help: 'Tokens reported by model completion providers',
  labelNames: ['model_id', 'direction'] as const,
});

const budgetCharges = new promClient.Counter({
  name: 'ai_model_budget_charged_usd_total',
  help: 'USD charged to model budgets after successful ledger commits',
  labelNames: ['model_id'] as const,
});

export function observeAiModelBudgetCharge(modelId: string, chargeMicros: bigint): void {
  budgetCharges.inc({ model_id: modelId }, Number(chargeMicros) / 1_000_000);
}

export function observeAiModelCompletion(
  modelId: string,
  seconds: number,
  outcome: 'success' | 'error',
  usage?: ChatCompletionResult['tokenUsage']
): void {
  completionDuration.observe({ model_id: modelId, outcome }, seconds);
  if (usage) {
    reportedTokens.inc({ model_id: modelId, direction: 'input' }, usage.input);
    reportedTokens.inc({ model_id: modelId, direction: 'output' }, usage.output);
  }
}
