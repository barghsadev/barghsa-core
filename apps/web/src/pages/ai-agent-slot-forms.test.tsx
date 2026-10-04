import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Agents from './AdminAiAgentsPage.js';
import Slots from './AdminAgentSlotsPage.js';
import { aiDetail, aiOptions, aiAgent } from '../test/ai-catalogue-fixtures.js';
import {
  assignmentAgent,
  otherAssignmentAgent,
  assignmentSlots,
} from '../test/assignment-settings-fixtures.js';
import type { TeamAction } from '../components/TeamActionDialog.js';
type SchemaModule = typeof import('../lib/catalogue-form-schemas.js');
const harness = vi.hoisted(() => ({
  action: null as TeamAction | null,
  success: null as ((value: unknown) => Promise<void>) | null,
  close: null as (() => void) | null,
  deny: null as (() => void) | null,
  unconfirmed: null as (() => void) | null,
  fields: null as ((fields: unknown[]) => boolean) | null,
  fail: false,
  hold: false,
  release: null as (() => void) | null,
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../lib/catalogue-form-schemas.js', async (original) => {
  const actual = await original<SchemaModule>();
  return {
    ...actual,
    contentFormSchema: async (...args: Parameters<typeof actual.contentFormSchema>) => {
      if (harness.fail) throw new Error('Private validation detail');
      if (harness.hold)
        await new Promise<void>((resolve) => {
          harness.release = resolve;
        });
      return actual.contentFormSchema(...args);
    },
  };
});
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: (props: {
    action: TeamAction;
    onSuccess: (value: unknown) => Promise<void>;
    onClose: () => void;
    onDenied?: () => void;
    onUnconfirmed?: () => void;
    onValidationError?: (fields: unknown[]) => boolean;
  }) => {
    harness.action = props.action;
    harness.success = props.onSuccess;
    harness.close = props.onClose;
    harness.deny = props.onDenied ?? null;
    harness.unconfirmed = props.onUnconfirmed ?? null;
    harness.fields = props.onValidationError ?? null;
    return <div role="dialog">{props.action.title}</div>;
  },
}));
let deleted = false;
let host: HTMLDivElement,
  root: Root,
  readStatus: number,
  detail: typeof aiDetail,
  requests: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.assign(harness, {
    action: null,
    success: null,
    close: null,
    deny: null,
    unconfirmed: null,
    fields: null,
    fail: false,
    hold: false,
    release: null,
  });
  readStatus = 200;
  deleted = false;
  detail = structuredClone(aiDetail);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  requests = vi.fn(async (url: RequestInfo | URL) => {
    const path = String(url);
    if (deleted && path === `/api/admin/agents/${aiAgent.id}`)
      return Response.json({}, { status: 404 });
    const data = path.endsWith('/options')
      ? aiOptions
      : path.endsWith('/agent-slots')
        ? assignmentSlots()
        : path.endsWith('/agents')
          ? [
              { ...aiAgent, updatedAt: assignmentAgent.updatedAt },
              { ...aiAgent, ...assignmentAgent },
              { ...aiAgent, ...otherAssignmentAgent },
            ]
          : detail;
    return Response.json(deleted && path.endsWith('/agents') ? [] : data, { status: readStatus });
  });
  vi.stubGlobal('fetch', requests);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function click(text: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text
  );
  expect(button, text).toBeDefined();
  await act(async () => button!.click());
}
const node = (selector: string) =>
  host.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
async function fill(selector: string, value: string) {
  await act(async () => {
    const el = node(selector),
      proto =
        el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(
      new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })
    );
  });
}
async function submit(selector: string) {
  await act(async () =>
    node(selector)
      .closest('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}
async function proposal() {
  await vi.waitFor(() => expect(harness.action).not.toBeNull());
  return harness.action!;
}
async function openAgent() {
  await act(async () => root.render(<Agents />));
  await click('Edit');
}
for (const domain of ['agent', 'slot'] as const) {
  const selector = domain === 'agent' ? '#agent-max-tokens' : '#slot-individual_chatbot';
  const changedValue = domain === 'agent' ? '512' : assignmentAgent.id;
  async function open() {
    if (domain === 'agent') await openAgent();
    else await act(async () => root.render(<Slots />));
    await fill(selector, changedValue);
  }
  it(`${domain} retries failed validation while preserving its input`, async () => {
    await open();
    harness.fail = true;
    await submit(selector);
    await vi.waitFor(() => expect(host.textContent).toContain('Validation could not load'));
    expect(node(selector).value).toBe(changedValue);
    expect(harness.action).toBeNull();
    expect(host.textContent).not.toContain('Private validation detail');
    harness.fail = false;
    await submit(selector);
    await proposal();
  });
  it(`${domain} cancels delayed validation on refresh and prevents duplicate proposals`, async () => {
    await open();
    harness.hold = true;
    await submit(selector);
    await vi.waitFor(() => expect(harness.release).toBeTypeOf('function'));
    expect(node(selector).matches(':disabled')).toBe(true);
    await submit(selector);
    await click('Refresh');
    harness.hold = false;
    await act(async () => harness.release!());
    expect(harness.action).toBeNull();
    await submit(selector);
    await proposal();
  });
  it(`${domain} accepts only owned feedback and focuses its field after closing confirmation`, async () => {
    await open();
    await submit(selector);
    await proposal();
    await act(async () => {
      expect(harness.fields!(['__proto__', 'private-server-value'])).toBe(false);
      expect(harness.fields!([domain === 'agent' ? 'maxTokens' : 'agentId'])).toBe(true);
      harness.close!();
    });
    await vi.waitFor(() => expect(document.activeElement).toBe(node(selector)));
    expect(node(selector).getAttribute('aria-invalid')).toBe('true');
  });
  it(`${domain} waits for fresh reads and explicit reset after an invalid receipt`, async () => {
    await open();
    await submit(selector);
    await proposal();
    readStatus = 503;
    await act(async () => {
      await expect(harness.success!({})).rejects.toThrow();
      harness.unconfirmed!();
    });
    expect(node(selector).value).toBe(changedValue);
    await submit(selector);
    expect(host.querySelector('[role=dialog]')).toBeNull();
    await click('Reset to saved settings');
    expect(node(selector).value).toBe(changedValue);
    readStatus = 200;
    await click('Refresh');
    if (domain === 'slot') await click('Retry agents');
    await click('Reset to saved settings');
    expect(node(selector).value).toBe('');
  });
  it(`${domain} clears the private draft on denial and ignores late acknowledgements`, async () => {
    await open();
    await submit(selector);
    await proposal();
    const late = harness.success!;
    await act(async () => {
      harness.deny!();
      await late(domain === 'agent' ? aiDetail : assignmentSlots()[0]);
    });
    expect(host.querySelector(selector)).toBeNull();
    expect(host.textContent).not.toContain('saved.');
  });
}
it('agent save verifies all four link sets before showing saved', async () => {
  await openAgent();
  await submit('#agent-title');
  await proposal();
  detail = { ...detail, kbs: [] };
  await act(async () => {
    await expect(harness.success!(aiDetail)).rejects.toThrow('Unconfirmed agent links');
  });
  expect(node('#agent-title').value).toBe(aiAgent.title);
  expect(host.textContent).not.toContain('Agent saved.');
  detail = structuredClone(aiDetail);
  await act(async () => {
    await harness.success!(aiDetail);
    harness.close!();
  });
  expect(node('#agent-title')).toBeNull();
  expect(
    requests.mock.calls.filter(([path]) => String(path) === `/api/admin/agents/${aiAgent.id}`)
  ).toHaveLength(3);
});
it('agent owned link feedback focuses the group without replacing selected arrays', async () => {
  await openAgent();
  await submit('#agent-title');
  await proposal();
  await act(async () => {
    expect(harness.fields!(['kbIds'])).toBe(true);
    harness.close!();
  });
  await vi.waitFor(() => expect(document.activeElement?.tagName).toBe('FIELDSET'));
  expect(document.activeElement?.getAttribute('aria-invalid')).toBe('true');
  expect(
    host.querySelector<HTMLInputElement>('label input[type=checkbox]:not(#agent-enabled)')!.checked
  ).toBe(true);
  await submit('#agent-title');
  await vi.waitFor(() => expect(host.querySelector('[role=dialog]')).not.toBeNull());
  expect(harness.action!.body).toMatchObject({ kbIds: [aiOptions.kbs[0]!.id] });
});

it('an uncertain agent deletion can reset after a fresh list confirms absence despite detail 404', async () => {
  await openAgent();
  await click('Delete');
  await proposal();
  deleted = true;
  await act(async () => harness.unconfirmed!());
  await vi.waitFor(() => expect(host.textContent).toContain('The save could not be verified.'));
  await click('Reset to saved settings');
  expect(node('#agent-title')).toBeNull();
  expect(host.textContent).not.toContain('The save could not be verified.');
});
