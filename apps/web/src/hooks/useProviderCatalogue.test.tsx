import { act, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { QueryProvider } from '../test/query-provider.js';
import { AccountUserProvider } from './useAccountUser.js';
import { useCatalogueScope } from './useCatalogueResource.js';
import { useProviderCatalogue } from './useProviderCatalogue.js';
import { ProviderRequestError } from '../lib/email-providers-api.js';

it('awaited refresh publishes validated data, retains failures, and performs no automatic reads', async () => {
  const host = document.createElement('div'),
    root = createRoot(host);
  let catalogue!: ReturnType<typeof useProviderCatalogue<string[]>>;
  const load = vi
    .fn()
    .mockResolvedValueOnce(['accepted'])
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(['fresh']);
  function Probe() {
    catalogue = useProviderCatalogue(useCatalogueScope(useCallback(() => {}, [])), load);
    return <p>{catalogue.data?.join(',')}</p>;
  }
  try {
    await act(async () =>
      root.render(
        <QueryProvider>
          <Probe />
        </QueryProvider>
      )
    );
    expect(catalogue.data).toEqual(['accepted']);
    await act(async () => catalogue.refresh());
    expect(catalogue.data).toEqual(['accepted']);
    expect(catalogue.error).toBe(true);
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    await act(async () => {});
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () => catalogue.refresh());
    expect(catalogue.data).toEqual(['fresh']);
    expect(catalogue.loading).toBe(false);
    expect(catalogue.error).toBe(false);
  } finally {
    await act(async () => root.unmount());
  }
});
it('explicit refresh replaces a pending initial read and ignores its delayed denial', async () => {
  const host = document.createElement('div'),
    root = createRoot(host);
  let catalogue!: ReturnType<typeof useProviderCatalogue<string[]>>;
  let reject!: (reason: unknown) => void;
  const denied = vi.fn();
  const load = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<string[]>((_resolve, no) => {
          reject = no;
        })
    )
    .mockResolvedValueOnce(['fresh']);
  function Probe() {
    catalogue = useProviderCatalogue(useCatalogueScope(denied), load);
    return null;
  }
  try {
    await act(async () =>
      root.render(
        <QueryProvider>
          <Probe />
        </QueryProvider>
      )
    );
    const signal = load.mock.calls[0]![0] as AbortSignal;
    await act(async () => catalogue.refresh());
    expect(signal.aborted).toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
    expect(catalogue.data).toEqual(['fresh']);
    await act(async () => reject(new ProviderRequestError(true)));
    expect(denied).not.toHaveBeenCalled();
    expect(catalogue.data).toEqual(['fresh']);
  } finally {
    await act(async () => root.unmount());
  }
});
it('separate provider readers share permission scope without sharing data and withdraw old-account results', async () => {
  const host = document.createElement('div'),
    root = createRoot(host);
  let catalogue!: ReturnType<typeof useProviderCatalogue<string[]>>;
  let choices!: ReturnType<typeof useProviderCatalogue<string[]>>;
  let next!: (value: string[]) => void;
  const load = vi
    .fn()
    .mockResolvedValueOnce(['provider-a'])
    .mockImplementationOnce(
      () =>
        new Promise<string[]>((resolve) => {
          next = resolve;
        })
    );
  const loadChoices = vi.fn().mockResolvedValue(['choice']);
  function Probe() {
    const scope = useCatalogueScope(useCallback(() => {}, []));
    catalogue = useProviderCatalogue(scope, load);
    choices = useProviderCatalogue(scope, loadChoices);
    return <p>{catalogue.data?.join(',') ?? 'unavailable'}</p>;
  }
  const render = (account: string) =>
    root.render(
      <QueryProvider>
        <AccountUserProvider value={account}>
          <Probe />
        </AccountUserProvider>
      </QueryProvider>
    );
  try {
    await act(async () => render('a'));
    expect(catalogue.data).toEqual(['provider-a']);
    expect(choices.data).toEqual(['choice']);
    await act(async () => render('b'));
    expect(catalogue.data).toBeNull();
    expect(catalogue.loading).toBe(true);
    expect(host.textContent).toBe('unavailable');
    expect(choices.data).toEqual(['choice']);
    expect(loadChoices).toHaveBeenCalledTimes(2);
    await act(async () => next(['provider-b']));
    expect(catalogue.data).toEqual(['provider-b']);
    expect(choices.data).toEqual(['choice']);
  } finally {
    await act(async () => root.unmount());
  }
});
