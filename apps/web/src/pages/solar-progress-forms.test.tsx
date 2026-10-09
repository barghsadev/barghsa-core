import { QueryComponentProvider } from '../test/query-provider.js';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type * as FormModule from '@barghsa/ui/form';
import { tSolar } from '@barghsa/i18n/solar';
import { ErrorCodes } from '@barghsa/shared/errors';
import { AdminSolarConstructionPage } from './AdminSolarConstructionPage.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { parseListQuery, type ListQueryBinding } from '../hooks/useListQuery.js';
import { solarConstructionQueryOptions } from '../lib/solar-construction-query.js';
import {
  constructionContract,
  constructionOlder,
  constructionProgress,
  constructionRequest,
  constructionRow,
} from '../test/solar-progress-fixtures.js';

const gate = vi.hoisted(() => ({ wait: null as Promise<void> | null, started: 0 }));
vi.mock('@barghsa/ui/form', async (importOriginal) => {
  const actual = await importOriginal<typeof FormModule>();
  return {
    ...actual,
    useZodForm: (
      schema: Parameters<typeof actual.useZodForm>[0],
      options: Parameters<typeof actual.useZodForm>[1]
    ) =>
      actual.useZodForm(
        typeof schema === 'function'
          ? async () => {
              const wait = gate.wait;
              if (wait) {
                gate.started++;
                await wait;
              }
              return schema();
            }
          : schema,
        options
      ),
  };
});
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    className,
  }: {
    children: ReactNode;
    to: string;
    params?: Record<string, string>;
    className?: string;
  }) => (
    <a
      href={Object.entries(params ?? {}).reduce(
        (path, [key, value]) => path.replace(`$${key}`, encodeURIComponent(value)),
        to
      )}
      className={className}
    >
      {children}
    </a>
  ),
}));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ format: (value: string) => value, notice: null }),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.lang = 'fa';
  gate.wait = null;
  gate.started = 0;
});
const copy = (key: string, locale: 'en' | 'fa' = 'en') => tSolar(key, locale);
const invalid = (fields: unknown[]) =>
  Response.json(
    {
      error: {
        code: ErrorCodes.VALIDATION_INPUT_INVALID.code,
        message: 'PRIVATE error',
        correlationId: constructionRequest,
        fields,
      },
    },
    { status: 400 }
  );
const rejection = () =>
  Response.json(
    {
      error: {
        code: ErrorCodes.CONFLICT_STATE.code,
        message: 'PRIVATE conflict',
        correlationId: constructionRequest,
      },
    },
    { status: 409 }
  );
function review(body: Record<string, unknown>, progress = constructionProgress()) {
  return {
    schemaVersion: 1,
    hash: 'a'.repeat(64),
    scope: {
      action: 'solar.construction.record',
      profileId: progress.profileId,
      resourceId: progress.requestId,
    },
    data: {
      command: body,
      contractId: progress.contractId,
      contractState: progress.contractState,
      versionId: constructionContract,
      revision: progress.revision,
      previousStage: progress.events.at(-1)?.stage ?? null,
      customerVisible: true,
      collectsPayment: false,
      changesContract: false,
    },
  };
}
function saved(note: string) {
  const value = constructionProgress(1);
  value.events[0]!.note = note;
  return value;
}
function fill(node: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), 'value')!.set!.call(node, value);
  node.dispatchEvent(new Event('input', { bubbles: true }));
}
function button(host: ParentNode, text: string) {
  const value = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (node) => node.textContent?.trim() === text
  );
  expect(value, text).toBeDefined();
  return value!;
}
async function mount(
  override: (url: string, init?: RequestInit) => Promise<Response | undefined>,
  locale: 'en' | 'fa' = 'en'
) {
  document.documentElement.lang = locale;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let selected: string | null = constructionRequest;
  let actor = 'construction-staff';
  const previews: Array<Record<string, unknown>> = [],
    writes: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        if (url.endsWith('/review')) previews.push(JSON.parse(String(init.body)));
        else if (url !== '/api/auth/step-up') writes.push(String(init.body));
      }
      const result = await override(url, init);
      if (result) return result;
      if (init?.method === 'POST' && url.endsWith('/review'))
        return Response.json(
          review(
            JSON.parse(String(init.body)) as Record<string, unknown>,
            constructionProgress(0, selected!)
          )
        );
      if (url.includes('/construction?'))
        return Response.json({
          items: [constructionRow(), constructionRow(constructionOlder)],
          nextBefore: null,
        });
      if (!init?.method) return Response.json(constructionProgress(0, selected!));
      return invalid(['note']);
    })
  );
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const queries: ListQueryBinding = {
    query: parseListQuery({}, solarConstructionQueryOptions),
    params: new URLSearchParams(),
    searchInput: '',
    setSearchInput: vi.fn(),
    setQuery: vi.fn(),
    clear: vi.fn(),
    hasPrevious: false,
    previous: vi.fn(),
    canAdvance: () => false,
    next: vi.fn(),
  };
  const render = () =>
    root.render(
      <QueryComponentProvider>
        {
          <AccountUserProvider value={actor}>
            <AdminSolarConstructionPage
              queries={queries}
              selected={selected}
              onSelect={(id) => {
                selected = id;
                render();
              }}
            />
          </AccountUserProvider>
        }
      </QueryComponentProvider>
    );
  await act(async () => render());
  const note = () => host.querySelector<HTMLTextAreaElement>('#solar-construction-note')!;
  await vi.waitFor(() => expect(note()).not.toBeNull());
  const click = async (label: string, owner: ParentNode = host) =>
    act(async () => button(owner, label).click());
  const submit = async () =>
    act(async () =>
      host
        .querySelector('form[aria-label]')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
  return {
    host,
    note,
    previews,
    writes,
    submit,
    click,
    change: async (value: string) => act(async () => fill(note(), value)),
    reload: async (recovery = false) =>
      act(async () =>
        host
          .querySelector<HTMLButtonElement>(
            recovery ? '#solar-construction-recovery-reload' : '#solar-construction-reload'
          )!
          .click()
      ),
    select: async (id: string) =>
      act(async () => {
        selected = id;
        render();
      }),
    actor: async (value: string) =>
      act(async () => {
        actor = value;
        render();
      }),
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
const opened = () =>
  vi.waitFor(() => expect(document.querySelector('[role=dialog]')).not.toBeNull());
const missing = () =>
  Response.json(
    {
      error: {
        code: ErrorCodes.NOT_FOUND_RESOURCE.code,
        message: 'Private missing resource',
        correlationId: constructionRequest,
      },
    },
    { status: 404 }
  );

it.each(['detail', 'review', 'record'] as const)(
  'withdraws private missing construction resources during %s',
  async (phase) => {
    let denied = false;
    const view = await mount(async (url, init) => {
      if (!denied) return undefined;
      if (phase === 'detail' && !init?.method && !url.includes('?')) return missing();
      if (phase === 'review' && url.endsWith('/review')) return missing();
      if (phase === 'record' && init?.method === 'POST' && !url.endsWith('/review'))
        return missing();
      return undefined;
    });
    try {
      await view.change('PRIVATE construction draft');
      denied = true;
      if (phase === 'detail') await view.reload();
      else {
        await view.submit();
        if (phase === 'record') {
          await opened();
          await view.click('Confirm', document);
        }
      }
      await vi.waitFor(() => expect(view.note()).toBeNull());
      await vi.waitFor(() =>
        expect(view.host.querySelectorAll('button[aria-pressed]')).toHaveLength(0)
      );
      expect(document.querySelector('[role=dialog]')).toBeNull();
      expect(view.host.textContent).not.toMatch(/PRIVATE|Private missing resource/);
      denied = false;
      await view.actor('new-authorized-staff');
      await vi.waitFor(() => expect(view.note()?.value).toBe(''));
    } finally {
      await view.close();
    }
  }
);

it('ignores a stale missing construction response after a new selection accepts its own draft', async () => {
  let release!: (value: Response) => void,
    hold = false;
  const view = await mount(async (url, init) => {
    if (hold && !init?.method && url.endsWith(`/${constructionRequest}`))
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    return undefined;
  });
  try {
    hold = true;
    await view.reload();
    await vi.waitFor(() => expect(release).toBeDefined());
    await view.select(constructionOlder);
    await vi.waitFor(() => expect(view.note()).not.toBeNull());
    await view.change('New selection private draft');
    await act(async () => release(missing()));
    expect(view.note().value).toBe('New selection private draft');
    expect(view.host.querySelectorAll('button[aria-pressed]')).toHaveLength(2);
    expect(view.host.textContent).not.toContain(copy('staffQueueForbidden'));
  } finally {
    await view.close();
  }
});

it.each(['en', 'fa'] as const)(
  'links touched construction errors, exact note bounds and raw owned feedback (%s)',
  async (locale) => {
    const view = await mount(
      async (url) => (url.endsWith('/review') ? invalid(['note']) : undefined),
      locale
    );
    try {
      expect(button(view.host, copy('constructionReview', locale)).disabled).toBe(false);
      await view.submit();
      await vi.waitFor(() => expect(document.activeElement?.id).toBe('solar-construction-note'));
      expect(view.note().getAttribute('aria-invalid')).toBe('true');
      expect(view.note().getAttribute('aria-describedby')).toContain(
        'solar-construction-note-message'
      );
      expect(view.host.querySelector('label[for=solar-construction-note]')).not.toBeNull();
      const message = view.host.querySelector('#solar-construction-note-message')!;
      expect(message.textContent).toBe(copy('progressNoteInvalid', locale));
      expect(message.parentElement?.querySelector('[aria-hidden=true]')?.textContent).toBe(
        message.textContent
      );
      expect(view.previews).toEqual([]);
      await view.change('x'.repeat(1001));
      await view.submit();
      await vi.waitFor(() => expect(view.note().disabled).toBe(false));
      expect(view.previews).toEqual([]);
      const raw = ` ${'x'.repeat(1000)} `;
      await view.change(raw);
      await view.submit();
      await vi.waitFor(() => expect(view.previews).toHaveLength(1));
      await vi.waitFor(() => expect(document.activeElement?.id).toBe('solar-construction-note'));
      expect(view.previews[0]?.note).toBe(raw.trim());
      expect(view.note().value).toBe(raw);
      expect(view.writes).toEqual([]);
      expect(view.host.textContent).not.toContain('PRIVATE');
    } finally {
      await view.close();
    }
  }
);

it('rejects mixed protected preview feedback and malformed review receipts without clearing the valid note', async () => {
  let malformed = false;
  const view = await mount(async (url) =>
    url.endsWith('/review')
      ? malformed
        ? Response.json({ hash: 'a'.repeat(64) })
        : invalid(['note', 'expectedRevision'])
      : undefined
  );
  try {
    await view.change('  Keep this update  ');
    await view.submit();
    await vi.waitFor(() => expect(view.host.textContent).toContain(copy('constructionSaveError')));
    expect(view.note().value).toBe('  Keep this update  ');
    expect(view.note().getAttribute('aria-invalid')).not.toBe('true');
    expect(view.host.textContent).not.toMatch(/PRIVATE|expectedRevision/);
    malformed = true;
    await view.submit();
    await vi.waitFor(() => expect(view.previews).toHaveLength(2));
    await vi.waitFor(() => expect(view.note().disabled).toBe(false));
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(view.writes).toEqual([]);
  } finally {
    await view.close();
  }
});

it('blocks same-tick lazy submissions and discards stale validation or held preview after selection changes', async () => {
  let resolveSchema!: () => void, resolvePreview!: (value: Response) => void;
  let hold = false;
  const view = await mount(async (url) => {
    if (hold && url.endsWith('/review'))
      return new Promise<Response>((resolve) => {
        resolvePreview = resolve;
      });
    return undefined;
  });
  try {
    await view.change(' Old note ');
    gate.wait = new Promise<void>((resolve) => {
      resolveSchema = resolve;
    });
    await act(async () => {
      view.host
        .querySelector('form[aria-label]')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      view.host
        .querySelector('form[aria-label]')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(gate.started).toBe(1));
    await view.select(constructionOlder);
    await act(async () => {
      gate.wait = null;
      resolveSchema();
    });
    expect(view.previews).toEqual([]);
    expect(document.querySelector('[role=dialog]')).toBeNull();
    await vi.waitFor(() => expect(view.note().disabled).toBe(false));
    await view.change(' New selection note ');
    hold = true;
    await view.submit();
    await vi.waitFor(() => expect(resolvePreview).toBeDefined());
    const held = view.previews[0]!;
    await act(async () =>
      view.host.querySelector<HTMLButtonElement>('button[aria-pressed=false]')!.click()
    );
    expect(view.host.querySelectorAll('button[aria-pressed]')).toHaveLength(2);
    await act(async () =>
      resolvePreview(Response.json(review(held, constructionProgress(0, constructionOlder))))
    );
    await vi.waitFor(() => expect(view.note().disabled).toBe(false));
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(view.note().value).toBe('');
    expect(view.writes).toEqual([]);
  } finally {
    await view.close();
  }
});

it('preserves an independent refresh draft and retries exactly through step-up with no duplicate command', async () => {
  let resolveWrite!: (value: Response) => void;
  let verify = 0;
  const view = await mount(async (url, init) => {
    if (url === '/api/auth/step-up') {
      verify++;
      return Response.json({ verified: true });
    }
    if (init?.method === 'POST' && !url.endsWith('/review')) {
      if (!verify)
        return Response.json(
          { error: { code: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code } },
          { status: 403 }
        );
      return new Promise<Response>((resolve) => {
        resolveWrite = resolve;
      });
    }
    return undefined;
  });
  try {
    await view.change('  Immutable construction note  ');
    await view.reload();
    await vi.waitFor(() => expect(view.note()?.value).toBe('  Immutable construction note  '));
    await view.submit();
    await opened();
    await view.click('Confirm', document);
    await vi.waitFor(() => expect(document.querySelector('#team-step-up-password')).not.toBeNull());
    await act(async () => {
      const node = document.querySelector<HTMLInputElement>('#team-step-up-password')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        node,
        'test-only-password'
      );
      node.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await view.click('Confirm', document);
    await vi.waitFor(() => expect(resolveWrite).toBeDefined());
    await act(async () =>
      document
        .querySelector('[role=dialog] form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
    expect(verify).toBe(1);
    expect(view.writes).toHaveLength(2);
    expect(view.writes[0]).toBe(view.writes[1]);
    expect(JSON.parse(view.writes[1]!).expectedReviewHash).toBe('a'.repeat(64));
    await act(async () => resolveWrite(Response.json(saved('Immutable construction note'))));
    await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).toBeNull());
    await vi.waitFor(() => expect(view.note()?.value).toBe(''));
  } finally {
    await view.close();
  }
});

it('retains ambiguous commands through old or unrelated reads and offers an exact captured retry', async () => {
  let reads = constructionProgress(),
    attempt = 0;
  const view = await mount(async (url, init) => {
    if (init?.method === 'POST' && !url.endsWith('/review'))
      return ++attempt === 1
        ? new Response('{}', { status: 503 })
        : Response.json(saved('Captured update'));
    if (!init?.method && !url.includes('?')) return Response.json(reads);
    return undefined;
  });
  try {
    await view.change(' Captured update ');
    await view.submit();
    await opened();
    await view.click('Confirm', document);
    await vi.waitFor(() => expect(button(document, 'Confirm').disabled).toBe(true));
    await view.click('Cancel', document);
    expect(view.note().value).toBe(' Captured update ');
    await view.reload(true);
    await vi.waitFor(() => expect(view.note()?.disabled).toBe(true));
    reads = saved('Unrelated update');
    await view.reload(true);
    await vi.waitFor(() => expect(view.note()?.disabled).toBe(true));
    expect(button(view.host, copy('constructionReview')).disabled).toBe(true);
    await view.click(copy('progressRetryCommand'));
    await opened();
    await view.click('Cancel', document);
    expect(view.note().disabled).toBe(true);
    await view.click(copy('progressRetryCommand'));
    await opened();
    await view.click('Confirm', document);
    await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).toBeNull());
    expect(view.previews).toHaveLength(1);
    expect(view.writes).toHaveLength(2);
    expect(view.writes[0]).toBe(view.writes[1]);
    expect(view.note().value).toBe('');
  } finally {
    await view.close();
  }
});

it('recovers only after a fresh exact event and rejects malformed history without losing the captured note', async () => {
  let reads: unknown = constructionProgress();
  const view = await mount(async (url, init) => {
    if (init?.method === 'POST' && !url.endsWith('/review'))
      return Response.json(constructionProgress(1, constructionOlder));
    if (!init?.method && !url.includes('?')) return Response.json(reads);
    return undefined;
  });
  try {
    await view.change(' Exact progress note ');
    await view.submit();
    await opened();
    await view.click('Confirm', document);
    await vi.waitFor(() => expect(button(document, 'Confirm').disabled).toBe(true));
    await view.click('Cancel', document);
    reads = { ...constructionProgress(1), events: [null] };
    await view.reload(true);
    await vi.waitFor(() => expect(view.note()).toBeNull());
    expect(view.host.textContent).toContain(copy('constructionDetailError'));
    reads = saved('Wrong note');
    await view.reload(true);
    await vi.waitFor(() => expect(view.note()?.value).toBe(' Exact progress note '));
    expect(view.note().disabled).toBe(true);
    reads = saved('Exact progress note');
    await view.reload(true);
    await vi.waitFor(() => expect(view.note()?.value).toBe(''));
    expect(view.note().disabled).toBe(false);
    expect(view.writes).toHaveLength(1);
  } finally {
    await view.close();
  }
});

it('allows correction after a complete no-write rejection while unknown envelopes stay locked', async () => {
  let malformed = false;
  const view = await mount(async (url, init) =>
    init?.method === 'POST' && !url.endsWith('/review')
      ? malformed
        ? Response.json({ error: { code: ErrorCodes.CONFLICT_STATE.code } }, { status: 409 })
        : rejection()
      : undefined
  );
  try {
    await view.change(' Valid raw note ');
    await view.submit();
    await opened();
    await view.click('Confirm', document);
    await view.click('Cancel', document);
    expect(view.note().disabled).toBe(false);
    expect(view.note().value).toBe(' Valid raw note ');
    malformed = true;
    await view.submit();
    await opened();
    await view.click('Confirm', document);
    await view.click('Cancel', document);
    expect(view.note().disabled).toBe(true);
    expect(view.host.textContent).not.toContain('PRIVATE');
  } finally {
    await view.close();
  }
});

it('withdraws private work after denied confirmation and fences a late read from the previous actor', async () => {
  let release!: (value: Response) => void,
    hold = false;
  const view = await mount(async (url, init) => {
    if (init?.method === 'POST' && !url.endsWith('/review'))
      return new Response('{}', { status: 403 });
    if (hold && !init?.method && !url.includes('?'))
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    return undefined;
  });
  try {
    await view.change('PRIVATE note');
    hold = true;
    await view.reload();
    await vi.waitFor(() => expect(release).toBeDefined());
    hold = false;
    await view.actor('new-staff');
    await vi.waitFor(() => expect(view.note()).not.toBeNull());
    await view.change('New staff draft');
    await act(async () => release(Response.json(constructionProgress())));
    expect(view.note().value).toBe('New staff draft');
    await view.submit();
    await opened();
    await view.click('Confirm', document);
    await vi.waitFor(() => expect(view.note()).toBeNull());
    expect(view.host.querySelectorAll('button[aria-pressed]')).toHaveLength(0);
    expect(view.host.textContent).not.toMatch(/PRIVATE|New staff draft|Verified <script>/);
  } finally {
    await view.close();
  }
});
