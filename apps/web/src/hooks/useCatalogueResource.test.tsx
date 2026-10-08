import { QueryProvider } from '../test/query-provider.js';
import { AccountUserProvider } from './useAccountUser.js';
import { act, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useCatalogueResource, useCatalogueScope } from './useCatalogueResource.js';
const validate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
it('a validated save receipt supersedes older reads and cannot cross a denied scope', async () => {
  let resolve!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        })
    )
  );
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let path = '/catalogue';
  let resource!: ReturnType<typeof useCatalogueResource<number>>;
  let scope!: ReturnType<typeof useCatalogueScope>;
  function Harness() {
    scope = useCatalogueScope(useCallback(() => {}, []));
    resource = useCatalogueResource(scope, path, validate);
    return <p>{resource.data ?? 'unavailable'}</p>;
  }
  try {
    await act(async () => root.render(<QueryProvider>{<Harness />}</QueryProvider>));
    const oldAccept = resource.accept;
    await act(async () => {
      expect(resource.accept(72)).toBe(true);
    });
    await act(async () => resolve(new Response('24')));
    expect(host.textContent).toBe('72');
    expect(resource.readAttempt).toBeNull();
    await act(async () => {
      expect(resource.accept(NaN)).toBe(false);
    });
    expect(host.textContent).toBe('72');
    path = '/other';
    await act(async () => root.render(<QueryProvider>{<Harness />}</QueryProvider>));
    await act(async () => {
      expect(oldAccept(96)).toBe(false);
    });
    await act(async () => resolve(new Response('18')));
    expect(host.textContent).toBe('18');
    expect(resource.readAttempt).toBe(0);
    let required = 0;
    await act(async () => {
      required = resource.retry();
    });
    expect(required).toBe(1);
    expect(resource.readAttempt).toBe(0);
    await act(async () => resolve(new Response('unavailable', { status: 503 })));
    expect(resource.error).toBe(true);
    expect(resource.readAttempt).toBe(0);
    await act(async () => {
      required = resource.retry();
    });
    await act(async () => resolve(new Response('20')));
    expect(resource.readAttempt).toBe(required);
    expect(resource.readAttempt).toBe(2);
    await act(async () => scope.deny());
    await act(async () => {
      expect(oldAccept(48)).toBe(false);
    });
    expect(host.textContent).toBe('unavailable');
    await act(async () => scope.recover());
    await act(async () => {
      expect(oldAccept(96)).toBe(false);
    });
    await act(async () => resolve(new Response('36')));
    expect(host.textContent).toBe('36');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('deduplicates readers in one permission scope and aborts only after the last observer leaves', async () => {
  const reads = vi.fn((_path: string, _options: RequestInit) => new Promise<Response>(() => {}));
  vi.stubGlobal('fetch', reads);
  const host = document.createElement('div');
  const root = createRoot(host);
  function Reader({ scope }: { scope: ReturnType<typeof useCatalogueScope> }) {
    useCatalogueResource(scope, '/catalogue', validate);
    return null;
  }
  function Harness({ both }: { both: boolean }) {
    const scope = useCatalogueScope(useCallback(() => {}, []));
    return (
      <>
        <Reader scope={scope} />
        {both && <Reader scope={scope} />}
      </>
    );
  }
  try {
    await act(async () =>
      root.render(
        <QueryProvider>
          <Harness both />
        </QueryProvider>
      )
    );
    expect(reads).toHaveBeenCalledTimes(1);
    const signal = reads.mock.calls[0]![1].signal!;
    await act(async () =>
      root.render(
        <QueryProvider>
          <Harness both={false} />
        </QueryProvider>
      )
    );
    expect(signal.aborted).toBe(false);
    await act(async () => root.unmount());
    expect(signal.aborted).toBe(true);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it('withdraws the previous account and rejects its pending result and save receipt', async () => {
  const pending: { signal: AbortSignal; resolve: (response: Response) => void }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_path: string, options: RequestInit) =>
        new Promise<Response>((resolve) => {
          pending.push({ signal: options.signal!, resolve });
        })
    )
  );
  const host = document.createElement('div');
  const root = createRoot(host);
  let resource!: ReturnType<typeof useCatalogueResource<number>>;
  function Harness() {
    const scope = useCatalogueScope(useCallback(() => {}, []));
    resource = useCatalogueResource(scope, '/catalogue', validate);
    return <p>{resource.data ?? 'unavailable'}</p>;
  }
  const render = (actor: string) =>
    root.render(
      <QueryProvider>
        <AccountUserProvider value={actor}>
          <Harness />
        </AccountUserProvider>
      </QueryProvider>
    );
  try {
    await act(async () => render('a'));
    const accept = resource.accept;
    await act(async () => pending[0]!.resolve(new Response('12')));
    expect(host.textContent).toBe('12');
    await act(async () => resource.retry());
    const old = pending[1]!;
    await act(async () => render('b'));
    expect(host.textContent).toBe('unavailable');
    expect(old.signal.aborted).toBe(true);
    await act(async () => {
      expect(accept(24)).toBe(false);
      old.resolve(new Response('36'));
    });
    expect(host.textContent).toBe('unavailable');
    await act(async () => pending[2]!.resolve(new Response('48')));
    expect(host.textContent).toBe('48');
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it('ignores a denied older read after a validated receipt and requires a new GET for recovery', async () => {
  let resolve!: (response: Response) => void;
  const denied = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        })
    )
  );
  const host = document.createElement('div');
  const root = createRoot(host);
  let resource!: ReturnType<typeof useCatalogueResource<number>>;
  function Harness() {
    const scope = useCatalogueScope(denied);
    resource = useCatalogueResource(scope, '/catalogue', validate);
    return <p>{resource.data ?? 'unavailable'}</p>;
  }
  try {
    await act(async () =>
      root.render(
        <QueryProvider>
          <Harness />
        </QueryProvider>
      )
    );
    await act(async () => {
      expect(resource.accept(72)).toBe(true);
    });
    await act(async () => resolve(new Response('', { status: 403 })));
    expect(denied).not.toHaveBeenCalled();
    expect(host.textContent).toBe('72');
    expect(resource.readAttempt).toBeNull();
    let attempt = 0;
    await act(async () => {
      attempt = resource.retry();
    });
    await act(async () => resolve(new Response('72')));
    expect(resource.readAttempt).toBe(attempt);
    expect(resource.loading).toBe(false);
    const capturedAccept = resource.accept;
    await act(async () => {
      resource.retry();
    });
    await act(async () => {
      expect(capturedAccept(96)).toBe(true);
    });
    await act(async () => resolve(new Response('12')));
    expect(host.textContent).toBe('96');
    expect(resource.readAttempt).toBeNull();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it.each([401, 403])(
  'withdraws all scope data on %s and never retries a denied read',
  async (status) => {
    const denied = vi.fn(),
      unauthorized = vi.fn();
    const reads = vi.fn(async () => new Response('', { status }));
    vi.stubGlobal('fetch', reads);
    const host = document.createElement('div');
    const root = createRoot(host);
    let resource!: ReturnType<typeof useCatalogueResource<number>>;
    function Harness() {
      const scope = useCatalogueScope(denied);
      resource = useCatalogueResource(scope, '/catalogue', validate, {
        onUnauthorized: unauthorized,
      });
      return <p>{resource.data ?? 'unavailable'}</p>;
    }
    try {
      await act(async () =>
        root.render(
          <QueryProvider>
            <Harness />
          </QueryProvider>
        )
      );
      expect(reads).toHaveBeenCalledTimes(1);
      expect(denied).toHaveBeenCalledTimes(1);
      expect(unauthorized).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
      expect(host.textContent).toBe('unavailable');
      expect(resource.accept(12)).toBe(false);
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  }
);

it('retains accepted rows when a later validator throws, without certifying that read', async () => {
  let invalid = false;
  const throwing = (value: unknown): value is number => {
    if (invalid) throw new Error('Malformed catalogue');
    return validate(value);
  };
  const reads = vi.fn(async () => new Response('12'));
  vi.stubGlobal('fetch', reads);
  const host = document.createElement('div');
  const root = createRoot(host);
  let resource!: ReturnType<typeof useCatalogueResource<number>>;
  function Harness() {
    const scope = useCatalogueScope(useCallback(() => {}, []));
    resource = useCatalogueResource(scope, '/catalogue', throwing);
    return <p>{resource.data ?? 'unavailable'}</p>;
  }
  try {
    await act(async () =>
      root.render(
        <QueryProvider>
          <Harness />
        </QueryProvider>
      )
    );
    expect(host.textContent).toBe('12');
    invalid = true;
    await act(async () => {
      resource.retry();
    });
    expect(host.textContent).toBe('12');
    expect(resource.error).toBe(true);
    expect(resource.readAttempt).toBe(0);
    expect(reads).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it('shares the initial GET but performs a fresh authoritative GET for each observer retry', async () => {
  let count = 0;
  const reads = vi.fn(async () => new Response(String(++count)));
  vi.stubGlobal('fetch', reads);
  const host = document.createElement('div');
  const root = createRoot(host);
  const resources: ReturnType<typeof useCatalogueResource<number>>[] = [];
  function Reader({
    scope,
    index,
  }: {
    scope: ReturnType<typeof useCatalogueScope>;
    index: number;
  }) {
    resources[index] = useCatalogueResource(scope, '/catalogue', validate);
    return <p>{resources[index]!.data}</p>;
  }
  function Harness() {
    const scope = useCatalogueScope(useCallback(() => {}, []));
    return (
      <>
        <Reader scope={scope} index={0} />
        <Reader scope={scope} index={1} />
      </>
    );
  }
  try {
    await act(async () =>
      root.render(
        <QueryProvider>
          <Harness />
        </QueryProvider>
      )
    );
    expect(reads).toHaveBeenCalledTimes(1);
    expect(resources.map((r) => r.data)).toEqual([1, 1]);
    await act(async () => {
      resources[0]!.retry();
    });
    expect(resources.map((r) => r.data)).toEqual([2, 1]);
    await act(async () => {
      resources[1]!.retry();
    });
    expect(reads).toHaveBeenCalledTimes(3);
    expect(resources.map((r) => r.data)).toEqual([2, 3]);
    expect(resources.map((r) => r.readAttempt)).toEqual([1, 1]);
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
