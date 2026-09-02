import { describe, it, expect } from 'vitest'
import {
  NOTIFICATION_TYPE_REGISTRY,
  classifyNotificationType,
  isSecurityPinnedNotification,
  getNotificationTypeDefinition,
} from './notification-registry.js'

describe('notification type registry & classification (T-05.03.01)', () => {
  describe('classifyNotificationType', () => {
    it('classifies OTP / authentication / security events as immediate', () => {
      expect(classifyNotificationType('auth.otp_sent')).toBe('immediate')
      expect(classifyNotificationType('auth.password_changed')).toBe('immediate')
      expect(classifyNotificationType('auth.session_revoked')).toBe('immediate')
      expect(classifyNotificationType('auth.new_device_login')).toBe('immediate')
    })

    it('classifies payment, refund and contract-cancellation events as immediate', () => {
      expect(classifyNotificationType('payment.invoice_paid')).toBe('immediate')
      expect(classifyNotificationType('payment.refund_completed')).toBe('immediate')
      expect(classifyNotificationType('payment.refund_failed')).toBe('immediate')
      expect(classifyNotificationType('payment.wallet_topup_completed')).toBe('immediate')
      expect(classifyNotificationType('contract.cancelled')).toBe('immediate')
      expect(classifyNotificationType('contract.changes_requested')).toBe('immediate')
      expect(classifyNotificationType('finance.chargeback_unresolved')).toBe('immediate')
    })

    it('defaults non-security business events to daytime', () => {
      expect(classifyNotificationType('contract.created')).toBe('daytime')
      expect(classifyNotificationType('contract.signed')).toBe('daytime')
      expect(classifyNotificationType('order.submitted')).toBe('daytime')
      expect(classifyNotificationType('ticket.new_reply')).toBe('daytime')
      expect(classifyNotificationType('profile.verification_status')).toBe('daytime')
      expect(classifyNotificationType('marketing.promotion')).toBe('daytime')
      expect(classifyNotificationType('payment.invoice_overdue')).toBe('daytime')
      expect(classifyNotificationType('payment.invoice_reminder')).toBe('daytime')
    })

    it('defaults unknown / unregistered event keys to daytime', () => {
      expect(classifyNotificationType('some.future_event')).toBe('daytime')
      expect(classifyNotificationType('')).toBe('daytime')
    })
  })

  describe('isSecurityPinnedNotification', () => {
    it('marks auth/OTP events as security-pinned', () => {
      expect(isSecurityPinnedNotification('auth.otp_sent')).toBe(true)
      expect(isSecurityPinnedNotification('auth.new_device_login')).toBe(true)
    })

    it('does not mark ordinary daytime events as security-pinned', () => {
      expect(isSecurityPinnedNotification('contract.created')).toBe(false)
      expect(isSecurityPinnedNotification('order.submitted')).toBe(false)
      expect(isSecurityPinnedNotification('marketing.promotion')).toBe(false)
    })

    it('falls back to false for unknown keys', () => {
      expect(isSecurityPinnedNotification('unknown.event')).toBe(false)
    })
  })

  describe('registry integrity', () => {
    it('registers every event with a valid classification', () => {
      for (const def of Object.values(NOTIFICATION_TYPE_REGISTRY)) {
        expect(['immediate', 'daytime']).toContain(def.classification)
        expect(def.category).toBeDefined()
      }
    })

    it('never registers a security-pinned type as daytime', () => {
      for (const [key, def] of Object.entries(NOTIFICATION_TYPE_REGISTRY)) {
        if (def.securityPinned) {
          expect(def.classification, `security-pinned ${key} must be immediate`).toBe('immediate')
        }
      }
    })

    it('returns the definition for a registered key and undefined otherwise', () => {
      expect(getNotificationTypeDefinition('auth.otp_sent')?.classification).toBe('immediate')
      expect(getNotificationTypeDefinition('nope.nope')).toBeUndefined()
    })
  })
})
