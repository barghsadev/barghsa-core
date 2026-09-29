import { HttpException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import type { ChatCompletionInput } from '@barghsa/shared/ai-models';
import { AiModelCircuitBreaker } from '@barghsa/shared/notification-delivery';
import { completeWithinModelBudget } from './ai-model-budget.js';
import { aiInferenceQueue } from './ai-inference-queue.js';
import { completeViaAiWorker, isAiInfrastructureError } from './ai-inference-client.js';

/** Gate provider calls across API replicas and the separate model-test worker. */
export async function completeChatWithBreaker(modelId: string, input: ChatCompletionInput) {
  return aiInferenceQueue.run(async () => {
    const pool = getDbPool();
    const breaker = new AiModelCircuitBreaker({ query: (sql, params) => pool.query(sql, params) });
    let probeToken: string | undefined;
    const record = (ok: boolean) =>
      breaker.recordOutcome(modelId, {
        ok,
        transient: true,
        ...(probeToken ? { isProbe: true, probeToken } : {}),
      });

    const result = await completeWithinModelBudget(modelId, input, async () => {
      const decision = await breaker.decision(modelId);
      if (!decision.allow)
        throw new HttpException({ statusCode: 503, error: 'AI_MODEL_CIRCUIT_OPEN' }, 503);
      probeToken = decision.kind === 'half_open' ? decision.probeToken : undefined;
      // The actual completion is the single half-open probe; provider I/O stays in the worker.
      try {
        return await completeViaAiWorker(modelId, input);
      } catch (error) {
        if (!isAiInfrastructureError(error)) await record(false);
        throw error;
      }
    });
    await record(true);
    return result;
  });
}
