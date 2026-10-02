import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { NavigationProvider, useNavigation } from './useNavigation.js';
import { getProfileContextRevision, refreshProfileContext } from '../lib/profile-context.js';

it('clears the old menu immediately on a profile change and rejects a response started before that change', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const configuration = {
    version: 1 as const,
    area: 'customer' as const,
    profileId: 'first',
    profileType: 'INDIVIDUAL' as const,
    paths: ['/wallet'],
  };
  function View() {
    return <span>{useNavigation()?.paths.join(',') ?? 'Unavailable'}</span>;
  }
  const start = getProfileContextRevision();
  try {
    await act(async () =>
      root.render(
        <NavigationProvider configuration={configuration} revision={start}>
          <View />
        </NavigationProvider>
      )
    );
    expect(container.textContent).toBe('/wallet');
    await act(async () => refreshProfileContext());
    expect(container.textContent).toBe('Unavailable');
    await act(async () =>
      root.render(
        <NavigationProvider configuration={{ ...configuration }} revision={start}>
          <View />
        </NavigationProvider>
      )
    );
    expect(container.textContent).toBe('Unavailable');
    await act(async () =>
      root.render(
        <NavigationProvider
          configuration={{ ...configuration, profileId: 'second', paths: ['/contracts'] }}
          revision={getProfileContextRevision()}
        >
          <View />
        </NavigationProvider>
      )
    );
    expect(container.textContent).toBe('/contracts');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
