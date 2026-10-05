import { HttpException } from '@nestjs/common';
import { expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { InputFieldException } from '../common/input-field.exception.js';
import { ProfilesController } from './profiles.controller.js';

const profileId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const addressId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const key = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const req = { session: { userId: 'opaque-owner' } } as unknown as AuthenticatedRequest;
const routes = ['profile', 'create', 'edit'] as const;

function fixture(route: (typeof routes)[number]) {
  const authorize = vi.fn().mockResolvedValue(undefined);
  const saved = {
    id: route === 'profile' ? profileId : addressId,
    profileId,
    profileType: 'INDIVIDUAL',
    isDefault: false,
    status: 'DRAFT',
    title: null,
    firstName: 'Captured',
    lastName: null,
    nationalId: null,
    provinceId: profileId,
    cityId: addressId,
    fullAddress: 'Captured',
    postalCode: '1234567890',
    mainAddress: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
  const work = vi.fn().mockResolvedValue(saved);
  const service = {
    assertProfileFormAuthority: authorize,
    assertAddressFormAuthority: authorize,
    updateProfile: work,
    createAddress: work,
    updateAddress: work,
  };
  const controller = new ProfilesController(service as never, {} as never);
  const body =
    route === 'profile'
      ? { firstName: '  Captured  ', idempotencyKey: key }
      : route === 'create'
        ? {
            provinceId: profileId,
            cityId: addressId,
            fullAddress: '  Captured  ',
            postalCode: '1234567890',
            mainAddress: false,
            idempotencyKey: key,
          }
        : { fullAddress: '  Captured  ', idempotencyKey: key };
  const invoke = (input: unknown) =>
    route === 'profile'
      ? controller.updateProfile(profileId, input, req)
      : route === 'create'
        ? controller.createAddress(profileId, input as never, req)
        : controller.updateAddress(profileId, addressId, input as never, req);
  return {
    authorize,
    saved,
    work,
    body,
    invoke,
    field: route === 'profile' ? 'firstName' : 'fullAddress',
  };
}

async function rejection(command: Promise<unknown>): Promise<HttpException> {
  try {
    await command;
  } catch (error) {
    if (error instanceof HttpException) return error;
    throw error;
  }
  throw new Error('Expected rejection');
}

it.each(routes)(
  '%s valid normalized commands keep actual receipts and bypass feedback preflight',
  async (route) => {
    const f = fixture(route);
    const result = await f.invoke({ ...f.body, ignoredLegacyExtra: 'not accepted' });
    expect(f.authorize).not.toHaveBeenCalled();
    const data = { ...f.body, [f.field]: 'Captured' };
    expect(f.work).toHaveBeenCalledExactlyOnceWith(
      req.session,
      profileId,
      ...(route === 'edit' ? [addressId, data] : [data])
    );
    if (route === 'profile') {
      expect(result).toEqual({
        id: profileId,
        profileType: 'INDIVIDUAL',
        isDefault: false,
        status: 'DRAFT',
        title: null,
        firstName: 'Captured',
        lastName: null,
        nationalId: null,
        updatedAt: f.saved.updatedAt,
      });
    } else expect(result).toBe(f.saved);
  }
);

it.each(routes)(
  '%s string-only owned feedback follows current authority without values or work',
  async (route) => {
    const f = fixture(route);
    for (const value of ['', 'PRIVATE'.repeat(80)]) {
      const error = await rejection(f.invoke({ ...f.body, [f.field]: value }));
      expect(error).toBeInstanceOf(InputFieldException);
      expect(error).toMatchObject({ fields: [f.field] });
      expect(error.getResponse()).toEqual({ error: 'VALIDATION:INPUT:INVALID' });
      expect(JSON.stringify(error.getResponse())).not.toContain('PRIVATE');
    }
    expect(f.authorize).toHaveBeenCalledTimes(2);
    expect(f.work).not.toHaveBeenCalled();
  }
);

it.each(routes)(
  '%s current authority denial cannot become owning feedback or an accepted command',
  async (route) => {
    const f = fixture(route);
    for (const status of [401, 403, 404]) {
      f.authorize.mockRejectedValueOnce(new HttpException('Current authority denied', status));
      const error = await rejection(f.invoke({ ...f.body, [f.field]: '' }));
      expect(error.getStatus()).toBe(status);
      expect(error).not.toBeInstanceOf(InputFieldException);
    }
    expect(f.work).not.toHaveBeenCalled();
  }
);

it.each(routes)(
  '%s mixed protected unknown nonstring and malformed roots stay generic',
  async (route) => {
    const f = fixture(route);
    for (const input of [
      null,
      [],
      { ...f.body, [f.field]: [] },
      { ...f.body, [f.field]: '', idempotencyKey: 'PRIVATE' },
      { ...f.body, [f.field]: '', actorId: 'PRIVATE' },
      { ...f.body, [f.field]: '', mainAddress: 'PRIVATE' },
    ]) {
      const error = await rejection(f.invoke(input));
      expect(error).not.toBeInstanceOf(InputFieldException);
      expect(JSON.stringify(error.getResponse())).not.toContain('PRIVATE');
    }
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.work).not.toHaveBeenCalled();
  }
);

it.each(routes)(
  '%s key-only updates and incomplete address coordination stay generic',
  async (route) => {
    const f = fixture(route);
    for (const input of [{ idempotencyKey: key }, { provinceId: profileId, idempotencyKey: key }]) {
      if (route === 'edit' && 'provinceId' in input) continue;
      const error = await rejection(f.invoke(input));
      expect(error).not.toBeInstanceOf(InputFieldException);
    }
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.work).not.toHaveBeenCalled();
  }
);
