import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { UploadService } from './upload.service.js';

@Controller('api/v1/files/upload')
@UseGuards(SessionAuthGuard)
export class MultipartUploadController {
  constructor(@Inject(UploadService) private readonly uploads: UploadService) {}

  @Post('start')
  start(@Body() body: unknown, @Req() actor: AuthenticatedRequest) {
    return this.uploads.startMultipart(body, actor);
  }

  @Put(':uploadId/part')
  part(
    @Param('uploadId', new ParseUUIDPipe()) uploadId: string,
    @Query('partNumber', new ParseIntPipe()) partNumber: number,
    @Req() actor: AuthenticatedRequest
  ) {
    return this.uploads.presignMultipartPart(uploadId, partNumber, actor);
  }

  @Get(':uploadId/parts')
  parts(
    @Param('uploadId', new ParseUUIDPipe()) uploadId: string,
    @Req() actor: AuthenticatedRequest
  ) {
    return this.uploads.listMultipartParts(uploadId, actor);
  }

  @Post(':uploadId/complete')
  @HttpCode(200)
  complete(
    @Param('uploadId', new ParseUUIDPipe()) uploadId: string,
    @Req() actor: AuthenticatedRequest
  ) {
    return this.uploads.completeMultipart(uploadId, actor);
  }

  @Post(':uploadId/abort')
  @HttpCode(200)
  abort(
    @Param('uploadId', new ParseUUIDPipe()) uploadId: string,
    @Req() actor: AuthenticatedRequest
  ) {
    return this.uploads.abortMultipart(uploadId, actor);
  }
}
