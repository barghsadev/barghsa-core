import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PublicKnowledgeAssistant, StaffKnowledgeAssistant } from './PublicKnowledgeAssistant.js';
import { t } from '@barghsa/i18n/app';

const answer = {
  reply: 'Published answer.',
  sources: [
    {
      kbId: '01900000-0000-7000-8000-000000000001',
      title: 'Guide',
      documentTitle: 'guide.txt',
      excerpt: '<script>literal source</script>',
    },
  ],
  attribution: 'retrieved_context',
  remainingQuota: 4,
  policyChecks: [],
  answeredAt: '2026-10-08T01:00:00.000Z',
};
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.cookie = 'barghsa_csrf=; Max-Age=0; path=/';
});
async function render(locale: 'en' | 'fa' = 'en') {
  await act(async () => root.render(<PublicKnowledgeAssistant locale={locale} />));
}
async function fill(value: string) {
  const input = host.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
      input,
      value
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}

it.each(['en', 'fa'] as const)(
  'asks with no cookies or history and renders literal sources (%s)',
  async (locale) => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ available: true }))
      .mockResolvedValueOnce(Response.json(answer));
    vi.stubGlobal('fetch', fetcher);
    await render(locale);
    await fill('Question');
    await submit();
    expect(host.textContent).toContain(answer.reply);
    const requests = fetcher.mock.calls as unknown as [string, RequestInit][];
    expect(requests.map(([url]) => url)).toEqual([
      '/api/public/knowledge/availability',
      '/api/public/knowledge/questions',
    ]);
    expect(requests.every(([, options]) => options.credentials === 'omit')).toBe(true);
    expect(JSON.parse(requests[1]![1].body as string)).toEqual({ message: 'Question' });
    expect(host.querySelector('textarea')!.value).toBe('');
    expect(host.textContent).toContain(answer.sources[0]!.excerpt);
    expect(host.querySelector('script')).toBeNull();
    expect(host.querySelector('[data-message-role="user"] time')?.getAttribute('aria-label')).toBe(
      t('assistant.sentAt', locale)
    );
  }
);
it('keeps invalid questions local with owned accessible feedback', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ available: true }));
  vi.stubGlobal('fetch', fetcher);
  await render();
  await fill('   ');
  await submit();
  const input = host.querySelector('textarea')!;
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(document.activeElement).toBe(input);
  expect(input.getAttribute('aria-describedby')).toContain('public-knowledge-error');
  expect(host.textContent).toContain(t('assistant.public.invalid', 'en'));
  expect(fetcher).toHaveBeenCalledOnce();
});
it('holds the server cooldown and preserves the question for an explicit retry', async () => {
  vi.useFakeTimers();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ available: true }))
    .mockResolvedValueOnce(
      Response.json(
        { error: { code: 'RATE_LIMIT:EXCEEDED' } },
        { status: 429, headers: { 'Retry-After': '3' } }
      )
    )
    .mockResolvedValueOnce(Response.json(answer));
  vi.stubGlobal('fetch', fetcher);
  await render();
  await fill('Question');
  await submit();
  expect(host.querySelector('button[type=submit]')!.hasAttribute('disabled')).toBe(true);
  await submit();
  expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async () => vi.advanceTimersByTimeAsync(3000));
  await submit();
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(host.textContent).toContain(answer.reply);
});
it('drops revoked scope and checks availability again without replaying a question', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ available: true }))
    .mockResolvedValueOnce(
      Response.json({ error: { code: 'AI_WEBSITE_SCOPE_CHANGED' } }, { status: 409 })
    )
    .mockResolvedValueOnce(Response.json({ available: true }));
  vi.stubGlobal('fetch', fetcher);
  await render();
  await fill('Question');
  await submit();
  expect(host.querySelector('textarea')).toBeNull();
  const refresh = host.querySelector('button')!;
  expect(refresh.textContent).toBe(t('assistant.public.refresh', 'en'));
  await act(async () => refresh.click());
  expect(host.querySelector('textarea')).not.toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(host.querySelector('[data-message-role]')).toBeNull();
});
it('aborts a pending answer on locale change and refuses its late result', async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ available: true }))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        })
    )
    .mockResolvedValueOnce(Response.json({ available: true }));
  vi.stubGlobal('fetch', fetcher);
  await render();
  await fill('Question');
  await submit();
  const signal = (fetcher.mock.calls[1]![1] as RequestInit).signal!;
  await render('fa');
  expect(signal.aborted).toBe(true);
  await act(async () => finish(Response.json(answer)));
  expect(host.textContent).not.toContain(answer.reply);
  expect(host.querySelector('button[type=submit]')!.hasAttribute('disabled')).toBe(false);
});
it('refuses malformed success metadata and never renders a raw error message', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ available: true }))
    .mockResolvedValueOnce(Response.json({ ...answer, sources: [] }))
    .mockResolvedValueOnce(
      Response.json({ error: { message: 'PRIVATE_SERVER_DETAIL' } }, { status: 503 })
    );
  vi.stubGlobal('fetch', fetcher);
  await render();
  await fill('Question');
  await submit();
  expect(host.textContent).not.toContain(answer.reply);
  expect(host.querySelector('textarea')!.value).toBe('Question');
  await submit();
  expect(host.textContent).not.toContain('PRIVATE_SERVER_DETAIL');
  expect(host.textContent).toContain(t('assistant.public.failure', 'en'));
});

it.each(['en', 'fa'] as const)(
  'staff questions include current CSRF and clear retained answers after authority loss (%s)',
  async (locale) => {
    document.cookie = 'barghsa_csrf=staff-owned-token; path=/';
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ available: true }))
      .mockResolvedValueOnce(Response.json(answer))
      .mockResolvedValueOnce(
        Response.json({ error: { code: 'AUTHZ:FORBIDDEN' } }, { status: 403 })
      );
    vi.stubGlobal('fetch', fetcher);
    await act(async () => root.render(<StaffKnowledgeAssistant locale={locale} />));
    expect(host.textContent).toContain(t('assistant.staff.title', locale));
    expect(host.textContent).toContain(t('assistant.staff.scope', locale));
    await fill('Staff question');
    await submit();
    expect(host.textContent).toContain(answer.reply);
    document.cookie = 'barghsa_csrf=rotated-owned-token; path=/';
    await fill('Next staff question');
    await submit();
    expect(host.textContent).not.toContain(answer.reply);
    expect(host.querySelector('textarea')).toBeNull();
    const requests = fetcher.mock.calls as unknown as [string, RequestInit][];
    expect(requests.map(([url]) => url)).toEqual([
      '/api/staff/knowledge/availability',
      '/api/staff/knowledge/questions',
      '/api/staff/knowledge/questions',
    ]);
    expect(requests.every(([, r]) => r.credentials === 'include')).toBe(true);
    expect(new Headers(requests[1]![1].headers).get('x-csrf-token')).toBe('staff-owned-token');
    expect(new Headers(requests[2]![1].headers).get('x-csrf-token')).toBe('rotated-owned-token');
    expect(JSON.parse(requests[1]![1].body as string)).toEqual({ message: 'Staff question' });
    expect(JSON.parse(requests[2]![1].body as string)).toEqual({ message: 'Next staff question' });
  }
);
