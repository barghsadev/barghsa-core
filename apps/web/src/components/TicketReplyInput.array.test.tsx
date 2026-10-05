import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TicketReplyInput } from './TicketReplyInput.js';
import type * as ReceiptUpload from '../lib/invoice-bank-receipt-upload.js';

const upload = vi.hoisted(() => vi.fn());
vi.mock('../lib/invoice-bank-receipt-upload.js', async (actual) => ({
  ...(await actual<typeof ReceiptUpload>()),
  uploadTicketReplyAttachment: upload,
}));
let host: HTMLDivElement, root: Root;
const payloads: Array<{ attachments: string[]; submissionId: string; body: string }> = [];
const first = new File(['%PDF-'], 'first.pdf', { type: 'application/pdf' });
const second = new File(['%PDF-'], 'second.pdf', { type: 'application/pdf' });
const bodyChange = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  payloads.length = 0;
  upload.mockReset().mockImplementation(async (file: File) => `${file.name}-key`);
  bodyChange.mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(busy = false) {
  await act(async () =>
    root.render(
      <TicketReplyInput
        ticketId="ticket"
        profileId={null}
        locale="en"
        staff={false}
        busy={busy}
        body=" Retained reply "
        onBodyChange={bodyChange}
        internal={false}
        onInternalChange={() => {}}
        onSubmit={async (prepare) => {
          payloads.push(await prepare());
          return false;
        }}
      />
    )
  );
}
async function choose(files: File[]) {
  const input = host.querySelector<HTMLInputElement>('input[type=file]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}
async function submit() {
  await act(async () => {
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.dynamicImportSettled();
  });
}
it('sends reordered attachment keys, reuses verified uploads and rotates the submission ID only for changed content', async () => {
  await render();
  await choose([first, second]);
  await act(async () => host.querySelector<HTMLButtonElement>('[data-array-action=down]')!.click());
  await submit();
  await submit();
  expect(payloads[0]?.attachments).toEqual(['second.pdf-key', 'first.pdf-key']);
  expect(payloads[1]).toEqual(payloads[0]);
  expect(upload).toHaveBeenCalledTimes(2);
  expect(upload.mock.calls.map(([file]) => file)).toEqual([second, first]);
  await act(async () => host.querySelector<HTMLButtonElement>('[data-array-action=down]')!.click());
  await submit();
  expect(payloads[2]?.attachments).toEqual(['first.pdf-key', 'second.pdf-key']);
  expect(payloads[2]?.submissionId).not.toBe(payloads[0]?.submissionId);
  expect(upload).toHaveBeenCalledTimes(2);
  expect(bodyChange).not.toHaveBeenCalled();
});
it('returns keyboard focus to the retained reply when its last attachment is removed', async () => {
  await render();
  await choose([first]);
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-array-action=remove]')!.click()
  );
  expect(host.querySelectorAll('[role=listitem]')).toHaveLength(0);
  expect(document.activeElement).toBe(host.querySelector('textarea'));
  expect(bodyChange).not.toHaveBeenCalled();
});
it('removes the matching upload receipt and preserves other files through invalid additions and transaction locks', async () => {
  await render();
  await choose([first, second]);
  await submit();
  await choose([new File(['bad'], 'bad.exe')]);
  expect(host.querySelector('[role=alert]')).not.toBeNull();
  expect(host.querySelectorAll('[role=listitem]')).toHaveLength(2);
  await render(true);
  await choose([new File(['%PDF-'], 'late.pdf', { type: 'application/pdf' })]);
  const remove = host.querySelector<HTMLButtonElement>('[data-array-action=remove]')!;
  expect(remove.disabled).toBe(true);
  await act(async () => remove.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(host.querySelectorAll('[role=listitem]')).toHaveLength(2);
  await render();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-array-action=remove]')!.click()
  );
  expect(host.querySelector('[role=alert]')).toBeNull();
  await choose([first]);
  await submit();
  expect(payloads.at(-1)?.attachments).toEqual(['second.pdf-key', 'first.pdf-key']);
  expect(upload).toHaveBeenCalledTimes(3);
  expect(upload.mock.calls.at(-1)?.[0]).toBe(first);
  expect(bodyChange).not.toHaveBeenCalled();
});
it('a later accepted original reply clears its owning public branch while preserving the internal draft and attachment', async () => {
  let accepted!: () => void;
  function Harness() {
    const [drafts, setDrafts] = useState({
      public: ' Public draft ',
      internal: ' Internal draft ',
    });
    const [internal, setInternal] = useState(false);
    const branch = internal ? 'internal' : 'public';
    return (
      <TicketReplyInput
        ticketId="ticket"
        profileId={null}
        locale="en"
        staff
        busy={false}
        body={drafts[branch]}
        onBodyChange={(body, visibility) =>
          setDrafts((old) => ({ ...old, [visibility ?? branch]: body }))
        }
        internal={internal}
        onInternalChange={setInternal}
        onSubmit={async (prepare, _fields, onAccepted) => {
          payloads.push(await prepare());
          accepted = onAccepted!;
          return false;
        }}
      />
    );
  }
  await act(async () => root.render(<Harness />));
  await choose([first]);
  const toggle = host.querySelector<HTMLInputElement>('input[type=checkbox]')!;
  await act(async () => toggle.click());
  await choose([second]);
  await act(async () => toggle.click());
  await submit();
  expect(payloads[0]).toMatchObject({
    body: 'Public draft',
    visibility: 'public',
    attachments: ['first.pdf-key'],
  });
  expect(host.querySelector('textarea')!.value).toBe(' Public draft ');
  await act(async () => toggle.click());
  await act(async () => accepted());
  expect(host.querySelector('textarea')!.value).toBe(' Internal draft ');
  expect(host.textContent).toContain('second.pdf');
  await act(async () => toggle.click());
  expect(host.querySelector('textarea')!.value).toBe('');
  expect(host.textContent).not.toContain('first.pdf');
  await act(async () => toggle.click());
  await submit();
  expect(payloads[1]).toMatchObject({
    body: 'Internal draft',
    visibility: 'internal',
    attachments: ['second.pdf-key'],
  });
  expect(upload).toHaveBeenCalledTimes(2);
});
it('native double submission uploads once and sends the raw body/files captured before an awaited upload', async () => {
  let finish!: (key: string) => void;
  upload.mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await choose([first]);
  await act(async () => {
    const form = host.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.dynamicImportSettled();
  });
  expect(upload).toHaveBeenCalledOnce();
  await render(true);
  await choose([second]);
  expect(host.textContent).toContain('first.pdf');
  expect(host.textContent).not.toContain('second.pdf');
  await act(async () => finish('first.pdf-key'));
  expect(payloads).toHaveLength(1);
  expect(payloads[0]).toMatchObject({ body: 'Retained reply', attachments: ['first.pdf-key'] });
  expect(bodyChange).not.toHaveBeenCalled();
});
