import { createHmac } from 'node:crypto';
import { Body, Controller, Get, HttpCode, HttpException, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { ErrorCodes } from '@barghsa/shared/errors';
import { rejectContentFields } from '../admin/content-input-fields.js';
import { appendAiAudit } from './ai-audit.js';
import { AiWebsiteChatService } from './ai-website-chat.service.js';

const Question = z.object({ message: z.string().trim().min(1).max(1000) }).strict();

@ApiTags('Public knowledge')
@Controller('api/public/knowledge')
export class AiWebsiteChatController {
  constructor(private readonly service: AiWebsiteChatService) {}

  @Get('availability')
  @ApiOperation({ summary: 'Check the published website knowledge guide' })
  availability() {
    return this.service.availability();
  }

  @Post('questions')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ask a stateless question using published public knowledge' })
  async ask(@Req() req: Request, @Body() body: unknown) {
    const started = Date.now();
    const input = {
      message:
        body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
          ? body.message
          : null,
    };
    const audit = (
      output: Record<string, unknown>,
      usage?: { input: number; output: number } | null
    ) =>
      appendAiAudit({
        sessionId: null,
        userId: null,
        profileId: null,
        agentSlot: 'website_chatbot',
        toolName: 'website_knowledge_question',
        input,
        output,
        authorizationResult: 'allowed',
        confirmationRequired: false,
        confirmationResult: 'not_required',
        tokenUsage: usage ?? null,
        latencyMs: Math.max(0, Date.now() - started),
      });
    const parsed = Question.safeParse(body);
    if (!parsed.success) {
      await audit({ status: 400, code: 'VALIDATION:INPUT:INVALID' });
      rejectContentFields(parsed.error.issues, ['message']);
    }
    // req.ip comes from the application's trusted proxy configuration, never an arbitrary header.
    const actorKey = createHmac('sha256', process.env.SESSION_SECRET ?? '')
      .update(req.ip ?? req.socket.remoteAddress ?? 'unknown')
      .digest('hex');
    try {
      const result = await this.service.ask(parsed.data.message, actorKey);
      await audit(
        {
          status: 200,
          reply: result.answer.reply,
          sourceCount: result.answer.sources.length,
          attribution: result.answer.attribution,
        },
        result.tokenUsage
      );
      return result.answer;
    } catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : 503;
      const detail = error instanceof HttpException ? error.getResponse() : null;
      const rawCode =
        detail && typeof detail === 'object' && 'error' in detail ? detail.error : null;
      const code =
        rawCode === 'AI_TEST_CHAT_POLICY_BLOCKED' ? 'AI_WEBSITE_POLICY_BLOCKED' : rawCode;
      await audit({
        status,
        code:
          typeof code === 'string' && /^[A-Z][A-Z0-9_:]{0,100}$/.test(code)
            ? code
            : ErrorCodes.PROVIDER_UNAVAILABLE.code,
      });
      const retryAfterMs =
        detail &&
        typeof detail === 'object' &&
        'retryAfterMs' in detail &&
        typeof detail.retryAfterMs === 'number' &&
        Number.isFinite(detail.retryAfterMs) &&
        detail.retryAfterMs >= 0
          ? detail.retryAfterMs
          : undefined;
      throw new HttpException(
        {
          statusCode: status,
          error:
            typeof code === 'string' && /^[A-Z][A-Z0-9_:]{0,100}$/.test(code)
              ? code
              : ErrorCodes.PROVIDER_UNAVAILABLE.code,
          ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
        },
        status
      );
    }
  }
}
