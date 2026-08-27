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

describe('normalizeVariables', () => {
  it('maps legacy plain-string entries to {name, description: null}', () => {
    expect(NotificationTemplateService.normalizeVariables(['userName', 'profileLink'])).toEqual([
      { name: 'userName', description: null },
      { name: 'profileLink', description: null },
    ])
  })

  it('preserves object entries with their descriptions', () => {
    expect(
      NotificationTemplateService.normalizeVariables([
        { name: 'userName', description: 'The user display name' },
        { name: 'verificationCode', description: null },
      ]),
    ).toEqual([
      { name: 'userName', description: 'The user display name' },
      { name: 'verificationCode', description: null },
    ])
  })

  it('drops empty and duplicate names, keeping first occurrence', () => {
    expect(
      NotificationTemplateService.normalizeVariables([
        '',
        '  ',
        'userName',
        'userName',
        'profileLink',
      ]),
    ).toEqual([
      { name: 'userName', description: null },
      { name: 'profileLink', description: null },
    ])
  })

  it('handles null/undefined input as empty list', () => {
    expect(NotificationTemplateService.normalizeVariables(null)).toEqual([])
    expect(NotificationTemplateService.normalizeVariables(undefined)).toEqual([])
  })

  it('trims whitespace from name and description', () => {
    expect(
      NotificationTemplateService.normalizeVariables([
        { name: '  userName ', description: '  a desc  ' },
      ]),
    ).toEqual([{ name: 'userName', description: 'a desc' }])
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

describe('isDestinationAllowed (T-05.04.04)', () => {
  const contacts = ['admin@example.com', '+989120000000']

  it('allows a destination matching the admin own email (case-insensitive)', () => {
    expect(
      NotificationTemplateService.isDestinationAllowed(contacts, 'Admin@Example.com', {}),
    ).toBe(true)
  })

  it('allows a destination matching the admin own phone', () => {
    expect(
      NotificationTemplateService.isDestinationAllowed(contacts, '+989120000000', {}),
    ).toBe(true)
  })

  it('allows an empty/null destination (in-app default)', () => {
    expect(NotificationTemplateService.isDestinationAllowed(contacts, '', {})).toBe(true)
    expect(NotificationTemplateService.isDestinationAllowed(contacts, undefined, {})).toBe(true)
  })

  it('allows an allow-listed test address outside production', () => {
    expect(
      NotificationTemplateService.isDestinationAllowed(contacts, 'qa@example.com', {
        NODE_ENV: 'development',
        TEST_SEND_ALLOWLIST: 'qa@example.com, staging@example.com',
      }),
    ).toBe(true)
  })

  it('rejects an allow-listed address in production (dev-only restriction)', () => {
    expect(
      NotificationTemplateService.isDestinationAllowed(contacts, 'qa@example.com', {
        NODE_ENV: 'production',
        TEST_SEND_ALLOWLIST: 'qa@example.com',
      }),
    ).toBe(false)
  })

  it('rejects a third-party destination that is not owned nor allow-listed', () => {
    expect(
      NotificationTemplateService.isDestinationAllowed(contacts, 'random@attacker.com', {
        NODE_ENV: 'development',
        TEST_SEND_ALLOWLIST: 'qa@example.com',
      }),
    ).toBe(false)
  })

  it('trims surrounding whitespace before comparing', () => {
    expect(
      NotificationTemplateService.isDestinationAllowed(contacts, '  admin@example.com  ', {}),
    ).toBe(true)
  })
})
