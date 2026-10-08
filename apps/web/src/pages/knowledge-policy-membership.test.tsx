import { QueryProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Knowledge from './AdminKnowledgeBasesPage.js';
import Policies from './AdminAiPoliciesPage.js';
import { t } from '@barghsa/i18n/admin-ui';
import type { TeamAction } from '../components/TeamActionDialog.js';
import {
  knowledgeBase as kb,
  knowledgeGroup as kg,
  knowledgeDetail as kd,
  policyEntry as policy,
  policySecond,
  policyGroup as pg,
} from '../test/knowledge-policy-fixtures.js';
type Schemas = typeof import('../lib/catalogue-form-schemas.js');
const state = vi.hoisted(() => ({
  action: null as TeamAction | null,
  success: null as ((value?: unknown) => Promise<void>) | null,
  fields: null as ((value: unknown[]) => boolean) | null,
  unconfirmed: null as (() => void) | null,
  close: null as (() => void) | null,
  gate: null as Promise<void> | null,
  unavailable: false,
}));
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: (props: {
    action: TeamAction;
    onSuccess: (value: unknown) => Promise<void>;
    onValidationError: (fields: unknown[]) => boolean;
    onUnconfirmed: () => void;
    onClose: () => void;
  }) => {
    state.action = props.action;
    state.success = props.onSuccess;
    state.fields = props.onValidationError;
    state.unconfirmed = props.onUnconfirmed;
    state.close = props.onClose;
    return <div data-testid="confirmation" />;
  },
}));
vi.mock('../lib/catalogue-form-schemas.js', async (original) => {
  const actual = await original<Schemas>();
  return {
    ...actual,
    contentFormSchema: async (...args: Parameters<Schemas['contentFormSchema']>) => {
      if (state.gate) await state.gate;
      if (state.unavailable) throw new Error('Unavailable');
      return actual.contentFormSchema(...args);
    },
  };
});
let host: HTMLDivElement, root: Root;
beforeEach(async () => {
  await import('../lib/catalogue-form-schemas.js');
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.lang = 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  state.action = null;
  state.success = null;
  state.fields = null;
  state.unconfirmed = null;
  state.close = null;
  state.gate = null;
  state.unavailable = false;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const cases = [
  {
    Page: Knowledge,
    kind: 'kb-groups' as const,
    group: kg,
    choice: kb,
    field: 'kb-member',
    apiField: 'kbId',
    title: 'Knowledge',
  },
  {
    Page: Policies,
    kind: 'policy-groups' as const,
    group: pg,
    choice: policySecond,
    field: 'policy-member',
    apiField: 'policyId',
    title: 'Policies',
  },
] as const;
async function mount(entry: (typeof cases)[number], options: { twoMembers?: boolean } = {}) {
  const data = {
    failed: false,
    wrong: false,
    members:
      entry.kind === 'kb-groups'
        ? ([] as Record<string, unknown>[])
        : [
            { ...policy, priorityOverride: null },
            ...(options.twoMembers ? [{ ...policySecond, priorityOverride: null }] : []),
          ],
  };
  const request = vi.fn(async (url: RequestInfo | URL) => {
    const path = String(url);
    if (path.endsWith(entry.group.id))
      return Response.json(
        { ...entry.group, id: data.wrong ? 'other' : entry.group.id, members: data.members },
        { status: data.failed ? 503 : 200 }
      );
    return Response.json(
      path.endsWith(entry.kind)
        ? [entry.group]
        : entry.kind === 'kb-groups'
          ? [kb]
          : [policy, policySecond]
    );
  });
  vi.stubGlobal('fetch', request);
  const Page = entry.Page;
  await act(async () =>
    root.render(<QueryProvider>{<Page initialKind={entry.kind as never} />}</QueryProvider>)
  );
  await click('Open');
  return { data, request };
}
function button(text: string) {
  const node = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text
  );
  expect(node, text).toBeDefined();
  return node!;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
async function fill(id: string, value: string) {
  const node = host.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype,
      'value'
    )!.set!.call(node, value);
    node.dispatchEvent(
      new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })
    );
  });
}
async function submit(id: string) {
  const form = host.querySelector(`#${id}`)!.closest('form')!;
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  if (!state.gate && id !== 'kb-test-query')
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(form.getAttribute('aria-busy')).toBe('false');
    });
}
it.each(cases)('focuses blank $kind membership without proposing a write', async (entry) => {
  await mount(entry);
  expect(
    host
      .querySelector<HTMLButtonElement>(`#${entry.field}`)!
      .closest('form')!
      .querySelector<HTMLButtonElement>('button[type=submit]')!.disabled
  ).toBe(false);
  await submit(entry.field);
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(document.activeElement?.id).toBe(entry.field);
  });
  expect(host.querySelector(`#${entry.field}`)!.getAttribute('aria-invalid')).toBe('true');
  expect(state.action).toBeNull();
});
it.each(cases)(
  'maps only owned $kind fields and verifies a fresh detail before clearing the link',
  async (entry) => {
    const { data } = await mount(entry);
    await fill(entry.field, entry.choice.id);
    if (entry.kind === 'policy-groups') await fill('policy-member-priority', '-۱۲');
    await submit(entry.field);
    expect(state.action!.successStatus).toBe(204);
    await act(async () => {
      expect(state.fields!([entry.apiField])).toBe(true);
      expect(state.fields!(['private-field'])).toBe(false);
      state.close!();
    });
    expect(host.querySelector<HTMLInputElement>(`#${entry.field}`)!.value).toBe(entry.choice.id);
    await submit(entry.field);
    data.members.push({
      ...entry.choice,
      ...(entry.kind === 'policy-groups' ? { priorityOverride: -12 } : {}),
    });
    await act(async () => state.success!());
    expect(host.querySelector<HTMLInputElement>(`#${entry.field}`)!.value).toBe('');
    expect(host.textContent).toContain('Changes saved.');
  }
);
it.each(cases)(
  'retains an unverified $kind link until fresh detail recovery and explicit reset',
  async (entry) => {
    const { data } = await mount(entry);
    await fill(entry.field, entry.choice.id);
    await submit(entry.field);
    data.wrong = true;
    await expect(state.success!()).rejects.toThrow('Unconfirmed');
    data.failed = true;
    await act(async () => state.unconfirmed!());
    expect(host.querySelector<HTMLInputElement>(`#${entry.field}`)!.value).toBe(entry.choice.id);
    expect(button('Reset to saved settings').disabled).toBe(true);
    data.failed = false;
    data.wrong = false;
    await click('Retry details');
    expect(button('Reset to saved settings').disabled).toBe(false);
    await click('Reset to saved settings');
    expect(host.querySelector<HTMLInputElement>(`#${entry.field}`)!.value).toBe('');
  }
);
it('validates priority rows independently and verifies nullable overrides', async () => {
  const { data } = await mount(cases[1], { twoMembers: true });
  await fill(`member-priority-${policy.id}`, 'bad');
  await submit(`member-priority-${policy.id}`);
  expect(state.action).toBeNull();
  await fill(`member-priority-${policySecond.id}`, '-۱۲');
  await submit(`member-priority-${policySecond.id}`);
  expect(state.action!.body).toEqual({ policyId: policySecond.id, priorityOverride: -12 });
  data.members[1] = { ...policySecond, priorityOverride: -12 };
  await act(async () => state.success!());
  expect(host.querySelector<HTMLInputElement>(`#member-priority-${policy.id}`)!.value).toBe('bad');
  await fill(`member-priority-${policySecond.id}`, '');
  await submit(`member-priority-${policySecond.id}`);
  expect(state.action!.body).toEqual({ policyId: policySecond.id, priorityOverride: null });
  data.members[1] = { ...policySecond, priorityOverride: null };
  await act(async () => state.success!());
});
it.each(cases)('verifies $kind removal by absence in a fresh group detail', async (entry) => {
  const { data } = await mount(entry);
  data.members = [{ ...entry.choice, priorityOverride: null }];
  await click('Refresh');
  await click(t(`admin.${entry.kind === 'kb-groups' ? 'kb' : 'policies'}.unlink`, 'en'));
  expect(state.action!.method).toBe('DELETE');
  expect(state.action!.successStatus).toBe(204);
  await expect(state.success!()).rejects.toThrow('Unconfirmed');
  data.members = [];
  await act(async () => state.success!());
  expect(host.textContent).toContain('Changes saved.');
});
it('does not propose a duplicate or obsolete link after delayed validation', async () => {
  await mount(cases[0]);
  await fill('kb-member', kb.id);
  let resolve!: () => void;
  state.gate = new Promise<void>((done) => {
    resolve = done;
  });
  await submit('kb-member');
  await submit('kb-member');
  expect(state.action).toBeNull();
  await click('Knowledge bases');
  await act(async () => resolve());
  expect(state.action).toBeNull();
});
it('preserves selection when validation is unavailable and supports a retry', async () => {
  await mount(cases[0]);
  await fill('kb-member', kb.id);
  state.unavailable = true;
  await submit('kb-member');
  expect(host.textContent).toContain('Validation is unavailable');
  expect(state.action).toBeNull();
  expect(host.querySelector<HTMLSelectElement>('#kb-member')!.value).toBe(kb.id);
  state.unavailable = false;
  await submit('kb-member');
  expect(state.action).not.toBeNull();
});
for (const kind of ['knowledge-bases', 'kb-groups'] as const)
  it(`owns ${kind} query errors and blocks duplicate requests`, async () => {
    let release!: (value: Response) => void,
      requests = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        const path = String(url);
        if (path.endsWith('/query')) {
          requests++;
          return new Promise<Response>((done) => {
            release = done;
          });
        }
        if (path.endsWith(kb.id)) return Response.json(kd);
        if (path.endsWith(kg.id)) return Response.json({ ...kg, members: [] });
        return Response.json(path.endsWith(kind) ? [kind === 'knowledge-bases' ? kb : kg] : [kb]);
      })
    );
    await act(async () =>
      root.render(<QueryProvider>{<Knowledge initialKind={kind} />}</QueryProvider>)
    );
    await click('Open');
    await submit('kb-test-query');
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(document.activeElement?.id).toBe('kb-test-query');
    });
    expect(requests).toBe(0);
    await fill('kb-test-query', 'Retained query');
    await submit('kb-test-query');
    await submit('kb-test-query');
    expect(requests).toBe(1);
    await act(async () =>
      release(
        Response.json(
          {
            error: {
              code: 'VALIDATION:INPUT:INVALID',
              fields: ['query'],
              message: 'private-query',
            },
          },
          { status: 400 }
        )
      )
    );
    expect(host.querySelector<HTMLInputElement>('#kb-test-query')!.value).toBe('Retained query');
    expect(host.querySelector('#kb-test-query')!.getAttribute('aria-invalid')).toBe('true');
    expect(host.textContent).not.toContain('private-query');
  });
