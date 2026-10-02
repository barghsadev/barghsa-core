import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useFormDraft, type DraftSchema } from './useFormDraft.js';

const schema: DraftSchema<{ text: string }> = {
  safeParse(value) {
    return value && typeof value === 'object' && 'text' in value && typeof value.text === 'string'
      ? { success: true, data: value as { text: string } }
      : { success: false };
  },
};
const first = '/api/solar/requests/draft?profileId=first';
const second = '/api/solar/requests/draft?profileId=second';
const response = (value: unknown) => new Response(JSON.stringify(value));
const stored = { currentStep: 2, data: { text: 'saved' }, updatedAt: null };

async function harness() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let result: ReturnType<typeof useFormDraft<{ text: string }>>;
  function Harness({ draftKey }: { draftKey: string | null }) {
    result = useFormDraft(draftKey, schema, 4);
    return null;
  }
  const render = async (key: string | null) => {
    await act(async () => root.render(<Harness draftKey={key} />));
  };
  await render(first);
  return {
    get current() {
      return result!;
    },
    render,
    async close() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'barghsa_csrf=; Max-Age=0; path=/';
});

it.each([
  { currentStep: 3, data: { text: 'other' } },
  { currentStep: 2, data: { text: 'new' } },
  { currentStep: 3, data: null },
  { profileId: 'other', currentStep: 3, data: { text: 'new' } },
])(
  'rejects a mismatched draft save receipt without replacing the saved draft: %j',
  async (receipt) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, options?: RequestInit) =>
        response(options?.method === 'PUT' ? receipt : stored)
      )
    );
    const view = await harness();
    try {
      await act(async () => {
        await expect(view.current.save(3, { text: 'new' })).rejects.toThrow('Invalid saved draft');
      });
      expect(view.current.draft).toEqual(stored);
    } finally {
      await view.close();
    }
  }
);

it.each([0, 5, 1.5])('rejects an out-of-range loaded step %s', async (currentStep) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response({ ...stored, currentStep }))
  );
  const view = await harness();
  try {
    expect(view.current.error).toBe(true);
    expect(view.current.draft).toBeNull();
  } finally {
    await view.close();
  }
});

it('reads the live CSRF cookie and accepts a matching saved receipt', async () => {
  const requests: RequestInit[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (!options?.method) return response(stored);
      requests.push(options);
      return response({ ...JSON.parse(options.body as string), updatedAt: null });
    })
  );
  const view = await harness();
  try {
    document.cookie = 'barghsa_csrf=rotated; path=/';
    await act(async () => {
      await view.current.save(4, { text: 'latest' });
    });
    expect(new Headers(requests[0]?.headers).get('x-csrf-token')).toBe('rotated');
    expect(view.current.draft).toMatchObject({ currentStep: 4, data: { text: 'latest' } });
  } finally {
    await view.close();
  }
});

it('rejects an old-profile save completion after a profile switch', async () => {
  let finish!: (value: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) =>
      options?.method === 'PUT'
        ? new Promise<Response>((resolve) => {
            finish = resolve;
          })
        : response(url === first ? stored : { ...stored, data: { text: 'second profile' } })
    )
  );
  const view = await harness();
  try {
    let saving!: Promise<unknown>;
    await act(async () => {
      saving = view.current.save(3, { text: 'first profile' }).catch((error: unknown) => error);
    });
    await view.render(second);
    await act(async () => {
      finish(response({ currentStep: 3, data: { text: 'first profile' } }));
      await saving;
    });
    expect(await saving).toBeInstanceOf(Error);
    expect(view.current.draft?.data).toEqual({ text: 'second profile' });
    await view.render(null);
    expect(view.current.draft).toBeNull();
    expect(view.current.error).toBe(false);
  } finally {
    await view.close();
  }
});

it('ignores a late read from the previous profile', async () => {
  let finish!: (value: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url === first
        ? new Promise<Response>((resolve) => {
            finish = resolve;
          })
        : response({ ...stored, data: { text: 'second profile' } })
    )
  );
  const view = await harness();
  try {
    await view.render(second);
    await act(async () => {
      finish(response(stored));
    });
    expect(view.current.draft?.data).toEqual({ text: 'second profile' });
    expect(view.current.loading).toBe(false);
  } finally {
    await view.close();
  }
});

it('rejects a save completion after retry replaced its hydration generation', async () => {
  let finish!: (value: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) =>
      options?.method === 'PUT'
        ? new Promise<Response>((resolve) => {
            finish = resolve;
          })
        : response(stored)
    )
  );
  const view = await harness();
  try {
    let saving!: Promise<unknown>;
    await act(async () => {
      saving = view.current.save(3, { text: 'new' }).catch((error: unknown) => error);
    });
    await act(async () => view.current.retry());
    await act(async () => {
      finish(response({ currentStep: 3, data: { text: 'new' } }));
      await saving;
    });
    expect(await saving).toBeInstanceOf(Error);
    expect(view.current.draft).toEqual(stored);
  } finally {
    await view.close();
  }
});
