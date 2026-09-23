import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ElectricityIncreasePanel } from './ElectricityIncreasePanel.js';

vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ irrDigits: String }),
}));

afterEach(() => vi.unstubAllGlobals());

it('keeps increases hidden while the policy is disabled', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            request: null,
            maxPercentage: 0,
            originalKwh: '100',
            canRequest: false,
          })
        )
    )
  );
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(<ElectricityIncreasePanel contractId="contract-1" versionId="version-1" />)
    );
    expect(container.querySelector('input')).toBeNull();
    expect(container.textContent).not.toContain('Request more electricity');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('shows the one submitted request without offering a second submission', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            request: {
              requestedKwh: '120',
              status: 'pending',
              reviewReason: null,
              createdAt: '2026-09-23T00:00:00Z',
            },
            maxPercentage: 20,
            originalKwh: '100',
            canRequest: false,
          })
        )
    )
  );
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(<ElectricityIncreasePanel contractId="contract-1" versionId="version-1" />)
    );
    expect(container.textContent).toContain('Awaiting staff review');
    expect(container.textContent).toContain('120');
    expect(container.querySelector('input')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
