import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Slots from './AdminAgentSlotsPage.js';
import Targets from './AdminServiceTargetsPage.js';
import {
  assignmentAgent as agent,
  otherAssignmentAgent as other,
  assignmentSlots,
} from '../test/assignment-settings-fixtures.js';
import { isAgentSlots, isAssignmentAgents, isResponseTargets } from '../lib/assignment-settings.js';
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.lang = 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
async function click(name: string, dialog = false) {
  const area = dialog ? document.querySelector('[role=dialog]')! : host;
  const button = [...area.querySelectorAll<HTMLButtonElement>('button')].find(
    (node) => node.textContent?.trim() === name
  );
  expect(button, name).toBeDefined();
  await act(async () => button!.click());
}
async function choose(key = 'individual_chatbot', value = agent.id) {
  await act(async () => {
    const node = host.querySelector<HTMLSelectElement>(`#slot-${key}`)!;
    node.value = value;
    node.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function fill(selector: string, value: string) {
  await act(async () => {
    const node = document.querySelector<HTMLInputElement>(selector)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit(selector = 'form') {
  await act(async () =>
    document
      .querySelector(selector)!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
  await vi.dynamicImportSettled();
  await act(async () => {});
}
const confirm = () =>
  document.querySelector<HTMLButtonElement>('[role=dialog] button[type=submit]')!;
const choices = () => host.querySelector<HTMLSelectElement>('#slot-individual_chatbot')!;
function slotReads(
  options: {
    slots?: () => Response | Promise<Response>;
    agents?: () => Response | Promise<Response>;
    write?: () => Response | Promise<Response>;
    stepUp?: () => Response | Promise<Response>;
  } = {}
) {
  const requests = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/auth/step-up'))
      return options.stepUp?.() ?? reply({ verified: true });
    if (init?.method && init.method !== 'GET') return options.write?.() ?? reply({});
    return String(input).endsWith('/agents')
      ? (options.agents?.() ?? reply([agent, other]))
      : (options.slots?.() ?? reply(assignmentSlots()));
  });
  vi.stubGlobal('fetch', requests);
  return requests;
}
const renderSlots = async () => {
  await act(async () => root.render(<Slots />));
};
it('slot choices and password survive independent read retries', async () => {
  let fail = false,
    agentFail = false;
  const requests = slotReads({
    write: () => reply({ requiresStepUp: true }, 403),
    slots: () => reply(assignmentSlots(), fail ? 503 : 200),
    agents: () => reply([agent, other], agentFail ? 503 : 200),
  });
  await renderSlots();
  await choose();
  await submit();
  await submit('[role=dialog] form');
  await fill('[role=dialog] input[type=password]', 'synthetic-password');
  // Read recovery must not erase the draft or password.
  fail = true;
  await click('Refresh', true);
  expect(choices().value).toBe(agent.id);
  expect(confirm().disabled).toBe(true);
  const agentReads = requests.mock.calls.filter(([u]) => String(u).endsWith('/agents')).length;
  fail = false;
  await click('Refresh', true);
  expect(confirm().disabled).toBe(false);
  expect(requests.mock.calls.filter(([u]) => String(u).endsWith('/agents'))).toHaveLength(
    agentReads
  );
  const slotReadsCount = requests.mock.calls.filter(([u]) =>
    String(u).endsWith('/agent-slots')
  ).length;
  agentFail = true;
  await click('Retry agents', true);
  expect(confirm().disabled).toBe(true);
  expect(
    document.querySelector<HTMLInputElement>('[role=dialog] input[type=password]')!.value
  ).toBe('synthetic-password');
  agentFail = false;
  await click('Retry agents', true);
  expect(confirm().disabled).toBe(false);
  expect(requests.mock.calls.filter(([u]) => String(u).endsWith('/agent-slots'))).toHaveLength(
    slotReadsCount
  );
});
it('fresh slot version invalidates review and retains a stale choice until explicit reset', async () => {
  let changed = false;
  slotReads({
    slots: () =>
      reply(
        assignmentSlots().map((row) =>
          row.slotKey === 'individual_chatbot' && changed
            ? { ...row, updatedAt: '2026-10-01T01:00:00Z' }
            : row
        )
      ),
  });
  await renderSlots();
  await choose();
  await submit();
  changed = true;
  await click('Refresh', true);
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(choices().value).toBe(agent.id);
  expect(host.textContent).toContain('The saved assignment changed');
  expect(host.querySelector<HTMLButtonElement>('form button[type=submit]')!.disabled).toBe(true);
  await click('Reset to current assignment');
  expect(choices().value).toBe('');
});
it('withdrawn agent remains visible in the choice without sending an obsolete assignment', async () => {
  let withdrawn = false;
  const requests = slotReads({ agents: () => reply(withdrawn ? [other] : [agent, other]) });
  await renderSlots();
  await choose();
  await submit();
  withdrawn = true;
  await click('Retry agents', true);
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(choices().value).toBe(agent.id);
  expect(choices().selectedOptions[0]!.textContent).toBe('Selected agent unavailable');
  await submit();
  expect(requests.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
});
it('changed agent configuration invalidates review even when its displayed name is unchanged', async () => {
  let changed = false;
  slotReads({
    agents: () =>
      reply([{ ...agent, updatedAt: changed ? '2026-10-01T01:00:00Z' : agent.updatedAt }, other]),
  });
  await renderSlots();
  await choose();
  await submit();
  changed = true;
  await click('Retry agents', true);
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(choices().value).toBe(agent.id);
});
it('slot save requires an exact acknowledgement and preserves unrelated choices', async () => {
  let valid = false,
    persisted = assignmentSlots();
  slotReads({
    slots: () => reply(persisted),
    write: () => {
      if (valid)
        persisted = persisted.map((row) =>
          row.slotKey === 'individual_chatbot'
            ? { ...row, agent, alsoUsedIn: ['staff_chatbot'], updatedAt: '2026-10-01T01:00:00Z' }
            : row.slotKey === 'staff_chatbot'
              ? { ...row, alsoUsedIn: ['individual_chatbot'] }
              : row
        );
      return reply(
        valid
          ? {
              ...assignmentSlots()[0],
              agent,
              alsoUsedIn: ['staff_chatbot'],
              updatedAt: '2026-10-01T01:00:00Z',
            }
          : { ...assignmentSlots()[0], agent: other }
      );
    },
  });
  await renderSlots();
  await choose();
  await choose('website_chatbot', other.id);
  await submit();
  await submit('[role=dialog] form');
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(host.textContent).toContain('The save could not be verified.');
  expect(choices().value).toBe(agent.id);
  valid = true;
  await click('Reset to saved settings');
  await choose();
  await submit();
  await submit('[role=dialog] form');
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(host.querySelector<HTMLSelectElement>('#slot-website_chatbot')!.value).toBe(other.id);
  expect(choices().value).toBe(agent.id);
  expect(host.textContent).toContain('Assignment saved.');
});
it.each(['renamed', 'enabled', 'sharing'])(
  'slot acknowledgement rejects changed reviewed metadata: %s',
  async (change) => {
    slotReads({
      write: () =>
        reply({
          ...assignmentSlots()[0],
          agent: {
            ...agent,
            title: change === 'renamed' ? 'Changed remotely' : agent.title,
            enabled: change === 'enabled',
          },
          alsoUsedIn: change === 'sharing' ? [] : ['staff_chatbot'],
        }),
    });
    await renderSlots();
    await choose();
    await submit();
    await submit('[role=dialog] form');
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(host.textContent).toContain('The save could not be verified.');
    expect(choices().value).toBe(agent.id);
    expect(host.textContent).not.toContain('Assignment saved.');
  }
);
it('slot unassignment acknowledgement must confirm null for the chosen slot', async () => {
  let valid = false,
    persisted = assignmentSlots();
  slotReads({
    slots: () => reply(persisted),
    write: () => {
      if (valid)
        persisted = persisted.map((row) =>
          row.slotKey === 'staff_chatbot' ? { ...row, agent: null } : row
        );
      return reply({ ...assignmentSlots()[2], agent: valid ? null : agent });
    },
  });
  await renderSlots();
  await choose('staff_chatbot', '');
  await act(async () =>
    host
      .querySelector<HTMLSelectElement>('#slot-staff_chatbot')!
      .form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
  await submit('[role=dialog] form');
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(host.textContent).toContain('The save could not be verified.');
  valid = true;
  await click('Reset to saved settings');
  await choose('staff_chatbot', '');
  await act(async () =>
    host
      .querySelector<HTMLSelectElement>('#slot-staff_chatbot')!
      .form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
  await vi.dynamicImportSettled();
  await act(async () => {});
  await submit('[role=dialog] form');
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(host.querySelector<HTMLSelectElement>('#slot-staff_chatbot')!.value).toBe('');
});
function targetReads(
  options: {
    read?: () => Response | Promise<Response>;
    write?: () => Response | Promise<Response>;
    stepUp?: () => Response | Promise<Response>;
  } = {}
) {
  const requests = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).endsWith('/auth/step-up')
      ? (options.stepUp?.() ?? reply({ verified: true }))
      : init?.method === 'PUT'
        ? (options.write?.() ?? reply({}))
        : (options.read?.() ?? reply({ ticket: 24, verification_case: null }))
  );
  vi.stubGlobal('fetch', requests);
  return requests;
}
const renderTargets = async () => {
  await act(async () => root.render(<Targets />));
};
const target = () => host.querySelector<HTMLInputElement>('#target-ticket')!;
it('target draft survives transient failure and property ordering without losing the edited value', async () => {
  let failed = false;
  targetReads({ read: () => reply({ verification_case: null, ticket: 24 }, failed ? 503 : 200) });
  await renderTargets();
  await fill('#target-ticket', '72');
  failed = true;
  await click('Refresh response targets');
  expect(target().value).toBe('72');
  expect(host.querySelector<HTMLButtonElement>('form button[type=submit]')!.disabled).toBe(true);
  failed = false;
  await click('Refresh response targets');
  expect(target().value).toBe('72');
  expect(host.querySelector<HTMLButtonElement>('form button[type=submit]')!.disabled).toBe(false);
});
it('changed saved targets retain local edits and invalidate confirmation until reset', async () => {
  let changed = false;
  targetReads({ read: () => reply({ ticket: changed ? 48 : 24, verification_case: null }) });
  await renderTargets();
  await fill('#target-ticket', '72');
  await submit();
  changed = true;
  await click('Refresh response targets', true);
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(target().value).toBe('72');
  expect(host.textContent).toContain('Saved targets changed');
  await click('Reset to current targets');
  expect(target().value).toBe('48');
});
it('targets reject mismatched acknowledgement and require authoritative recovery before another write', async () => {
  let valid = false,
    persisted = { ticket: 24, verification_case: null as number | null };
  const requests = targetReads({
    read: () => reply(persisted),
    write: () => {
      if (valid) persisted = { ticket: 72, verification_case: null };
      return reply(valid ? persisted : { ticket: 71, verification_case: null });
    },
  });
  await renderTargets();
  await fill('#target-ticket', '72');
  await submit();
  await submit('[role=dialog] form');
  expect(document.querySelector('[role=dialog] [role=alert]')).not.toBeNull();
  expect(target().value).toBe('72');
  expect(host.textContent).not.toContain('Changes saved.');
  expect(confirm().disabled).toBe(true);
  await submit('[role=dialog] form');
  expect(requests.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
  await click('Cancel', true);
  valid = true;
  await click('Refresh response targets');
  await submit();
  await submit('[role=dialog] form');
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(target().value).toBe('72');
  expect(
    requests.mock.calls
      .filter(([, init]) => init?.method === 'PUT')
      .map(([, init]) => JSON.parse(String(init?.body)))
  ).toEqual(Array(2).fill({ ticket: 72, verification_case: null }));
});
it.each(['0', '1.5', '8761', ''])(
  'target submit rejects invalid hours %s even without native form validation',
  async (value) => {
    const requests = targetReads();
    await renderTargets();
    await fill('#target-ticket', value);
    await submit();
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(requests.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  }
);
for (const scenario of [
  {
    name: 'slots',
    render: renderSlots,
    refresh: 'Refresh',
    edit: async () => choose(),
    resource: '/api/admin/agent-slots',
  },
  {
    name: 'targets',
    render: renderTargets,
    refresh: 'Refresh response targets',
    edit: async () => fill('#target-ticket', '72'),
    resource: '/api/admin/config/service-response-targets',
  },
]) {
  function requests(
    options: {
      status?: () => number;
      write?: () => Response | Promise<Response>;
      stepUp?: () => Response | Promise<Response>;
    } = {}
  ) {
    return scenario.name === 'slots'
      ? slotReads({
          slots: () => reply(assignmentSlots(), options.status?.() ?? 200),
          ...(options.write ? { write: options.write } : {}),
          ...(options.stepUp ? { stepUp: options.stepUp } : {}),
        })
      : targetReads({
          read: () => reply({ ticket: 24, verification_case: null }, options.status?.() ?? 200),
          ...(options.write ? { write: options.write } : {}),
          ...(options.stepUp ? { stepUp: options.stepUp } : {}),
        });
  }
  it.each([401, 403])(
    `${scenario.name}: denied read %s clears accepted rows and local edits`,
    async (status) => {
      let denied = false;
      requests({ status: () => (denied ? status : 200) });
      await scenario.render();
      await scenario.edit();
      await submit();
      denied = true;
      await click(scenario.refresh, true);
      expect(document.querySelector('[role=dialog]')).toBeNull();
      expect(host.querySelector('form')).toBeNull();
      denied = false;
      await click(scenario.refresh);
      expect(host.querySelector('form')).not.toBeNull();
      expect(scenario.name === 'slots' ? choices().value : target().value).toBe(
        scenario.name === 'slots' ? '' : '24'
      );
    }
  );
  it(`${scenario.name}: denied command clears the review and local work`, async () => {
    requests({ write: () => reply({}, 403) });
    await scenario.render();
    await scenario.edit();
    await submit();
    await submit('[role=dialog] form');
    expect(host.querySelector('form')).toBeNull();
    expect(document.querySelector('[role=dialog]')).toBeNull();
  });
  it(`${scenario.name}: delayed password verification cannot send after its required read fails`, async () => {
    let failed = false,
      resolve!: (response: Response) => void;
    const calls = requests({
      status: () => (failed ? 503 : 200),
      write: () => reply({ requiresStepUp: true }, 403),
      stepUp: () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    });
    await scenario.render();
    await scenario.edit();
    await submit();
    await submit('[role=dialog] form');
    await fill('[role=dialog] input[type=password]', 'synthetic-password');
    await submit('[role=dialog] form');
    failed = true;
    await click(scenario.refresh, true);
    await act(async () => resolve(reply({ verified: true })));
    expect(calls.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
    expect(confirm().disabled).toBe(true);
  });
  it(`${scenario.name}: obsolete late command cannot revive private state after denial`, async () => {
    let denied = false,
      resolve!: (response: Response) => void;
    requests({
      status: () => (denied ? 403 : 200),
      write: () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    });
    await scenario.render();
    await scenario.edit();
    await submit();
    await submit('[role=dialog] form');
    denied = true;
    await click(scenario.refresh, true);
    await act(async () =>
      resolve(
        reply(
          scenario.name === 'slots'
            ? { ...assignmentSlots()[0], agent, alsoUsedIn: ['staff_chatbot'] }
            : { ticket: 72, verification_case: null }
        )
      )
    );
    expect(host.querySelector('form')).toBeNull();
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(host.querySelector('[role=status]')).toBeNull();
  });
}
it('Independent agent denial clears slots and rejects an older slot response', async () => {
  let denied = false,
    pending = false,
    resolve!: (response: Response) => void;
  slotReads({
    slots: () =>
      pending
        ? new Promise<Response>((r) => {
            resolve = r;
          })
        : reply(assignmentSlots()),
    agents: () => reply([agent], denied ? 403 : 200),
  });
  await renderSlots();
  await choose();
  pending = true;
  await click('Refresh');
  denied = true;
  await click('Retry agents');
  await act(async () => resolve(reply(assignmentSlots())));
  expect(host.querySelector('form')).toBeNull();
});
it.each([
  null,
  [],
  {},
  { ticket: 24 },
  { ticket: 24, verification_case: null, unknown: 1 },
  { ticket: true, verification_case: null },
  { ticket: 0, verification_case: null },
])('malformed target metadata cannot become a saved map: %j', (value) =>
  expect(isResponseTargets(value)).toBe(false)
);
it.each([
  null,
  [],
  [assignmentSlots()[0]],
  [...assignmentSlots().slice(0, 4), assignmentSlots()[0]],
  assignmentSlots().map((row) => ({ ...row, updatedAt: 'invalid' })),
  assignmentSlots().map((row) => ({ ...row, alsoUsedIn: ['staff_chatbot'] })),
])('malformed slot metadata cannot authorize assignments: %j', (value) =>
  expect(isAgentSlots(value)).toBe(false)
);
it.each([
  null,
  [agent, agent],
  [{ ...agent, id: '../invalid' }],
  [{ ...agent, enabled: 'true' }],
  [{ ...agent, updatedAt: 'invalid' }],
])('malformed agent metadata is rejected: %j', (value) =>
  expect(isAssignmentAgents(value)).toBe(false)
);
