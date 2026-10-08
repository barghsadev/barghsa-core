import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { TelegramLinksService } from './telegram-links.service.js';
import { rejectContentFields } from '../admin/content-input-fields.js';

const confirmation = z
  .object({ id: z.string().uuid(), code: z.string().regex(/^\d{6}$/) })
  .strict();

@ApiTags('Customer · Telegram account link')
@ApiBearerAuth()
@UseGuards(SessionAuthGuard)
@Controller('api/telegram/link')
export class TelegramLinksController {
  constructor(private readonly service: TelegramLinksService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  status(@Req() req: AuthenticatedRequest) {
    return this.service.status(req.session);
  }

  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  create(@Req() req: AuthenticatedRequest, @Body() raw: unknown) {
    const parsed = z.object({}).strict().safeParse(raw);
    if (!parsed.success) rejectContentFields(parsed.error.issues, []);
    return this.service.create(req.session);
  }

  @Post('confirm')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  confirm(@Req() req: AuthenticatedRequest, @Body() raw: unknown) {
    const parsed = confirmation.safeParse(raw);
    if (!parsed.success) rejectContentFields(parsed.error.issues, ['code']);
    return this.service.confirm(parsed.data.id, parsed.data.code, req.session);
  }

  @Delete()
  @Header('Cache-Control', 'private, no-store')
  revoke(@Req() req: AuthenticatedRequest) {
    return this.service.revoke(req.session);
  }
}
