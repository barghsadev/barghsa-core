import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Knowledge from './AdminKnowledgeBasesPage.js';
import { KnowledgeBaseDocumentPicker } from '../components/KnowledgeBaseDocumentPicker.js';
import { KnowledgeBaseUpload } from '../components/KnowledgeBaseUpload.js';
import type { TeamAction } from '../components/TeamActionDialog.js';
import { knowledgeBase as kb } from '../test/knowledge-policy-fixtures.js';
type Schemas = typeof import('../lib/catalogue-form-schemas.js');
const state = vi.hoisted(() => ({
  action: null as TeamAction | null,
  success: null as ((value: unknown) => Promise<void>) | null,
  fields: null as ((value: unknown[]) => boolean) | null,
  unconfirmed: null as (() => void) | null,
  close: null as (() => void) | null,
  gate: null as Promise<void> | null,
  unavailable: false,
}));
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: (props: {
    action: TeamAction;
    onSuccess: (value: unknown) => Promise<void>;
    onValidationError: (fields: unknown[]) => boolean;
    onUnconfirmed: () => void;
    onClose: () => void;
  }) => {
    state.action = props.action;
    state.success = props.onSuccess;
    state.fields = props.onValidationError;
    state.unconfirmed = props.onUnconfirmed;
    state.close = props.onClose;
    return <div data-testid="confirmation" />;
  },
}));
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
const storageKey = 'uploads/document/guide.txt';
const doc = {
  id: '01900000-0000-7000-8000-000000000009',
  kbId: kb.id,
  storageKey,
  fileName: 'Guide.txt',
  processingStatus: 'pending',
};
let host: HTMLDivElement, root: Root;
beforeEach(async () => {
  await import('../lib/catalogue-form-schemas.js');
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.lang = 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  Object.assign(state, {
    action: null,
    success: null,
    fields: null,
    unconfirmed: null,
    close: null,
    gate: null,
    unavailable: false,
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
function button(text: string) {
  const node = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text
  );
  expect(node, text).toBeDefined();
  return node!;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
async function fill(id: string, value: string) {
  const node = host.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype,
      'value'
    )!.set!.call(node, value);
    node.dispatchEvent(
      new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })
    );
  });
}
async function file(value: File | null) {
  const node = host.querySelector<HTMLInputElement>('#kb-new-document')!;
  await act(async () => {
    Object.defineProperty(node, 'files', { value: value ? [value] : [], configurable: true });
    node.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function submit(id: string) {
  const form = host.querySelector(`#${id}`)!.closest('form')!;
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  if (!state.gate)
    await vi.waitFor(async () => {
      await act(async () => {});
      if (form.isConnected) expect(form.getAttribute('aria-busy')).toBe('false');
    });
}
async function mount(attached = false) {
  const data = { failed: false, malformed: false, attached, permission: 200 };
  const request = vi.fn(async (url: RequestInfo | URL) => {
    const path = String(url);
    if (path.includes('documents/available'))
      return Response.json(data.malformed ? [{ storageKey }] : [doc], {
        status: data.failed ? 503 : data.permission,
      });
    if (path.endsWith(kb.id))
      return Response.json(
        { ...kb, sourceType: 'document', sourceConfig: {}, documents: data.attached ? [doc] : [] },
        { status: data.failed ? 503 : data.permission }
      );
    return Response.json([{ ...kb, sourceType: 'document', sourceConfig: {} }]);
  });
  vi.stubGlobal('fetch', request);
  await act(async () => root.render(<Knowledge />));
  await click('Open');
  return { data, request };
}
it('focuses blank selection and long search without proposing a mutation or searching', async () => {
  const { request } = await mount();
  await submit('kb-file');
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(document.activeElement?.id).toBe('kb-file');
  });
  expect(host.querySelector('#kb-file')!.getAttribute('aria-invalid')).toBe('true');
  expect(state.action).toBeNull();
  const before = request.mock.calls.length;
  await fill('kb-file-search', 'x'.repeat(201));
  await submit('kb-file-search');
  expect(request).toHaveBeenCalledTimes(before);
  expect(host.querySelector('#kb-file-search')!.getAttribute('aria-invalid')).toBe('true');
});
it('retains both search and selection through a malformed read, blocks attachment, then retries independently', async () => {
  const { data } = await mount();
  await fill('kb-file', storageKey);
  await fill('kb-file-search', 'Guide');
  data.malformed = true;
  await submit('kb-file-search');
  expect((host.querySelector('#kb-file') as HTMLSelectElement).value).toBe(storageKey);
  expect((host.querySelector('#kb-file-search') as HTMLInputElement).value).toBe('Guide');
  expect(host.querySelector('#kb-file')!.closest('fieldset')!.disabled).toBe(true);
  data.malformed = false;
  await click('Retry');
  await submit('kb-file');
  expect(state.action).toMatchObject({ body: { storageKey }, successStatus: 200 });
});
it('maps only owned attachment feedback and clears selection only after exact receipt plus fresh detail verification', async () => {
  const { data } = await mount();
  await fill('kb-file', storageKey);
  await submit('kb-file');
  await act(async () => {
    expect(state.fields!(['private'])).toBe(false);
    expect(state.fields!(['storageKey'])).toBe(true);
    state.close!();
  });
  expect((host.querySelector('#kb-file') as HTMLSelectElement).value).toBe(storageKey);
  await submit('kb-file');
  data.attached = true;
  await act(async () => state.success!(doc));
  expect(host.querySelector('[data-testid=confirmation]')).toBeNull();
  expect((host.querySelector('#kb-file') as HTMLSelectElement).value).toBe('');
  expect(host.textContent).toContain('Guide.txt');
});
it('preserves an uncertain selection, requires a successful fresh read and explicit owner reset', async () => {
  const { data } = await mount();
  await fill('kb-file-search', 'Guide');
  await fill('kb-file', storageKey);
  await submit('kb-file');
  await act(async () => {
    await expect(state.success!({ ...doc, kbId: doc.id })).rejects.toThrow();
    data.failed = true;
    state.unconfirmed!();
  });
  expect(button('Reset to saved settings').disabled).toBe(true);
  expect((host.querySelector('#kb-file') as HTMLSelectElement).value).toBe(storageKey);
  data.failed = false;
  await click('Retry details');
  await click('Reset to saved settings');
  expect((host.querySelector('#kb-file') as HTMLSelectElement).value).toBe('');
  expect((host.querySelector('#kb-file-search') as HTMLInputElement).value).toBe('Guide');
});
it('does not report detach success while the captured document is still present', async () => {
  const { data } = await mount(true);
  await click('Detach document');
  expect(state.action?.successStatus).toBe(204);
  await act(async () => {
    await expect(state.success!(null)).rejects.toThrow();
  });
  data.attached = false;
  await act(async () => state.success!(null));
  expect(host.querySelector('[data-testid=confirmation]')).toBeNull();
});
it('drops deferred selection validation after permission loss or target unmount', async () => {
  const attach = vi.fn(),
    deny = vi.fn();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json([doc])));
  await act(async () =>
    root.render(<KnowledgeBaseDocumentPicker attachedKeys={[]} onAttach={attach} onDenied={deny} />)
  );
  await fill('kb-file', storageKey);
  let release!: () => void;
  state.gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await submit('kb-file');
  await submit('kb-file');
  await act(async () => root.render(<p>Other target</p>));
  await act(async () => {
    release();
    await state.gate;
  });
  expect(attach).not.toHaveBeenCalled();
});
it('fails closed when deferred validation is unavailable and preserves the selected file', async () => {
  const attach = vi.fn();
  await act(async () => root.render(<KnowledgeBaseUpload onAttach={attach} />));
  await file(new File(['text'], 'Guide.txt'));
  state.unavailable = true;
  await submit('kb-new-document');
  expect(host.textContent).toContain('Validation is unavailable');
  expect(attach).not.toHaveBeenCalled();
});
it('focuses unsupported and empty files without reserving storage', async () => {
  const request = vi.fn(),
    attach = vi.fn();
  vi.stubGlobal('fetch', request);
  await act(async () => root.render(<KnowledgeBaseUpload onAttach={attach} />));
  for (const value of [null, new File(['data'], 'tool.exe'), new File([], 'empty.pdf')]) {
    await file(value);
    await submit('kb-new-document');
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(document.activeElement?.id).toBe('kb-new-document');
    });
    expect(host.querySelector('#kb-new-document')!.getAttribute('aria-invalid')).toBe('true');
  }
  expect(request).not.toHaveBeenCalled();
  expect(attach).not.toHaveBeenCalled();
});
it('reuses verified uploaded bytes after cancellation and owned server feedback', async () => {
  const attach = vi.fn();
  const request = vi.fn(async (url: RequestInfo | URL) => {
    const path = String(url);
    if (path.endsWith('presigned-url'))
      return Response.json({ key: storageKey, presignedUrl: 'https://storage.example.test/guide' });
    if (path.endsWith('/verify'))
      return Response.json({ key: storageKey, status: 'confirmed', exists: true });
    if (path.endsWith('/record')) return Response.json({ key: storageKey, status: 'recorded' });
    return new Response(null, { status: 200 });
  });
  vi.stubGlobal('fetch', request);
  await act(async () => root.render(<KnowledgeBaseUpload onAttach={attach} />));
  await file(new File(['data'], 'guide.txt'));
  await submit('kb-new-document');
  expect(attach).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledTimes(4);
  await act(async () => {
    expect(attach.mock.calls[0]![1].fields(['storageKey'])).toBe(true);
  });
  await submit('kb-new-document');
  expect(attach).toHaveBeenCalledTimes(2);
  expect(request).toHaveBeenCalledTimes(4);
});
it.each([401, 403] as const)(
  'clears private document work on available-read denial %i',
  async (status) => {
    const { data } = await mount();
    await fill('kb-file', storageKey);
    await fill('kb-file-search', 'Private');
    data.permission = status;
    await submit('kb-file-search');
    expect(host.querySelector('#kb-file')).toBeNull();
    expect(host.textContent).not.toContain('Private');
  }
);
it('rejects invalid catalogue counts rather than presenting them as legitimate metadata', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json([{ ...kb, documentCount: -1 }])));
  await act(async () => root.render(<Knowledge />));
  expect(host.textContent).not.toContain(kb.title);
  expect(button('Retry')).toBeDefined();
});
