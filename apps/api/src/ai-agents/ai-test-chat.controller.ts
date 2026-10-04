import { Body, Controller, HttpCode, HttpException, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { AiTestChatService } from './ai-test-chat.service.js';
import type { AgentSlotKey } from './ai-test-chat.service.js';
import { appendAiAudit } from './ai-audit.js';
import { rejectContentFields } from '../admin/content-input-fields.js';

const TestChatSchema = z
  .object({
    agentId: z.string().uuid(),
    message: z.string().trim().min(1).max(4000),
    conversationId: z.string().uuid().optional(),
    slotKey: z
      .enum([
        'individual_chatbot',
        'legal_entity_chatbot',
        'staff_chatbot',
        'website_chatbot',
        'telegram_chatbot',
      ])
      .optional(),
    requestId: z.string().uuid(),
  })
  .strict();
const V1TestChatSchema = z
  .object({
    agent_id: z.string().uuid(),
    message: z.string().trim().min(1).max(4000),
    conversation_id: z.string().uuid().optional(),
    slot_key: z
      .enum([
        'individual_chatbot',
        'legal_entity_chatbot',
        'staff_chatbot',
        'website_chatbot',
        'telegram_chatbot',
      ])
      .optional(),
    request_id: z.string().uuid().optional(),
  })
  .strict();

function auditInput(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  const data = body as Record<string, unknown>;
  const pick = (camel: string, snake: string) => {
    const value = data[camel] ?? data[snake];
    return typeof value === 'string' ? value : null;
  };
  return {
    agentId: pick('agentId', 'agent_id'),
    requestId: pick('requestId', 'request_id'),
    conversationId: pick('conversationId', 'conversation_id'),
    slotKey: pick('slotKey', 'slot_key'),
    message: pick('message', 'message'),
  };
}

function auditFailure(error: unknown): Record<string, unknown> {
  if (!(error instanceof HttpException)) return { status: 503, code: 'AI_TEST_CHAT_UNAVAILABLE' };
  const response = error.getResponse();
  const responseError =
    response && typeof response === 'object' && 'error' in response ? response.error : undefined;
  const code =
    responseError && typeof responseError === 'object' && 'code' in responseError
      ? responseError.code
      : responseError;
  return {
    status: error.getStatus(),
    code:
      typeof code === 'string' && /^[A-Z][A-Z0-9_:]{0,100}$/.test(code)
        ? code
        : 'AI_TEST_CHAT_UNAVAILABLE',
  };
}

@ApiTags('Admin · AI test chat')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller(['api/admin/ai/test-chat', 'api/v1/admin/ai/test-chat'])
export class AiTestChatController {
  constructor(private readonly service: AiTestChatService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Test a saved AI agent in an isolated admin conversation' })
  async send(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const started = Date.now();
    const input = auditInput(body);
    let auditedSlot: AgentSlotKey | null = null;
    const record = (
      output: Record<string, unknown>,
      authorizationResult: 'allowed' | 'denied',
      tokenUsage?: { input: number; output: number } | null
    ) =>
      appendAiAudit({
        sessionId: req.session.sessionId,
        userId: req.session.userId,
        profileId: null,
        agentSlot: auditedSlot,
        toolName: 'admin_test_chat',
        input,
        output,
        authorizationResult,
        confirmationRequired: false,
        confirmationResult: 'not_required',
        tokenUsage: tokenUsage ?? null,
        latencyMs: Math.max(0, Date.now() - started),
      });
    if (!hasStaffPermission(req, 'admin:ai:agents')) {
      await record({ status: 403, code: 'AUTHZ_FORBIDDEN' }, 'denied');
      throw new HttpException({ statusCode: 403, error: 'AUTHZ_FORBIDDEN' }, 403);
    }
    const versioned = req.path.startsWith('/api/v1/');
    let normalized: {
      agentId: string;
      message: string;
      requestId: string;
      conversationId?: string | undefined;
      slotKey?: AgentSlotKey | undefined;
    };
    if (versioned) {
      const parsed = V1TestChatSchema.safeParse(body);
      if (!parsed.success) {
        await record({ status: 400, code: 'VALIDATION:PARSE:ZOD_ERROR' }, 'allowed');
        throw new HttpException({ statusCode: 400, error: 'VALIDATION:PARSE:ZOD_ERROR' }, 400);
      }
      normalized = {
        agentId: parsed.data.agent_id,
        message: parsed.data.message,
        requestId: parsed.data.request_id ?? uuidv7(),
        ...(parsed.data.conversation_id ? { conversationId: parsed.data.conversation_id } : {}),
        ...(parsed.data.slot_key ? { slotKey: parsed.data.slot_key } : {}),
      };
    } else {
      const parsed = TestChatSchema.safeParse(body);
      if (!parsed.success) {
        await record({ status: 400, code: 'VALIDATION:INPUT:INVALID' }, 'allowed');
        rejectContentFields(parsed.error.issues, ['agentId', 'message', 'slotKey']);
      }
      normalized = parsed.data;
    }
    auditedSlot = normalized.slotKey ?? null;
    let result: Awaited<ReturnType<AiTestChatService['send']>>;
    try {
      result = await this.service.send(normalized, req.session);
    } catch (error) {
      await record(auditFailure(error), 'allowed');
      throw error;
    }
    await record(
      {
        status: 200,
        reply: result.reply,
        sourceCount: result.sources.length,
        attribution: result.attribution,
      },
      'allowed',
      result.tokenUsage
    );
    if (versioned)
      return {
        conversation_id: result.conversationId,
        reply: result.reply,
        sources: result.sources.map((source) => ({
          kb_id: source.kbId,
          title: source.title,
          document_title: source.documentTitle,
          excerpt: source.excerpt,
        })),
        attribution: result.attribution,
        policy_results: result.policyResults,
        token_usage: result.tokenUsage,
        latency_ms: result.latencyMs,
        remaining_quota: result.remainingQuota,
      };
    return result;
  }
}
