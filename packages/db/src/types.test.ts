import { describe, it, expect } from 'vitest'
import { pgTable } from 'drizzle-orm/pg-core'
import { getTableColumns } from 'drizzle-orm'
import { uuidv7, timestamptz, irrAmount, fixedDecimal, halfOpenRange, halfOpenRangeValue } from './types'

function buildIdTable() {
  return pgTable('test_entities', {
    id: uuidv7('id').primaryKey().notNull(),
  })
}

describe('custom Drizzle types', () => {
  it('uuidv7 applies DEFAULT uuid_generate_v7()', () => {
    const columns = getTableColumns(buildIdTable())
    const id = columns.id
    expect(id.default).toBeDefined()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query = (id.default as any).toQuery({})
    expect(query.sql).toContain('uuid_generate_v7()')
  })

  it('halfOpenRangeValue builds half-open [start, end) literal', () => {
    expect(halfOpenRangeValue('2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z')).toBe(
      '[2026-01-01T00:00:00Z,2027-01-01T00:00:00Z)',
    )
  })

  it('timestamptz creates a timestamp with timezone column', () => {
    const columns = getTableColumns(
      pgTable('tz_test', {
        createdAt: timestamptz('created_at').defaultNow().notNull(),
      }),
    )
    expect(columns.createdAt.getSQLType()).toBe('timestamp with time zone')
  })

  it('irrAmount is a bigint column', () => {
    const columns = getTableColumns(
      pgTable('amount_test', {
        amount: irrAmount('amount').notNull(),
      }),
    )
    expect(columns.amount.getSQLType()).toBe('bigint')
  })

  it('fixedDecimal is numeric(20,6)', () => {
    const columns = getTableColumns(
      pgTable('rate_test', {
        rate: fixedDecimal('rate').notNull(),
      }),
    )
    expect(columns.rate.getSQLType()).toBe('numeric(20, 6)')
  })

  it('halfOpenRange is tstzrange', () => {
    const columns = getTableColumns(
      pgTable('range_test', {
        period: halfOpenRange('period'),
      }),
    )
    expect(columns.period.getSQLType()).toContain('tstzrange')
  })

  it('uuidv7 default is hasDefault (optional on insert)', () => {
    const columns = getTableColumns(buildIdTable())
    expect(columns.id.hasDefault).toBe(true)
  })
})