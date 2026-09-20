import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { UploadService } from './upload.service.js';

@Controller('api/upload')
@UseGuards(SessionAuthGuard)
export class UploadController {
  constructor(@Inject(UploadService) private readonly uploads: UploadService) {}

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
