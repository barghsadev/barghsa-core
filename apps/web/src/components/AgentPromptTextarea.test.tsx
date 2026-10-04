import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AgentPromptTextarea, promptParts } from './AgentPromptTextarea.js';
it.each([
  '',
  '# Guidance\n\n- Use facts\n- Ask questions\n\nReturn `JSON` with **sources**.',
  '# راهنما\nدستورهای فارسی با `code` و **تأکید**.\n',
  '<script>private()</script> <img src="https://example.test/pixel" onerror="private()">',
  'First\r\nSecond\r\n',
  'Last blank line\n\n',
  'a'.repeat(8000),
  '*'.repeat(8000),
])('highlighting preserves exact source (%#)', (source) => {
  expect(
    promptParts(source)
      .map((part) => part.text)
      .join('')
  ).toBe(source);
});
it('highlights Markdown source without making HTML or links interactive', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'),
    root = createRoot(host);
  document.body.append(host);
  try {
    const source =
      '# Header\n\nLiteral `code` and [link](https://example.test)\n\n<script>private()</script>';
    await act(async () =>
      root.render(<AgentPromptTextarea value={source} readOnly aria-label="Instructions" />)
    );
    const textarea = host.querySelector('textarea')!,
      pre = host.querySelector('pre')!;
    expect(textarea.value).toBe(source);
    expect(pre.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelectorAll('script,a,img')).toHaveLength(0);
    expect(pre.textContent?.replace(/\u200b$/, '')).toBe(source);
    expect(pre.querySelectorAll('span[class*=text-]')).toHaveLength(3);
    Object.defineProperty(textarea, 'scrollTop', { value: 48 });
    Object.defineProperty(textarea, 'scrollLeft', { value: 12 });
    await act(async () => textarea.dispatchEvent(new Event('scroll', { bubbles: true })));
    expect(pre.scrollTop).toBe(48);
    expect(pre.scrollLeft).toBe(12);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
