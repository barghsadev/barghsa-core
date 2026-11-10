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
  previewUrl: '/api/admin/invoices/bank-receipts/receipt/attachment-preview',
  label: 'Receipt scan',
  openLabel: 'Open original',
};
it('shows only the raster preview inline and links the signed original separately', async () => {
  await act(async () => root.render(<StaffReceiptAttachmentPreview {...props} />));
  expect(host.querySelector('img')?.getAttribute('src')).toBe(props.previewUrl);
  expect(host.querySelector('img')?.getAttribute('alt')).toBe(props.label);
  expect(host.querySelector('img')?.getAttribute('referrerpolicy')).toBe('no-referrer');
  expect(host.querySelector('a')?.getAttribute('rel')).toBe('noopener noreferrer');
  expect(host.querySelector('a')?.href).toBe(props.url);
  expect(host.querySelector('iframe,object,embed')).toBeNull();
});
it.each([
  'data:text/html,<script>alert(1)</script>',
  'file:///tmp/receipt.pdf',
  'javascript:alert(1)',
  'https://user:password@storage.example.test/signed',
])('keeps the safe raster preview without linking an invalid original %s', async (url) => {
  await act(async () => root.render(<StaffReceiptAttachmentPreview {...props} url={url} />));
  expect(host.querySelector('img')?.getAttribute('src')).toBe(props.previewUrl);
  expect(host.querySelector('a')).toBeNull();
});
it('keeps the original link when the preview fails and shows a newly selected preview', async () => {
  await act(async () => root.render(<StaffReceiptAttachmentPreview {...props} />));
  await act(async () => host.querySelector('img')!.dispatchEvent(new Event('error')));
  expect(host.querySelector('img,iframe,object,embed')).toBeNull();
  expect(host.querySelector('a')?.href).toBe(props.url);
  expect(host.querySelector('a')?.textContent).toBe(props.openLabel);
  const renewed = props.url + '&renewed=1';
  await act(async () => root.render(<StaffReceiptAttachmentPreview {...props} url={renewed} />));
  expect(host.querySelector('img')?.getAttribute('src')).toBe(props.previewUrl);
  expect(host.querySelector('a')?.href).toBe(renewed);
  await act(async () => host.querySelector('img')!.dispatchEvent(new Event('error')));
  const fresh = '/api/admin/invoices/bank-receipts/another/attachment-preview';
  await act(async () =>
    root.render(<StaffReceiptAttachmentPreview {...props} previewUrl={fresh} />)
  );
  expect(host.querySelector('img')?.getAttribute('src')).toBe(fresh);
});
