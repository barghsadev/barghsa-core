import { HttpException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { aiModelTestPrompt, type ChatCompletionInput } from '@barghsa/shared/ai-models';
import { AiModelCircuitBreaker } from '@barghsa/shared/notification-delivery';
import { completeWithinModelBudget } from './ai-model-budget.js';
import { aiInferenceQueue } from './ai-inference-queue.js';
import { completeViaAiWorker, isAiInfrastructureError } from './ai-inference-client.js';

/** Gate provider calls across API replicas and the separate model-test worker. */
export async function completeChatWithBreaker(modelId: string, input: ChatCompletionInput) {
  return aiInferenceQueue.run(async () => {
    const pool = getDbPool();
    const breaker = new AiModelCircuitBreaker({ query: (sql, params) => pool.query(sql, params) });
    const record = (ok: boolean, probeToken?: string) =>
      breaker.recordOutcome(modelId, {
        ok,
        transient: true,
        ...(probeToken ? { isProbe: true, probeToken } : {}),
      });

    const circuitOpen = () =>
      new HttpException({ statusCode: 503, error: 'AI_MODEL_CIRCUIT_OPEN' }, 503);
    const invoke = async (request: ChatCompletionInput, probeToken?: string) => {
      const result = await completeWithinModelBudget(modelId, request, async () => {
        if (probeToken) {
          const lease = await pool.query(
            `SELECT id FROM ai_model_circuit_states WHERE id=$1 AND degraded=true
             AND cooldown_until=$2::timestamptz AND cooldown_until>clock_timestamp()`,
            [modelId, probeToken]
          );
          if (!lease.rows.length) throw circuitOpen();
        } else {
          // Budget serialization can wait behind another request that trips the circuit.
          const admission = await breaker.decision(modelId);
          if (!admission.allow || admission.kind !== 'closed') throw circuitOpen();
        }
        try {
          return await completeViaAiWorker(modelId, request);
        } catch (error) {
          if (!isAiInfrastructureError(error)) await record(false, probeToken);
          if (probeToken && !isAiInfrastructureError(error)) throw circuitOpen();
          throw error;
        }
      });
      await record(true, probeToken);
      return result;
    };

    let decision = await breaker.decision(modelId);
    if (!decision.allow) throw circuitOpen();
    if (decision.kind === 'half_open') {
      // Probe only with the connection-test prompt, without customer messages.
      // Each call gets its own budget reservation and actual usage charge.
      await invoke(
        {
          ...input,
          messages: [{ role: 'user', content: aiModelTestPrompt(input.modelName) }],
          maxTokens: 32,
          temperature: 0,
        },
        decision.probeToken
      );
      decision = await breaker.decision(modelId);
      // An expired/stale probe must not admit customer work or claim recovery again.
      if (!decision.allow || decision.kind !== 'closed') throw circuitOpen();
    }
    return invoke(input);
  });
}
