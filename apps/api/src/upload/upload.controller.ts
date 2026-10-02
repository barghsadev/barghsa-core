import {
  Body,
  Controller,
  Get,
  Header,
  StreamableFile,
  BadRequestException,
  PayloadTooLargeException,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiBody,
  ApiResponse,
  ApiConsumes,
} from '@nestjs/swagger';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { UploadService } from './upload.service.js';
import { readCappedBytes } from '../storage/read-capped-bytes.js';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';

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

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'private, no-store')
  @Header('Vary', 'Cookie')
  @RateLimit({ namespace: 'upload:pdf-preview:user', limit: 12, windowMs: 60_000 })
  @ApiOperation({
    summary: 'Generate a transient first-page image without reserving or storing the selected PDF',
  })
  @ApiConsumes('application/pdf')
  @ApiBody({ schema: { type: 'string', format: 'binary', maxLength: 10485760 }, required: true })
  @ApiResponse({
    status: 200,
    content: { 'image/png': { schema: { type: 'string', format: 'binary' } } },
  })
  async preview(@Req() actor: AuthenticatedRequest) {
    if (actor.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/pdf')
      throw new BadRequestException('PDF preview input is required');
    const limit = 10 * 1024 * 1024;
    if (Number(actor.get('content-length')) > limit)
      throw new PayloadTooLargeException('Preview input is too large');
    const read = await readCappedBytes(actor, limit);
    if (read.truncated) throw new PayloadTooLargeException('Preview input is too large');
    const image = await this.uploads.pdfPreview(Buffer.from(read.bytes), actor);
    return new StreamableFile(image, {
      type: 'image/png',
      disposition: 'inline',
      length: image.length,
    });
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
