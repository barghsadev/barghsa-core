import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readTestChatResult } from '../lib/assistant-chat.js';
import { ResponseMetadataPanel } from './ResponseMetadataPanel.js';

const id = '01900000-0000-7000-8000-000000000001';
const answer = {
  conversationId: id,
  reply: 'Verified response',
  attribution: 'retrieved_context',
  sources: [{ kbId: id, title: 'Guide', documentTitle: 'Guide.txt', excerpt: 'Published excerpt' }],
  policyResults: [
    {
      id,
      title: 'Style',
      type: 'response_style',
      result: 'applied',
      priority: -20,
      ruleChecks: [
        { rule: 'tone', outcome: 'applied' },
        { rule: 'language', outcome: 'overridden' },
      ],
    },
  ],
  tokenUsage: { input: 9, output: 5 },
  latencyMs: 12,
  remainingQuota: 9,
};
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(value: unknown) {
  const result = readTestChatResult(value);
  expect(result).not.toBeNull();
  await act(async () => root.render(<ResponseMetadataPanel result={result!} locale="en" />));
}
const total = () =>
  [...host.querySelectorAll('dt')].find((node) => node.textContent === 'Total tokens')
    ?.nextElementSibling?.textContent;

it('renders totals and effective rule outcomes without promoting a superseded rule', async () => {
  await render(answer);
  expect(total()).toBe('14');
  expect(host.textContent).toContain('Response tone — Applied');
  expect(host.textContent).toContain('Response language — Superseded by another rule');
  expect(host.textContent).toContain('Priority: -20');
  expect(host.textContent).toContain('Guide / Guide.txt');
  expect(host.querySelectorAll('details')).toHaveLength(6);
});
it('keeps legacy policy details and null usage unavailable while reporting empty collections', async () => {
  await render({
    ...answer,
    sources: [],
    attribution: 'general_guidance',
    tokenUsage: null,
    policyResults: [{ id, title: 'Legacy style', type: 'response_style', result: 'applied' }],
  });
  expect(total()).toBe('Not recorded');
  expect(host.textContent).toContain('Priority: Not recorded');
  expect(host.textContent).toContain('Rule details were not recorded for this response.');
  expect(host.textContent).toContain('No knowledge sources were used.');
  expect(host.textContent).not.toContain('Response tone — Applied');
  await render({ ...answer, policyResults: [] });
  expect(host.textContent).toContain('No policies were applied.');
});
it('does not estimate overflowing token totals or interpret stored source/policy markup', async () => {
  await render({
    ...answer,
    tokenUsage: { input: Number.MAX_SAFE_INTEGER, output: 1 },
    sources: [
      {
        ...answer.sources[0],
        title: '<img src=x onerror=alert(1)>',
        excerpt: '<script>private()</script>',
      },
    ],
    policyResults: [
      { ...answer.policyResults[0], title: '<a href=javascript:private()>Policy</a>' },
    ],
  });
  expect(total()).toBe('Not recorded');
  expect(host.querySelector('img,script,a')).toBeNull();
  expect(host.textContent).toContain('<script>private()</script>');
  expect(host.textContent).toContain('<a href=javascript:private()>Policy</a>');
});
