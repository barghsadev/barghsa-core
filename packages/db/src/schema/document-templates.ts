import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { baseColumns } from '../base-table.js';
import { users } from './users.js';

export const documentTemplates = pgTable(
  'document_templates',
  {
    ...baseColumns,
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    category: text('category').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
  },
  (table) => [index('idx_document_templates_category').on(table.category)]
);

export const documentTemplateVersions = pgTable(
  'document_template_versions',
  {
    ...baseColumns,
    templateId: uuid('template_id')
      .notNull()
      .references(() => documentTemplates.id, { onDelete: 'restrict' }),
    versionNumber: integer('version_number').notNull(),
    changeSummary: text('change_summary').notNull().default(''),
    placeholders: jsonb('placeholders')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
  },
  (table) => [uniqueIndex('uq_document_template_version').on(table.templateId, table.versionNumber)]
);

export const documentTemplateFiles = pgTable(
  'document_template_files',
  {
    ...baseColumns,
    versionId: uuid('version_id')
      .notNull()
      .references(() => documentTemplateVersions.id, { onDelete: 'restrict' }),
    storageKey: text('storage_key').notNull(),
    originalName: text('original_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    checksum: text('checksum').notNull(),
    placeholders: jsonb('placeholders')
      .$type<Array<{ name: string; context: string }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
  },
  (table) => [
    uniqueIndex('uq_document_template_file_name').on(table.versionId, table.originalName),
    uniqueIndex('uq_document_template_file_storage').on(table.versionId, table.storageKey),
  ]
);
