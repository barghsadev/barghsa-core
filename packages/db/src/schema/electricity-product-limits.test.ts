import { describe, it, expect, expectTypeOf } from 'vitest'
import { getTableColumns } from 'drizzle-orm'
import { electricityProductLimits } from './electricity-product-limits'

describe('electricity_product_limits schema', () => {
  it('has the expected columns', () => {
    const columns = getTableColumns(electricityProductLimits)
    expect(columns['id']).toBeDefined()
    expect(columns['productId']).toBeDefined()
    expect(columns['minKwh']).toBeDefined()
    expect(columns['maxKwh']).toBeDefined()
    expect(columns['createdAt']).toBeDefined()
    expect(columns['updatedAt']).toBeDefined()
  })

  it('has correct column types', () => {
    const columns = getTableColumns(electricityProductLimits)
    expect(columns['productId']?.getSQLType()).toBe('uuid')
    expect(columns['minKwh']?.getSQLType()).toBe('bigint')
    expect(columns['maxKwh']?.getSQLType()).toBe('bigint')
  })

  it('includes base columns', () => {
    const columns = getTableColumns(electricityProductLimits)
    expect(columns['id']?.getSQLType()).toBe('uuid')
  })

  it('infers insert/select types', () => {
    type InsertColumns = typeof electricityProductLimits.$inferInsert
    type SelectColumns = typeof electricityProductLimits.$inferSelect

    expectTypeOf<InsertColumns>().toHaveProperty('productId')
    expectTypeOf<InsertColumns>().toHaveProperty('minKwh')
    expectTypeOf<InsertColumns>().toHaveProperty('maxKwh')
    expectTypeOf<InsertColumns>().toHaveProperty('id')

    expectTypeOf<SelectColumns>().toHaveProperty('productId')
    expectTypeOf<SelectColumns>().toHaveProperty('minKwh')
    expectTypeOf<SelectColumns>().toHaveProperty('maxKwh')
    expectTypeOf<SelectColumns>().toHaveProperty('id')
    expectTypeOf<SelectColumns>().toHaveProperty('createdAt')
    expectTypeOf<SelectColumns>().toHaveProperty('updatedAt')
  })

  it('has notNull constraints on required columns', () => {
    const columns = getTableColumns(electricityProductLimits)
    expect(columns['productId']?.notNull).toBe(true)
    expect(columns['minKwh']?.notNull).toBe(true)
    expect(columns['maxKwh']?.notNull).toBe(true)
  })

  it('has correct default values for minKwh and maxKwh', () => {
    const columns = getTableColumns(electricityProductLimits)
    expect(columns['minKwh']?.hasDefault).toBe(true)
    expect(columns['maxKwh']?.hasDefault).toBe(true)
  })
})
