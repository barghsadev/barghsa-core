import { describe, it, expect, expectTypeOf } from 'vitest'
import { getTableColumns } from 'drizzle-orm'
import { productPriceVersions } from './product-price-versions'

describe('product_price_versions schema', () => {
  it('has the expected columns', () => {
    const columns = getTableColumns(productPriceVersions)
    expect(columns['id']).toBeDefined()
    expect(columns['productId']).toBeDefined()
    expect(columns['price']).toBeDefined()
    expect(columns['vatCategoryOverride']).toBeDefined()
    expect(columns['effectiveFrom']).toBeDefined()
    expect(columns['effectiveUntil']).toBeDefined()
    expect(columns['createdBy']).toBeDefined()
    expect(columns['createdAt']).toBeDefined()
    expect(columns['updatedAt']).toBeDefined()
  })

  it('has correct column types', () => {
    const columns = getTableColumns(productPriceVersions)
    expect(columns['price']?.getSQLType()).toBe('bigint')
    expect(columns['effectiveFrom']?.getSQLType()).toBe('timestamp with time zone')
    expect(columns['createdBy']?.getSQLType()).toBe('text')
    expect(columns['productId']?.getSQLType()).toBe('uuid')
    expect(columns['vatCategoryOverride']?.getSQLType()).toBe('uuid')
  })

  it('includes base columns', () => {
    const columns = getTableColumns(productPriceVersions)
    expect(columns['id']?.getSQLType()).toBe('uuid')
  })

  it('infers insert/select types', () => {
    type InsertColumns = typeof productPriceVersions.$inferInsert
    type SelectColumns = typeof productPriceVersions.$inferSelect

    expectTypeOf<InsertColumns>().toHaveProperty('productId')
    expectTypeOf<InsertColumns>().toHaveProperty('price')
    expectTypeOf<InsertColumns>().toHaveProperty('effectiveFrom')
    expectTypeOf<InsertColumns>().toHaveProperty('createdBy')
    expectTypeOf<InsertColumns>().toHaveProperty('id')
    expectTypeOf<InsertColumns>().toHaveProperty('effectiveUntil')
    expectTypeOf<InsertColumns>().toHaveProperty('vatCategoryOverride')

    expectTypeOf<SelectColumns>().toHaveProperty('productId')
    expectTypeOf<SelectColumns>().toHaveProperty('price')
    expectTypeOf<SelectColumns>().toHaveProperty('effectiveFrom')
    expectTypeOf<SelectColumns>().toHaveProperty('createdBy')
    expectTypeOf<SelectColumns>().toHaveProperty('effectiveUntil')
    expectTypeOf<SelectColumns>().toHaveProperty('vatCategoryOverride')
    expectTypeOf<SelectColumns>().toHaveProperty('createdAt')
    expectTypeOf<SelectColumns>().toHaveProperty('updatedAt')
  })

  it('has notNull constraints on required columns', () => {
    const columns = getTableColumns(productPriceVersions)
    expect(columns['productId']?.notNull).toBe(true)
    expect(columns['price']?.notNull).toBe(true)
    expect(columns['effectiveFrom']?.notNull).toBe(true)
    expect(columns['createdBy']?.notNull).toBe(true)
  })

  it('vatCategoryOverride is nullable', () => {
    const columns = getTableColumns(productPriceVersions)
    expect(columns['vatCategoryOverride']?.notNull).toBe(false)
  })

  it('effectiveUntil is nullable', () => {
    const columns = getTableColumns(productPriceVersions)
    expect(columns['effectiveUntil']?.notNull).toBe(false)
  })
})
