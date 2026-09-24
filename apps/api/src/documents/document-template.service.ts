import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { getDbPool } from '@barghsa/db';
import type { StorageProvider } from '@barghsa/shared/storage';
import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { requireSessionStepUp } from '../session/session-step-up.js';
import type { ValidatedSession } from '../session/session.service.js';
import { STORAGE_PROVIDER } from '../storage/storage.constants.js';
import { reserveStorageCopy } from '../storage/reserve-storage-copy.js';
import {
  extractTemplatePlaceholders,
  templateMime,
  type PlaceholderOccurrence,
  type TemplateMime,
} from './document-template-extraction.js';

type Actor = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;
type Category = 'general' | 'contract' | 'invoice';
type TemplateRow = {
  id: string;
  title: string;
  description: string;
  category: Category;
  created_at: Date;
  updated_at: Date;
  version_count: number;
};
type VersionRow = {
  id: string;
  template_id: string;
  version_number: number;
  change_summary: string;
  placeholders: string[];
  created_at: Date;
};
type FileRow = {
  id: string;
  version_id: string;
  storage_key: string;
  original_name: string;
  mime_type: TemplateMime;
  size_bytes: string;
  checksum: string;
  placeholders: PlaceholderOccurrence[];
};
type NewFile = {
  originalName: string;
  mimeType: TemplateMime;
  bytes: Buffer;
  checksum: string;
  placeholders: PlaceholderOccurrence[];
};
export type TemplateUpload = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

function fileDto(file: FileRow) {
  return {
    id: file.id,
    originalName: file.original_name,
    mimeType: file.mime_type,
    sizeBytes: Number(file.size_bytes),
    checksum: file.checksum,
    placeholders: file.placeholders,
  };
}

function versionDto(version: VersionRow, files: FileRow[]) {
  const names = [
    ...new Set(files.flatMap((file) => file.placeholders.map((item) => item.name))),
  ].sort();
  const conflicts: Array<{ name: string; files: Array<{ fileName: string; context: string }> }> =
    [];
  for (const name of names) {
    const contexts = files.flatMap((file) =>
      file.placeholders
        .filter((item) => item.name === name)
        .map((item) => ({ fileName: file.original_name, context: item.context }))
    );
    if (
      new Set(contexts.map((item) => item.fileName)).size > 1 &&
      new Set(contexts.map((item) => item.context)).size > 1
    )
      conflicts.push({ name, files: contexts });
  }
  return {
    id: version.id,
    versionNumber: version.version_number,
    changeSummary: version.change_summary,
    placeholders: names,
    conflicts,
    missingRequired: ['date', 'customerName', 'contractNumber'].filter(
      (name) => !names.includes(name)
    ),
    createdAt: version.created_at,
    files: files.map(fileDto),
  };
}

@Injectable()
export class DocumentTemplateService {
  constructor(@Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider | null) {}

  private async write<T>(actor: Actor, callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, actor.userId, 'admin:documents:edit');
      await requireSessionStepUp(client, actor);
      const result = await callback(client);
      await requireSessionStepUp(client, actor);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async audit(
    client: PoolClient,
    actor: Actor,
    ip: string,
    event: string,
    id: string,
    detail: Record<string, unknown> = {}
  ) {
    await client.query(
      'INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip) VALUES($1,$2,$3,$4::jsonb,$5,$6)',
      [uuidv7(), actor.userId, event, JSON.stringify({ templateId: id, ...detail }), uuidv7(), ip]
    );
  }

  async list(search = '', category?: Category) {
    const result = await getDbPool().query<TemplateRow>(
      `SELECT t.id,t.title,t.description,t.category,t.created_at,t.updated_at,
        count(v.id)::int AS version_count
       FROM document_templates t LEFT JOIN document_template_versions v ON v.template_id=t.id
       WHERE ($1='' OR t.title ILIKE '%' || $1 || '%') AND ($2::text IS NULL OR t.category=$2)
       GROUP BY t.id ORDER BY t.updated_at DESC,t.id DESC LIMIT 100`,
      [search, category ?? null]
    );
    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      category: row.category,
      versionCount: row.version_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async get(id: string) {
    const template = (
      await getDbPool().query<TemplateRow>(
        `SELECT t.id,t.title,t.description,t.category,t.created_at,t.updated_at,
          count(v.id)::int AS version_count
         FROM document_templates t LEFT JOIN document_template_versions v ON v.template_id=t.id
         WHERE t.id=$1 GROUP BY t.id`,
        [id]
      )
    ).rows[0];
    if (!template) throw new NotFoundException('Document template not found');
    const versions = (
      await getDbPool().query<VersionRow>(
        `SELECT id,template_id,version_number,change_summary,placeholders,created_at
         FROM document_template_versions WHERE template_id=$1 ORDER BY version_number DESC`,
        [id]
      )
    ).rows;
    const files = versions.length
      ? (
          await getDbPool().query<FileRow>(
            `SELECT id,version_id,storage_key,original_name,mime_type,size_bytes,checksum,placeholders
             FROM document_template_files WHERE version_id=ANY($1::uuid[])
             ORDER BY original_name,id`,
            [versions.map((version) => version.id)]
          )
        ).rows
      : [];
    return {
      id: template.id,
      title: template.title,
      description: template.description,
      category: template.category,
      versionCount: template.version_count,
      createdAt: template.created_at,
      updatedAt: template.updated_at,
      versions: versions.map((version) =>
        versionDto(
          version,
          files.filter((file) => file.version_id === version.id)
        )
      ),
    };
  }

  async create(
    input: { title: string; description: string; category: Category },
    actor: Actor,
    ip: string
  ) {
    const id = uuidv7();
    await this.write(actor, async (client) => {
      await client.query(
        `INSERT INTO document_templates(id,title,description,category,created_by)
         VALUES($1,$2,$3,$4,$5)`,
        [id, input.title, input.description, input.category, actor.userId]
      );
      await this.audit(client, actor, ip, 'document_template_created', id);
    });
    return this.get(id);
  }

  async update(
    id: string,
    input: { title: string; description: string; category: Category },
    actor: Actor,
    ip: string
  ) {
    await this.write(actor, async (client) => {
      const updated = await client.query(
        `UPDATE document_templates SET title=$2,description=$3,category=$4 WHERE id=$1 RETURNING id`,
        [id, input.title, input.description, input.category]
      );
      if (!updated.rowCount) throw new NotFoundException('Document template not found');
      await this.audit(client, actor, ip, 'document_template_updated', id);
    });
    return this.get(id);
  }

  private async prepare(files: TemplateUpload[]): Promise<NewFile[]> {
    if (files.length > 5 || files.reduce((total, file) => total + file.size, 0) > 30 * 1024 * 1024)
      throw new BadRequestException('Too many or oversized template files');
    const prepared: NewFile[] = [];
    for (const file of files) {
      if (
        !file.buffer ||
        file.size === 0 ||
        file.size > 10 * 1024 * 1024 ||
        file.buffer.length !== file.size
      )
        throw new BadRequestException('Template file size is invalid');
      const originalName = file.originalname.trim();
      if (
        !originalName ||
        originalName.length > 255 ||
        /[\\/]/.test(originalName) ||
        [...originalName].some((character) => character.charCodeAt(0) < 32)
      )
        throw new BadRequestException('Template file name is invalid');
      const mimeType = templateMime(originalName, file.mimetype);
      const placeholders = await extractTemplatePlaceholders(file.buffer, mimeType);
      prepared.push({
        originalName,
        mimeType,
        bytes: file.buffer,
        checksum: createHash('sha256').update(file.buffer).digest('hex'),
        placeholders,
      });
    }
    return prepared;
  }

  async createVersion(
    templateId: string,
    input: { changeSummary: string; retainedFileIds: string[]; files: TemplateUpload[] },
    actor: Actor,
    ip: string
  ) {
    const storage = this.storage;
    if (!storage) throw new ServiceUnavailableException('Object storage is unavailable');
    const incoming = await this.prepare(input.files);
    const versionId = uuidv7();
    await this.write(actor, async (client) => {
      const template = await client.query(
        'SELECT id FROM document_templates WHERE id=$1 FOR UPDATE',
        [templateId]
      );
      if (!template.rowCount) throw new NotFoundException('Document template not found');
      const latest = (
        await client.query<{ id: string; version_number: number }>(
          `SELECT id,version_number FROM document_template_versions
           WHERE template_id=$1 ORDER BY version_number DESC LIMIT 1`,
          [templateId]
        )
      ).rows[0];
      if (!latest && input.retainedFileIds.length)
        throw new BadRequestException('No previous version has files to retain');
      const retained =
        latest && input.retainedFileIds.length
          ? (
              await client.query<FileRow>(
                `SELECT id,version_id,storage_key,original_name,mime_type,size_bytes,checksum,placeholders
               FROM document_template_files WHERE version_id=$1 AND id=ANY($2::uuid[])`,
                [latest.id, input.retainedFileIds]
              )
            ).rows
          : [];
      if (retained.length !== input.retainedFileIds.length)
        throw new ConflictException('Selected template files changed; reload and retry');
      if (!retained.length && !incoming.length)
        throw new BadRequestException('A template version needs at least one file');
      if (retained.length + incoming.length > 5)
        throw new BadRequestException('A template version cannot contain more than five files');
      const names = [
        ...retained.map((file) => file.original_name),
        ...incoming.map((file) => file.originalName),
      ];
      if (new Set(names.map((name) => name.toLocaleLowerCase('en'))).size !== names.length)
        throw new ConflictException('Template file names must be unique in a version');
      for (const file of retained) {
        const object = await storage.getObject(file.storage_key);
        const reader = object.body.getReader();
        const chunks: Buffer[] = [];
        let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 10 * 1024 * 1024)
              throw new BadRequestException('Retained template file is too large');
            chunks.push(Buffer.from(value));
          }
        } finally {
          await reader.cancel();
        }
        const bytes = Buffer.concat(chunks);
        if (
          size !== Number(file.size_bytes) ||
          createHash('sha256').update(bytes).digest('hex') !== file.checksum
        )
          throw new ConflictException('Retained template file changed; reload and retry');
        file.placeholders = await extractTemplatePlaceholders(bytes, file.mime_type);
      }
      const placeholders = [
        ...new Set([
          ...retained.flatMap((file) => file.placeholders.map((item) => item.name)),
          ...incoming.flatMap((file) => file.placeholders.map((item) => item.name)),
        ]),
      ].sort();
      await client.query(
        `INSERT INTO document_template_versions
          (id,template_id,version_number,change_summary,placeholders,created_by)
         VALUES($1,$2,$3,$4,$5::jsonb,$6)`,
        [
          versionId,
          templateId,
          (latest?.version_number ?? 0) + 1,
          input.changeSummary,
          JSON.stringify(placeholders),
          actor.userId,
        ]
      );
      for (const file of retained) {
        await client.query(
          `INSERT INTO document_template_files
            (id,version_id,storage_key,original_name,mime_type,size_bytes,checksum,placeholders)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
          [
            uuidv7(),
            versionId,
            file.storage_key,
            file.original_name,
            file.mime_type,
            file.size_bytes,
            file.checksum,
            JSON.stringify(file.placeholders),
          ]
        );
      }
      for (const file of incoming) {
        const storageKey = `document-templates/${templateId}/${versionId}/${randomUUID()}/${file.checksum}`;
        const metadata = {
          purpose: 'document_template',
          templateId,
          versionId,
          uploadedBy: actor.userId,
        };
        await reserveStorageCopy(storageKey, metadata);
        const reservation = await client.query(
          `SELECT storage_key FROM storage_records WHERE storage_key=$1 AND status='removed'
           AND metadata->>'provisionalCopy'='true' AND metadata->>'deletionRequested'='true' FOR UPDATE`,
          [storageKey]
        );
        if (!reservation.rowCount)
          throw new ServiceUnavailableException('Template upload reservation expired');
        await storage.putObject(storageKey, file.bytes, file.mimeType);
        await client.query(
          `UPDATE storage_records SET status='immutable',signed_at=NOW(),signed_by=$2,
           content_type=$3,file_size=$4,category='document',file_name=$5,
           metadata=$6::jsonb,removed_at=NULL,updated_at=NOW() WHERE storage_key=$1`,
          [
            storageKey,
            actor.userId,
            file.mimeType,
            file.bytes.length,
            file.originalName,
            JSON.stringify({ ...metadata, sha256: file.checksum }),
          ]
        );
        await client.query(
          `INSERT INTO document_template_files
            (id,version_id,storage_key,original_name,mime_type,size_bytes,checksum,placeholders)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
          [
            uuidv7(),
            versionId,
            storageKey,
            file.originalName,
            file.mimeType,
            file.bytes.length,
            file.checksum,
            JSON.stringify(file.placeholders),
          ]
        );
      }
      await client.query('UPDATE document_templates SET updated_at=NOW() WHERE id=$1', [
        templateId,
      ]);
      await this.audit(client, actor, ip, 'document_template_version_created', templateId, {
        versionId,
        versionNumber: (latest?.version_number ?? 0) + 1,
      });
    });
    return this.get(templateId);
  }

  async download(templateId: string, versionId: string, fileId: string) {
    if (!this.storage) throw new ServiceUnavailableException('Object storage is unavailable');
    const row = (
      await getDbPool().query<{ storage_key: string }>(
        `SELECT f.storage_key FROM document_template_files f
         JOIN document_template_versions v ON v.id=f.version_id
         WHERE v.template_id=$1 AND v.id=$2 AND f.id=$3`,
        [templateId, versionId, fileId]
      )
    ).rows[0];
    if (!row) throw new NotFoundException('Document template file not found');
    return { url: await this.storage.presignedGetUrl(row.storage_key, 300), expiresIn: 300 };
  }
}
