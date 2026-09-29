import { HttpException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { AiModelTester, completeChat, type ChatCompletionInput } from '@barghsa/shared/ai-models';
import { AiModelCircuitBreaker } from '@barghsa/shared/notification-delivery';
import { completeWithinModelBudget } from './ai-model-budget.js';
import { aiInferenceQueue } from './ai-inference-queue.js';

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
      if (decision.kind === 'half_open') {
        const probe = await new AiModelTester().test(
          {
            providerType: input.providerType,
            baseUrl: input.baseUrl,
            modelName: input.modelName,
            apiToken: input.apiToken,
          },
          15_000
        );
        if (!probe.ok) {
          await record(false);
          throw new HttpException({ statusCode: 503, error: 'AI_MODEL_CIRCUIT_OPEN' }, 503);
        }
      }
      try {
        return await completeChat(input);
      } catch (error) {
        await record(false);
        throw error;
      }
    });
    await record(true);
    return result;
  });
}
