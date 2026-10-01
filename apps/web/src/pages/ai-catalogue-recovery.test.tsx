import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Models from './AdminAiModelsPage.js';
import Agents from './AdminAiAgentsPage.js';
import type { TeamAction } from '../components/TeamActionDialog.js';
import { aiModel, aiAgent, aiOptions, aiDetail } from '../test/ai-catalogue-fixtures.js';
const captured = vi.hoisted(() => ({
  action: null as TeamAction | null,
  success: null as ((value: unknown) => Promise<void>) | null,
  close: null as (() => void) | null,
  disabled: false,
}));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ notice: null, format: (v: string) => v }),
}));
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: ({
    action,
    onSuccess,
    onClose,
    confirmationDisabled,
  }: {
    action: TeamAction;
    onSuccess: (value: unknown) => Promise<void>;
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
let host: HTMLDivElement, root: Root;
beforeEach(() => {
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
const response = (json: unknown, status = 200) => new Response(JSON.stringify(json), { status });
async function render(Page: typeof Models | typeof Agents) {
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
async function check(title: string) {
  const label = [...host.querySelectorAll('label')].find((l) => l.textContent?.includes(title));
  expect(label).toBeDefined();
  await act(async () => label!.querySelector<HTMLInputElement>('input')!.click());
}
function modelsFetch(read: () => Response | Promise<Response> = () => response([aiModel])) {
  const requests = vi.fn(read);
  vi.stubGlobal('fetch', requests);
  return requests;
}
function agentsFetch(
  overrides: {
    list?: () => Response | Promise<Response>;
    options?: () => Response | Promise<Response>;
    detail?: () => Response | Promise<Response>;
  } = {}
) {
  const requests = vi.fn(async (url: RequestInfo | URL) => {
    const path = String(url);
    if (path.endsWith('/options')) return overrides.options?.() ?? response(aiOptions);
    if (path === '/api/admin/agents') return overrides.list?.() ?? response([aiAgent]);
    if (path === `/api/admin/agents/${aiAgent.id}`)
      return overrides.detail?.() ?? response(aiDetail);
    return response({});
  });
  vi.stubGlobal('fetch', requests);
  return requests;
}
it('model catalogue retry retains creation text and private token and freezes the exact save', async () => {
  let fail = false;
  modelsFetch(() => response([aiModel], fail ? 503 : 200));
  await render(Models);
  await click('Add model');
  await fill('#ai-model-title', 'Draft model');
  await fill('#ai-model-baseUrl', 'https://new.example.test/v1');
  await fill('#ai-model-modelName', 'new');
  await fill('#ai-model-token', 'test-token');
  fail = true;
  await click('Refresh');
  expect(host.querySelector<HTMLInputElement>('#ai-model-token')!.value).toBe('test-token');
  await fill('#ai-model-title', 'During recovery');
  fail = false;
  await click('Retry');
  await click('Save model');
  expect(captured.action?.body).toEqual({
    title: 'During recovery',
    providerType: 'openai_compatible',
    baseUrl: 'https://new.example.test/v1',
    modelName: 'new',
    config: { max_tokens: 256, temperature: 0 },
    apiToken: 'test-token',
  });
});
it('model health telemetry preserves config editing while configuration changes discard it', async () => {
  let phase = 0;
  modelsFetch(() =>
    response([
      {
        ...aiModel,
        lastTestLatencyMs: phase ? 50 : null,
        modelName: phase === 2 ? 'changed' : aiModel.modelName,
      },
    ])
  );
  await render(Models);
  await click('Edit');
  await fill('#ai-model-title', 'Edited title');
  phase = 1;
  await click('Refresh');
  expect(host.querySelector<HTMLInputElement>('#ai-model-title')!.value).toBe('Edited title');
  phase = 2;
  await click('Refresh');
  expect(host.querySelector('#ai-model-title')).toBeNull();
});
it('budget usage preserves unsaved limits and pricing while changed limits invalidate editing', async () => {
  let phase = 0;
  modelsFetch(() =>
    response([
      {
        ...aiModel,
        budget: {
          ...aiModel.budget,
          usedInputTokens: phase ? 999 : 100,
          monthlyTokenLimit: phase === 2 ? 20000 : 10000,
        },
      },
    ])
  );
  await render(Models);
  await click('Configure budget');
  await fill('#ai-model-monthlyTokenLimit', '15000');
  phase = 1;
  await click('Refresh');
  expect(host.querySelector<HTMLInputElement>('#ai-model-monthlyTokenLimit')!.value).toBe('15000');
  phase = 2;
  await click('Refresh');
  expect(host.querySelector('#ai-model-monthlyTokenLimit')).toBeNull();
});
it('model confirmation waits for recovery and changes invalidate late completion', async () => {
  let phase = 0;
  modelsFetch(() =>
    response(
      [{ ...aiModel, modelName: phase === 2 ? 'changed' : aiModel.modelName }],
      phase === 1 ? 503 : 200
    )
  );
  await render(Models);
  await click('Test connection');
  const old = captured.success!;
  phase = 1;
  await click('Refresh');
  expect(captured.disabled).toBe(true);
  phase = 0;
  await click('Retry');
  expect(captured.disabled).toBe(false);
  phase = 2;
  await click('Refresh');
  expect(host.querySelector('[data-testid=confirmation]')).toBeNull();
  await act(async () => old({ test: { ok: true, responsePreview: 'Obsolete success' } }));
  expect(host.textContent).not.toContain('Obsolete success');
});
it('model test completion preserves unrelated creation draft', async () => {
  modelsFetch();
  await render(Models);
  await click('Add model');
  await fill('#ai-model-title', 'Keep new model');
  await click('Test connection');
  await act(async () => captured.success!({ test: { ok: true, responsePreview: 'Healthy' } }));
  expect(host.querySelector<HTMLInputElement>('#ai-model-title')!.value).toBe('Keep new model');
  expect(host.textContent).toContain('Healthy');
});
it('model denial clears secrets, rows and pending command', async () => {
  let deny = false;
  modelsFetch(() => response([aiModel], deny ? 401 : 200));
  await render(Models);
  await click('Add model');
  await fill('#ai-model-token', 'test-token');
  await click('Test connection');
  const old = captured.success!;
  deny = true;
  await click('Refresh');
  await act(async () => old({}));
  expect(host.querySelector('table')).toBeNull();
  expect(host.querySelector('#ai-model-token')).toBeNull();
  expect(host.querySelector('[data-testid=confirmation]')).toBeNull();
  expect(host.textContent).toContain('permission to manage');
});
it('malformed model data retains accepted rows and disables decisions', async () => {
  let invalid = false;
  modelsFetch(() => response(invalid ? [{ ...aiModel, config: null }] : [aiModel]));
  await render(Models);
  invalid = true;
  await click('Refresh');
  expect(host.querySelectorAll('tbody tr')).toHaveLength(1);
  expect(host.textContent).toContain('Models could not be loaded');
  expect(
    [...host.querySelectorAll<HTMLButtonElement>('tbody button')].every((b) => b.disabled)
  ).toBe(true);
});
it('opening an agent reads only detail and retains the test-chat draft across list retry', async () => {
  let fail = false;
  const requests = agentsFetch({ list: () => response([aiAgent], fail ? 503 : 200) });
  await render(Agents);
  await fill('#test-chat-message', 'Keep test question');
  await click('Edit');
  await fill('#agent-system-prompt', 'Unsaved prompt');
  expect(requests.mock.calls.filter(([u]) => String(u) === '/api/admin/agents')).toHaveLength(1);
  expect(requests.mock.calls.filter(([u]) => String(u).endsWith('/options'))).toHaveLength(1);
  expect(host.querySelector<HTMLTextAreaElement>('#test-chat-message')!.value).toBe(
    'Keep test question'
  );
  fail = true;
  await click('Refresh');
  await fill('#agent-description', 'During retry');
  fail = false;
  const optionReads = requests.mock.calls.filter(([u]) => String(u).endsWith('/options')).length;
  await click('Retry');
  expect(requests.mock.calls.filter(([u]) => String(u).endsWith('/options'))).toHaveLength(
    optionReads
  );
  expect(host.querySelector<HTMLTextAreaElement>('#agent-system-prompt')!.value).toBe(
    'Unsaved prompt'
  );
  expect(host.querySelector<HTMLTextAreaElement>('#agent-description')!.value).toBe('During retry');
});
it('options recovery retains selected knowledge and makes withdrawn choices removable', async () => {
  let phase = 0;
  const requests = agentsFetch({
    options: () =>
      response({ ...aiOptions, kbs: phase === 2 ? [] : aiOptions.kbs }, phase === 1 ? 503 : 200),
  });
  await render(Agents);
  await click('Edit');
  await fill('#agent-system-prompt', 'Retained prompt');
  phase = 1;
  await click('Refresh');
  expect(host.textContent).toContain('Could not load agent options');
  const listReads = requests.mock.calls.filter(([u]) => String(u) === '/api/admin/agents').length;
  phase = 2;
  await click('Retry options');
  expect(requests.mock.calls.filter(([u]) => String(u) === '/api/admin/agents')).toHaveLength(
    listReads
  );
  expect(host.querySelector<HTMLTextAreaElement>('#agent-system-prompt')!.value).toBe(
    'Retained prompt'
  );
  expect(
    [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'Save agent'
    )!.disabled
  ).toBe(true);
  await check('Option no longer available');
  await click('Save agent');
  expect(captured.action?.body).toMatchObject({ systemPrompt: 'Retained prompt', kbIds: [] });
});
it('agent detail failure has a dedicated retry without rereading catalogue or options', async () => {
  let fail = true;
  const requests = agentsFetch({ detail: () => response(aiDetail, fail ? 503 : 200) });
  await render(Agents);
  await click('Edit');
  expect(host.textContent).toContain('Could not load agent settings');
  fail = false;
  await click('Retry settings');
  expect(host.querySelector('#agent-system-prompt')).not.toBeNull();
  expect(requests.mock.calls.filter(([u]) => String(u) === '/api/admin/agents')).toHaveLength(1);
  expect(requests.mock.calls.filter(([u]) => String(u).endsWith('/options'))).toHaveLength(1);
});
it('detail display-name changes preserve prompt work but changed server configuration clears it', async () => {
  let phase = 0;
  agentsFetch({
    detail: () =>
      response({
        ...aiDetail,
        modelTitle: phase ? 'Renamed model' : aiDetail.modelTitle,
        systemPrompt: phase === 2 ? 'New server prompt' : aiDetail.systemPrompt,
      }),
  });
  await render(Agents);
  await click('Edit');
  await fill('#agent-system-prompt', 'My prompt');
  phase = 1;
  await click('Refresh');
  expect(host.querySelector<HTMLTextAreaElement>('#agent-system-prompt')!.value).toBe('My prompt');
  phase = 2;
  await click('Refresh');
  expect(host.querySelector('#agent-system-prompt')).toBeNull();
});
it('options denial aborts older successful list and detail reads', async () => {
  let hold = false,
    listDone!: (r: Response) => void,
    detailDone!: (r: Response) => void;
  agentsFetch({
    list: () =>
      hold
        ? new Promise<Response>((done) => {
            listDone = done;
          })
        : response([aiAgent]),
    detail: () =>
      hold
        ? new Promise<Response>((done) => {
            detailDone = done;
          })
        : response(aiDetail),
    options: () => response(aiOptions, hold ? 403 : 200),
  });
  await render(Agents);
  await click('Edit');
  hold = true;
  await click('Refresh');
  await act(async () => {
    listDone(response([aiAgent]));
    detailDone(response(aiDetail));
  });
  expect(host.querySelector('#agent-system-prompt')).toBeNull();
  expect(host.querySelector('#test-chat-message')).toBeNull();
  expect(host.textContent).not.toContain(aiAgent.title);
});
it('obsolete agent save completion cannot close a newer draft after cancellation', async () => {
  agentsFetch();
  await render(Agents);
  await click('Edit');
  await click('Save agent');
  const old = captured.success!;
  await act(async () => captured.close!());
  await fill('#agent-title', 'Newer title');
  await act(async () => old({}));
  expect(host.querySelector<HTMLInputElement>('#agent-title')!.value).toBe('Newer title');
  expect(host.textContent).not.toContain('Agent saved');
});
it('agent deletion remains available through unrelated option failure and preserves new draft', async () => {
  let fail = false;
  agentsFetch({ options: () => response(aiOptions, fail ? 503 : 200) });
  await render(Agents);
  await click('Add agent');
  await fill('#agent-title', 'New agent');
  fail = true;
  await click('Refresh');
  await click('Delete');
  expect(captured.disabled).toBe(false);
  await act(async () => captured.success!({}));
  expect(host.querySelector<HTMLInputElement>('#agent-title')!.value).toBe('New agent');
});
it('an absent selected model remains visible and blocks agent saving without erasing prompt', async () => {
  let removed = false;
  agentsFetch({
    options: () => response({ ...aiOptions, models: removed ? [] : aiOptions.models }),
  });
  await render(Agents);
  await click('Edit');
  await fill('#agent-system-prompt', 'Keep text');
  removed = true;
  await click('Refresh');
  expect(host.querySelector<HTMLTextAreaElement>('#agent-system-prompt')!.value).toBe('Keep text');
  expect(host.querySelector<HTMLSelectElement>('#agent-model')!.value).toBe(aiModel.id);
  expect(
    [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'Save agent'
    )!.disabled
  ).toBe(true);
});
it('linked collection display-name reordering preserves agent prompt and selected IDs', async () => {
  let reordered = false;
  const first = { id: 'kb-one', title: 'A knowledge' },
    second = { id: 'kb-two', title: 'B knowledge' };
  agentsFetch({
    options: () => response({ ...aiOptions, kbs: [first, second] }),
    detail: () =>
      response({
        ...aiDetail,
        kbs: reordered ? [second, { ...first, title: 'Z knowledge' }] : [first, second],
      }),
  });
  await render(Agents);
  await click('Edit');
  await fill('#agent-system-prompt', 'Keep selected context');
  reordered = true;
  await click('Refresh');
  expect(host.querySelector<HTMLTextAreaElement>('#agent-system-prompt')!.value).toBe(
    'Keep selected context'
  );
  await click('Save agent');
  expect(captured.action?.body).toMatchObject({
    systemPrompt: 'Keep selected context',
    kbIds: ['kb-one', 'kb-two'],
  });
});
