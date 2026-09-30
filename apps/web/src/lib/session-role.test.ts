import { afterEach, expect, it, vi } from 'vitest';
import { readSessionContext, readSessionRole } from './session-role.js';

afterEach(() => vi.unstubAllGlobals());

it('distinguishes customer, staff, and missing sessions', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ isStaff: false })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ isStaff: true })))
    .mockResolvedValueOnce(new Response(null, { status: 401 }));
  vi.stubGlobal('fetch', fetchMock);

  expect(await readSessionRole()).toBe(false);
  expect(await readSessionRole()).toBe(true);
  expect(await readSessionRole()).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it('does not guess a role from an incomplete session response', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ userId: 'one' })))
  );
  await expect(readSessionRole()).rejects.toThrow('Invalid session response');
});

it('uses the selected context instead of staff eligibility for routing', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ isStaff: true, operatingContext: 'customer', canSwitchContext: true })
        )
      )
  );
  expect(await readSessionContext()).toEqual({
    isStaff: true,
    operatingContext: 'customer',
    canSwitchContext: true,
  });
});
