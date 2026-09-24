import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { DocumentService } from './document.service.js';
import {
  DocumentCommandSchema,
  DocumentCreateSchema,
  DocumentListSchema,
} from './document-validation.js';

const ActionSchema = z.enum([
  'submit',
  'approve',
  'reject',
  'request-changes',
  'quarantine',
  'remove',
]);
function parse<S extends z.ZodType>(schema: S, raw: unknown): z.output<S> {
  const result = schema.safeParse(raw);
  if (!result.success) throw new BadRequestException('Invalid document request');
  return result.data as z.output<S>;
}

@Controller('api/documents')
@UseGuards(SessionAuthGuard)
export class DocumentController {
  constructor(@Inject(DocumentService) private readonly documents: DocumentService) {}

  @Get()
  list(@Query() query: unknown, @Req() request: AuthenticatedRequest) {
    return this.documents.list(parse(DocumentListSchema, query), request.session, false);
  }
  @Post()
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.documents.create(
      parse(DocumentCreateSchema, body),
      request,
      false,
      request.ip ?? ''
    );
  }
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthenticatedRequest) {
    return this.documents.get(id, request.session, false);
  }
  @Get(':id/download')
  download(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthenticatedRequest) {
    return this.documents.download(id, request.session, false);
  }
  @Get(':id/preview')
  preview(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthenticatedRequest) {
    return this.documents.preview(id, request.session, false);
  }
  @Post(':id/confirm')
  @HttpCode(200)
  confirm(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest
  ) {
    return this.documents.confirm(
      id,
      parse(DocumentCommandSchema, body),
      request,
      false,
      request.ip ?? ''
    );
  }
  @Post(':id/:action')
  @HttpCode(200)
  act(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('action') action: unknown,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest
  ) {
    return this.documents.act(
      id,
      parse(ActionSchema, action),
      parse(DocumentCommandSchema, body),
      request.session,
      false,
      request.ip ?? ''
    );
  }
}

@Controller('api/admin/documents')
@UseGuards(SessionAuthGuard)
export class StaffDocumentController {
  constructor(@Inject(DocumentService) private readonly documents: DocumentService) {}

  @Get()
  list(@Query() query: unknown, @Req() request: AuthenticatedRequest) {
    return this.documents.list(parse(DocumentListSchema, query), request.session, true);
  }
  @Post()
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.documents.create(
      parse(DocumentCreateSchema, body),
      request,
      true,
      request.ip ?? ''
    );
  }
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthenticatedRequest) {
    return this.documents.get(id, request.session, true);
  }
  @Get(':id/download')
  download(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthenticatedRequest) {
    return this.documents.download(id, request.session, true);
  }
  @Get(':id/preview')
  preview(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: AuthenticatedRequest) {
    return this.documents.preview(id, request.session, true);
  }
  @Post(':id/confirm')
  @HttpCode(200)
  confirm(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest
  ) {
    return this.documents.confirm(
      id,
      parse(DocumentCommandSchema, body),
      request,
      true,
      request.ip ?? ''
    );
  }
  @Post(':id/:action')
  @HttpCode(200)
  act(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('action') action: unknown,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest
  ) {
    return this.documents.act(
      id,
      parse(ActionSchema, action),
      parse(DocumentCommandSchema, body),
      request.session,
      true,
      request.ip ?? ''
    );
  }
}
