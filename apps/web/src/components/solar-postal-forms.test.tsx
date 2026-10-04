import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ErrorCodes } from '@barghsa/shared/errors';
import { tSolar } from '@barghsa/i18n/solar';
import { SolarPostalPanel } from './SolarPostalPanel.js';
const requestId = '11111111-1111-4111-8111-111111111111',
  profileId = '22222222-2222-4222-8222-222222222222';
const guidance = {
  fa: 'راهنما',
  en: 'Guidance',
  destinationAddress: '',
  contactDetails: '',
  originals: [],
};
const state = (status = 'waiting_for_shipment', courier: string | null = null) => ({
  requestStatus: 'waiting_for_postal_submission',
  guidance,
  postal: {
    status,
    courier,
    tracking_number: courier ? 'TRACK' : null,
    send_date: courier ? '2026-01-02' : null,
    receipt_image_id: null,
    staff_notes: null,
  },
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.lang = 'fa';
});
async function mount(handler: (url: string, options?: RequestInit) => Promise<Response>) {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(handler));
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const render = async (profile = profileId) =>
    act(async () => root.render(<SolarPostalPanel requestId={requestId} profileId={profile} />));
  await render();
  const fill = async (id: string, value: string) =>
    act(async () => {
      const input = container.querySelector<HTMLInputElement>(`#${id}`)!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  const submit = async () =>
    act(async () =>
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
  const reload = async () =>
    act(async () =>
      [...container.querySelectorAll('button')]
        .find((item) => item.textContent?.trim() === tSolar('postalTrackingReload', 'en'))!
        .click()
    );
  const fillValid = async () => {
    await fill('solar-postal-courier', ' Courier ');
    await fill('solar-postal-tracking-number', ' TRACK ');
    await fill('solar-postal-send-date', '2026-01-02');
  };
  return {
    container,
    render,
    fill,
    fillValid,
    submit,
    reload,
    close: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}
const images = () => Response.json({ documents: [], nextBefore: null });
it('focuses owned shipment validation while preserving valid fields and accepting only public server identifiers', async () => {
  const writes: unknown[] = [];
  const view = await mount(async (url, options) => {
    if (options?.method === 'POST') {
      writes.push(JSON.parse(String(options.body)));
      return Response.json(
        {
          error: {
            code: ErrorCodes.VALIDATION_INPUT_INVALID.code,
            fields: ['trackingNumber'],
            message: 'private backend text',
          },
        },
        { status: 400 }
      );
    }
    return url.includes('/postal') ? Response.json(state()) : images();
  });
  try {
    await view.fill('solar-postal-tracking-number', 'TRACK');
    await view.fill('solar-postal-send-date', '2026-01-02');
    await view.submit();
    await vi.waitFor(() =>
      expect(
        view.container.querySelector('#solar-postal-courier')?.getAttribute('aria-invalid')
      ).toBe('true')
    );
    await vi.waitFor(() => expect(document.activeElement?.id).toBe('solar-postal-courier'));
    expect(writes).toEqual([]);
    await view.fill('solar-postal-courier', ' Courier ');
    await view.submit();
    await vi.waitFor(() => expect(document.activeElement?.id).toBe('solar-postal-tracking-number'));
    expect(writes).toEqual([
      { courier: 'Courier', trackingNumber: 'TRACK', sendDate: '2026-01-02' },
    ]);
    expect(view.container.querySelector<HTMLInputElement>('#solar-postal-courier')?.value).toBe(
      ' Courier '
    );
    expect(view.container.textContent).not.toContain('private backend text');
  } finally {
    await view.close();
  }
});
it('locks a lost shipment response until a fresh matching authorized read without replaying a mismatched shipment', async () => {
  let writes = 0,
    mode = 'waiting';
  const view = await mount(async (url, options) => {
    if (options?.method === 'POST') {
      writes++;
      return new Response('{}', { status: 503 });
    }
    return url.includes('/postal')
      ? Response.json(
          mode === 'waiting'
            ? state()
            : state('shipped', mode === 'matching' ? 'Courier' : 'Other courier')
        )
      : images();
  });
  try {
    await view.fillValid();
    await view.submit();
    await vi.waitFor(() =>
      expect(view.container.textContent).toContain(tSolar('postalShipmentUnconfirmed', 'en'))
    );
    expect(view.container.querySelector<HTMLInputElement>('#solar-postal-courier')?.disabled).toBe(
      true
    );
    await view.submit();
    expect(writes).toBe(1);
    await view.reload();
    expect(view.container.querySelector<HTMLInputElement>('#solar-postal-courier')?.value).toBe(
      ' Courier '
    );
    expect(view.container.querySelector<HTMLInputElement>('#solar-postal-courier')?.disabled).toBe(
      true
    );
    await view.submit();
    expect(writes).toBe(1);
    mode = 'mismatch';
    await view.reload();
    expect(view.container.querySelector<HTMLInputElement>('#solar-postal-courier')?.value).toBe(
      ' Courier '
    );
    expect(view.container.querySelector<HTMLInputElement>('#solar-postal-courier')?.disabled).toBe(
      true
    );
    mode = 'matching';
    await view.reload();
    await vi.waitFor(() => expect(view.container.querySelector('form')).toBeNull());
    expect(writes).toBe(1);
    expect(view.container.textContent).not.toContain(tSolar('postalShipmentUnconfirmed', 'en'));
  } finally {
    await view.close();
  }
});
it('suppresses same-tick submits and stale settlement when only the profile scope changes', async () => {
  let release: ((value: Response) => void) | undefined;
  const writes: unknown[] = [];
  const view = await mount(async (url, options) => {
    if (options?.method === 'POST') {
      writes.push(JSON.parse(String(options.body)));
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    }
    return url.includes('/postal') ? Response.json(state()) : images();
  });
  try {
    await view.fillValid();
    await act(async () => {
      const form = view.container.querySelector('form')!;
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    await view.render('33333333-3333-4333-8333-333333333333');
    await view.fill('solar-postal-courier', 'New scope draft');
    await act(async () => release!(Response.json({ status: 'shipped' })));
    expect(view.container.querySelector<HTMLInputElement>('#solar-postal-courier')?.value).toBe(
      'New scope draft'
    );
    expect(view.container.textContent).not.toContain(tSolar('postalShipmentUnconfirmed', 'en'));
  } finally {
    await view.close();
  }
});
it.each([true, false])(
  'preserves the shipment draft after a 409 and permits retry only for a well-formed rejection (%s)',
  async (definitive) => {
    let writes = 0;
    const view = await mount(async (url, options) => {
      if (options?.method === 'POST') {
        writes++;
        return Response.json(
          definitive
            ? {
                error: {
                  code: 'CONFLICT',
                  message: 'Private conflict text',
                  correlationId: requestId,
                },
              }
            : {},
          { status: 409 }
        );
      }
      return url.includes('/postal') ? Response.json(state()) : images();
    });
    try {
      await view.fillValid();
      await view.submit();
      await vi.waitFor(() =>
        expect(view.container.textContent).toContain(
          tSolar(definitive ? 'postalError' : 'postalShipmentUnconfirmed', 'en')
        )
      );
      expect(view.container.querySelector<HTMLInputElement>('#solar-postal-courier')?.value).toBe(
        ' Courier '
      );
      expect(
        view.container.querySelector<HTMLInputElement>('#solar-postal-courier')?.disabled
      ).toBe(!definitive);
      await view.submit();
      await vi.waitFor(() => expect(writes).toBe(definitive ? 2 : 1));
      expect(view.container.textContent).not.toContain('Private conflict text');
    } finally {
      await view.close();
    }
  }
);
it.each(['authority404', 'malformed-read'] as const)(
  'withdraws old private shipment data on %s',
  async (mode) => {
    let posted = false;
    const view = await mount(async (url, options) => {
      if (options?.method === 'POST') {
        posted = true;
        return mode === 'authority404'
          ? new Response('{}', { status: 404 })
          : Response.json({ status: 'shipped' });
      }
      return url.includes('/postal')
        ? posted
          ? Response.json({ malformed: true })
          : Response.json(state('incomplete', 'Old private courier'))
        : images();
    });
    try {
      await view.fillValid();
      await view.submit();
      await vi.waitFor(() =>
        expect(view.container.textContent).toContain(tSolar('postalLoadError', 'en'))
      );
      expect(view.container.querySelector('form')).toBeNull();
      expect(view.container.textContent).not.toContain('Old private courier');
    } finally {
      await view.close();
    }
  }
);
it('recovers available receipt choices after a denied postal read while preserving the shipment draft', async () => {
  let reads = 0,
    imageReads = 0;
  const view = await mount(async (url) => {
    if (url.includes('/postal')) {
      reads++;
      return reads === 2 ? new Response('{}', { status: 403 }) : Response.json(state());
    }
    imageReads++;
    return Response.json({
      documents: [
        {
          id: requestId,
          originalName: 'receipt.png',
          state: 'Available',
          uploadedByType: 'customer',
        },
      ],
      nextBefore: null,
    });
  });
  try {
    await view.fill('solar-postal-courier', 'Retained courier');
    await view.reload();
    expect(view.container.querySelector('form')).toBeNull();
    await view.reload();
    await vi.waitFor(() =>
      expect(
        view.container.querySelector(`#solar-postal-receipt-image option[value="${requestId}"]`)
      ).not.toBeNull()
    );
    expect(imageReads).toBeGreaterThan(1);
    expect(view.container.querySelector<HTMLInputElement>('#solar-postal-courier')?.value).toBe(
      'Retained courier'
    );
  } finally {
    await view.close();
  }
});
