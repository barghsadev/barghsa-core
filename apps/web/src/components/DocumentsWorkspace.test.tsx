import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DocumentsWorkspace } from './DocumentsWorkspace.js';
import { DocumentDetail } from './DocumentDetail.js';
import { DocumentUpload } from './DocumentUpload.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import type { BusinessDocument } from '../lib/documents.js';
import type { TeamAction } from './TeamActionDialog.js';
import { ErrorCodes } from '@barghsa/shared/errors';
import DocumentsPage from '../pages/DocumentsPage.js';
import AdminDocumentsPage from '../pages/AdminDocumentsPage.js';

const harness = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'fa',
  action: null as TeamAction | null,
  result: null as unknown,
}));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => harness.locale }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({
    notice: null,
    format: (value: string) => value,
  }),
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({
    number: (value: number) => String(value),
  }),
}));
vi.mock('./TeamActionDialog.js', () => ({
  TeamActionDialog: ({
    action,
    onSuccess,
    onClose,
  }: {
    action?: TeamAction;
    onSuccess: (result: unknown) => Promise<void>;
    onClose: () => void;
  }) => {
    harness.action = action ?? null;
    return (
      <div role="dialog">
        <button onClick={() => void onSuccess(harness.result)}>Confirm action</button>
        <button onClick={onClose}>Close confirmation</button>
      </div>
    );
  },
}));
const PROFILE = '11111111-1111-4111-8111-111111111111';
const DOCUMENT = '22222222-2222-4222-8222-222222222222';
const row = (extra: Partial<BusinessDocument> = {}): BusinessDocument => ({
  id: DOCUMENT,
  profileId: PROFILE,
  businessRecordType: 'standalone',
  businessRecordId: null,
  contractVersionId: null,
  contractRole: null,
  category: 'document',
  state: 'Available',
  originalName: 'Proof.pdf',
  detectedMime: 'application/pdf',
  sizeBytes: 123,
  checksum: 'a'.repeat(64),
  uploadedBy: 'owner',
  uploadedByType: 'customer',
  supersedesDocumentId: null,
  rejectionReason: null,
  reviewComment: null,
  revision: 3,
  createdAt: '2026-09-21T00:00:00Z',
  updatedAt: '2026-09-21T00:00:00Z',
  ...extra,
});
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  harness.locale = 'en';
  harness.action = null;
  harness.result = null;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function render(node: ReactNode) {
  await act(async () => root.render(node));
}
function button(text: string) {
  const match = [...container.querySelectorAll('button')].find((item) => item.textContent === text);
  expect(match, text).toBeDefined();
  return match!;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
async function value(selector: string, text: string) {
  const input = container.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    selector
  )!;
  const prototype =
    input instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(
      new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })
    );
  });
}

it.each(['en', 'fa'] as const)(
  'loads the selected profile and renders documents in %s',
  async (locale) => {
    harness.locale = locale;
    const fetcher = vi.fn(async (url: string) =>
      url === '/api/profiles'
        ? response({ activeProfileId: PROFILE })
        : response({ documents: [row()], nextBefore: null })
    );
    vi.stubGlobal('fetch', fetcher);
    await render(<DocumentsWorkspace />);
    expect(container.textContent).toContain('Proof.pdf');
    expect(container.querySelector('[dir]')?.getAttribute('dir')).toBe(
      locale === 'fa' ? 'rtl' : 'ltr'
    );
    expect(fetcher.mock.calls.some(([url]) => url.includes(`profileId=${PROFILE}`))).toBe(true);
  }
);

it('sends search/category filters to the server and paginates without duplicate rows', async () => {
  const fetcher = vi.fn(async (url: string) => {
    if (url === '/api/profiles') return response({ activeProfileId: PROFILE });
    const query = new URL(url, 'https://app.test').searchParams;
    return response({
      documents: query.has('before')
        ? [row(), row({ id: 'next', originalName: 'Next.pdf' })]
        : [row()],
      nextBefore: query.has('before') ? null : DOCUMENT,
    });
  });
  vi.stubGlobal('fetch', fetcher);
  await render(<DocumentsPage />);
  await value('#documents-search', '100%');
  await value('#documents-category', 'document');
  await click('Apply filters');
  const filtered = new URL(fetcher.mock.calls.at(-1)![0], 'https://app.test');
  expect(filtered.searchParams.get('q')).toBe('100%');
  expect(filtered.searchParams.get('category')).toBe('document');
  await click('Load more');
  expect(container.textContent).toContain('Next.pdf');
  expect(
    [...container.querySelectorAll('button')].filter((item) => item.textContent === 'Proof.pdf')
  ).toHaveLength(1);
});

it('abandons requests from the old profile and never renders a late result after switching', async () => {
  let selected = PROFILE;
  let resolveOld!: (response: Response) => void;
  let oldSignal: AbortSignal | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options: RequestInit) => {
      if (url === '/api/profiles') return response({ activeProfileId: selected });
      if (url.includes(PROFILE)) {
        oldSignal = options.signal as AbortSignal;
        return new Promise<Response>((resolve) => {
          resolveOld = resolve;
        });
      }
      return response({ documents: [row({ originalName: 'New profile.pdf' })], nextBefore: null });
    })
  );
  await render(<DocumentsWorkspace />);
  selected = '33333333-3333-4333-8333-333333333333';
  await act(async () => refreshProfileContext());
  expect(oldSignal?.aborted).toBe(true);
  await act(async () =>
    resolveOld(
      response({ documents: [row({ originalName: 'Private old file.pdf' })], nextBefore: null })
    )
  );
  expect(container.textContent).toContain('New profile.pdf');
  expect(container.textContent).not.toContain('Private old file.pdf');
});

it('requires a rejection reason and binds the confirmed staff action to the displayed revision', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      response({
        ...row({ state: 'SubmittedForReview', revision: 7 }),
        history: [
          {
            id: 'event',
            state: 'SubmittedForReview',
            createdAt: '2026-09-21T00:00:00Z',
            reason: 'Review requested',
          },
        ],
      })
    )
  );
  await render(
    <DocumentDetail
      id={DOCUMENT}
      staff
      onClose={vi.fn()}
      onChanged={vi.fn()}
      onReplace={vi.fn()}
      onPrevious={vi.fn()}
    />
  );
  await click('Reject');
  expect(container.textContent).toContain('Enter a reason');
  expect(harness.action).toBeNull();
  await value('#document-review-reason', 'Please upload a readable scan');
  await click('Reject');
  expect(harness.action).toMatchObject({
    path: `/api/admin/documents/${DOCUMENT}/reject`,
    body: {
      expectedRevision: 7,
      reason: 'Please upload a readable scan',
      idempotencyKey: expect.any(String),
    },
  });
});

it('blocks unsafe preview links and hides mutation controls on customer originals', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith('/download')
        ? response({ url: 'javascript:alert(1)' })
        : response({
            ...row({ businessRecordType: 'contract', contractRole: 'original' }),
            history: [],
          })
    )
  );
  await render(
    <DocumentDetail
      id={DOCUMENT}
      staff={false}
      onClose={vi.fn()}
      onChanged={vi.fn()}
      onReplace={vi.fn()}
      onPrevious={vi.fn()}
    />
  );
  expect(container.textContent).not.toContain('Submit for review');
  expect(container.textContent).not.toContain('Replace document');
  await click('Get download link');
  expect(container.querySelector('iframe, img, a')).toBeNull();
  expect(container.querySelector('[role=alert]')).not.toBeNull();
});

it.each([
  { staff: true, role: 'original' as const, canReplace: true },
  { staff: true, role: 'signed' as const, canReplace: false },
  { staff: false, role: 'original' as const, canReplace: false },
])('limits quarantined contract replacement to staff originals: %j', async (case_) => {
  const replace = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      response({
        ...row({
          businessRecordType: 'contract',
          businessRecordId: PROFILE,
          contractVersionId: DOCUMENT,
          contractRole: case_.role,
          state: 'Quarantined',
          uploadedByType: 'staff',
        }),
        history: [],
      })
    )
  );
  await render(
    <DocumentDetail
      id={DOCUMENT}
      staff={case_.staff}
      onClose={vi.fn()}
      onChanged={vi.fn()}
      onReplace={replace}
      onPrevious={vi.fn()}
    />
  );
  expect(container.textContent?.includes('Replace document')).toBe(case_.canReplace);
  if (case_.canReplace) {
    await click('Replace document');
    expect(replace).toHaveBeenCalledWith(
      expect.objectContaining({ id: DOCUMENT, state: 'Quarantined', contractRole: 'original' })
    );
  }
});

it('retries a lost storage response and step-up with the same file and confirmation key', async () => {
  const uploaded = vi.fn();
  const file = new File(['%PDF-1.7'], 'proof.pdf', { type: 'application/pdf' });
  harness.result = {
    document: row({ state: 'Uploading', revision: 1 }),
    upload: {
      presignedUrl: 'https://storage.test/proof',
      headers: { 'If-None-Match': '*' },
    },
  };
  let puts = 0,
    confirmations = 0;
  const bodies: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options: RequestInit) => {
      if (url.startsWith('https://storage.test')) {
        expect(options.body).toBe(file);
        if (++puts === 1) throw new Error('Lost response');
        return new Response(null, { status: 412 });
      }
      bodies.push(String(options.body));
      if (++confirmations === 1)
        return response({ error: ErrorCodes.AUTHZ_STEP_UP_REQUIRED.code }, 403);
      return response(row());
    })
  );
  await render(
    <DocumentUpload
      staff={false}
      profileId={PROFILE}
      replacement={null}
      onClose={vi.fn()}
      onUploaded={uploaded}
    />
  );
  const input = container.querySelector<HTMLInputElement>('input[type=file]')!;
  await act(async () => {
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await click('Upload document');
  expect(harness.action).toMatchObject({ body: { profileId: PROFILE, fileName: file.name } });
  await click('Confirm action');
  expect(container.textContent).toContain('Upload did not finish');
  await click('Retry upload');
  await click('Confirm action');
  expect(puts).toBe(2);
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toBe(bodies[1]);
  expect(uploaded).toHaveBeenCalledWith(expect.objectContaining({ state: 'Available' }));
});

it('lets staff recover a denied queue and restricts upload context to a valid selected profile', async () => {
  let fail = true;
  const fetcher = vi.fn(async () =>
    fail ? response({}, 403) : response({ documents: [], nextBefore: null })
  );
  vi.stubGlobal('fetch', fetcher);
  await render(<AdminDocumentsPage />);
  expect(container.querySelector('[role=alert]')).not.toBeNull();
  expect(fetcher.mock.calls).toHaveLength(1);
  fail = false;
  await click('Refresh');
  expect(container.textContent).toContain('No documents found');
  await value('#documents-profile', 'not-a-profile');
  await click('Apply filters');
  expect(container.textContent).toContain('Enter a valid reference');
  await value('#documents-profile', PROFILE);
  await click('Apply filters');
  await click('Upload document');
  expect(container.querySelector('input[type=file]')).not.toBeNull();
  await click('Cancel');
  await value('#documents-kind', 'invoice');
  await value('#documents-record', '44444444-4444-4444-8444-444444444444');
  await click('Apply filters');
  expect(container.querySelector('input[type=file]')).toBeNull();
});

it('preserves exact contract version and role when opening a replacement upload', async () => {
  const replacement = row({
    businessRecordType: 'contract',
    businessRecordId: 'contract-id',
    contractVersionId: 'version-id',
    contractRole: 'signed',
    category: 'contract',
    state: 'Rejected',
  });
  await render(
    <DocumentUpload
      staff={false}
      profileId={PROFILE}
      replacement={replacement}
      onClose={vi.fn()}
      onUploaded={vi.fn()}
    />
  );
  const input = container.querySelector<HTMLInputElement>('input[type=file]')!;
  await act(async () => {
    Object.defineProperty(input, 'files', {
      value: [new File(['copy'], 'signed.pdf', { type: 'application/pdf' })],
    });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await click('Replace document');
  expect(harness.action).toMatchObject({
    body: {
      profileId: PROFILE,
      businessRecordId: 'contract-id',
      contractVersionId: 'version-id',
      contractRole: 'signed',
      supersedesDocumentId: DOCUMENT,
      category: 'contract',
    },
  });
});

it('shows retained history, a safe image preview and replacement navigation', async () => {
  const replace = vi.fn(),
    previous = vi.fn();
  const document = row({
    detectedMime: 'image/png',
    supersedesDocumentId: 'previous',
    reviewComment: 'Please update the evidence',
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.endsWith('/download')
        ? response({ url: 'https://storage.test/verified.png' })
        : response({
            ...document,
            history: [
              {
                id: 'event',
                state: 'Available',
                createdAt: document.createdAt,
                reason: 'Verified upload',
              },
            ],
          })
    )
  );
  await render(
    <DocumentDetail
      id={DOCUMENT}
      staff
      onClose={vi.fn()}
      onChanged={vi.fn()}
      onReplace={replace}
      onPrevious={previous}
    />
  );
  expect(container.textContent).toContain('Verified upload');
  await click('Previous document');
  expect(previous).toHaveBeenCalledWith('previous');
  await click('Get download link');
  expect(container.querySelector('img')?.getAttribute('src')).toBe(
    'https://storage.test/verified.png'
  );
  expect(container.querySelector('a')?.getAttribute('rel')).toBe('noopener noreferrer');
  await click('Replace document');
  expect(replace).toHaveBeenCalledWith(expect.objectContaining({ id: DOCUMENT }));
});
