import { afterEach, expect, it, vi } from 'vitest';
import { readSessionContext, readSessionRole } from './session-role.js';
import { getProfileContextRevision } from './profile-context.js';

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
    navigationRevision: getProfileContextRevision(),
    isStaff: true,
    operatingContext: 'customer',
    canSwitchContext: true,
  });
});

it('retains the authenticated account ID for scoped preferences without another request', async () => {
  const request = vi
    .fn()
    .mockResolvedValue(Response.json({ userId: 'customer-one', isStaff: false }));
  vi.stubGlobal('fetch', request);
  expect(await readSessionContext()).toEqual({
    navigationRevision: getProfileContextRevision(),
    userId: 'customer-one',
    isStaff: false,
    operatingContext: 'customer',
    canSwitchContext: false,
  });
  expect(request).toHaveBeenCalledTimes(1);
});

it('preserves only validated account identity without confusing it with the active business profile', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json({
        userId: 'owner',
        isStaff: true,
        operatingContext: 'customer',
        username: 'Owner',
        email: 'owner@example.test',
        mobile: '+989121234567',
      })
    )
  );
  expect(await readSessionContext()).toMatchObject({
    userId: 'owner',
    username: 'Owner',
    email: 'owner@example.test',
    mobile: '+989121234567',
    operatingContext: 'customer',
  });
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(Response.json({ isStaff: false, username: {}, email: [], mobile: 123 }))
  );
  expect(await readSessionContext()).toEqual({
    navigationRevision: getProfileContextRevision(),
    isStaff: false,
    operatingContext: 'customer',
    canSwitchContext: false,
  });
});

it('distinguishes no profiles from a revoked active context or an unselected existing draft', async () => {
  const { readProfileAvailability } = await import('./session-role.js');
  const request = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ profiles: [], activeProfileId: null }))
    .mockResolvedValueOnce(
      Response.json({ profiles: [{ id: 'draft', status: 'DRAFT' }], activeProfileId: null })
    );
  vi.stubGlobal('fetch', request);
  const signal = new AbortController().signal;
  expect(await readProfileAvailability(signal)).toBe(false);
  expect(await readProfileAvailability(signal)).toBe(true);
});
it('does not permit an app route from a failed or malformed availability response', async () => {
  const { readProfileAvailability } = await import('./session-role.js');
  const request = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ profiles: [{}] }))
    .mockResolvedValueOnce(new Response(null, { status: 401 }));
  vi.stubGlobal('fetch', request);
  const signal = new AbortController().signal;
  await expect(readProfileAvailability(signal)).rejects.toThrow();
  await expect(readProfileAvailability(signal)).rejects.toThrow();
  expect(await readProfileAvailability(signal)).toBeNull();
});
it('ignores an availability response from an abandoned navigation', async () => {
  const { readProfileAvailability } = await import('./session-role.js');
  const controller = new AbortController();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async () => {
      controller.abort();
      return Response.json({ profiles: [] });
    })
  );
  await expect(readProfileAvailability(controller.signal)).rejects.toThrow(
    'Profile check cancelled'
  );
});
