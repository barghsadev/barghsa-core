import { QueryProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Agents from './AdminAiAgentsPage.js';
import Slots from './AdminAgentSlotsPage.js';
import { aiAgent, aiDetail, aiOptions } from '../test/ai-catalogue-fixtures.js';
import { assignmentAgent, assignmentSlots } from '../test/assignment-settings-fixtures.js';
import { timezoneText } from '@barghsa/i18n/timezone';
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
async function click(text: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (node) => node.textContent?.trim() === text
  );
  expect(button, text).toBeDefined();
  await act(async () => button!.click());
}
it('shows linked counts without treating missing metadata as zero or discarding the editor', async () => {
  let metadata = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL) =>
      Response.json(
        String(url).endsWith('/options')
          ? aiOptions
          : String(url).endsWith(aiAgent.id)
            ? aiDetail
            : [
                {
                  ...aiAgent,
                  kbCount: metadata ? 1 : undefined,
                  policyCount: metadata ? 0 : undefined,
                },
              ]
      )
    )
  );
  await act(async () => root.render(<QueryProvider>{<Agents />}</QueryProvider>));
  const counts = () => [...host.querySelectorAll('li dl dd')].map((node) => node.textContent);
  expect(counts()).toEqual(['1', '0']);
  await click('Edit');
  metadata = false;
  await click('Refresh');
  expect(counts()).toEqual(['—', '—']);
  expect(host.querySelector<HTMLTextAreaElement>('#agent-system-prompt')!.value).toBe(
    aiDetail.systemPrompt
  );
});
it('shows audited slot timestamps and retries timezone independently without losing choices', async () => {
  let unavailable = true,
    timezone = 'UTC';
  const fetches = vi.fn(async (url: RequestInfo | URL) => {
    const path = String(url);
    if (path.endsWith('/timezone'))
      return Response.json({ timezone }, { status: unavailable ? 503 : 200 });
    return Response.json(path.endsWith('/agents') ? [assignmentAgent] : assignmentSlots());
  });
  vi.stubGlobal('fetch', fetches);
  await act(async () => root.render(<QueryProvider>{<Slots />}</QueryProvider>));
  const stamps = () => [...host.querySelectorAll('tbody time')];
  expect(stamps()).toHaveLength(5);
  expect(stamps()[0]!.getAttribute('datetime')).toBe(assignmentSlots()[0]!.updatedAt);
  expect(stamps()[0]!.textContent).toBe(timezoneText('display.pending', 'en'));
  const choice = host.querySelector<HTMLSelectElement>('#slot-individual_chatbot')!;
  await act(async () => {
    choice.value = assignmentAgent.id;
    choice.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const dataReads = fetches.mock.calls.filter(([u]) => !String(u).endsWith('/timezone')).length;
  unavailable = false;
  await click(timezoneText('retry', 'en'));
  const old = stamps()[0]!.textContent;
  expect(old).not.toBe(timezoneText('display.pending', 'en'));
  timezone = 'Asia/Tehran';
  await act(async () => window.dispatchEvent(new Event('barghsa:timezone-changed')));
  expect(stamps()[0]!.textContent).not.toBe(old);
  expect(choice.value).toBe(assignmentAgent.id);
  expect(fetches.mock.calls.filter(([u]) => !String(u).endsWith('/timezone'))).toHaveLength(
    dataReads
  );
});
