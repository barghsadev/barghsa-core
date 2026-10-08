import { HttpException, Injectable } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { ErrorCodes } from '@barghsa/shared/errors';
import { AiTestChatService, type TestChatResponse } from './ai-test-chat.service.js';
import type { KnowledgeAnswer } from './ai-knowledge-chat.service.js';

function fail(status: number, code: string, retryAfterMs?: number): never {
  throw new HttpException(
    { statusCode: status, error: code, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) },
    status
  );
}

/** Stateless public questions. Cookies, profiles and business tools never enter this scope. */
@Injectable()
export class AiWebsiteChatService {
  private active = 0;

  constructor(private readonly inference: AiTestChatService) {}

  async availability(): Promise<{ available: boolean }> {
    return { available: (await this.agent()) !== null };
  }

  async ask(
    message: string,
    actorKey: string
  ): Promise<{
    answer: KnowledgeAnswer;
    tokenUsage: TestChatResponse['tokenUsage'];
    latencyMs: number;
  }> {
    // Limit public work to two requests per API process; no additional DB lease spans this request.
    if (this.active >= 2) fail(503, 'AI_WEBSITE_BUSY');
    this.active++;
    const started = Date.now();
    try {
      const agentId = await this.agent();
      if (!agentId) fail(409, 'AI_WEBSITE_UNAVAILABLE');
      const quota = await getDbPool().query<{ count: number; reset_ms: string }>(
        'SELECT count,reset_ms FROM rate_limit_rolling(true,$1,60000,5,true)',
        ['ai:website:' + actorKey]
      );
      const count = Number(quota.rows[0]!.count);
      if (count > 5)
        fail(429, ErrorCodes.RATE_LIMIT_EXCEEDED.code, Number(quota.rows[0]!.reset_ms));
      const generated = await this.inference.answerForKnowledgeSlot({
        agentId,
        slotKey: 'website_chatbot',
        message,
        sessionId: null,
        userId: 'website:' + actorKey,
        remainingQuota: Math.max(0, 5 - count),
      });
      if ((await this.agent()) !== agentId) fail(409, 'AI_WEBSITE_SCOPE_CHANGED');
      const ids = [...new Set(generated.sources.map((source) => source.kbId))];
      const current = await getDbPool().query<{ id: string }>(
        `SELECT k.id FROM knowledge_bases k
         WHERE k.id=ANY($1::uuid[]) AND k.audience='public'
           AND k.is_enabled=true AND k.content_state='ready'
           AND (EXISTS (SELECT 1 FROM ai_agent_kbs ak WHERE ak.agent_id=$2 AND ak.kb_id=k.id)
                OR EXISTS (SELECT 1 FROM ai_agent_kb_groups ag JOIN kb_group_members gm ON gm.group_id=ag.group_id
                           WHERE ag.agent_id=$2 AND gm.kb_id=k.id))`,
        [ids, agentId]
      );
      if (!ids.length || current.rows.length !== ids.length) fail(409, 'AI_WEBSITE_SOURCE_CHANGED');
      return {
        answer: {
          reply: generated.reply.slice(0, 8_000),
          sources: generated.sources,
          attribution: 'retrieved_context',
          remainingQuota: generated.remainingQuota,
          answeredAt: new Date().toISOString(),
          policyChecks: [...new Set(generated.policyResults.map((policy) => policy.type))]
            .map((type) => ({
              type,
              count: generated.policyResults.filter(
                (policy) => policy.type === type && policy.result === 'applied'
              ).length,
            }))
            .filter((check) => check.count > 0),
        },
        tokenUsage: generated.tokenUsage,
        latencyMs: Date.now() - started,
      };
    } finally {
      this.active--;
    }
  }

  private async agent(): Promise<string | null> {
    const agent = (
      await getDbPool().query<{ agent_id: string; link_mode: 'any_kb' | 'all_kbs' }>(
        `SELECT s.agent_id,a.link_mode FROM ai_agent_slots s
       JOIN ai_agents a ON a.id=s.agent_id AND a.enabled=true
       JOIN ai_models m ON m.id=a.model_id AND m.is_enabled=true AND m.last_test_status='passed'
       WHERE s.slot_key='website_chatbot'`
      )
    ).rows[0];
    if (!agent) return null;
    const counts = (
      await getDbPool().query<{ total: string; eligible: string }>(
        `SELECT count(*) AS total,
              count(*) FILTER (WHERE k.is_enabled=true AND k.content_state='ready'
                AND k.vector_embedding_model IS NOT NULL AND k.audience='public') AS eligible
       FROM knowledge_bases k
       WHERE EXISTS (SELECT 1 FROM ai_agent_kbs ak WHERE ak.agent_id=$1 AND ak.kb_id=k.id)
          OR EXISTS (SELECT 1 FROM ai_agent_kb_groups ag JOIN kb_group_members gm ON gm.group_id=ag.group_id
                     WHERE ag.agent_id=$1 AND gm.kb_id=k.id)`,
        [agent.agent_id]
      )
    ).rows[0]!;
    if (
      Number(counts.eligible) === 0 ||
      (agent.link_mode === 'all_kbs' && counts.eligible !== counts.total)
    )
      return null;
    return agent.agent_id;
  }
}
