import { t } from '@barghsa/i18n/admin-ui';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryComponentProvider } from '../test/query-provider.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import Knowledge from './AdminKnowledgeBasesPage.js';
import Policies from './AdminAiPoliciesPage.js';
import {
  knowledgeBase as kb,
  knowledgeGroup as kg,
  policyEntry as policy,
  policyGroup as pg,
} from '../test/knowledge-policy-fixtures.js';
const capture = vi.hoisted(() => ({
  success: null as ((value: unknown) => Promise<void>) | null,
  deny: null as (() => void) | null,
}));
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: ({
    onSuccess,
    onDenied,
  }: {
    onSuccess: (value: unknown) => Promise<void>;
    onDenied: () => void;
  }) => {
    capture.success = onSuccess;
    capture.deny = onDenied;
    return <div role="dialog" />;
  },
}));
const document = {
  id: '01900000-0000-7000-8000-000000000009',
  kbId: kb.id,
  storageKey: 'uploads/document/guide.txt',
  fileName: 'Private guide.txt',
  processingStatus: 'pending',
};
const cases = [
  {
    Page: Policies,
    kind: 'policy-groups',
    group: pg,
    field: 'members',
    item: { ...policy, priorityOverride: null },
    button: t('admin.policies.unlink', 'en'),
  },
  {
    Page: Knowledge,
    kind: 'kb-groups',
    group: kg,
    field: 'members',
    item: kb,
    button: t('admin.kb.unlink', 'en'),
  },
  {
    Page: Knowledge,
    kind: 'knowledge-bases',
    group: kb,
    field: 'documents',
    item: document,
    button: 'Detach document',
  },
] as const;
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  window.document.documentElement.lang = 'en';
  host = window.document.createElement('div');
  window.document.body.append(host);
  root = createRoot(host);
  capture.success = null;
  capture.deny = null;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(entry: (typeof cases)[number], actor = 'staff-a', visible = true) {
  const Page = entry.Page;
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        <AccountUserProvider value={actor}>
          {visible ? <Page initialKind={entry.kind as never} /> : null}
        </AccountUserProvider>
      </QueryComponentProvider>
    )
  );
}
async function click(text: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (node) => node.textContent?.trim() === text
  );
  expect(button, text).toBeDefined();
  await act(async () => button!.click());
}
for (const replacement of ['unmount', 'account', 'profile-context', 'denial'] as const) {
  it.each(cases)(
    `cancels $kind confirmation bytes on ${replacement} without publishing old private data`,
    async (entry) => {
      let hold = false;
      let signal!: AbortSignal, finish!: (value: unknown) => void;
      const reads = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const path = String(url);
        if (path === `/api/admin/${entry.kind}/${entry.group.id}`) {
          const response = Response.json({ ...entry.group, [entry.field]: [entry.item] });
          if (hold) {
            signal = init!.signal as AbortSignal;
            response.json = () =>
              new Promise((done) => {
                finish = done;
              });
          }
          return response;
        }
        if (path === `/api/admin/${entry.kind}`) return Response.json([entry.group]);
        if (path === '/api/admin/policies') return Response.json([policy]);
        if (path === '/api/admin/knowledge-bases') return Response.json([kb]);
        if (path.includes('documents/available')) return Response.json([]);
        return Response.json({});
      });
      vi.stubGlobal('fetch', reads);
      await render(entry);
      await click('Open');
      await click(entry.button);
      expect(capture.success).not.toBeNull();
      hold = true;
      let completion!: Promise<void>,
        rejected = false;
      await act(async () => {
        completion = capture.success!(null).catch(() => {
          rejected = true;
        });
      });
      expect(signal.aborted).toBe(false);
      const count = reads.mock.calls.length;
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('online'));
      });
      expect(reads).toHaveBeenCalledTimes(count);
      if (replacement === 'unmount') await render(entry, 'staff-a', false);
      else if (replacement === 'account') await render(entry, 'staff-b');
      else if (replacement === 'profile-context') await act(async () => refreshProfileContext());
      else await act(async () => capture.deny!());
      expect(signal.aborted).toBe(true);
      await act(async () => {
        finish({ ...entry.group, title: 'Old private confirmation', [entry.field]: [] });
        await completion;
      });
      expect(rejected).toBe(true);
      expect(host.textContent).not.toContain('Old private confirmation');
      expect(host.textContent).not.toContain('Changes saved.');
      expect(host.querySelector('[role=dialog]')).toBeNull();
      if (replacement === 'account' || replacement === 'profile-context')
        expect(host.textContent).toContain(entry.group.title);
      if (replacement === 'denial') expect(host.textContent).not.toContain(entry.group.title);
    }
  );
}
