import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { t } from '@barghsa/i18n/app';
import { ConversationIdentityDialog } from './ConversationIdentityDialog.js';
const { upload } = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock('../lib/branding-logo-upload.js', async (original) => ({
  ...(await original<object>()),
  uploadConversationPhoto: upload,
}));
let root: Root, host: HTMLDivElement;
const initial = {
  displayName: 'Existing name',
  avatarUrl: null,
  avatarUploadKey: null,
  revision: 2,
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.cookie = 'barghsa_csrf=identity-token; path=/';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  upload.mockReset().mockResolvedValue('uploads/image/verified.png');
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.cookie = 'barghsa_csrf=; Max-Age=0';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function render(locale: 'en' | 'fa' = 'en') {
  const close = vi.fn();
  await act(async () =>
    root.render(<ConversationIdentityDialog locale={locale} onClose={close} />)
  );
  return close;
}
function nameInput() {
  return document.body.querySelector<HTMLInputElement>('input:not([type=file])')!;
}
async function name(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      nameInput(),
      value
    );
    nameInput().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function choose(file: File) {
  await act(async () => {
    const input = document.body.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function submit() {
  await act(async () =>
    document.body
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}
for (const locale of ['en', 'fa'] as const) {
  it(`${locale}: edits chosen identity with CSRF and explicit revision without exposing private login fields`, async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(initial))
      .mockResolvedValueOnce(response({ ...initial, displayName: 'Chosen name', revision: 3 }));
    vi.stubGlobal('fetch', request);
    const close = await render(locale);
    expect(nameInput().value).toBe('Existing name');
    expect(document.body.textContent).toContain(t('conversationIdentity.description', locale));
    expect(document.body.querySelector('[data-slot=dialog-content]')?.getAttribute('dir')).toBe(
      locale === 'fa' ? 'rtl' : 'ltr'
    );
    await name('Chosen name');
    await submit();
    const options = request.mock.calls[1]![1]!;
    expect(JSON.parse(options.body as string)).toEqual({ displayName: 'Chosen name', revision: 2 });
    expect((options.headers as Headers).get('X-CSRF-Token')).toBe('identity-token');
    expect(close).toHaveBeenCalledTimes(1);
  });
}
it('retains name/file and the verified upload across a failed save retry', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response(initial))
    .mockResolvedValueOnce(response({}, 503))
    .mockResolvedValueOnce(
      response({
        ...initial,
        displayName: 'Retry name',
        avatarUploadKey: 'uploads/image/verified.png',
        revision: 3,
      })
    );
  vi.stubGlobal('fetch', request);
  const close = await render();
  await name('Retry name');
  await choose(new File(['png'], 'portrait.png', { type: 'image/png' }));
  await submit();
  expect(close).not.toHaveBeenCalled();
  expect(nameInput().value).toBe('Retry name');
  expect(document.body.textContent).toContain('portrait.png');
  expect(document.body.querySelector('[role=alert]')?.textContent).toBe(
    t('conversationIdentity.save', 'en')
  );
  await submit();
  expect(upload).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);
  expect(
    request.mock.calls.slice(1).map(([, options]) => JSON.parse(options!.body as string))
  ).toEqual([
    { displayName: 'Retry name', avatarUploadKey: 'uploads/image/verified.png', revision: 2 },
    { displayName: 'Retry name', avatarUploadKey: 'uploads/image/verified.png', revision: 2 },
  ]);
});
it('refreshes the revision after conflict without replacing the unsaved draft', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response(initial))
    .mockResolvedValueOnce(response({}, 409))
    .mockResolvedValueOnce(response({ ...initial, displayName: 'Other edit', revision: 3 }))
    .mockResolvedValueOnce(response({ ...initial, displayName: 'My edit', revision: 4 }));
  vi.stubGlobal('fetch', request);
  const close = await render();
  await name('My edit');
  await submit();
  expect(nameInput().value).toBe('My edit');
  expect(close).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain(t('conversationIdentity.conflict', 'en'));
  await submit();
  expect(JSON.parse(request.mock.calls[3]![1]!.body as string)).toEqual({
    displayName: 'My edit',
    revision: 3,
  });
  expect(close).toHaveBeenCalled();
});
it('clears the shared name/photo only when explicitly removed', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response({ ...initial, avatarUploadKey: 'uploads/image/old.png' }))
    .mockResolvedValueOnce(response({ ...initial, displayName: null, revision: 3 }));
  vi.stubGlobal('fetch', request);
  await render();
  await name('');
  const remove = [...document.body.querySelectorAll('button')].find(
    (button) => button.textContent === t('conversationIdentity.remove', 'en')
  )!;
  await act(async () => remove.click());
  await submit();
  expect(JSON.parse(request.mock.calls[1]![1]!.body as string)).toEqual({
    displayName: null,
    avatarUploadKey: null,
    revision: 2,
  });
  expect(upload).not.toHaveBeenCalled();
});
it('rejects unsafe photo selection and directional-control names without a write', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(response(initial));
  vi.stubGlobal('fetch', request);
  await render();
  await choose(new File(['svg'], 'photo.svg', { type: 'image/svg+xml' }));
  expect(document.body.textContent).toContain(t('conversationIdentity.photoError', 'en'));
  await name('Name\u202ereversed');
  await submit();
  expect(document.body.textContent).toContain(t('conversationIdentity.nameError', 'en'));
  expect(request).toHaveBeenCalledTimes(1);
  expect(upload).not.toHaveBeenCalled();
});
it('clears personal drafts after access denial', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response(initial))
    .mockResolvedValueOnce(response({}, 401));
  vi.stubGlobal('fetch', request);
  await render();
  await name('Private draft');
  await submit();
  expect(document.body.textContent).toContain(t('conversationIdentity.denied', 'en'));
  expect(document.body.querySelector('form')).toBeNull();
  expect(document.body.textContent).not.toContain('Private draft');
});
it('recovers a failed initial read without inventing a default identity', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response({}, 503))
    .mockResolvedValueOnce(response(initial));
  vi.stubGlobal('fetch', request);
  await render();
  expect(document.body.querySelector('form')).toBeNull();
  const retry = [...document.body.querySelectorAll('button')].find(
    (button) => button.textContent === t('conversationIdentity.retry', 'en')
  )!;
  await act(async () => retry.click());
  expect(nameInput().value).toBe('Existing name');
});
it('does not submit an obsolete identity after the editor unmounts during upload', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(response(initial));
  vi.stubGlobal('fetch', request);
  let finish!: (key: string) => void;
  upload.mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await choose(new File(['png'], 'photo.png', { type: 'image/png' }));
  await act(async () => {
    document.body
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await act(async () => root.render(null));
  await act(async () => finish('uploads/image/verified.png'));
  expect(request).toHaveBeenCalledTimes(1);
});

it('clears the draft immediately when photo verification rejects current account access', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(response(initial));
  vi.stubGlobal('fetch', request);
  upload.mockRejectedValue(new Error('denied'));
  await render();
  await name('Personal draft');
  await choose(new File(['png'], 'personal.png', { type: 'image/png' }));
  await submit();
  expect(document.body.querySelector('form')).toBeNull();
  expect(document.body.textContent).not.toContain('Personal draft');
  expect(document.body.textContent).not.toContain('personal.png');
  expect(request).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).toContain(t('conversationIdentity.denied', 'en'));
});
