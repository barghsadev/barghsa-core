import { describe, it, expect, expectTypeOf } from 'vitest'
import { getTableColumns } from 'drizzle-orm'
import {
  notificationCategoryEnum,
  notificationCategories,
  userNotificationPreferences,
} from './notification-preferences'

describe('notification_categories schema', () => {
  it('has the expected columns', () => {
    const columns = getTableColumns(notificationCategories)
    expect(columns['id']).toBeDefined()
    expect(columns['category']).toBeDefined()
    expect(columns['isMarketing']).toBeDefined()
    expect(columns['description']).toBeDefined()
    expect(columns['createdAt']).toBeDefined()
    expect(columns['updatedAt']).toBeDefined()
  })

  it('has correct types', () => {
    const columns = getTableColumns(notificationCategories)
    expect(columns['id']?.getSQLType()).toBe('uuid')
    expect(columns['category']?.getSQLType()).toBe('notification_category')
  })

  it('category enum has the expected consent classes', () => {
    expect(notificationCategoryEnum.enumValues).toEqual([
      'mandatory_transactional',
      'marketing',
    ])
  })

  it('has notNull on required columns', () => {
    const columns = getTableColumns(notificationCategories)
    expect(columns['category']?.notNull).toBe(true)
    expect(columns['isMarketing']?.notNull).toBe(true)
  })

  it('infers insert/select types', () => {
    type InsertColumns = typeof notificationCategories.$inferInsert
    type SelectColumns = typeof notificationCategories.$inferSelect

    expectTypeOf<InsertColumns>().toHaveProperty('category')
    expectTypeOf<InsertColumns>().toHaveProperty('isMarketing')
    expectTypeOf<SelectColumns>().toHaveProperty('category')
    expectTypeOf<SelectColumns>().toHaveProperty('isMarketing')
    expectTypeOf<SelectColumns>().toHaveProperty('createdAt')
  })
})

describe('user_notification_preferences schema', () => {
  it('has the expected columns', () => {
    const columns = getTableColumns(userNotificationPreferences)
    expect(columns['id']).toBeDefined()
    expect(columns['profileId']).toBeDefined()
    expect(columns['channel']).toBeDefined()
    expect(columns['marketingOptedIn']).toBeDefined()
    expect(columns['consentGrantedAt']).toBeDefined()
    expect(columns['consentRevokedAt']).toBeDefined()
    expect(columns['createdAt']).toBeDefined()
    expect(columns['updatedAt']).toBeDefined()
  })

  it('has correct types', () => {
    const columns = getTableColumns(userNotificationPreferences)
    expect(columns['profileId']?.getSQLType()).toBe('uuid')
    expect(columns['marketingOptedIn']?.getSQLType()).toBe('boolean')
  })

  it('defaults marketing opt-in to false (marketing OFF by default)', () => {
    const columns = getTableColumns(userNotificationPreferences)
    const marketing = columns['marketingOptedIn']
    expect(marketing?.notNull).toBe(true)
    // Drizzle stores the default in the column config; marketing defaults to false.
    expect(String(marketing?.default)).toContain('false')
  })

  it('has notNull on required columns', () => {
    const columns = getTableColumns(userNotificationPreferences)
    expect(columns['profileId']?.notNull).toBe(true)
    expect(columns['channel']?.notNull).toBe(true)
    expect(columns['marketingOptedIn']?.notNull).toBe(true)
  })

  it('infers insert/select types', () => {
    type InsertColumns = typeof userNotificationPreferences.$inferInsert
    type SelectColumns = typeof userNotificationPreferences.$inferSelect

    expectTypeOf<InsertColumns>().toHaveProperty('profileId')
    expectTypeOf<InsertColumns>().toHaveProperty('channel')
    expectTypeOf<InsertColumns>().toHaveProperty('marketingOptedIn')
    expectTypeOf<SelectColumns>().toHaveProperty('profileId')
    expectTypeOf<SelectColumns>().toHaveProperty('channel')
    expectTypeOf<SelectColumns>().toHaveProperty('marketingOptedIn')
    expectTypeOf<SelectColumns>().toHaveProperty('consentGrantedAt')
  })
})
