import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Knowledge from './AdminKnowledgeBasesPage.js';
import Policies from './AdminAiPoliciesPage.js';
import type { TeamAction } from '../components/TeamActionDialog.js';
type CatalogueSchemas = typeof import('../lib/catalogue-form-schemas.js');
import {
  knowledgeBase,
  knowledgeGroup,
  policyEntry,
  policyGroup,
} from '../test/knowledge-policy-fixtures.js';
const state = vi.hoisted(() => ({
  action: null as TeamAction | null,
  success: null as ((v: unknown) => Promise<void>) | null,
  unconfirmed: null as (() => void) | null,
  fields: null as ((v: unknown[]) => boolean) | null,
  close: null as (() => void) | null,
  gate: null as Promise<void> | null,
  unavailable: false,
}));
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: (props: {
    action: TeamAction;
    onSuccess: (v: unknown) => Promise<void>;
    onUnconfirmed: () => void;
    onValidationError: (v: unknown[]) => boolean;
    onClose: () => void;
  }) => {
    state.action = props.action;
    state.success = props.onSuccess;
    state.unconfirmed = props.onUnconfirmed;
    state.fields = props.onValidationError;
    state.close = props.onClose;
    return <div data-testid="confirmation" />;
  },
}));
vi.mock('../lib/catalogue-form-schemas.js', async (original) => {
  const actual = await original<CatalogueSchemas>();
  return {
    ...actual,
    contentFormSchema: async (...args: Parameters<typeof actual.contentFormSchema>) => {
      if (state.gate) await state.gate;
      if (state.unavailable) throw new Error('Missing module');
      return actual.contentFormSchema(...args);
    },
  };
});
const cases = [
  {
    Page: Knowledge,
    kind: 'knowledge-bases' as const,
    row: knowledgeBase,
    field: 'kb',
    create: 'Add knowledge base',
  },
  {
    Page: Knowledge,
    kind: 'kb-groups' as const,
    row: knowledgeGroup,
    field: 'kb',
    create: 'Add group',
  },
  {
    Page: Policies,
    kind: 'policies' as const,
    row: policyEntry,
    field: 'policy',
    create: 'Add policy',
  },
  {
    Page: Policies,
    kind: 'policy-groups' as const,
    row: policyGroup,
    field: 'policy',
    create: 'Add group',
  },
];
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.lang = 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  state.action = null;
  state.success = null;
  state.gate = null;
  state.unavailable = false;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function mount(entry: (typeof cases)[number], read = () => Response.json([entry.row])) {
  vi.stubGlobal('fetch', vi.fn(read));
  const Page = entry.Page;
  await act(async () => root.render(<Page initialKind={entry.kind as never} />));
}
function button(text: string) {
  const node = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (n) => n.textContent?.trim() === text
  );
  expect(node, text).toBeDefined();
  return node!;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
async function fill(id: string, value: string) {
  const node = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)!;
  await act(async () => {
    const proto =
      node instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit(entry: (typeof cases)[number]) {
  await act(async () =>
    host
      .querySelector(`#${entry.field}-title`)!
      .closest('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}
it.each(cases)('owns blank title validation and first-error focus for $kind', async (entry) => {
  await mount(entry);
  await click(entry.create);
  expect(button('Save').disabled).toBe(false);
  await submit(entry);
  expect(state.action).toBeNull();
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(host.querySelector(`#${entry.field}-title`)!.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement?.id).toBe(`${entry.field}-title`);
  });
});
it.each(cases)('preserves changed saved $kind entries until explicit reset', async (entry) => {
  let changed = false;
  await mount(entry, () =>
    Response.json([{ ...entry.row, title: changed ? 'Changed saved title' : entry.row.title }])
  );
  await click('Edit');
  await fill(`${entry.field}-title`, 'My unsaved title');
  changed = true;
  await click('Refresh');
  expect(host.querySelector<HTMLInputElement>(`#${entry.field}-title`)!.value).toBe(
    'My unsaved title'
  );
  expect(button('Save').disabled).toBe(true);
  expect(host.textContent).toContain('Saved settings changed');
  await click('Reset to saved settings');
  expect(host.querySelector<HTMLInputElement>(`#${entry.field}-title`)!.value).toBe(
    'Changed saved title'
  );
  expect(button('Save').disabled).toBe(false);
});
it.each(cases)(
  'requires a fresh catalogue read/reset after an unverified $kind receipt',
  async (entry) => {
    let failed = false;
    await mount(entry, () => Response.json([entry.row], { status: failed ? 503 : 200 }));
    await click('Edit');
    await fill(`${entry.field}-title`, 'Retained title');
    await submit(entry);
    expect(state.action).not.toBeNull();
    await expect(state.success!({ id: entry.row.id, title: 'Wrong receipt' })).rejects.toThrow(
      'Unconfirmed'
    );
    failed = true;
    await act(async () => state.unconfirmed!());
    expect(host.querySelector<HTMLInputElement>(`#${entry.field}-title`)!.value).toBe(
      'Retained title'
    );
    expect(button('Save').disabled).toBe(true);
    expect(button('Reset to saved settings').disabled).toBe(true);
    expect(button('Cancel').disabled).toBe(true);
    await click('Cancel');
    expect(host.querySelector(`#${entry.field}-title`)).not.toBeNull();
    failed = false;
    await click('Retry');
    expect(button('Reset to saved settings').disabled).toBe(false);
    await click('Reset to saved settings');
    expect(button('Save').disabled).toBe(false);
  }
);
it.each(cases)(
  'accepts only the frozen $kind save and returns errors to its owning form',
  async (entry) => {
    await mount(entry);
    await click('Edit');
    await fill(`${entry.field}-title`, 'Captured title');
    await submit(entry);
    const command = state.action!;
    expect(command.successStatus).toBe(200);
    expect(host.querySelector(`#${entry.field}-title`)!.matches(':disabled')).toBe(true);
    await act(async () => {
      expect(state.fields!(['title'])).toBe(true);
      state.close!();
    });
    expect(host.querySelector(`#${entry.field}-title`)!.getAttribute('aria-invalid')).toBe('true');
    await fill(`${entry.field}-title`, 'Corrected title');
    await submit(entry);
    const captured = state.action!;
    await act(async () => state.success!({ ...entry.row, ...(captured.body as object) }));
    expect(host.querySelector(`#${entry.field}-title`)).toBeNull();
    expect(host.textContent).toContain('Changes saved');
  }
);
it('blocks duplicate delayed validation and discards it after changing catalogue kind', async () => {
  let resolve!: () => void;
  state.gate = new Promise<void>((done) => {
    resolve = done;
  });
  await mount(cases[0]!);
  await click('Add knowledge base');
  await fill('kb-title', 'Delayed work');
  await submit(cases[0]!);
  await submit(cases[0]!);
  expect(host.querySelector('#kb-title')!.matches(':disabled')).toBe(true);
  expect(state.action).toBeNull();
  await click('Knowledge-base groups');
  await act(async () => resolve());
  expect(host.querySelector('#kb-title')).toBeNull();
  expect(state.action).toBeNull();
});
it('retains entries when deferred validation is unavailable and allows a later retry', async () => {
  state.unavailable = true;
  await mount(cases[0]!);
  await click('Add knowledge base');
  await fill('kb-title', 'Retained work');
  await submit(cases[0]!);
  expect(state.action).toBeNull();
  expect(host.textContent).toContain('Validation is unavailable');
  expect(host.querySelector<HTMLInputElement>('#kb-title')!.value).toBe('Retained work');
  state.unavailable = false;
  await submit(cases[0]!);
  expect(state.action?.body).toMatchObject({ title: 'Retained work' });
});
