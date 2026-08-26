import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WalletService } from './wallet.service.js'

const mockPool = {
  query: vi.fn(),
  connect: vi.fn(),
}

const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
}

vi.mock('@barghsa/db', () => ({
  getDbPool: () => mockPool,
}))

function makeWalletRow(overrides: Record<string, unknown> = {}) {
  return {
    profile_id: 'profile-1',
    posted_balance: '1000000',
    reserved_balance: '200000',
    version: 1,
    updated_at: new Date('2026-01-01'),
    available_balance: '800000',
    ...overrides,
  }
}

function makeTxRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tx-001',
    wallet_id: 'profile-1',
    type: 'topup',
    amount: '100000',
    state: 'Completed',
    idempotency_key: 'idem-001',
    ref_id: null,
    description: null,
    metadata: null,
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
    ...overrides,
  }
}

/**
 * Helper to mock the executeWalletTx transaction flow.
 * The executeWalletTx method calls in order:
 *   1. BEGIN
 *   2. SELECT ... FOR UPDATE (wallet)
 *   3. SELECT by idempotency_key
 * Then the operation-specific queries follow.
 */
function mockExecuteWalletTxFlow(walletRow: any, idempotencyResult: any[] = []) {
  mockClient.query
    .mockResolvedValueOnce({ rows: [] })           // BEGIN
    .mockResolvedValueOnce({ rows: [walletRow] })  // SELECT ... FOR UPDATE
    .mockResolvedValueOnce({ rows: idempotencyResult }) // idempotency check
  // Caller must add remaining mocks after this
  return mockClient.query
}

describe('WalletService', () => {
  let service: WalletService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new WalletService()
    mockPool.connect.mockResolvedValue(mockClient)
    mockClient.release.mockImplementation(() => {})
    mockClient.query.mockReset()
  })

  describe('getWallet', () => {
    it('returns null when no wallet exists', async () => {
      mockPool.query.mockResolvedValue({ rows: [] })
      const result = await service.getWallet('profile-1')
      expect(result).toBeNull()
    })

    it('returns wallet with derived availableBalance', async () => {
      mockPool.query.mockResolvedValue({ rows: [makeWalletRow()] })
      const result = await service.getWallet('profile-1')
      expect(result).not.toBeNull()
      expect(result!.profileId).toBe('profile-1')
      expect(result!.postedBalance).toBe(1000000n)
      expect(result!.reservedBalance).toBe(200000n)
      expect(result!.availableBalance).toBe(800000n)
    })
  })

  describe('createWallet', () => {
    it('creates a new wallet', async () => {
      mockPool.query.mockResolvedValue({ rows: [makeWalletRow({ version: 0 })] })
      const result = await service.createWallet('profile-1')
      expect(result.profileId).toBe('profile-1')
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO wallets'),
        ['profile-1'],
      )
    })

    it('falls back to getWallet on concurrent insert race', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [makeWalletRow()] })

      const result = await service.createWallet('profile-1')
      expect(result.profileId).toBe('profile-1')
      expect(result.availableBalance).toBe(800000n)
    })

    it('throws if fallback getWallet also returns null', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })

      await expect(service.createWallet('profile-1')).rejects.toThrow(
        'Wallet creation failed despite insert attempt',
      )
    })
  })

  describe('credit', () => {
    it('credits wallet and returns transaction', async () => {
      const wallet = makeWalletRow()
      // mockClient.query sequence for executeWalletTx:
      // 0: BEGIN → no rows
      // 1: SELECT FOR UPDATE → wallet
      // 2: idempotency check → no existing
      // 3: UPDATE wallets → updated wallet
      // 4: INSERT transaction → tx row
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })                    // 0: BEGIN
        .mockResolvedValueOnce({ rows: [wallet] })              // 1: SELECT FOR UPDATE
        .mockResolvedValueOnce({ rows: [] })                    // 2: idempotency check (empty)
        .mockResolvedValueOnce({                                 // 3: UPDATE wallets
          rows: [makeWalletRow({ version: 2, posted_balance: '1100000' })],
        })
        .mockResolvedValueOnce({ rows: [makeTxRow()] })          // 4: INSERT transaction

      const result = await service.credit('profile-1', 100000n, {
        idempotencyKey: 'idem-001',
        type: 'topup',
      })

      expect(result.state).toBe('Completed')
      expect(result.type).toBe('topup')
      // Verify COMMIT was called
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
    })

    it('returns existing transaction on idempotent retry', async () => {
      const wallet = makeWalletRow()
      const existingTx = makeTxRow()

      mockClient.query
        .mockResolvedValueOnce({ rows: [] })                    // 0: BEGIN
        .mockResolvedValueOnce({ rows: [wallet] })              // 1: SELECT FOR UPDATE
        .mockResolvedValueOnce({ rows: [existingTx] })          // 2: idempotency check (FOUND!)

      const result = await service.credit('profile-1', 100000n, {
        idempotencyKey: 'idem-001',
        type: 'topup',
      })

      expect(result.id).toBe('tx-001')
      // No further queries beyond idempotency check
      expect(mockClient.query).toHaveBeenCalledTimes(4) // BEGIN, FOR UPDATE, idempotency check, COMMIT
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
    })

    it('rejects zero or negative credit', async () => {
      await expect(
        service.credit('profile-1', 0n, { idempotencyKey: 'k', type: 'topup' }),
      ).rejects.toThrow('Credit amount must be positive')

      await expect(
        service.credit('profile-1', -100n, { idempotencyKey: 'k', type: 'topup' }),
      ).rejects.toThrow('Credit amount must be positive')
    })
  })

  describe('debit', () => {
    it('rejects insufficient balance', async () => {
      const lowWallet = makeWalletRow({ posted_balance: '50000', reserved_balance: '0' })

      mockClient.query
        .mockResolvedValueOnce({ rows: [] })                    // 0: BEGIN
        .mockResolvedValueOnce({ rows: [lowWallet] })           // 1: SELECT FOR UPDATE
        .mockResolvedValueOnce({ rows: [] })                    // 2: idempotency check

      await expect(
        service.debit('profile-1', 100000n, {
          idempotencyKey: 'idem-002',
          type: 'payment',
        }),
      ).rejects.toThrow('Insufficient balance')
    })
  })

  describe('reserve', () => {
    it('reserves amount', async () => {
      const wallet = makeWalletRow()

      mockClient.query
        .mockResolvedValueOnce({ rows: [] })                    // 0: BEGIN
        .mockResolvedValueOnce({ rows: [wallet] })              // 1: SELECT FOR UPDATE
        .mockResolvedValueOnce({ rows: [] })                    // 2: idempotency check
        .mockResolvedValueOnce({                                 // 3: UPDATE wallets
          rows: [makeWalletRow({ reserved_balance: '250000', version: 2 })],
        })
        .mockResolvedValueOnce({ rows: [makeTxRow({ type: 'reservation', state: 'Reserved' })] }) // 4: INSERT

      const result = await service.reserve('profile-1', 50000n, 'idem-res-1')

      expect(result.type).toBe('reservation')
      expect(result.state).toBe('Reserved')
    })
  })

  describe('getTransactions', () => {
    it('returns empty list when no transactions', async () => {
      mockPool.query.mockResolvedValue({ rows: [] })
      const result = await service.getTransactions('profile-1')
      expect(result).toEqual([])
    })

    it('returns mapped transactions', async () => {
      mockPool.query.mockResolvedValue({ rows: [makeTxRow()] })
      const result = await service.getTransactions('profile-1')
      expect(result).toHaveLength(1)
      const tx = result[0]!
      expect(tx.id).toBe('tx-001')
      expect(tx.amount).toBe(100000n)
    })
  })
})
