import { createHash } from 'node:crypto';
import { HttpException, Injectable } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { ErrorCodes } from '@barghsa/shared/errors';
import { ProfilesService } from '../profiles/profiles.service.js';
import { AiTestChatService, type TestChatResponse } from './ai-test-chat.service.js';

type CustomerSlot = 'individual_chatbot' | 'legal_entity_chatbot';
type Session = { sessionId: string; userId: string };

export interface KnowledgeAnswer {
  reply: string;
  sources: TestChatResponse['sources'];
  attribution: 'retrieved_context';
  remainingQuota: number;
}

interface Scope {
  profileId: string;
  profileName: string | null;
  slotKey: CustomerSlot;
  agentId: string;
}

function fail(status: number, code: string, retryAfterMs?: number): never {
  throw new HttpException(
    { statusCode: status, error: code, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) },
    status
  );
}

@Injectable()
export class AiKnowledgeChatService {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly inference: AiTestChatService
  ) {}

  async availability(userId: string): Promise<{
    available: boolean;
    profileId: string | null;
    profileName: string | null;
    slotKey: CustomerSlot | null;
  }> {
    const scope = await this.scopeFor(userId);
    return {
      available: scope !== null,
      profileId: scope?.profileId ?? null,
      profileName: scope?.profileName ?? null,
      slotKey: scope?.slotKey ?? null,
    };
  }

  async ask(
    input: { message: string; requestId: string },
    session: Session
  ): Promise<{
    answer: KnowledgeAnswer;
    profileId: string;
    slotKey: CustomerSlot;
    tokenUsage: TestChatResponse['tokenUsage'];
    latencyMs: number;
  }> {
    const started = Date.now();
    const scope = await this.scopeFor(session.userId);
    if (!scope) fail(409, 'AI_KNOWLEDGE_UNAVAILABLE');
    const hash = createHash('sha256')
      .update(JSON.stringify([scope.profileId, scope.slotKey, scope.agentId, input.message]))
      .digest('hex');
    const pool = getDbPool();
    await pool.query(
      `DELETE FROM ai_knowledge_questions
       WHERE (session_id,request_id) IN (
         SELECT session_id,request_id FROM ai_knowledge_questions
         WHERE expires_at<=now() ORDER BY expires_at LIMIT 25
       )`
    );
    const client = await pool.connect();
    let capacityKey: string | null = null;
    let remainingQuota = 0;
    let admitted = false;
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `ai:knowledge:${session.sessionId}:${input.requestId}`,
      ]);
      await client.query(
        'DELETE FROM ai_knowledge_questions WHERE session_id=$1 AND request_id=$2 AND expires_at<=now()',
        [session.sessionId, input.requestId]
      );
      const existing = await client.query<{
        request_hash: string;
        state: string;
        response: KnowledgeAnswer | null;
      }>(
        `SELECT request_hash,state,response FROM ai_knowledge_questions
         WHERE session_id=$1 AND request_id=$2 AND expires_at>now()`,
        [session.sessionId, input.requestId]
      );
      if (existing.rows.length) {
        await client.query('COMMIT');
        const row = existing.rows[0]!;
        if (row.request_hash !== hash) fail(409, 'AI_KNOWLEDGE_REQUEST_CONFLICT');
        if (row.state !== 'completed' || !row.response) fail(409, 'AI_KNOWLEDGE_IN_PROGRESS');
        await this.assertSourcesAvailable(row.response.sources, scope.agentId);
        return {
          answer: row.response,
          profileId: scope.profileId,
          slotKey: scope.slotKey,
          tokenUsage: null,
          latencyMs: Date.now() - started,
        };
      }

      for (let slot = 0; slot < 3; slot += 1) {
        const key = `ai:knowledge:capacity:${slot}`;
        const lock = await client.query<{ acquired: boolean }>(
          'SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired',
          [key]
        );
        if (lock.rows[0]?.acquired) {
          capacityKey = key;
          break;
        }
      }
      if (!capacityKey) fail(503, 'AI_KNOWLEDGE_BUSY');

      const quota = await client.query<{ count: number; reset_ms: string }>(
        'SELECT count,reset_ms FROM rate_limit_rolling(true,$1,60000,5,true)',
        [`ai:knowledge:user:${session.userId}:profile:${scope.profileId}`]
      );
      const quotaRow = quota.rows[0]!;
      remainingQuota = Math.max(0, 5 - Number(quotaRow.count));
      if (Number(quotaRow.count) <= 5) {
        await client.query(
          `INSERT INTO ai_knowledge_questions
           (session_id,request_id,profile_id,slot_key,agent_id,request_hash,expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,now()+interval '1 day')`,
          [session.sessionId, input.requestId, scope.profileId, scope.slotKey, scope.agentId, hash]
        );
        admitted = true;
      }
      await client.query('COMMIT');
      if (!admitted) fail(429, ErrorCodes.RATE_LIMIT_EXCEEDED.code, Number(quotaRow.reset_ms));

      const generated = await this.inference.answerForCustomerSlot({
        agentId: scope.agentId,
        slotKey: scope.slotKey,
        message: input.message,
        sessionId: session.sessionId,
        userId: session.userId,
        remainingQuota,
      });
      const currentScope = await this.scopeFor(session.userId);
      if (
        currentScope?.profileId !== scope.profileId ||
        currentScope.slotKey !== scope.slotKey ||
        currentScope.agentId !== scope.agentId
      )
        fail(409, 'AI_KNOWLEDGE_SCOPE_CHANGED');
      await this.assertSourcesAvailable(generated.sources, scope.agentId);
      const answer: KnowledgeAnswer = {
        reply: generated.reply.slice(0, 8_000),
        sources: generated.sources,
        attribution: 'retrieved_context',
        remainingQuota,
      };
      const saved = await pool.query(
        `UPDATE ai_knowledge_questions
         SET state='completed',response=$3::jsonb,completed_at=now()
         WHERE session_id=$1 AND request_id=$2 AND state='processing'`,
        [session.sessionId, input.requestId, JSON.stringify(answer)]
      );
      if (saved.rowCount !== 1) fail(409, 'AI_KNOWLEDGE_SESSION_CHANGED');
      return {
        answer,
        profileId: scope.profileId,
        slotKey: scope.slotKey,
        tokenUsage: generated.tokenUsage,
        latencyMs: Date.now() - started,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (admitted)
        await pool
          .query(
            "DELETE FROM ai_knowledge_questions WHERE session_id=$1 AND request_id=$2 AND state='processing'",
            [session.sessionId, input.requestId]
          )
          .catch(() => undefined);
      if (error instanceof HttpException) throw error;
      return fail(503, ErrorCodes.PROVIDER_UNAVAILABLE.code);
    } finally {
      let unlockFailed = false;
      if (capacityKey)
        try {
          await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [capacityKey]);
        } catch {
          unlockFailed = true;
        }
      client.release(unlockFailed);
    }
  }

  private async scopeFor(userId: string): Promise<Scope | null> {
    const profiles = await this.profiles.getProfilesByUserId(userId);
    const active = profiles.profiles.find((profile) => profile.id === profiles.activeProfileId);
    if (!active) return null;
    const slotKey: CustomerSlot =
      active.profileType === 'LEGAL' ? 'legal_entity_chatbot' : 'individual_chatbot';
    const assigned = await getDbPool().query<{ agent_id: string; link_mode: 'any_kb' | 'all_kbs' }>(
      `SELECT s.agent_id,a.link_mode FROM ai_agent_slots s
       JOIN ai_agents a ON a.id=s.agent_id AND a.enabled=true
       JOIN ai_models m ON m.id=a.model_id AND m.is_enabled=true AND m.last_test_status='passed'
       WHERE s.slot_key=$1`,
      [slotKey]
    );
    if (!assigned.rows.length) return null;
    const agent = assigned.rows[0]!;
    const sources = await getDbPool().query<{ total: string; eligible: string }>(
      `SELECT count(*) AS total,
              count(*) FILTER (WHERE k.is_enabled=true AND k.content_state='ready'
                AND k.vector_embedding_model IS NOT NULL
                AND k.audience IN ('customer','public')) AS eligible
       FROM knowledge_bases k
       WHERE EXISTS (SELECT 1 FROM ai_agent_kbs ak WHERE ak.agent_id=$1 AND ak.kb_id=k.id)
          OR EXISTS (SELECT 1 FROM ai_agent_kb_groups ag
                     JOIN kb_group_members gm ON gm.group_id=ag.group_id
                     WHERE ag.agent_id=$1 AND gm.kb_id=k.id)`,
      [agent.agent_id]
    );
    const counts = sources.rows[0]!;
    if (
      Number(counts.eligible) === 0 ||
      (agent.link_mode === 'all_kbs' && counts.eligible !== counts.total)
    )
      return null;
    return {
      profileId: active.id,
      profileName: active.displayName === active.id ? null : active.displayName,
      slotKey,
      agentId: agent.agent_id,
    };
  }

  private async assertSourcesAvailable(
    sources: TestChatResponse['sources'],
    agentId: string
  ): Promise<void> {
    if (!sources.length) fail(409, 'AI_KNOWLEDGE_SOURCE_UNAVAILABLE');
    const ids = [...new Set(sources.map((source) => source.kbId))];
    const current = await getDbPool().query<{ id: string }>(
      `SELECT k.id FROM knowledge_bases k
       WHERE k.id=ANY($1::uuid[]) AND k.audience IN ('customer','public')
         AND k.is_enabled=true AND k.content_state='ready'
         AND (EXISTS (SELECT 1 FROM ai_agent_kbs ak WHERE ak.agent_id=$2 AND ak.kb_id=k.id)
              OR EXISTS (SELECT 1 FROM ai_agent_kb_groups ag
                         JOIN kb_group_members gm ON gm.group_id=ag.group_id
                         WHERE ag.agent_id=$2 AND gm.kb_id=k.id))`,
      [ids, agentId]
    );
    if (current.rows.length !== ids.length) fail(409, 'AI_KNOWLEDGE_SOURCE_UNAVAILABLE');
  }
}
