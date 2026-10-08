import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Post,
  Req,
  Header,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { z } from 'zod';
import { ErrorCodes } from '@barghsa/shared/errors';
import { rejectContentFields } from '../admin/content-input-fields.js';
import { appendAiAudit } from './ai-audit.js';
import { AiStatelessKnowledgeService } from './ai-stateless-knowledge.service.js';

const Question = z.object({ message: z.string().trim().min(1).max(1000) }).strict();

@ApiTags('Staff knowledge')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/staff/knowledge')
export class AiStaffChatController {
  constructor(private readonly service: AiStatelessKnowledgeService) {}

  @Get('availability')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Check the assigned staff knowledge guide' })
  availability(@Req() req: AuthenticatedRequest) {
    return this.service.staffAvailability(req.session);
  }

  @Post('questions')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Ask a stateless question using authorized staff knowledge' })
  async ask(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
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
        sessionId: req.session.sessionId,
        userId: req.session.userId,
        profileId: null,
        agentSlot: 'staff_chatbot',
        toolName: 'staff_knowledge_question',
        input,
        output,
        authorizationResult: output.status === 401 || output.status === 403 ? 'denied' : 'allowed',
        confirmationRequired: false,
        confirmationResult: 'not_required',
        tokenUsage: usage ?? null,
        latencyMs: Math.max(0, Date.now() - started),
      });
    if (!hasStaffPermission(req, 'admin:ai:agents')) {
      await audit({ status: 403, code: ErrorCodes.AUTHZ_FORBIDDEN.code });
      throw new HttpException({ error: ErrorCodes.AUTHZ_FORBIDDEN.code }, 403);
    }
    const parsed = Question.safeParse(body);
    if (!parsed.success) {
      await audit({ status: 400, code: 'VALIDATION:INPUT:INVALID' });
      rejectContentFields(parsed.error.issues, ['message']);
    }
    try {
      const result = await this.service.askStaff(parsed.data.message, req.session);
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
        rawCode === 'AI_TEST_CHAT_POLICY_BLOCKED'
          ? 'AI_KNOWLEDGE_POLICY_BLOCKED'
          : rawCode === 'AI_WEBSITE_UNAVAILABLE'
            ? 'AI_KNOWLEDGE_UNAVAILABLE'
            : rawCode === 'AI_WEBSITE_SCOPE_CHANGED'
              ? 'AI_KNOWLEDGE_SCOPE_CHANGED'
              : rawCode === 'AI_WEBSITE_SOURCE_CHANGED'
                ? 'AI_KNOWLEDGE_SOURCE_UNAVAILABLE'
                : rawCode;
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
