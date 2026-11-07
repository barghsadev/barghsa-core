import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { DefaultProfileModal } from './DefaultProfileModal.js';
import { QueryComponentProvider } from '../test/query-provider.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import { sendToast } from '../lib/toast-api.js';

vi.mock('../lib/profile-context.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/profile-context.js')>();
  return { ...original, refreshProfileContext: vi.fn() };
});
vi.mock('../lib/toast-api.js', () => ({ sendToast: vi.fn() }));

it('does not refresh a new account or show a toast for an obsolete default-profile receipt', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  document.documentElement.lang = 'en';
  const first = '99111111-1111-4111-8111-111111111111';
  const second = '99222222-2222-4222-8222-222222222222';
  const profile = (id: string) => ({
    id,
    profileType: 'INDIVIDUAL',
    title: null,
    firstName: 'Private',
    lastName: 'Fixture',
  });
  let owner = 'first-account';
  let signal!: AbortSignal;
  let resolve!: (value: Response) => void;
  let writes = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string, init?: RequestInit) => {
      if (path === '/api/profiles') {
        return Promise.resolve(
          Response.json({
            profiles:
              owner === 'first-account' ? [profile(first), profile(second)] : [profile(second)],
            hasDefault: owner !== 'first-account',
            activeProfileId: owner === 'first-account' ? null : second,
          })
        );
      }
      expect(path).toBe('/api/profiles/switch/' + first);
      expect(init?.method).toBe('POST');
      signal = init!.signal!;
      writes++;
      return new Promise<Response>((done) => {
        resolve = done;
      });
    })
  );
  const render = () =>
    root.render(
      <QueryComponentProvider>
        <DefaultProfileModal accountId={owner} />
      </QueryComponentProvider>
    );
  try {
    await act(async () => render());
    const submit = [...document.querySelectorAll('button')].find(
      (node) => node.textContent === 'Set as Default'
    );
    expect(submit).toBeDefined();
    await act(async () => {
      submit!.click();
      submit!.click();
    });
    await vi.waitFor(() => expect(writes).toBe(1));
    expect(signal.aborted).toBe(false);
    owner = 'second-account';
    await act(async () => render());
    expect(signal.aborted).toBe(true);
    await act(async () => resolve(Response.json({ activeProfileId: first })));
    expect(vi.mocked(refreshProfileContext)).not.toHaveBeenCalled();
    expect(vi.mocked(sendToast)).not.toHaveBeenCalled();
    expect(writes).toBe(1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
