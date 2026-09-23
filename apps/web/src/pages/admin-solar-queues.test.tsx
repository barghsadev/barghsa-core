import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { AdminSolarDocumentsPage } from './AdminSolarDocumentsPage.js';
import { AdminSolarPostalPage } from './AdminSolarPostalPage.js';

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
        const payload = url.includes('guidance')
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
                      status: id,
                      building_type: 'building_apartment',
                      document_count: 0,
                    }
                  : {
                      id,
                      profile_id: 'profile-1',
                      request_status: 'waiting_for_postal_submission',
                      postal_status: 'waiting_for_shipment',
                      courier: null,
                      tracking_number: null,
                      send_date: null,
                      receipt_image_id: null,
                      staff_notes: null,
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
      expect(calls).toContain(`${path}?before=first-work`);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
}
