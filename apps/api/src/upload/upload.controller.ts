import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam } from '@nestjs/swagger';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { UploadService } from './upload.service.js';

@Controller('api/upload')
@UseGuards(SessionAuthGuard)
export class UploadController {
  constructor(@Inject(UploadService) private readonly uploads: UploadService) {}

  @Get('policy/:category')
  @ApiOperation({
    summary: 'Read effective upload constraints',
    description:
      'Authenticated customer and staff contexts can read category formats and size bounds. This creates no reservation and grants no record access. Upload and byte verification recheck current policy.',
  })
  @ApiParam({ name: 'category', enum: ['document', 'image', 'video', 'contract'] })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['category', 'formats', 'maxSizeBytes'],
      properties: {
        category: { type: 'string', enum: ['document', 'image', 'video', 'contract'] },
        maxSizeBytes: { type: 'integer', minimum: 1, maximum: 104857600 },
        formats: {
          type: 'array',
          maxItems: 50,
          items: {
            type: 'object',
            required: ['extension', 'mimeTypes'],
            properties: {
              extension: { type: 'string', pattern: '^\\.[a-z0-9]{1,10}$' },
              mimeTypes: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
  })
  filePolicy(@Param('category') category: string) {
    return this.uploads.filePolicy(category);
  }

  @Post('presigned-url')
  @HttpCode(HttpStatus.OK)
  getPresignedUrl(@Body() raw: unknown, @Req() actor: AuthenticatedRequest) {
    return this.uploads.getPresignedUrl(raw, actor);
  }

  @Post(':key/verify')
  @HttpCode(HttpStatus.OK)
  verifyUpload(@Param('key') key: string, @Req() actor: AuthenticatedRequest) {
    return this.uploads.verifyUpload(key, actor);
  }

  @Post(':key/record')
  @HttpCode(HttpStatus.OK)
  recordUpload(
    @Param('key') key: string,
    @Body() raw: unknown,
    @Req() actor: AuthenticatedRequest
  ) {
    return this.uploads.recordUpload(key, raw, actor);
  }
}
