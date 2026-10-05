import type { Page, Route } from '@playwright/test';
import { ErrorCodes } from '@barghsa/shared/errors';
import { setupCatalogueForms } from './catalogue-form-fixture';
import { fullNavigation } from './navigation-fixture';

const uuid = (value: number) => `99000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
export const profileId = uuid(1),
  otherProfileId = uuid(2);
export const provinceId = uuid(3),
  otherProvinceId = uuid(4);
export const cityId = uuid(5),
  otherCityId = uuid(6);
export const originalAddressId = uuid(7),
  companionAddressId = uuid(8);
export const instant = '2026-10-02T09:00:45.678Z';
export const privateText = 'PRIVATE-OLD-SETTINGS-SOURCE';
export type Family = 'profile' | 'create' | 'edit';
type Body = Record<string, unknown>;
type Mode = 'success' | 'owned' | 'mixed' | 'hold';
export type Command = {
  family: Family;
  path: string;
  method: string;
  raw: string;
  body: Body;
  csrf: string | null;
};
export type Address = {
  id: string;
  profileId: string;
  provinceId: string;
  cityId: string;
  fullAddress: string;
  postalCode: string;
  mainAddress: boolean;
  createdAt: string;
  updatedAt: string;
  provinceNameFa?: string;
  provinceNameEn?: string;
  cityNameFa?: string;
  cityNameEn?: string;
};
const address = (id: string, mainAddress: boolean): Address => ({
  id,
  profileId,
  provinceId,
  cityId,
  mainAddress,
  fullAddress: id === originalAddressId ? 'Original main address' : 'Concurrent saved address',
  postalCode: '1234567890',
  createdAt: instant,
  updatedAt: instant,
  provinceNameFa: 'تهران',
  provinceNameEn: 'Tehran',
  cityNameFa: 'تهران',
  cityNameEn: 'Tehran',
});
const legalInfo = {
  legalName: 'Original Company',
  nationalIdentifier: '12345678901',
  registrationNumber: '123',
  companyTypeId: 'private-joint-stock',
  economicCode: null,
  representativeFirstName: 'Sara',
  representativeLastName: 'Example',
  representativeNationalId: '0010350829',
  representativeFullAddress: 'Representative address',
  representativePostalCode: '1234567890',
  representativeTitle: 'Director',
  representativeRelationship: 'Authorized representative',
};
const detail = (id: string) => ({
  id,
  profileType: id === profileId ? 'LEGAL' : 'INDIVIDUAL',
  isDefault: id === profileId,
  status: 'ACTIVE',
  title: (id === profileId ? 'Original profile' : 'Fresh profile') as string | null,
  firstName: id === profileId ? null : 'Fresh',
  lastName: id === profileId ? null : 'Customer',
  nationalId: id === profileId ? null : '0010350829',
  createdAt: instant,
  updatedAt: instant,
  canEditIdentity: false,
  legalInfo: id === profileId ? { ...legalInfo } : null,
  addresses: id === profileId ? [address(originalAddressId, true)] : [],
});

export async function setupSettingsForms(
  page: Page,
  locale: 'en' | 'fa',
  surface: 'profile' | 'addresses'
) {
  await setupCatalogueForms(page, locale, locale === 'fa');
  const profiles = new Map([
    [profileId, detail(profileId)],
    [otherProfileId, detail(otherProfileId)],
  ]);
  const state = {
    actor: 'settings/customer:opaque',
    activeProfileId: profileId,
    denied: false,
    modes: { profile: 'success', create: 'success', edit: 'success' } as Record<Family, Mode>,
    detailMode: 'success' as 'success' | 'failed' | 'malformed' | 'hold',
    ownedFields: ['legalName'] as string[],
    held: undefined as { route: Route; command: Command } | undefined,
    heldDetail: undefined as Route | undefined,
    addresses: surface === 'profile' ? [address(originalAddressId, true)] : ([] as Address[]),
    writes: [] as Command[],
    reads: [] as string[],
    shellProfileReads: 0,
    effects: { profile: 0, create: 0, edit: 0, history: 0, audit: 0 },
    companionWrites: [] as string[],
    documentReads: 0,
  };
  const receipts = new Map<string, { raw: string; result: Body }>();
  await page
    .context()
    .addCookies([
      { name: 'barghsa_csrf', value: 'settings-initial', url: 'http://127.0.0.1:4173' },
    ]);
  await page.route('**/api/auth/user', (route) =>
    route.fulfill({
      json: {
        userId: state.actor,
        isStaff: false,
        operatingContext: 'customer',
        canSwitchContext: false,
        requiresTosAcceptance: false,
        navigation: {
          ...fullNavigation(
            'customer',
            state.activeProfileId === profileId ? 'LEGAL' : 'INDIVIDUAL'
          ),
          profileId: state.activeProfileId,
        },
      },
    })
  );
  await page.route('**/api/invitations/pending', (route) =>
    route.fulfill({ json: { invitations: [] } })
  );
  await page.route('**/api/v1/notifications**', (route) =>
    route.fulfill({ json: { data: [], next_cursor: null, unread_count: 0 } })
  );
  await page.route('**/api/profiles', async (route) => {
    state.reads.push('/api/profiles');
    await route.fulfill({
      json: {
        profiles: [...profiles.values()]
          .filter(
            (item) => !state.actor.startsWith('settings/new') || item.id === state.activeProfileId
          )
          .map((item) => ({
            ...item,
            addresses: undefined,
            legalInfo: undefined,
            isDefault: item.isDefault,
          })),
        activeProfileId: state.activeProfileId,
        hasDefault: true,
      },
    });
    if (route.request().headers().accept === 'application/json') state.shellProfileReads++;
  });
  await page.route('**/api/onboarding/documents/*', (route) => {
    state.documentReads++;
    return route.fulfill({ json: { documents: [] } });
  });
  await page.route('**/api/geography/provinces', (route) => {
    state.reads.push('/api/geography/provinces');
    return route.fulfill({
      json: [
        { id: provinceId, nameFa: 'تهران', nameEn: 'Tehran' },
        { id: otherProvinceId, nameFa: 'فارس', nameEn: 'Fars' },
      ],
    });
  });
  for (const [province, city, nameFa, nameEn] of [
    [provinceId, cityId, 'تهران', 'Tehran'],
    [otherProvinceId, otherCityId, 'شیراز', 'Shiraz'],
  ] as const)
    await page.route(`**/api/geography/provinces/${province}/cities`, (route) => {
      state.reads.push(`/api/geography/provinces/${province}/cities`);
      return route.fulfill({ json: [{ id: city, provinceId: province, nameFa, nameEn }] });
    });

  function projection(id: string) {
    const item = profiles.get(id)!;
    return {
      id: item.id,
      profileType: item.profileType,
      isDefault: item.isDefault,
      status: item.status,
      title: item.title,
      firstName: item.firstName,
      lastName: item.lastName,
      nationalId: item.nationalId,
      updatedAt: item.updatedAt,
    };
  }
  function commit(command: Command): Body {
    const key = `${command.family}:${command.path}:${String(command.body.idempotencyKey)}`;
    const cached = receipts.get(key);
    if (cached) {
      if (cached.raw !== command.raw)
        throw new Error('Captured settings command changed under original key');
      return cached.result;
    }
    const changed = Object.fromEntries(
      Object.entries(command.body)
        .filter(([key]) => key !== 'idempotencyKey' && key !== 'mainAddress')
        .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])
    );
    const stamp = '2026-10-02T09:03:45.678Z';
    let result: Body;
    if (command.family === 'profile') {
      const item = profiles.get(profileId)!;
      if (typeof changed.title === 'string') item.title = changed.title || null;
      if (item.legalInfo && typeof changed.legalName === 'string')
        item.legalInfo.legalName = changed.legalName;
      if (item.legalInfo && typeof changed.nationalIdentifier === 'string')
        item.legalInfo.nationalIdentifier = changed.nationalIdentifier;
      if (typeof changed.fullAddress === 'string') {
        for (const current of state.addresses) current.mainAddress = false;
        state.addresses.push({
          ...address(uuid(20 + state.effects.history), true),
          ...changed,
          updatedAt: stamp,
        } as Address);
        state.effects.history++;
      }
      item.addresses = state.addresses;
      item.updatedAt = stamp;
      result = projection(profileId);
    } else if (command.family === 'create') {
      const created = {
        ...address(
          uuid(30 + state.effects.create),
          !state.addresses.some((item) => item.mainAddress)
        ),
        ...changed,
        updatedAt: stamp,
      } as Address;
      state.addresses.push(created);
      result = { ...created };
    } else {
      const id = command.path.split('/').at(-1)!;
      const current = state.addresses.find((item) => item.id === id)!;
      Object.assign(current, changed, { updatedAt: stamp });
      result = { ...current };
    }
    state.effects[command.family]++;
    state.effects.audit++;
    const receipt = structuredClone(result);
    receipts.set(key, { raw: command.raw, result: receipt });
    return receipt;
  }
  async function write(route: Route, family: Family) {
    const request = route.request();
    const command: Command = {
      family,
      path: new URL(request.url()).pathname,
      method: request.method(),
      raw: request.postData()!,
      body: request.postDataJSON(),
      csrf: request.headers()['x-csrf-token'] ?? null,
    };
    state.writes.push(command);
    if (state.denied)
      return route.fulfill({
        status: 403,
        json: { error: { code: ErrorCodes.AUTHZ_FORBIDDEN.code } },
      });
    if (state.modes[family] === 'owned' || state.modes[family] === 'mixed')
      return route.fulfill({
        status: 400,
        json: {
          error: {
            code: 'VALIDATION:INPUT:INVALID',
            correlationId: 'fixture-correlation',
            message: privateText,
            fields:
              state.modes[family] === 'owned'
                ? state.ownedFields
                : ['postalCode', 'idempotencyKey', { private: privateText }],
          },
        },
      });
    if (state.modes[family] === 'hold') {
      state.held = { route, command };
      return;
    }
    return route.fulfill({ status: family === 'create' ? 201 : 200, json: commit(command) });
  }
  await page.route(/\/api\/profiles\/[0-9a-f-]+$/, (route) => {
    if (route.request().method() === 'PUT') return write(route, 'profile');
    const id = new URL(route.request().url()).pathname.split('/').at(-1)!;
    state.reads.push(`/api/profiles/${id}`);
    if (state.denied || surface === 'addresses')
      return route.fulfill({
        status: 403,
        json: { error: { code: ErrorCodes.AUTHZ_FORBIDDEN.code } },
      });
    if (state.detailMode === 'hold') {
      state.heldDetail = route;
      return;
    }
    if (state.detailMode === 'failed') return route.fulfill({ status: 503, json: {} });
    const item = profiles.get(id)!;
    return route.fulfill({
      json:
        state.detailMode === 'malformed'
          ? { ...item, id: otherProfileId, title: privateText }
          : { ...item, addresses: id === profileId ? state.addresses : item.addresses },
    });
  });
  await page.route(/\/api\/profiles\/[0-9a-f-]+\/addresses$/, (route) => {
    if (route.request().method() === 'POST') return write(route, 'create');
    state.reads.push(new URL(route.request().url()).pathname);
    if (state.denied)
      return route.fulfill({
        status: 403,
        json: { error: { code: ErrorCodes.AUTHZ_FORBIDDEN.code } },
      });
    return route.fulfill({
      json: { addresses: state.activeProfileId === profileId ? state.addresses : [] },
    });
  });
  await page.route(/\/api\/profiles\/[0-9a-f-]+\/addresses\/[0-9a-f-]+$/, (route) => {
    if (route.request().method() === 'PUT') return write(route, 'edit');
    const path = new URL(route.request().url()).pathname;
    state.companionWrites.push(path);
    const target = state.addresses.find((item) => item.id === path.split('/').at(-1));
    if (target?.mainAddress)
      return route.fulfill({
        status: 400,
        json: { error: { code: ErrorCodes.VALIDATION_INPUT_INVALID.code } },
      });
    state.addresses = state.addresses.filter((item) => item.id !== target?.id);
    return route.fulfill({ json: { message: 'Address deleted successfully.' } });
  });
  await page.route('**/api/profiles/*/addresses/*/set-main', (route) => {
    const path = new URL(route.request().url()).pathname;
    state.companionWrites.push(path);
    const id = path.split('/').at(-2)!;
    for (const item of state.addresses) item.mainAddress = item.id === id;
    return route.fulfill({ json: state.addresses.find((item) => item.id === id)! });
  });
  await page.route('**/api/profiles/default/*', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1)!;
    state.companionWrites.push(new URL(route.request().url()).pathname);
    state.activeProfileId = id;
    return route.fulfill({ json: { activeProfileId: id } });
  });
  function commitHeld() {
    if (!state.held) throw new Error('No held settings request');
    return commit(state.held.command);
  }
  async function finishHeld(result: Body, malformed = false) {
    const held = state.held!;
    state.held = undefined;
    await held.route.fulfill({
      status: held.command.family === 'create' ? 201 : 200,
      json: malformed
        ? { ...result, profileId: otherProfileId, id: otherProfileId, fullAddress: privateText }
        : result,
    });
  }
  return {
    state,
    commitHeld,
    finishHeld,
    projection,
    addConcurrentAddress: () => state.addresses.push(address(companionAddressId, false)),
  };
}
