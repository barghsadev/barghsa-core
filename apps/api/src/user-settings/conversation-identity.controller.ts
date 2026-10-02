import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { ConversationIdentityService } from './conversation-identity.service.js';

@ApiTags('User Settings')
@Controller('api/user/settings/conversation-identity')
@UseGuards(SessionAuthGuard)
export class ConversationIdentityController {
  constructor(private readonly identities: ConversationIdentityService) {}

  @Get()
  @RateLimit({ namespace: 'settings:conversation:get', limit: 60, windowMs: 60_000 })
  @ApiOperation({ summary: 'Read your explicitly shared conversation name and photo' })
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      required: ['displayName', 'avatarUrl', 'avatarUploadKey', 'revision', 'shareInActivity'],
      properties: {
        displayName: { type: 'string', nullable: true, maxLength: 80 },
        avatarUrl: { type: 'string', nullable: true },
        avatarUploadKey: { type: 'string', nullable: true },
        shareInActivity: {
          type: 'boolean',
          description:
            'Separate opt-in to show this name in authorized order, contract and consultation activity. Photos remain limited to support conversations.',
        },
        revision: { type: 'integer', minimum: 0 },
      },
    },
  })
  read(@Req() req: AuthenticatedRequest) {
    return this.identities.read(req);
  }

  @Put()
  @RateLimit({ namespace: 'settings:conversation:put', limit: 20, windowMs: 60_000 })
  @ApiOperation({ summary: 'Set or remove your shared conversation name and verified photo' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['displayName', 'revision'],
      properties: {
        displayName: { type: 'string', nullable: true, minLength: 1, maxLength: 80 },
        avatarUploadKey: {
          type: 'string',
          nullable: true,
          maxLength: 256,
          description:
            'Omit to keep the current photo; null removes it. A supplied key must be your verified conversation_avatar upload.',
        },
        revision: { type: 'integer', minimum: 0, maximum: 2147483646 },
        shareInActivity: {
          type: 'boolean',
          description:
            'Omit to keep the current activity consent; false removes the name from later history reads. Clearing the name also clears consent.',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Saved identity and current revision, including a short-lived photo URL.',
  })
  @ApiResponse({ status: 409, description: 'The identity changed since the submitted revision.' })
  update(@Body() body: unknown, @Req() req: AuthenticatedRequest) {
    return this.identities.update(body, req);
  }
}
