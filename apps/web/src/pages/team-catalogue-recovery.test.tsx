import { validTeamActivity } from '@barghsa/shared/team-activity';
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
    const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
    Object.getOwnPropertyDescriptor(
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      'value'
    )!.set!.call(element, value);
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
    expect(host.textContent).not.toContain('m***@example.test');
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
  expect(host.textContent).not.toContain('m***@example.test');
  deny = false;
  await click('Refresh profile');
  expect(host.textContent).toContain('m***@example.test');
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
  expect(host.textContent).toContain('m***@example.test');
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
    expect(host.textContent).not.toContain('m***@example.test');
    expect(document.querySelector('[role=dialog]')).toBeNull();
  }
);

it('masks directory identities and shows names, avatars and known dates without exposing contact text', async () => {
  const team = teamCatalogue();
  team.agents[0] = {
    ...team.agents[0]!,
    name: 'Example Member',
    invitedAt: '2026-07-01T00:00:00Z',
    lastActiveAt: '2026-09-01T00:00:00Z',
  };
  await render((path) => (path.endsWith('/agents') ? reply(team) : baseline(path)));
  expect(host.textContent).toContain('Example Member');
  expect(host.textContent).toContain('m***@example.test');
  expect(host.textContent).toContain('i***@example.test');
  expect(host.textContent).not.toContain('member@example.test');
  expect(host.textContent).not.toContain('invited@example.test');
  expect(host.querySelectorAll('[data-slot=avatar]')).toHaveLength(2);
  expect(host.querySelector('time[datetime="2026-07-01T00:00:00Z"]')).not.toBeNull();
  expect(host.querySelector('time[datetime="2026-09-01T00:00:00Z"]')).not.toBeNull();
});
it('retains an optional message through failures, submits it and clears it only after an acknowledged invitation', async () => {
  let fail = true;
  const requests = await render((path, init) =>
    init?.method ? reply(fail ? {} : { id: 'invite-note' }, fail ? 409 : 201) : baseline(path)
  );
  await click('Invite a team member');
  await fill('#team-username', 'new@example.test');
  await fill('#invite-message', '  Personal note\n<script>text</script>  ');
  await submit();
  expect(document.querySelector<HTMLTextAreaElement>('#invite-message')!.value).toBe(
    '  Personal note\n<script>text</script>  '
  );
  expect(document.querySelector('[role=alert]')).not.toBeNull();
  fail = false;
  await submit();
  expect(
    JSON.parse(requests.mock.calls.find(([, init]) => init?.method)![1]!.body as string)
  ).toEqual({
    username: 'new@example.test',
    role: 'Manager',
    message: 'Personal note\n<script>text</script>',
  });
  await click('Invite a team member');
  expect(document.querySelector<HTMLTextAreaElement>('#invite-message')!.value).toBe('');
});
it('offers one transfer action on the owner row and preserves safe masked recipient labels', async () => {
  const team = teamCatalogue();
  team.agents.unshift({
    ...team.agents[0]!,
    id: 'owner-one',
    userId: 'owner',
    role: 'Owner',
    name: 'Example Owner',
  });
  await render((path) => (path.endsWith('/agents') ? reply(team) : baseline(path)));
  const buttons = [...host.querySelectorAll<HTMLButtonElement>('button')].filter(
    (b) => b.textContent === 'Transfer ownership'
  );
  expect(buttons).toHaveLength(1);
  expect(buttons[0]!.closest('tr')?.textContent).toContain('Example Owner');
  await click('Transfer ownership');
  expect(document.querySelector('[role=dialog]')?.textContent).toContain('Confirm your password');
});
it.each([
  { lastActiveAt: 'invalid' },
  { invitedAt: 'invalid' },
  { message: 2 },
  { message: 'x'.repeat(1001) },
])('rejects invalid optional directory metadata %j', (metadata) => {
  expect(
    validTeam({ ...teamCatalogue(), agents: [{ ...teamCatalogue().agents[0], ...metadata }] })
  ).toBe(false);
});

const historyPage = (cursor: string | null = null) => ({
  profileId: teamCatalogue().profileId,
  userId: 'member',
  items: [
    {
      id: 'activity-first',
      kind: 'orderCreated',
      performed: true,
      createdAt: '2026-09-01T00:00:00Z',
    },
  ],
  nextCursor: cursor,
});
const detailDialog = () => document.querySelector<HTMLElement>('[role=dialog]')!;
it('keeps accepted activity and the role draft through a failed next page and retries the same cursor', async () => {
  let fail = true;
  const reads: string[] = [];
  await render((path) => {
    if (path.includes('/activity')) {
      reads.push(path);
      return path.includes('?cursor=')
        ? fail
          ? reply({}, 503)
          : reply({
              ...historyPage(),
              items: [
                {
                  id: 'activity-second',
                  kind: 'rolesChanged',
                  performed: false,
                  createdAt: '2026-08-01T00:00:00Z',
                },
              ],
            })
        : reply(historyPage('next-page'));
    }
    return baseline(path);
  }, true);
  await click('View details');
  expect(detailDialog().textContent).toContain('Order created');
  const choice = [...detailDialog().querySelectorAll<HTMLInputElement>('input')].find(
    (n) => n.parentElement?.textContent === 'Finance'
  )!;
  await act(async () => choice.click());
  expect(choice.checked).toBe(true);
  await click('Older activity', true);
  expect(detailDialog().textContent).toContain('Could not load activity');
  expect(detailDialog().textContent).toContain('Order created');
  expect(choice.checked).toBe(true);
  fail = false;
  await click('Retry activity', true);
  expect(reads.slice(-2)).toEqual([
    expect.stringContaining('?cursor=next-page'),
    expect.stringContaining('?cursor=next-page'),
  ]);
  expect(detailDialog().textContent).toContain('Member roles changed');
  expect(detailDialog().textContent).toContain('Access change made by another person');
  expect(choice.checked).toBe(true);
  await click('Save roles', true);
  expect(detailDialog().textContent).toContain('m***@example.test');
  expect(detailDialog().textContent).toContain('Finance');
  await click('Cancel', true);
  expect(
    [...detailDialog().querySelectorAll<HTMLInputElement>('input')].find(
      (n) => n.parentElement?.textContent === 'Finance'
    )!.checked
  ).toBe(true);
});
it('keeps the detail role draft through a team read failure and requires resetting changed saved roles', async () => {
  let mode = 'ready';
  await render((path) =>
    path.includes('/activity')
      ? reply(historyPage())
      : path.endsWith('/agents')
        ? mode === 'error'
          ? reply({}, 503)
          : reply({
              ...teamCatalogue(),
              agents: teamCatalogue().agents.map((entry) =>
                entry.type === 'agent' && mode === 'changed' ? { ...entry, role: 'Legal' } : entry
              ),
            })
        : baseline(path)
  );
  await click('View details');
  const checkbox = () =>
    [...detailDialog().querySelectorAll<HTMLInputElement>('input')].find(
      (n) => n.parentElement?.textContent === 'Finance'
    )!;
  await act(async () => checkbox().click());
  mode = 'error';
  await click('Refresh members', true);
  expect(checkbox().checked).toBe(true);
  expect(
    [...detailDialog().querySelectorAll<HTMLButtonElement>('button')].find(
      (n) => n.textContent === 'Save roles'
    )!.disabled
  ).toBe(true);
  mode = 'changed';
  await click('Refresh members', true);
  expect(checkbox().checked).toBe(true);
  expect(detailDialog().textContent).toContain('Saved roles changed');
  await click('Reset to saved roles', true);
  expect(checkbox().checked).toBe(false);
});
it.each([401, 403])(
  'activity %s clears private detail and invalidates late reads, preserving only allowed account data',
  async (status) => {
    let deny = false,
      resolve!: (response: Response) => void;
    await render((path) =>
      path.includes('/activity')
        ? deny
          ? new Promise<Response>((done) => {
              resolve = done;
            })
          : reply(historyPage())
        : baseline(path)
    );
    await click('View details');
    deny = true;
    await click('Refresh activity', true);
    await act(async () => resolve(reply({}, status)));
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(host.textContent).not.toContain('m***@example.test');
    expect(host.textContent?.includes('Transfer company')).toBe(status === 403);
  }
);
it('pending detail shows plain-text invitation information without querying a recipient account or history', async () => {
  const requests = await render((path) =>
    path.endsWith('/agents')
      ? reply({
          ...teamCatalogue(),
          agents: teamCatalogue().agents.map((entry) =>
            entry.type === 'invitation'
              ? { ...entry, message: '<script>private note</script>' }
              : entry
          ),
        })
      : baseline(path)
  );
  const row = [...host.querySelectorAll('tr')].find((row) =>
    row.textContent?.includes('i***@example.test')
  )!;
  await act(async () =>
    [...row.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'View details')!
      .click()
  );
  expect(detailDialog().textContent).toContain('<script>private note</script>');
  expect(detailDialog().querySelector('script')).toBeNull();
  expect(detailDialog().textContent).toContain('Recipient account information is kept private');
  expect(requests.mock.calls.some(([path]) => String(path).includes('/activity'))).toBe(false);
  await click('Withdraw invitation', true);
  expect(detailDialog().textContent).toContain('i***@example.test');
});
it('ignores a late history response after switching profile context', async () => {
  let resolve!: (response: Response) => void;
  await render((path) =>
    path.includes('/activity')
      ? new Promise<Response>((done) => {
          resolve = done;
        })
      : baseline(path)
  );
  await click('View details');
  await act(async () => refreshProfileContext());
  await act(async () => resolve(reply(historyPage())));
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(host.textContent).not.toContain('Order created');
});
it('deduplicates overlapping pages and stops a repeated cursor', async () => {
  await render((path) =>
    path.includes('/activity') ? reply(historyPage('same-page')) : baseline(path)
  );
  await click('View details');
  await click('Older activity', true);
  expect(detailDialog().querySelectorAll('ol li')).toHaveLength(1);
  expect(detailDialog().textContent).not.toContain('Older activity');
});
it.each([
  { ...historyPage(), profileId: 'foreign' },
  { ...historyPage(), userId: 'foreign' },
  { ...historyPage(), items: [{ ...historyPage().items[0], kind: 'privateEvent' }] },
  { ...historyPage(), items: [historyPage().items[0], historyPage().items[0]] },
  { ...historyPage(), nextCursor: '../unsafe' },
  { ...historyPage(), items: [], nextCursor: 'unsafe-loop' },
])('rejects malformed and wrong-scope activity %j', (value) =>
  expect(validTeamActivity(value, teamCatalogue().profileId, 'member')).toBe(false)
);

it('never offers an Owner with a Manager role as the new owner', async () => {
  const team = teamCatalogue();
  team.agents.unshift(
    { ...team.agents[0]!, id: 'owner', userId: 'owner', role: 'Owner' },
    { ...team.agents[0]!, id: 'owner-manager', userId: 'owner', role: 'Manager' }
  );
  await render((path, init) =>
    path === '/api/auth/step-up'
      ? reply({ verified: true })
      : init?.method
        ? reply({})
        : path.endsWith('/agents')
          ? reply(team)
          : baseline(path)
  );
  await click('Transfer ownership');
  await fill('#team-step-up-password', 'fixture-password');
  await click('Confirm', true);
  const options = [...detailDialog().querySelectorAll<HTMLOptionElement>('option')].map(
    (option) => option.value
  );
  expect(options).toContain('member');
  expect(options).not.toContain('owner');
});
it.each(['agent', 'invitation'] as const)(
  '%s removal retains review for an invalid receipt and closes only after a verified result',
  async (type) => {
    let valid = false;
    const requests = await render((path, init) => {
      if (init?.method === 'DELETE')
        return reply(
          valid
            ? type === 'agent'
              ? { removed: true }
              : { id: 'invitation-one', status: 'Withdrawn' }
            : type === 'agent'
              ? { removed: false }
              : { id: 'wrong-target', status: 'Withdrawn' }
        );
      if (path.includes('/activity')) return reply(historyPage());
      return baseline(path);
    });
    const row = [...host.querySelectorAll('tr')].find((row) =>
      row.textContent?.includes(type === 'agent' ? 'm***@example.test' : 'i***@example.test')
    )!;
    await act(async () =>
      [...row.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent === 'View details')!
        .click()
    );
    await click(type === 'agent' ? 'Remove member' : 'Withdraw invitation', true);
    expect(requests.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(0);
    await click('Confirm', true);
    expect(detailDialog().textContent).toContain('The action could not be completed');
    expect(host.textContent).not.toContain('Change saved');
    valid = true;
    await click('Confirm', true);
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(host.textContent).toContain('Change saved');
  }
);
