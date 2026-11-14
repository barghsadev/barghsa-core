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
import { ApiResponse } from '@nestjs/swagger';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { UploadService } from './upload.service.js';
import { assertEmptyCommandBody } from '../common/empty-command-body.js';

@Controller('api/v1/files/upload')
@UseGuards(SessionAuthGuard)
export class MultipartUploadController {
  constructor(@Inject(UploadService) private readonly uploads: UploadService) {}

  @Post('start')
  start(@Body() body: unknown, @Req() actor: AuthenticatedRequest) {
    return this.uploads.startMultipart(body, actor);
  }

  @Put(':uploadId/part')
  @ApiResponse({ status: 200, description: 'Presigned URL for the requested part' })
  @ApiResponse({ status: 400, description: 'Invalid upload ID, part number or unexpected body' })
  part(
    @Param('uploadId', new ParseUUIDPipe()) uploadId: string,
    @Query('partNumber', new ParseIntPipe()) partNumber: number,
    @Req() actor: AuthenticatedRequest,
    @Body() body?: unknown
  ) {
    assertEmptyCommandBody(body);
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
  @ApiResponse({ status: 200, description: 'Completed multipart upload' })
  @ApiResponse({ status: 400, description: 'Invalid upload ID or unexpected body' })
  complete(
    @Param('uploadId', new ParseUUIDPipe()) uploadId: string,
    @Req() actor: AuthenticatedRequest,
    @Body() body?: unknown
  ) {
    assertEmptyCommandBody(body);
    return this.uploads.completeMultipart(uploadId, actor);
  }

  @Post(':uploadId/abort')
  @HttpCode(200)
  @ApiResponse({ status: 200, description: 'Aborted multipart upload' })
  @ApiResponse({ status: 400, description: 'Invalid upload ID or unexpected body' })
  abort(
    @Param('uploadId', new ParseUUIDPipe()) uploadId: string,
    @Req() actor: AuthenticatedRequest,
    @Body() body?: unknown
  ) {
    assertEmptyCommandBody(body);
    return this.uploads.abortMultipart(uploadId, actor);
  }
}
