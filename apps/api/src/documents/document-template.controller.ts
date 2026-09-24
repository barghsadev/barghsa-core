import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { RequiresStepUp, StepUpGuard } from '../session/step-up.guard.js';
import { DocumentTemplateService, type TemplateUpload } from './document-template.service.js';

const metadataSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).default(''),
    category: z.enum(['general', 'contract', 'invoice']),
  })
  .strict();
const listSchema = z
  .object({
    search: z.string().trim().max(100).optional(),
    category: z.enum(['general', 'contract', 'invoice']).optional(),
  })
  .strict();
const versionSchema = z
  .object({
    changeSummary: z.string().trim().max(500).default(''),
    retainedFileIds: z
      .string()
      .default('[]')
      .transform((value, context) => {
        try {
          return z.array(z.uuid()).max(5).parse(JSON.parse(value));
        } catch {
          context.addIssue({ code: 'custom', message: 'Invalid retained file list' });
          return z.NEVER;
        }
      }),
  })
  .strict();

function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestException('Invalid document template request');
  return result.data;
}

@Controller('api/admin/document-templates')
@UseGuards(SessionAuthGuard)
export class DocumentTemplateController {
  constructor(
    @Inject(DocumentTemplateService) private readonly templates: DocumentTemplateService
  ) {}

  private authorize(request: AuthenticatedRequest) {
    if (!hasStaffPermission(request, 'admin:documents:edit'))
      throw new ForbiddenException('Document template access denied');
  }

  @Get()
  list(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    this.authorize(request);
    const input = parse(listSchema, query);
    return this.templates.list(input.search, input.category);
  }

  @Get(':id')
  get(@Req() request: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    this.authorize(request);
    return this.templates.get(id);
  }

  @Post()
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  create(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    this.authorize(request);
    return this.templates.create(parse(metadataSchema, body), request.session, request.ip ?? '');
  }

  @Put(':id')
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  update(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown
  ) {
    this.authorize(request);
    return this.templates.update(
      id,
      parse(metadataSchema, body),
      request.session,
      request.ip ?? ''
    );
  }

  @Post(':id/versions')
  @HttpCode(201)
  @UseGuards(StepUpGuard)
  @RequiresStepUp()
  @UseInterceptors(
    FilesInterceptor('files', 5, {
      limits: { fileSize: 10 * 1024 * 1024, files: 5, fields: 5, fieldSize: 8 * 1024 },
    })
  )
  version(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @UploadedFiles() files: TemplateUpload[] = []
  ) {
    this.authorize(request);
    const input = parse(versionSchema, body);
    return this.templates.createVersion(id, { ...input, files }, request.session, request.ip ?? '');
  }

  @Get(':id/versions/:versionId/files/:fileId/download')
  download(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('versionId', new ParseUUIDPipe()) versionId: string,
    @Param('fileId', new ParseUUIDPipe()) fileId: string
  ) {
    this.authorize(request);
    return this.templates.download(id, versionId, fileId);
  }
}
