import { describe, expect, it } from 'vitest'
import { renderTemplate, resolvePath } from './template-engine.js'

describe('shared notification rendering', () => {
  it('escapes HTML bodies but preserves literal characters in subjects and SMS', () => {
    const data = { name: 'A&B <customer>', amount: 5000 }
    expect(renderTemplate('{{name}}: {{amount}}', ['name', 'amount'], { data }).output).toBe('A&amp;B &lt;customer&gt;: 5000')
    expect(renderTemplate('{{name}}: {{amount}}', ['name', 'amount'], { data, escapeValues: false }).output).toBe('A&B <customer>: 5000')
  })
  it('never invokes accessors or reads inherited/prototype properties', () => {
    let reads = 0
    const value = Object.create({ inherited: 'hidden' })
    Object.defineProperty(value, 'getter', { enumerable: true, get() { reads++; return 'secret' } })
    expect(resolvePath(value, 'getter')).toBeUndefined()
    expect(resolvePath(value, 'inherited')).toBeUndefined()
    expect(resolvePath({ constructor: { name: 'internal' } }, 'constructor.name')).toBeUndefined()
    expect(reads).toBe(0)
  })
  it('reports missing and unapproved variables without exposing other data', () => {
    const result = renderTemplate('{{name}} {{missing}} {{secret}}', ['name', 'missing'], { data: { name: 'Customer', secret: 'private' } })
    expect(result).toEqual({ output: 'Customer  {{secret}}', missing: ['missing'], unknown: ['secret'] })
  })
})
