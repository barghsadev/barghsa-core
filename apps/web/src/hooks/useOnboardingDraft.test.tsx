import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useOnboardingDraft } from './useOnboardingDraft.js';

let root: Root, container: HTMLDivElement;
let draft: ReturnType<typeof useOnboardingDraft>;
let edit: (data: Record<string, string>) => void;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function Harness({ profile = 'one', legal = false }: { profile?: string; legal?: boolean }) {
  const [values, setValues] = useState<Record<string, string>>(
    legal ? { name: '', documentKeys: '[]' } : { name: '' }
  );
  edit = (data) =>
    setValues({
      name: data.name ?? '',
      ...(legal ? { documentKeys: data.documentKeys ?? '[]' } : {}),
    });
  draft = useOnboardingDraft(profile, values, edit);
  return <span>{draft.status}</span>;
}
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function mount(profile = 'one', legal = false) {
  await act(async () => root.render(<Harness profile={profile} legal={legal} />));
}
const change = async (name: string) => act(async () => edit({ name }));

it('keeps an expired company draft empty without autosaving and uses its retained version for new edits', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async (_path: string, init?: RequestInit) =>
    init?.method === 'PUT' ? json({ version: 7 }) : json({ version: 6, data: {} })
  );
  vi.stubGlobal('fetch', fetcher);
  await mount('one', true);
  expect(draft.ready).toBe(true);
  expect(draft.hasUnsavedChanges()).toBe(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await change('Fresh');
  await act(async () => {
    expect(await draft.flush()).toBe(7);
  });
  expect(JSON.parse(fetcher.mock.calls.at(-1)![1]!.body as string)).toEqual({
    expectedVersion: 6,
    data: { name: 'Fresh', documentKeys: '[]' },
  });
  expect(draft.hasUnsavedChanges()).toBe(false);
});

it('keeps edits dirty until a valid next-version acknowledgement arrives', async () => {
  const fetcher = vi.fn(async (_path: string, init?: RequestInit) =>
    init?.method === 'PUT' ? json({ version: 7 }) : json({ version: 2, data: { name: 'Saved' } })
  );
  vi.stubGlobal('fetch', fetcher);
  await mount();
  expect(draft.hasUnsavedChanges()).toBe(false);
  await change('Changed');
  expect(draft.hasUnsavedChanges()).toBe(true);
  await act(async () => {
    expect(await draft.flush()).toBeUndefined();
  });
  expect(draft.status).toBe('error');
  expect(draft.hasUnsavedChanges()).toBe(true);
  fetcher.mockImplementation(async () => json({ version: 3 }));
  await act(async () => {
    expect(await draft.flush()).toBe(3);
  });
  expect(draft.hasUnsavedChanges()).toBe(false);
  expect(JSON.parse(fetcher.mock.calls.at(-1)![1]!.body as string)).toEqual({
    expectedVersion: 2,
    data: { name: 'Changed' },
  });
});

it('serializes an in-flight save and saves later edits with the acknowledged version', async () => {
  let finish!: (response: Response) => void;
  const held = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const writes: { expectedVersion: number; data: Record<string, string> }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_path: string, init?: RequestInit) => {
      if (!init?.method) return json({ version: 0, data: { name: 'Saved' } });
      writes.push(JSON.parse(init.body as string));
      return writes.length === 1 ? held : json({ version: 2 });
    })
  );
  await mount();
  await change('First edit');
  let first!: Promise<number | undefined>, second!: Promise<number | undefined>;
  await act(async () => {
    first = draft.flush();
  });
  await change('Later edit');
  await act(async () => {
    second = draft.flush();
  });
  expect(writes).toHaveLength(1);
  await act(async () => {
    finish(json({ version: 1 }));
    expect(await first).toBe(1);
    expect(await second).toBe(2);
  });
  expect(writes).toEqual([
    { expectedVersion: 0, data: { name: 'First edit' } },
    { expectedVersion: 1, data: { name: 'Later edit' } },
  ]);
  expect(draft.hasUnsavedChanges()).toBe(false);
});

it('stops queued autosaves and leave warnings after confirmed submission', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn(async () => json({ version: 0, data: { name: 'Saved' } }));
  vi.stubGlobal('fetch', fetcher);
  await mount();
  await change('Changed');
  expect(draft.hasUnsavedChanges()).toBe(true);
  draft.markSubmitted();
  expect(draft.isSubmitted()).toBe(true);
  expect(draft.hasUnsavedChanges()).toBe(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1500);
    expect(await draft.flush()).toBeUndefined();
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('ignores an old profile save receipt and resets submission authority for the new draft', async () => {
  let finish!: (response: Response) => void;
  const held = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) =>
      init?.method ? held : json({ version: path.endsWith('two') ? 4 : 0, data: { name: path } })
    )
  );
  await mount();
  await change('Changed');
  let save!: Promise<number | undefined>;
  await act(async () => {
    save = draft.flush();
  });
  draft.markSubmitted();
  await mount('two');
  await act(async () => {
    finish(json({ version: 1 }));
    expect(await save).toBeUndefined();
  });
  expect(draft.isSubmitted()).toBe(false);
  expect(draft.ready).toBe(true);
  expect(draft.hasUnsavedChanges()).toBe(false);
});
