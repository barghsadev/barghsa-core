import { describe, it, expect } from 'vitest'
import { NotificationTemplateService } from './notification-template.service.js'

// Service uses a real DB pool for persistence methods; those flows are covered
// at integration/e2e level. These tests exercise the security-critical pure
// logic — allow-list variable validation and HTML-escaping on render — which is
// what the T-09.04.01 acceptance criteria and review call out directly.
const service = new NotificationTemplateService({} as never)

describe('escapeHtml', () => {
  it('escapes ampersand, angle brackets, quotes and apostrophes', () => {
    const input = `<script>alert("x") & 'y'</script>`
    const out = service.escapeHtml(input)
    expect(out).toBe(
      '&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;',
    )
    // Must not contain raw executable markup
    expect(out).not.toContain('<script>')
    expect(out).not.toContain('</script>')
  })

  it('leaves plain text unchanged', () => {
    expect(service.escapeHtml('plain text')).toBe('plain text')
  })

  it('escapes empty string to empty string', () => {
    expect(service.escapeHtml('')).toBe('')
  })
})

describe('validateVariables', () => {
  it('accepts a body whose placeholders are all allow-listed', () => {
    expect(() =>
      service.validateVariables('Hi {{userName}}, verify at {{profileLink}}', [
        'userName',
        'profileLink',
      ]),
    ).not.toThrow()
  })

  it('rejects a placeholder not in the allow-list', () => {
    expect(() =>
      service.validateVariables('Hello {{userName}}', ['otherVar']),
    ).toThrow(/not in the allow-list/i)
  })

  it('rejects an unclosed placeholder', () => {
    expect(() =>
      service.validateVariables('Hello {{userName', ['userName']),
    ).toThrow(/unclosed/iu)
  })

  it('rejects an invalid variable name (spaces / special chars)', () => {
    expect(() =>
      service.validateVariables('Hello {{bad name!}}', ['bad name!']),
    ).toThrow(/invalid variable name/i)
  })
})

describe('render', () => {
  it('substitutes allow-listed variables', () => {
    const data = { userName: 'Ali', profileLink: 'https://x/link' }
    expect(service.render('Hi {{userName}}', ['userName'], data)).toBe(
      'Hi Ali',
    )
  })

  it('HTML-escapes variable values to prevent injection into messages', () => {
    const data = {
      userName: '<script>steal()</script>',
      profileLink: 'javascript:alert(1)',
    }
    const out = service.render(
      'Hi {{userName}} go {{profileLink}}',
      ['userName', 'profileLink'],
      data,
    )
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
    expect(out).toContain('javascript:alert(1)')
  })

  it('renders null/undefined variable values as empty string', () => {
    const out = service.render('Hi {{userName}}!', ['userName'], {
      userName: undefined,
    })
    expect(out).toBe('Hi !')
  })

  it('renders an unknown placeholder as literal text (no value injection)', () => {
    // Unknown {{...}} is not a variable value, so it is rendered verbatim
    // (safe: only variable *values* are substituted, and those are escaped).
    const out = service.render('{{evil}}', [], {})
    expect(out).toBe('{{evil}}')
  })

  it('never allows a variable value to inject markup even adjacent to unknown placeholder', () => {
    // A data value for an allow-listed variable is HTML-escaped on render.
    const out = service.render('<b>{{userName}}</b>', ['userName'], {
      userName: '<script>alert(1)</script>',
    })
    expect(out).toBe('<b>&lt;script&gt;alert(1)&lt;/script&gt;</b>')
  })
})

describe('buildSampleData', () => {
  it('derives a friendly label from camelCase, lowercased', () => {
    const data = service.buildSampleData(['userName', 'profileLink'])
    expect(data.userName).toBe('user name')
    expect(data.profileLink).toBe('profile link')
  })

  it('skips empty entries', () => {
    const data = service.buildSampleData(['userName', '  '])
    expect(Object.keys(data)).toEqual(['userName'])
  })
})