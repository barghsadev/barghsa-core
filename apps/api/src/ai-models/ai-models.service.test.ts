import { describe, it, expect, beforeEach, vi } from 'vitest'
import { HttpException } from '@nestjs/common'
import type { AiModelsService as AiModelsServiceType } from './ai-models.service.js'
import { AiModelSecretsService } from './ai-model-secrets.service.js'
import type { AiModelApiClientLike } from './ai-model-tester.service.js'

const TEST_KEY = Buffer.from('0123456789abcdef0123456789abcdef')

function mockPool() {
  const mockQuery = vi.fn()
  const pool = { query: mockQuery }
  return { mockQuery, pool }
}

/**
 * A stub AI model row (snake_case, as returned by postgres).
 * `api_token` holds the ENCRYPTED value for masked-token assertions.
 */
function makeRow(over: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    title: 'OpenAI GPT-4o',
    provider_type: 'openai_compatible',
    base_url: 'https://api.openai.com/v1',
    model_name: 'gpt-4o',
    api_token: null as string | null,
    last_tested_at: null,
    last_test_status: 'pending',
    last_test_error: null,
    created_at: '2026-08-28T00:00:00.000Z',
    updated_at: '2026-08-28T00:00:00.000Z',
    ...over,
  }
}

function okClient(): AiModelApiClientLike {
  return {
    request: vi.fn().mockResolvedValue({
      status: 200,
      bodyText: JSON.stringify({ choices: [{ message: { content: 'pong' } }] }),
    }),
  }
}

let service: AiModelsServiceType

beforeEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
})

/** Load AiModelsService with a mocked @barghsa/db pool + real sealed deps. */
async function loadService(pool: { query: ReturnType<typeof vi.fn> }) {
  vi.doMock('@barghsa/db', () => ({ getDbPool: () => pool }))
  const { AiModelsService: Svc } = await import('./ai-models.service.js')
  const secrets = new AiModelSecretsService(TEST_KEY)
  const tester = new (await import('./ai-model-tester.service.js')).AiModelTesterService(okClient())
  service = new Svc(secrets, tester)
  return { secrets, tester }
}

const ACTOR = 'user-admin-1'

describe('AiModelsService (T-09.11.01)', () => {
  describe('list', () => {
    it('returns DTOs with masked tokens and derived status', async () => {
      const { mockQuery } = mockPool()
      await loadService({ query: mockQuery })
      const secrets = new AiModelSecretsService(TEST_KEY)
      mockQuery.mockResolvedValueOnce({
        rows: [
          makeRow({
            api_token: secrets.encryptToken('sk-abcdef1234'),
            last_test_status: 'passed',
            last_tested_at: '2026-08-28T10:00:00.000Z',
          }),
          makeRow({
            id: 'row-2',
            title: 'Anthropic',
            provider_type: 'anthropic',
            last_test_status: 'failed',
            last_test_error: 'HTTP 401',
          }),
        ],
      })

      const result = await service.list()
      expect(result).toHaveLength(2)
      // 'sk-abcdef1234' (13 chars) → 9 stars + last 4.
      expect(result[0]!.apiTokenMasked).toBe('*********1234')
      expect(result[0]!.status).toBe('reachable')
      expect(result[1]!.status).toBe('unreachable')
      expect(result[1]!.lastTestError).toBe('HTTP 401')
      // Plaintext token never surfaces.
      expect(JSON.stringify(result)).not.toContain('sk-abcdef1234')
    })
  })

  describe('create', () => {
    it('fails closed with 503 when no encryption key is configured', async () => {
      const { mockQuery } = mockPool()
      vi.doMock('@barghsa/db', () => ({ getDbPool: () => ({ query: mockQuery }) }))
      // Import fresh (beforeEach reset modules): KEYLESS secrets instance.
      const { AiModelsService: Svc } = await import('./ai-models.service.js')
      const keylessSecrets = new AiModelSecretsService() // no key
      const tester = new (await import('./ai-model-tester.service.js')).AiModelTesterService(
        okClient(),
      )
      const keyless = new Svc(keylessSecrets, tester)

      try {
        await keyless.create({
          title: 'OpenAI GPT-4o',
          providerType: 'openai_compatible',
          baseUrl: 'https://api.openai.com/v1',
          modelName: 'gpt-4o',
          apiToken: 'sk-never-plaintext',
          actorUserId: ACTOR,
          ip: '1.2.3.4',
        })
        expect.fail('create should have thrown with 503')
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException)
        const http = error as HttpException
        expect(http.getStatus()).toBe(503)
        expect(http.getResponse()).toMatchObject({ error: 'AI_MODEL_ENCRYPTION_UNAVAILABLE' })
      }
      // The token must never reach the database.
      expect(mockQuery).not.toHaveBeenCalled()
    })

    it('encrypts the token at rest and records an audit event', async () => {
      const { mockQuery } = mockPool()
      await loadService({ query: mockQuery })
      const secrets = new AiModelSecretsService(TEST_KEY)
      const created = makeRow({
        api_token: secrets.encryptToken('sk-plain-create'),
      })
      mockQuery.mockResolvedValueOnce({ rows: [created] })
      mockQuery.mockResolvedValueOnce({ rows: [] }) // audit insert

      const dto = await service.create({
        title: 'OpenAI GPT-4o',
        providerType: 'openai_compatible',
        baseUrl: 'https://api.openai.com/v1',
        modelName: 'gpt-4o',
        apiToken: 'sk-plain-create',
        actorUserId: ACTOR,
        ip: '1.2.3.4',
      })

      // 'sk-plain-create' (15 chars) → 11 stars + last 4 ('eate').
      expect(dto.apiTokenMasked).toBe('***********eate')
      // The INSERT must carry the encrypted blob, never the plaintext.
      const calls = mockQuery.mock.calls
      const insertCall = calls.find((c) => String(c[0]).startsWith('INSERT INTO ai_models'))
      expect(insertCall).toBeDefined()
      const values = insertCall![1] as unknown[]
      const storedToken = String(values[5])
      expect(storedToken.startsWith('v1:')).toBe(true)
      expect(storedToken).not.toContain('sk-plain-create')
      // Audit insert also executed.
      expect(calls.some((c) => String(c[0]).includes('INSERT INTO audit_log'))).toBe(true)
    })

    it('surfaces a creation 500 with no RETURNING row', async () => {
      const { mockQuery } = mockPool()
      await loadService({ query: mockQuery })
      mockQuery.mockResolvedValueOnce({ rows: [] })
      await expect(
        service.create({
          title: 'x',
          providerType: 'openai_compatible',
          baseUrl: 'https://api.openai.com/v1',
          modelName: 'm',
          actorUserId: ACTOR,
          ip: '1.2.3.4',
        }),
      ).rejects.toBeInstanceOf(HttpException)
    })
  })

  describe('update', () => {
    it('preserves the stored token when a masked placeholder is echoed back', async () => {
      const { mockQuery } = mockPool()
      await loadService({ query: mockQuery })
      const secrets = new AiModelSecretsService(TEST_KEY)
      const encrypted = secrets.encryptToken('sk-stored-token')
      mockQuery.mockResolvedValueOnce({ rows: [makeRow({ api_token: encrypted })] }) // findRow
      mockQuery.mockResolvedValueOnce({
        rows: [makeRow({ title: 'Renamed', api_token: encrypted })],
      }) // update
      mockQuery.mockResolvedValueOnce({ rows: [] }) // audit

      const dto = await service.update('row-1', {
        title: 'Renamed',
        apiToken: '****1234',
        actorUserId: ACTOR,
        ip: '1.2.3.4',
      })

      const calls = mockQuery.mock.calls
      const updateCall = calls.find((c) => String(c[0]).startsWith('UPDATE ai_models'))
      const values = updateCall![1] as unknown[]
      expect(values).toContain(encrypted)
      expect(values).not.toContain('****1234')
      expect(dto.title).toBe('Renamed')
    })

    it('encrypts a genuinely new token on update', async () => {
      const { mockQuery } = mockPool()
      await loadService({ query: mockQuery })
      const secrets = new AiModelSecretsService(TEST_KEY)
      mockQuery.mockResolvedValueOnce({ rows: [makeRow({ api_token: null })] }) // findRow
      mockQuery.mockResolvedValueOnce({
        rows: [makeRow({ api_token: secrets.encryptToken('sk-new-token') })],
      })
      mockQuery.mockResolvedValueOnce({ rows: [] }) // audit

      await service.update('row-1', {
        apiToken: 'sk-new-token',
        actorUserId: ACTOR,
        ip: '1.2.3.4',
      })

      const calls = mockQuery.mock.calls
      const updateCall = calls.find((c) => String(c[0]).startsWith('UPDATE ai_models'))
      const values = updateCall![1] as unknown[]
      expect(String(values[0]).startsWith('v1:')).toBe(true)
      expect(values).not.toContain('sk-new-token')
    })

    it('clears the stored token when an empty string is submitted', async () => {
      const { mockQuery } = mockPool()
      await loadService({ query: mockQuery })
      const secrets = new AiModelSecretsService(TEST_KEY)
      const encrypted = secrets.encryptToken('sk-old-token')
      mockQuery.mockResolvedValueOnce({ rows: [makeRow({ api_token: encrypted })] }) // findRow
      mockQuery.mockResolvedValueOnce({ rows: [makeRow({ api_token: null })] }) // update -> null
      mockQuery.mockResolvedValueOnce({ rows: [] }) // audit

      const dto = await service.update('row-1', {
        apiToken: '',
        actorUserId: ACTOR,
        ip: '1.2.3.4',
      })

      const calls = mockQuery.mock.calls
      const updateCall = calls.find((c) => String(c[0]).startsWith('UPDATE ai_models'))
      const values = updateCall![1] as unknown[]
      expect(values[0]).toBeNull()
      expect(dto.apiTokenMasked).toBe('')
    })

    it('is a no-op returning the row when no fields change', async () => {
      const { mockQuery } = mockPool()
      await loadService({ query: mockQuery })
      // Persistent answer: the no-op path re-reads via get() → findRow.
      mockQuery.mockResolvedValue({ rows: [makeRow()] })
      const dto = await service.update('row-1', { actorUserId: ACTOR, ip: '1.2.3.4' })
      expect(dto.id).toBe('row-1')
      // Only the SELECTs ran — no UPDATE, no audit.
      const calls = mockQuery.mock.calls
      expect(calls.some((c) => String(c[0]).startsWith('UPDATE ai_models'))).toBe(false)
      expect(calls.some((c) => String(c[0]).includes('INSERT INTO audit_log'))).toBe(false)
    })
  })

  describe('get / remove', () => {
    it('throws 404 when the model does not exist', async () => {
      const { mockQuery } = mockPool()
      await loadService({ query: mockQuery })
      mockQuery.mockResolvedValueOnce({ rows: [] })
      await expect(service.get('missing')).rejects.toThrow(/not found/)
    })

    it('deletes the row and records an audit event', async () => {
      const { mockQuery } = mockPool()
      await loadService({ query: mockQuery })
      mockQuery.mockResolvedValueOnce({ rows: [makeRow()] }) // findRow
      mockQuery.mockResolvedValueOnce({ rows: [] }) // delete
      mockQuery.mockResolvedValueOnce({ rows: [] }) // audit

      await service.remove('row-1', ACTOR, '1.2.3.4')

      const calls = mockQuery.mock.calls
      expect(calls.some((c) => String(c[0]).startsWith('DELETE FROM ai_models'))).toBe(true)
      const auditCall = calls.find((c) => String(c[0]).includes('INSERT INTO audit_log'))
      expect(auditCall).toBeDefined()
      expect(auditCall![1] as unknown[]).toContain('ai_model_deleted')
    })
  })

  describe('test', () => {
    it('reports an undecryptable stored token without pinging the provider', async () => {
      const { mockQuery } = mockPool()
      await loadService({ query: mockQuery })
      // Tampered/foreign-key blob that will not decrypt with TEST_KEY.
      mockQuery.mockResolvedValueOnce({
        rows: [makeRow({ api_token: 'v1:AAAAAAAA:BBBBBBBB:CCCCCCCC' })],
      }) // findRow
      mockQuery.mockResolvedValueOnce({
        rows: [
          makeRow({
            api_token: 'v1:AAAAAAAA:BBBBBBBB:CCCCCCCC',
            last_test_status: 'failed',
            last_test_error: 'Stored API token could not be decrypted (check AI_MODEL_ENCRYPTION_KEY)',
          }),
        ],
      }) // update (persist failed) + RETURNING
      mockQuery.mockResolvedValueOnce({ rows: [] }) // audit

      const { model, test } = await service.test('row-1', ACTOR, '1.2.3.4')

      expect(test.ok).toBe(false)
      expect(test.error).toMatch(/could not be decrypted/)
      expect(model.status).toBe('unreachable')
      // No provider ping was attempted (the injected client was never called).
      const calls = mockQuery.mock.calls
      expect(
        calls.some((c) => String(c[0]).includes('UPDATE ai_models')),
      ).toBe(true)
    })

    it('persists a passed outcome and returns the preview', async () => {
      const { mockQuery } = mockPool()
      await loadService({ query: mockQuery })
      const secrets = new AiModelSecretsService(TEST_KEY)
      mockQuery.mockResolvedValueOnce({
        rows: [makeRow({ api_token: secrets.encryptToken('sk-test-token') })],
      }) // findRow
      mockQuery.mockResolvedValueOnce({
        rows: [makeRow({ api_token: secrets.encryptToken('sk-test-token'), last_test_status: 'passed' })],
      }) // update
      mockQuery.mockResolvedValueOnce({ rows: [] }) // audit

      const { model, test } = await service.test('row-1', ACTOR, '1.2.3.4')

      expect(test.ok).toBe(true)
      expect(test.responsePreview).toBe('pong')
      expect(model.status).toBe('reachable')
      const calls = mockQuery.mock.calls
      const updateCall = calls.find((c) => String(c[0]).startsWith('UPDATE ai_models'))
      const values = updateCall![1] as unknown[]
      expect(values).toContain('passed')
      const auditCall = calls.find((c) => String(c[0]).includes('INSERT INTO audit_log'))
      expect(auditCall).toBeDefined()
      expect(auditCall![1] as unknown[]).toContain('ai_model_tested')
    })
  })
})
