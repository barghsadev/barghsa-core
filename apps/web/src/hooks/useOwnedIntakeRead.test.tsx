import { QueryComponentProvider } from '../test/query-provider.js';
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useOwnedIntakeRead } from './useOwnedIntakeRead.js';
import { queryKeys } from '../lib/query-keys.js';

it.each([
  ['/api/electricity/orders/simple', {}],
  ['/api/profiles', { method: 'POST', body: '{}' }],
  ['/api/electricity/drafts/simple?profileId=profile-1', { method: 'PUT', body: '{}' }],
] as const)('refuses to dispatch a command through intake reads: %s %j', async (path, options) => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn());
  const accepted = vi.fn(),
    refused = vi.fn();
  function Probe() {
    const read = useOwnedIntakeRead('account-1:0');
    useEffect(() => {
      void read(
        queryKeys.profiles.authority(
          { context: 'account', ownerId: 'account-1', accountId: 'account-1', revision: 0 },
          'test'
        ),
        path,
        'Unavailable',
        options
      ).then(accepted, refused);
    }, [read]);
    return null;
  }
  const host = document.createElement('div'),
    root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <QueryComponentProvider>
          <Probe />
        </QueryComponentProvider>
      )
    );
    expect(refused).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: 'Invalid intake read' })
    );
    expect(accepted).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
