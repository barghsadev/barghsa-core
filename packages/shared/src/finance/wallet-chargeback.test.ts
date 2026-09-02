import { describe, expect, it } from 'vitest'
import {
  CHARGEBACK_MATCH_METHODS,
  CHARGEBACK_NOTIFICATION_TYPES,
  ONLINE_TOPUP_CREDIT_IDEMPOTENCY_PREFIX,
  WALLET_CHARGEBACK_EVENT_CONSTRAINT,
  WALLET_CHARGEBACK_EVENT_STATUSES,
  WALLET_CHARGEBACK_REASON,
  WALLET_CHARGEBACK_UNRESOLVED_STATUSES,
  chargebackAmountMatchesTopUp,
  chargebackCreditIdempotencyKey,
  chargebackReversalIdempotencyKey,
  isChargebackMatchMethod,
  isChargebackNotificationType,
  isUnresolvedChargebackStatus,
  isWalletChargebackEventStatus,
  matchChargebackToTopUp,
  parseChargebackNotification,
  parseChargebackNotificationJson,
  topUpAuthority,
  topUpPendingTransactionId,
  type ChargebackTopUpCandidate,
  type ParsedChargebackNotification,
} from './wallet-chargeback.js'

const PENDING_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
const CREDIT_ID = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb'
const OTHER_CREDIT_ID = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc'
const WALLET_ID = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd'
const AUTHORITY = 'A00000000000000000000000000000000001'
const PROVIDER_REF = 'psp-ref-1'
const AMOUNT = 250_000n

function notification(
  overrides: Partial<ParsedChargebackNotification> = {},
): ParsedChargebackNotification {
  return {
    type: 'chargeback',
    merchantId: 'merchant-1',
    merchantOrderId: PENDING_ID,
    providerRefId: PROVIDER_REF,
    authority: AUTHORITY,
    amountIrR: AMOUNT,
    reason: WALLET_CHARGEBACK_REASON,
    ...overrides,
  }
}

function candidate(
  overrides: Partial<ChargebackTopUpCandidate> = {},
): ChargebackTopUpCandidate {
  return {
    id: CREDIT_ID,
    walletId: WALLET_ID,
    type: 'topup',
    amount: AMOUNT,
    state: 'Completed',
    refId: PROVIDER_REF,
    idempotencyKey: chargebackCreditIdempotencyKey(PENDING_ID),
    metadata: {
      channel: 'online',
      pendingTransactionId: PENDING_ID,
      authority: AUTHORITY,
    },
    ...overrides,
  }
}

describe('wallet chargeback helpers (T-04.2.04.02)', () => {
  it('names event statuses, match methods, and the unique event-id index', () => {
    expect(WALLET_CHARGEBACK_REASON).toBe('provider chargeback')
    expect(WALLET_CHARGEBACK_EVENT_CONSTRAINT).toBe('uq_wallet_chargeback_event_id')
    expect(CHARGEBACK_NOTIFICATION_TYPES).toEqual(['chargeback', 'reversed', 'reversal'])
    expect(CHARGEBACK_MATCH_METHODS).toEqual([
      'merchant_order_id',
      'provider_ref_id',
      'authority',
    ])
    expect(WALLET_CHARGEBACK_EVENT_STATUSES).toEqual([
      'processing',
      'reversed',
      'unmatched',
      'unresolved',
      'duplicate',
    ])
    expect(WALLET_CHARGEBACK_UNRESOLVED_STATUSES).toEqual(['unmatched', 'unresolved'])
    expect(isChargebackNotificationType('chargeback')).toBe(true)
    expect(isChargebackNotificationType('paid')).toBe(false)
    expect(isChargebackMatchMethod('authority')).toBe(true)
    expect(isWalletChargebackEventStatus('unmatched')).toBe(true)
    expect(isUnresolvedChargebackStatus('unmatched')).toBe(true)
    expect(isUnresolvedChargebackStatus('reversed')).toBe(false)
  })

  it('derives credit and reversal idempotency keys from the pending id / event id', () => {
    expect(ONLINE_TOPUP_CREDIT_IDEMPOTENCY_PREFIX).toBe('wallet-online-topup-credit:')
    expect(chargebackCreditIdempotencyKey(PENDING_ID)).toBe(
      `wallet-online-topup-credit:${PENDING_ID}`,
    )
    expect(chargebackReversalIdempotencyKey('evt-1')).toBe(
      'wallet-chargeback-reversal:evt-1',
    )
  })

  it('parses a signed-body JSON chargeback notification', () => {
    const parsed = parseChargebackNotificationJson(
      JSON.stringify({
        type: 'CHARGEBACK',
        merchantId: ' merchant-1',
        merchantOrderId: PENDING_ID,
        providerRefId: PROVIDER_REF,
        authority: AUTHORITY,
        amountIrR: '250000',
        reason: 'card dispute',
      }),
    )
    expect(parsed).toEqual({
      ok: true,
      notification: {
        type: 'chargeback',
        merchantId: 'merchant-1',
        merchantOrderId: PENDING_ID,
        providerRefId: PROVIDER_REF,
        authority: AUTHORITY,
        amountIrR: AMOUNT,
        reason: 'card dispute',
      },
    })
  })

  it('accepts reversed/reversal types and defaults the reason', () => {
    expect(
      parseChargebackNotification({
        type: 'reversed',
        merchantId: 'm',
        amountIrR: 1,
      }),
    ).toMatchObject({
      ok: true,
      notification: { type: 'reversed', reason: WALLET_CHARGEBACK_REASON },
    })
    expect(
      parseChargebackNotification({
        type: 'reversal',
        merchantId: 'm',
        amountIrR: 1,
        providerRefId: 'ref-9',
      }),
    ).toMatchObject({ ok: true, notification: { type: 'reversal' } })
  })

  it('rejects malformed JSON, unknown types, and invalid amounts', () => {
    expect(parseChargebackNotificationJson('{')).toEqual({
      ok: false,
      reason: 'invalid_json',
    })
    expect(parseChargebackNotification({ type: 'paid', merchantId: 'm', amountIrR: 1 })).toEqual({
      ok: false,
      reason: 'invalid_type',
    })
    expect(
      parseChargebackNotification({
        type: 'chargeback',
        merchantId: 'm',
        amountIrR: 0,
      }),
    ).toEqual({ ok: false, reason: 'invalid_amount' })
    expect(
      parseChargebackNotification({
        type: 'chargeback',
        merchantId: 'm',
        amountIrR: 100,
        merchantOrderId: 'not-a-uuid',
      }),
    ).toEqual({ ok: false, reason: 'invalid_merchant_order_id' })
    expect(parseChargebackNotification(null)).toEqual({
      ok: false,
      reason: 'invalid_shape',
    })
  })

  it('maps a unique credit by pending order id first', () => {
    const match = matchChargebackToTopUp(notification(), [
      candidate(),
      candidate({
        id: OTHER_CREDIT_ID,
        refId: PROVIDER_REF,
        idempotencyKey: 'other',
        metadata: { authority: AUTHORITY },
      }),
    ])
    expect(match).toEqual({
      original: candidate(),
      method: 'merchant_order_id',
    })
  })

  it('uses provider ref, then authority, only when stronger locators are absent', () => {
    const byRef = matchChargebackToTopUp(
      notification({ merchantOrderId: null, authority: null }),
      [candidate({ idempotencyKey: 'credit-other', metadata: {} })],
    )
    expect(byRef?.method).toBe('provider_ref_id')
    expect(byRef?.original.id).toBe(CREDIT_ID)

    const byAuthority = matchChargebackToTopUp(
      notification({
        merchantOrderId: null,
        providerRefId: null,
      }),
      [
        candidate({
          refId: null,
          idempotencyKey: 'credit-other',
          metadata: { gateway: { authority: AUTHORITY } },
        }),
      ],
    )
    expect(byAuthority?.method).toBe('authority')
  })

  it('maps an authority-only notification when refId is a distinct provider capture ref', () => {
    const credit = candidate()
    expect(credit.refId).toBe(PROVIDER_REF)
    expect(credit.refId).not.toBe(AUTHORITY)

    const match = matchChargebackToTopUp(
      notification({
        merchantOrderId: null,
        providerRefId: null,
      }),
      [credit],
    )
    expect(match).toEqual({ original: credit, method: 'authority' })
  })

  it('does not fall through when a present order id does not match', () => {
    expect(
      matchChargebackToTopUp(
        notification({ merchantOrderId: 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee' }),
        [candidate()],
      ),
    ).toBeNull()
  })

  it('does not map an ambiguous or amount-mismatched set', () => {
    expect(
      matchChargebackToTopUp(
        notification({ merchantOrderId: null, authority: null }),
        [
          candidate(),
          candidate({ id: OTHER_CREDIT_ID, idempotencyKey: 'other-key' }),
        ],
      ),
    ).toBeNull()
    expect(
      matchChargebackToTopUp(notification({ amountIrR: 1n }), [candidate()]),
    ).toBeNull()
    expect(
      matchChargebackToTopUp(notification(), [
        candidate({ type: 'payment' }),
      ]),
    ).toBeNull()
    expect(
      matchChargebackToTopUp(notification(), [
        candidate({ state: 'Pending' }),
      ]),
    ).toBeNull()
  })

  it('reads pending id and authority from credit metadata', () => {
    expect(topUpPendingTransactionId(candidate())).toBe(PENDING_ID)
    expect(topUpAuthority(candidate())).toBe(AUTHORITY)
    expect(topUpAuthority(candidate({ refId: null }))).toBe(AUTHORITY)
    expect(
      topUpAuthority(
        candidate({
          refId: PROVIDER_REF,
          metadata: { gateway: { authority: 'auth-from-gateway' } },
        }),
      ),
    ).toBe('auth-from-gateway')
    expect(topUpAuthority(candidate({ metadata: {} }))).toBe(PROVIDER_REF)
    expect(chargebackAmountMatchesTopUp(AMOUNT, AMOUNT)).toBe(true)
    expect(chargebackAmountMatchesTopUp(AMOUNT, -AMOUNT)).toBe(true)
    expect(chargebackAmountMatchesTopUp(AMOUNT, 1n)).toBe(false)
  })
})
