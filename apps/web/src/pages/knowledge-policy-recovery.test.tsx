import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Knowledge from './AdminKnowledgeBasesPage.js';
import Policies from './AdminAiPoliciesPage.js';
import type { TeamAction } from '../components/TeamActionDialog.js';
import {
  knowledgeBase as kb,
  knowledgeGroup as kg,
  knowledgeDetail as kd,
  policyEntry as policy,
  policySecond,
  policyGroup as pg,
} from '../test/knowledge-policy-fixtures.js';
const captured = vi.hoisted(() => ({
  action: null as TeamAction | null,
  success: null as (() => Promise<void>) | null,
  close: null as (() => void) | null,
  attach: null as ((key: string) => void) | null,
  disabled: false,
}));
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: ({
    action,
    onSuccess,
    onClose,
    confirmationDisabled,
  }: {
    action: TeamAction;
    onSuccess: () => Promise<void>;
    onClose: () => void;
    confirmationDisabled: boolean;
  }) => {
    captured.action = action;
    captured.success = onSuccess;
    captured.close = onClose;
    captured.disabled = confirmationDisabled;
    return <div data-testid="confirmation">{action.title}</div>;
  },
}));
vi.mock('../components/KnowledgeBaseDocumentPicker.js', () => ({
  KnowledgeBaseDocumentPicker: ({ onAttach }: { onAttach: (key: string) => void }) => {
    const [search, setSearch] = useState('');
    captured.attach = onAttach;
    return <input id="picker-search" value={search} onChange={(e) => setSearch(e.target.value)} />;
  },
}));
let host: HTMLDivElement, root: Root;
beforeEach(async () => {
  await import('../lib/catalogue-form-schemas.js');
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.lang = 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  captured.action = null;
  captured.success = null;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
async function render(Page: typeof Knowledge | typeof Policies) {
  await act(async () => root.render(<Page />));
}
async function click(text: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text
  );
  expect(button, text).toBeDefined();
  await act(async () => button!.click());
}
async function fill(selector: string, value: string) {
  const node = host.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    selector
  )!;
  expect(node, selector).not.toBeNull();
  await act(async () => {
    const proto =
      node instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : node instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(node, value);
    node.dispatchEvent(
      new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })
    );
  });
}
function mock(read: (path: string, init?: RequestInit) => Response | Promise<Response>) {
  const requests = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) =>
    read(String(url), init)
  );
  vi.stubGlobal('fetch', requests);
  return requests;
}
async function query() {
  const form = host.querySelector('#kb-test-query')!.closest('form')!;
  await act(async () =>
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}
const queryRows = [
  {
    id: 'chunk-one',
    kbId: kb.id,
    excerpt: 'Accepted guidance',
    score: 0.9,
    metadata: { fileName: 'Guide.txt' },
  },
];
it('knowledge list and detail are read once each and recovery preserves query and picker work', async () => {
  let fail = false;
  const requests = mock((path) =>
    path.endsWith('/query')
      ? response(queryRows)
      : path.endsWith(kb.id)
        ? response(kd)
        : response([kb], fail ? 503 : 200)
  );
  await render(Knowledge);
  await click('Open');
  expect(
    requests.mock.calls.filter(([u]) => String(u) === '/api/admin/knowledge-bases')
  ).toHaveLength(1);
  await fill('#kb-test-query', 'meter charge');
  await fill('#picker-search', 'guide');
  await query();
  fail = true;
  await click('Refresh');
  expect(host.textContent).toContain('Accepted guidance');
  expect(host.querySelector<HTMLInputElement>('#picker-search')!.value).toBe('guide');
  fail = false;
  const detailsBefore = requests.mock.calls.filter(([u]) => String(u).endsWith(kb.id)).length;
  await click('Retry');
  expect(requests.mock.calls.filter(([u]) => String(u).endsWith(kb.id))).toHaveLength(
    detailsBefore
  );
  expect(host.querySelector<HTMLInputElement>('#kb-test-query')!.value).toBe('meter charge');
});
it('fresh document-picker callbacks work after a changed document set while older uploads are discarded', async () => {
  let attached = true;
  mock((path) =>
    path.endsWith(kb.id)
      ? response({
          ...kd,
          documents: attached
            ? [
                {
                  id: 'doc',
                  storageKey: 'old-key',
                  fileName: 'Old.txt',
                  processingStatus: 'pending',
                },
              ]
            : [],
        })
      : response([kb])
  );
  await render(Knowledge);
  await click('Open');
  const oldAttach = captured.attach!;
  attached = false;
  await click('Refresh');
  await act(async () => oldAttach('late-upload'));
  expect(host.querySelector('[data-testid="confirmation"]')).toBeNull();
  await act(async () => captured.attach!('new-upload'));
  expect(captured.action).toMatchObject({
    path: `/api/admin/knowledge-bases/${kb.id}/documents`,
    body: { storageKey: 'new-upload' },
  });
});
it('knowledge group unlink uses valid membership through unrelated choice failure', async () => {
  let fail = false;
  mock((path) =>
    path.endsWith(kg.id)
      ? response({ ...kg, members: [kb] })
      : path.endsWith('/kb-groups')
        ? response([kg])
        : response([kb], fail ? 503 : 200)
  );
  await render(Knowledge);
  await click('Knowledge-base groups');
  await click('Open');
  fail = true;
  await click('Refresh');
  await click('Remove from group');
  expect(captured.action).toMatchObject({
    method: 'DELETE',
    path: `/api/admin/kb-groups/${kg.id}/members/${kb.id}`,
  });
  expect(captured.disabled).toBe(false);
});
it('knowledge creation survives failed catalogue refresh and sends the retained source/chunk body', async () => {
  let fail = false;
  mock(() => response([kb], fail ? 503 : 200));
  await render(Knowledge);
  await click('Add knowledge base');
  await fill('#kb-title', 'New knowledge');
  fail = true;
  await click('Refresh');
  await fill('#kb-description', 'Keep this description');
  fail = false;
  await click('Retry');
  await click('Save');
  expect(captured.action?.body).toMatchObject({
    title: 'New knowledge',
    description: 'Keep this description',
    sourceType: 'document',
    chunkingStrategy: { size: 800, overlap: 100 },
  });
});
it('independent knowledge detail retry preserves another draft without rereading the directory', async () => {
  let fail = true;
  const requests = mock((path) =>
    path.endsWith(kb.id) ? response(kd, fail ? 503 : 200) : response([kb])
  );
  await render(Knowledge);
  await click('Add knowledge base');
  await fill('#kb-title', 'Unrelated draft');
  await click('Open');
  expect(host.textContent).toContain('Could not load details');
  fail = false;
  await click('Retry details');
  expect(host.querySelector<HTMLInputElement>('#kb-title')!.value).toBe('Unrelated draft');
  expect(
    requests.mock.calls.filter(([u]) => String(u) === '/api/admin/knowledge-bases')
  ).toHaveLength(1);
});
it('knowledge group options retry retains member selection and query text', async () => {
  let fail = false;
  const requests = mock((path) =>
    path.endsWith(kg.id)
      ? response({ ...kg, members: [] })
      : path.endsWith('/kb-groups')
        ? response([kg])
        : response([kb], fail ? 503 : 200)
  );
  await render(Knowledge);
  await click('Knowledge-base groups');
  await click('Open');
  await fill('#kb-member', kb.id);
  await fill('#kb-test-query', 'Keep query');
  fail = true;
  await click('Refresh');
  expect(host.querySelector<HTMLSelectElement>('#kb-member')!.value).toBe(kb.id);
  const lists = requests.mock.calls.filter(([u]) => String(u).endsWith('/kb-groups')).length;
  fail = false;
  await click('Retry options');
  expect(requests.mock.calls.filter(([u]) => String(u).endsWith('/kb-groups'))).toHaveLength(lists);
  expect(host.querySelector<HTMLInputElement>('#kb-test-query')!.value).toBe('Keep query');
});
it('withdrawn knowledge choice invalidates a frozen link while retaining query draft', async () => {
  let withdrawn = false;
  mock((path) =>
    path.endsWith(kg.id)
      ? response({ ...kg, members: [] })
      : path.endsWith('/kb-groups')
        ? response([kg])
        : response(withdrawn ? [] : [kb])
  );
  await render(Knowledge);
  await click('Knowledge-base groups');
  await click('Open');
  await fill('#kb-member', kb.id);
  await fill('#kb-test-query', 'Keep query');
  await click('Add to group');
  withdrawn = true;
  await click('Refresh');
  expect(host.querySelector('[data-testid=confirmation]')).toBeNull();
  expect(host.querySelector<HTMLInputElement>('#kb-test-query')!.value).toBe('Keep query');
  expect(host.querySelector<HTMLSelectElement>('#kb-member')!.value).toBe(kb.id);
});
it('editing the query aborts an old result and changing kind cannot revive it', async () => {
  let finish!: (r: Response) => void;
  mock((path) =>
    path.endsWith('/query')
      ? new Promise<Response>((done) => {
          finish = done;
        })
      : path.endsWith(kb.id)
        ? response(kd)
        : path.endsWith('/kb-groups')
          ? response([kg])
          : response([kb])
  );
  await render(Knowledge);
  await click('Open');
  await fill('#kb-test-query', 'Old query');
  await query();
  await fill('#kb-test-query', 'New query');
  await click('Knowledge-base groups');
  await act(async () => finish(response(queryRows)));
  expect(host.textContent).not.toContain('Accepted guidance');
  expect(host.querySelector('#kb-test-query')).toBeNull();
});
it('denial of a test query clears private detail, editor and catalogue', async () => {
  mock((path) =>
    path.endsWith('/query')
      ? response({}, 403)
      : path.endsWith(kb.id)
        ? response(kd)
        : response([kb])
  );
  await render(Knowledge);
  await click('Edit');
  await click('Open');
  await fill('#kb-test-query', 'Meter charge');
  await query();
  expect(host.querySelector('#kb-title')).toBeNull();
  expect(host.querySelector('#kb-test-query')).toBeNull();
  expect(host.textContent).not.toContain(kb.title);
  expect(host.textContent).toContain('permission to manage');
});
it('permission denial invalidates older independent catalogue reads', async () => {
  let hold = false,
    finish!: (r: Response) => void;
  mock((path) =>
    path.endsWith('/kb-groups')
      ? hold
        ? new Promise<Response>((done) => {
            finish = done;
          })
        : response([kg])
      : path.endsWith(kg.id)
        ? response({ ...kg, members: [] })
        : response([kb], hold ? 403 : 200)
  );
  await render(Knowledge);
  await click('Knowledge-base groups');
  await click('Open');
  hold = true;
  await click('Refresh');
  await act(async () => finish(response([kg])));
  expect(host.textContent).not.toContain(kg.title);
  expect(host.querySelector('#kb-member')).toBeNull();
});
it('an old document upload callback cannot attach after changing selected scope', async () => {
  mock((path) =>
    path.endsWith(kb.id)
      ? response(kd)
      : path.endsWith('/kb-groups')
        ? response([kg])
        : response([kb])
  );
  await render(Knowledge);
  await click('Open');
  const oldAttach = captured.attach!;
  await click('Knowledge-base groups');
  await act(async () => oldAttach('test-storage-key'));
  expect(captured.action).toBeNull();
});
it('configuration changes preserve knowledge edits and require reset while document telemetry preserves the basis', async () => {
  let phase = 0;
  mock(() =>
    response([
      {
        ...kb,
        documentCount: phase ? 5 : 0,
        sourceConfig: {
          urls: phase === 2 ? ['https://changed.example.test'] : kb.sourceConfig.urls,
        },
      },
    ])
  );
  await render(Knowledge);
  await click('Edit');
  await fill('#kb-title', 'Unsaved title');
  phase = 1;
  await click('Refresh');
  expect(host.querySelector<HTMLInputElement>('#kb-title')!.value).toBe('Unsaved title');
  phase = 2;
  await click('Refresh');
  expect(host.querySelector<HTMLInputElement>('#kb-title')!.value).toBe('Unsaved title');
  expect(host.textContent).toContain('Saved settings changed');
  expect(
    [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === 'Save'
    )!.disabled
  ).toBe(true);
  await click('Reset to saved settings');
  expect(host.querySelector<HTMLInputElement>('#kb-title')!.value).toBe(kb.title);
});
it('policy catalogue retry preserves complete rule drafts and exact frozen save', async () => {
  let fail = false;
  mock(() => response([policy], fail ? 503 : 200));
  await render(Policies);
  await click('Edit');
  await fill('#policy-items', 'energy\nbilling');
  fail = true;
  await click('Refresh');
  await fill('#policy-description', 'Keep explanation');
  fail = false;
  await click('Retry');
  await click('Save');
  expect(captured.action?.body).toMatchObject({
    rules: { topics: ['energy', 'billing'] },
    description: 'Keep explanation',
    priority: 100,
  });
});
it('policy group detail retry preserves both selected member and dirty override values', async () => {
  let fail = false;
  const requests = mock((path) =>
    path.endsWith(pg.id)
      ? response({ ...pg, members: [{ ...policy, priorityOverride: null }] }, fail ? 503 : 200)
      : path.endsWith('/policy-groups')
        ? response([pg])
        : response([policy, policySecond])
  );
  await render(Policies);
  await click('Policy groups');
  await click('Open');
  await fill(`#member-priority-${policy.id}`, '250');
  await fill('#policy-member', policySecond.id);
  await fill('#policy-member-priority', '80');
  fail = true;
  await click('Refresh');
  expect(host.querySelector<HTMLInputElement>(`#member-priority-${policy.id}`)!.value).toBe('250');
  const lists = requests.mock.calls.filter(([u]) => String(u).endsWith('/policy-groups')).length;
  fail = false;
  await click('Retry details');
  expect(requests.mock.calls.filter(([u]) => String(u).endsWith('/policy-groups'))).toHaveLength(
    lists
  );
  expect(host.querySelector<HTMLInputElement>(`#member-priority-${policy.id}`)!.value).toBe('250');
  expect(host.querySelector<HTMLInputElement>('#policy-member-priority')!.value).toBe('80');
});
it('changed group membership retains overrides, requires explicit reset and clears old confirmation', async () => {
  let changed = false;
  mock((path) =>
    path.endsWith(pg.id)
      ? response({
          ...pg,
          members: [
            { ...policy, priorityOverride: changed ? 400 : null },
            { ...policySecond, priorityOverride: null },
          ],
        })
      : path.endsWith('/policy-groups')
        ? response([pg])
        : response([policy, policySecond])
  );
  await render(Policies);
  await click('Policy groups');
  await click('Open');
  await fill(`#member-priority-${policy.id}`, '250');
  await fill(`#member-priority-${policySecond.id}`, '350');
  await click('Save priority');
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(
      host
        .querySelector(`#member-priority-${policy.id}`)!
        .closest('form')!
        .getAttribute('aria-busy')
    ).toBe('false');
  });
  const old = captured.success!;
  changed = true;
  await click('Refresh');
  expect(host.querySelector<HTMLInputElement>(`#member-priority-${policy.id}`)!.value).toBe('250');
  expect(host.textContent).toContain('Saved settings changed');
  await click('Reset to saved settings');
  expect(host.querySelector<HTMLInputElement>(`#member-priority-${policy.id}`)!.value).toBe('400');
  expect(host.querySelector<HTMLInputElement>(`#member-priority-${policySecond.id}`)!.value).toBe(
    '350'
  );
  expect(host.querySelector('[data-testid=confirmation]')).toBeNull();
  await act(async () => old());
  expect(host.textContent).not.toContain('Changes saved.');
});
it('withdrawn policy options close a pending new link and retain its priority draft', async () => {
  let removed = false;
  mock((path) =>
    path.endsWith(pg.id)
      ? response({ ...pg, members: [] })
      : path.endsWith('/policy-groups')
        ? response([pg])
        : response(removed ? [] : [policy])
  );
  await render(Policies);
  await click('Policy groups');
  await click('Open');
  await fill('#policy-member', policy.id);
  await fill('#policy-member-priority', '80');
  await click('Add to group');
  removed = true;
  await click('Refresh');
  expect(host.querySelector('[data-testid=confirmation]')).toBeNull();
  expect(host.querySelector<HTMLInputElement>('#policy-member-priority')!.value).toBe('80');
});
it('existing priority updates work through unrelated choice failure', async () => {
  let fail = false;
  mock((path) =>
    path.endsWith(pg.id)
      ? response({ ...pg, members: [{ ...policy, priorityOverride: null }] })
      : path.endsWith('/policy-groups')
        ? response([pg])
        : response([policy], fail ? 503 : 200)
  );
  await render(Policies);
  await click('Policy groups');
  await click('Open');
  fail = true;
  await click('Refresh');
  await fill(`#member-priority-${policy.id}`, '250');
  await click('Save priority');
  expect(captured.disabled).toBe(false);
  expect(captured.action?.body).toEqual({ policyId: policy.id, priorityOverride: 250 });
});
it('policy choice denial clears a group and invalidates late successful detail response', async () => {
  let hold = false,
    finish!: (r: Response) => void;
  mock((path) =>
    path.endsWith(pg.id)
      ? hold
        ? new Promise<Response>((done) => {
            finish = done;
          })
        : response({ ...pg, members: [policy] })
      : path.endsWith('/policy-groups')
        ? response([pg])
        : response([policy], hold ? 403 : 200)
  );
  await render(Policies);
  await click('Policy groups');
  await click('Open');
  hold = true;
  await click('Refresh');
  await act(async () => finish(response({ ...pg, members: [policy] })));
  expect(host.querySelector('#policy-member')).toBeNull();
  expect(host.textContent).not.toContain(pg.title);
});
it('cancelled policy confirmation cannot close a newer draft', async () => {
  mock(() => response([policy]));
  await render(Policies);
  await click('Edit');
  await click('Save');
  const old = captured.success!;
  await act(async () => captured.close!());
  await fill('#policy-title', 'New work');
  await act(async () => old());
  expect(host.querySelector<HTMLInputElement>('#policy-title')!.value).toBe('New work');
});
it.each([
  [Knowledge, [kb]],
  [Policies, [policy]],
] as const)(
  'malformed catalogue retains accepted content and blocks commands %#',
  async (Page, rows) => {
    let bad = false;
    mock(() => response(bad ? [null] : rows));
    await render(Page);
    bad = true;
    await click('Refresh');
    expect(host.textContent).toContain(rows[0].title);
    expect(host.querySelector('[role=alert]')).not.toBeNull();
    expect(
      [...host.querySelectorAll<HTMLButtonElement>('ul button')].every((button) => button.disabled)
    ).toBe(true);
  }
);
