import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { TeamAction } from '../components/TeamActionDialog.js';
import AdminAiModelsPage from './AdminAiModelsPage.js';

const harness = vi.hoisted(() => ({ action: null as TeamAction | null }));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ notice: null, format: (value: string) => value }),
}));
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: ({ action }: { action: TeamAction }) => {
    harness.action = action;
    return <div role="dialog">{action.title}</div>;
  },
}));

const model = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Service model',
  providerType: 'openai_compatible',
  baseUrl: 'https://model.example.test/v1',
  modelName: 'service-model',
  apiTokenMasked: '********1234',
  config: { max_tokens: 512, temperature: 0.4 },
  isEnabled: false,
  status: 'reachable',
  lastTestedAt: '2026-09-24T00:00:00Z',
  lastTestError: null,
  lastTestLatencyMs: 125,
};
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  harness.action = null;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify([model])))
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('shows test evidence and prepares an enabled-state write', async () => {
  await act(async () => root.render(<AdminAiModelsPage />));
  expect(container.textContent).toContain('125 ms');
  expect(container.textContent).toContain('Disabled');
  const enable = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Enable'
  );
  expect(enable?.disabled).toBe(false);
  await act(async () => enable!.click());
  expect(harness.action).toMatchObject({
    method: 'PUT',
    path: `/api/admin/ai-models/${model.id}`,
    body: { isEnabled: true },
  });
});

it('keeps untested models inactive and includes request settings when editing', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify([{ ...model, status: 'unknown', lastTestLatencyMs: null }]))
    )
  );
  await act(async () => root.render(<AdminAiModelsPage />));
  const enable = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Enable'
  );
  expect(enable?.disabled).toBe(true);
  const edit = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Edit'
  );
  await act(async () => edit!.click());
  expect(container.querySelector<HTMLInputElement>('#ai-model-max-tokens')?.value).toBe('512');
  expect(container.querySelector<HTMLInputElement>('#ai-model-temperature')?.value).toBe('0.4');
  const save = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Save model'
  );
  await act(async () => save!.click());
  expect(harness.action).toMatchObject({
    method: 'PUT',
    body: { config: { max_tokens: 512, temperature: 0.4 } },
  });
});

it('names dependent agents in a blocked deletion', async () => {
  await act(async () => root.render(<AdminAiModelsPage />));
  const remove = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Delete'
  );
  await act(async () => remove!.click());
  const message = harness.action?.errorMessages?.AI_MODEL_IN_USE;
  expect(typeof message).toBe('function');
  expect(
    (message as (response: unknown) => string)({
      error: { agents: [{ title: 'Support agent' }] },
    })
  ).toContain('Support agent');
});
