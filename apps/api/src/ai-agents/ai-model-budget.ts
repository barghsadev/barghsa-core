import { HttpException } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import type { ChatCompletionInput, ChatCompletionResult } from '@barghsa/shared/ai-models';

interface BudgetRow {
  monthly_token_limit: string | null;
  monthly_cost_limit_micros: string | null;
  input_price_per_million_micros: string;
  output_price_per_million_micros: string;
  used_input_tokens: string;
  used_output_tokens: string;
  used_cost_micros: string;
  alerted_at: string | null;
}

function costMicros(inputTokens: bigint, outputTokens: bigint, row: BudgetRow): bigint {
  const million = 1_000_000n;
  const input = inputTokens * BigInt(row.input_price_per_million_micros);
  const output = outputTokens * BigInt(row.output_price_per_million_micros);
  return (input + output + million - 1n) / million;
}

/** Serialize budgeted calls per model so concurrent API replicas cannot overspend a monthly limit. */
export async function completeWithinModelBudget(
  modelId: string,
  input: ChatCompletionInput,
  invoke: () => Promise<ChatCompletionResult>
): Promise<ChatCompletionResult> {
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE ai_model_budgets SET used_input_tokens=0,used_output_tokens=0,
         used_cost_micros=0,alerted_at=NULL,
         period_start=(date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),
         updated_at=now()
       WHERE model_id=$1 AND period_start <
         (date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`,
      [modelId]
    );
    const row = (
      await client.query<BudgetRow>(
        `SELECT monthly_token_limit,monthly_cost_limit_micros,
                input_price_per_million_micros,output_price_per_million_micros,
                used_input_tokens,used_output_tokens,used_cost_micros,alerted_at
         FROM ai_model_budgets WHERE model_id=$1 FOR UPDATE`,
        [modelId]
      )
    ).rows[0];
    if (!row) {
      await client.query('COMMIT');
      return invoke();
    }

    // A UTF-8 byte per input token is deliberately conservative across supported models.
    // The output bound is the provider request's max_tokens, not an average response.
    const reservedInput = BigInt(Buffer.byteLength(JSON.stringify(input.messages), 'utf8'));
    const reservedOutput = BigInt(input.maxTokens);
    const usedTokens = BigInt(row.used_input_tokens) + BigInt(row.used_output_tokens);
    const usedCost = BigInt(row.used_cost_micros);
    if (
      (row.monthly_token_limit !== null &&
        usedTokens + reservedInput + reservedOutput > BigInt(row.monthly_token_limit)) ||
      (row.monthly_cost_limit_micros !== null &&
        usedCost + costMicros(reservedInput, reservedOutput, row) >
          BigInt(row.monthly_cost_limit_micros))
    ) {
      throw new HttpException({ statusCode: 429, error: 'AI_MODEL_BUDGET_EXHAUSTED' }, 429);
    }

    const completion = await invoke();
    const actualInput = BigInt(completion.tokenUsage?.input ?? Number(reservedInput));
    const actualOutput = BigInt(completion.tokenUsage?.output ?? Number(reservedOutput));
    const charge = costMicros(actualInput, actualOutput, row);
    await client.query(
      `UPDATE ai_model_budgets SET used_input_tokens=used_input_tokens+$2,
         used_output_tokens=used_output_tokens+$3,used_cost_micros=used_cost_micros+$4,
         updated_at=now() WHERE model_id=$1`,
      [modelId, actualInput.toString(), actualOutput.toString(), charge.toString()]
    );
    const nextTokens = usedTokens + actualInput + actualOutput;
    const nextCost = usedCost + charge;
    const thresholdReached =
      (row.monthly_token_limit !== null &&
        nextTokens * 5n >= BigInt(row.monthly_token_limit) * 4n) ||
      (row.monthly_cost_limit_micros !== null &&
        nextCost * 5n >= BigInt(row.monthly_cost_limit_micros) * 4n);
    if (thresholdReached && row.alerted_at === null) {
      const notices = await client.query(
        `INSERT INTO notifications(user_id,type,title,body,link)
         SELECT DISTINCT u.user_id,'general'::notification_type,
           CASE WHEN u.locale='en' THEN 'AI model budget reached 80%'
                ELSE 'بودجه مدل هوش مصنوعی به ۸۰٪ رسید' END,
           CASE WHEN u.locale='en' THEN 'Review the monthly budget for '||m.title||'.'
                ELSE 'بودجه ماهانه مدل '||m.title||' را بررسی کنید.' END,
           '/admin/ai-models'
         FROM ai_models m JOIN user_roles ur ON true
         JOIN staff_roles sr ON sr.role_id=ur.role_id
         JOIN users u ON u.user_id=ur.user_id
         WHERE m.id=$1 AND u.is_staff=true
           AND (sr.permissions::jsonb ? 'admin:ai:models'
                           OR sr.permissions::jsonb ? '*')
         RETURNING id`,
        [modelId]
      );
      if (notices.rowCount)
        await client.query('UPDATE ai_model_budgets SET alerted_at=now() WHERE model_id=$1', [
          modelId,
        ]);
    }
    await client.query('COMMIT');
    return completion;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
