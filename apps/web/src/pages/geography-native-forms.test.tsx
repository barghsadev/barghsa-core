import { act } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { geographyText } from '@barghsa/i18n/geography';
import { ErrorCodes } from '@barghsa/shared/errors';
import { GeographyDialog, type GeographyModal } from './AdminGeographyDialog.js';
import { CitiesPanel } from './AdminCitiesPanel.js';
import { recoveryProvince as province } from '../test/geography-recovery-fixtures.js';

let host: HTMLDivElement, root: Root, trigger: HTMLButtonElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  trigger = document.createElement('button');
  document.body.append(host, trigger);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  trigger.remove();
  vi.unstubAllGlobals();
  document.documentElement.lang = 'en';
});
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const feedback = (fields: unknown[]) =>
  response(
    {
      error: {
        code: ErrorCodes.VALIDATION_INPUT_INVALID.code,
        fields,
        message: 'private server detail',
      },
    },
    400
  );
const input = (id: string) =>
  document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)!;
async function fill(id: string, value: string) {
  const node = input(id);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      node instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      'value'
    )!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const form = () => document.querySelector<HTMLFormElement>('[role=dialog] form')!;
async function submit() {
  await act(async () =>
    form().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}
async function settled(check: () => void) {
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((done) => setTimeout(done, 0));
    });
    check();
  });
}
async function click(name: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (node) => node.textContent?.trim() === name
  )!;
  expect(button).toBeDefined();
  await act(async () => button.click());
}

for (const locale of ['en', 'fa'] as const) {
  const t = (key: Parameters<typeof geographyText>[0]) => geographyText(key, locale);
  it(`links invalid names, focuses the field and preserves raw input (${locale})`, async () => {
    document.documentElement.lang = locale;
    const requests = vi.fn();
    vi.stubGlobal('fetch', requests);
    await act(async () =>
      root.render(
        <GeographyDialog
          modal={{ kind: 'add', province: null, trigger }}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      )
    );
    await fill('province-name-en', '  Tehran  ');
    await submit();
    await settled(() => {
      expect(input('province-name-fa').getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(input('province-name-fa'));
    });
    expect(input('province-name-fa').getAttribute('aria-invalid')).toBe('true');
    const errorId = input('province-name-fa').getAttribute('aria-describedby')!;
    expect(document.getElementById(errorId)?.textContent).toBe(t('invalidFa'));
    expect(input('province-name-en').value).toBe('  Tehran  ');
    expect(requests).not.toHaveBeenCalled();
    await fill('province-name-fa', 'تهران');
    await fill('province-name-en', 'x'.repeat(101));
    await submit();
    await settled(() => expect(document.activeElement).toBe(input('province-name-en')));
    expect(
      document.getElementById(input('province-name-en').getAttribute('aria-describedby')!)
        ?.textContent
    ).toBe(t('nameLength'));
    expect(requests).not.toHaveBeenCalled();
  });
  it(`locks duplicate creation and maps owned rejection without clearing draft (${locale})`, async () => {
    document.documentElement.lang = locale;
    let finish!: (result: Response) => void;
    const requests = vi.fn(
      (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Promise<Response>((done) => {
          finish = done;
        })
    );
    const saved = vi.fn();
    vi.stubGlobal('fetch', requests);
    await act(async () =>
      root.render(
        <GeographyDialog
          modal={{ kind: 'add', province: null, trigger }}
          onClose={vi.fn()}
          onSaved={saved}
        />
      )
    );
    await fill('province-name-fa', '  تهران  ');
    await fill('province-name-en', '  Tehran  ');
    await act(async () => {
      form().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(requests).toHaveBeenCalledTimes(1));
    });
    expect(JSON.parse(String(requests.mock.calls[0]?.[1]?.body))).toEqual({
      nameFa: 'تهران',
      nameEn: 'Tehran',
    });
    expect(document.querySelector<HTMLFieldSetElement>('fieldset')!.disabled).toBe(true);
    await submit();
    expect(requests).toHaveBeenCalledTimes(1);
    await act(async () => finish(feedback(['nameEn'])));
    await settled(() => expect(document.activeElement).toBe(input('province-name-en')));
    expect(input('province-name-fa').value).toBe('  تهران  ');
    expect(input('province-name-en').value).toBe('  Tehran  ');
    expect(document.body.textContent).not.toContain('private server detail');
    requests.mockResolvedValue(response(province));
    await submit();
    await settled(() => expect(saved).toHaveBeenCalledTimes(1));
  });
  it(`validates the city import limit and maps cities feedback to the raw rows (${locale})`, async () => {
    document.documentElement.lang = locale;
    const commands: RequestInit[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') {
          commands.push(init);
          return feedback(['cities']);
        }
        return response({ cities: [], total: 0 });
      })
    );
    await act(async () => root.render(<CitiesPanel province={province} />));
    await click(t('importCities'));
    await fill('city-import-rows', Array.from({ length: 201 }, () => 'شهر\tCity').join('\n'));
    await submit();
    await settled(() =>
      expect(input('city-import-rows').getAttribute('aria-invalid')).toBe('true')
    );
    expect(document.activeElement).toBe(input('city-import-rows'));
    expect(commands).toHaveLength(0);
    const draft = '  شهر نخست\t First City  \n شهر دوم\t Second City  ';
    await fill('city-import-rows', draft);
    await submit();
    await settled(() => expect(commands).toHaveLength(1));
    await settled(() => expect(document.activeElement).toBe(input('city-import-rows')));
    expect(JSON.parse(String(commands[0]!.body))).toEqual({
      cities: [
        { nameFa: 'شهر نخست', nameEn: 'First City' },
        { nameFa: 'شهر دوم', nameEn: 'Second City' },
      ],
    });
    expect(input('city-import-rows').value).toBe(draft);
    expect(document.body.textContent).not.toContain('private server detail');
  });
  it(`keeps unowned create status feedback as a generic form error (${locale})`, async () => {
    document.documentElement.lang = locale;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => feedback(['status']))
    );
    await act(async () =>
      root.render(
        <GeographyDialog
          modal={{ kind: 'add', province: null, trigger }}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      )
    );
    await fill('province-name-fa', 'تهران');
    await fill('province-name-en', 'Tehran');
    await submit();
    await settled(() =>
      expect(document.querySelector('#province-error')?.textContent).toBe(t('requestFailed'))
    );
    expect(input('province-name-en').getAttribute('aria-invalid')).not.toBe('true');
    expect(document.body.textContent).not.toContain('private server detail');
  });
}

it('retires validation before a catalogue pause and retains the draft without issuing a command', async () => {
  const requests = vi.fn();
  vi.stubGlobal('fetch', requests);
  const modal: GeographyModal = { kind: 'add', province: null, trigger };
  const render = (ready: boolean) => (
    <GeographyDialog modal={modal} readReady={ready} onClose={vi.fn()} onSaved={vi.fn()} />
  );
  await act(async () => root.render(render(true)));
  await fill('province-name-fa', 'تهران');
  await fill('province-name-en', '  Tehran  ');
  await act(async () => {
    form().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    flushSync(() => root.render(render(false)));
  });
  await settled(() => expect(form().getAttribute('aria-busy')).toBe('false'));
  expect(requests).not.toHaveBeenCalled();
  expect(input('province-name-en').value).toBe('  Tehran  ');
});
