import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { StaffReceiptAttachmentPreview } from './StaffReceiptAttachmentPreview.js';
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const props = {
  url: 'https://storage.example.test/signed?token=example',
  label: 'Receipt scan',
  openLabel: 'Open original',
};
it.each(['proof.PNG', 'proof.jpeg', 'proof.webp'])(
  'previews signed images by attachment identity rather than URL suffix (%s)',
  async (attachmentKey) => {
    await act(async () =>
      root.render(<StaffReceiptAttachmentPreview {...props} attachmentKey={attachmentKey} />)
    );
    expect(host.querySelector('img')?.getAttribute('src')).toBe(props.url);
    expect(host.querySelector('img')?.getAttribute('alt')).toBe(props.label);
    expect(host.querySelector('a')?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(host.querySelector('iframe')).toBeNull();
  }
);
it('keeps the original link after image failure and retries a newly signed URL', async () => {
  await act(async () =>
    root.render(<StaffReceiptAttachmentPreview {...props} attachmentKey="receipt.png" />)
  );
  await act(async () => host.querySelector('img')!.dispatchEvent(new Event('error')));
  expect(host.querySelector('img')).toBeNull();
  expect(host.querySelector('a')?.href).toBe(props.url);
  const fresh = props.url + '&renewed=1';
  await act(async () =>
    root.render(
      <StaffReceiptAttachmentPreview {...props} url={fresh} attachmentKey="receipt.png" />
    )
  );
  expect(host.querySelector('img')?.getAttribute('src')).toBe(fresh);
});
it('provides a named PDF frame and an independent original link', async () => {
  await act(async () =>
    root.render(<StaffReceiptAttachmentPreview {...props} attachmentKey="proof.PDF" />)
  );
  expect(host.querySelector('iframe')?.title).toBe(props.label);
  expect(host.querySelector('iframe')?.getAttribute('src')).toBe(props.url);
  expect(host.querySelector('a')?.href).toBe(props.url);
});
it.each([null, undefined, 'proof.html', 'proof.pdf.html'])(
  'leaves unsupported or missing attachment types as links (%s)',
  async (attachmentKey) => {
    await act(async () =>
      root.render(<StaffReceiptAttachmentPreview {...props} attachmentKey={attachmentKey} />)
    );
    expect(host.querySelector('img,iframe')).toBeNull();
    expect(host.querySelector('a')?.textContent).toBe(props.openLabel);
  }
);
