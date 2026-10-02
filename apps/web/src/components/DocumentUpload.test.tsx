import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DocumentUpload } from './DocumentUpload.js';
import {
  documentRow,
  documentProfileId,
  documentUploadPolicy,
} from '../test/document-list-fixtures.js';
import { UploadXHR } from '../test/upload-progress-fixture.js';
import type { TeamAction } from './TeamActionDialog.js';
const harness = vi.hoisted(() => ({ action: null as TeamAction | null, result: null as unknown }));
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ number: (value: number) => String(value) }),
}));
vi.mock('./TeamActionDialog.js', () => ({
  TeamActionDialog: ({
    action,
    onSuccess,
  }: {
    action?: TeamAction;
    onSuccess: (value: unknown) => Promise<void>;
  }) => {
    harness.action = action ?? null;
    return <button onClick={() => void onSuccess(harness.result)}>Confirm action</button>;
  },
}));
let host: HTMLDivElement, root: Root, confirmStatus: number, policyStatus: number;
const uploaded = vi.fn(),
  closed = vi.fn(),
  fetcher = vi.fn<typeof fetch>();
const file = new File(['abcdefg'], 'proof.pdf', { type: 'application/pdf' });
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('XMLHttpRequest', UploadXHR);
  UploadXHR.instances = [];
  uploaded.mockReset();
  closed.mockReset();
  fetcher.mockReset();
  confirmStatus = 200;
  policyStatus = 200;
  harness.action = null;
  harness.result = {
    document: { ...documentRow, state: 'Uploading', revision: 1 },
    upload: { presignedUrl: 'https://storage.test/proof', headers: { 'If-None-Match': '*' } },
  };
  fetcher.mockImplementation(async (input) =>
    String(input).includes('/policy/')
      ? Response.json(documentUploadPolicy(String(input).split('/').at(-1)), {
          status: policyStatus,
        })
      : Response.json(confirmStatus === 200 ? documentRow : {}, { status: confirmStatus })
  );
  vi.stubGlobal('fetch', fetcher);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(profileId = documentProfileId) {
  await act(async () =>
    root.render(
      <DocumentUpload
        staff={false}
        profileId={profileId}
        replacement={null}
        onClose={closed}
        onUploaded={uploaded}
      />
    )
  );
}
async function click(text: string) {
  const button = [...host.querySelectorAll('button')].find(
    (element) => element.textContent === text
  );
  expect(button, text).toBeDefined();
  await act(async () => button!.click());
}
async function start(selected = file) {
  await render();
  const input = host.querySelector('input[type=file]')!;
  Object.defineProperty(input, 'files', { value: [selected], configurable: true });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  await click('Upload document');
  await click('Confirm action');
}
it('fails closed on policy loading errors and recovers before selecting a file', async () => {
  policyStatus = 503;
  await render();
  expect(host.textContent).toContain('Could not load upload limits');
  expect(host.querySelector<HTMLInputElement>('input[type=file]')?.disabled).toBe(true);
  policyStatus = 200;
  await click('Try again');
  expect(host.querySelector<HTMLInputElement>('input[type=file]')?.disabled).toBe(false);
});
it('shows actual progress and resumes the same direct reservation after pausing', async () => {
  await start();
  const first = UploadXHR.instances[0]!;
  await act(async () => first.progress(3));
  expect(host.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')).toBe('42');
  await click('Pause upload');
  expect(first.aborted).toBe(true);
  expect(host.textContent).toContain('proof.pdf');
  expect(fetcher.mock.calls.filter(([input]) => String(input).endsWith('/confirm'))).toHaveLength(
    0
  );
  await click('Resume upload');
  expect(UploadXHR.instances).toHaveLength(2);
  expect(UploadXHR.instances[1]!.url).toBe(first.url);
  await act(async () => UploadXHR.instances[1]!.complete(412));
  expect(uploaded).toHaveBeenCalledWith(documentRow);
  expect(harness.result).toBeDefined();
});
it('keeps a completed transfer across confirmation failure and reuses its idempotency key', async () => {
  confirmStatus = 503;
  await start();
  await act(async () => UploadXHR.instances[0]!.complete());
  expect(host.textContent).toContain('Upload did not finish');
  confirmStatus = 200;
  await click('Retry upload');
  expect(UploadXHR.instances).toHaveLength(1);
  const calls = fetcher.mock.calls.filter(([input]) => String(input).endsWith('/confirm'));
  expect(calls).toHaveLength(2);
  expect(calls[0]![1]?.body).toBe(calls[1]![1]?.body);
  expect(JSON.parse(String(calls[1]![1]?.body))).toMatchObject({
    expectedRevision: 1,
    idempotencyKey: expect.any(String),
  });
  expect(uploaded).toHaveBeenCalledOnce();
});
it('keeps a storage denial retryable without treating it as account denial', async () => {
  await start();
  await act(async () => UploadXHR.instances[0]!.complete(403));
  expect(host.textContent).toContain('proof.pdf');
  expect(host.textContent).toContain('Retry upload');
  await click('Retry upload');
  await act(async () => UploadXHR.instances[1]!.complete());
  expect(uploaded).toHaveBeenCalledOnce();
});
it('clears private selected work on account denial during confirmation', async () => {
  confirmStatus = 403;
  await start();
  await act(async () => UploadXHR.instances[0]!.complete());
  expect(host.textContent).not.toContain('proof.pdf');
  expect(host.querySelector('[role=progressbar]')).toBeNull();
  expect(uploaded).not.toHaveBeenCalled();
});
it('closing during transfer aborts bytes and cannot later confirm an abandoned selection', async () => {
  await start();
  const xhr = UploadXHR.instances[0]!;
  await click('Close upload');
  expect(xhr.aborted).toBe(true);
  xhr.complete();
  expect(closed).toHaveBeenCalledOnce();
  expect(uploaded).not.toHaveBeenCalled();
  expect(fetcher.mock.calls.filter(([input]) => String(input).endsWith('/confirm'))).toHaveLength(
    0
  );
});
it('scope changes discard the draft and abort the old profile transfer', async () => {
  await start();
  const xhr = UploadXHR.instances[0]!;
  await render('33333333-3333-4333-8333-333333333333');
  expect(xhr.aborted).toBe(true);
  expect(host.textContent).not.toContain('proof.pdf');
  xhr.complete();
  expect(uploaded).not.toHaveBeenCalled();
});
it('pausing confirmation ignores its late acknowledgement and retries only confirmation', async () => {
  let finish!: (value: Response) => void;
  fetcher.mockImplementation(async (input) =>
    String(input).includes('/policy/')
      ? Response.json(documentUploadPolicy())
      : new Promise<Response>((resolve) => {
          finish = resolve;
        })
  );
  await start();
  await act(async () => UploadXHR.instances[0]!.complete());
  expect(host.textContent).toContain('Verifying upload…');
  await click('Pause upload');
  await act(async () => finish(Response.json(documentRow)));
  expect(uploaded).not.toHaveBeenCalled();
  fetcher.mockImplementation(async () => Response.json(documentRow));
  await click('Resume upload');
  expect(UploadXHR.instances).toHaveLength(1);
  expect(uploaded).toHaveBeenCalledOnce();
});

it('clears a selected draft when policy reload reports account denial', async () => {
  await render();
  const input = host.querySelector('input[type=file]')!;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  expect(host.textContent).toContain('proof.pdf');
  policyStatus = 403;
  const category = host.querySelector('select')!;
  await act(async () => {
    category.value = 'image';
    category.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(host.textContent).not.toContain('proof.pdf');
  expect(host.querySelector('input[type=file]')).toBeNull();
});
it('uses the policy MIME for a browser file without a declared type and binds storage metadata to it', async () => {
  const untyped = new File(['%PDF-1.7'], 'proof.pdf');
  await start(untyped);
  expect(harness.action?.body).toMatchObject({ contentType: 'application/pdf' });
  expect(UploadXHR.instances[0]?.headers['Content-Type']).toBe('application/pdf');
  expect(UploadXHR.instances[0]?.body).toBe(untyped);
  await act(async () => UploadXHR.instances[0]!.complete());
  expect(uploaded).toHaveBeenCalledOnce();
});
