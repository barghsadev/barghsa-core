import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { SolarRequestDetailPage } from './SolarRequestDetailPage.js';

vi.mock('@tanstack/react-router', () => ({ useParams: () => ({ requestId: 'request-1' }) }));
vi.mock('../components/DocumentsWorkspace.js', () => ({
  DocumentResults: () => <div>File list</div>,
}));
afterEach(() => vi.unstubAllGlobals());

it('allows an empty solar document set to be sent for review', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/solar/requests/request-1' && !options?.method)
      return new Response(
        JSON.stringify({
          request: {
            id: 'request-1',
            profile_id: 'profile-1',
            status: 'submitted',
            building_type: 'building_apartment',
            grid_type: 'off_grid',
            agreement_version: 'v1',
            agreement_snapshot: 'terms',
            agreement_accepted_at: new Date().toISOString(),
          },
        })
      );
    if (url === '/api/solar/requests/request-1/documents' && !options?.method)
      return new Response(
        JSON.stringify({
          guidance: { fa: 'راهنما', en: 'Upload relevant files', suggestions: [] },
          requestedDocuments: [],
        })
      );
    if (url === '/api/solar/requests/request-1/documents/complete' && options?.method === 'POST')
      return new Response(JSON.stringify({ status: 'documents_under_review' }));
    throw new Error(`Unexpected ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<SolarRequestDetailPage />));
    expect(container.textContent).toContain('Upload relevant files');
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const button = Array.from(container.querySelectorAll('button')).find(
      (item) => item.textContent === 'Send documents for review'
    )!;
    expect(button.disabled).toBe(true);
    await act(async () => checkbox.click());
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    const posted = fetchMock.mock.calls.find(
      ([url, options]) =>
        url === '/api/solar/requests/request-1/documents/complete' && options?.method === 'POST'
    );
    expect(JSON.parse(posted![1]!.body as string)).toEqual({ allDocumentsUploaded: true });
    expect(container.textContent).toContain('Document set sent for review.');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
