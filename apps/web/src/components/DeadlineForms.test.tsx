import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InvoiceDueAtPanel from './InvoiceDueAtPanel.js';
import ServiceDuePeriodPanel from './ServiceDuePeriodPanel.js';

vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({
    status: 'ready',
    timezone: 'Asia/Tehran',
    format: (value: string) => value,
    notice: null,
  }),
}));
const invoiceId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const periodId = '33333333-3333-4333-8333-333333333333';
const invoice = {
  invoiceId,
  state: 'Unpaid',
  issuedAt: '2026-09-01T10:00:00.000Z',
  payableFrom: '2026-09-01T10:00:00.000Z',
  dueAt: '2026-09-12T10:00:00.000Z',
  canOverride: true,
  dueAtOverride: null as null | { reason: string },
};
const defaults = () =>
  ['electricity', 'saving_plan', 'consultation', 'manual'].map((serviceType) => ({
    serviceType,
    defaultDays: 7,
    periodId: null as string | null,
    effectiveFrom: null as string | null,
    effectiveUntil: null,
  }));
const inputError = (fields: string[]) => ({
  error: { code: 'VALIDATION:INPUT:INVALID', fields, message: 'private server text' },
});
let root: Root, container: HTMLDivElement;
let readStatus: number,
  writeStatus: number,
  rows: ReturnType<typeof defaults>,
  source: typeof invoice,
  writeResult: unknown;
let commands: Array<{ url: string; body: unknown }>;
let pendingWrite: Promise<Response> | null;
function input(id: string) {
  return container.querySelector('#' + id) as HTMLInputElement;
}
async function fill(id: string, value: string) {
  await act(async () => {
    const el = input(id);
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit(id: string) {
  await act(async () => {
    input(id)
      .closest('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}
async function clickReload() {
  const button = Array.from(container.querySelectorAll('button')).find(
    (el) => el.textContent === 'Reload settings'
  )!;
  await act(async () => button.click());
  await vi.waitFor(() => expect(button.disabled).toBe(false));
}
async function deadline() {
  await act(async () => root.render(<InvoiceDueAtPanel selection={null} />));
  await fill('invoice-id', invoiceId);
  await submit('invoice-id');
  await vi.waitFor(() => expect(input('due-at')?.value).toBe('2026-09-12T13:30'));
}
async function period() {
  await act(async () => root.render(<ServiceDuePeriodPanel />));
  await vi.waitFor(() => expect(input('due-period-days')?.value).toBe('7'));
}
async function settled() {
  await vi.waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
}

beforeEach(() => {
  document.documentElement.lang = 'en';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  readStatus = 200;
  writeStatus = 400;
  rows = defaults();
  source = { ...invoice };
  commands = [];
  pendingWrite = null;
  writeResult = inputError(['reason']);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST' || init?.method === 'PUT') {
        commands.push({ url: String(url), body: JSON.parse(String(init.body)) });
        return pendingWrite ?? new Response(JSON.stringify(writeResult), { status: writeStatus });
      }
      return new Response(JSON.stringify(String(url).includes('/due-at') ? source : rows), {
        status: readStatus,
      });
    })
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('invoice deadline form ownership', () => {
  it('focuses invalid lookup without a read or losing raw text', async () => {
    await act(async () => root.render(<InvoiceDueAtPanel selection={null} />));
    await fill('invoice-id', ' raw bad ');
    await submit('invoice-id');
    await settled();
    expect(input('invoice-id').value).toBe(' raw bad ');
    expect(document.activeElement).toBe(input('invoice-id'));
    expect(input('invoice-id').getAttribute('aria-invalid')).toBe('true');
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['2026-09-12T13:30', '2026-08-31T13:30'])(
    'rejects unchanged or pre-issue deadline %s and keeps its companion',
    async (due) => {
      await deadline();
      await fill('due-at', due);
      await fill('override-reason', ' raw reason ');
      await submit('due-at');
      await settled();
      expect(commands).toEqual([]);
      await vi.waitFor(() => expect(document.activeElement).toBe(input('due-at')));
      expect(input('override-reason').value).toBe(' raw reason ');
    }
  );
  it('keeps unchanged drafts through failed reads and recovery; changed snapshots reset them', async () => {
    await deadline();
    await fill('due-at', '2026-09-20T13:30');
    await fill('override-reason', ' raw reason ');
    readStatus = 503;
    await submit('invoice-id');
    await settled();
    expect(input('override-reason').value).toBe(' raw reason ');
    expect(input('due-at').disabled).toBe(true);
    readStatus = 200;
    await submit('invoice-id');
    await settled();
    expect(input('due-at').value).toBe('2026-09-20T13:30');
    expect(input('due-at').disabled).toBe(false);
    source = { ...invoice, dueAt: '2026-09-24T10:00:00.000Z' };
    await submit('invoice-id');
    await settled();
    expect(input('due-at').value).toBe('2026-09-24T13:30');
    expect(input('override-reason').value).toBe('');
  });
  it('maps only owned metadata and never exposes server text', async () => {
    await deadline();
    await fill('due-at', '2026-09-20T13:30');
    await fill('override-reason', ' raw reason ');
    await submit('due-at');
    await settled();
    expect(input('override-reason').getAttribute('aria-invalid')).toBe('true');
    await vi.waitFor(() => expect(document.activeElement).toBe(input('override-reason')));
    expect(container.textContent).not.toContain('private server text');
    await fill('override-reason', ' corrected ');
    writeResult = inputError(['reason', 'expectedReviewHash']);
    await submit('due-at');
    await settled();
    expect(input('override-reason').value).toBe(' corrected ');
    expect(container.textContent).toContain('Failed to override due date');
    expect(container.textContent).not.toContain('private server text');
  });
  it('locks before validation, submits once, and refuses mismatched receipts', async () => {
    await deadline();
    await fill('due-at', '2026-09-20T13:30');
    await fill('override-reason', ' raw reason ');
    let resolve!: (value: Response) => void;
    pendingWrite = new Promise((done) => {
      resolve = done;
    });
    await submit('due-at');
    await vi.waitFor(() => expect(commands).toHaveLength(1));
    expect(input('invoice-id').disabled).toBe(true);
    expect(input('override-reason').disabled).toBe(true);
    await submit('due-at');
    expect(commands).toHaveLength(1);
    await act(async () =>
      resolve(new Response(JSON.stringify({ ...invoice, invoiceId: otherId })))
    );
    await settled();
    expect(container.textContent).not.toContain('Due date overridden');
    expect(input('override-reason').value).toBe(' raw reason ');
  });
  it('an unchanged post-save reload ignores acknowledgement-only audit metadata', async () => {
    await deadline();
    await fill('due-at', '2026-09-20T13:30');
    await fill('override-reason', ' original reason ');
    source = {
      ...invoice,
      dueAt: '2026-09-20T10:00:00.000Z',
      dueAtOverride: { reason: 'original reason' },
    };
    writeStatus = 200;
    writeResult = { ...source, auditId: 'acknowledgement-only-audit' };
    await submit('due-at');
    await settled();
    expect(container.textContent).toContain('Due date overridden');
    await fill('override-reason', ' new retained draft ');
    await submit('invoice-id');
    await settled();
    expect(input('override-reason').value).toBe(' new retained draft ');
  });
  it('ledger scope changes invalidate an in-flight receipt and private draft', async () => {
    await deadline();
    await fill('due-at', '2026-09-20T13:30');
    await fill('override-reason', ' old private reason ');
    let resolve!: (value: Response) => void;
    pendingWrite = new Promise((done) => {
      resolve = done;
    });
    await submit('due-at');
    await vi.waitFor(() => expect(commands).toHaveLength(1));
    await act(async () =>
      root.render(<InvoiceDueAtPanel selection={{ invoiceId: otherId, revision: 1 }} />)
    );
    await act(async () =>
      resolve(
        new Response(
          JSON.stringify({
            ...invoice,
            dueAt: '2026-09-20T10:00:00.000Z',
            dueAtOverride: { reason: 'old private reason' },
          })
        )
      )
    );
    expect(input('invoice-id').value).toBe(otherId);
    expect(input('override-reason')).toBeNull();
    expect(container.textContent).not.toContain('Due date overridden');
  });
  it.each(['read', 'write'])('denied %s clears private work', async (operation) => {
    await deadline();
    await fill('due-at', '2026-09-20T13:30');
    await fill('override-reason', ' private reason ');
    if (operation === 'read') {
      readStatus = 403;
      await submit('invoice-id');
    } else {
      writeStatus = 403;
      writeResult = { error: { code: 'AUTHZ:FORBIDDEN' } };
      await submit('due-at');
    }
    await settled();
    expect(input('override-reason')).toBeNull();
    expect(container.textContent).not.toContain('private reason');
    readStatus = 200;
    await submit('invoice-id');
    await settled();
    expect(input('override-reason').value).toBe('');
  });
});

describe('service due period form ownership', () => {
  it('validates localized days and focuses the linked field while keeping its service', async () => {
    await period();
    await fill('due-period-days', '۰');
    await submit('due-period-days');
    await settled();
    expect(commands).toEqual([]);
    await vi.waitFor(() => expect(document.activeElement).toBe(input('due-period-days')));
    expect(input('due-period-days').getAttribute('aria-invalid')).toBe('true');
    writeResult = inputError(['defaultDays']);
    await fill('due-period-days', '۱۴');
    await submit('due-period-days');
    await settled();
    expect(commands[0]?.body).toEqual({
      serviceType: 'electricity',
      defaultDays: 14,
      expectedPeriodId: null,
    });
    expect(input('due-period-days').value).toBe('۱۴');
  });
  it('retains raw days through failed unchanged reloads and resets on a new version', async () => {
    await period();
    await fill('due-period-days', '۱۴');
    readStatus = 503;
    await clickReload();
    expect(input('due-period-days').value).toBe('۱۴');
    expect(input('due-period-days').matches(':disabled')).toBe(true);
    readStatus = 200;
    await clickReload();
    expect(input('due-period-days').value).toBe('۱۴');
    expect(input('due-period-days').matches(':disabled')).toBe(false);
    rows[0] = { ...rows[0]!, periodId, defaultDays: 21, effectiveFrom: '2026-10-03T00:00:00Z' };
    await clickReload();
    expect(input('due-period-days').value).toBe('21');
  });
  it('owned errors focus days; mixed errors stay generic', async () => {
    await period();
    await fill('due-period-days', '۱۴');
    writeResult = inputError(['defaultDays']);
    await submit('due-period-days');
    await settled();
    await vi.waitFor(() => expect(document.activeElement).toBe(input('due-period-days')));
    expect(container.textContent).not.toContain('private server text');
    await fill('due-period-days', '۱۵');
    writeResult = inputError(['defaultDays', 'expectedPeriodId']);
    await submit('due-period-days');
    await settled();
    expect(input('due-period-days').value).toBe('۱۵');
    expect(container.textContent).toContain('The setting could not be confirmed');
  });
  it('prevents duplicate writes and refuses an acknowledgement for another service', async () => {
    await period();
    await fill('due-period-days', '۱۴');
    let resolve!: (value: Response) => void;
    pendingWrite = new Promise((done) => {
      resolve = done;
    });
    await submit('due-period-days');
    await vi.waitFor(() => expect(commands).toHaveLength(1));
    expect(input('due-period-days').matches(':disabled')).toBe(true);
    await submit('due-period-days');
    expect(commands).toHaveLength(1);
    await act(async () => resolve(new Response(JSON.stringify(rows))));
    await settled();
    expect(container.textContent).not.toContain('Default due period saved.');
    expect(input('due-period-days').value).toBe('۱۴');
  });
  it('requires refresh after a conflict, retaining the draft until its basis changes', async () => {
    await period();
    await fill('due-period-days', '14');
    writeStatus = 409;
    writeResult = {};
    await submit('due-period-days');
    await settled();
    expect(input('due-period-days').matches(':disabled')).toBe(true);
    await submit('due-period-days');
    expect(commands).toHaveLength(1);
    await clickReload();
    expect(input('due-period-days').value).toBe('14');
    expect(input('due-period-days').matches(':disabled')).toBe(false);
  });
  it('clears denied private work and recovers from authoritative settings', async () => {
    await period();
    await fill('due-period-days', '۱۴');
    writeStatus = 403;
    writeResult = { error: { code: 'AUTHZ:FORBIDDEN' } };
    await submit('due-period-days');
    await settled();
    expect(input('due-period-days')).toBeNull();
    await clickReload();
    expect(input('due-period-days').value).toBe('7');
  });
});
