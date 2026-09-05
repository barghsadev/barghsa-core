import { afterEach, expect, it } from 'vitest'
import { getCsrfToken, withCsrf } from './csrf.js'

afterEach(() => { document.cookie = 'barghsa_csrf=; Max-Age=0; path=/' })

it('uses the latest cookie after another tab changes or clears authentication', () => {
  document.cookie = 'barghsa_csrf=first; path=/'
  expect(withCsrf().get('X-CSRF-Token')).toBe('first')
  document.cookie = 'barghsa_csrf=second; path=/'
  expect(withCsrf().get('X-CSRF-Token')).toBe('second')
  document.cookie = 'barghsa_csrf=; Max-Age=0; path=/'
  expect(withCsrf().has('X-CSRF-Token')).toBe(false)
  expect(withCsrf({ 'X-CSRF-Token': 'stale' }).has('X-CSRF-Token')).toBe(false)
})

it('preserves caller headers and handles malformed cookie encoding', () => {
  document.cookie = 'barghsa_csrf=token%3Dvalue; path=/'
  const original = new Headers({ 'Content-Type': 'application/json', 'Idempotency-Key': 'operation' })
  const headers = withCsrf(original)
  expect(headers.get('X-CSRF-Token')).toBe('token=value')
  expect(headers.get('Idempotency-Key')).toBe('operation')
  expect(original.has('X-CSRF-Token')).toBe(false)
  document.cookie = 'barghsa_csrf=%broken; path=/'
  expect(getCsrfToken()).toBeNull()
})
