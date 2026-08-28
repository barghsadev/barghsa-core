import { describe, it, expect, vi } from 'vitest'
import {
  AiModelTesterService,
  AI_MODEL_API_CLIENT,
  type AiModelApiClientLike,
  type AiModelTestInput,
} from './ai-model-tester.service.js'

/**
 * Public IP literal used for success-path tests: the SSRF guard accepts it
 * (not in any blocked range) and the fake client never dials the network.
 */
const PUBLIC_BASE = 'https://8.8.8.8/v1'

function input(over: Partial<AiModelTestInput> = {}): AiModelTestInput {
  return {
    providerType: 'openai_compatible',
    baseUrl: PUBLIC_BASE,
    modelName: 'gpt-4o',
    apiToken: 'sk-test',
    ...over,
  }
}

/** Fake client for the success paths. */
function okClient(status = 200, bodyText: string): AiModelApiClientLike {
  return { request: vi.fn().mockResolvedValue({ status, bodyText }) }
}

describe('AiModelTesterService (T-09.11.01)', () => {
  describe('wire protocol shaping', () => {
    it('shapes an OpenAI-compatible chat completion ping', async () => {
      const client = okClient(
        200,
        JSON.stringify({ choices: [{ message: { content: 'pong' } }] }),
      )
      const tester = new AiModelTesterService(client)
      const result = await tester.test(input())
      expect(result.ok).toBe(true)
      expect(result.responsePreview).toBe('pong')
      const call = vi.mocked(client.request).mock.calls[0]![0]!
      expect(call.baseUrl).toBe('https://8.8.8.8/v1')
      expect(call.apiToken).toBe('sk-test')
    })

    it('shapes an Anthropic Messages ping with x-api-key', async () => {
      const client = okClient(200, JSON.stringify({ content: [{ text: 'hello from claude' }] }))
      const tester = new AiModelTesterService(client)
      const result = await tester.test(input({ providerType: 'anthropic' }))
      expect(result.ok).toBe(true)
      expect(result.responsePreview).toBe('hello from claude')
      const call = vi.mocked(client.request).mock.calls[0]![0]!
      expect(call.baseUrl).toBe('https://8.8.8.8/v1')
    })
  })

  describe('response preview extraction', () => {
    it('falls back to trimmed raw text when the body is not JSON', async () => {
      const tester = new AiModelTesterService(okClient(200, '  plain text reply  '))
      const result = await tester.test(input())
      expect(result.ok).toBe(true)
      expect(result.responsePreview).toBe('plain text reply')
    })

    it('caps oversized bodies to the preview limit', async () => {
      const long = JSON.stringify({
        choices: [{ message: { content: 'x'.repeat(10_000) } }],
      })
      const tester = new AiModelTesterService(okClient(200, long))
      const result = await tester.test(input())
      expect(result.responsePreview!.length).toBeLessThanOrEqual(300)
    })
  })

  describe('failure handling', () => {
    it('treats redirects as failures (SSRF guard: redirects never followed)', async () => {
      // A public host returning 302 → private/metadata endpoint must fail the
      // test instead of being followed to the internal target.
      const client = okClient(302, '')
      const tester = new AiModelTesterService(client)
      const result = await tester.test(input())
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/redirects are not followed/)
    })

    it('treats opaque-redirect status 0 (undici manual redirect) as a failure', async () => {
      // With `redirect: 'manual'`, undici surfaces a redirect as an
      // opaque-redirect response with status 0 — not the real 3xx.
      const client = okClient(0, '')
      const tester = new AiModelTesterService(client)
      const result = await tester.test(input())
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/redirects are not followed/)
    })

    it('redacts the submitted token from provider error bodies', async () => {
      // OpenAI-style: the provider echoes the credential in error.message.
      const client = okClient(
        401,
        JSON.stringify({
          error: { message: 'Incorrect API key provided: sk-echoed-secret-123456' },
        }),
      )
      const tester = new AiModelTesterService(client)
      const result = await tester.test(input({ apiToken: 'sk-echoed-secret-123456' }))
      expect(result.ok).toBe(false)
      expect(result.error).not.toContain('sk-echoed-secret-123456')
      expect(result.error).toContain('[redacted]')
    })

    it('redacts the submitted token from thrown-client errors', async () => {
      const failing = {
        request: vi.fn().mockRejectedValue(new Error(`connection refused for sk-catch-secret`)),
      }
      const tester = new AiModelTesterService(failing)
      const result = await tester.test(input({ apiToken: 'sk-catch-secret' }))
      expect(result.ok).toBe(false)
      expect(JSON.stringify(result)).not.toContain('sk-catch-secret')
      expect(result.error).toContain('[redacted]')
    })

    it('redacts the submitted token from successful response previews', async () => {
      const client = okClient(200, JSON.stringify({ choices: [{ message: { content: 'echo sk-preview-secret' } }] }))
      const tester = new AiModelTesterService(client)
      const result = await tester.test(input({ apiToken: 'sk-preview-secret' }))
      expect(result.ok).toBe(true)
      expect(result.responsePreview).not.toContain('sk-preview-secret')
      expect(result.responsePreview).toContain('[redacted]')
    })

    it('reports provider HTTP errors with a truncated safe message', async () => {
      const client = okClient(
        401,
        JSON.stringify({ error: { message: 'Incorrect API key provided. longer tail' } }),
      )
      const tester = new AiModelTesterService(client)
      const result = await tester.test(input())
      expect(result.ok).toBe(false)
      expect(result.error).toContain('HTTP 401')
      expect(result.error).toContain('Incorrect API key provided')
      expect(result.error!).not.toContain('sk-test')
    })

    it('never leaks tokens through raw non-JSON error bodies (not echoed)', async () => {
      const client = okClient(500, `boom ${'sk-secret-token'.repeat(5)}`)
      const tester = new AiModelTesterService(client)
      const result = await tester.test(input())
      expect(result.ok).toBe(false)
      // Raw non-JSON bodies are not echoed at all — only the HTTP status.
      expect(result.error).toBe('Provider request failed (HTTP 500)')
      // The token must not appear anywhere in the result.
      expect(JSON.stringify(result)).not.toContain('sk-secret-token')
      expect(JSON.stringify(result)).not.toContain('sk-test')
    })

    it('returns a safe error when the HTTP client throws (network/timeout)', async () => {
      const failing = { request: vi.fn().mockRejectedValue(new Error('fetch failed')) }
      const tester = new AiModelTesterService(failing)
      const result = await tester.test(input())
      expect(result.ok).toBe(false)
      expect(result.error).toContain('fetch failed')
      expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    })
  })

  describe('structural validation', () => {
    it('rejects a missing base URL', async () => {
      const tester = new AiModelTesterService(okClient(200, '{}'))
      const result = await tester.test(input({ baseUrl: '' }))
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/Base URL is missing/)
    })

    it('rejects a missing model name', async () => {
      const tester = new AiModelTesterService(okClient(200, '{}'))
      const result = await tester.test(input({ modelName: '  ' }))
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/Model name is missing/)
    })

    it('rejects a non-URL base', async () => {
      const tester = new AiModelTesterService(okClient(200, '{}'))
      const result = await tester.test(input({ baseUrl: 'not a url' }))
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/not a valid URL/)
    })

    it('rejects non-http(s) schemes', async () => {
      const tester = new AiModelTesterService(okClient(200, '{}'))
      const result = await tester.test(input({ baseUrl: 'file:///etc/passwd' }))
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/must use http\(s\)/)
    })
  })

  describe('SSRF guard', () => {
    it('blocks loopback base URLs', async () => {
      const tester = new AiModelTesterService(okClient(200, '{}'))
      const result = await tester.test(input({ baseUrl: 'https://127.0.0.1/v1' }))
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/not allowed/)
    })

    it('blocks RFC1918 private base URLs', async () => {
      const tester = new AiModelTesterService(okClient(200, '{}'))
      const result = await tester.test(input({ baseUrl: 'https://10.0.0.5/v1' }))
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/not allowed/)
    })

    it('blocks link-local and metadata endpoints', async () => {
      const tester = new AiModelTesterService(okClient(200, '{}'))
      for (const base of ['https://169.254.169.254/latest', 'https://192.168.1.1/v1']) {
        const result = await tester.test(input({ baseUrl: base }))
        expect(result.ok).toBe(false)
        expect(result.error).toMatch(/not allowed/)
      }
    })

    it('honors the deployment allow-list for local endpoints', async () => {
      const prev = process.env.AI_MODEL_BASE_URL_ALLOWLIST
      process.env.AI_MODEL_BASE_URL_ALLOWLIST = 'localhost'
      try {
        const tester = new AiModelTesterService(okClient(200, JSON.stringify({ ok: true })))
        const result = await tester.test(input({ baseUrl: 'http://localhost:11434/v1' }))
        expect(result.ok).toBe(true)
      } finally {
        if (prev === undefined) delete process.env.AI_MODEL_BASE_URL_ALLOWLIST
        else process.env.AI_MODEL_BASE_URL_ALLOWLIST = prev
      }
    })
  })
})

// Keep the injection token import meaningful for future DI wiring tests.
describe('DI token', () => {
  it('is exported for tests and wiring', () => {
    expect(AI_MODEL_API_CLIENT.toString()).toContain('AI_MODEL_API_CLIENT')
  })
})
