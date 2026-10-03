import { act, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import Page from './AdminCataloguePage.js';
import type { TeamActionDialog } from '../components/TeamActionDialog.js';
import {
  catalogueBase as base,
  catalogueId as id,
  hardwareId,
  catalogueDetail,
  catalogueProduct,
  catalogueReferences,
  catalogueConfig,
  type CatalogueType,
} from '../test/catalogue-fixtures.js';
type DialogProps = Extract<ComponentProps<typeof TeamActionDialog>, { action: unknown }>;
let dialog: DialogProps | null = null;
vi.mock('./SavingAgreementEditor.js', () => ({ SavingAgreementEditor: () => null }));
vi.mock('../components/SavingInventoryPanel.js', () => ({ SavingInventoryPanel: () => null }));
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: (props: DialogProps) => {
    dialog = props;
    return (
      <div role="dialog">
        <button onClick={props.onClose}>Close confirmation</button>
      </div>
    );
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.lang = 'fa';
  dialog = null;
});
function button(host: ParentNode, name: string) {
  const found = Array.from(host.querySelectorAll('button')).find(
    (item) => (item.getAttribute('aria-label') || item.textContent) === name
  );
  expect(found, name).toBeDefined();
  return found!;
}
function fill(host: ParentNode, field: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`#catalogue-${field}`)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
async function mount(
  type: CatalogueType = 'consultation',
  read?: (url: string) => Response | undefined
) {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const overridden = read?.(url);
      if (overridden) return overridden;
      if (url.endsWith('/timezone')) return Response.json({ timezone: 'Asia/Tehran' });
      if (url.includes('?type=hardware') && type === 'saving_plan')
        return Response.json([catalogueProduct('hardware', hardwareId)]);
      if (url.includes('?type=')) return Response.json([catalogueProduct(type)]);
      if (url.endsWith('/rule-references')) return Response.json(catalogueReferences);
      if (url.endsWith('/configuration')) return Response.json(catalogueConfig);
      return Response.json(catalogueDetail(type));
    })
  );
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Page initialType={type} />));
  return {
    host,
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
async function submit(host: ParentNode, name = 'Save product') {
  await act(async () => button(host, name).click());
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(dialog).not.toBeNull();
  });
}
it('first invalid title receives focus, its message is linked, and no confirmation is proposed', async () => {
  const { host, close } = await mount();
  try {
    await act(async () => button(host, 'Add product').click());
    await act(async () => button(host, 'Save product').click());
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(host.querySelector('#catalogue-titleFa')).toBe(document.activeElement);
    });
    const input = host.querySelector('#catalogue-titleFa')!;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toContain(
      'Persian'
    );
    expect(dialog).toBeNull();
    await act(async () => fill(host, 'titleFa', 'محصول'));
    await act(async () => {
      await vi.waitFor(() => expect(input.getAttribute('aria-invalid')).toBeNull());
    });
  } finally {
    await close();
  }
});
it.each(['consultation', 'hardware', 'saving_plan', 'electricity'] as const)(
  '%s captures normalized values once and locks controls during confirmation',
  async (type) => {
    const { host, close } = await mount(type);
    try {
      await act(async () => button(host, 'Edit Sample product').click());
      await act(async () => fill(host, 'titleEn', '  Updated product  '));
      if (type === 'electricity') {
        await act(async () => fill(host, 'minKwh', ' ۹۰۰۷۱۹۹۲۵۴۷۴۰۹۹۳ '));
        await act(async () => fill(host, 'maxKwh', '۰'));
      }
      await submit(host);
      expect(dialog!.action.body).toMatchObject({ title: { en: 'Updated product' } });
      if (type === 'saving_plan')
        expect(dialog!.action.body).toHaveProperty('hardwareIds', [hardwareId]);
      if (type === 'electricity')
        expect(dialog!.action.body).toMatchObject({ minKwh: '9007199254740993', maxKwh: '0' });
      expect(host.querySelector('#catalogue-titleEn')!.matches(':disabled')).toBe(true);
      const command = dialog!.action;
      await act(async () =>
        host
          .querySelector('form')!
          .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      );
      expect(dialog!.action).toBe(command);
      await act(async () => button(host, 'Close confirmation').click());
      expect(host.querySelector<HTMLInputElement>('#catalogue-titleEn')?.value).toBe(
        '  Updated product  '
      );
    } finally {
      await close();
    }
  }
);
it('exact localized initial prices and trimmed titles are captured while creation remains inactive', async () => {
  const { host, close } = await mount('hardware');
  try {
    await act(async () => button(host, 'Add product').click());
    await act(async () => {
      fill(host, 'titleFa', ' محصول ');
      fill(host, 'titleEn', ' Product ');
      fill(host, 'initial-price', ' ۹۰۰۷۱۹۹۲۵۴۷۴۰۹۹۳ ');
    });
    await submit(host);
    expect(dialog!.action.body).toMatchObject({
      title: { fa: 'محصول', en: 'Product' },
      price: '9007199254740993',
      status: 'inactive',
    });
    await act(async () => {
      await expect(dialog!.onSuccess({})).rejects.toThrow('acknowledgement');
    });
    expect(dialog!.confirmationDisabled).toBe(true);
    await act(async () => button(host, 'Close confirmation').click());
    expect(button(host, 'Save product').disabled).toBe(true);
    expect(host.querySelector<HTMLInputElement>('#catalogue-initial-price')?.value).toBe(
      ' ۹۰۰۷۱۹۹۲۵۴۷۴۰۹۹۳ '
    );
    expect(host.textContent).toContain('review the catalogue');
  } finally {
    await close();
  }
});
it('owned server fields receive localized messages but hidden and protected fields remain general', async () => {
  const { host, close } = await mount();
  try {
    await act(async () => button(host, 'Edit Sample product').click());
    await submit(host);
    expect(dialog!.onValidationError?.(['type'])).toBe(false);
    expect(dialog!.onValidationError?.(['price'])).toBe(false);
    await act(async () => {
      expect(dialog!.onValidationError?.(['titleEn'])).toBe(true);
      dialog!.onClose();
    });
    await act(async () => {
      await vi.waitFor(() =>
        expect(host.querySelector('#catalogue-titleEn')).toBe(document.activeElement)
      );
    });
    expect(host.querySelector('#catalogue-titleEn')?.getAttribute('aria-invalid')).toBe('true');
  } finally {
    await close();
  }
});
it('failed or malformed detail refreshes retain drafts and successful unchanged retry preserves them', async () => {
  let mode: 'valid' | 'failed' | 'malformed' = 'valid';
  const { host, close } = await mount('consultation', (url) =>
    url === `${base}/${id}` && mode !== 'valid'
      ? mode === 'failed'
        ? new Response('{}', { status: 503 })
        : Response.json({ id })
      : undefined
  );
  try {
    await act(async () => button(host, 'Edit Sample product').click());
    await act(async () => fill(host, 'titleEn', 'Keep draft'));
    for (const value of ['failed', 'malformed'] as const) {
      mode = value;
      await act(async () => button(host, 'Refresh').click());
      expect(host.querySelector<HTMLInputElement>('#catalogue-titleEn')?.value).toBe('Keep draft');
      expect(button(host, 'Save product').disabled).toBe(true);
      mode = 'valid';
      await act(async () => button(host, 'Try again').click());
      expect(host.querySelector<HTMLInputElement>('#catalogue-titleEn')?.value).toBe('Keep draft');
      expect(button(host, 'Save product').disabled).toBe(false);
    }
  } finally {
    await close();
  }
});
it('changed rules cancel a pending confirmation and obsolete success cannot clear the new draft', async () => {
  let changed = false;
  const { host, close } = await mount('consultation', (url) =>
    url.endsWith('/rule-references')
      ? Response.json({ ...catalogueReferences, vatOverride: changed })
      : undefined
  );
  try {
    await act(async () => button(host, 'Edit Sample product').click());
    await submit(host);
    const obsolete = dialog!.onSuccess;
    changed = true;
    await act(async () => button(host, 'Refresh').click());
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => fill(host, 'titleEn', 'New basis draft'));
    await act(async () => obsolete(catalogueDetail()));
    expect(host.querySelector<HTMLInputElement>('#catalogue-titleEn')?.value).toBe(
      'New basis draft'
    );
    expect(host.textContent).not.toContain('Product saved');
  } finally {
    await close();
  }
});
it('withdrawn hardware cancels confirmation, remains visible and must be removed before resubmitting', async () => {
  let withdrawn = false;
  const { host, close } = await mount('saving_plan', (url) =>
    url.includes('?type=hardware') && withdrawn ? Response.json([]) : undefined
  );
  try {
    await act(async () => button(host, 'Edit Sample product').click());
    await submit(host);
    withdrawn = true;
    await act(async () => button(host, 'Refresh').click());
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector('#catalogue-hardwareIds')?.textContent).toContain(
      'Choice no longer available'
    );
    dialog = null;
    await act(async () => button(host, 'Save product').click());
    await act(async () => {
      await vi.waitFor(() =>
        expect(host.querySelector('#catalogue-hardwareIds')?.getAttribute('aria-invalid')).toBe(
          'true'
        )
      );
    });
    expect(dialog).toBeNull();
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(host.querySelector('#catalogue-hardwareIds')).toBe(document.activeElement);
    });
  } finally {
    await close();
  }
});
it('exact price proposals own only visible server fields and permission denial clears both editors', async () => {
  const { host, close } = await mount();
  try {
    await act(async () => button(host, 'Edit Sample product').click());
    await act(async () => button(host, 'Add price version').click());
    await act(async () => fill(host, 'price', ' ۹۰۰۷۱۹۹۲۵۴۷۴۰۹۹۳ '));
    await submit(host, 'Save price');
    expect(dialog!.action.body).toEqual({ price: '9007199254740993' });
    expect(dialog!.onValidationError?.(['date'])).toBe(false);
    await act(async () => dialog!.onDenied?.());
    expect(host.querySelector('form')).toBeNull();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.textContent).not.toContain('Sample product');
  } finally {
    await close();
  }
});

it('unchanged category selections survive registration without editing companion fields', async () => {
  const categories = ['electricity_generation_station_consultation'];
  const { host, close } = await mount('consultation', (url) =>
    url === `${base}?type=consultation`
      ? Response.json([{ ...catalogueProduct(), categories }])
      : url === `${base}/${id}`
        ? Response.json({ ...catalogueDetail(), categories })
        : undefined
  );
  try {
    await act(async () => button(host, 'Edit Sample product').click());
    await submit(host);
    expect(dialog!.action.body).toHaveProperty('categories', categories);
  } finally {
    await close();
  }
});

it('a missing scheduled date focuses the calendar trigger and exposes its linked error', async () => {
  const { host, close } = await mount();
  try {
    await act(async () => button(host, 'Edit Sample product').click());
    await act(async () => button(host, 'Add price version').click());
    await act(async () => fill(host, 'price', '123'));
    await act(async () =>
      host
        .querySelector<HTMLInputElement>('form[aria-label="Price editor"] input[type="checkbox"]')!
        .click()
    );
    await act(async () => button(host, 'Save price').click());
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(host.querySelector('#catalogue-date')).toBe(document.activeElement);
    });
    const date = host.querySelector('#catalogue-date')!;
    expect(date.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(date.getAttribute('aria-describedby')!)?.textContent).toContain(
      'Choose a valid date'
    );
    expect(dialog).toBeNull();
  } finally {
    await close();
  }
});
