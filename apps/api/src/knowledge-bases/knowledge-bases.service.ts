import type { PoolClient } from 'pg';
import { requireStaffMutationPermission } from '../admin/staff-mutation-permission.js';
import { Injectable, Logger, HttpException } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { getDbPool } from '@barghsa/db';

/**
 * Knowledge base management service (S-09.11, T-09.11.02).
 *
 * CRUD for the `knowledge_bases` table plus document linking and KB group
 * orchestration:
 *
 * - KBs are plain admin-curated records (title, description).
 * - Documents are attached by **storage key**: the key must exist in the
 *   shared document system (`storage_records`), and the link row snapshots
 *   the file metadata (name, mime, size) at attach time. The chunk/embed
 *   pipeline state starts at `pending`; the actual processing worker is
 *   supplied by the document-processing epic (E-05, T-05.09/T-05.11+) and
 *   claims rows through `processing_status` — no schema change needed.
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

// ─── Mutation inputs ───────────────────────────────────────────────────────

export interface CreateKbInput {
  title: string;
  description: string;
  actorUserId: string;
  ip: string;
}

export interface UpdateKbInput {
  title?: string;
  description?: string;
  actorUserId: string;
  ip: string;
}

export interface AttachDocumentInput {
  kbId: string;
  storageKey: string;
  actorUserId: string;
  ip: string;
}

export interface CreateKbGroupInput {
  title: string;
  description: string;
  actorUserId: string;
  ip: string;
}

export interface UpdateKbGroupInput {
  title?: string;
  description?: string;
  actorUserId: string;
  ip: string;
}

export interface AddGroupMemberInput {
  groupId: string;
  kbId: string;
  actorUserId: string;
  ip: string;
}

// ─── Internal row shapes (snake_case, as returned by postgres) ─────────────

interface KbRow {
  id: string;
  title: string;
  description: string;
  document_count: number;
  group_count: number;
  created_at: string;
  updated_at: string;
}

interface KbBaseRow {
  id: string;
  title: string;
  description: string;
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
      `SELECT kb.id, kb.title, kb.description, kb.created_at, kb.updated_at,
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

  /** Create a KB. */
  async createKb(input: CreateKbInput): Promise<KbDto> {
    return this.withTransaction(input.actorUserId, async (client) => {
      const id = uuidv7();
      const now = new Date();

      const result = await client.query<KbBaseRow>(
        `INSERT INTO knowledge_bases (id, title, description, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $5)
         RETURNING id, title, description, created_at, updated_at`,
        [id, input.title, input.description, input.actorUserId, now]
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
    return this.withTransaction(input.actorUserId, async (client) => {
      const existing = await this.findKb(id, client);
      if (!existing) throw this.kbNotFound(id);

      const fields: string[] = [];
      const values: unknown[] = [];
      let param = 1;
      const push = (column: string, value: unknown): void => {
        fields.push(`${column} = $${param++}`);
        values.push(value);
      };

      if (input.title !== undefined) push('title', input.title);
      if (input.description !== undefined) push('description', input.description);
      if (fields.length === 0) return this.getKb(id, client);

      fields.push(`updated_at = $${param++}`);
      values.push(new Date());
      values.push(id);

      const result = await client.query<KbBaseRow>(
        `UPDATE knowledge_bases SET ${fields.join(', ')}
          WHERE id = $${param}
          RETURNING id, title, description, created_at, updated_at`,
        values
      );
      const row = result.rows[0];
      if (!row) throw this.kbNotFound(id);

      const groups = await this.groupRefsForKb(id, client);
      const docs = await this.docsForKb(id, client);
      await this.recordAudit(
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
  async removeKb(id: string, actorUserId: string, ip: string): Promise<void> {
    return this.withTransaction(actorUserId, async (client) => {
      const existing = await this.findKb(id, client);
      if (!existing) throw this.kbNotFound(id);

      await client.query('DELETE FROM knowledge_bases WHERE id = $1', [id]);
      await this.recordAudit(
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

  /**
   * Attach a document (by storage key) to a KB.
   *
   * The key must reference an existing, non-removed storage record in the
   * shared document system; the row snapshots the file metadata and starts
   * the chunk/embed pipeline at `pending`. Attaching the same key twice is
   * a no-op returning the existing link (idempotent).
   */
  async attachDocument(input: AttachDocumentInput): Promise<KbDocumentDto> {
    return this.withTransaction(input.actorUserId, async (client) => {
      const kb = await this.findKb(input.kbId, client);
      if (!kb) throw this.kbNotFound(input.kbId);

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
        await this.recordAudit(
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
    ip: string
  ): Promise<void> {
    return this.withTransaction(actorUserId, async (client) => {
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
      await this.recordAudit(
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
    return this.withTransaction(input.actorUserId, async (client) => {
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
    return this.withTransaction(input.actorUserId, async (client) => {
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
  async removeGroup(id: string, actorUserId: string, ip: string): Promise<void> {
    return this.withTransaction(actorUserId, async (client) => {
      const existing = await this.findGroup(id, client);
      if (!existing) throw this.groupNotFound(id);

      await client.query('DELETE FROM kb_groups WHERE id = $1', [id]);
      await this.recordAudit(
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
    return this.withTransaction(input.actorUserId, async (client) => {
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
    ip: string
  ): Promise<void> {
    return this.withTransaction(actorUserId, async (client) => {
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
      `SELECT id, title, description, created_at, updated_at
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
    work: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      await requireStaffMutationPermission(client, actorUserId, 'admin:ai:kb');
      const result = await work(client);
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
      [auditId, actorUserId, event, JSON.stringify(meta), uuidv7(), ip, new Date()]
    );
  }
}
