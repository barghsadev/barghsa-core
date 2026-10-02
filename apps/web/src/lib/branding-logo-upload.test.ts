import { afterEach, expect, it, vi } from 'vitest';
import {
  uploadBrandingLogo,
  uploadConversationPhoto,
  isConversationPhoto,
} from './branding-logo-upload.js';
vi.mock('./csrf.js', () => ({
  withCsrf: (headers: object) => ({ ...headers, 'X-CSRF-Token': 'fixture-token' }),
}));
afterEach(() => vi.unstubAllGlobals());
const file = () => new File(['image'], 'logo.png', { type: 'image/png' });
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function setup(failAt?: number, badVerification = false) {
  const responses = [
    reply({ key: 'uploads/image/example.png', presignedUrl: 'https://storage.example.test/image' }),
    reply({}),
    reply({ status: badVerification ? 'type_mismatch' : 'confirmed' }),
    reply({}),
  ];
  if (failAt !== undefined) responses[failAt] = reply({}, 503);
  const request = vi.fn<typeof fetch>().mockImplementation(async () => responses.shift()!);
  vi.stubGlobal('fetch', request);
  return request;
}
it('records a logo purpose only after upload and content verification succeed', async () => {
  const request = setup(),
    controller = new AbortController();
  expect(await uploadBrandingLogo(file(), controller.signal)).toBe('uploads/image/example.png');
  expect(JSON.parse(request.mock.calls[0]![1]!.body as string)).toMatchObject({
    purpose: 'branding_logo',
  });
  expect(JSON.parse(request.mock.calls[3]![1]!.body as string)).toMatchObject({
    purpose: 'branding_logo',
    category: 'image',
  });
  expect(request.mock.calls[1]![1]!.headers).toEqual({
    'Content-Type': 'image/png',
    'If-None-Match': '*',
  });
  expect(request.mock.calls.every(([, options]) => options?.signal === controller.signal)).toBe(
    true
  );
});
it.each([0, 1, 2, 3])('stops after upload stage %i fails', async (index) => {
  const request = setup(index);
  await expect(uploadBrandingLogo(file(), new AbortController().signal)).rejects.toThrow(
    'UPLOAD_FAILED'
  );
  expect(request).toHaveBeenCalledTimes(index + 1);
});
it('never records a file rejected by content verification', async () => {
  const request = setup(undefined, true);
  await expect(uploadBrandingLogo(file(), new AbortController().signal)).rejects.toThrow();
  expect(request).toHaveBeenCalledTimes(3);
});
it.each([
  new File([], 'empty.png', { type: 'image/png' }),
  new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }),
  new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }),
])('rejects an invalid image before requesting storage', async (invalid) => {
  const request = setup();
  await expect(uploadBrandingLogo(invalid, new AbortController().signal)).rejects.toThrow(
    'INVALID_LOGO'
  );
  expect(request).not.toHaveBeenCalled();
});
it('propagates cancellation without recording the upload', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
  vi.stubGlobal('fetch', request);
  await expect(uploadBrandingLogo(file(), new AbortController().signal)).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(request).toHaveBeenCalledTimes(1);
});
it('binds verified conversation photos to account purpose without a profile or ticket', async () => {
  const request = setup();
  await uploadConversationPhoto(file(), new AbortController().signal);
  for (const index of [0, 3]) {
    const body = JSON.parse(request.mock.calls[index]![1]!.body as string);
    expect(body).toMatchObject({ purpose: 'conversation_avatar', category: 'image' });
    expect(body).not.toHaveProperty('profileId');
    expect(body).not.toHaveProperty('ticketId');
  }
});
it.each(['png', 'jpg', 'webp'])(
  'allows a non-empty %s photo with an inferred MIME type',
  (extension) => {
    expect(isConversationPhoto(new File(['image'], `photo.${extension}`))).toBe(true);
  }
);
it.each([
  new File([], 'empty.png', { type: 'image/png' }),
  new File(['pdf'], 'photo.pdf', { type: 'application/pdf' }),
  new File(['svg'], 'photo.svg', { type: 'image/svg+xml' }),
  new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'photo.png', { type: 'image/png' }),
])('rejects invalid account photos before storage', async (invalid) => {
  const request = setup();
  await expect(uploadConversationPhoto(invalid, new AbortController().signal)).rejects.toThrow(
    'INVALID_PHOTO'
  );
  expect(request).not.toHaveBeenCalled();
});

it.each([0, 2, 3])(
  'exposes account denial at photo stage %i without continuing the upload',
  async (stage) => {
    const responses = [
      reply({
        key: 'uploads/image/verified.png',
        presignedUrl: 'https://storage.example.test/photo',
      }),
      reply({}),
      reply({ status: 'confirmed' }),
      reply({}),
    ];
    responses[stage] = reply({}, 403);
    const request = vi.fn<typeof fetch>().mockImplementation(async () => responses.shift()!);
    vi.stubGlobal('fetch', request);
    await expect(uploadConversationPhoto(file(), new AbortController().signal)).rejects.toThrow(
      'denied'
    );
    expect(request).toHaveBeenCalledTimes(stage + 1);
  }
);
