import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useSettingsCommand, type SettingsCommand } from './useSettingsCommand.js';

const profileId = '10000000-0000-4000-8000-000000000001';
const addressId = '20000000-0000-4000-8000-000000000002';
const provinceId = '30000000-0000-4000-8000-000000000003';
const cityId = '40000000-0000-4000-8000-000000000004';
const commandKey = '50000000-0000-4000-8000-000000000005';
const stamp = '2026-10-05T09:00:00.123Z';
const projection = {
  id: profileId,
  profileType: 'LEGAL',
  isDefault: false,
  status: 'ACTIVE',
  title: null,
  firstName: null,
  lastName: null,
  nationalId: null,
  updatedAt: stamp,
};
const detail = {
  ...projection,
  createdAt: stamp,
  canEditIdentity: false,
  addresses: [
    {
      id: addressId,
      profileId,
      provinceId,
      cityId,
      fullAddress: 'Captured address',
      postalCode: '1234567890',
      mainAddress: true,
      createdAt: stamp,
      updatedAt: stamp,
    },
  ],
  legalInfo: {
    legalName: 'Captured company',
    nationalIdentifier: '12345678902',
    registrationNumber: '123',
    companyTypeId: 'private-joint-stock',
    economicCode: null,
    representativeTitle: 'Director',
    representativeRelationship: 'authorized',
  },
};
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const disposals: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of disposals.splice(0)) await dispose();
  vi.unstubAllGlobals();
  document.cookie = 'barghsa_csrf=; Max-Age=0; path=/';
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function harness(
  initialScope = 'actor-a/profile-a',
  initialAuthority: (command: SettingsCommand | null) => boolean = () => true
) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const denied = vi.fn();
  let scope = initialScope,
    authority = initialAuthority;
  let current!: ReturnType<typeof useSettingsCommand>;
  function Consumer() {
    current = useSettingsCommand(scope, denied, authority);
    return null;
  }
  async function render(nextScope = scope, nextAuthority = authority) {
    scope = nextScope;
    authority = nextAuthority;
    await act(async () => root.render(<Consumer />));
  }
  disposals.push(async () => {
    await act(async () => root.unmount());
    host.remove();
  });
  await render();
  return {
    get current() {
      return current;
    },
    render,
    denied,
  };
}
function command(overrides: Partial<SettingsCommand> = {}): SettingsCommand {
  return {
    owner: 'profile',
    path: '/api/profiles/' + profileId,
    method: 'PUT',
    status: 200,
    keyed: true,
    body: { title: 'Captured title', idempotencyKey: commandKey },
    receipt: (value) => record(value) && value.id === profileId && value.title === 'Captured title',
    accepted: vi.fn(),
    ...overrides,
  };
}

it('retries the exact captured JSON and key with the current CSRF while synchronously holding competing owners', async () => {
  const accepted = vi.fn();
  const receipt = { ...projection, title: 'Captured title' };
  const requests = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new TypeError('Acknowledgement lost'))
    .mockResolvedValueOnce(Response.json(receipt));
  vi.stubGlobal('fetch', requests);
  const h = await harness();
  const body = { title: 'Captured title', idempotencyKey: commandKey };
  const originalJson = JSON.stringify(body);
  document.cookie = 'barghsa_csrf=first; path=/';
  await act(async () => {
    expect(h.current.coordination.claim('profile')).toBe(true);
    expect(h.current.coordination.claim('address')).toBe(false);
    expect(await h.current.submit(command({ body, accepted }))).toBe(false);
  });
  expect(h.current.locked).toBe('profile');
  expect(h.current.busy).toBe(false);
  expect(h.current.phase).toBe('uncertain');
  expect(accepted).not.toHaveBeenCalled();
  body.title = 'Later unsent title';
  body.idempotencyKey = '60000000-0000-4000-8000-000000000006';
  document.cookie = 'barghsa_csrf=rotated; path=/';
  await act(async () => {
    h.current.coordination.release('profile');
    expect(h.current.coordination.claim('delete')).toBe(false);
    expect(await h.current.send()).toBe(true);
  });
  expect(requests).toHaveBeenCalledTimes(2);
  for (const [path, init] of requests.mock.calls) {
    expect(path).toBe('/api/profiles/' + profileId);
    expect(init).toMatchObject({ method: 'PUT', credentials: 'include', body: originalJson });
  }
  expect(new Headers(requests.mock.calls[0]![1]?.headers).get('X-CSRF-Token')).toBe('first');
  expect(new Headers(requests.mock.calls[1]![1]?.headers).get('X-CSRF-Token')).toBe('rotated');
  expect(accepted).toHaveBeenCalledExactlyOnceWith(receipt);
  expect(h.current.locked).toBeNull();
  expect(h.current.phase).toBe('ready');
});

it('keeps a valid projected acknowledgement and recovers only its authorized confirmation read without another PUT', async () => {
  const accepted = vi.fn();
  const requests = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(projection))
    .mockRejectedValueOnce(new TypeError('Detail read unavailable'))
    .mockResolvedValueOnce(Response.json(detail));
  vi.stubGlobal('fetch', requests);
  const h = await harness();
  const captured = command({
    body: {
      legalName: 'Captured company',
      provinceId,
      cityId,
      fullAddress: 'Captured address',
      postalCode: '1234567890',
      idempotencyKey: commandKey,
    },
    receipt: (value) => record(value) && value.id === profileId && value.profileType === 'LEGAL',
    confirmation: async () =>
      (await fetch('/api/profiles/' + profileId, { credentials: 'include' })).json(),
    confirmed: (value) =>
      record(value) &&
      record(value.legalInfo) &&
      value.legalInfo.legalName === 'Captured company' &&
      Array.isArray(value.addresses) &&
      value.addresses.some((row: unknown) => record(row) && row.fullAddress === 'Captured address'),
    accepted,
  });
  await act(async () => {
    expect(h.current.coordination.claim('profile')).toBe(true);
    expect(await h.current.submit(captured)).toBe(false);
  });
  expect(projection).not.toHaveProperty('legalInfo');
  expect(projection).not.toHaveProperty('addresses');
  expect(h.current.phase).toBe('confirmation');
  expect(h.current.locked).toBe('profile');
  expect(accepted).not.toHaveBeenCalled();
  await act(async () => expect(await h.current.refreshConfirmation()).toBe(true));
  expect(requests.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual([
    'PUT',
    'GET',
    'GET',
  ]);
  expect(requests.mock.calls.map(([path]) => path)).toEqual(
    Array(3).fill('/api/profiles/' + profileId)
  );
  expect(accepted).toHaveBeenCalledExactlyOnceWith(detail);
  expect(h.current.locked).toBeNull();
});

it('recovers an unkeyed default companion only through context confirmation without blindly repeating POST', async () => {
  const accepted = vi.fn();
  const context = { profiles: [projection], activeProfileId: profileId, hasDefault: true };
  const requests = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new TypeError('Default acknowledgement lost'))
    .mockResolvedValueOnce(Response.json(context));
  vi.stubGlobal('fetch', requests);
  const h = await harness();
  const captured = command({
    owner: 'default',
    path: '/api/profiles/default/' + profileId,
    method: 'POST',
    keyed: false,
    receipt: (value) => record(value) && value.activeProfileId === profileId,
    confirmation: async () => (await fetch('/api/profiles', { credentials: 'include' })).json(),
    confirmed: (value) => record(value) && value.activeProfileId === profileId,
    accepted,
  });
  delete captured.body;
  await act(async () => {
    expect(h.current.coordination.claim('default')).toBe(true);
    expect(await h.current.submit(captured)).toBe(false);
  });
  expect(h.current.phase).toBe('confirmation');
  expect(accepted).not.toHaveBeenCalled();
  await act(async () => expect(await h.current.send()).toBe(true));
  expect(requests.mock.calls.map(([path, init]) => [path, init?.method ?? 'GET'])).toEqual([
    ['/api/profiles/default/' + profileId, 'POST'],
    ['/api/profiles', 'GET'],
  ]);
  expect(requests.mock.calls[0]![1]).not.toHaveProperty('body');
  expect(accepted).toHaveBeenCalledExactlyOnceWith(context);
});

it.each([200, 403])(
  'ignores old-scope %s and old release while keeping a fresh same-owner capture locked',
  async (oldStatus) => {
    const oldResponse = deferred<Response>(),
      freshResponse = deferred<Response>();
    const oldAccepted = vi.fn(),
      freshAccepted = vi.fn();
    const requests = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => oldResponse.promise)
      .mockImplementationOnce(() => freshResponse.promise);
    vi.stubGlobal('fetch', requests);
    const h = await harness();
    const oldCoordination = h.current.coordination;
    let oldSend!: Promise<boolean>, freshSend!: Promise<boolean>;
    await act(async () => {
      expect(h.current.coordination.claim('profile')).toBe(true);
      oldSend = h.current.submit(command({ accepted: oldAccepted }));
    });
    expect(h.current.busy).toBe(true);
    await h.render('actor-b/profile-b');
    await act(async () => {
      expect(h.current.coordination.claim('profile')).toBe(true);
      freshSend = h.current.submit(
        command({
          path: '/api/profiles/' + addressId,
          body: { title: 'Fresh title', idempotencyKey: '60000000-0000-4000-8000-000000000006' },
          receipt: (value) =>
            record(value) && value.id === addressId && value.title === 'Fresh title',
          accepted: freshAccepted,
        })
      );
      oldCoordination.release('profile');
    });
    await act(async () => {
      oldResponse.resolve(
        Response.json(
          oldStatus === 200
            ? { ...projection, title: 'Captured title' }
            : { error: { code: 'AUTHZ:FORBIDDEN' } },
          { status: oldStatus }
        )
      );
      expect(await oldSend).toBe(false);
    });
    expect(h.denied).not.toHaveBeenCalled();
    expect(oldAccepted).not.toHaveBeenCalled();
    expect(freshAccepted).not.toHaveBeenCalled();
    expect(h.current.locked).toBe('profile');
    expect(h.current.busy).toBe(true);
    await act(async () => {
      expect(h.current.coordination.claim('address')).toBe(false);
      expect(await h.current.send()).toBe(false);
    });
    expect(requests).toHaveBeenCalledTimes(2);
    const freshReceipt = { ...projection, id: addressId, title: 'Fresh title' };
    await act(async () => {
      freshResponse.resolve(Response.json(freshReceipt));
      expect(await freshSend).toBe(true);
    });
    expect(freshAccepted).toHaveBeenCalledExactlyOnceWith(freshReceipt);
    expect(h.current.locked).toBeNull();
  }
);

it('does not let an old accepted callback completion unlock a fresh scope operation', async () => {
  const oldAcceptance = deferred<void>(),
    freshResponse = deferred<Response>();
  const oldAccepted = vi.fn(() => oldAcceptance.promise),
    freshAccepted = vi.fn();
  const requests = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ ...projection, title: 'Captured title' }))
    .mockImplementationOnce(() => freshResponse.promise);
  vi.stubGlobal('fetch', requests);
  const h = await harness();
  let oldSend!: Promise<boolean>, freshSend!: Promise<boolean>;
  await act(async () => {
    expect(h.current.coordination.claim('profile')).toBe(true);
    oldSend = h.current.submit(command({ accepted: oldAccepted }));
  });
  expect(oldAccepted).toHaveBeenCalledTimes(1);
  await h.render('actor-b/profile-b');
  await act(async () => {
    expect(h.current.coordination.claim('profile')).toBe(true);
    freshSend = h.current.submit(command({ accepted: freshAccepted }));
  });
  await act(async () => {
    oldAcceptance.resolve();
    expect(await oldSend).toBe(false);
  });
  expect(h.current.locked).toBe('profile');
  expect(h.current.busy).toBe(true);
  expect(freshAccepted).not.toHaveBeenCalled();
  await act(async () => {
    freshResponse.resolve(Response.json({ ...projection, title: 'Captured title' }));
    expect(await freshSend).toBe(true);
  });
  expect(freshAccepted).toHaveBeenCalledTimes(1);
  expect(h.current.locked).toBeNull();
});

it('withdraws an in-flight capture on current grant loss and ignores its later receipt', async () => {
  const response = deferred<Response>(),
    accepted = vi.fn();
  const requests = vi.fn<typeof fetch>().mockImplementation(() => response.promise);
  vi.stubGlobal('fetch', requests);
  const h = await harness();
  let sending!: Promise<boolean>;
  await act(async () => {
    expect(h.current.coordination.claim('profile')).toBe(true);
    sending = h.current.submit(command({ accepted }));
  });
  await h.render('actor-a/profile-a', () => false);
  expect(h.denied).toHaveBeenCalledTimes(1);
  expect(h.current.locked).toBeNull();
  await act(async () => {
    response.resolve(Response.json({ ...projection, title: 'Captured title' }));
    expect(await sending).toBe(false);
  });
  expect(accepted).not.toHaveBeenCalled();
  await act(async () => expect(h.current.coordination.claim('address')).toBe(false));
  expect(requests).toHaveBeenCalledTimes(1);
});

it.each([401, 403, 404])(
  'withdraws a current-scope %s without acceptance or retrying private work',
  async (status) => {
    const accepted = vi.fn();
    const requests = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ error: { code: 'AUTHORITY:DENIED' } }, { status }));
    vi.stubGlobal('fetch', requests);
    const h = await harness();
    await act(async () => {
      expect(h.current.coordination.claim('profile')).toBe(true);
      expect(await h.current.submit(command({ accepted }))).toBe(false);
    });
    expect(h.denied).toHaveBeenCalledTimes(1);
    expect(accepted).not.toHaveBeenCalled();
    expect(h.current.locked).toBeNull();
    expect(h.current.busy).toBe(false);
    await act(async () => expect(await h.current.send()).toBe(false));
    expect(requests).toHaveBeenCalledTimes(1);
  }
);
