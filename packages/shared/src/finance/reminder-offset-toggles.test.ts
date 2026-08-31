import { describe, it, expect } from 'vitest'
import { SERVICE_DUE_PERIOD_TYPES } from './service-due-periods.js'
import { INVOICE_REMINDER_OFFSETS } from './reminder-schedule.js'
import {
  REMINDER_OFFSET_TOGGLE_ERRORS,
  REMINDER_OFFSET_TOGGLE_EVENT,
  REMINDER_OFFSET_TOGGLE_PERMISSION,
  defaultReminderOffsetToggles,
  enabledOffsetsForServiceType,
  mergeReminderOffsetToggles,
  serviceTypesWithNoEnabledOffsets,
  parseReminderOffsetToggleBody,
} from './reminder-offset-toggles.js'

describe('reminder offset toggles contract (T-04.1.04.05)', () => {
  it('documents the admin permission and audit event', () => {
    expect(REMINDER_OFFSET_TOGGLE_PERMISSION).toBe('admin:finance:invoices:reminder-offsets')
    expect(REMINDER_OFFSET_TOGGLE_EVENT).toBe('invoice.reminder_offset.toggle')
  })

  it('defaults every canonical offset on for every service type', () => {
    const defaults = defaultReminderOffsetToggles()
    expect(defaults).toHaveLength(SERVICE_DUE_PERIOD_TYPES.length * INVOICE_REMINDER_OFFSETS.length)
    expect(defaults.every((row) => row.enabled)).toBe(true)
    expect(defaults.filter((row) => row.serviceType === 'electricity').map((row) => row.offset)).toEqual(
      [...INVOICE_REMINDER_OFFSETS],
    )
  })

  it('overlays stored disabled rows without dropping missing pairs', () => {
    const merged = mergeReminderOffsetToggles([
      { serviceType: 'electricity', offset: -7, enabled: false },
      { serviceType: 'manual', offset: 0, enabled: false },
      { serviceType: 'unknown', offset: -7, enabled: false },
      { serviceType: 'electricity', offset: 99, enabled: false },
    ])
    expect(merged.find((row) => row.serviceType === 'electricity' && row.offset === -7)?.enabled).toBe(
      false,
    )
    expect(merged.find((row) => row.serviceType === 'electricity' && row.offset === -3)?.enabled).toBe(
      true,
    )
    expect(merged.find((row) => row.serviceType === 'manual' && row.offset === 0)?.enabled).toBe(false)
    expect(merged.find((row) => row.serviceType === 'saving_plan' && row.offset === -7)?.enabled).toBe(
      true,
    )
  })

  it('returns remaining offsets for a service type and the full set when type is unknown', () => {
    const toggles = mergeReminderOffsetToggles([
      { serviceType: 'electricity', offset: -7, enabled: false },
      { serviceType: 'electricity', offset: 7, enabled: false },
    ])
    expect(enabledOffsetsForServiceType(toggles, 'electricity')).toEqual([-3, -1, 0, 1])
    expect(enabledOffsetsForServiceType(toggles, 'saving_plan')).toEqual([...INVOICE_REMINDER_OFFSETS])
    expect(enabledOffsetsForServiceType(toggles, null)).toEqual([...INVOICE_REMINDER_OFFSETS])
    expect(enabledOffsetsForServiceType(toggles, 'hardware')).toEqual([...INVOICE_REMINDER_OFFSETS])
  })

  it('lists only service types whose entire offset set is disabled', () => {
    expect(serviceTypesWithNoEnabledOffsets(defaultReminderOffsetToggles())).toEqual([])
    const electricityOff = mergeReminderOffsetToggles(
      INVOICE_REMINDER_OFFSETS.map((offset) => ({
        serviceType: 'electricity',
        offset,
        enabled: false,
      })),
    )
    expect(serviceTypesWithNoEnabledOffsets(electricityOff)).toEqual(['electricity'])
    expect(enabledOffsetsForServiceType(electricityOff, 'saving_plan')).toEqual([
      ...INVOICE_REMINDER_OFFSETS,
    ])
    const reenabled = mergeReminderOffsetToggles([
      ...INVOICE_REMINDER_OFFSETS.map((offset) => ({
        serviceType: 'electricity',
        offset,
        enabled: false,
      })),
      { serviceType: 'electricity', offset: 0, enabled: true },
    ])
    expect(serviceTypesWithNoEnabledOffsets(reenabled)).toEqual([])
  })
})

describe('parseReminderOffsetToggleBody', () => {
  it('accepts a canonical toggle write', () => {
    expect(
      parseReminderOffsetToggleBody({
        serviceType: 'consultation',
        offset: -3,
        enabled: false,
      }),
    ).toEqual({
      ok: true,
      value: { serviceType: 'consultation', offset: -3, enabled: false },
    })
  })

  it('rejects missing or invalid fields', () => {
    expect(parseReminderOffsetToggleBody(null).ok).toBe(false)
    expect(parseReminderOffsetToggleBody({}).ok).toBe(false)
    const badType = parseReminderOffsetToggleBody({
      serviceType: 'hardware',
      offset: -7,
      enabled: true,
    })
    expect(badType.ok).toBe(false)
    if (!badType.ok) {
      expect(badType.issues).toContain(REMINDER_OFFSET_TOGGLE_ERRORS.BAD_SERVICE_TYPE())
    }
    const badOffset = parseReminderOffsetToggleBody({
      serviceType: 'electricity',
      offset: 2,
      enabled: true,
    })
    expect(badOffset.ok).toBe(false)
    if (!badOffset.ok) {
      expect(badOffset.issues).toContain(REMINDER_OFFSET_TOGGLE_ERRORS.BAD_OFFSET())
    }
    const badEnabled = parseReminderOffsetToggleBody({
      serviceType: 'electricity',
      offset: 0,
      enabled: 'yes',
    })
    expect(badEnabled.ok).toBe(false)
    if (!badEnabled.ok) {
      expect(badEnabled.issues).toContain(REMINDER_OFFSET_TOGGLE_ERRORS.BAD_ENABLED())
    }
  })
})
