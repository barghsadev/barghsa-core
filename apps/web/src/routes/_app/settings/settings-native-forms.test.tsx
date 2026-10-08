import { QueryProvider } from '../../../test/query-provider.js';
import { act, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Route as ProfileRoute } from './profile.js';
import { Route as AddressesRoute } from './addresses.js';
import { AccountUserProvider } from '../../../hooks/useAccountUser.js';
import { useSavedAddressSettingsEditor } from '../../../hooks/useSavedAddressSettingsEditor.js';
import { tSettingsForms } from '@barghsa/i18n/settings-forms';
import { t as crmText } from '@barghsa/i18n/crm';
import { t } from '@barghsa/i18n/app';
import type { SavedAddress, SettingsProfile } from '../../../lib/settings-form.js';

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({
    options,
    useSearch: () => ({ returnTo: '/electricity/advanced' }),
  }),
  Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
const profileId = '11111111-1111-4111-8111-111111111111',
  provinceId = '22222222-2222-4222-8222-222222222222',
  cityId = '33333333-3333-4333-8333-333333333333';
const address: SavedAddress = {
  id: '44444444-4444-4444-8444-444444444444',
  profileId,
  provinceId,
  cityId,
  fullAddress: 'Saved main address',
  postalCode: '1234567890',
  mainAddress: true,
  createdAt: '2026-10-05T01:00:00Z',
  updatedAt: '2026-10-05T01:00:00Z',
};
const legal: SettingsProfile = {
  id: profileId,
  profileType: 'LEGAL',
  isDefault: true,
  status: 'ACTIVE',
  title: 'Company',
  firstName: null,
  lastName: null,
  nationalId: null,
  canEditIdentity: false,
  createdAt: address.createdAt,
  updatedAt: address.updatedAt,
  addresses: [address],
  legalInfo: {
    legalName: 'Current company',
    nationalIdentifier: '12345678901',
    registrationNumber: '42',
    companyTypeId: 'private-joint-stock',
    economicCode: null,
    representativeTitle: 'Manager',
    representativeRelationship: 'Director',
  },
};
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.lang = 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  document.documentElement.lang = 'fa';
});
async function mount(surface: 'profile' | 'addresses', actor = 'owner') {
  const Page = (surface === 'profile' ? ProfileRoute : AddressesRoute).options
    .component as ComponentType;
  await act(async () =>
    root.render(
      <QueryProvider>
        {
          <AccountUserProvider value={actor}>
            <Page />
          </AccountUserProvider>
        }
      </QueryProvider>
    )
  );
}
function button(parent: ParentNode, label: string) {
  const found = Array.from(parent.querySelectorAll<HTMLButtonElement>('button')).find(
    (item) => item.textContent === label || item.getAttribute('aria-label') === label
  );
  expect(found, label).toBeDefined();
  return found!;
}
async function change(selector: string, value: string) {
  const field = document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    selector
  )!;
  const prototype =
    field.tagName === 'SELECT'
      ? HTMLSelectElement.prototype
      : field.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(
      new Event(field.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })
    );
  });
}
async function submit(slot: string) {
  await act(async () => {
    document
      .querySelector<HTMLFormElement>('[data-slot=' + slot + ']')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.dynamicImportSettled();
  });
}
function data(path: string, profile = legal) {
  if (path === '/api/profiles')
    return { profiles: [profile], activeProfileId: profileId, hasDefault: true };
  if (path === '/api/profiles/' + profileId) return profile;
  if (path.endsWith('/addresses')) return { addresses: profile.addresses };
  if (path === '/api/geography/provinces')
    return [{ id: provinceId, nameFa: 'تهران', nameEn: 'Tehran' }];
  if (path.includes('/cities'))
    return [{ id: cityId, provinceId, nameFa: 'تهران', nameEn: 'Tehran' }];
  if (path.includes('/documents/')) return { documents: [] };
  throw new Error('Unexpected read ' + path);
}

it('validates native legal fields before confirmation and preserves the address draft through owning server feedback', async () => {
  const writes: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method) {
        writes.push(JSON.parse(String(init.body)));
        return Response.json(
          { error: { code: 'VALIDATION:INPUT:INVALID', fields: ['legalName'] } },
          { status: 400 }
        );
      }
      return Response.json(data(path));
    })
  );
  await mount('profile');
  await change('#profile-legalName', '   ');
  await change('#profile-address', '  Retained companion address  ');
  await submit('settings-profile-form');
  expect(writes).toHaveLength(0);
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(document.activeElement).toBe(host.querySelector('#profile-legalName'));
  expect(host.querySelector('#profile-legalName')?.getAttribute('aria-describedby')).toContain(
    'profile-legalName-message'
  );
  await change('#profile-legalName', '  New company  ');
  await submit('settings-profile-form');
  expect(writes).toHaveLength(0);
  await act(async () =>
    button(document.querySelector('[role=dialog]')!, crmText('settings.profile.save', 'en')).click()
  );
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({
    legalName: 'New company',
    fullAddress: 'Retained companion address',
  });
  expect(document.activeElement).toBe(host.querySelector('#profile-legalName'));
  expect(host.querySelector<HTMLInputElement>('#profile-legalName')?.value).toBe('  New company  ');
  expect(host.querySelector<HTMLTextAreaElement>('#profile-address')?.value).toBe(
    '  Retained companion address  '
  );
  expect(host.textContent).toContain(tSettingsForms('legalNameInvalid', 'en'));
});

it('retains the original profile draft after a valid projection and divergent detail, then confirms by read without another PUT', async () => {
  const writes: Record<string, unknown>[] = [];
  let confirmMatches = false,
    docReads = 0;
  const saved = { ...legal, legalInfo: { ...legal.legalInfo!, legalName: 'New company' } };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method) {
        writes.push(JSON.parse(String(init.body)));
        const {
          id,
          profileType,
          isDefault,
          status,
          title,
          firstName,
          lastName,
          nationalId,
          updatedAt,
        } = saved;
        return Response.json({
          id,
          profileType,
          isDefault,
          status,
          title,
          firstName,
          lastName,
          nationalId,
          updatedAt,
        });
      }
      if (path.includes('/documents/')) docReads++;
      return Response.json(data(path, confirmMatches ? saved : legal));
    })
  );
  await mount('profile');
  await change('#profile-legalName', '  New company  ');
  await submit('settings-profile-form');
  const before = docReads;
  await act(async () => {
    button(host, t('onboarding.documents.refresh', 'en')).dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    );
  });
  expect(docReads).toBe(before);
  await act(async () =>
    button(document.querySelector('[role=dialog]')!, crmText('settings.profile.save', 'en')).click()
  );
  expect(writes).toHaveLength(1);
  expect(host.querySelector<HTMLInputElement>('#profile-legalName')?.disabled).toBe(true);
  expect(host.querySelector<HTMLInputElement>('#profile-legalName')?.value).toBe('  New company  ');
  expect(document.body.textContent).toContain(tSettingsForms('confirmationMismatch', 'en'));
  confirmMatches = true;
  await act(async () =>
    button(
      document.querySelector('[role=dialog]')!,
      tSettingsForms('refreshConfirmation', 'en')
    ).click()
  );
  expect(writes).toHaveLength(1);
  expect(host.querySelector<HTMLInputElement>('#profile-legalName')?.value).toBe('New company');
  expect(host.querySelector<HTMLInputElement>('#profile-legalName')?.disabled).toBe(false);
});

it('claims an address native submission before the resolver and prevents sibling writes while retaining a lost-acknowledgement draft', async () => {
  const writes: Array<{ path: string; json: string }> = [];
  let release!: (response: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method) {
        writes.push({ path, json: String(init.body) });
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      }
      if (path === '/api/profiles/' + profileId)
        throw new Error('Manager must not read owner identity');
      return Response.json(data(path));
    })
  );
  await mount('addresses', 'manager');
  await act(async () => button(host, t('settings.addresses.edit', 'en')).click());
  await change('#addresses-field-3', '  Retained historical correction  ');
  await submit('settings-address-form');
  expect(writes).toHaveLength(1);
  expect(JSON.parse(writes[0]!.json)).toMatchObject({
    fullAddress: 'Retained historical correction',
    idempotencyKey: expect.any(String),
  });
  expect(JSON.parse(writes[0]!.json)).not.toHaveProperty('provinceId');
  expect(JSON.parse(writes[0]!.json)).not.toHaveProperty('cityId');
  await act(async () => {
    document
      .querySelector<HTMLFormElement>('[data-slot=settings-address-form]')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    button(host, t('settings.addresses.add', 'en')).dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    );
    button(host, t('settings.addresses.delete', 'en')).dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    );
  });
  expect(writes).toHaveLength(1);
  expect(document.querySelector<HTMLInputElement>('#addresses-field-4')?.matches(':disabled')).toBe(
    true
  );
  await act(async () => release(Response.json({}, { status: 503 })));
  expect(document.querySelector<HTMLTextAreaElement>('#addresses-field-3')?.value).toBe(
    '  Retained historical correction  '
  );
  expect(document.body.textContent).toContain(tSettingsForms('retryOriginal', 'en'));
  await act(async () =>
    button(document.querySelector('[role=dialog]')!, tSettingsForms('retryOriginal', 'en')).click()
  );
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  await act(async () =>
    release(Response.json({ ...address, fullAddress: 'Retained historical correction' }))
  );
  expect(document.querySelector('[data-slot=settings-address-form]')).toBeNull();
});

it('keeps a same-profile address draft through list reads and discards private editor state on current denial', async () => {
  const other = {
    ...address,
    id: '55555555-5555-4555-8555-555555555555',
    mainAddress: false,
    fullAddress: 'Other address',
  };
  let rows = [address, other],
    deny = false,
    listReads = 0,
    mainWrites = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method && path.endsWith('/set-main')) {
        mainWrites++;
        rows = rows.map((row) => ({ ...row, mainAddress: row.id === other.id }));
        return Response.json(rows.find((row) => row.id === other.id));
      }
      if (init?.method) return Response.json({}, { status: deny ? 403 : 500 });
      if (path.endsWith('/addresses')) {
        listReads++;
        return Response.json({ addresses: rows });
      }
      return Response.json(data(path));
    })
  );
  await mount('addresses');
  await act(async () => button(host, t('settings.addresses.edit', 'en')).click());
  await change('#addresses-field-3', 'Private draft');
  const before = listReads;
  await act(async () => {
    button(host, t('settings.addresses.setMain', 'en')).dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    );
  });
  expect(mainWrites).toBe(1);
  expect(listReads).toBe(before + 1);
  expect(document.querySelector<HTMLTextAreaElement>('#addresses-field-3')?.value).toBe(
    'Private draft'
  );
  deny = true;
  await submit('settings-address-form');
  expect(document.querySelector('[data-slot=settings-address-form]')).toBeNull();
  expect(host.textContent).not.toContain('Saved main address');
  expect(host.textContent).toContain(tSettingsForms('forbidden', 'en'));
});

it('focuses the native address error and unlocks the owning server field without erasing raw input', async () => {
  const writes: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method) {
        writes.push(JSON.parse(String(init.body)));
        return Response.json(
          { error: { code: 'VALIDATION:INPUT:INVALID', fields: ['postalCode'] } },
          { status: 400 }
        );
      }
      return Response.json(data(path));
    })
  );
  await mount('addresses');
  await act(async () => button(host, t('settings.addresses.edit', 'en')).click());
  await change('#addresses-field-3', '   ');
  await submit('settings-address-form');
  expect(writes).toHaveLength(0);
  expect(document.activeElement).toBe(document.querySelector('#addresses-field-3'));
  expect(document.body.textContent).toContain(t('settings.addresses.validation.fullAddress', 'en'));
  await change('#addresses-field-3', '  Corrected raw address  ');
  await submit('settings-address-form');
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ fullAddress: 'Corrected raw address' });
  expect(document.activeElement).toBe(document.querySelector('#addresses-field-4'));
  expect(document.querySelector<HTMLInputElement>('#addresses-field-4')?.matches(':disabled')).toBe(
    false
  );
  expect(document.querySelector<HTMLTextAreaElement>('#addresses-field-3')?.value).toBe(
    '  Corrected raw address  '
  );
  expect(document.body.textContent).toContain(t('settings.addresses.validation.postalCode', 'en'));
});

it('keeps the same profile form mounted through a transient refresh and withdraws it on a current detail denial', async () => {
  let detailStatus = 200;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) =>
      path === '/api/profiles/' + profileId && detailStatus !== 200
        ? Response.json({}, { status: detailStatus })
        : Response.json(data(path))
    )
  );
  await mount('profile');
  await change('#profile-legalName', '  Unsaved company  ');
  await change('#profile-address', '  Unsaved main address  ');
  const nativeForm = document.querySelector('[data-slot=settings-profile-form]');
  detailStatus = 503;
  await act(async () => button(host, tSettingsForms('refreshProfile', 'en')).click());
  expect(document.querySelector('[data-slot=settings-profile-form]')).toBe(nativeForm);
  expect(host.querySelector<HTMLInputElement>('#profile-legalName')?.value).toBe(
    '  Unsaved company  '
  );
  expect(host.querySelector<HTMLTextAreaElement>('#profile-address')?.value).toBe(
    '  Unsaved main address  '
  );
  detailStatus = 403;
  await act(async () => button(host, tSettingsForms('refreshProfile', 'en')).click());
  expect(document.querySelector('[data-slot=settings-profile-form]')).toBeNull();
  expect(host.textContent).toContain(tSettingsForms('forbidden', 'en'));
  expect(host.textContent).not.toContain('Unsaved company');
  expect(
    Array.from(host.querySelectorAll('button')).some(
      (item) => item.textContent === tSettingsForms('refreshProfile', 'en')
    )
  ).toBe(false);
});

it.each(['none', 'different'] as const)(
  'retires the old private profile immediately when a refresh discovers %s active scope',
  async (target) => {
    const otherId = '66666666-6666-4666-8666-666666666666';
    let changed = false,
      nextRead = false,
      releaseDocuments!: (response: Response) => void,
      release!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        if (path === '/api/profiles' && changed)
          return Response.json({
            profiles: target === 'none' ? [] : [{ ...legal, id: otherId }],
            activeProfileId: target === 'none' ? null : otherId,
            hasDefault: target !== 'none',
          });
        if (path === '/api/profiles/' + otherId) {
          nextRead = true;
          releaseDocuments(Response.json({}, { status: 403 }));
          return new Promise<Response>((resolve) => {
            release = resolve;
          });
        }
        if (target === 'different' && path.includes('/documents/'))
          return new Promise<Response>((resolve) => {
            releaseDocuments = resolve;
          });
        return Response.json(data(path));
      })
    );
    await mount('profile');
    await change('#profile-legalName', 'Private prior-profile company');
    await change('#profile-address', 'Private prior-profile address');
    changed = true;
    await act(async () => button(host, tSettingsForms('refreshProfile', 'en')).click());
    expect(document.querySelector('[data-slot=settings-profile-form]')).toBeNull();
    expect(host.querySelector('#settings-profile-switcher')).toBeNull();
    if (target === 'different') {
      expect(nextRead).toBe(true);
      expect(host.textContent).not.toContain(tSettingsForms('forbidden', 'en'));
      await act(async () => release(Response.json({}, { status: 503 })));
      expect(host.textContent).toContain(crmText('settings.profile.error.loadRetry', 'en'));
      expect(document.querySelector('[data-slot=settings-profile-form]')).toBeNull();
    }
    expect(document.querySelector('#profile-legalName')).toBeNull();
    expect(document.querySelector('#profile-address')).toBeNull();
  }
);

it.each(['none', 'different'] as const)(
  'retires all saved-address drafts and targets on %s active scope before a new private read completes',
  async (target) => {
    const otherId = '66666666-6666-4666-8666-666666666666';
    let editor!: ReturnType<typeof useSavedAddressSettingsEditor>,
      changed = false,
      nextRead = false,
      release!: (response: Response) => void;
    function Probe() {
      editor = useSavedAddressSettingsEditor('en');
      return null;
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        if (path === '/api/profiles' && changed)
          return Response.json({
            profiles: target === 'none' ? [] : [{ ...legal, id: otherId }],
            activeProfileId: target === 'none' ? null : otherId,
            hasDefault: target !== 'none',
          });
        if (path === '/api/profiles/' + otherId + '/addresses') {
          nextRead = true;
          return new Promise<Response>((resolve) => {
            release = resolve;
          });
        }
        return Response.json(data(path));
      })
    );
    await act(async () =>
      root.render(
        <QueryProvider>
          {
            <AccountUserProvider value="owner">
              <Probe />
            </AccountUserProvider>
          }
        </QueryProvider>
      )
    );
    await act(async () => {
      editor.openEditForm(address);
      editor.form.setValue('fullAddress', 'Private prior-profile address');
      editor.confirmDelete(address.id);
    });
    expect(editor.showForm).toBe(true);
    expect(editor.deleteConfirmId).toBe(address.id);
    changed = true;
    let pending!: Promise<void>;
    await act(async () => {
      pending = editor.fetchAddresses(true);
    });
    expect(editor.addresses).toEqual([]);
    expect(editor.profileId).toBeNull();
    expect(editor.showForm).toBe(false);
    expect(editor.editingAddress).toBeNull();
    expect(editor.deleteConfirmId).toBeNull();
    expect(editor.form.getValues()).toEqual({
      provinceId: '',
      cityId: '',
      fullAddress: '',
      postalCode: '',
    });
    if (target === 'different') {
      expect(nextRead).toBe(true);
      expect(editor.command.coordination.isLocked()).toBe(true);
      await act(async () => {
        release(Response.json({}, { status: 503 }));
        await pending;
      });
      expect(editor.loadError).toBe(true);
      expect(editor.addresses).toEqual([]);
      expect(editor.profileId).toBeNull();
    } else await pending;
    await act(async () => {
      editor.openAddForm();
      editor.openEditForm(address);
    });
    expect(editor.showForm).toBe(false);
    expect(editor.command.coordination.isLocked()).toBe(false);
  }
);
