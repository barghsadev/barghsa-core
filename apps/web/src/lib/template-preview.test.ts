import { describe, it, expect } from 'vitest'
import {
  escapeHtmlTemplate,
  isValidVariableName,
  templateVariableNames,
  collectPlaceholders,
  buildSampleData,
  renderTemplatePreview,
  type TemplateVariable,
} from './template-preview.js'

const VARIABLES: TemplateVariable[] = [
  { name: 'userName', description: "The user's display name" },
  { name: 'profileLink', description: 'Verification link' },
  { name: 'order.amount', description: 'Order amount' },
]

describe('template-preview helpers', () => {
  it('escapes HTML to prevent markup/script injection in preview output', () => {
    expect(renderTemplatePreview('Hello {{userName}}', VARIABLES, { userName: '<script>alert(1)</script>' }).output).toBe(
      'Hello &lt;script&gt;alert(1)&lt;/script&gt;',
    )
  })

  it('rejects prototype/constructor variable names (safety mirror)', () => {
    expect(isValidVariableName('__proto__')).toBe(false)
    expect(isValidVariableName('constructor')).toBe(false)
    expect(isValidVariableName('user.name')).toBe(true)
    expect(isValidVariableName('bad name')).toBe(false)
  })

  it('collects distinct placeholders from template text', () => {
    expect(collectPlaceholders('Hi {{userName}}, order {{order.amount}} {{userName}}').sort()).toEqual([
      'order.amount',
      'userName',
    ])
  })

  it('extracts allow-listed variable names (filtering invalid)', () => {
    expect(templateVariableNames(VARIABLES)).toEqual(['userName', 'profileLink', 'order.amount'])
  })

  it('builds neutral sample data for every allow-listed variable', () => {
    expect(buildSampleData(VARIABLES)).toEqual({
      userName: 'user name',
      profileLink: 'profile link',
      'order.amount': 'order.amount',
    })
  })

  it('flags an undeclared variable and resolves dotted vars from flat sample data', () => {
    const result = renderTemplatePreview(
      'Hi {{userName}}. Order: {{order.status}}. Amount: {{order.amount}}',
      [{ name: 'userName' }, ...VARIABLES.filter((v) => v.name === 'order.amount')],
    )
    // order.status is used but not in the allow-list -> undeclared
    expect(result.undeclared).toEqual(['order.status'])
    // order.amount is allow-listed and resolves from the flat sample data key
    expect(result.missingRequired).toEqual([])
    expect(result.output).toContain('Hi user name')
    expect(result.output).toContain('Order: {{order.status}}')
    expect(result.output).toContain('Amount: order.amount')
  })

  it('reports an allow-listed variable as missing when no value is supplied', () => {
    const result = renderTemplatePreview('Hi {{userName}}', VARIABLES, {
      // userName omitted intentionally
      profileLink: 'x',
    })
    expect(result.missingRequired).toEqual(['userName'])
    expect(result.output).toBe('Hi ')
  })
})