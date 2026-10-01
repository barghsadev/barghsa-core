import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TeamPage } from './TeamPage.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import { teamCatalogue, teamProfiles, ownershipTransfer } from '../test/team-catalogue-fixtures.js';
import { validTeam, validTeamProfiles, validTransfers, teamBasis } from '../lib/team-catalogue.js';
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useTimezone.js', () => ({
  useTimezone: () => ({ status: 'ready', timezone: 'UTC', retry: vi.fn() }),
}));
let host: HTMLDivElement, root: Root;
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function click(name: string, dialog = false) {
  const area = dialog ? document.querySelector('[role=dialog]')! : host;
  const button = [...area.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === name
  );
  expect(button, name).toBeDefined();
  await act(async () => button!.click());
}
async function fill(selector: string, value: string) {
  await act(async () => {
    const element = document.querySelector<HTMLInputElement>(selector)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () =>
    document
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}
async function render(
  read: (path: string, init?: RequestInit) => Response | Promise<Response>,
  strict = false
) {
  const fetch = vi.fn((path: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(read(String(path), init))
  );
  vi.stubGlobal('fetch', fetch);
  await act(async () =>
    root.render(
      strict ? (
        <StrictMode>
          <TeamPage />
        </StrictMode>
      ) : (
        <TeamPage />
      )
    )
  );
  return fetch;
}
const baseline = (path: string) =>
  reply(
    path.endsWith('ownership-transfers')
      ? { transfers: [ownershipTransfer()] }
      : path.endsWith('/agents')
        ? teamCatalogue()
        : teamProfiles()
  );
const finance = () =>
  [...host.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].find(
    (n) => n.parentElement?.textContent === 'Finance'
  )!;
const saveRoles = () =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === 'Save roles'
  )!;
it.each([
  null,
  {},
  { ...teamCatalogue(), profileId: '../x' },
  { ...teamCatalogue(), agents: [{ ...teamCatalogue().agents[0], status: 'Pending' }] },
  { ...teamCatalogue(), agents: [{ ...teamCatalogue().agents[1], userId: 'private-user' }] },
  { ...teamCatalogue(), agents: [{ ...teamCatalogue().agents[1], name: 'private-name' }] },
  { ...teamCatalogue(), agents: [{ ...teamCatalogue().agents[0], createdAt: 'bad' }] },
  { ...teamCatalogue(), agents: [teamCatalogue().agents[0], teamCatalogue().agents[0]] },
])('rejects malformed or privacy-breaking team DTO %j', (value) =>
  expect(validTeam(value)).toBe(false)
);
it('validates unique profile, transfer and membership identities with stable metadata', () => {
  expect(validTeam(teamCatalogue())).toBe(true);
  expect(validTeamProfiles(teamProfiles())).toBe(true);
  expect(validTransfers({ transfers: [ownershipTransfer()] })).toBe(true);
  expect(validTransfers({ transfers: [ownershipTransfer(), ownershipTransfer()] })).toBe(false);
  expect(validTeamProfiles({ ...teamProfiles(), activeProfileId: 'other' })).toBe(false);
  expect(teamBasis({ ...teamCatalogue(), agents: [...teamCatalogue().agents].reverse() })).toBe(
    teamBasis(teamCatalogue())
  );
});
it('retains invitation input and independent transfers while member read pauses writes', async () => {
  let fail = false;
  const requests = await render((path, init) =>
    path.endsWith('/agents') && fail
      ? reply({}, 503)
      : init?.method
        ? reply({ id: 'new-invite' }, 201)
        : baseline(path)
  );
  await click('Invite a team member');
  await fill('#team-username', 'local@example.test');
  fail = true;
  await click('Refresh members', true);
  expect(document.querySelector<HTMLInputElement>('#team-username')!.value).toBe(
    'local@example.test'
  );
  expect(host.textContent).toContain('Transfer company');
  await submit();
  expect(requests.mock.calls.filter(([, init]) => init?.method)).toHaveLength(0);
  fail = false;
  await click('Refresh members', true);
  await submit();
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(host.textContent).toContain('Invitation sent');
});
it('retains local role choices through read failure and requires reset after saved roles change', async () => {
  let fail = false,
    changed = false;
  await render((path) =>
    path.endsWith('/agents')
      ? reply(
          changed
            ? { ...teamCatalogue(), agents: [{ ...teamCatalogue().agents[0], role: 'Legal' }] }
            : teamCatalogue(),
          fail ? 503 : 200
        )
      : baseline(path)
  );
  await act(async () => finance().click());
  fail = true;
  await click('Refresh members');
  expect(finance().checked).toBe(true);
  expect(saveRoles().disabled).toBe(true);
  changed = true;
  fail = false;
  await click('Refresh members');
  expect(finance().checked).toBe(true);
  expect(saveRoles().disabled).toBe(true);
  expect(host.textContent).toContain('Saved roles changed');
  await click('Reset to saved roles');
  expect(finance().checked).toBe(false);
  expect(host.textContent).not.toContain('Saved roles changed');
});
it('profile retry keeps member drafts without reloading the independent catalogue', async () => {
  let fail = false;
  const requests = await render((path) =>
    path === '/api/profiles' && fail ? reply({}, 503) : baseline(path)
  );
  await act(async () => finance().click());
  fail = true;
  await click('Refresh profile');
  expect(finance().checked).toBe(true);
  expect(saveRoles().disabled).toBe(true);
  fail = false;
  await click('Refresh profile');
  expect(saveRoles().disabled).toBe(false);
  expect(requests.mock.calls.filter(([path]) => String(path).endsWith('/agents'))).toHaveLength(1);
});
it('transfer review survives failed read then closes after its saved target changes', async () => {
  let fail = false,
    changed = false;
  await render((path) =>
    path.endsWith('ownership-transfers')
      ? reply(
          {
            transfers: [
              {
                ...ownershipTransfer(),
                expiresAt: changed ? '2099-10-01T00:00:00Z' : ownershipTransfer().expiresAt,
              },
            ],
          },
          fail ? 503 : 200
        )
      : baseline(path)
  );
  await click('Decline request');
  fail = true;
  await click('Refresh ownership requests', true);
  expect(document.querySelector('[role=dialog]')).not.toBeNull();
  expect(
    document.querySelector<HTMLButtonElement>('[role=dialog] button[type=submit]')!.disabled
  ).toBe(true);
  fail = false;
  await click('Refresh ownership requests', true);
  expect(
    document.querySelector<HTMLButtonElement>('[role=dialog] button[type=submit]')!.disabled
  ).toBe(false);
  changed = true;
  await click('Refresh ownership requests', true);
  expect(document.querySelector('[role=dialog]')).toBeNull();
});
it('role password review keeps its password during retry and withdraws changed membership', async () => {
  let fail = false,
    changed = false;
  await render((path, init) =>
    init?.method
      ? reply({ requiresStepUp: true }, 403)
      : path.endsWith('/agents')
        ? reply(
            changed
              ? { ...teamCatalogue(), agents: [{ ...teamCatalogue().agents[0], role: 'Legal' }] }
              : teamCatalogue(),
            fail ? 503 : 200
          )
        : baseline(path)
  );
  await act(async () => finance().click());
  await click('Save roles');
  await submit();
  await fill('[role=dialog] input[type=password]', 'synthetic-password');
  fail = true;
  await click('Refresh members', true);
  expect(
    document.querySelector<HTMLInputElement>('[role=dialog] input[type=password]')!.value
  ).toBe('synthetic-password');
  fail = false;
  changed = true;
  await click('Refresh members', true);
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(finance().checked).toBe(true);
  expect(saveRoles().disabled).toBe(true);
});
for (const status of [403])
  it(`member denial ${status} clears private work and preserves account ownership requests`, async () => {
    let deny = false;
    await render((path) => (path.endsWith('/agents') && deny ? reply({}, status) : baseline(path)));
    await click('Invite a team member');
    await fill('#team-username', 'private@example.test');
    deny = true;
    await click('Refresh members', true);
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(host.textContent).not.toContain('member@example.test');
    expect(host.textContent).toContain('Transfer company');
    deny = false;
    await click('Refresh members');
    await click('Invite a team member');
    expect(document.querySelector<HTMLInputElement>('#team-username')!.value).toBe('');
  });
it('account denial clears both catalogues and pending confirmation before recovery', async () => {
  let deny = false;
  await render((path) => (path === '/api/profiles' && deny ? reply({}, 403) : baseline(path)));
  await click('Decline request');
  deny = true;
  await click('Refresh profile');
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(host.textContent).not.toContain('Transfer company');
  expect(host.textContent).not.toContain('member@example.test');
  deny = false;
  await click('Refresh profile');
  expect(host.textContent).toContain('member@example.test');
});
it('profile replacement discards old invitation work and ignores late success', async () => {
  let changed = false,
    resolve!: (response: Response) => void;
  await render((path, init) =>
    init?.method
      ? new Promise((done) => {
          resolve = done;
        })
      : path === '/api/profiles' && changed
        ? reply({
            profiles: [{ id: 'another-profile', profileType: 'LEGAL', title: 'Other' }],
            activeProfileId: 'another-profile',
          })
        : path.includes('another-profile')
          ? reply({ ...teamCatalogue(), profileId: 'another-profile', profileName: 'Other' })
          : baseline(path)
  );
  await click('Invite a team member');
  await fill('#team-username', 'old@example.test');
  await submit();
  changed = true;
  await click('Refresh profile');
  expect(document.querySelector('[role=dialog]')).toBeNull();
  await act(async () => resolve(reply({ id: 'late-invite' }, 201)));
  expect(host.textContent).not.toContain('Invitation sent');
  await click('Invite a team member');
  expect(document.querySelector<HTMLInputElement>('#team-username')!.value).toBe('');
});
it('broadcast profile context invalidates an old editor and pending request', async () => {
  let resolve!: (response: Response) => void;
  await render((path, init) =>
    init?.method
      ? new Promise((done) => {
          resolve = done;
        })
      : baseline(path)
  );
  await click('Invite a team member');
  await fill('#team-username', 'old@example.test');
  await submit();
  await act(async () => refreshProfileContext());
  await act(async () => resolve(reply({ id: 'late-invite' }, 201)));
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(host.textContent).not.toContain('Invitation sent');
});
it.each([{}, { id: '../unsafe' }])(
  'unconfirmed invitation success preserves the proposal %j',
  async (receipt) => {
    await render((path, init) => (init?.method ? reply(receipt, 201) : baseline(path)));
    await click('Invite a team member');
    await fill('#team-username', 'local@example.test');
    await submit();
    expect(document.querySelector<HTMLInputElement>('#team-username')!.value).toBe(
      'local@example.test'
    );
    expect(document.querySelector('[role=dialog] [role=alert]')).not.toBeNull();
  }
);
it('owner row explains why removal and reassignment are unavailable', async () => {
  await render((path) =>
    path.endsWith('/agents')
      ? reply({ ...teamCatalogue(), agents: [{ ...teamCatalogue().agents[0], role: 'Owner' }] })
      : baseline(path)
  );
  expect(host.textContent).toContain('Transfer ownership first');
  expect(
    [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'Remove member'
    )!.disabled
  ).toBe(true);
  expect(host.querySelector('input[type=checkbox]')).toBeNull();
});
it('strict effect replay retains independent collection readiness', async () => {
  await render(baseline, true);
  expect(host.textContent).toContain('member@example.test');
  expect(host.textContent).toContain('Transfer company');
});
it('confirmed role choices remain current after authoritative membership reload', async () => {
  let changed = false;
  await render((path, init) => {
    if (init?.method) {
      changed = true;
      return reply({ roles: ['Manager', 'Finance'] });
    }
    return path.endsWith('/agents') && changed
      ? reply({
          ...teamCatalogue(),
          agents: [
            ...teamCatalogue().agents,
            { ...teamCatalogue().agents[0], id: 'finance-membership', role: 'Finance' },
          ],
        })
      : baseline(path);
  });
  await act(async () => finance().click());
  await click('Save roles');
  await submit();
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(finance().checked).toBe(true);
  expect(host.textContent).not.toContain('Saved roles changed');
  expect(saveRoles().disabled).toBe(true);
});
it('mismatched role acknowledgement retains the proposal without reporting success', async () => {
  await render((path, init) => (init?.method ? reply({ roles: ['Legal'] }) : baseline(path)));
  await act(async () => finance().click());
  await click('Save roles');
  await submit();
  expect(document.querySelector('[role=dialog]')).not.toBeNull();
  expect(document.querySelector('[role=dialog] [role=alert]')).not.toBeNull();
  expect(host.textContent).not.toContain('Change saved');
});
it.each(['read', 'invite', 'remove'])(
  'expired session during member %s clears all private catalogues',
  async (operation) => {
    let denied = false;
    await render((path, init) =>
      (operation === 'read' && path.endsWith('/agents') && denied) ||
      (operation !== 'read' && init?.method)
        ? reply({}, 401)
        : baseline(path)
    );
    if (operation === 'read') {
      denied = true;
      await click('Refresh members');
    }
    if (operation === 'invite') {
      await click('Invite a team member');
      await fill('#team-username', 'private@example.test');
      await submit();
    }
    if (operation === 'remove') {
      await click('Remove member');
      await submit();
    }
    expect(host.textContent).not.toContain('Transfer company');
    expect(host.textContent).not.toContain('member@example.test');
    expect(document.querySelector('[role=dialog]')).toBeNull();
  }
);
