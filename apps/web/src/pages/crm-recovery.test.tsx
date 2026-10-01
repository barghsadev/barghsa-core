import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Directory from './CrmProfileList.js';
import Corrections from './CrmCorrectionsPage.js';
import type { TeamAction } from '../components/TeamActionDialog.js';
import { useListQuery } from '../hooks/useListQuery.js';
import { crmCorrectionQueryOptions, crmCorrectionSearch } from '../lib/crm-correction-query.js';
import {
  crmUser,
  crmCase,
  crmCaseDetail,
  crmCorrectionProfile,
  crmQueue,
  crmProfileId,
  crmCaseId,
} from '../test/crm-recovery-fixtures.js';
const routeSearch = vi.hoisted(() => ({
  profileId: undefined as string | undefined,
  fieldName: undefined as string | undefined,
}));
const captured = vi.hoisted(() => ({
  action: null as TeamAction | null,
  success: null as ((value: unknown) => Promise<void>) | null,
  close: null as (() => void) | null,
  disabled: false,
}));
const clock = vi.hoisted(() => ({
  timezone: 'Asia/Tehran',
  status: 'ready' as 'ready' | 'loading' | 'error',
  retries: 0,
}));
vi.mock('@tanstack/react-router', () => ({ useSearch: () => routeSearch }));
vi.mock('../hooks/useTimezone.js', () => ({
  useTimezone: () => ({ ...clock, retry: () => clock.retries++ }),
}));
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: (props: {
    action: TeamAction;
    onSuccess: (value: unknown) => Promise<void>;
    onClose: () => void;
    confirmationDisabled: boolean;
  }) => {
    captured.action = props.action;
    captured.success = props.onSuccess;
    captured.close = props.onClose;
    captured.disabled = props.confirmationDisabled;
    return <div data-testid="confirmation">{props.action.title}</div>;
  },
}));
vi.mock('../lib/invoice-bank-receipt-upload.js', () => ({
  uploadVerificationEvidence: vi.fn(async () => 'verification-evidence/new'),
  isAllowedInvoiceReceiptFile: () => true,
}));
import { uploadVerificationEvidence } from '../lib/invoice-bank-receipt-upload.js';
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  document.documentElement.lang = 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  routeSearch.profileId = undefined;
  routeSearch.fieldName = undefined;
  clock.timezone = 'Asia/Tehran';
  clock.status = 'ready';
  clock.retries = 0;
  captured.action = null;
  vi.mocked(uploadVerificationEvidence).mockResolvedValue('verification-evidence/new');
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const directoryData = { users: [crmUser], cursor: 'page-two', hasMore: true };
const queuePath = '/api/crm/verification-cases?';
const detailPath = `/api/crm/verification-cases/${crmCaseId}`;
const profilePath = `/api/crm/profiles/${crmProfileId}`;
const acknowledgement = {
  success: true,
  id: crmCaseId,
  profileId: crmProfileId,
  status: 'Approved',
};
function mock(read: (path: string) => Response | Promise<Response>) {
  const fn = vi.fn(async (url: RequestInfo | URL) => read(String(url)));
  vi.stubGlobal('fetch', fn);
  return fn;
}
const baseData = (path: string) =>
  String(path).startsWith(queuePath)
    ? crmQueue
    : path === detailPath
      ? crmCaseDetail
      : crmCorrectionProfile;
async function render(corrections = true) {
  await act(async () => root.render(corrections ? <Corrections /> : <Directory />));
}
async function click(text: string) {
  const node = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text
  );
  expect(node, text).toBeDefined();
  await act(async () => node!.click());
}
async function fill(selector: string, value: string) {
  const node = host.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    selector
  )!;
  expect(node, selector).not.toBeNull();
  await act(async () => {
    const proto =
      node instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : node instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(node, value);
    node.dispatchEvent(
      new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })
    );
  });
}
async function creationDraft() {
  await fill('#correction-field', 'last_name');
  await fill('#correction-value', 'New name');
  await fill('#correction-reason', 'Checked document');
  const input = host.querySelector<HTMLInputElement>('#correction-files')!;
  await act(async () => {
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['x'], 'evidence.pdf', { type: 'application/pdf' })],
    });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
const confirmation = () => host.querySelector('[data-testid="confirmation"]');
const note = () => host.querySelector<HTMLTextAreaElement>('#case-notes')?.value;
let navigateQueue: (raw: Record<string, unknown>) => void;
let queueSearch: Record<string, unknown>;
let replaceNavigation: boolean | undefined;
function BoundCorrections() {
  const [raw, setRaw] = useState<Record<string, unknown>>({});
  navigateQueue = setRaw;
  queueSearch = raw;
  const queries = useListQuery(crmCorrectionQueryOptions, raw, (update, options) => {
    replaceNavigation = options?.replace;
    setRaw((current) => crmCorrectionSearch(update(current)));
  });
  return <Corrections queries={queries} />;
}
async function boundQueue() {
  replaceNavigation = undefined;
  await act(async () => root.render(<BoundCorrections />));
}
it.each([false, true])(
  'bound queue retries exact pages and retains independent creation drafts (profile=%s)',
  async (profile) => {
    if (profile) routeSearch.profileId = crmProfileId;
    let failed = true;
    const reads = mock((path) =>
      response(
        { ...baseData(path), ...(path.startsWith(queuePath) ? { total: 41 } : {}) },
        path.includes('offset=20') && failed ? 503 : 200
      )
    );
    await boundQueue();
    if (profile) await creationDraft();
    await click('Review case');
    await fill('#case-notes', 'Private review');
    await click('Next');
    expect(queueSearch.page).toBe(2);
    expect(note()).toBeUndefined();
    expect(host.textContent).toContain('Corrected');
    const failedRead = reads.mock.calls.at(-1)![0];
    failed = false;
    await click('Retry correction queue');
    expect(reads.mock.calls.at(-1)![0]).toBe(failedRead);
    if (profile) {
      expect(host.querySelector<HTMLInputElement>('#correction-value')!.value).toBe('New name');
      expect(host.querySelector<HTMLInputElement>('#correction-files')!.files![0]!.name).toBe(
        'evidence.pdf'
      );
      expect(reads.mock.calls.filter(([path]) => path === profilePath)).toHaveLength(1);
    }
    await fill('#case-status', 'Approved');
    expect(queueSearch.status).toBe('Approved');
    expect(queueSearch.page).toBeUndefined();
    expect(String(reads.mock.calls.at(-1)![0])).toContain('offset=0');
  }
);
it('history invalidates review receipts and closes without disturbing newer work', async () => {
  const reads = mock((path) =>
    response({ ...baseData(path), ...(path.startsWith(queuePath) ? { total: 41 } : {}) })
  );
  await boundQueue();
  await click('Review case');
  await fill('#case-notes', 'Old notes');
  await click('Review decision');
  const obsoleteSuccess = captured.success!,
    obsoleteClose = captured.close!;
  await act(async () => navigateQueue({ page: 2 }));
  expect(confirmation()).toBeNull();
  expect(note()).toBeUndefined();
  await click('Review case');
  await fill('#case-notes', 'New notes');
  await click('Review decision');
  const before = reads.mock.calls.length;
  await act(async () => {
    obsoleteClose();
    await obsoleteSuccess(acknowledgement);
  });
  expect(confirmation()).not.toBeNull();
  expect(note()).toBe('New notes');
  expect(reads).toHaveBeenCalledTimes(before);
  expect(queueSearch.page).toBe(2);
});
it('a valid creation receipt refreshes the current history page and keeps its route', async () => {
  routeSearch.profileId = crmProfileId;
  const reads = mock((path) =>
    response({ ...baseData(path), ...(path.startsWith(queuePath) ? { total: 41 } : {}) })
  );
  await boundQueue();
  await creationDraft();
  await click('Upload evidence and review request');
  const success = captured.success!;
  await act(async () => navigateQueue({ page: 2, status: 'Approved' }));
  expect(confirmation()).not.toBeNull();
  await act(async () => success({ ...acknowledgement, status: 'Open' }));
  expect(confirmation()).toBeNull();
  expect(queueSearch).toEqual({ page: 2, status: 'Approved' });
  const latest = new URL(String(reads.mock.calls.at(-1)![0]), 'https://example.test').searchParams;
  expect(latest.get('offset')).toBe('20');
  expect(latest.get('status')).toBe('Approved');
  expect(host.querySelector<HTMLInputElement>('#correction-value')!.value).toBe('');
});
it('shrinking queue replaces the invalid page instead of adding history', async () => {
  mock((path) =>
    response({ ...baseData(path), ...(path.startsWith(queuePath) ? { total: 1 } : {}) })
  );
  await boundQueue();
  await act(async () => navigateQueue({ page: 7 }));
  expect(queueSearch.page).toBeUndefined();
  expect(replaceNavigation).toBe(true);
});
it('an obsolete queue response cannot repair the current history page', async () => {
  let release: (value: Response) => void;
  mock((path) =>
    path.includes('offset=20')
      ? new Promise<Response>((resolve) => {
          release = resolve;
        })
      : response(
          path.startsWith(queuePath)
            ? {
                ...crmQueue,
                total: 61,
                cases: [
                  {
                    ...crmCase,
                    requestedValue: path.includes('offset=40') ? 'Current history' : 'First page',
                  },
                ],
              }
            : baseData(path)
        )
  );
  await boundQueue();
  await act(async () => navigateQueue({ page: 2 }));
  await act(async () => navigateQueue({ page: 3 }));
  expect(host.textContent).toContain('Current history');
  await act(async () => release(response({ ...crmQueue, total: 1 })));
  expect(queueSearch.page).toBe(3);
  expect(host.textContent).toContain('Current history');
});
it('directory retains expanded profiles through failed cursor navigation and retries the exact page', async () => {
  let fail = false;
  const reads = mock((path) =>
    response(directoryData, path.includes('cursor=') && fail ? 503 : 200)
  );
  await render(false);
  await click('Profiles: 1');
  fail = true;
  await click('Next');
  expect(host.textContent).toContain('Customer profile');
  expect(host.querySelectorAll('table')).toHaveLength(1);
  const failed = reads.mock.calls.at(-1)![0];
  fail = false;
  await click('Retry users');
  expect(reads.mock.calls.at(-1)![0]).toBe(failed);
  expect(host.textContent).toContain('Customer profile');
});
it('directory filter changes hide prior results while malformed refresh retains the accepted scope', async () => {
  let malformed = false;
  mock(() => response(malformed ? { ...directoryData, users: 'bad' } : directoryData));
  await render(false);
  malformed = true;
  await click('Refresh');
  expect(host.textContent).toContain(crmUser.username);
  await fill('#crm-type', 'LEGAL');
  expect(host.textContent).not.toContain(crmUser.username);
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
});
it('directory timezone failure retains expansion and timezone retry does not fetch until ready', async () => {
  const reads = mock(() => response(directoryData));
  await render(false);
  await click('Profiles: 1');
  clock.status = 'error';
  await render(false);
  const before = reads.mock.calls.length;
  await click('Retry timezone');
  expect(clock.retries).toBe(1);
  expect(reads).toHaveBeenCalledTimes(before);
  expect(host.textContent).toContain('Customer profile');
  clock.status = 'ready';
  await render(false);
  expect(host.textContent).toContain('Customer profile');
});
it('directory permission denial removes rows and search until explicit recovery', async () => {
  let denied = false;
  mock(() => response(directoryData, denied ? 403 : 200));
  await render(false);
  await click('Profiles: 1');
  await fill('#crm-search', 'private draft');
  denied = true;
  await click('Refresh');
  expect(host.textContent).not.toContain(crmUser.username);
  expect(host.querySelector<HTMLInputElement>('#crm-search')!.value).toBe('');
  expect(host.textContent).toContain('Access denied');
  denied = false;
  await click('Refresh');
  expect(host.textContent).toContain(crmUser.username);
});
it('queue recovery retains case notes and reads only the failed queue', async () => {
  let fail = false;
  const reads = mock((path) =>
    response(baseData(path), String(path).startsWith(queuePath) && fail ? 503 : 200)
  );
  await render();
  await click('Review case');
  await fill('#case-notes', 'Keep explanation');
  fail = true;
  await click('Refresh');
  expect(note()).toBe('Keep explanation');
  const detailCount = reads.mock.calls.filter(([path]) => path === detailPath).length;
  fail = false;
  await click('Retry correction queue');
  expect(reads.mock.calls.filter(([path]) => path === detailPath)).toHaveLength(detailCount);
  expect(note()).toBe('Keep explanation');
  await click('Review decision');
  expect(captured.action?.body).toEqual({
    decision: 'Approved',
    reviewerNotes: 'Keep explanation',
  });
});
it('retained confirmation pauses on detail failure and recovers locally with unchanged evidence', async () => {
  let fail = false;
  const reads = mock((path) => response(baseData(path), path === detailPath && fail ? 503 : 200));
  await render();
  await click('Review case');
  await fill('#case-notes', 'Keep explanation');
  await click('Review decision');
  fail = true;
  await click('Refresh');
  expect(confirmation()).not.toBeNull();
  expect(captured.disabled).toBe(true);
  const queueCount = reads.mock.calls.filter(([path]) => String(path).startsWith(queuePath)).length;
  // Stub dialog has no summary controls, so the page's local detail retry is used.
  fail = false;
  await click('Retry case details');
  expect(reads.mock.calls.filter(([path]) => String(path).startsWith(queuePath))).toHaveLength(
    queueCount
  );
  expect(captured.disabled).toBe(false);
  expect(note()).toBe('Keep explanation');
});
it('changed queue eligibility clears confirmation and ignores obsolete completion', async () => {
  let changed = false;
  mock((path) =>
    response(
      String(path).startsWith(queuePath) && changed
        ? { ...crmQueue, cases: [{ ...crmCase, status: 'Approved' }] }
        : baseData(path)
    )
  );
  await render();
  await click('Review case');
  await fill('#case-notes', 'Old decision');
  await click('Review decision');
  const oldSuccess = captured.success!;
  changed = true;
  await click('Refresh');
  expect(confirmation()).toBeNull();
  expect(host.querySelector('#case-notes')).toBeNull();
  changed = false;
  await click('Refresh');
  await click('Review case');
  await fill('#case-notes', 'New explanation');
  await act(async () => oldSuccess(acknowledgement));
  expect(note()).toBe('New explanation');
  expect(host.textContent).not.toContain('Change saved.');
});
it('case display-name and rotating evidence links preserve the valid frozen action', async () => {
  let changed = false;
  mock((path) =>
    response(
      changed && String(path).startsWith(queuePath)
        ? { ...crmQueue, cases: [{ ...crmCase, assignedName: 'New name' }] }
        : changed && path === detailPath
          ? {
              ...crmCaseDetail,
              evidenceDownloadUrls: ['https://storage.example.test/fixed?fresh=1'],
            }
          : baseData(path)
    )
  );
  await render();
  await click('Review case');
  await fill('#case-notes', 'Keep');
  await click('Review decision');
  const command = captured.action;
  changed = true;
  await click('Refresh');
  expect(captured.action).toBe(command);
  expect(captured.disabled).toBe(false);
  expect(note()).toBe('Keep');
});
it('changed fixed evidence invalidates confirmation but retains case notes', async () => {
  let changed = false;
  mock((path) =>
    response(
      changed && path === detailPath
        ? { ...crmCaseDetail, evidenceUrls: ['verification-evidence/replaced'] }
        : baseData(path)
    )
  );
  await render();
  await click('Review case');
  await fill('#case-notes', 'Review again');
  await click('Review decision');
  changed = true;
  await click('Refresh');
  expect(confirmation()).toBeNull();
  expect(note()).toBe('Review again');
});
it('queue denial clears review work while correction-only profile access remains usable', async () => {
  routeSearch.profileId = crmProfileId;
  let denyQueue = false;
  mock((path) =>
    response(baseData(path), String(path).startsWith(queuePath) && denyQueue ? 403 : 200)
  );
  await render();
  await creationDraft();
  await click('Review case');
  await fill('#case-notes', 'Private');
  denyQueue = true;
  await click('Refresh');
  expect(host.querySelector('#case-notes')).toBeNull();
  expect(host.querySelector<HTMLInputElement>('#correction-value')!.value).toBe('New name');
  await click('Upload evidence and review request');
  expect(captured.action?.body).toMatchObject({
    fieldName: 'last_name',
    requestedValue: 'New name',
    evidenceUrls: ['verification-evidence/new'],
  });
});
it('profile recovery retains creation fields/files and retries without rereading the queue', async () => {
  routeSearch.profileId = crmProfileId;
  let fail = false;
  const reads = mock((path) => response(baseData(path), path === profilePath && fail ? 503 : 200));
  await render();
  await creationDraft();
  const fileInput = host.querySelector('#correction-files');
  fail = true;
  await click('Refresh');
  expect(host.querySelector('#correction-files')).toBe(fileInput);
  await fill('#correction-value', 'Edited during retry');
  const count = reads.mock.calls.filter(([path]) => String(path).startsWith(queuePath)).length;
  fail = false;
  await click('Retry profile access');
  expect(reads.mock.calls.filter(([path]) => String(path).startsWith(queuePath))).toHaveLength(
    count
  );
  await click('Upload evidence and review request');
  expect(captured.action?.body).toMatchObject({
    requestedValue: 'Edited during retry',
    fieldName: 'last_name',
    reason: 'Checked document',
  });
});
it('unmounted upload cannot reopen confirmation on a newly restricted profile', async () => {
  routeSearch.profileId = crmProfileId;
  let allowed = true;
  mock((path) =>
    response(
      path === profilePath
        ? { ...crmCorrectionProfile, viewerPermissions: { canEditIdentity: allowed } }
        : baseData(path)
    )
  );
  let finish!: (value: string) => void;
  vi.mocked(uploadVerificationEvidence).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await creationDraft();
  await click('Upload evidence and review request');
  // Remount a restricted profile before the old upload resolves.
  allowed = false;
  await act(async () => root.unmount());
  root = createRoot(host);
  await render();
  await act(async () => finish('verification-evidence/obsolete'));
  expect(confirmation()).toBeNull();
  expect(host.querySelector('#correction-value')).toBeNull();
});
it('queue authentication denial clears creation and review and wins against an older detail response', async () => {
  routeSearch.profileId = crmProfileId;
  let denyQueue = false;
  let finish!: (value: Response) => void;
  mock((path) =>
    path === detailPath
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : response(baseData(path), denyQueue && String(path).startsWith(queuePath) ? 401 : 200)
  );
  await render();
  await creationDraft();
  await click('Review case');
  denyQueue = true;
  await click('Refresh');
  await act(async () => finish(response(crmCaseDetail)));
  expect(host.textContent).toContain('Access denied');
  expect(host.textContent).not.toContain('Corrected');
  expect(host.querySelector('#correction-value')).toBeNull();
  expect(host.querySelector('#case-notes')).toBeNull();
});
it('changed queue actor invalidates private review and creation drafts', async () => {
  routeSearch.profileId = crmProfileId;
  let changed = false;
  mock((path) =>
    response(
      changed && String(path).startsWith(queuePath)
        ? { ...crmQueue, viewer: { ...crmQueue.viewer, userId: 'other-reviewer' } }
        : baseData(path)
    )
  );
  await render();
  await creationDraft();
  await click('Review case');
  await fill('#case-notes', 'Private');
  await click('Review decision');
  changed = true;
  await click('Refresh');
  expect(confirmation()).toBeNull();
  expect(host.querySelector('#case-notes')).toBeNull();
  expect(host.querySelector<HTMLInputElement>('#correction-value')!.value).toBe('');
});
it('failed queue page retains rows and exact offset while clearing off-page review', async () => {
  let fail = false;
  const reads = mock((path) =>
    response(
      String(path).startsWith(queuePath)
        ? {
            ...crmQueue,
            total: 21,
            cases: path.includes('offset=20')
              ? [{ ...crmCase, id: '33333333-3333-4333-8333-333333333333' }]
              : [crmCase],
          }
        : baseData(path),
      fail && path.includes('offset=20') ? 503 : 200
    )
  );
  await render();
  await click('Review case');
  await fill('#case-notes', 'Keep across page');
  fail = true;
  await click('Next');
  expect(note()).toBeUndefined();
  expect(host.textContent).toContain('Corrected');
  const failed = reads.mock.calls.at(-1)![0];
  fail = false;
  await click('Retry correction queue');
  expect(reads.mock.calls.at(-1)![0]).toBe(failed);
  expect(note()).toBeUndefined();
  expect(host.querySelector('#case-decision')).toBeNull();
});
it('malformed queue and detail retain accepted work while blocking confirmation', async () => {
  let malformed = false;
  mock((path) =>
    response(
      malformed
        ? String(path).startsWith(queuePath)
          ? { ...crmQueue, total: 'bad' }
          : path === detailPath
            ? { ...crmCaseDetail, id: crmProfileId }
            : baseData(path)
        : baseData(path)
    )
  );
  await render();
  await click('Review case');
  await fill('#case-notes', 'Keep');
  await click('Review decision');
  malformed = true;
  await click('Refresh');
  expect(confirmation()).not.toBeNull();
  expect(note()).toBe('Keep');
  expect(captured.disabled).toBe(true);
  expect(host.querySelectorAll('[role="alert"]')).toHaveLength(2);
});
it('review save does not erase an independent correction creation draft', async () => {
  routeSearch.profileId = crmProfileId;
  mock((path) => response(baseData(path)));
  await render();
  await creationDraft();
  await click('Review case');
  await fill('#case-notes', 'Verified');
  await click('Review decision');
  await act(async () => captured.success!(acknowledgement));
  expect(host.querySelector<HTMLInputElement>('#correction-value')!.value).toBe('New name');
  expect(host.querySelector<HTMLSelectElement>('#correction-field')!.value).toBe('last_name');
  expect(host.textContent).toContain('Change saved.');
});

it('fresh profile eligibility invalidates frozen creation and clears private fields', async () => {
  routeSearch.profileId = crmProfileId;
  let allowed = true;
  mock((path) =>
    response(
      path === profilePath
        ? { ...crmCorrectionProfile, viewerPermissions: { canEditIdentity: allowed } }
        : baseData(path)
    )
  );
  await render();
  await creationDraft();
  await click('Upload evidence and review request');
  const oldSuccess = captured.success!;
  allowed = false;
  await click('Refresh');
  expect(confirmation()).toBeNull();
  expect(host.querySelector('#correction-value')).toBeNull();
  await act(async () => oldSuccess({ ...acknowledgement, status: 'Open' }));
  expect(host.textContent).not.toContain('Change saved.');
});
it('a shrinking correction queue returns to the last valid offset', async () => {
  let shrunk = false;
  const reads = mock((path) =>
    response(
      String(path).startsWith(queuePath)
        ? {
            ...crmQueue,
            total: shrunk ? 1 : 21,
            cases: path.includes('offset=20') && shrunk ? [] : [crmCase],
          }
        : baseData(path)
    )
  );
  await render();
  await click('Next');
  shrunk = true;
  await click('Refresh');
  expect(
    new URL(String(reads.mock.calls.at(-1)![0]), 'https://example.test').searchParams.get('offset')
  ).toBe('0');
  expect(host.textContent).toContain('Corrected');
});

it('reselecting the same failed case reloads detail and permits review after recovery', async () => {
  let failures = 2;
  const reads = mock((path) =>
    response(
      path === detailPath && failures-- > 0
        ? { ...crmCaseDetail, id: crmProfileId }
        : baseData(path)
    )
  );
  await render();
  await click('Review case');
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  await click('Review case');
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  await click('Review case');
  expect(host.textContent).toContain('Original');
  expect(reads.mock.calls.filter(([path]) => path === detailPath)).toHaveLength(3);
});

it('legal profile denial and recovery restores an eligible identity field', async () => {
  routeSearch.profileId = crmProfileId;
  let denied = false;
  mock((path) =>
    response(
      path === profilePath
        ? {
            ...crmCorrectionProfile,
            profile: { ...crmCorrectionProfile.profile, profileType: 'LEGAL' },
          }
        : baseData(path),
      denied && path === profilePath ? 403 : 200
    )
  );
  await render();
  expect(host.querySelector<HTMLSelectElement>('#correction-field')!.value).toBe('legal_name');
  denied = true;
  await click('Refresh');
  expect(host.querySelector('#correction-field')).toBeNull();
  denied = false;
  await click('Refresh');
  expect(host.querySelector<HTMLSelectElement>('#correction-field')!.value).toBe('legal_name');
});
it('changed actor resets a legal creation draft to a valid field', async () => {
  routeSearch.profileId = crmProfileId;
  let changed = false;
  mock((path) =>
    response(
      path === profilePath
        ? {
            ...crmCorrectionProfile,
            profile: { ...crmCorrectionProfile.profile, profileType: 'LEGAL' },
          }
        : changed && String(path).startsWith(queuePath)
          ? { ...crmQueue, viewer: { ...crmQueue.viewer, userId: 'other-reviewer' } }
          : baseData(path)
    )
  );
  await render();
  await fill('#correction-field', 'national_identifier');
  await fill('#correction-value', 'Private identifier');
  changed = true;
  await click('Refresh');
  expect(host.querySelector<HTMLInputElement>('#correction-value')!.value).toBe('');
  expect(host.querySelector<HTMLSelectElement>('#correction-field')!.value).toBe('legal_name');
});

it('the localized evidence button opens the native picker without submitting the form', async () => {
  routeSearch.profileId = crmProfileId;
  mock((path) => response(baseData(path)));
  await render();
  const input = host.querySelector<HTMLInputElement>('#correction-files')!;
  const open = vi.spyOn(input, 'click').mockImplementation(() => {});
  expect(input.hidden).toBe(true);
  await click('Choose evidence files');
  expect(open).toHaveBeenCalledOnce();
  expect(confirmation()).toBeNull();
});
