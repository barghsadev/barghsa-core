import { ErrorCodes } from '@barghsa/shared/errors';
import {
  Controller,
  Get,
  Header,
  HttpException,
  Param,
  ParseUUIDPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { getDbPool } from '@barghsa/db';
import { SessionAuthGuard, type AuthenticatedRequest } from '../session/session.guard.js';
import { hasStaffPermission } from '../session/staff-permissions.js';
import { VerifiedAttachmentsService } from '../storage/verified-attachments.service.js';
import {
  legalDocumentsUnavailable,
  readSealedLegalDocuments,
} from '../profiles/sealed-legal-documents.js';

@ApiTags('CRM')
@Controller('api/crm/profiles')
@UseGuards(SessionAuthGuard)
export class CrmLegalDocumentsController {
  constructor(private readonly attachments: VerifiedAttachmentsService) {}

  @Get(':profileId/documents')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Read sealed legal documents with CRM and verification access' })
  @ApiParam({ name: 'profileId', schema: { type: 'string', format: 'uuid' } })
  @ApiResponse({
    status: 200,
    description: 'Profile-bound documents with five-minute download links',
    schema: {
      type: 'object',
      required: ['profileId', 'documents'],
      properties: {
        profileId: { type: 'string', format: 'uuid' },
        documents: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'url'],
            properties: {
              name: { type: 'string', nullable: true },
              url: { type: 'string', format: 'uri' },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 403, description: 'CRM and verification read permissions required' })
  @ApiResponse({ status: 404, description: 'Legal profile not found' })
  @ApiResponse({ status: 503, description: 'Document copies or storage unavailable' })
  async read(
    @Param('profileId', new ParseUUIDPipe()) profileId: string,
    @Req() req: AuthenticatedRequest
  ) {
    if (!hasStaffPermission(req, 'crm:read') || !hasStaffPermission(req, 'verification:read'))
      throw new HttpException({ error: ErrorCodes.AUTHZ_FORBIDDEN.code }, 403);
    const pool = getDbPool();
    const legal = (
      await pool.query<{ id: string; documents: unknown }>(
        `SELECT p.id,l.documents FROM profiles p JOIN legal_profiles l ON l.id=p.id
       WHERE p.id=$1 AND p.profile_type='LEGAL'`,
        [profileId]
      )
    ).rows[0];
    if (!legal) throw new HttpException({ error: ErrorCodes.NOT_FOUND_RESOURCE.code }, 404);
    const copies = await readSealedLegalDocuments(pool, legal.id, legal.documents);
    if (!copies.length) return { profileId: legal.id, documents: [] };
    const urls = await this.attachments.downloadUrls(
      copies.map((copy) => copy.storage_key),
      'legal_profile_document'
    );
    if (urls.length !== copies.length) throw legalDocumentsUnavailable();
    return {
      profileId: legal.id,
      documents: copies.map((copy, i) => ({
        name: copy.file_name,
        url: urls[i]!,
      })),
    };
  }
}
