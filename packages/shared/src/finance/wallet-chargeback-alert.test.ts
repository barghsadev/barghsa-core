import { describe, expect, it } from 'vitest'
import { WALLET_CHARGEBACK_REASON } from './wallet-chargeback.js'
import {
  CHARGEBACK_UNRESOLVED_STATUS_LABELS,
  FINANCE_CHARGEBACK_ALERT_BODY_I18N_KEY,
  FINANCE_CHARGEBACK_ALERT_CHANNELS,
  FINANCE_CHARGEBACK_ALERT_DASHBOARD_ROUTE,
  FINANCE_CHARGEBACK_ALERT_EVENT_KEY,
  FINANCE_CHARGEBACK_ALERT_PERMISSION,
  FINANCE_CHARGEBACK_ALERT_ROLE_ID,
  FINANCE_CHARGEBACK_ALERT_TITLE_I18N_KEY,
  FINANCE_CHARGEBACK_WARNING_LIMIT,
  buildFinanceChargebackAlertPayload,
  emptyUnresolvedChargebackWarning,
  financeChargebackAlertIdempotencyKey,
  needsFinanceChargebackAlert,
  summarizeUnresolvedChargebackCounts,
} from './wallet-chargeback-alert.js'

describe('wallet chargeback finance alert helpers (T-04.2.04.03)', () => {
  it('pins the event key, channels, role, and dashboard window', () => {
    expect(FINANCE_CHARGEBACK_ALERT_EVENT_KEY).toBe('finance.chargeback_unresolved')
    expect(FINANCE_CHARGEBACK_ALERT_PERMISSION).toBe(
      'admin:finance:wallet:chargeback-alerts',
    )
    expect(FINANCE_CHARGEBACK_ALERT_ROLE_ID).toBe('role-finance')
    expect(FINANCE_CHARGEBACK_ALERT_CHANNELS).toEqual(['in_app', 'email'])
    expect(FINANCE_CHARGEBACK_ALERT_DASHBOARD_ROUTE).toBe('/admin')
    expect(FINANCE_CHARGEBACK_ALERT_TITLE_I18N_KEY).toBe(
      'notifications.finance.chargeback_unresolved.title',
    )
    expect(FINANCE_CHARGEBACK_ALERT_BODY_I18N_KEY).toBe(
      'notifications.finance.chargeback_unresolved.body',
    )
    expect(FINANCE_CHARGEBACK_WARNING_LIMIT).toBe(20)
    expect(CHARGEBACK_UNRESOLVED_STATUS_LABELS.unmatched.en).toContain('unmatched')
    expect(CHARGEBACK_UNRESOLVED_STATUS_LABELS.unresolved.fa).toContain('برگشت')
  })

  it('alerts only unmatched and reversal-failed chargebacks', () => {
    expect(needsFinanceChargebackAlert('unmatched')).toBe(true)
    expect(needsFinanceChargebackAlert('unresolved')).toBe(true)
    expect(needsFinanceChargebackAlert('reversed')).toBe(false)
    expect(needsFinanceChargebackAlert('processing')).toBe(false)
    expect(needsFinanceChargebackAlert('duplicate')).toBe(false)
  })

  it('scopes the outbox idempotency key to event + recipient profile', () => {
    expect(financeChargebackAlertIdempotencyKey('evt-1', 'profile-a')).toBe(
      'finance.chargeback_unresolved:evt-1:profile-a',
    )
  })

  it('builds the template payload from the verified notification', () => {
    const payload = buildFinanceChargebackAlertPayload({
      eventId: 'evt-1',
      status: 'unmatched',
      walletId: null,
      originalTransactionId: null,
      notification: {
        type: 'chargeback',
        merchantId: 'm-1',
        merchantOrderId: null,
        providerRefId: 'psp-1',
        authority: null,
        amountIrR: 250_000n,
        reason: WALLET_CHARGEBACK_REASON,
      },
    })
    expect(payload).toEqual({
      event_id: 'evt-1',
      status: 'unmatched',
      status_label_fa: CHARGEBACK_UNRESOLVED_STATUS_LABELS.unmatched.fa,
      status_label_en: CHARGEBACK_UNRESOLVED_STATUS_LABELS.unmatched.en,
      amount_irr: '250000',
      wallet_id: '',
      original_transaction_id: '',
      reason: WALLET_CHARGEBACK_REASON,
      link_route: '/admin',
    })
  })

  it('summarizes unmatched vs reversal-failed counts for the dashboard', () => {
    expect(emptyUnresolvedChargebackWarning()).toEqual({
      count: 0,
      unmatchedCount: 0,
      reversalFailedCount: 0,
      items: [],
    })
    expect(
      summarizeUnresolvedChargebackCounts([
        { status: 'unmatched', n: 2 },
        { status: 'unresolved', n: 3 },
      ]),
    ).toEqual({ count: 5, unmatchedCount: 2, reversalFailedCount: 3 })
  })
})
