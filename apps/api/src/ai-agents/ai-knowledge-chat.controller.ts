import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { appendAiAudit } from './ai-audit.js';
import { AiKnowledgeChatService } from './ai-knowledge-chat.service.js';
import { rejectContentFields } from '../admin/content-input-fields.js';

const QuestionSchema = z
  .object({
    message: z.string().trim().min(1).max(1000),
    requestId: z.string().uuid(),
  })
  .strict();

@ApiTags('Customer · AI knowledge assistant')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/ai/knowledge')
export class AiKnowledgeChatController {
  constructor(private readonly service: AiKnowledgeChatService) {}

  @Get('availability')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Check whether the active profile has a knowledge assistant' })
  availability(@Req() req: AuthenticatedRequest) {
    return this.service.availability(req.session.userId);
  }

  @Post('questions')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Ask a read-only question using published shared knowledge bases' })
  async ask(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const started = Date.now();
    const parsed = QuestionSchema.safeParse(body);
    if (!parsed.success) rejectContentFields(parsed.error.issues, ['message']);
    const input = parsed.data;
    try {
      const result = await this.service.ask(input, req.session);
      await appendAiAudit({
        sessionId: req.session.sessionId,
        userId: req.session.userId,
        profileId: result.profileId,
        agentSlot: result.slotKey,
        toolName: 'customer_knowledge_question',
        input,
        output: {
          status: 200,
          attribution: result.answer.attribution,
          sourceCount: result.answer.sources.length,
        },
        authorizationResult: 'allowed',
        confirmationRequired: false,
        confirmationResult: 'not_required',
        tokenUsage: result.tokenUsage,
        latencyMs: result.latencyMs,
      });
      return result.answer;
    } catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : 503;
      const response = error instanceof HttpException ? error.getResponse() : null;
      const code =
        response && typeof response === 'object' && 'error' in response
          ? response.error
          : 'AI_KNOWLEDGE_UNAVAILABLE';
      await appendAiAudit({
        sessionId: req.session.sessionId,
        userId: req.session.userId,
        profileId: null,
        agentSlot: null,
        toolName: 'customer_knowledge_question',
        input,
        output: {
          status,
          code:
            typeof code === 'string' && /^[A-Z][A-Z0-9_:]{0,100}$/.test(code)
              ? code
              : 'AI_KNOWLEDGE_UNAVAILABLE',
        },
        authorizationResult: status === 401 || status === 403 ? 'denied' : 'allowed',
        confirmationRequired: false,
        confirmationResult: 'not_required',
        tokenUsage: null,
        latencyMs: Math.max(0, Date.now() - started),
      });
      if (error instanceof HttpException) throw error;
      throw new HttpException({ statusCode: 503, error: 'AI_KNOWLEDGE_UNAVAILABLE' }, 503);
    }
  }
}
