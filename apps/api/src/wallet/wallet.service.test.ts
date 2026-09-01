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

  describe('credit (T-04.2.01.03)', () => {
    /**
     * Query sequence for a first-time credit:
     *   0: BEGIN
     *   1: SELECT … FOR UPDATE
     *   2: SELECT by idempotency_key
     *   3: INSERT wallet_transactions
     *   4. UPDATE wallets … applyPostedBalanceDelta
     *      (posted_balance + amount, version + 1,
     *      WHERE version = expectedVersion AND posted_balance >= 0)
     *   5: COMMIT
     */
    it('inserts a Completed ledger row and updates postedBalance under version + postedBalance >= 0', async () => {
      const wallet = makeWalletRow()
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [makeTxRow()] })
        .mockResolvedValueOnce({
          rows: [makeWalletRow({ version: 2, posted_balance: '1100000' })],
        })

      const result = await service.credit(
        'profile-1',
        100000n,
        { type: 'topup', refId: 'evt-1', description: 'online top-up' },
        'idem-001',
      )

      expect(result.state).toBe('Completed')
      expect(result.type).toBe('topup')
      expect(result.amount).toBe(100000n)

      const insertCall = mockClient.query.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO wallet_transactions'),
      )
      expect(insertCall).toBeDefined()
      expect(insertCall![0]).toContain("'Completed'")
      expect(insertCall![1]).toEqual([
        'profile-1',
        'topup',
        100000n,
        'idem-001',
        'evt-1',
        'online top-up',
        null,
      ])

      const updateCall = mockClient.query.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE wallets'),
      )
      expect(updateCall).toBeDefined()
      expect(updateCall![0]).toContain('posted_balance = posted_balance + $1')
      expect(updateCall![0]).toContain('version = version + 1')
      expect(updateCall![0]).toMatch(/version = \$3/)
      expect(updateCall![0]).toContain('posted_balance >= 0')
      expect(updateCall![1]).toEqual([100000n, 'profile-1', 1])

      expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
    })

    it('inserts the ledger row against the wallet row canonical profile_id', async () => {
      const canonical = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
      const wallet = makeWalletRow({ profile_id: canonical })
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [makeTxRow({ wallet_id: canonical })] })
        .mockResolvedValueOnce({
          rows: [makeWalletRow({ profile_id: canonical, version: 2, posted_balance: '1100000' })],
        })

      await service.credit(
        canonical.toUpperCase(),
        100000n,
        { type: 'topup', refId: 'evt-1', description: 'online top-up' },
        'idem-canonical-insert',
      )

      const insertCall = mockClient.query.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO wallet_transactions'),
      )
      expect(insertCall).toBeDefined()
      expect(insertCall![1][0]).toBe(canonical)
    })

    it('returns the existing transaction on idempotent retry without mutating the wallet', async () => {
      const wallet = makeWalletRow()
      const existingTx = makeTxRow()

      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [existingTx] })

      const result = await service.credit(
        'profile-1',
        100000n,
        { type: 'topup' },
        'idem-001',
      )

      expect(result.id).toBe('tx-001')
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
      expect(
        mockClient.query.mock.calls.some(
          (c) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE wallets'),
        ),
      ).toBe(false)
    })

    it('treats uppercase and lowercase walletId spellings as the same owner on retry', async () => {
      const canonical = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
      const wallet = makeWalletRow({ profile_id: canonical })
      const existingTx = makeTxRow({ wallet_id: canonical, idempotency_key: 'idem-case' })

      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [existingTx] })

      const result = await service.credit(
        canonical.toUpperCase(),
        100000n,
        { type: 'topup' },
        'idem-case',
      )

      expect(result.id).toBe('tx-001')
      expect(result.walletId).toBe(canonical)
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
      expect(
        mockClient.query.mock.calls.some(
          (c) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE wallets'),
        ),
      ).toBe(false)
    })

    it('rejects a colliding idempotency key owned by another wallet', async () => {
      const wallet = makeWalletRow()
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [makeTxRow({ wallet_id: 'profile-other' })] })

      await expect(
        service.credit('profile-1', 100000n, { type: 'topup' }, 'idem-001'),
      ).rejects.toThrow('Idempotency key already used for a different wallet')
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    })

    it('rejects zero or negative credit without opening a transaction', async () => {
      await expect(
        service.credit('profile-1', 0n, { type: 'topup' }, 'k'),
      ).rejects.toThrow('Credit amount must be positive')

      await expect(
        service.credit('profile-1', -100n, { type: 'topup' }, 'k'),
      ).rejects.toThrow('Credit amount must be positive')

      expect(mockPool.connect).not.toHaveBeenCalled()
    })

    it('rejects a blank idempotency key', async () => {
      await expect(
        service.credit('profile-1', 100n, { type: 'topup' }, '   '),
      ).rejects.toThrow('Idempotency key is required')
      expect(mockPool.connect).not.toHaveBeenCalled()
    })

    it('rejects a non-credit ledger type', async () => {
      await expect(
        service.credit(
          'profile-1',
          100n,
          { type: 'payment' } as unknown as { type: 'topup' },
          'k',
        ),
      ).rejects.toThrow('Credit type must be one of')
      expect(mockPool.connect).not.toHaveBeenCalled()
    })

    it('throws NotFound when the wallet row is missing', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })

      await expect(
        service.credit('missing', 100n, { type: 'topup' }, 'k'),
      ).rejects.toThrow('Wallet not found: missing')
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    })

    it('rejects the credit when UPDATE matches no row (postedBalance < 0)', async () => {
      const wallet = makeWalletRow({ posted_balance: '-1' })
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [makeTxRow()] })
        .mockResolvedValueOnce({ rows: [] })

      await expect(
        service.credit('profile-1', 100000n, { type: 'topup' }, 'idem-001'),
      ).rejects.toThrow('version mismatch or postedBalance < 0')
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
      const updateCall = mockClient.query.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE wallets'),
      )
      expect(updateCall).toBeDefined()
      expect(updateCall![0]).toContain('posted_balance >= 0')
      expect(updateCall![0]).toMatch(/version = \$3/)
    })

    it('rejects the credit when UPDATE matches no row (version mismatch)', async () => {
      const wallet = makeWalletRow()
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [makeTxRow()] })
        .mockResolvedValueOnce({ rows: [] })

      await expect(
        service.credit('profile-1', 100000n, { type: 'topup' }, 'idem-001'),
      ).rejects.toThrow('version mismatch or postedBalance < 0')
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
      const updateCall = mockClient.query.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE wallets'),
      )
      expect(updateCall).toBeDefined()
      expect(updateCall![0]).toContain('posted_balance >= 0')
    })

    it('returns the committed ledger row when INSERT races on the unique idempotency index', async () => {
      const wallet = makeWalletRow()
      const duplicate = Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'idx_wallet_tx_idempotency',
      })
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(duplicate)
      mockPool.query.mockResolvedValue({ rows: [makeTxRow()] })

      const result = await service.credit(
        'profile-1',
        100000n,
        { type: 'topup' },
        'idem-001',
      )

      expect(result.id).toBe('tx-001')
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('idempotency_key'),
        ['idem-001'],
      )
    })

    it('returns the committed row on unique-index race when retry uses a UUID spelling variant', async () => {
      const canonical = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
      const wallet = makeWalletRow({ profile_id: canonical })
      const duplicate = Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'idx_wallet_tx_idempotency',
      })
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(duplicate)
      mockPool.query.mockResolvedValue({
        rows: [makeTxRow({ wallet_id: canonical, idempotency_key: 'idem-case-race' })],
      })

      const result = await service.credit(
        canonical.toUpperCase(),
        100000n,
        { type: 'topup' },
        'idem-case-race',
      )

      expect(result.id).toBe('tx-001')
      expect(result.walletId).toBe(canonical)
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    })

    it('rejects credit that reuses a debit idempotency key without mutating the wallet', async () => {
      const wallet = makeWalletRow()
      const debitTx = makeTxRow({ type: 'payment', amount: '-100000', state: 'Completed' })
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [debitTx] })

      await expect(
        service.credit('profile-1', 100000n, { type: 'topup' }, 'idem-001'),
      ).rejects.toThrow('Idempotency key already used for a different wallet operation')
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
      expect(
        mockClient.query.mock.calls.some(
          (c) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE wallets'),
        ),
      ).toBe(false)
    })

    it('rejects credit that reuses a reservation idempotency key', async () => {
      const wallet = makeWalletRow()
      const reservation = makeTxRow({
        type: 'reservation',
        amount: '100000',
        state: 'Reserved',
      })
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [reservation] })

      await expect(
        service.credit('profile-1', 100000n, { type: 'topup' }, 'idem-001'),
      ).rejects.toThrow('Idempotency key already used for a different wallet operation')
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    })

    it('rejects a same-key credit with a different amount', async () => {
      const wallet = makeWalletRow()
      const existingTx = makeTxRow({ type: 'topup', amount: '100000', state: 'Completed' })
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [existingTx] })

      await expect(
        service.credit('profile-1', 200000n, { type: 'topup' }, 'idem-001'),
      ).rejects.toThrow('Idempotency key already used for a different wallet operation')
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    })

    it('rejects a same-key credit with a different ledger type', async () => {
      const wallet = makeWalletRow()
      const existingTx = makeTxRow({ type: 'topup', amount: '100000', state: 'Completed' })
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [existingTx] })

      await expect(
        service.credit('profile-1', 100000n, { type: 'refund' }, 'idem-001'),
      ).rejects.toThrow('Idempotency key already used for a different wallet operation')
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    })

    it('rejects a same-key credit with a different refId', async () => {
      const wallet = makeWalletRow()
      const existingTx = makeTxRow({
        type: 'topup',
        amount: '100000',
        state: 'Completed',
        ref_id: 'evt-1',
      })
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [existingTx] })

      await expect(
        service.credit('profile-1', 100000n, { type: 'topup', refId: 'evt-2' }, 'idem-001'),
      ).rejects.toThrow('Idempotency key already used for a different wallet operation')
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    })

    it('rejects unique-index race recovery when the existing row is a debit', async () => {
      const wallet = makeWalletRow()
      const duplicate = Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'idx_wallet_tx_idempotency',
      })
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(duplicate)
      mockPool.query.mockResolvedValue({
        rows: [makeTxRow({ type: 'payment', amount: '-100000', state: 'Completed' })],
      })

      await expect(
        service.credit('profile-1', 100000n, { type: 'topup' }, 'idem-001'),
      ).rejects.toThrow('Idempotency key already used for a different wallet operation')
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    })

    it('rejects unique-index race recovery when the existing credit has a different amount', async () => {
      const wallet = makeWalletRow()
      const duplicate = Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'idx_wallet_tx_idempotency',
      })
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(duplicate)
      mockPool.query.mockResolvedValue({
        rows: [makeTxRow({ type: 'topup', amount: '50000', state: 'Completed' })],
      })

      await expect(
        service.credit('profile-1', 100000n, { type: 'topup' }, 'idem-001'),
      ).rejects.toThrow('Idempotency key already used for a different wallet operation')
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    })
  })

  describe('debit (T-04.2.01.04)', () => {
    /**
     * Query sequence for a first-time debit:
     *   0: BEGIN
     *   1: SELECT … FOR UPDATE
     *   2: SELECT by idempotency_key
     *   3: UPDATE wallets … reserved_balance += amount (reserve)
     *   4: UPDATE wallets … posted_balance -= amount, reserved_balance -= amount (complete)
     *   5: INSERT wallet_transactions (negative amount, Completed)
     *   6: COMMIT
     */
    it('reserves then completes, inserting a Completed ledger row with a negative amount', async () => {
      const wallet = makeWalletRow()
      const debitTx = makeTxRow({
        type: 'payment',
        amount: '-100000',
        state: 'Completed',
        idempotency_key: 'idem-debit-001',
      })
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [makeWalletRow({ version: 2, reserved_balance: '300000' })],
        })
        .mockResolvedValueOnce({
          rows: [
            makeWalletRow({
              version: 3,
              posted_balance: '900000',
              reserved_balance: '200000',
            }),
          ],
        })
        .mockResolvedValueOnce({ rows: [debitTx] })

      const result = await service.debit(
        'profile-1',
        100000n,
        { type: 'payment', refId: 'inv-1', description: 'invoice settlement' },
        'idem-debit-001',
      )

      expect(result.state).toBe('Completed')
      expect(result.type).toBe('payment')
      expect(result.amount).toBe(-100000n)

      const walletUpdates = mockClient.query.mock.calls.filter(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE wallets'),
      )
      expect(walletUpdates).toHaveLength(2)

      const reserveCall = walletUpdates[0]!
      expect(reserveCall[0]).toContain('reserved_balance = reserved_balance + $1')
      expect(reserveCall[0]).toContain('version = version + 1')
      expect(reserveCall[0]).toContain('(posted_balance - reserved_balance) >= $1')
      expect(reserveCall[1]).toEqual([100000n, 'profile-1', 1])

      const completeCall = walletUpdates[1]!
      expect(completeCall[0]).toContain('posted_balance = posted_balance - $1')
      expect(completeCall[0]).toContain('reserved_balance = reserved_balance - $1')
      expect(completeCall[0]).toContain('reserved_balance >= $1')
      expect(completeCall[0]).toContain('posted_balance >= $1')
      expect(completeCall[1]).toEqual([100000n, 'profile-1', 2])

      const insertCall = mockClient.query.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO wallet_transactions'),
      )
      expect(insertCall).toBeDefined()
      expect(insertCall![0]).toContain("'Completed'")
      expect(insertCall![1]).toEqual([
        'profile-1',
        'payment',
        -100000n,
        'idem-debit-001',
        'inv-1',
        'invoice settlement',
        null,
      ])

      expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
    })

    it('binds reserve, complete, and ledger insert to the wallet row canonical profile_id', async () => {
      const canonical = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
      const wallet = makeWalletRow({ profile_id: canonical })
      const debitTx = makeTxRow({
        wallet_id: canonical,
        type: 'payment',
        amount: '-100000',
        state: 'Completed',
        idempotency_key: 'idem-canonical-debit',
      })
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [makeWalletRow({ profile_id: canonical, version: 2, reserved_balance: '300000' })],
        })
        .mockResolvedValueOnce({
          rows: [
            makeWalletRow({
              profile_id: canonical,
              version: 3,
              posted_balance: '900000',
              reserved_balance: '200000',
            }),
          ],
        })
        .mockResolvedValueOnce({ rows: [debitTx] })

      await service.debit(
        canonical.toUpperCase(),
        100000n,
        { type: 'payment', refId: 'inv-1', description: 'invoice settlement' },
        'idem-canonical-debit',
      )

      const walletUpdates = mockClient.query.mock.calls.filter(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE wallets'),
      )
      expect(walletUpdates).toHaveLength(2)
      expect(walletUpdates[0]![1]).toEqual([100000n, canonical, 1])
      expect(walletUpdates[1]![1]).toEqual([100000n, canonical, 2])

      const insertCall = mockClient.query.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO wallet_transactions'),
      )
      expect(insertCall).toBeDefined()
      expect(insertCall![1][0]).toBe(canonical)
    })

    it('rejects when availableBalance is below the debit amount', async () => {
      const lowWallet = makeWalletRow({ posted_balance: '50000', reserved_balance: '0' })

      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [lowWallet] })
        .mockResolvedValueOnce({ rows: [] })

      await expect(
        service.debit('profile-1', 100000n, { type: 'payment' }, 'idem-002'),
      ).rejects.toThrow('Insufficient balance')
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
      expect(
        mockClient.query.mock.calls.some(
          (c) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE wallets'),
        ),
      ).toBe(false)
    })

    it('rejects when reserved funds leave availableBalance below the debit amount', async () => {
      const wallet = makeWalletRow({ posted_balance: '1000000', reserved_balance: '900000' })

      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [] })

      await expect(
        service.debit('profile-1', 200000n, { type: 'payment' }, 'idem-reserved'),
      ).rejects.toThrow('Insufficient balance: available=100000, required=200000')
      expect(
        mockClient.query.mock.calls.some(
          (c) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE wallets'),
        ),
      ).toBe(false)
    })

    it('returns the existing transaction on idempotent retry without mutating the wallet', async () => {
      const wallet = makeWalletRow()
      const existingTx = makeTxRow({ type: 'payment', amount: '-100000' })

      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [existingTx] })

      const result = await service.debit('profile-1', 100000n, { type: 'payment' }, 'idem-001')

      expect(result.id).toBe('tx-001')
      expect(result.amount).toBe(-100000n)
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
      expect(
        mockClient.query.mock.calls.some(
          (c) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE wallets'),
        ),
      ).toBe(false)
    })

    it('treats uppercase and lowercase walletId spellings as the same owner on retry', async () => {
      const canonical = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
      const wallet = makeWalletRow({ profile_id: canonical })
      const existingTx = makeTxRow({
        wallet_id: canonical,
        type: 'payment',
        amount: '-100000',
        idempotency_key: 'idem-case',
      })

      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [existingTx] })

      const result = await service.debit(
        canonical.toUpperCase(),
        100000n,
        { type: 'payment' },
        'idem-case',
      )

      expect(result.id).toBe('tx-001')
      expect(result.walletId).toBe(canonical)
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
      expect(
        mockClient.query.mock.calls.some(
          (c) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE wallets'),
        ),
      ).toBe(false)
    })

    it('rejects a colliding idempotency key owned by another wallet', async () => {
      const wallet = makeWalletRow()
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [makeTxRow({ wallet_id: 'profile-other' })] })

      await expect(
        service.debit('profile-1', 100000n, { type: 'payment' }, 'idem-001'),
      ).rejects.toThrow('Idempotency key already used for a different wallet')
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    })

    it('rejects debit that reuses a credit idempotency key without mutating the wallet', async () => {
      const wallet = makeWalletRow()
      const creditTx = makeTxRow({ type: 'topup', amount: '100000', state: 'Completed' })
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [creditTx] })

      await expect(
        service.debit('profile-1', 100000n, { type: 'payment' }, 'idem-001'),
      ).rejects.toThrow('Idempotency key already used for a different wallet operation')
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
      expect(
        mockClient.query.mock.calls.some(
          (c) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE wallets'),
        ),
      ).toBe(false)
    })

    it('rejects debit that reuses a reservation idempotency key', async () => {
      const wallet = makeWalletRow()
      const reservation = makeTxRow({
        type: 'reservation',
        amount: '100000',
        state: 'Reserved',
      })
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [reservation] })

      await expect(
        service.debit('profile-1', 100000n, { type: 'payment' }, 'idem-001'),
      ).rejects.toThrow('Idempotency key already used for a different wallet operation')
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    })

    it('rejects a same-key debit with a different amount', async () => {
      const wallet = makeWalletRow()
      const existingTx = makeTxRow({ type: 'payment', amount: '-100000', state: 'Completed' })
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [existingTx] })

      await expect(
        service.debit('profile-1', 200000n, { type: 'payment' }, 'idem-001'),
      ).rejects.toThrow('Idempotency key already used for a different wallet operation')
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    })

    it('rejects a same-key debit with a different ledger type', async () => {
      const wallet = makeWalletRow()
      const existingTx = makeTxRow({ type: 'payment', amount: '-100000', state: 'Completed' })
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [existingTx] })

      await expect(
        service.debit('profile-1', 100000n, { type: 'reversal' }, 'idem-001'),
      ).rejects.toThrow('Idempotency key already used for a different wallet operation')
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    })

    it('rejects a same-key debit with a different refId', async () => {
      const wallet = makeWalletRow()
      const existingTx = makeTxRow({
        type: 'payment',
        amount: '-100000',
        state: 'Completed',
        ref_id: 'inv-1',
      })
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [existingTx] })

      await expect(
        service.debit('profile-1', 100000n, { type: 'payment', refId: 'inv-2' }, 'idem-001'),
      ).rejects.toThrow('Idempotency key already used for a different wallet operation')
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    })

    it('rejects zero or negative debit without opening a transaction', async () => {
      await expect(
        service.debit('profile-1', 0n, { type: 'payment' }, 'k'),
      ).rejects.toThrow('Debit amount must be positive')

      await expect(
        service.debit('profile-1', -100n, { type: 'payment' }, 'k'),
      ).rejects.toThrow('Debit amount must be positive')

      expect(mockPool.connect).not.toHaveBeenCalled()
    })

    it('rejects a blank idempotency key', async () => {
      await expect(
        service.debit('profile-1', 100n, { type: 'payment' }, '   '),
      ).rejects.toThrow('Idempotency key is required')
      expect(mockPool.connect).not.toHaveBeenCalled()
    })

    it('rejects a non-debit ledger type', async () => {
      await expect(
        service.debit(
          'profile-1',
          100n,
          { type: 'topup' } as unknown as { type: 'payment' },
          'k',
        ),
      ).rejects.toThrow('Debit type must be one of')
      expect(mockPool.connect).not.toHaveBeenCalled()
    })

    it('throws NotFound when the wallet row is missing', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })

      await expect(
        service.debit('missing', 100n, { type: 'payment' }, 'k'),
      ).rejects.toThrow('Wallet not found: missing')
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    })

    it('rejects the debit when the reserve UPDATE matches no row', async () => {
      const wallet = makeWalletRow()
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })

      await expect(
        service.debit('profile-1', 100000n, { type: 'payment' }, 'idem-001'),
      ).rejects.toThrow('version mismatch or insufficient availableBalance')
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    })

    it('rejects the debit when the complete UPDATE matches no row', async () => {
      const wallet = makeWalletRow()
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [makeWalletRow({ version: 2, reserved_balance: '300000' })],
        })
        .mockResolvedValueOnce({ rows: [] })

      await expect(
        service.debit('profile-1', 100000n, { type: 'payment' }, 'idem-001'),
      ).rejects.toThrow('version mismatch or reserved/posted shortfall')
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    })

    it('returns the committed ledger row when INSERT races on the unique idempotency index', async () => {
      const wallet = makeWalletRow()
      const duplicate = Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'idx_wallet_tx_idempotency',
      })
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [makeWalletRow({ version: 2, reserved_balance: '300000' })],
        })
        .mockResolvedValueOnce({
          rows: [
            makeWalletRow({
              version: 3,
              posted_balance: '900000',
              reserved_balance: '200000',
            }),
          ],
        })
        .mockRejectedValueOnce(duplicate)
      mockPool.query.mockResolvedValue({
        rows: [makeTxRow({ type: 'payment', amount: '-100000' })],
      })

      const result = await service.debit(
        'profile-1',
        100000n,
        { type: 'payment' },
        'idem-001',
      )

      expect(result.id).toBe('tx-001')
      expect(result.amount).toBe(-100000n)
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('idempotency_key'),
        ['idem-001'],
      )
    })

    it('returns the committed row on unique-index race when retry uses a UUID spelling variant', async () => {
      const canonical = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
      const wallet = makeWalletRow({ profile_id: canonical })
      const duplicate = Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'idx_wallet_tx_idempotency',
      })
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [makeWalletRow({ profile_id: canonical, version: 2, reserved_balance: '300000' })],
        })
        .mockResolvedValueOnce({
          rows: [
            makeWalletRow({
              profile_id: canonical,
              version: 3,
              posted_balance: '900000',
              reserved_balance: '200000',
            }),
          ],
        })
        .mockRejectedValueOnce(duplicate)
      mockPool.query.mockResolvedValue({
        rows: [
          makeTxRow({
            wallet_id: canonical,
            type: 'payment',
            amount: '-100000',
            idempotency_key: 'idem-case-race',
          }),
        ],
      })

      const result = await service.debit(
        canonical.toUpperCase(),
        100000n,
        { type: 'payment' },
        'idem-case-race',
      )

      expect(result.id).toBe('tx-001')
      expect(result.walletId).toBe(canonical)
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    })

    it('rejects unique-index race recovery when the existing row is a credit', async () => {
      const wallet = makeWalletRow()
      const duplicate = Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'idx_wallet_tx_idempotency',
      })
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [makeWalletRow({ version: 2, reserved_balance: '300000' })],
        })
        .mockResolvedValueOnce({
          rows: [
            makeWalletRow({
              version: 3,
              posted_balance: '900000',
              reserved_balance: '200000',
            }),
          ],
        })
        .mockRejectedValueOnce(duplicate)
      mockPool.query.mockResolvedValue({
        rows: [makeTxRow({ type: 'topup', amount: '100000', state: 'Completed' })],
      })

      await expect(
        service.debit('profile-1', 100000n, { type: 'payment' }, 'idem-001'),
      ).rejects.toThrow('Idempotency key already used for a different wallet operation')
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    })

    it('rejects unique-index race recovery when the existing debit has a different amount', async () => {
      const wallet = makeWalletRow()
      const duplicate = Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'idx_wallet_tx_idempotency',
      })
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [makeWalletRow({ version: 2, reserved_balance: '300000' })],
        })
        .mockResolvedValueOnce({
          rows: [
            makeWalletRow({
              version: 3,
              posted_balance: '900000',
              reserved_balance: '200000',
            }),
          ],
        })
        .mockRejectedValueOnce(duplicate)
      mockPool.query.mockResolvedValue({
        rows: [makeTxRow({ type: 'payment', amount: '-50000', state: 'Completed' })],
      })

      await expect(
        service.debit('profile-1', 100000n, { type: 'payment' }, 'idem-001'),
      ).rejects.toThrow('Idempotency key already used for a different wallet operation')
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    })
  })

  describe('reserve (T-04.2.01.05)', () => {
    /**
     * Query sequence for a first-time reserve:
     *   0: BEGIN
     *   1: SELECT … FOR UPDATE
     *   2: SELECT by idempotency_key
     *   3: UPDATE wallets … reserved_balance += amount
     *   4: INSERT wallet_transactions (positive amount, Reserved)
     *   5: COMMIT
     */
    it('inserts a Reserved ledger row and increases reservedBalance under version + available check', async () => {
      const wallet = makeWalletRow()
      const reservation = makeTxRow({
        type: 'reservation',
        amount: '50000',
        state: 'Reserved',
        idempotency_key: 'idem-res-1',
      })
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [makeWalletRow({ reserved_balance: '250000', version: 2 })],
        })
        .mockResolvedValueOnce({ rows: [reservation] })

      const result = await service.reserve(
        'profile-1',
        50000n,
        'idem-res-1',
        { refId: 'inv-1', description: 'hold for payment' },
      )

      expect(result.type).toBe('reservation')
      expect(result.state).toBe('Reserved')
      expect(result.amount).toBe(50000n)

      const updateCall = mockClient.query.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE wallets'),
      )
      expect(updateCall).toBeDefined()
      expect(updateCall![0]).toContain('reserved_balance = reserved_balance + $1')
      expect(updateCall![0]).toContain('version = version + 1')
      expect(updateCall![0]).toContain('(posted_balance - reserved_balance) >= $1')
      expect(updateCall![1]).toEqual([50000n, 'profile-1', 1])

      const insertCall = mockClient.query.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO wallet_transactions'),
      )
      expect(insertCall).toBeDefined()
      expect(insertCall![0]).toContain("'reservation'")
      expect(insertCall![0]).toContain("'Reserved'")
      expect(insertCall![1]).toEqual([
        'profile-1',
        50000n,
        'idem-res-1',
        'inv-1',
        'hold for payment',
        null,
      ])

      expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
    })

    it('inserts the ledger row against the wallet row canonical profile_id', async () => {
      const canonical = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
      const wallet = makeWalletRow({ profile_id: canonical })
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [makeWalletRow({ profile_id: canonical, reserved_balance: '250000', version: 2 })],
        })
        .mockResolvedValueOnce({ rows: [makeTxRow({ wallet_id: canonical, type: 'reservation', state: 'Reserved' })] })

      await service.reserve(canonical.toUpperCase(), 50000n, 'idem-canonical-reserve')

      const insertCall = mockClient.query.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO wallet_transactions'),
      )
      expect(insertCall).toBeDefined()
      expect(insertCall![1][0]).toBe(canonical)
    })

    it('returns the existing reservation on idempotent retry without mutating the wallet', async () => {
      const wallet = makeWalletRow()
      const existingTx = makeTxRow({ type: 'reservation', amount: '50000', state: 'Reserved' })

      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [existingTx] })

      const result = await service.reserve('profile-1', 50000n, 'idem-001')

      expect(result.id).toBe('tx-001')
      expect(result.state).toBe('Reserved')
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
      expect(
        mockClient.query.mock.calls.some(
          (c) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE wallets'),
        ),
      ).toBe(false)
    })

    it('treats uppercase and lowercase walletId spellings as the same owner on retry', async () => {
      const canonical = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa'
      const wallet = makeWalletRow({ profile_id: canonical })
      const existingTx = makeTxRow({
        wallet_id: canonical,
        type: 'reservation',
        amount: '50000',
        state: 'Reserved',
        idempotency_key: 'idem-case',
      })

      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [existingTx] })

      const result = await service.reserve(canonical.toUpperCase(), 50000n, 'idem-case')

      expect(result.id).toBe('tx-001')
      expect(result.walletId).toBe(canonical)
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
    })

    it('rejects when availableBalance is below the reserve amount', async () => {
      const lowWallet = makeWalletRow({ posted_balance: '50000', reserved_balance: '0' })

      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [lowWallet] })
        .mockResolvedValueOnce({ rows: [] })

      await expect(service.reserve('profile-1', 100000n, 'idem-002')).rejects.toThrow(
        'Insufficient balance for reservation',
      )
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
      expect(
        mockClient.query.mock.calls.some(
          (c) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE wallets'),
        ),
      ).toBe(false)
    })

    it('rejects when reserved funds leave availableBalance below the reserve amount', async () => {
      const wallet = makeWalletRow({ posted_balance: '1000000', reserved_balance: '900000' })

      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [] })

      await expect(service.reserve('profile-1', 200000n, 'idem-reserved')).rejects.toThrow(
        'Insufficient balance for reservation: available=100000, required=200000',
      )
    })

    it('rejects a colliding idempotency key owned by another wallet', async () => {
      const wallet = makeWalletRow()
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [makeTxRow({ wallet_id: 'profile-other', type: 'reservation', state: 'Reserved' })] })

      await expect(service.reserve('profile-1', 50000n, 'idem-001')).rejects.toThrow(
        'Idempotency key already used for a different wallet',
      )
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    })

    it('rejects reserve that reuses a credit idempotency key without mutating the wallet', async () => {
      const wallet = makeWalletRow()
      const creditTx = makeTxRow({ type: 'topup', amount: '50000', state: 'Completed' })
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [creditTx] })

      await expect(service.reserve('profile-1', 50000n, 'idem-001')).rejects.toThrow(
        'Idempotency key already used for a different wallet operation',
      )
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    })

    it('rejects reserve that reuses a debit idempotency key', async () => {
      const wallet = makeWalletRow()
      const debitTx = makeTxRow({ type: 'payment', amount: '-50000', state: 'Completed' })
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [debitTx] })

      await expect(service.reserve('profile-1', 50000n, 'idem-001')).rejects.toThrow(
        'Idempotency key already used for a different wallet operation',
      )
    })

    it('rejects replay of a reservation that has already been released', async () => {
      const wallet = makeWalletRow()
      const released = makeTxRow({ type: 'reservation', amount: '50000', state: 'Released' })
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [released] })

      await expect(service.reserve('profile-1', 50000n, 'idem-001')).rejects.toThrow(
        'Idempotency key already used for a different wallet operation',
      )
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    })

    it('rejects a same-key reserve with a different amount', async () => {
      const wallet = makeWalletRow()
      const existingTx = makeTxRow({ type: 'reservation', amount: '50000', state: 'Reserved' })
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [existingTx] })

      await expect(service.reserve('profile-1', 200000n, 'idem-001')).rejects.toThrow(
        'Idempotency key already used for a different wallet operation',
      )
    })

    it('rejects a same-key reserve with a different refId', async () => {
      const wallet = makeWalletRow()
      const existingTx = makeTxRow({
        type: 'reservation',
        amount: '50000',
        state: 'Reserved',
        ref_id: 'inv-1',
      })
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [existingTx] })

      await expect(
        service.reserve('profile-1', 50000n, 'idem-001', { refId: 'inv-2' }),
      ).rejects.toThrow('Idempotency key already used for a different wallet operation')
    })

    it('rejects zero or negative reserve without opening a transaction', async () => {
      await expect(service.reserve('profile-1', 0n, 'k')).rejects.toThrow(
        'Reserve amount must be positive',
      )
      await expect(service.reserve('profile-1', -100n, 'k')).rejects.toThrow(
        'Reserve amount must be positive',
      )
      expect(mockPool.connect).not.toHaveBeenCalled()
    })

    it('rejects a blank idempotency key', async () => {
      await expect(service.reserve('profile-1', 100n, '   ')).rejects.toThrow(
        'Idempotency key is required',
      )
      expect(mockPool.connect).not.toHaveBeenCalled()
    })

    it('throws NotFound when the wallet row is missing', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })

      await expect(service.reserve('missing', 100n, 'k')).rejects.toThrow('Wallet not found: missing')
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    })

    it('rejects the reserve when UPDATE matches no row', async () => {
      const wallet = makeWalletRow()
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })

      await expect(service.reserve('profile-1', 50000n, 'idem-001')).rejects.toThrow(
        'version mismatch or insufficient availableBalance',
      )
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    })

    it('returns the committed ledger row when INSERT races on the unique idempotency index', async () => {
      const wallet = makeWalletRow()
      const duplicate = Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'idx_wallet_tx_idempotency',
      })
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [makeWalletRow({ reserved_balance: '250000', version: 2 })],
        })
        .mockRejectedValueOnce(duplicate)
      mockPool.query.mockResolvedValue({
        rows: [makeTxRow({ type: 'reservation', amount: '50000', state: 'Reserved' })],
      })

      const result = await service.reserve('profile-1', 50000n, 'idem-001')

      expect(result.id).toBe('tx-001')
      expect(result.state).toBe('Reserved')
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    })

    it('rejects unique-index race recovery when the existing row is a credit', async () => {
      const wallet = makeWalletRow()
      const duplicate = Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'idx_wallet_tx_idempotency',
      })
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [wallet] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [makeWalletRow({ reserved_balance: '250000', version: 2 })],
        })
        .mockRejectedValueOnce(duplicate)
      mockPool.query.mockResolvedValue({
        rows: [makeTxRow({ type: 'topup', amount: '50000', state: 'Completed' })],
      })

      await expect(service.reserve('profile-1', 50000n, 'idem-001')).rejects.toThrow(
        'Idempotency key already used for a different wallet operation',
      )
    })
  })

  describe('release (T-04.2.01.05)', () => {
    /**
     * Query sequence for a first-time release:
     *   0: BEGIN
     *   1: SELECT reservation … FOR UPDATE
     *   2: SELECT wallet … FOR UPDATE
     *   3: UPDATE wallets … reserved_balance -= amount
     *   4: UPDATE wallet_transactions SET state = Released
     *   5: COMMIT
     */
    it('decrements reservedBalance and advances the reservation to Released', async () => {
      const reservation = makeTxRow({
        id: 'res-001',
        type: 'reservation',
        amount: '50000',
        state: 'Reserved',
      })
      const released = { ...reservation, state: 'Released' }
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [reservation] })
        .mockResolvedValueOnce({ rows: [makeWalletRow()] })
        .mockResolvedValueOnce({
          rows: [makeWalletRow({ reserved_balance: '150000', version: 2 })],
        })
        .mockResolvedValueOnce({ rows: [released] })

      const result = await service.release('res-001')

      expect(result.id).toBe('res-001')
      expect(result.state).toBe('Released')
      expect(result.amount).toBe(50000n)

      const walletUpdate = mockClient.query.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE wallets'),
      )
      expect(walletUpdate).toBeDefined()
      expect(walletUpdate![0]).toContain('reserved_balance = reserved_balance - $1')
      expect(walletUpdate![0]).toContain('reserved_balance >= $1')
      expect(walletUpdate![1]).toEqual([50000n, 'profile-1', 1])

      const txUpdate = mockClient.query.mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes("SET state = 'Released'"),
      )
      expect(txUpdate).toBeDefined()
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
    })

    it('returns the existing row on idempotent re-release without mutating the wallet', async () => {
      const released = makeTxRow({
        id: 'res-001',
        type: 'reservation',
        amount: '50000',
        state: 'Released',
      })
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [released] })

      const result = await service.release('res-001')

      expect(result.state).toBe('Released')
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
      expect(
        mockClient.query.mock.calls.some(
          (c) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE wallets'),
        ),
      ).toBe(false)
    })

    it('throws NotFound when the reservation is missing and rolls back', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })

      await expect(service.release('missing-res')).rejects.toThrow('Reservation not found: missing-res')
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
      expect(mockClient.query).not.toHaveBeenCalledWith('COMMIT')
    })

    it('rejects release of a non-reservation ledger row', async () => {
      const payment = makeTxRow({ id: 'pay-001', type: 'payment', amount: '-50000', state: 'Completed' })
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [payment] })

      await expect(service.release('pay-001')).rejects.toThrow('Ledger row is not a reservation')
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    })

    it('rejects release from a non-Reserved, non-Released state', async () => {
      const pending = makeTxRow({ id: 'res-001', type: 'reservation', amount: '50000', state: 'Pending' })
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [pending] })

      await expect(service.release('res-001')).rejects.toThrow(
        'Reservation cannot be released from state Pending',
      )
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    })

    it('rejects a blank reservation id without opening a transaction', async () => {
      await expect(service.release('   ')).rejects.toThrow('Reservation id is required')
      expect(mockPool.connect).not.toHaveBeenCalled()
    })

    it('throws NotFound when the wallet row is missing', async () => {
      const reservation = makeTxRow({
        id: 'res-001',
        type: 'reservation',
        amount: '50000',
        state: 'Reserved',
      })
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [reservation] })
        .mockResolvedValueOnce({ rows: [] })

      await expect(service.release('res-001')).rejects.toThrow('Wallet not found: profile-1')
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    })

    it('rejects the release when the wallet UPDATE matches no row', async () => {
      const reservation = makeTxRow({
        id: 'res-001',
        type: 'reservation',
        amount: '50000',
        state: 'Reserved',
      })
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [reservation] })
        .mockResolvedValueOnce({ rows: [makeWalletRow()] })
        .mockResolvedValueOnce({ rows: [] })

      await expect(service.release('res-001')).rejects.toThrow(
        'version mismatch or reservedBalance shortfall',
      )
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK')
    })
  })

  describe('applyPostedBalanceDelta (T-04.2.01.06)', () => {
    it('updates postedBalance by delta and increments version when expectedVersion matches', async () => {
      mockPool.query.mockResolvedValue({
        rows: [makeWalletRow({ version: 2, posted_balance: '1100000', available_balance: '900000' })],
      })

      const result = await service.applyPostedBalanceDelta('profile-1', 100000n, 1)

      expect(result.postedBalance).toBe(1100000n)
      expect(result.version).toBe(2)
      expect(result.availableBalance).toBe(900000n)
      expect(mockPool.query).toHaveBeenCalledTimes(1)
      const [sql, params] = mockPool.query.mock.calls[0]!
      expect(sql).toContain('posted_balance = posted_balance + $1')
      expect(sql).toContain('version = version + 1')
      expect(sql).toMatch(/WHERE profile_id = \$2/)
      expect(sql).toMatch(/AND version = \$3/)
      expect(sql).not.toContain('posted_balance >= 0')
      expect(params).toEqual([100000n, 'profile-1', 1])
    })

    it('adds posted_balance >= 0 when requireNonNegativePostedBalance is set (T-04.2.01.03)', async () => {
      mockPool.query.mockResolvedValue({
        rows: [makeWalletRow({ version: 2, posted_balance: '1100000', available_balance: '900000' })],
      })

      await service.applyPostedBalanceDelta('profile-1', 100000n, 1, undefined, {
        requireNonNegativePostedBalance: true,
      })

      const [sql, params] = mockPool.query.mock.calls[0]!
      expect(sql).toContain('posted_balance >= 0')
      expect(sql).toMatch(/AND version = \$3/)
      expect(params).toEqual([100000n, 'profile-1', 1])
    })

    it('applies a negative delta (postedBalance + -amount) under the same version predicate', async () => {
      mockPool.query.mockResolvedValue({
        rows: [makeWalletRow({ version: 2, posted_balance: '900000', available_balance: '700000' })],
      })

      const result = await service.applyPostedBalanceDelta('profile-1', -100000n, 1)

      expect(result.postedBalance).toBe(900000n)
      expect(result.version).toBe(2)
      expect(mockPool.query.mock.calls[0]![1]).toEqual([-100000n, 'profile-1', 1])
    })

    it('uses the caller-supplied client so the UPDATE participates in an open transaction', async () => {
      mockClient.query.mockResolvedValue({
        rows: [makeWalletRow({ version: 2, posted_balance: '1100000' })],
      })

      await service.applyPostedBalanceDelta('profile-1', 100000n, 1, mockClient)

      expect(mockClient.query).toHaveBeenCalledTimes(1)
      expect(mockPool.query).not.toHaveBeenCalled()
      expect(mockClient.query.mock.calls[0]![1]).toEqual([100000n, 'profile-1', 1])
    })

    it('throws ConflictException when no row matches expectedVersion', async () => {
      mockPool.query.mockResolvedValue({ rows: [] })

      await expect(service.applyPostedBalanceDelta('profile-1', 100000n, 1)).rejects.toThrow(
        'Wallet optimistic lock failed: version mismatch',
      )
    })

    it('rejects a blank wallet id without querying', async () => {
      await expect(service.applyPostedBalanceDelta('   ', 100n, 0)).rejects.toThrow(
        'Wallet id is required',
      )
      expect(mockPool.query).not.toHaveBeenCalled()
    })

    it('rejects a zero delta without querying', async () => {
      await expect(service.applyPostedBalanceDelta('profile-1', 0n, 0)).rejects.toThrow(
        'Posted-balance delta must be non-zero',
      )
      expect(mockPool.query).not.toHaveBeenCalled()
    })

    it('rejects a non-integer or negative expectedVersion without querying', async () => {
      await expect(service.applyPostedBalanceDelta('profile-1', 100n, 1.5)).rejects.toThrow(
        'Expected version must be a non-negative integer',
      )
      await expect(service.applyPostedBalanceDelta('profile-1', 100n, -1)).rejects.toThrow(
        'Expected version must be a non-negative integer',
      )
      expect(mockPool.query).not.toHaveBeenCalled()
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

  describe('validateOnlineTopUpAmount (T-09.10.01)', () => {
    beforeEach(() => {
      mockPool.query.mockReset()
    })

    it('rejects a non-positive amount', async () => {
      await expect(service.validateOnlineTopUpAmount(0n)).rejects.toThrow(
        'Online top-up amount must be positive',
      )
      await expect(service.validateOnlineTopUpAmount(-100n)).rejects.toThrow(
        'Online top-up amount must be positive',
      )
      expect(mockPool.query).not.toHaveBeenCalled()
    })

    it('uses the 2,000,000,000 IRR default when no limit is persisted', async () => {
      mockPool.query.mockResolvedValue({ rows: [] })
      await expect(service.validateOnlineTopUpAmount(2_000_000_000n)).resolves.toBeUndefined()
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('app_config'),
        ['finance.wallet_top_up_limit'],
      )
    })

    it('rejects an amount above the default limit', async () => {
      mockPool.query.mockResolvedValue({ rows: [] })
      await expect(service.validateOnlineTopUpAmount(2_000_000_001n)).rejects.toThrow(
        'exceeds the configured per-transaction limit',
      )
    })

    it('enforces a persisted admin limit', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ value: { limit_irr: 1_000_000_000 } }] })
      await expect(service.validateOnlineTopUpAmount(1_000_000_000n)).resolves.toBeUndefined()
      await expect(service.validateOnlineTopUpAmount(1_000_000_001n)).rejects.toThrow(
        'exceeds the configured per-transaction limit',
      )
    })

    it('blocks everything when the configured limit is 0', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ value: { limit_irr: 0 } }] })
      await expect(service.validateOnlineTopUpAmount(1n)).rejects.toThrow('exceeds')
    })
  })
})
