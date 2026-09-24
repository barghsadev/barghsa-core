import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';
import { uuidv7, timestamptz } from '../types.js';
import { users } from './users.js';
import { storageRecords } from './storage-record.js';

/**
 * Knowledge base record (S-09.11, T-09.11.02).
 *
 * One row = one knowledge base an admin curates for AI retrieval: a
 * human-friendly title, free-text description, and a set of attached
 * documents (see {@link kbDocuments}). Agents (T-09.11.04) reference KBs
 * directly or through KB groups (see kb-groups.ts).
 *
 * Row layout:
 * - `title`        human-friendly label shown in the admin UI
 * - `description`  free-text notes (defaults to '' so the admin API can
 *                  treat it as optional without nullable handling)
 * - `created_by`   admin user who created the KB
 *
 * The CHECK constraint on non-empty `title` and the `updated_at` trigger
 * live in migration 0043 (Drizzle v0.40's column builder has no
 * `.check()`); `knowledge-bases.test.ts` pins the migration so a future
 * `drizzle-kit generate` cannot silently drop them.
 */
export const knowledgeBases = pgTable(
  'knowledge_bases',
  {
    id: uuidv7('id').primaryKey().notNull(),

    /** Human-friendly label shown in the admin UI. */
    title: text('title').notNull(),

    /** Free-text description of the KB's purpose/content. */
    description: text('description').notNull().default(''),

    sourceType: text('source_type', { enum: ['document', 'url', 'api'] })
      .notNull()
      .default('document'),
    sourceConfig: jsonb('source_config')
      .$type<{ urls?: string[]; apiUrl?: string }>()
      .notNull()
      .default({}),
    contentState: text('content_state', { enum: ['empty', 'processing', 'ready', 'error'] })
      .notNull()
      .default('empty'),
    contentError: text('content_error'),
    chunkingStrategy: jsonb('chunking_strategy')
      .$type<{ size: number; overlap: number }>()
      .notNull()
      .default({ size: 800, overlap: 100 }),
    vectorEmbeddingModel: text('vector_embedding_model'),
    isEnabled: boolean('is_enabled').notNull().default(false),

    /** Admin user who created this KB. */
    createdBy: text('created_by')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),

    createdAt: timestamptz('created_at').defaultNow().notNull(),
    updatedAt: timestamptz('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    /** List by recency for the admin UI (migration 0043). */
    index('idx_kb_created_at').on(table.createdAt),
  ]
);

/**
 * Documents attached to a knowledge base (S-09.11, T-09.11.02).
 *
 * A `kb_documents` row is a link between a KB and a file in the shared
 * document system (`storage_records`, S3 + presigned upload). The row
 * snapshots the file metadata at attach time and carries the processing
 * state of the chunk/embed pipeline:
 *
 * - `pending`    — attached, not yet claimed by a processor
 * - `processing` — claimed by the chunk/embed worker (E-05 pipeline)
 * - `ready`      — chunked + embedded, retrievable by agents
 * - `failed`     — processing failed; `processing_error` carries the reason
 *
 * The actual chunking/embedding worker is supplied by the document-
 * processing epic (E-05, T-05.09/T-05.11+); this table fixes the contract
 * so the worker can claim rows without a schema change. Deleting a KB
 * cascades to its document links; the storage records themselves are
 * untouched (shared document store).
 */
export const kbDocuments = pgTable(
  'kb_documents',
  {
    id: uuidv7('id').primaryKey().notNull(),

    /** Owning knowledge base (cascade delete removes the link). */
    kbId: uuid('kb_id')
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: 'cascade' }),

    /** Storage key of the attached file (shared document system). */
    storageKey: text('storage_key')
      .notNull()
      .references(() => storageRecords.storageKey, { onDelete: 'restrict' }),

    /** Original file name snapshotted at attach time. */
    fileName: text('file_name').notNull(),

    /** MIME content type snapshotted at attach time. */
    mimeType: text('mime_type'),

    /** File size in bytes snapshotted at attach time. */
    sizeBytes: bigint('size_bytes', { mode: 'number' }),

    /** Chunk/embed pipeline state ('pending' | 'processing' | 'ready' | 'failed'). */
    processingStatus: text('processing_status', {
      enum: ['pending', 'processing', 'ready', 'failed'],
    } as const)
      .notNull()
      .default('pending'),

    /** Safe, non-secret reason from the latest failed processing run. */
    processingError: text('processing_error'),

    /** Admin user who attached the document. */
    createdBy: text('created_by')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),

    createdAt: timestamptz('created_at').defaultNow().notNull(),
    updatedAt: timestamptz('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    /** A document is attached to a KB exactly once (migration 0043). */
    unique('uq_kbd_kb_storage').on(table.kbId, table.storageKey),
    /** Documents of one KB (admin detail view). */
    index('idx_kbd_kb_id').on(table.kbId),
    /** Pending-document claim queries for the future chunk/embed worker. */
    index('idx_kbd_processing_status')
      .on(table.processingStatus)
      .where(sql`processing_status IN ('pending', 'processing', 'failed')`),
  ]
);

/** Retrieved passages. Embeddings use the configured 1536-dimensional model. */
export const kbChunks = pgTable(
  'kb_chunks',
  {
    id: uuidv7('id').primaryKey().notNull(),
    kbId: uuid('kb_id')
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').references(() => kbDocuments.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    index('idx_kb_chunks_kb_id').on(table.kbId),
    index('idx_kb_chunks_document_id').on(table.documentId),
  ]
);
