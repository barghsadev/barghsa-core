import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { AdminSolarDocumentsPage } from './AdminSolarDocumentsPage.js';
import { AdminSolarPostalPage } from './AdminSolarPostalPage.js';

vi.mock('../components/DocumentDetail.js', () => ({
  DocumentDetail: ({ id }: { id: string }) => <div data-testid="preview">{id}</div>,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.lang = 'fa';
});

for (const [name, Page, path] of [
  ['documents', AdminSolarDocumentsPage, '/api/admin/solar/requests'],
  ['postal', AdminSolarPostalPage, '/api/admin/solar/postal-queue'],
] as const) {
  it(`keeps earlier solar ${name} work visible after loading another page`, async () => {
    document.documentElement.lang = 'en';
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        const more = new URL(url, 'http://localhost').searchParams.has('before');
        const id = more ? 'older-work' : 'first-work';
        const payload = url.includes('document-review-queue')
          ? { documents: [], nextBefore: null }
          : url.includes('guidance')
            ? name === 'documents'
              ? { fa: 'راهنما', en: 'Guidance', suggestions: [] }
              : {
                  fa: 'راهنما',
                  en: 'Guidance',
                  destinationAddress: '',
                  contactDetails: '',
                  originals: [],
                }
            : {
                requests: [
                  name === 'documents'
                    ? {
                        id,
                        profile_id: 'profile-1',
                        profile_name: 'Customer One',
                        status: id,
                        building_type: 'building_apartment',
                        document_count: 0,
                        created_at: '2026-09-23T10:00:00Z',
                      }
                    : {
                        id,
                        profile_id: 'profile-1',
                        profile_name: 'Customer One',
                        request_status: 'waiting_for_postal_submission',
                        postal_status: 'waiting_for_shipment',
                        courier: null,
                        tracking_number: null,
                        send_date: null,
                        receipt_image_id: null,
                        staff_notes: null,
                        created_at: '2026-09-23T10:00:00Z',
                      },
                ],
                nextBefore: more ? null : 'first-work',
              };
        return new Response(JSON.stringify(payload), {
          headers: { 'Content-Type': 'application/json' },
        });
      })
    );
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(<Page />));
      expect(container.textContent).toContain('first-work');
      const button = Array.from(container.querySelectorAll('button')).find(
        (candidate) => candidate.textContent?.trim() === 'More requests'
      );
      expect(button).toBeDefined();
      await act(async () => button?.click());
      expect(container.textContent).toContain('first-work');
      expect(container.textContent).toContain('older-work');
      expect(container.textContent).toContain('Customer One');
      expect(calls).toContain(
        name === 'postal'
          ? `${path}?lane=needs_staff&before=first-work`
          : `${path}?before=first-work`
      );
      if (name === 'postal') {
        const select = container.querySelector<HTMLSelectElement>('#solar-postal-lane')!;
        await act(async () => {
          select.value = 'waiting_customer';
          select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        expect(calls).toContain(`${path}?lane=waiting_customer`);
        expect(container.textContent).not.toContain('older-work');
      }
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
}

it('shows individual pending solar files with uploader, time and another page', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      const older = new URL(url, 'http://localhost').searchParams.has('before');
      const payload = url.endsWith('/requests/request-1/documents')
        ? {
            request: { id: 'request-1', status: 'documents_under_review' },
            documents: [],
            requestedDocuments: [],
          }
        : url.includes('document-review-queue')
          ? {
              documents: [
                {
                  id: older ? 'older-file' : 'first-file',
                  request_id: 'request-1',
                  document_id: 'document-1',
                  file_name: older ? 'older.pdf' : 'first.pdf',
                  uploaded_by: 'customer-1',
                  uploaded_by_name: 'customer@example.test',
                  uploaded_at: '2026-09-23T10:00:00Z',
                  staff_status: 'pending',
                },
              ],
              nextBefore: older ? null : 'first-file',
            }
          : url.includes('guidance')
            ? { fa: 'راهنما', en: 'Guidance', suggestions: [] }
            : { requests: [], nextBefore: null };
      return new Response(JSON.stringify(payload), {
        headers: { 'Content-Type': 'application/json' },
      });
    })
  );
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<AdminSolarDocumentsPage />));
    expect(container.textContent).toContain('first.pdf');
    expect(container.textContent).toContain('customer@example.test');
    expect(container.textContent).toContain('Pending review');
    const more = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'More files'
    );
    await act(async () => more?.click());
    expect(container.textContent).toContain('first.pdf');
    expect(container.textContent).toContain('older.pdf');
    expect(calls).toContain('/api/admin/solar/document-review-queue?before=first-file');
    const firstFile = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('first.pdf')
    );
    await act(async () => firstFile?.click());
    expect(container.querySelector('[data-testid="preview"]')?.textContent).toBe('document-1');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
