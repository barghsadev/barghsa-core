import { describe, it, expect, expectTypeOf } from 'vitest'
import { getTableColumns } from 'drizzle-orm'
import { productCategories, productCategoryEnum } from './product-categories'

describe('product_categories schema', () => {
  it('has the expected columns', () => {
    const columns = getTableColumns(productCategories)
    expect(columns['id']).toBeDefined()
    expect(columns['productId']).toBeDefined()
    expect(columns['category']).toBeDefined()
    expect(columns['createdAt']).toBeDefined()
    expect(columns['updatedAt']).toBeDefined()
  })

  it('has correct column types', () => {
    const columns = getTableColumns(productCategories)
    expect(columns['productId']?.getSQLType()).toBe('uuid')
    expect(columns['category']?.getSQLType()).toBe('product_category')
  })

  it('includes base columns', () => {
    const columns = getTableColumns(productCategories)
    expect(columns['id']?.getSQLType()).toBe('uuid')
  })

  it('infers insert/select types', () => {
    type InsertColumns = typeof productCategories.$inferInsert
    type SelectColumns = typeof productCategories.$inferSelect

    expectTypeOf<InsertColumns>().toHaveProperty('productId')
    expectTypeOf<InsertColumns>().toHaveProperty('category')
    expectTypeOf<InsertColumns>().toHaveProperty('id')

    expectTypeOf<SelectColumns>().toHaveProperty('productId')
    expectTypeOf<SelectColumns>().toHaveProperty('category')
    expectTypeOf<SelectColumns>().toHaveProperty('id')
    expectTypeOf<SelectColumns>().toHaveProperty('createdAt')
    expectTypeOf<SelectColumns>().toHaveProperty('updatedAt')
  })

  it('has notNull constraints on required columns', () => {
    const columns = getTableColumns(productCategories)
    expect(columns['productId']?.notNull).toBe(true)
    expect(columns['category']?.notNull).toBe(true)
  })

  it('product_category enum has the expected values', () => {
    const expected = [
      'electricity_generation_station_consultation',
      'electricity_saving_certificate_consultation',
      'thermal_electricity',
      'green_electricity',
      'free_market_electricity',
      'energy_saving_electricity',
    ]
    expect(productCategoryEnum.enumValues).toEqual(expected)
  })
})
