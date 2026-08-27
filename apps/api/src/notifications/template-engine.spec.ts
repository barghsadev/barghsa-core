import { describe, it, expect } from 'vitest'
import {
  escapeHtml,
  resolvePath,
  collectVariables,
  renderTemplate,
  validateTemplate,
} from './template-engine.js'

describe('escapeHtml', () => {
  it('escapes ampersand, angle brackets, quotes and apostrophes', () => {
    const input = `<script>alert("x") & 'y'</script>`
    const out = escapeHtml(input)
    expect(out).toBe(
      '&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;',
    )
    expect(out).not.toContain('<script>')
  })

  it('leaves plain text and empty string unchanged', () => {
    expect(escapeHtml('plain text')).toBe('plain text')
    expect(escapeHtml('')).toBe('')
  })
})

describe('resolvePath — safe object traversal', () => {
  const data = {
    userName: 'Ali',
    profile: { displayName: 'Ali R', link: 'https://x.example/l' },
  }

  it('resolves a flat own key', () => {
    expect(resolvePath(data, 'userName')).toBe('Ali')
  })

  it('resolves a dotted path through nested plain objects', () => {
    expect(resolvePath(data, 'profile.displayName')).toBe('Ali R')
    expect(resolvePath(data, 'profile.link')).toBe('https://x.example/l')
  })

  it('never resolves blocked prototype/internal keys at any level', () => {
    expect(resolvePath(data, '__proto__')).toBeUndefined()
    expect(resolvePath(data, 'constructor')).toBeUndefined()
    expect(resolvePath(data, 'prototype')).toBeUndefined()
    expect(resolvePath(data, 'profile.constructor')).toBeUndefined()
    expect(resolvePath(data, 'profile.__proto__')).toBeUndefined()
    expect(resolvePath(data, 'hasOwnProperty')).toBeUndefined()
  })

  it('only reads own enumerable properties (not the prototype chain)', () => {
    const evil = Object.create({ inheritedSecret: 'leaked' })
    ;(evil as any).ownValue = 'ok'
    expect(resolvePath(evil, 'ownValue')).toBe('ok')
    expect(resolvePath(evil, 'inheritedSecret')).toBeUndefined()
  })

  it('refuses non-enumerable props even if own', () => {
    const obj = { a: 1 }
    Object.defineProperty(obj, 'hidden', { value: 'secret', enumerable: false })
    expect(resolvePath(obj, 'hidden')).toBeUndefined()
  })

  it('returns undefined for non-object traversal steps', () => {
    expect(resolvePath(data, 'profile.displayName.anything')).toBeUndefined()
    expect(resolvePath(42, 'x')).toBeUndefined()
    expect(resolvePath(null, 'x')).toBeUndefined()
    expect(resolvePath(undefined, 'x')).toBeUndefined()
  })

  it('rejects empty or symbol-keyed paths', () => {
    expect(resolvePath(data, '')).toBeUndefined()
    const sym = Symbol('s')
    expect(resolvePath({ [sym]: 'no' }, 'Symbol')).toBeUndefined()
  })
})

describe('renderTemplate — allow-list + escaping', () => {
  it('substitutes allow-listed flat variables', () => {
    const r = renderTemplate('Hi {{userName}}', ['userName'], {
      data: { userName: 'Ali' },
    })
    expect(r.output).toBe('Hi Ali')
    expect(r.missing).toEqual([])
    expect(r.unknown).toEqual([])
  })

  it('substitutes allow-listed dotted variables', () => {
    const r = renderTemplate('Hi {{profile.displayName}}', ['profile.displayName'], {
      data: { profile: { displayName: 'Ali R' } },
    })
    expect(r.output).toBe('Hi Ali R')
  })

  it('HTML-escapes variable values to prevent injection', () => {
    const r = renderTemplate('Hi {{userName}}', ['userName'], {
      data: { userName: '<script>steal()</script>' },
    })
    expect(r.output).not.toContain('<script>')
    expect(r.output).toContain('&lt;script&gt;')
  })

  it('renders missing/null/undefined allow-listed values as empty string and reports them', () => {
    const r = renderTemplate('Hi {{userName}}!', ['userName'], {})
    expect(r.output).toBe('Hi !')
    expect(r.missing).toEqual(['userName'])
  })

  it('never stringifies function or nested-object values (no internal-state leak)', () => {
    const f = function leakedSource() { return 'secret' }
    const rFn = renderTemplate('{{fn}}', ['fn'], { data: { fn: f } })
    expect(rFn.output).toBe('')
    expect(rFn.missing).toEqual(['fn'])
    expect(rFn.output).not.toContain('secret')

    const rObj = renderTemplate('{{obj}}', ['obj'], {
      data: { obj: { secret: 'cfg' } },
    })
    expect(rObj.output).toBe('')
    expect(rObj.output).not.toContain('cfg')
  })

  it('refuses to substitute an unknown placeholder (escaped literal, never data)', () => {
    const r = renderTemplate('{{evil}}', [], { data: { evil: 'xss' } })
    expect(r.output).toBe('{{evil}}')
    expect(r.unknown).toEqual(['evil'])
  })

  it('does not leak data keys that are not allow-listed', () => {
    const r = renderTemplate('{{secret}}', ['onlyThis'], {
      data: { secret: 'topsecret', onlyThis: 'ok' },
    })
    expect(r.output).toBe('{{secret}}')
    expect(r.output).not.toContain('topsecret')
  })

  it('renders an unknown allow-listed key present as internal-state cursor as empty, never leaked', () => {
    const r = renderTemplate('{{__proto__}}', ['__proto__'], { data: {} })
    // __proto__ is blocked by safe traversal even if admin mistakenly allows it.
    expect(r.output).toBe('')
    expect(r.missing).toEqual(['__proto__'])
  })

  it('reports both missing and unknown placeholders together', () => {
    const r = renderTemplate('a {{missing_}} b {{unknown_}}', ['missing_'], {})
    expect(r.missing).toEqual(['missing_'])
    expect(r.unknown).toEqual(['unknown_'])
  })

  it('handles empty template and no data', () => {
    expect(renderTemplate('', ['x'], {})).toEqual({
      output: '',
      missing: [],
      unknown: [],
    })
    expect(renderTemplate('plain', [], { data: undefined }).output).toBe('plain')
  })
})

describe('collectVariables', () => {
  it('lists unique variables in the body', () => {
    expect(
      collectVariables('{{userName}} and {{profile.displayName}} and {{userName}}'),
    ).toEqual(['userName', 'profile.displayName'])
  })
})

describe('validateTemplate — allow-list enforcement', () => {
  it('accepts a body whose placeholders are all well-formed and allow-listed', () => {
    expect(validateTemplate('Hi {{userName}}', ['userName'])).toEqual([])
  })

  it('flags an unclosed placeholder', () => {
    const problems = validateTemplate('Hi {{userName', ['userName'])
    expect(problems.some((p) => /unclosed/i.test(p.message))).toBe(true)
  })

  it('rejects a placeholder not in the allow-list', () => {
    const problems = validateTemplate('Hello {{other}}', ['userName'])
    expect(problems.some((p) => /not in the allow-list/i.test(p.message))).toBe(true)
  })

  it('rejects an invalid variable name', () => {
    const problems = validateTemplate('{{bad name!}}', ['bad name!'])
    expect(problems.some((p) => /invalid variable name/i.test(p.message))).toBe(true)
  })
})