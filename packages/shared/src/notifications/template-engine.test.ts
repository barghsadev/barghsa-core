import { describe, expect, it } from 'vitest';
import {
  collectVariables,
  renderTemplate,
  resolvePath,
  validateTemplate,
  buildTemplateSampleData,
} from './template-engine.js';

describe('shared notification rendering', () => {
  it('builds safe nested samples and accepts explicit flat or nested variable values', () => {
    const names = ['user.name', 'order.amount', '__proto__.polluted', 'a..b'];
    expect(buildTemplateSampleData(names)).toEqual({
      user: { name: 'user.name' },
      order: { amount: 'order.amount' },
    });
    for (const values of [{ 'user.name': 'A&B' }, { user: { name: 'A&B' } }]) {
      const data = buildTemplateSampleData(names, values);
      expect(renderTemplate('{{user.name}}', names, { data }).output).toBe('A&amp;B');
      expect(Object.hasOwn(data, '__proto__')).toBe(false);
    }
  });
  it('never invokes sample getters or mutates caller objects', () => {
    let reads = 0;
    const input = {
      user: { name: 'Original' },
      get dangerous() {
        reads++;
        return 'secret';
      },
    };
    expect(buildTemplateSampleData(['user', 'user.name', 'dangerous'], input)).toEqual({
      user: { name: 'Original' },
    });
    expect(input.user).toEqual({ name: 'Original' });
    expect(reads).toBe(0);
  });
  it('escapes HTML bodies but preserves literal characters in subjects and SMS', () => {
    const data = { name: 'A&B <customer>', amount: 5000 };
    expect(renderTemplate('{{name}}: {{amount}}', ['name', 'amount'], { data }).output).toBe(
      'A&amp;B &lt;customer&gt;: 5000'
    );
    expect(
      renderTemplate('{{name}}: {{amount}}', ['name', 'amount'], { data, escapeValues: false })
        .output
    ).toBe('A&B <customer>: 5000');
  });
  it('never invokes accessors or reads inherited/prototype properties', () => {
    let reads = 0;
    const value = Object.create({ inherited: 'hidden' });
    Object.defineProperty(value, 'getter', {
      enumerable: true,
      get() {
        reads++;
        return 'secret';
      },
    });
    expect(resolvePath(value, 'getter')).toBeUndefined();
    expect(resolvePath(value, 'inherited')).toBeUndefined();
    expect(resolvePath({ constructor: { name: 'internal' } }, 'constructor.name')).toBeUndefined();
    expect(reads).toBe(0);
  });
  it('reports missing and unapproved variables without exposing other data', () => {
    const result = renderTemplate('{{name}} {{missing}} {{secret}}', ['name', 'missing'], {
      data: { name: 'Customer', secret: 'private' },
    });
    expect(result).toEqual({
      output: 'Customer  {{secret}}',
      missing: ['missing'],
      unknown: ['secret'],
    });
  });
});

for (const name of ['constructor', '__proto__', 'user.prototype', 'user..name', '.name', 'name.']) {
  it(`rejects unsafe or malformed variable path ${name} even if allowlisted`, () => {
    expect(validateTemplate('{{' + name + '}}', [name])).not.toEqual([]);
    expect(renderTemplate('{{' + name + '}}', [name], { data: {} })).toEqual({
      output: '{{' + name + '}}',
      missing: [],
      unknown: [name],
    });
    expect(collectVariables('{{' + name + '}}')).toEqual([]);
  });
}
for (const template of [
  '{{}}',
  '{{   }}',
  '}} {{name}} {{',
  '{{ outer {{name}} }}',
  '{{foo{bar}}',
  '{{foo}bar}}',
  '{{name',
  'name}}',
]) {
  it(`rejects malformed placeholder structure ${template}`, () =>
    expect(validateTemplate(template, ['name'])).not.toEqual([]));
}
it('collects distinct permitted paths and accepts a plain or valid template', () => {
  expect(collectVariables('{{ user.name }} {{amount}} {{user.name}} {{bad-name}}')).toEqual([
    'user.name',
    'amount',
  ]);
  expect(validateTemplate('Plain text', [])).toEqual([]);
  expect(validateTemplate('{{ user.name }} {{amount}}', ['user.name', 'amount'])).toEqual([]);
  expect(validateTemplate('{{secret}}', [])).toEqual([
    { message: 'Variable "secret" is not in the allow-list', variable: 'secret' },
  ]);
});
it('keeps missing-value diagnostics distinct and never serializes internal values', () => {
  const data = {
    object: {},
    callable: () => 'secret',
    symbol: Symbol('secret'),
    empty: null,
    flag: false,
    count: 0,
    nested: { value: 'yes' },
  };
  expect(
    renderTemplate(
      '{{object}}{{callable}}{{symbol}}{{empty}}{{flag}}/{{count}}/{{nested.value}}',
      Object.keys(data).concat('nested.value'),
      { data }
    )
  ).toEqual({
    output: 'false/0/yes',
    missing: ['object', 'callable', 'symbol', 'empty'],
    unknown: [],
  });
  expect(renderTemplate('{{missing}} {{missing}}', ['missing'])).toEqual({
    output: ' ',
    missing: ['missing'],
    unknown: [],
  });
});
it('refuses traversal through primitive, null, hidden and empty properties', () => {
  const hidden = Object.defineProperty({}, 'name', { value: 'hidden', enumerable: false });
  for (const root of [null, undefined, 'text', 4, true, hidden])
    expect(resolvePath(root, 'name')).toBeUndefined();
  expect(resolvePath({ name: 'value' }, '')).toBeUndefined();
  expect(resolvePath({ nested: null }, 'nested.name')).toBeUndefined();
});
