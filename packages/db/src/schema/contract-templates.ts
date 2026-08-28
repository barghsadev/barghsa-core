import { sql } from 'drizzle-orm'
import { bigint, integer, text, uuid } from 'drizzle-orm/pg-core'
import { createTable } from '../base-table'
import { users } from './users'

/**
 * Contract templates (T-09.12.04) — admin-managed document templates
 * with placeholders.
 *
 * `contract_templates` — one row per named template:
 * - `name` is trimmed and case-insensitively UNIQUE (index on LOWER);
 * - `status` `active` | `inactive` — inactive is the archival path
 *   (templates with version history can never be hard-deleted);
 * - `created_by` identities the admin who created the template.
 *
 * `contract_template_versions` — append-only version history:
 * - `version_number` is a 1-based per-template sequence (UNIQUE per
 *   template). Creating a new version never touches prior rows or their
 *   object-storage files — old files stay as the archive of previous
 *   versions;
 * - `storage_key` points at the object-storage object (UNIQUE);
 * - `placeholders` is the TEXT[] extracted from the file at upload time
 *   ({{name}} regex, see @barghsa/shared/admin contract-templates);
 * - the RESTRICT FKs mean a template with versions can never be
 *   hard-deleted (versions are the audit archive).
 *
 * `contract_type_templates` — no-delete seam for S-04.5.03:
 * - rows are written by the future contract-types module to link a
 *   contract type to one template. The RESTRICT FK on template_id is the
 *   hard DB guarantee behind "cannot delete a template referenced by
 *   (active) contract types". contract_type_id has no FK yet — it is
 *   added when the contract_types table lands (S-04.5.03).
 *
 * The hand-written migration 0049 also declares: status/name CHECKs,
 * the case-insensitive UNIQUE name index, UNIQUE storage_key and
 * (template_id, version_number), and an `updated_at` trigger on
 * contract_templates.
 */
export const contractTemplates = createTable('contract_templates', {
  /** Display name, trimmed, case-insensitively UNIQUE (migration 0049). */
  name: text('name').notNull(),

  /** Free-form description (nullable). */
  description: text('description'),

  /** `active` | `inactive` — inactive = archived. */
  status: text('status', {
    enum: ['active', 'inactive'],
  })
    .notNull()
    .default('active'),

  /** Admin who created the template. */
  createdBy: text('created_by')
    .notNull()
    .references(() => users.userId, { onDelete: 'restrict' }),
})

/**
 * Append-only version history (T-09.12.04).
 *
 * One row per uploaded template file. `version_number` sequences per
 * template from 1; the file lives in object storage under `storage_key`.
 * `placeholders` is immutable after upload — it is exactly what the
 * regex extracted from that file at upload time.
 */
export const contractTemplateVersions = createTable(
  'contract_template_versions',
  {
    /** FK contract_templates.id, RESTRICT (history is never orphaned). */
    templateId: uuid('template_id')
      .notNull()
      .references(() => contractTemplates.id, { onDelete: 'restrict' }),

    /** 1-based per-template sequence; UNIQUE per template. */
    versionNumber: integer('version_number').notNull(),

    /** Object-storage key for the template file (UNIQUE). */
    storageKey: text('storage_key').notNull(),

    /** Original upload file name. */
    fileName: text('file_name').notNull(),

    /** MIME content type as provided (sanitized by the service). */
    contentType: text('content_type'),

    /** File size in bytes. */
    fileSize: bigint('file_size', { mode: 'number' }),

    /** Placeholders extracted at upload time; never edited afterwards. */
    placeholders: text('placeholders').array().notNull().default(sql`'{}'`),

    /** Admin who uploaded this version. */
    createdBy: text('created_by')
      .notNull()
      .references(() => users.userId, { onDelete: 'restrict' }),
  },
)

/**
 * Contract-type → template links (no-delete seam, S-04.5.03).
 *
 * The RESTRICT FK on template_id hard-blocks deleting any template with
 * a link row; the service also pre-checks for a friendly 409. The
 * contract_type_id FK is intentionally absent until contract_types
 * exists (S-04.5.03 will add it).
 */
export const contractTypeTemplates = createTable('contract_type_templates', {
  /** FK contract_types(id) — added by S-04.5.03 when the table lands. */
  contractTypeId: uuid('contract_type_id').notNull(),

  /** FK contract_templates.id, RESTRICT — deletion guard. */
  templateId: uuid('template_id')
    .notNull()
    .references(() => contractTemplates.id, { onDelete: 'restrict' }),
})
