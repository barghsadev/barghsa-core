import { QueryComponentProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@barghsa/i18n/app';
import { AdminAgentTestChat } from './AdminAgentTestChat.js';
import KnowledgeAssistantPanel from './KnowledgeAssistantPanel.js';
type Schemas = typeof import('../lib/catalogue-form-schemas.js');
const state = vi.hoisted(() => ({ gate: null as Promise<void> | null, unavailable: false }));
vi.mock('../lib/catalogue-form-schemas.js', async (original) => {
  const actual = await original<Schemas>();
  return {
    ...actual,
    contentFormSchema: async (...args: Parameters<Schemas['contentFormSchema']>) => {
      if (state.gate) await state.gate;
      if (state.unavailable) throw new Error('Unavailable');
      return actual.contentFormSchema(...args);
    },
  };
});
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ format: () => '12:00', notice: null }),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));
const id = '01900000-0000-7000-8000-000000000001';
const answer = {
  reply: 'Verified guide answer',
  sources: [{ kbId: id, title: 'Guide', documentTitle: 'Guide.txt', excerpt: 'Published excerpt' }],
  attribution: 'retrieved_context',
  remainingQuota: 4,
};
const result = {
  ...answer,
  conversationId: id,
  policyResults: [],
  tokenUsage: { input: 9, output: 5 },
  latencyMs: 12,
  remainingQuota: 9,
};
let host: HTMLDivElement, root: Root;
beforeEach(async () => {
  await import('../lib/catalogue-form-schemas.js');
  state.gate = null;
  state.unavailable = false;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const input = () => host.querySelector<HTMLTextAreaElement>('textarea')!;
function button(text: string) {
  if (text === 'Retry' && host.querySelector('#knowledge-question'))
    text = t('assistant.retry', 'en');
  const node = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text
  );
  expect(node, text).toBeDefined();
  return node!;
}
async function fill(node: HTMLTextAreaElement | HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      node instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLTextAreaElement.prototype,
      'value'
    )!.set!.call(node, value);
    node.dispatchEvent(
      new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })
    );
  });
}
async function submit(times = 1) {
  const form = input().closest('form')!;
  await act(async () => {
    for (let i = 0; i < times; i++)
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}
async function settled() {
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(input().closest('form')!.getAttribute('aria-busy')).toBe('false');
  });
}
async function mount(
  kind: 'customer' | 'admin',
  profile = 'profile-1',
  enabled = true,
  disabled = false
) {
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        {kind === 'admin' ? (
          <AdminAgentTestChat
            agents={[{ id, title: 'Agent', enabled }]}
            locale="en"
            disabled={disabled}
          />
        ) : (
          <KnowledgeAssistantPanel
            embedded
            locale="en"
            profileId={profile}
            profileName="Customer"
            slotKey="individual_chatbot"
            open
            onOpenChange={() => {}}
          />
        )}
      </QueryComponentProvider>
    )
  );
}
async function prepare(kind: 'customer' | 'admin', message = '  Draft question  ') {
  await mount(kind);
  if (kind === 'admin') await fill(host.querySelector<HTMLSelectElement>('#test-chat-agent')!, id);
  await fill(input(), message);
}
for (const kind of ['customer', 'admin'] as const) {
  it(`${kind}: submission blur cannot overwrite owned server feedback with a late local validation`, async () => {
    let releaseResponse!: (response: Response) => void, releaseValidation!: () => void;
    const request = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          releaseResponse = resolve;
        })
    );
    vi.stubGlobal('fetch', request);
    await prepare(kind);
    await submit();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    state.gate = new Promise<void>((resolve) => {
      releaseValidation = resolve;
    });
    await act(async () => input().dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    await act(async () =>
      releaseResponse(
        Response.json(
          { error: { code: 'VALIDATION:INPUT:INVALID', fields: ['message'] } },
          { status: 400 }
        )
      )
    );
    await settled();
    expect(input().getAttribute('aria-invalid')).toBe('true');
    await act(async () => input().dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    await act(async () => {
      releaseValidation();
      state.gate = null;
    });
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(document.activeElement).toBe(input());
    });
    expect(input().getAttribute('aria-invalid')).toBe('true');
    expect(input().value).toBe('  Draft question  ');
  });
  it(`${kind}: focuses invalid fields, validates touched corrections, and preserves text`, async () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    await mount(kind);
    await submit();
    await settled();
    const field =
      kind === 'admin' ? host.querySelector<HTMLSelectElement>('#test-chat-agent')! : input();
    await vi.waitFor(() => expect(document.activeElement).toBe(field));
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(request).not.toHaveBeenCalled();
    if (kind === 'admin') await fill(field as HTMLSelectElement, id);
    const max = kind === 'admin' ? 4000 : 1000;
    await fill(input(), 'x'.repeat(max + 1));
    await submit();
    await settled();
    expect(input().value).toHaveLength(max + 1);
    expect(input().getAttribute('aria-invalid')).toBe('true');
    expect(request).not.toHaveBeenCalled();
    await fill(input(), 'Corrected question');
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(input().getAttribute('aria-invalid')).toBeNull();
    });
  });
  it(`${kind}: retains a failed draft and retries exactly once with the captured request ID`, async () => {
    let failed = true;
    const request = vi.fn(async (_url: RequestInfo | URL, _options: RequestInit) =>
      Response.json(failed ? {} : kind === 'admin' ? result : answer, {
        status: failed ? 503 : 200,
      })
    );
    vi.stubGlobal('fetch', request);
    await prepare(kind);
    await submit(2);
    await settled();
    expect(request).toHaveBeenCalledTimes(1);
    expect(input().value).toBe('  Draft question  ');
    expect(input().disabled).toBe(true);
    await submit();
    expect(request).toHaveBeenCalledTimes(1);
    failed = false;
    await act(async () => {
      button('Retry').click();
      button('Retry').click();
    });
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(input().value).toBe('');
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]![1].body).toEqual(request.mock.calls[0]![1].body);
    expect(host.textContent).toContain('Verified guide answer');
  });
  it(`${kind}: maps only owned server field names without reflecting remote messages`, async () => {
    let owned = true;
    const request = vi.fn(async () =>
      Response.json(
        {
          error: {
            code: 'VALIDATION:INPUT:INVALID',
            fields: owned ? ['message'] : ['privateField'],
            message: 'Private server detail',
          },
        },
        { status: 400 }
      )
    );
    vi.stubGlobal('fetch', request);
    await prepare(kind);
    await submit();
    await settled();
    await vi.waitFor(() => expect(document.activeElement).toBe(input()));
    expect(input().getAttribute('aria-invalid')).toBe('true');
    expect(input().value).toBe('  Draft question  ');
    expect(host.textContent).not.toContain('Private server detail');
    owned = false;
    await fill(input(), 'Corrected question');
    await submit();
    await settled();
    expect(host.textContent).not.toContain('privateField');
    expect(host.textContent).not.toContain('Private server detail');
  });
  it(`${kind}: never publishes a malformed success and preserves an idempotent retry`, async () => {
    const request = vi.fn(async () =>
      Response.json({ ...(kind === 'admin' ? result : answer), sources: null })
    );
    vi.stubGlobal('fetch', request);
    await prepare(kind);
    await submit();
    await settled();
    expect(host.textContent).not.toContain('Verified guide answer');
    expect(input().value).toBe('  Draft question  ');
    expect(button('Retry')).toBeDefined();
  });
  it(`${kind}: blocks duplicate submissions while validation loads and fails without sending`, async () => {
    let release!: () => void;
    state.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    await prepare(kind);
    await submit(2);
    expect(input().closest('form')!.getAttribute('aria-busy')).toBe('true');
    expect(request).not.toHaveBeenCalled();
    state.unavailable = true;
    await act(async () => {
      release();
    });
    await settled();
    expect(host.textContent).toContain('Validation could not load');
    expect(input().value).toBe('  Draft question  ');
    expect(request).not.toHaveBeenCalled();
    state.gate = null;
    state.unavailable = false;
  });
  it(`${kind}: withdraws validation when its context changes`, async () => {
    let release!: () => void;
    state.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    await prepare(kind);
    await submit();
    await mount(kind, 'profile-2', kind !== 'admin');
    await act(async () => {
      release();
    });
    await settled();
    expect(request).not.toHaveBeenCalled();
    expect(input().value).toBe('');
    state.gate = null;
  });
  it(`${kind}: erases private history and input on denial and blocks further writes`, async () => {
    let status = 200;
    const request = vi.fn(async () =>
      Response.json(status === 200 ? (kind === 'admin' ? result : answer) : {}, { status })
    );
    vi.stubGlobal('fetch', request);
    await prepare(kind);
    await submit();
    await settled();
    expect(host.textContent).toContain('Verified guide answer');
    status = 403;
    await fill(input(), 'Private next question');
    await submit();
    await settled();
    expect(host.textContent).not.toContain('Verified guide answer');
    expect(input().value).toBe('');
    expect(input().disabled).toBe(true);
    await submit();
    expect(request).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('Access to this conversation changed');
  });
  it(`${kind}: shows Retry-After and prevents both retries and new submits during cooldown`, async () => {
    const request = vi.fn(async () =>
      Response.json({}, { status: 429, headers: { 'Retry-After': '60' } })
    );
    vi.stubGlobal('fetch', request);
    await prepare(kind);
    await submit();
    await settled();
    expect(host.textContent).toContain('Try again in 60 seconds.');
    expect(button('Retry').disabled).toBe(true);
    await act(async () => button('Retry').click());
    await submit();
    expect(request).toHaveBeenCalledTimes(1);
  });
  it(`${kind}: aborts an in-flight request and ignores its late answer after context withdrawal`, async () => {
    let release!: (response: Response) => void;
    const request = vi.fn(
      (_url: string, _options: RequestInit) =>
        new Promise<Response>((resolve) => {
          release = resolve;
        })
    );
    vi.stubGlobal('fetch', request);
    await prepare(kind);
    await submit();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(input().value).toBe('  Draft question  ');
    expect(input().disabled).toBe(true);
    await mount(kind, 'profile-2', kind !== 'admin');
    expect((request.mock.calls[0]![1].signal as AbortSignal).aborted).toBe(true);
    await act(async () => release(Response.json(kind === 'admin' ? result : answer)));
    await settled();
    expect(host.textContent).not.toContain('Verified guide answer');
    expect(input().value).toBe('');
  });
}
it('customer: explicitly edits a failed question without losing text and restores focus', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({}, { status: 503 }))
  );
  await prepare('customer');
  await submit();
  await settled();
  await act(async () => button('Edit question').click());
  await vi.waitFor(() => expect(document.activeElement).toBe(input()));
  expect(input().value).toBe('  Draft question  ');
  expect(input().disabled).toBe(false);
  expect(host.querySelector('[role=log]')!.textContent).not.toContain('Draft question');
});
it('admin: refuses an answer for a different conversation and does not clear its next message', async () => {
  let other = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        ...result,
        conversationId: other ? '01900000-0000-7000-8000-000000000002' : id,
      })
    )
  );
  await prepare('admin');
  await submit();
  await settled();
  other = true;
  await fill(input(), 'Next question');
  await submit();
  await settled();
  expect(input().value).toBe('Next question');
  expect(host.querySelectorAll('[role=log] > div')).toHaveLength(1);
  expect(button('Retry')).toBeDefined();
});
