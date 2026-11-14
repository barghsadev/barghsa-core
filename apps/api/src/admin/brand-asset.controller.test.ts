import { expect, it, vi } from 'vitest';
import { AdminBrandAssetController, PublicBrandAssetController } from './brand-asset.controller.js';
import type { BrandAssetService } from './brand-asset.service.js';
import type { AuthenticatedRequest } from '../session/session.guard.js';

const id = '11111111-1111-7111-8111-111111111111';
const digest = 'a'.repeat(64);
const session = { operatingContext: 'staff', isAdmin: false, permissions: ['admin:branding:read'] };

it('allows only the staff preview permission and passes the original session', async () => {
  const read = vi.fn().mockResolvedValue('preview');
  const controller = new AdminBrandAssetController({ read } as unknown as BrandAssetService);
  for (const identity of [
    { ...session, permissions: [] },
    { ...session, operatingContext: 'customer' },
  ]) {
    const request = { session: identity } as unknown as AuthenticatedRequest;
    expect(() => controller.read(id, digest, request)).toThrow(
      expect.objectContaining({ status: 403 })
    );
  }
  expect(read).not.toHaveBeenCalled();
  await expect(
    controller.read(id, digest, { session } as unknown as AuthenticatedRequest)
  ).resolves.toBe('preview');
  expect(read).toHaveBeenCalledOnce();
  expect(read).toHaveBeenCalledWith(id, digest, session);
});

it('passes public reads through the active-branding path without a preview identity', async () => {
  const read = vi.fn().mockResolvedValue('public image');
  const controller = new PublicBrandAssetController({ read } as unknown as BrandAssetService);
  await expect(controller.read(id, digest)).resolves.toBe('public image');
  expect(read).toHaveBeenCalledExactlyOnceWith(id, digest);
});
