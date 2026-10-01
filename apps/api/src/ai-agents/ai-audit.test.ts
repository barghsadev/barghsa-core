import { beforeEach, expect, it, vi } from 'vitest';
import { appendAiAudit } from './ai-audit.js';
import { redactAiText } from './ai-prompt-redaction.js';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@barghsa/db', () => ({ getDbPool: () => ({ query }) }));
beforeEach(() => query.mockReset().mockResolvedValue({ rows: [] }));

async function audit(input: Record<string, unknown>, output: Record<string, unknown> = {}) {
  await appendAiAudit({
    toolName: 'customer_knowledge_question',
    input,
    output,
    authorizationResult: 'allowed',
  });
  const parameters = query.mock.calls[0]![1] as unknown[];
  return {
    input: JSON.parse(parameters[5] as string) as Record<string, unknown>,
    output: JSON.parse(parameters[6] as string) as Record<string, unknown>,
  };
}

for (const id of ['00000000-0000-4000-8000-000000000000', '018f0000-0000-7000-8000-000000000000']) {
  it(`preserves validated input identifiers even when their numeric segments match redaction: ${id}`, async () => {
    expect(redactAiText(id).text).not.toBe(id);
    const value = await audit({
      requestId: id,
      agentId: id,
      conversationId: id,
      message: 'A guide question',
    });
    expect(value.input).toEqual({
      requestId: id,
      agentId: id,
      conversationId: id,
      message: 'A guide question',
      redactionCategories: [],
    });
  });
}

it('keeps credentials, bank values and national IDs redacted in input and output', async () => {
  const sensitive = 'password: hunter2 IR820540102680020817909002 ID ۰۰۷۹۰۵۶۸۷۳';
  const value = await audit(
    { requestId: '00000000-0000-4000-8000-000000000000', message: sensitive },
    { reply: sensitive }
  );
  for (const payload of [value.input, value.output]) {
    expect(JSON.stringify(payload)).not.toContain('hunter2');
    expect(JSON.stringify(payload)).not.toContain('IR820540102680020817909002');
    expect(JSON.stringify(payload)).not.toContain('۰۰۷۹۰۵۶۸۷۳');
    expect(payload.redactionCategories).toEqual(['credential', 'bank_detail', 'national_id']);
  }
});

it('does not exempt malformed identifier values, free-form UUID text, nested fields or output identifiers', async () => {
  const id = '00000000-0000-4000-8000-000000000000';
  const value = await audit(
    {
      requestId: 'password: hidden',
      agentId: 'token: secretvalue',
      conversationId: `invalid ${id}`,
      message: id,
      nested: { requestId: id },
    },
    { requestId: id }
  );
  expect(value.input.requestId).toBe('password: [REDACTED]');
  expect(value.input.agentId).toBe('token: [REDACTED]');
  expect(value.input.conversationId).not.toContain(id);
  expect(value.input.message).not.toBe(id);
  expect(value.input.nested).not.toEqual({ requestId: id });
  expect(value.output.requestId).not.toBe(id);
});

it('preserves existing payload entry, depth, text and array limits', async () => {
  const value = await audit({
    message: 'a'.repeat(5000),
    items: Array(40).fill('item'),
    nested: { a: { b: { c: { d: { e: 'too deep' } } } } },
    ...Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`key${index}`, index])),
    requestId: '00000000-0000-4000-8000-000000000000',
  });
  expect(value.input.message).toHaveLength(4000);
  expect(value.input.items).toHaveLength(30);
  expect(JSON.stringify(value.input.nested)).toContain('[TRUNCATED]');
  expect(value.input).not.toHaveProperty('requestId');
  expect(Object.keys(value.input)).toHaveLength(31);
});
