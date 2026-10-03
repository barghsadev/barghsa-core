import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import TosContent from './TosContent.js';

beforeAll(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));
afterAll(() => vi.unstubAllGlobals());

it.each(['fa', 'en'] as const)(
  'renders %s terms with safe Markdown, literal HTML and sanitized unsafe links',
  async (language) => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const content = `## Terms

**Retained text** and [safe link](https://example.test/terms).

[Blocked Markdown link](javascript:alert%281%29)

<script>globalThis.untrustedTerms = true</script>
<img src=x onerror="globalThis.untrustedTerms = true">
<iframe src="https://example.test/embedded"></iframe>
<a href="javascript:alert(1)" onclick="alert(1)">Blocked link</a>
<p class="injected" style="display:none" data-private="x" aria-hidden="true">Visible text</p>`;
    try {
      await act(async () => root.render(<TosContent content={content} language={language} />));
      const wrapper = host.firstElementChild!;
      expect(wrapper.getAttribute('dir')).toBe(language === 'fa' ? 'rtl' : 'ltr');
      expect(wrapper.getAttribute('lang')).toBe(language);
      expect(host.querySelector('h2')?.textContent).toBe('Terms');
      expect(host.querySelector('strong')?.textContent).toBe('Retained text');
      expect(host.querySelector('a[href="https://example.test/terms"]')?.textContent).toBe(
        'safe link'
      );
      expect(host.querySelector('script, img, iframe, [onclick], [onerror]')).toBeNull();
      expect(host.querySelector('a[href^="javascript:"]')).toBeNull();
      const blocked = Array.from(host.querySelectorAll('a')).find(
        (link) => link.textContent === 'Blocked Markdown link'
      );
      expect(blocked).toBeDefined();
      expect(blocked?.getAttribute('href')).toBeNull();
      expect(host.querySelector('.injected, [style], [data-private], [aria-hidden]')).toBeNull();
      expect(host.textContent).toContain('Visible text');
      expect(host.textContent).toContain('<script>globalThis.untrustedTerms = true</script>');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  }
);
