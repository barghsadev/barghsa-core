import { Body, Controller, HttpCode, HttpException, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { AiTestChatService } from './ai-test-chat.service.js';

const TestChatSchema = z
  .object({
    agentId: z.string().uuid(),
    message: z.string().trim().min(1).max(4000),
    conversationId: z.string().uuid().optional(),
    requestId: z.string().uuid(),
  })
  .strict();
const V1TestChatSchema = z
  .object({
    agent_id: z.string().uuid(),
    message: z.string().trim().min(1).max(4000),
    conversation_id: z.string().uuid().optional(),
    request_id: z.string().uuid().optional(),
  })
  .strict();

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
    if (!hasStaffPermission(req, 'admin:ai:agents'))
      throw new HttpException({ statusCode: 403, error: 'AUTHZ_FORBIDDEN' }, 403);
    if (req.path.startsWith('/api/v1/')) {
      const parsed = V1TestChatSchema.safeParse(body);
      if (!parsed.success)
        throw new HttpException({ statusCode: 400, error: 'VALIDATION:PARSE:ZOD_ERROR' }, 400);
      const result = await this.service.send(
        {
          agentId: parsed.data.agent_id,
          message: parsed.data.message,
          requestId: parsed.data.request_id ?? uuidv7(),
          ...(parsed.data.conversation_id ? { conversationId: parsed.data.conversation_id } : {}),
        },
        req.session
      );
      return {
        conversation_id: result.conversationId,
        reply: result.reply,
        sources: result.sources.map((source) => ({
          kb_id: source.kbId,
          title: source.title,
          excerpt: source.excerpt,
        })),
        policy_results: result.policyResults,
        token_usage: result.tokenUsage,
        latency_ms: result.latencyMs,
        remaining_quota: result.remainingQuota,
      };
    }
    const parsed = TestChatSchema.safeParse(body);
    if (!parsed.success)
      throw new HttpException({ statusCode: 400, error: 'VALIDATION:PARSE:ZOD_ERROR' }, 400);
    return this.service.send(
      {
        ...parsed.data,
        ...(parsed.data.conversationId ? { conversationId: parsed.data.conversationId } : {}),
      },
      req.session
    );
  }
}
