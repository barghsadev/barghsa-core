import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { knowledgeBases, kbDocuments } from './knowledge-bases.js'
import { kbGroups, kbGroupMembers } from './kb-groups.js'

/**
 * Drift guard for the knowledge base tables (T-09.11.02).
 *
 * The CHECK constraints, the unique document link, the FK cascade rules,
 * and the plain (non-unique) list/claim indexes for these tables live in
 * migration 0043 (Drizzle v0.40's column builder has no `.check()`). This
 * test asserts the migration still declares them and that the drizzle
 * schema columns match the service layer's expectations. If a future
 * `drizzle-kit generate` ever rewrites the migration and drops a
 * constraint, this test fails instead of silently loosening the KB
 * security posture (owner FK, per-KB document dedupe, processing-state
 * state machine).
 */
const MIGRATION = readFileSync(
  join(process.cwd(), 'drizzle', '0043_create_knowledge_bases.sql'),
  'utf8',
)

/** All four tables must be created by migration 0043. */
const TABLES = [
  'knowledge_bases',
  'kb_documents',
  'kb_groups',
  'kb_group_members',
] as const

describe.each(TABLES)('0043 creates %s', (table) => {
  it(`declares CREATE TABLE for ${table}`, () => {
    expect(MIGRATION).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`))
  })
})

describe('knowledge base schema (T-09.11.02)', () => {
  it('declares the domain columns expected by the service layer', () => {
    const kbColumns = Object.keys(knowledgeBases)
    for (const column of ['id', 'title', 'description', 'createdBy', 'createdAt', 'updatedAt']) {
      expect(kbColumns).toContain(column)
    }
    const docColumns = Object.keys(kbDocuments)
    for (const column of [
      'id',
      'kbId',
      'storageKey',
      'fileName',
      'mimeType',
      'sizeBytes',
      'processingStatus',
      'processingError',
      'createdBy',
    ]) {
      expect(docColumns).toContain(column)
    }
    const groupColumns = Object.keys(kbGroups)
    for (const column of ['id', 'title', 'description', 'createdBy']) {
      expect(groupColumns).toContain(column)
    }
    const memberColumns = Object.keys(kbGroupMembers)
    for (const column of ['groupId', 'kbId']) {
      expect(memberColumns).toContain(column)
    }
  })

  it('migration 0043 keeps the KB title CHECK constraint', () => {
    expect(MIGRATION).toMatch(/chk_kb_title[\s\S]*CHECK \(title <> ''\)/)
  })

  it('migration 0043 keeps the KB group title CHECK constraint', () => {
    expect(MIGRATION).toMatch(/chk_kbg_title[\s\S]*CHECK \(title <> ''\)/)
  })

  it('migration 0043 keeps the document processing-status CHECK constraint', () => {
    expect(MIGRATION).toMatch(
      /chk_kbd_processing_status[\s\S]*CHECK \(processing_status IN \('pending', 'processing', 'ready', 'failed'\)\)/,
    )
  })

  it('migration 0043 keeps the per-KB document dedupe unique constraint', () => {
    expect(MIGRATION).toMatch(/uq_kbd_kb_storage[\s\S]*UNIQUE \(kb_id, storage_key\)/)
  })

  it('migration 0043 keeps the document link FK cascade on KB delete', () => {
    expect(MIGRATION).toMatch(/kb_id\s+UUID NOT NULL REFERENCES knowledge_bases\(id\) ON DELETE CASCADE/)
  })

  it('migration 0043 keeps the storage record FK with restrict delete', () => {
    expect(MIGRATION).toMatch(/storage_key\s+TEXT NOT NULL REFERENCES storage_records\(storage_key\) ON DELETE RESTRICT/)
  })

  it('migration 0043 keeps the group-membership composite PK', () => {
    expect(MIGRATION).toMatch(/PRIMARY KEY \(group_id, kb_id\)/)
  })

  it('migration 0043 keeps the recency list indexes (non-unique)', () => {
    expect(MIGRATION).toMatch(/idx_kb_created_at[\s\S]*ON knowledge_bases \(created_at DESC\)/)
    expect(MIGRATION).toMatch(/idx_kbg_created_at[\s\S]*ON kb_groups \(created_at DESC\)/)
  })

  it('migration 0043 keeps the worker claim index (partial)', () => {
    expect(MIGRATION).toMatch(
      /idx_kbd_processing_status[\s\S]*ON kb_documents \(processing_status\)[\s\S]*WHERE processing_status IN \('pending', 'processing', 'failed'\)/,
    )
  })

  it('migration 0043 keeps the updated_at triggers', () => {
    expect(MIGRATION).toMatch(/trg_kb_updated_at[\s\S]*BEFORE UPDATE ON knowledge_bases/)
    expect(MIGRATION).toMatch(/trg_kbd_updated_at[\s\S]*BEFORE UPDATE ON kb_documents/)
    expect(MIGRATION).toMatch(/trg_kbg_updated_at[\s\S]*BEFORE UPDATE ON kb_groups/)
  })
})