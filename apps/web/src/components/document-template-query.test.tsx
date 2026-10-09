import { QueryComponentProvider } from '../test/query-provider.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { documentTemplateText } from '@barghsa/i18n/document-templates';
import AdminDocumentTemplatesPage from '../pages/AdminDocumentTemplatesPage.js';
import { LegalProfileDocuments } from './LegalProfileDocuments.js';
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ notice: null, format: String }),
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ number: String, money: String }),
}));
const row = {
  id: 'template-1',
  title: 'Current template',
  description: 'Current description',
  category: 'contract',
  versionCount: 1,
  updatedAt: '2026-01-01',
};
const detail = {
  ...row,
  versions: [
    {
      id: 'version-1',
      versionNumber: 1,
      changeSummary: 'Current version',
      createdAt: '2026-01-01',
      placeholders: [],
      missingRequired: [],
      conflicts: [],
      files: [
        {
          id: 'file-1',
          originalName: 'current.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 100,
          checksum: 'a'.repeat(64),
          placeholders: [],
        },
      ],
    },
  ],
};
let host: HTMLDivElement,
  root: Root,
  target: 'list' | 'detail' | 'download' | 'legal',
  first: boolean,
  signal: AbortSignal,
  finish: (value: unknown) => void,
  nextVersion: boolean;
const onDenied = vi.fn();
function data(path: string) {
  if (path.startsWith('/api/onboarding/'))
    return {
      documents: [
        {
          key: 'current',
          name: 'Current legal document',
          url: 'https://files.test/current-legal.pdf',
        },
      ],
    };
  if (path.endsWith('/download')) return { url: 'https://files.test/current-template.pdf' };
  if (path.includes('?')) return [row, { ...row, id: 'template-2', title: 'Other template' }];
  return {
    ...detail,
    id: path.split('/').at(-1),
    versions: nextVersion
      ? [{ ...detail.versions[0], id: 'version-2', versionNumber: 2 }]
      : detail.versions,
  };
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  first = true;
  nextVersion = false;
  signal = undefined as unknown as AbortSignal;
  finish = undefined as unknown as (value: unknown) => void;
  onDenied.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      expect(init?.method).toBeUndefined();
      expect(init?.body).toBeUndefined();
      expect(init?.headers).toBeUndefined();
      expect(init?.credentials).toBe(path.startsWith('/api/onboarding/') ? 'include' : undefined);
      const held =
        target === 'legal'
          ? path.startsWith('/api/onboarding/')
          : target === 'list'
            ? path.includes('?')
            : target === 'download'
              ? path.endsWith('/download')
              : !path.includes('?') && !path.endsWith('/download');
      if (first && held) {
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
      return Response.json(data(path));
    })
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(present = true, actor = 'staff-one', profile = 'profile-one') {
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        <AccountUserProvider value={actor}>
          {present &&
            (target === 'legal' ? (
              <LegalProfileDocuments profileId={profile} onAccessDenied={onDenied} />
            ) : (
              <AdminDocumentTemplatesPage />
            ))}
        </AccountUserProvider>
      </QueryComponentProvider>
    )
  );
}
async function click(text: string) {
  const button = Array.from(host.querySelectorAll('button')).find((b) => b.textContent === text)!;
  expect(button, text).toBeDefined();
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
}
for (const kind of ['list', 'detail', 'download', 'legal'] as const)
  it.each(['unmount', 'actor', 'profile-context'])(
    `owns native ${kind} full JSON through %s`,
    async (change) => {
      target = kind;
      await render();
      if (kind === 'detail' || kind === 'download') await click('Current template');
      if (kind === 'download') await click(documentTemplateText('download', 'en'));
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
          kind === 'list'
            ? [{ ...row, title: 'obsolete-private-template' }]
            : kind === 'detail'
              ? { ...detail, description: 'obsolete-private-detail' }
              : kind === 'download'
                ? { url: 'https://files.test/obsolete-private.pdf' }
                : {
                    documents: [
                      {
                        key: 'old',
                        name: 'obsolete-private-legal',
                        url: 'https://files.test/obsolete-private.pdf',
                      },
                    ],
                  }
        )
      );
      expect(host.innerHTML).not.toContain('obsolete-private');
      expect(onDenied).not.toHaveBeenCalled();
      if (change !== 'unmount') {
        if (kind === 'legal')
          expect(host.querySelector('a')?.href).toBe('https://files.test/current-legal.pdf');
        else {
          expect(host.textContent).toContain('Current template');
          if (kind !== 'list') {
            await click('Current template');
            expect(host.textContent).toContain('Current description');
            if (kind === 'download') {
              await click(documentTemplateText('download', 'en'));
              expect(host.querySelector('a')?.href).toBe('https://files.test/current-template.pdf');
            }
          }
        }
      }
      expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method && !init?.body)).toBe(
        true
      );
    }
  );
it.each(['detail', 'download'] as const)(
  'cancels pending template %s when another row is chosen without replaying its list',
  async (kind) => {
    target = kind;
    await render();
    await click('Current template');
    if (kind === 'download') await click(documentTemplateText('download', 'en'));
    await vi.waitFor(() => expect(finish).toBeDefined());
    const oldSignal = signal,
      oldFinish = finish;
    await click('Other template');
    expect(oldSignal.aborted).toBe(true);
    await act(async () =>
      oldFinish(
        kind === 'detail'
          ? { ...detail, description: 'obsolete-private-detail' }
          : { url: 'https://files.test/obsolete-private.pdf' }
      )
    );
    expect(host.innerHTML).not.toContain('obsolete-private');
    expect(vi.mocked(fetch).mock.calls.filter(([p]) => String(p).includes('?'))).toHaveLength(1);
  }
);
it('cancels a pending template link when refreshed detail accepts a new version', async () => {
  target = 'download';
  await render();
  await click('Current template');
  await click(documentTemplateText('download', 'en'));
  await vi.waitFor(() => expect(finish).toBeDefined());
  const oldSignal = signal,
    oldFinish = finish;
  nextVersion = true;
  await click(documentTemplateText('refresh', 'en'));
  expect(oldSignal.aborted).toBe(true);
  await act(async () => oldFinish({ url: 'https://files.test/obsolete-private.pdf' }));
  expect(host.querySelector('a')).toBeNull();
});
it('retires pending legal bytes when the selected profile changes', async () => {
  target = 'legal';
  await render();
  await vi.waitFor(() => expect(finish).toBeDefined());
  const oldSignal = signal,
    oldFinish = finish;
  await render(true, 'staff-one', 'profile-two');
  expect(oldSignal.aborted).toBe(true);
  await act(async () =>
    oldFinish({
      documents: [
        {
          key: 'old',
          name: 'obsolete-private-legal',
          url: 'https://files.test/obsolete-private.pdf',
        },
      ],
    })
  );
  expect(host.innerHTML).not.toContain('obsolete-private');
  expect(host.querySelector('a')?.href).toBe('https://files.test/current-legal.pdf');
  expect(onDenied).not.toHaveBeenCalled();
});
it.each([401, 403, 404])(
  'keeps legal-document access denial callback for status %s',
  async (status) => {
    target = 'legal';
    vi.mocked(fetch).mockResolvedValue(Response.json({}, { status }));
    await render();
    expect(onDenied).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.querySelector('a')).toBeNull();
  }
);
