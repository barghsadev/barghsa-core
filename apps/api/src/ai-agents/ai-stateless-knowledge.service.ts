import { HttpException, Injectable } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { ErrorCodes } from '@barghsa/shared/errors';
import { AiTestChatService, type TestChatResponse } from './ai-test-chat.service.js';
import type { KnowledgeAnswer } from './ai-knowledge-chat.service.js';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { requireCurrentSession } from '../session/session-step-up.js';
import { requireRouteOperatingContext } from '../session/operating-context.js';

type Slot = 'website_chatbot' | 'staff_chatbot' | 'telegram_chatbot';
type Session = { sessionId: string; userId: string; csrfToken: string };
const audiencesFor = (slot: Slot) =>
  slot === 'website_chatbot'
    ? ['public']
    : slot === 'staff_chatbot'
      ? ['staff', 'public']
      : ['customer', 'public'];

function fail(status: number, code: string, retryAfterMs?: number): never {
  throw new HttpException(
    { statusCode: status, error: code, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) },
    status
  );
}

/** Fixed-slot, stateless knowledge. No conversation, customer profile or business tools. */
@Injectable()
export class AiStatelessKnowledgeService {
  private active = 0;

  constructor(private readonly inference: AiTestChatService) {}

  async availability(): Promise<{ available: boolean }> {
    return { available: (await this.agent('website_chatbot')) !== null };
  }

  async staffAvailability(session: Session): Promise<{ available: boolean }> {
    await this.staffAuthority(session);
    return { available: (await this.agent('staff_chatbot')) !== null };
  }

  async askStaff(message: string, session: Session) {
    await this.staffAuthority(session);
    const result = await this.askSlot(message, session.userId, 'staff_chatbot', session.sessionId);
    await this.staffAuthority(session);
    return result;
  }

  ask(message: string, actorKey: string) {
    return this.askSlot(message, actorKey, 'website_chatbot', null);
  }

  async askTelegram(
    message: string,
    userId: string,
    profileId: string,
    authority: () => Promise<void>
  ) {
    await authority();
    const result = await this.askSlot(
      message,
      userId,
      'telegram_chatbot',
      null,
      userId + ':' + profileId
    );
    await authority();
    return result;
  }

  async verifyTelegramSources(agentId: string, ids: string[]) {
    if ((await this.agent('telegram_chatbot')) !== agentId || !ids.length) return false;
    const current = await getDbPool().query(
      `SELECT k.id FROM knowledge_bases k WHERE k.id=ANY($1::uuid[]) AND k.audience IN ('customer','public')
       AND k.is_enabled=true AND k.content_state='ready'
       AND (EXISTS(SELECT 1 FROM ai_agent_kbs ak WHERE ak.agent_id=$2 AND ak.kb_id=k.id)
         OR EXISTS(SELECT 1 FROM ai_agent_kb_groups ag JOIN kb_group_members gm ON gm.group_id=ag.group_id
           WHERE ag.agent_id=$2 AND gm.kb_id=k.id))`,
      [[...new Set(ids)], agentId]
    );
    return current.rows.length === new Set(ids).size;
  }

  private async askSlot(
    message: string,
    actorKey: string,
    slotKey: Slot,
    sessionId: string | null,
    quotaKey = actorKey
  ): Promise<{
    answer: KnowledgeAnswer;
    tokenUsage: TestChatResponse['tokenUsage'];
    latencyMs: number;
    agentId: string;
  }> {
    // Limit public work to two requests per API process; no additional DB lease spans this request.
    const publicQuestion = slotKey === 'website_chatbot';
    if (publicQuestion && this.active >= 2) fail(503, 'AI_WEBSITE_BUSY');
    if (publicQuestion) this.active++;
    const started = Date.now();
    try {
      const agentId = await this.agent(slotKey);
      if (!agentId) fail(409, 'AI_WEBSITE_UNAVAILABLE');
      const quota = await getDbPool().query<{ count: number; reset_ms: string }>(
        'SELECT count,reset_ms FROM rate_limit_rolling(true,$1,60000,5,true)',
        [
          (publicQuestion
            ? 'ai:website:'
            : slotKey === 'staff_chatbot'
              ? 'ai:staff:'
              : 'ai:telegram:') + quotaKey,
        ]
      );
      const count = Number(quota.rows[0]!.count);
      if (count > 5)
        fail(429, ErrorCodes.RATE_LIMIT_EXCEEDED.code, Number(quota.rows[0]!.reset_ms));
      const generated = await this.inference.answerForKnowledgeSlot({
        agentId,
        slotKey,
        message,
        sessionId,
        userId: publicQuestion ? 'website:' + actorKey : actorKey,
        remainingQuota: Math.max(0, 5 - count),
      });
      if ((await this.agent(slotKey)) !== agentId) fail(409, 'AI_WEBSITE_SCOPE_CHANGED');
      const ids = [...new Set(generated.sources.map((source) => source.kbId))];
      const current = await getDbPool().query<{ id: string }>(
        `SELECT k.id FROM knowledge_bases k
         WHERE k.id=ANY($1::uuid[]) AND k.audience=ANY($3::text[])
           AND k.is_enabled=true AND k.content_state='ready'
           AND (EXISTS (SELECT 1 FROM ai_agent_kbs ak WHERE ak.agent_id=$2 AND ak.kb_id=k.id)
                OR EXISTS (SELECT 1 FROM ai_agent_kb_groups ag JOIN kb_group_members gm ON gm.group_id=ag.group_id
                           WHERE ag.agent_id=$2 AND gm.kb_id=k.id))`,
        [ids, agentId, audiencesFor(slotKey)]
      );
      if (!ids.length || current.rows.length !== ids.length) fail(409, 'AI_WEBSITE_SOURCE_CHANGED');
      return {
        agentId,
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
      if (publicQuestion) this.active--;
    }
  }

  private async staffAuthority(session: Session): Promise<void> {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, session.userId, 'admin:ai:agents');
      await requireCurrentSession(client, session);
      const current = await client.query<{ operating_context: 'staff' | 'customer' }>(
        'SELECT operating_context FROM sessions WHERE session_id=$1 AND user_id=$2',
        [session.sessionId, session.userId]
      );
      requireRouteOperatingContext('/api/staff/knowledge', current.rows[0]!.operating_context);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async agent(slotKey: Slot): Promise<string | null> {
    const agent = (
      await getDbPool().query<{ agent_id: string; link_mode: 'any_kb' | 'all_kbs' }>(
        `SELECT s.agent_id,a.link_mode FROM ai_agent_slots s
       JOIN ai_agents a ON a.id=s.agent_id AND a.enabled=true
       JOIN ai_models m ON m.id=a.model_id AND m.is_enabled=true AND m.last_test_status='passed'
       WHERE s.slot_key=$1`,
        [slotKey]
      )
    ).rows[0];
    if (!agent) return null;
    const counts = (
      await getDbPool().query<{ total: string; eligible: string }>(
        `SELECT count(*) AS total,
              count(*) FILTER (WHERE k.is_enabled=true AND k.content_state='ready'
                AND k.vector_embedding_model IS NOT NULL AND k.audience=ANY($2::text[])) AS eligible
       FROM knowledge_bases k
       WHERE EXISTS (SELECT 1 FROM ai_agent_kbs ak WHERE ak.agent_id=$1 AND ak.kb_id=k.id)
          OR EXISTS (SELECT 1 FROM ai_agent_kb_groups ag JOIN kb_group_members gm ON gm.group_id=ag.group_id
                     WHERE ag.agent_id=$1 AND gm.kb_id=k.id)`,
        [agent.agent_id, audiencesFor(slotKey)]
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
