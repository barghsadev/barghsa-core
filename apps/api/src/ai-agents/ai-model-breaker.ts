import { HttpException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { AiModelTester, completeChat, type ChatCompletionInput } from '@barghsa/shared/ai-models';
import { AiModelCircuitBreaker } from '@barghsa/shared/notification-delivery';

/** Gate provider calls across API replicas and the separate model-test worker. */
export async function completeChatWithBreaker(modelId: string, input: ChatCompletionInput) {
  const pool = getDbPool();
  const breaker = new AiModelCircuitBreaker({ query: (sql, params) => pool.query(sql, params) });
  const decision = await breaker.decision(modelId);
  if (!decision.allow)
    throw new HttpException({ statusCode: 503, error: 'AI_MODEL_CIRCUIT_OPEN' }, 503);
  const probeToken = decision.kind === 'half_open' ? decision.probeToken : undefined;
  const record = (ok: boolean) =>
    breaker.recordOutcome(modelId, {
      ok,
      transient: true,
      ...(probeToken ? { isProbe: true, probeToken } : {}),
    });

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

  let result: Awaited<ReturnType<typeof completeChat>>;
  try {
    result = await completeChat(input);
  } catch (error) {
    await record(false);
    throw error;
  }
  await record(true);
  return result;
}
