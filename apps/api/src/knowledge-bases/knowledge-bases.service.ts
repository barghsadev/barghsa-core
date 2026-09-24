import { ErrorCodes } from '@barghsa/shared/errors';
import { requireSessionStepUp } from '../session/session-step-up.js';
import type { ValidatedSession } from '../session/session.service.js';
import type { PoolClient } from 'pg';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { Injectable, Logger, HttpException } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { getDbPool } from '@barghsa/db';
import { OpenAiEmbeddingClient, type EmbeddingClient } from '@barghsa/shared/ai-models';

type MutationSession = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;

/**
 * Knowledge base management service (S-09.11, T-09.11.02).
 *
 * CRUD for the `knowledge_bases` table plus document linking and KB group
 * orchestration:
 *
 * - KBs are admin-curated sources with processing and publication state.
 * - Documents are attached by **storage key**: the key must exist in the
 *   shared document system (`storage_records`), and the link row snapshots
 *   the file metadata (name, mime, size) at attach time. The chunk/embed
 *   pipeline state starts at `pending`; the worker claims KBs in `empty`
 *   state and publishes passages only while the source revision is current.
 * - KB groups are named collections of KBs (many-to-many via
 *   `kb_group_members`). Agents (T-09.11.04) reference groups to retrieve
 *   across several curated KBs at once.
 *
 * Every mutation records an `audit_log` event with actor, ip, and a
 * masked-target summary. Permission `admin:ai:kb` is enforced at the
 * controller boundary (mapped to platform admin today, per the S-09
 * admin convention).
 */

// ─── Public DTOs ───────────────────────────────────────────────────────────

/** A knowledge base row with its admin-list aggregates. */
export interface KbDto {
  id: string;
  title: string;
  description: string;
  sourceType: 'document' | 'url' | 'api';
  sourceConfig: { urls?: string[] | undefined; apiUrl?: string | undefined };
  contentState: 'empty' | 'processing' | 'ready' | 'error';
  contentError: string | null;
  chunkingStrategy: { size: number; overlap: number };
  vectorEmbeddingModel: string | null;
  isEnabled: boolean;
  /** Number of attached documents (chunk/embed pending or done). */
  documentCount: number;
  /** Number of KB groups this KB belongs to. */
  groupCount: number;
  createdAt: string;
  updatedAt: string;
}

/** A document link row as returned by the admin API. */
export interface KbDocumentDto {
  id: string;
  kbId: string;
  storageKey: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  /** 'pending' | 'processing' | 'ready' | 'failed' */
  processingStatus: string;
  processingError: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A group as referenced from a KB detail view. */
export interface KbGroupRefDto {
  id: string;
  title: string;
}

/** KB detail: documents + group memberships. */
export interface KbDetailDto extends KbDto {
  documents: KbDocumentDto[];
  groups: KbGroupRefDto[];
}

/** A KB as referenced from a group detail view. */
export interface KbRefDto {
  id: string;
  title: string;
}

/** A KB group row with its member count. */
export interface KbGroupDto {
  id: string;
  title: string;
  description: string;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

/** KB group detail: member KBs. */
export interface KbGroupDetailDto extends KbGroupDto {
  members: KbRefDto[];
}

export interface KbQueryResult {
  id: string;
  kbId: string;
  documentId: string | null;
  excerpt: string;
  score: number;
  metadata: Record<string, unknown>;
}

// ─── Mutation inputs ───────────────────────────────────────────────────────

export interface CreateKbInput {
  title: string;
  description: string;
  sourceType?: 'document' | 'url' | 'api';
  sourceConfig?: { urls?: string[] | undefined; apiUrl?: string | undefined };
  chunkingStrategy?: { size: number; overlap: number };
  vectorEmbeddingModel?: string | null;
  actorUserId: string;
  session: MutationSession;
  ip: string;
}

export interface UpdateKbInput {
  title?: string;
  description?: string;
  sourceType?: 'document' | 'url' | 'api';
  sourceConfig?: { urls?: string[] | undefined; apiUrl?: string | undefined };
  chunkingStrategy?: { size: number; overlap: number };
  vectorEmbeddingModel?: string | null;
  isEnabled?: boolean;
  actorUserId: string;
  session: MutationSession;
  ip: string;
}

export interface AttachDocumentInput {
  kbId: string;
  storageKey: string;
  actorUserId: string;
  session: MutationSession;
  ip: string;
}

export interface CreateKbGroupInput {
  title: string;
  description: string;
  actorUserId: string;
  session: MutationSession;
  ip: string;
}

export interface UpdateKbGroupInput {
  title?: string;
  description?: string;
  actorUserId: string;
  session: MutationSession;
  ip: string;
}

export interface AddGroupMemberInput {
  groupId: string;
  kbId: string;
  actorUserId: string;
  session: MutationSession;
  ip: string;
}

// ─── Internal row shapes (snake_case, as returned by postgres) ─────────────

interface KbRow extends KbBaseRow {
  document_count: number;
  group_count: number;
}

interface KbBaseRow {
  id: string;
  title: string;
  description: string;
  source_type: 'document' | 'url' | 'api';
  source_config: { urls?: string[]; apiUrl?: string };
  content_state: 'empty' | 'processing' | 'ready' | 'error';
  content_error: string | null;
  chunking_strategy: { size: number; overlap: number };
  vector_embedding_model: string | null;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface KbDocumentRow {
  id: string;
  kb_id: string;
  storage_key: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  processing_status: 'pending' | 'processing' | 'ready' | 'failed';
  processing_error: string | null;
  created_at: string;
  updated_at: string;
}

interface KbRefRow {
  id: string;
  title: string;
}

interface KbGroupRow {
  id: string;
  title: string;
  description: string;
  member_count: number;
  created_at: string;
  updated_at: string;
}

interface KbGroupBaseRow {
  id: string;
  title: string;
  description: string;
  created_at: string;
  updated_at: string;
}

interface StorageRecordRow {
  metadata: Record<string, unknown> | null;
  storage_key: string;
  file_name: string | null;
  content_type: string | null;
  file_size: number | null;
  status: 'active' | 'immutable' | 'removed';
}

const PG_FOREIGN_KEY_VIOLATION = '23503';

@Injectable()
export class KnowledgeBasesService {
  private readonly logger = new Logger(KnowledgeBasesService.name);

  // ─── Knowledge base CRUD ─────────────────────────────────────────────────

  /** List all KBs, newest first, with document and group counts. */
  async listKbs(): Promise<KbDto[]> {
    const result = await getDbPool().query<KbRow>(
      `SELECT kb.*,
              COUNT(DISTINCT d.id)::int  AS document_count,
              COUNT(DISTINCT m.group_id)::int AS group_count
         FROM knowledge_bases kb
         LEFT JOIN kb_documents d  ON d.kb_id  = kb.id
         LEFT JOIN kb_group_members m ON m.kb_id = kb.id
        GROUP BY kb.id
        ORDER BY kb.created_at DESC, kb.id`
    );
    return result.rows.map((row) => this.kbToDto(row));
  }

  /** Fetch a single KB with its documents and group memberships. */
  async getKb(id: string, client?: PoolClient): Promise<KbDetailDto> {
    const base = await this.findKb(id, client);
    if (!base) throw this.kbNotFound(id);

    const docs = await (client ?? getDbPool()).query<KbDocumentRow>(
      `SELECT id, kb_id, storage_key, file_name, mime_type, size_bytes,
              processing_status, processing_error, created_at, updated_at
         FROM kb_documents
        WHERE kb_id = $1
        ORDER BY created_at DESC, id`,
      [id]
    );
    const groups = await (client ?? getDbPool()).query<KbRefRow>(
      `SELECT g.id, g.title
         FROM kb_groups g
         JOIN kb_group_members m ON m.group_id = g.id
        WHERE m.kb_id = $1
        ORDER BY g.title, g.id`,
      [id]
    );

    return {
      ...this.kbToDto({
        ...base,
        document_count: docs.rows.length,
        group_count: groups.rows.length,
      }),
      documents: docs.rows.map((row) => this.docToDto(row)),
      groups: groups.rows,
    };
  }

  private async searchChunks(
    kbIds: string[],
    model: string,
    query: string,
    limit: number,
    embedder: EmbeddingClient
  ): Promise<KbQueryResult[]> {
    let vector: number[] | undefined;
    try {
      [vector] = await embedder.embed([query], model);
    } catch {
      throw new HttpException(
        {
          statusCode: 503,
          error: 'KB_EMBEDDING_UNAVAILABLE',
          message: 'Embedding provider is unavailable',
        },
        503
      );
    }
    if (!vector || vector.length !== 1536 || !vector.every(Number.isFinite))
      throw new HttpException(
        {
          statusCode: 502,
          error: 'KB_EMBEDDING_INVALID',
          message: 'Embedding provider returned an invalid vector',
        },
        502
      );
    const result = await getDbPool().query<{
      id: string;
      kb_id: string;
      document_id: string | null;
      excerpt: string;
      score: number;
      metadata: Record<string, unknown>;
    }>(
      `SELECT id,kb_id,document_id,LEFT(content,800) AS excerpt,
              (1-(embedding <=> $2::vector))::float8 AS score,metadata
       FROM kb_chunks WHERE kb_id=ANY($1::uuid[]) AND embedding IS NOT NULL
       ORDER BY embedding <=> $2::vector,id LIMIT $3`,
      [kbIds, JSON.stringify(vector), limit]
    );
    return result.rows.map((row) => ({
      id: row.id,
      kbId: row.kb_id,
      documentId: row.document_id,
      excerpt: row.excerpt,
      score: row.score,
      metadata: row.metadata,
    }));
  }

  /** Inspect nearest passages even before a ready KB is enabled for agents. */
  async queryKb(
    id: string,
    query: string,
    limit = 5,
    embedder: EmbeddingClient = new OpenAiEmbeddingClient()
  ): Promise<KbQueryResult[]> {
    const kb = await this.findKb(id);
    if (!kb) throw this.kbNotFound(id);
    if (kb.content_state !== 'ready' || !kb.vector_embedding_model)
      throw new HttpException(
        {
          statusCode: 409,
          error: 'KB_NOT_READY',
          message: 'This knowledge base is not ready to search',
        },
        409
      );
    return this.searchChunks([id], kb.vector_embedding_model, query, limit, embedder);
  }

  /** Search enabled, ready members using each member's configured embedding model. */
  async queryGroup(
    id: string,
    query: string,
    limit = 5,
    embedder: EmbeddingClient = new OpenAiEmbeddingClient()
  ): Promise<KbQueryResult[]> {
    if (!(await this.findGroup(id))) throw this.groupNotFound(id);
    const members = await getDbPool().query<{ id: string; model: string }>(
      `SELECT kb.id,kb.vector_embedding_model AS model
       FROM kb_group_members m JOIN knowledge_bases kb ON kb.id=m.kb_id
       WHERE m.group_id=$1 AND kb.is_enabled=true AND kb.content_state='ready'
         AND kb.vector_embedding_model IS NOT NULL ORDER BY kb.id`,
      [id]
    );
    const byModel = new Map<string, string[]>();
    for (const member of members.rows)
      byModel.set(member.model, [...(byModel.get(member.model) ?? []), member.id]);
    if (byModel.size > 20)
      throw new HttpException(
        {
          statusCode: 409,
          error: 'KB_GROUP_TOO_MANY_MODELS',
          message: 'This group uses too many embedding models',
        },
        409
      );
    const results = await Promise.all(
      [...byModel].map(([model, ids]) => this.searchChunks(ids, model, query, limit, embedder))
    );
    return results
      .flat()
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, limit);
  }

  /** Invalidate published passages and queue this KB for a fresh worker run. */
  async reprocessKb(
    id: string,
    actorUserId: string,
    ip: string,
    session: MutationSession
  ): Promise<KbDto> {
    return this.withTransaction(actorUserId, session, async (client, verifiedAt) => {
      const kb = await this.findKb(id, client);
      if (!kb) throw this.kbNotFound(id);
      if (kb.source_type === 'document') {
        const count = await client.query<{ count: number }>(
          'SELECT COUNT(*)::int AS count FROM kb_documents WHERE kb_id=$1',
          [id]
        );
        if (!count.rows[0]?.count)
          throw new HttpException(
            {
              statusCode: 409,
              error: 'KB_SOURCE_EMPTY',
              message: 'Attach a document before processing',
            },
            409
          );
      }
      await client.query('DELETE FROM kb_chunks WHERE kb_id=$1', [id]);
      await client.query(
        "UPDATE kb_documents SET processing_status='pending',processing_error=NULL WHERE kb_id=$1",
        [id]
      );
      const result = await client.query<KbBaseRow>(
        "UPDATE knowledge_bases SET content_state='empty',content_error=NULL,is_enabled=false WHERE id=$1 RETURNING *",
        [id]
      );
      await this.recordAudit(
        verifiedAt,
        'kb_reprocess_requested',
        actorUserId,
        ip,
        { targetId: id },
        client
      );
      const docs = await this.docsForKb(id, client);
      const groups = await this.groupRefsForKb(id, client);
      return this.kbToDto({
        ...result.rows[0]!,
        document_count: docs.length,
        group_count: groups.length,
      });
    });
  }

  /** Create a KB. */
  async createKb(input: CreateKbInput): Promise<KbDto> {
    return this.withTransaction(input.actorUserId, input.session, async (client, verifiedAt) => {
      const id = uuidv7();
      const now = new Date();

      const result = await client.query<KbBaseRow>(
        `INSERT INTO knowledge_bases
           (id, title, description, source_type, source_config, chunking_strategy,
            vector_embedding_model, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $9)
         RETURNING *`,
        [
          id,
          input.title,
          input.description,
          input.sourceType ?? 'document',
          JSON.stringify(input.sourceConfig ?? {}),
          JSON.stringify(input.chunkingStrategy ?? { size: 800, overlap: 100 }),
          input.vectorEmbeddingModel ?? null,
          input.actorUserId,
          now,
        ]
      );
      const row = result.rows[0];
      if (!row) {
        throw new HttpException(
          {
            statusCode: 500,
            error: 'KB_CREATE_FAILED',
            message: 'Failed to create knowledge base',
          },
          500
        );
      }
      await this.recordAudit(
        verifiedAt,
        'kb_created',
        input.actorUserId,
        input.ip,
        {
          targetId: row.id,
          title: row.title,
        },
        client
      );
      this.logger.log(`Knowledge base created: id=${id}, actor=${input.actorUserId}`);
      return { ...this.kbToDto(row), documentCount: 0, groupCount: 0 };
    });
  }

  /** Update a KB's title/description. */
  async updateKb(id: string, input: UpdateKbInput): Promise<KbDto> {
    return this.withTransaction(input.actorUserId, input.session, async (client, verifiedAt) => {
      const existing = await this.findKb(id, client);
      if (!existing) throw this.kbNotFound(id);

      const sourceType = input.sourceType ?? existing.source_type;
      const sourceConfig = input.sourceConfig ?? existing.source_config;
      if (
        (sourceType === 'url' && !sourceConfig.urls?.length) ||
        (sourceType === 'api' && !sourceConfig.apiUrl)
      ) {
        throw new HttpException(
          { statusCode: 400, error: 'KB_SOURCE_REQUIRED', message: 'A source address is required' },
          400
        );
      }

      const fields: string[] = [];
      const values: unknown[] = [];
      let param = 1;
      const push = (column: string, value: unknown): void => {
        fields.push(`${column} = $${param++}`);
        values.push(value);
      };

      if (input.title !== undefined) push('title', input.title);
      if (input.description !== undefined) push('description', input.description);
      const sourceChanged =
        (input.sourceType !== undefined && input.sourceType !== existing.source_type) ||
        (input.sourceConfig !== undefined &&
          JSON.stringify(input.sourceConfig) !== JSON.stringify(existing.source_config)) ||
        (input.chunkingStrategy !== undefined &&
          JSON.stringify(input.chunkingStrategy) !== JSON.stringify(existing.chunking_strategy)) ||
        (input.vectorEmbeddingModel !== undefined &&
          input.vectorEmbeddingModel !== existing.vector_embedding_model);
      if (sourceChanged && input.isEnabled) {
        throw new HttpException(
          {
            statusCode: 409,
            error: 'KB_REPROCESS_REQUIRED',
            message: 'Process changed content before enabling this knowledge base',
          },
          409
        );
      }
      if (input.sourceType !== undefined && input.sourceType !== existing.source_type)
        push('source_type', input.sourceType);
      if (
        input.sourceConfig !== undefined &&
        JSON.stringify(input.sourceConfig) !== JSON.stringify(existing.source_config)
      )
        push('source_config', JSON.stringify(input.sourceConfig));
      if (
        input.chunkingStrategy !== undefined &&
        JSON.stringify(input.chunkingStrategy) !== JSON.stringify(existing.chunking_strategy)
      )
        push('chunking_strategy', JSON.stringify(input.chunkingStrategy));
      if (
        input.vectorEmbeddingModel !== undefined &&
        input.vectorEmbeddingModel !== existing.vector_embedding_model
      )
        push('vector_embedding_model', input.vectorEmbeddingModel);
      if (input.isEnabled !== undefined) {
        if (input.isEnabled && existing.content_state !== 'ready') {
          throw new HttpException(
            {
              statusCode: 409,
              error: 'KB_NOT_READY',
              message: 'Process content before enabling this knowledge base',
            },
            409
          );
        }
        push('is_enabled', input.isEnabled);
      }
      if (sourceChanged) {
        push('content_state', 'empty');
        push('content_error', null);
        push('is_enabled', false);
        await client.query('DELETE FROM kb_chunks WHERE kb_id=$1', [id]);
        if (input.sourceType !== undefined && input.sourceType !== 'document')
          await client.query('DELETE FROM kb_documents WHERE kb_id=$1', [id]);
        await client.query(
          "UPDATE kb_documents SET processing_status='pending',processing_error=NULL WHERE kb_id=$1",
          [id]
        );
      }
      if (fields.length === 0) return this.getKb(id, client);

      fields.push(`updated_at = $${param++}`);
      values.push(new Date());
      values.push(id);

      const result = await client.query<KbBaseRow>(
        `UPDATE knowledge_bases SET ${fields.join(', ')}
          WHERE id = $${param}
          RETURNING *`,
        values
      );
      const row = result.rows[0];
      if (!row) throw this.kbNotFound(id);

      const groups = await this.groupRefsForKb(id, client);
      const docs = await this.docsForKb(id, client);
      await this.recordAudit(
        verifiedAt,
        'kb_updated',
        input.actorUserId,
        input.ip,
        {
          targetId: row.id,
          title: row.title,
        },
        client
      );
      this.logger.log(`Knowledge base updated: id=${id}, actor=${input.actorUserId}`);
      return {
        ...this.kbToDto({ ...row, document_count: docs.length, group_count: groups.length }),
      };
    });
  }

  /** Delete a KB (cascades to document links + group memberships). */
  async removeKb(
    id: string,
    actorUserId: string,
    ip: string,
    session: MutationSession
  ): Promise<void> {
    return this.withTransaction(actorUserId, session, async (client, verifiedAt) => {
      const existing = await this.findKb(id, client);
      if (!existing) throw this.kbNotFound(id);

      await client.query('DELETE FROM knowledge_bases WHERE id = $1', [id]);
      await this.recordAudit(
        verifiedAt,
        'kb_deleted',
        actorUserId,
        ip,
        {
          targetId: existing.id,
          title: existing.title,
        },
        client
      );
      this.logger.log(`Knowledge base deleted: id=${id}, actor=${actorUserId}`);
    });
  }

  // ─── Knowledge base documents ────────────────────────────────────────────

  async availableDocuments(
    actorUserId: string,
    search: string
  ): Promise<
    Array<{
      storageKey: string;
      fileName: string;
      mimeType: string | null;
      sizeBytes: number | null;
    }>
  > {
    const result = await getDbPool().query<StorageRecordRow>(
      `SELECT storage_key, file_name, content_type, file_size, status, metadata
       FROM storage_records
       WHERE status IN ('active', 'immutable')
         AND metadata->>'uploadedBy' = $1
         AND COALESCE(metadata->>'provisionalUpload', 'false') <> 'true'
         AND COALESCE(metadata->>'deletionRequested', 'false') <> 'true'
         AND COALESCE(file_name, '') ILIKE $2
       ORDER BY created_at DESC, storage_key LIMIT 100`,
      [actorUserId, `%${search}%`]
    );
    return result.rows.map((row) => ({
      storageKey: row.storage_key,
      fileName: row.file_name ?? row.storage_key,
      mimeType: row.content_type,
      sizeBytes: row.file_size === null ? null : Number(row.file_size),
    }));
  }

  /**
   * Attach a document (by storage key) to a KB.
   *
   * The key must reference an existing, non-removed storage record in the
   * shared document system; the row snapshots the file metadata and starts
   * the chunk/embed pipeline at `pending`. Attaching the same key twice is
   * a no-op returning the existing link (idempotent).
   */
  async attachDocument(input: AttachDocumentInput): Promise<KbDocumentDto> {
    return this.withTransaction(input.actorUserId, input.session, async (client, verifiedAt) => {
      const kb = await this.findKb(input.kbId, client);
      if (!kb) throw this.kbNotFound(input.kbId);
      if (kb.source_type !== 'document') {
        throw new HttpException(
          {
            statusCode: 409,
            error: 'KB_SOURCE_MISMATCH',
            message: 'Only document knowledge bases accept uploaded files',
          },
          409
        );
      }

      const record = await this.findStorageRecord(input.storageKey, client);
      if (!record) {
        throw new HttpException(
          {
            statusCode: 404,
            error: 'STORAGE_RECORD_NOT_FOUND',
            message: `Storage record "${input.storageKey}" not found in the document system`,
          },
          404
        );
      }
      if (record.status === 'removed') {
        throw new HttpException(
          {
            statusCode: 409,
            error: 'STORAGE_RECORD_REMOVED',
            message: `Storage record "${input.storageKey}" has been removed`,
          },
          409
        );
      }

      if (record.metadata?.uploadedBy !== input.actorUserId) {
        await requireStaffMutationPermission(client, input.actorUserId, 'admin:storage:edit');
      }
      if (
        ['provisionalUpload', 'deletionRequested'].some(
          (key) => record.metadata?.[key] === true || record.metadata?.[key] === 'true'
        )
      ) {
        throw new HttpException(
          {
            statusCode: 409,
            error: 'STORAGE_RECORD_REMOVED',
            message: 'Upload is incomplete or pending deletion',
          },
          409
        );
      }

      const id = uuidv7();
      const now = new Date();
      const result = await client.query<KbDocumentRow>(
        `INSERT INTO kb_documents
           (id, kb_id, storage_key, file_name, mime_type, size_bytes,
            processing_status, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $8)
         ON CONFLICT (kb_id, storage_key) DO NOTHING
         RETURNING id, kb_id, storage_key, file_name, mime_type, size_bytes,
                   processing_status, processing_error, created_at, updated_at`,
        [
          id,
          input.kbId,
          input.storageKey,
          record.file_name ?? input.storageKey,
          record.content_type,
          record.file_size,
          input.actorUserId,
          now,
        ]
      );
      if (result.rows[0]) {
        await client.query(
          "UPDATE knowledge_bases SET content_state='empty',content_error=NULL,is_enabled=false WHERE id=$1",
          [input.kbId]
        );
        await client.query('DELETE FROM kb_chunks WHERE kb_id=$1', [input.kbId]);
        await client.query(
          "UPDATE kb_documents SET processing_status='pending',processing_error=NULL WHERE kb_id=$1",
          [input.kbId]
        );
        await this.recordAudit(
          verifiedAt,
          'kb_document_attached',
          input.actorUserId,
          input.ip,
          {
            targetId: input.kbId,
            storageKey: input.storageKey,
          },
          client
        );
        this.logger.log(
          `Document attached to KB: kb=${input.kbId}, key=${input.storageKey}, actor=${input.actorUserId}`
        );
        return this.docToDto(result.rows[0]);
      }
      // Already attached: return the existing link.
      const existing = await this.findDocumentLink(input.kbId, input.storageKey, client);
      if (!existing) {
        throw new HttpException(
          {
            statusCode: 500,
            error: 'KB_DOCUMENT_LINK_FAILED',
            message: 'Failed to attach document',
          },
          500
        );
      }
      return this.docToDto(existing);
    });
  }

  /**
   * Detach a document from a KB by its link row id. The storage record
   * itself is retained. The link id (rather than the storage key) is used
   * because storage keys contain path separators (e.g. `uploads/faq.pdf`)
   * and cannot be encoded as a route segment.
   */
  async detachDocument(
    kbId: string,
    documentId: string,
    actorUserId: string,
    ip: string,
    session: MutationSession
  ): Promise<void> {
    return this.withTransaction(actorUserId, session, async (client, verifiedAt) => {
      const kb = await this.findKb(kbId, client);
      if (!kb) throw this.kbNotFound(kbId);

      const link = await this.findDocumentLinkById(documentId, kbId, client);
      if (!link) {
        throw new HttpException(
          {
            statusCode: 404,
            error: 'KB_DOCUMENT_NOT_FOUND',
            message: `Document link ${documentId} is not attached to KB ${kbId}`,
          },
          404
        );
      }
      await client.query('DELETE FROM kb_documents WHERE id = $1 AND kb_id = $2', [
        documentId,
        kbId,
      ]);
      await client.query(
        "UPDATE knowledge_bases SET content_state='empty',content_error=NULL,is_enabled=false WHERE id=$1",
        [kbId]
      );
      await client.query('DELETE FROM kb_chunks WHERE kb_id=$1', [kbId]);
      await client.query(
        "UPDATE kb_documents SET processing_status='pending',processing_error=NULL WHERE kb_id=$1",
        [kbId]
      );
      await this.recordAudit(
        verifiedAt,
        'kb_document_detached',
        actorUserId,
        ip,
        {
          targetId: kbId,
          storageKey: link.storage_key,
        },
        client
      );
      this.logger.log(
        `Document detached from KB: kb=${kbId}, key=${link.storage_key}, actor=${actorUserId}`
      );
    });
  }

  // ─── KB group CRUD ───────────────────────────────────────────────────────

  /** List all KB groups, newest first, with member counts. */
  async listGroups(): Promise<KbGroupDto[]> {
    const result = await getDbPool().query<KbGroupRow>(
      `SELECT g.id, g.title, g.description, g.created_at, g.updated_at,
              COUNT(m.kb_id)::int AS member_count
         FROM kb_groups g
         LEFT JOIN kb_group_members m ON m.group_id = g.id
        GROUP BY g.id
        ORDER BY g.created_at DESC, g.id`
    );
    return result.rows.map((row) => this.groupToDto(row));
  }

  /** Fetch a single KB group with its member KBs. */
  async getGroup(id: string, client?: PoolClient): Promise<KbGroupDetailDto> {
    const base = await this.findGroup(id, client);
    if (!base) throw this.groupNotFound(id);

    const members = await (client ?? getDbPool()).query<KbRefRow>(
      `SELECT kb.id, kb.title
         FROM knowledge_bases kb
         JOIN kb_group_members m ON m.kb_id = kb.id
        WHERE m.group_id = $1
        ORDER BY kb.title, kb.id`,
      [id]
    );
    return {
      ...this.groupToDto({ ...base, member_count: members.rows.length }),
      members: members.rows,
    };
  }

  /** Create a KB group. */
  async createGroup(input: CreateKbGroupInput): Promise<KbGroupDto> {
    return this.withTransaction(input.actorUserId, input.session, async (client, verifiedAt) => {
      const id = uuidv7();
      const now = new Date();

      const result = await client.query<KbGroupBaseRow>(
        `INSERT INTO kb_groups (id, title, description, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $5)
         RETURNING id, title, description, created_at, updated_at`,
        [id, input.title, input.description, input.actorUserId, now]
      );
      const row = result.rows[0];
      if (!row) {
        throw new HttpException(
          {
            statusCode: 500,
            error: 'KB_GROUP_CREATE_FAILED',
            message: 'Failed to create KB group',
          },
          500
        );
      }
      await this.recordAudit(
        verifiedAt,
        'kb_group_created',
        input.actorUserId,
        input.ip,
        {
          targetId: row.id,
          title: row.title,
        },
        client
      );
      this.logger.log(`KB group created: id=${id}, actor=${input.actorUserId}`);
      return { ...this.groupToDto(row), memberCount: 0 };
    });
  }

  /** Update a KB group's title/description. */
  async updateGroup(id: string, input: UpdateKbGroupInput): Promise<KbGroupDto> {
    return this.withTransaction(input.actorUserId, input.session, async (client, verifiedAt) => {
      const existing = await this.findGroup(id, client);
      if (!existing) throw this.groupNotFound(id);

      const fields: string[] = [];
      const values: unknown[] = [];
      let param = 1;
      const push = (column: string, value: unknown): void => {
        fields.push(`${column} = $${param++}`);
        values.push(value);
      };

      if (input.title !== undefined) push('title', input.title);
      if (input.description !== undefined) push('description', input.description);
      if (fields.length === 0) return this.getGroup(id, client);

      fields.push(`updated_at = $${param++}`);
      values.push(new Date());
      values.push(id);

      const result = await client.query<KbGroupBaseRow>(
        `UPDATE kb_groups SET ${fields.join(', ')}
          WHERE id = $${param}
          RETURNING id, title, description, created_at, updated_at`,
        values
      );
      const row = result.rows[0];
      if (!row) throw this.groupNotFound(id);

      const memberCount = await this.memberCountForGroup(id, client);
      await this.recordAudit(
        verifiedAt,
        'kb_group_updated',
        input.actorUserId,
        input.ip,
        {
          targetId: row.id,
          title: row.title,
        },
        client
      );
      this.logger.log(`KB group updated: id=${id}, actor=${input.actorUserId}`);
      return { ...this.groupToDto(row), memberCount };
    });
  }

  /** Delete a KB group (cascades to its memberships). */
  async removeGroup(
    id: string,
    actorUserId: string,
    ip: string,
    session: MutationSession
  ): Promise<void> {
    return this.withTransaction(actorUserId, session, async (client, verifiedAt) => {
      const existing = await this.findGroup(id, client);
      if (!existing) throw this.groupNotFound(id);

      await client.query('DELETE FROM kb_groups WHERE id = $1', [id]);
      await this.recordAudit(
        verifiedAt,
        'kb_group_deleted',
        actorUserId,
        ip,
        {
          targetId: existing.id,
          title: existing.title,
        },
        client
      );
      this.logger.log(`KB group deleted: id=${id}, actor=${actorUserId}`);
    });
  }

  // ─── Group membership ────────────────────────────────────────────────────

  /** Link a KB into a group (idempotent; both records must exist). */
  async addGroupMember(input: AddGroupMemberInput): Promise<void> {
    return this.withTransaction(input.actorUserId, input.session, async (client, verifiedAt) => {
      const group = await this.findGroup(input.groupId, client);
      if (!group) throw this.groupNotFound(input.groupId);
      const kb = await this.findKb(input.kbId, client);
      if (!kb) throw this.kbNotFound(input.kbId);

      try {
        const inserted = await client.query(
          `INSERT INTO kb_group_members (group_id, kb_id, created_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (group_id, kb_id) DO NOTHING`,
          [input.groupId, input.kbId, new Date()]
        );
        if (inserted.rowCount === 0) return;
      } catch (error) {
        if (this.isPgError(error, PG_FOREIGN_KEY_VIOLATION)) {
          // Translate missing-reference failures before rolling back the transaction.
          throw new HttpException(
            {
              statusCode: 409,
              error: 'KB_GROUP_MEMBER_LINK_FAILED',
              message: 'Knowledge base or group no longer exists',
            },
            409
          );
        }
        throw error;
      }
      await this.recordAudit(
        verifiedAt,
        'kb_group_member_added',
        input.actorUserId,
        input.ip,
        {
          targetId: input.groupId,
          kbId: input.kbId,
        },
        client
      );
      this.logger.log(
        `KB linked into group: group=${input.groupId}, kb=${input.kbId}, actor=${input.actorUserId}`
      );
    });
  }

  /** Remove a KB from a group. */
  async removeGroupMember(
    groupId: string,
    kbId: string,
    actorUserId: string,
    ip: string,
    session: MutationSession
  ): Promise<void> {
    return this.withTransaction(actorUserId, session, async (client, verifiedAt) => {
      const group = await this.findGroup(groupId, client);
      if (!group) throw this.groupNotFound(groupId);

      const result = await client.query(
        'DELETE FROM kb_group_members WHERE group_id = $1 AND kb_id = $2',
        [groupId, kbId]
      );
      if ((result.rowCount ?? 0) === 0) {
        throw new HttpException(
          {
            statusCode: 404,
            error: 'KB_GROUP_MEMBER_NOT_FOUND',
            message: `KB ${kbId} is not a member of group ${groupId}`,
          },
          404
        );
      }
      await this.recordAudit(
        verifiedAt,
        'kb_group_member_removed',
        actorUserId,
        ip,
        {
          targetId: groupId,
          kbId,
        },
        client
      );
      this.logger.log(`KB removed from group: group=${groupId}, kb=${kbId}, actor=${actorUserId}`);
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private async findKb(id: string, client?: PoolClient): Promise<KbBaseRow | null> {
    const result = await (client ?? getDbPool()).query<KbBaseRow>(
      `SELECT *
         FROM knowledge_bases
        WHERE id = $1${client ? ' FOR UPDATE' : ''}`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  private async findGroup(id: string, client?: PoolClient): Promise<KbGroupBaseRow | null> {
    const result = await (client ?? getDbPool()).query<KbGroupBaseRow>(
      `SELECT id, title, description, created_at, updated_at
         FROM kb_groups
        WHERE id = $1${client ? ' FOR UPDATE' : ''}`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  private async findStorageRecord(
    storageKey: string,
    client?: PoolClient
  ): Promise<StorageRecordRow | null> {
    const result = await (client ?? getDbPool()).query<StorageRecordRow>(
      `SELECT storage_key, file_name, content_type, file_size, status, metadata
         FROM storage_records
        WHERE storage_key = $1${client ? ' FOR SHARE' : ''}`,
      [storageKey]
    );
    return result.rows[0] ?? null;
  }

  private async findDocumentLink(
    kbId: string,
    storageKey: string,
    client?: PoolClient
  ): Promise<KbDocumentRow | null> {
    const result = await (client ?? getDbPool()).query<KbDocumentRow>(
      `SELECT id, kb_id, storage_key, file_name, mime_type, size_bytes,
              processing_status, processing_error, created_at, updated_at
         FROM kb_documents
        WHERE kb_id = $1 AND storage_key = $2`,
      [kbId, storageKey]
    );
    return result.rows[0] ?? null;
  }

  private async findDocumentLinkById(
    documentId: string,
    kbId: string,
    client?: PoolClient
  ): Promise<KbDocumentRow | null> {
    const result = await (client ?? getDbPool()).query<KbDocumentRow>(
      `SELECT id, kb_id, storage_key, file_name, mime_type, size_bytes,
              processing_status, processing_error, created_at, updated_at
         FROM kb_documents
        WHERE id = $1 AND kb_id = $2`,
      [documentId, kbId]
    );
    return result.rows[0] ?? null;
  }

  private async docsForKb(kbId: string, client?: PoolClient): Promise<KbDocumentRow[]> {
    const result = await (client ?? getDbPool()).query<KbDocumentRow>(
      `SELECT id, kb_id, storage_key, file_name, mime_type, size_bytes,
              processing_status, processing_error, created_at, updated_at
         FROM kb_documents
        WHERE kb_id = $1
        ORDER BY created_at DESC, id`,
      [kbId]
    );
    return result.rows;
  }

  private async groupRefsForKb(kbId: string, client?: PoolClient): Promise<KbRefRow[]> {
    const result = await (client ?? getDbPool()).query<KbRefRow>(
      `SELECT g.id, g.title
         FROM kb_groups g
         JOIN kb_group_members m ON m.group_id = g.id
        WHERE m.kb_id = $1
        ORDER BY g.title, g.id`,
      [kbId]
    );
    return result.rows;
  }

  private async memberCountForGroup(groupId: string, client?: PoolClient): Promise<number> {
    const result = await (client ?? getDbPool()).query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM kb_group_members WHERE group_id = $1',
      [groupId]
    );
    return result.rows[0]?.count ?? 0;
  }

  private kbToDto(row: KbBaseRow & { document_count?: number; group_count?: number }): KbDto {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      sourceType: row.source_type,
      sourceConfig: row.source_config,
      contentState: row.content_state,
      contentError: row.content_error,
      chunkingStrategy: row.chunking_strategy,
      vectorEmbeddingModel: row.vector_embedding_model,
      isEnabled: row.is_enabled,
      documentCount: row.document_count ?? 0,
      groupCount: row.group_count ?? 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private docToDto(row: KbDocumentRow): KbDocumentDto {
    return {
      id: row.id,
      kbId: row.kb_id,
      storageKey: row.storage_key,
      fileName: row.file_name,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      processingStatus: row.processing_status,
      processingError: row.processing_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private groupToDto(row: KbGroupBaseRow & { member_count?: number }): KbGroupDto {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      memberCount: row.member_count ?? 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private kbNotFound(id: string): HttpException {
    return new HttpException(
      { statusCode: 404, error: 'KB_NOT_FOUND', message: `Knowledge base ${id} not found` },
      404
    );
  }

  private groupNotFound(id: string): HttpException {
    return new HttpException(
      { statusCode: 404, error: 'KB_GROUP_NOT_FOUND', message: `KB group ${id} not found` },
      404
    );
  }

  private isPgError(error: unknown, code: string): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: string }).code === code
    );
  }

  private async withTransaction<T>(
    actorUserId: string,
    session: MutationSession,
    work: (client: PoolClient, verifiedAt: Date) => Promise<T>
  ): Promise<T> {
    if (!session || session.userId !== actorUserId) {
      throw new HttpException({ error: ErrorCodes.AUTH_UNAUTHENTICATED.code }, 401);
    }
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, actorUserId, 'admin:ai:kb');
      const verifiedAt = await requireSessionStepUp(client, session);
      const result = await work(client, verifiedAt);
      await requireSessionStepUp(client, session);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async recordAudit(
    verifiedAt: Date,
    event: string,
    actorUserId: string,
    ip: string,
    meta: Record<string, unknown>,
    client?: PoolClient
  ): Promise<void> {
    const auditId = uuidv7();
    await (client ?? getDbPool()).query(
      `INSERT INTO audit_log (id, user_id, event, metadata, correlation_id, ip, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
      [
        auditId,
        actorUserId,
        event,
        JSON.stringify({
          ...meta,
          stepUpVerified: true,
          stepUpVerifiedAt: verifiedAt.toISOString(),
        }),
        uuidv7(),
        ip,
        new Date(),
      ]
    );
  }
}
