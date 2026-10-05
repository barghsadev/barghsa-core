import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { DocumentResults, type DocumentFilters } from './DocumentsWorkspace.js';
import { DocumentDestructionQueue } from './DocumentDestructionQueue.js';
import AdminDocumentTemplatesPage from '../pages/AdminDocumentTemplatesPage.js';
import {
  documentUploadPolicy,
  documentProfileId,
  documentRow,
  documentMore,
  documentCursor,
  documentDetail,
  templateRow,
  templateDetail,
  templateFile,
  destructionQueue,
} from '../test/document-list-fixtures.js';

vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ format: (value: string) => value, notice: null }),
}));
const action = vi.hoisted(() => ({
  success: null as null | ((result: unknown) => Promise<void>),
  close: null as null | (() => void),
}));
vi.mock('./TeamActionDialog.js', () => ({
  TeamActionDialog: ({
    action: item,
    onSuccess,
    onClose,
  }: {
    action: { title: string };
    onSuccess: (value: unknown) => Promise<void>;
    onClose: () => void;
  }) => {
    action.success = onSuccess;
    action.close = onClose;
    return <div role="dialog">{item.title}</div>;
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.lang = 'fa';
  action.success = null;
  action.close = null;
});
const filters: DocumentFilters = {
  kind: 'standalone',
  state: 'SubmittedForReview',
  category: 'document',
  query: 'Review',
  profileId: '',
  businessRecordId: '',
};
function button(host: ParentNode, label: string) {
  const found = Array.from(host.querySelectorAll('button')).find(
    (item) => item.textContent === label
  );
  expect(found, label).toBeDefined();
  return found!;
}
async function change(host: ParentNode, selector: string, value: string) {
  const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value'
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function mount(node: ReactNode) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.lang = 'en';
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return {
    host,
    render: async (next: ReactNode) => {
      await act(async () => root.render(next));
    },
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
async function selectFile(host: ParentNode, selector: string) {
  const input = host.querySelector<HTMLInputElement>(selector)!;
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [new File(['%PDF-draft'], 'Draft.pdf', { type: 'application/pdf' })],
  });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  return input;
}
for (const staff of [false, true])
  it(`${staff ? 'staff' : 'customer'} document recovery keeps detail/reason and retries the failed cursor only`, async () => {
    const calls: string[] = [];
    let status = 503;
    let pageStatus = 503;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        if (!url.includes('?')) return Response.json(documentDetail);
        const cursor = new URL(url, 'https://local').searchParams.get('before');
        if (status !== 200 || (cursor && pageStatus !== 200))
          return new Response('{}', { status: cursor ? pageStatus : status });
        return Response.json({
          documents: cursor ? [documentRow, documentMore] : [documentRow],
          nextBefore: cursor ? null : documentCursor,
        });
      })
    );
    const { host, close } = await mount(
      <DocumentResults staff={staff} profileId={documentProfileId} filters={filters} />
    );
    try {
      status = 200;
      await act(async () => button(host, 'Try again').click());
      await act(async () => button(host, documentRow.originalName).click());
      if (staff) await change(host, '#document-review-reason', 'Staff draft');
      await act(async () => button(host, 'Load more').click());
      const failed = calls.at(-1)!;
      expect(new URL(failed, 'https://local').searchParams.get('before')).toBe(documentCursor);
      expect(host.querySelector('ul')?.textContent).toContain(documentRow.originalName);
      const detail = host.querySelector('[aria-label="View details"]');
      expect(detail).not.toBeNull();
      const count = calls.length;
      pageStatus = 200;
      await act(async () => button(host, 'Try again').click());
      expect(calls.slice(count)).toEqual([failed]);
      expect(host.querySelector('[aria-label="View details"]')).toBe(detail);
      expect(host.querySelectorAll('[data-slot="list-content"] li')).toHaveLength(2);
      if (staff)
        expect(host.querySelector<HTMLTextAreaElement>('#document-review-reason')?.value).toBe(
          'Staff draft'
        );
    } finally {
      await close();
    }
  });
it('document refresh and retry keep an upload file input mounted, while permission denial removes it', async () => {
  let status = 200;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.startsWith('/api/upload/policy/')
        ? Response.json(documentUploadPolicy(url.split('/').at(-1)))
        : status === 200
          ? Response.json({ documents: [documentRow], nextBefore: null })
          : new Response('{}', { status })
    )
  );
  const { host, close } = await mount(
    <DocumentResults staff={false} profileId={documentProfileId} filters={filters} />
  );
  try {
    await act(async () => button(host, 'Upload document').click());
    const input = await selectFile(host, '[data-slot="file-upload"] input[type="file"]');
    status = 503;
    await act(async () => button(host, 'Refresh').click());
    status = 200;
    await act(async () => button(host, 'Try again').click());
    expect(host.querySelector('[data-slot="file-upload"] input[type="file"]')).toBe(input);
    expect(input.files?.[0]?.name).toBe('Draft.pdf');
    status = 403;
    await act(async () => button(host, 'Refresh').click());
    expect(host.querySelector('[data-slot="file-upload"] input[type="file"]')).toBeNull();
    expect(host.querySelector('[data-slot="list-content"] li')).toBeNull();
    expect(host.querySelector('[role="alert"] button')).toBeNull();
  } finally {
    await close();
  }
});
it('changing document scope discards old work and ignores an abandoned response', async () => {
  let finish: ((value: Response) => void) | undefined;
  let hold = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('/api/upload/policy/'))
        return Response.json(documentUploadPolicy(url.split('/').at(-1)));
      if (url.includes(documentProfileId) && hold)
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      return Response.json(
        url.includes('?') ? { documents: [documentRow], nextBefore: null } : documentDetail
      );
    })
  );
  const { host, render, close } = await mount(
    <DocumentResults staff={false} profileId={documentProfileId} filters={filters} />
  );
  try {
    await act(async () => button(host, 'Upload document').click());
    await selectFile(host, '[data-slot="file-upload"] input[type="file"]');
    hold = true;
    await act(async () => button(host, 'Refresh').click());
    await render(<DocumentResults staff={false} profileId={documentCursor} filters={filters} />);
    expect(host.querySelector('[data-slot="file-upload"] input[type="file"]')).toBeNull();
    await act(async () =>
      finish!(
        Response.json({
          documents: [{ ...documentRow, originalName: 'Private old.pdf' }],
          nextBefore: null,
        })
      )
    );
    expect(host.textContent).not.toContain('Private old.pdf');
  } finally {
    await close();
  }
});

it('equivalent document filter props preserve upload work without another request', async () => {
  const fetcher = vi.fn(async (url: string) =>
    Response.json(
      url.startsWith('/api/upload/policy/')
        ? documentUploadPolicy(url.split('/').at(-1))
        : { documents: [documentRow], nextBefore: null }
    )
  );
  vi.stubGlobal('fetch', fetcher);
  const { host, render, close } = await mount(
    <DocumentResults staff={false} profileId={documentProfileId} filters={filters} />
  );
  try {
    await act(async () => button(host, 'Upload document').click());
    const input = await selectFile(host, '[data-slot="file-upload"] input[type="file"]');
    const count = fetcher.mock.calls.length;
    await render(
      <DocumentResults staff={false} profileId={documentProfileId} filters={{ ...filters }} />
    );
    expect(fetcher.mock.calls).toHaveLength(count);
    expect(host.querySelector('[data-slot="file-upload"] input[type="file"]')).toBe(input);
  } finally {
    await close();
  }
});
function templateData(url: string) {
  return url.includes('?') ? [templateRow] : templateDetail;
}
it('template list retry preserves metadata and version file drafts without rereading detail', async () => {
  let listStatus = 200;
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      return url.includes('?') && listStatus !== 200
        ? new Response('{}', { status: listStatus })
        : Response.json(templateData(url));
    })
  );
  const { host, close } = await mount(<AdminDocumentTemplatesPage />);
  try {
    await act(async () => button(host, templateRow.title + 'Contract · Versions: 1').click());
    await act(async () => button(host, 'Edit template').click());
    await change(host, '#document-template-title', 'Metadata draft');
    await change(host, '#document-template-summary', 'Version draft');
    const input = await selectFile(host, '#document-template-files');
    await act(async () => host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
    listStatus = 503;
    await act(async () => button(host, 'Refresh').click());
    const count = calls.length;
    listStatus = 200;
    await act(async () => button(host, 'Try again').click());
    expect(calls.slice(count)).toEqual(['/api/admin/document-templates?']);
    expect(host.querySelector<HTMLInputElement>('#document-template-title')?.value).toBe(
      'Metadata draft'
    );
    expect(host.querySelector<HTMLInputElement>('#document-template-summary')?.value).toBe(
      'Version draft'
    );
    expect(host.querySelector('#document-template-files')).toBe(input);
    expect(host.querySelector<HTMLInputElement>('input[type=checkbox]')?.checked).toBe(false);
  } finally {
    await close();
  }
});
it('template detail retry does not reload its list; newer versions drop obsolete retained files but keep new files and explanation', async () => {
  let detailStatus = 503;
  let newer = false;
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      if (!url.includes('?') && detailStatus !== 200)
        return new Response('{}', { status: detailStatus });
      const next = newer
        ? {
            ...templateDetail,
            versions: [
              {
                ...templateDetail.versions[0]!,
                id: 'new-version',
                files: [{ ...templateFile, id: 'new-file' }],
              },
            ],
          }
        : templateDetail;
      return Response.json(url.includes('?') ? [templateRow] : next);
    })
  );
  const { host, close } = await mount(<AdminDocumentTemplatesPage />);
  try {
    await act(async () => button(host, templateRow.title + 'Contract · Versions: 1').click());
    const count = calls.length;
    detailStatus = 200;
    await act(async () => button(host, 'Try again').click());
    expect(calls.slice(count)).toEqual([`/api/admin/document-templates/${templateRow.id}`]);
    await change(host, '#document-template-summary', 'Keep this explanation');
    const input = await selectFile(host, '#document-template-files');
    await act(async () => button(host, 'Create new version').click());
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    newer = true;
    const beforeRefresh = calls.length;
    expect(button(host, 'Refresh').disabled).toBe(true);
    await act(async () => button(host, 'Refresh').click());
    expect(calls).toHaveLength(beforeRefresh);
    await act(async () => action.close!());
    await act(async () => button(host, 'Refresh').click());
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector<HTMLInputElement>('input[type=checkbox]')?.checked).toBe(false);
    expect(host.querySelector('#document-template-files')).toBe(input);
    expect(host.querySelector<HTMLInputElement>('#document-template-summary')?.value).toBe(
      'Keep this explanation'
    );
    expect(host.textContent).toContain('current version changed');
  } finally {
    await close();
  }
});
it('template permission denial rejects a racing download and a late command callback', async () => {
  let status = 200;
  let finish: ((value: Response) => void) | undefined;
  let denyRead: ((value: Response) => void) | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/download'))
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      if (status === 403 && url.includes('?'))
        return new Promise<Response>((resolve) => {
          denyRead = resolve;
        });
      return status === 200 ? Response.json(templateData(url)) : new Response('{}', { status });
    })
  );
  const { host, close } = await mount(<AdminDocumentTemplatesPage />);
  try {
    await act(async () => button(host, templateRow.title + 'Contract · Versions: 1').click());
    await act(async () => button(host, 'Get file link').click());
    status = 403;
    await change(host, '#document-template-search', 'Changed search');
    await act(async () => button(host, 'Search templates').click());
    await act(async () => button(host, 'Create new version').click());
    const callback = action.success!;
    await act(async () => denyRead!(new Response('{}', { status: 403 })));
    await act(async () => {
      finish!(Response.json({ url: 'https://storage.example.test/private.pdf' }));
      await expect(callback(templateRow)).rejects.toThrow('Obsolete document template receipt');
    });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector('a')).toBeNull();
    expect(host.querySelector('#document-template-files')).toBeNull();
    expect(host.querySelector('h2')).toBeNull();
    expect(host.textContent).not.toContain('Changes saved');
  } finally {
    await close();
  }
});
it('opening or cancelling template creation does not reread its list', async () => {
  const fetcher = vi.fn(async () => Response.json([templateRow]));
  vi.stubGlobal('fetch', fetcher);
  const { host, close } = await mount(<AdminDocumentTemplatesPage />);
  try {
    const count = fetcher.mock.calls.length;
    await act(async () => button(host, 'Add template').click());
    await change(host, '#document-template-title', 'New draft');
    await act(async () => button(host, 'Cancel').click());
    expect(fetcher.mock.calls).toHaveLength(count);
  } finally {
    await close();
  }
});
it('destruction queue retry preserves approval reasons; denial removes the approval and its dialog', async () => {
  let status = 200;
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      return status === 200 ? Response.json(destructionQueue) : new Response('{}', { status });
    })
  );
  const { host, close } = await mount(<DocumentDestructionQueue />);
  try {
    host.querySelector('details')!.open = true;
    await act(async () => button(host, 'Approve destruction').click());
    await change(host, '#destruction-note', 'Legal approval draft');
    const note = host.querySelector('#destruction-note');
    status = 503;
    await act(async () => button(host, 'Refresh').click());
    status = 200;
    await act(async () => button(host, 'Try again').click());
    expect(host.querySelector('#destruction-note')).toBe(note);
    expect(host.querySelector<HTMLTextAreaElement>('#destruction-note')?.value).toBe(
      'Legal approval draft'
    );
    expect(calls.every((url) => url === '/api/admin/document-retention/destruction')).toBe(true);
    await act(async () =>
      host.querySelector<HTMLButtonElement>('form button[type=submit]')!.click()
    );
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    status = 403;
    await act(async () => button(host, 'Refresh').click());
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector('#destruction-note')).toBeNull();
    expect(host.querySelector('[role="alert"] button')).toBeNull();
  } finally {
    await close();
  }
});
it('a valid destruction refresh closes an approval when its manifest is no longer pending', async () => {
  let pending = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json(
        pending
          ? destructionQueue
          : { ...destructionQueue, items: [{ ...destructionQueue.items[0]!, status: 'approved' }] }
      )
    )
  );
  const { host, close } = await mount(<DocumentDestructionQueue />);
  try {
    await act(async () => button(host, 'Approve destruction').click());
    await change(host, '#destruction-note', 'Reason');
    await act(async () =>
      host.querySelector<HTMLButtonElement>('form button[type=submit]')!.click()
    );
    pending = false;
    await act(async () => button(host, 'Refresh').click());
    expect(host.querySelector('#destruction-note')).toBeNull();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  } finally {
    await close();
  }
});
