import { act } from 'react';
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
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
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
