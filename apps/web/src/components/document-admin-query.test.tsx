import { QueryComponentProvider } from '../test/query-provider.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { DocumentLegalHolds } from './DocumentLegalHolds.js';
import { DocumentRetentionPolicies } from './DocumentRetentionPolicies.js';
import { DocumentDestructionQueue } from './DocumentDestructionQueue.js';
import { DocumentRecords } from './DocumentRecords.js';
import { documentRow } from '../test/document-list-fixtures.js';
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ status: 'ready', timezone: 'UTC', notice: null, format: String }),
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ number: String, money: String }),
}));
const scopes = {
  policies: {
    current: { policies: [], canManage: false },
    old: {
      policies: [
        {
          id: 'old-policy',
          businessRecordType: 'contract',
          retentionYears: 99,
          legalHold: true,
          approvalNote: 'obsolete-private-note',
          effectiveDate: 'obsolete-private-date',
        },
      ],
      canManage: true,
    },
  },
  holds: {
    current: { held: false, holds: [], canManage: false },
    old: {
      held: true,
      canManage: true,
      holds: [
        {
          id: 'old-hold',
          documentId: documentRow.id,
          profileId: null,
          reason: 'obsolete-private-hold',
          initiatedAt: '2026-01-01',
          expiresAt: null,
          releasedAt: null,
          active: true,
        },
      ],
    },
  },
  destruction: {
    current: { items: [], counts: [], canManage: false },
    old: {
      canManage: true,
      counts: [{ status: 'pending_approval', count: 1 }],
      items: [
        {
          id: 'old-destruction',
          documentId: 'obsolete-private-document',
          businessRecordType: 'standalone',
          retentionDeadline: '2026-01-01',
          status: 'pending_approval',
          attempts: 0,
          lastError: null,
        },
      ],
    },
  },
};
type Kind = keyof typeof scopes | 'download' | 'preview';
let host: HTMLDivElement,
  root: Root,
  kind: Kind,
  signal: AbortSignal,
  finish: (value: unknown) => void;
let first: boolean;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  first = true;
  signal = undefined as unknown as AbortSignal;
  finish = undefined as unknown as (value: unknown) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBeUndefined();
      expect(init?.body).toBeUndefined();
      expect(init?.credentials).toBe('include');
      expect(String(path)).toContain(kind);
      if (first) {
        first = false;
        signal = init!.signal as AbortSignal;
        return {
          ok: true,
          status: 200,
          json: () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        } as Response;
      }
      return Response.json(
        kind === 'download' || kind === 'preview'
          ? { url: 'https://files.test/current.pdf' }
          : scopes[kind].current
      );
    })
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(present = true, actor = 'staff-one') {
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        <AccountUserProvider value={actor}>
          {present &&
            (kind === 'policies' ? (
              <DocumentRetentionPolicies />
            ) : kind === 'holds' ? (
              <DocumentLegalHolds document={documentRow} />
            ) : kind === 'destruction' ? (
              <DocumentDestructionQueue />
            ) : (
              <DocumentRecords
                items={[documentRow]}
                view="table"
                staff
                locale="en"
                selectedId={null}
                onSelect={() => {}}
                onReplace={() => {}}
                onChanged={() => {}}
                formatDate={String}
              />
            ))}
        </AccountUserProvider>
      </QueryComponentProvider>
    )
  );
}
async function clickLink() {
  const label = kind === 'download' ? 'Get download link' : 'Preview';
  const button = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === label)!;
  expect(button).toBeDefined();
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
}
for (const target of ['policies', 'holds', 'destruction', 'download', 'preview'] as const)
  it.each(['unmount', 'actor', 'profile-context'])(
    `retires actual ${target} full JSON and private grants on %s`,
    async (change) => {
      kind = target;
      await render();
      if (kind === 'download' || kind === 'preview') await clickLink();
      await vi.waitFor(() => expect(finish).toBeDefined());
      const oldSignal = signal,
        oldFinish = finish;
      expect(oldSignal.aborted).toBe(false);
      const count = vi.mocked(fetch).mock.calls.length;
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('online'));
      });
      expect(fetch).toHaveBeenCalledTimes(count);
      if (change === 'unmount') await render(false);
      else if (change === 'actor') await render(true, 'staff-two');
      else await act(async () => refreshProfileContext());
      expect(oldSignal.aborted).toBe(true);
      await act(async () =>
        oldFinish(
          target === 'download' || target === 'preview'
            ? { url: 'https://files.test/obsolete-private.pdf' }
            : scopes[target].old
        )
      );
      expect(host.innerHTML).not.toContain('obsolete-private');
      expect(host.querySelector('form')).toBeNull();
      if (change !== 'unmount') {
        if (kind === 'download' || kind === 'preview') {
          await clickLink();
          expect(
            host.querySelector(
              '[href="https://files.test/current.pdf"], [src="https://files.test/current.pdf"]'
            )
          ).not.toBeNull();
        } else expect(host.querySelector('details, section')).not.toBeNull();
      }
      expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method && !init?.body)).toBe(
        true
      );
    }
  );
it.each(['actor', 'profile-context'])(
  'withdraws accepted record signed links on %s before another explicit read',
  async (change) => {
    kind = 'download';
    first = false;
    await render();
    await clickLink();
    expect(host.querySelector('a[href="https://files.test/current.pdf"]')).not.toBeNull();
    if (change === 'actor') await render(true, 'staff-two');
    else await act(async () => refreshProfileContext());
    expect(host.querySelector('a')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    await clickLink();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(host.querySelector('a')).not.toBeNull();
  }
);
