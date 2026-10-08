import { expect, it } from 'vitest';
import { telegramCode, telegramLinkReceipt, telegramStatus } from './telegram-link.js';
const uuid = '0199f111-1111-7111-8111-111111111111';
const status = {
  available: true,
  profileId: uuid,
  link: null,
  intent: null,
  latestDelivery: null,
};
it('accepts scoped canonical state and drops unsolicited fields', () => {
  expect(telegramStatus({ ...status, token: 'secret' })).toEqual(status);
  expect(
    telegramStatus({
      ...status,
      intent: {
        id: uuid,
        status: 'claimed',
        telegram_user_id: '4503599627370495',
        expires_at: '2030-01-01T00:00:00Z',
      },
      latestDelivery: { status: 'unknown', answer: 'private' },
    })?.latestDelivery
  ).toEqual({ status: 'unknown' });
});
it.each(['-1004467450624', '01', '4503599627370496', '1.5', '@release'])(
  'refuses group or noncanonical linked identity %s',
  (telegram_user_id) => {
    expect(
      telegramStatus({ ...status, link: { id: uuid, profile_id: uuid, telegram_user_id } })
    ).toBeNull();
  }
);
it('rejects malformed and contradictory claims and delivery states', () => {
  for (const patch of [
    { profileId: 'another-profile' },
    { link: [] },
    { latestDelivery: { status: 'retry_unknown' } },
    { intent: { id: uuid, status: 'pending', telegram_user_id: '12', expires_at: '2030-01-01' } },
    { intent: { id: uuid, status: 'claimed', telegram_user_id: null, expires_at: '2030-01-01' } },
    { intent: { id: uuid, status: 'claimed', telegram_user_id: '12', expires_at: 'invalid' } },
  ])
    expect(telegramStatus({ ...status, ...patch })).toBeNull();
});
it('pins deep links to the approved bot and one canonical bearer parameter', () => {
  const url = 'https://t.me/barghsa_dev_bot?start=' + 'a'.repeat(43);
  expect(telegramLinkReceipt({ id: uuid, url, token: 'extra' })).toEqual({ id: uuid, url });
  for (const candidate of [
    url + '&redirect=https://evil.test',
    url.replace('t.me', 'evil.test'),
    url.replace('barghsa_dev_bot', 'another_bot'),
    url.replace('https:', 'javascript:'),
    url.slice(0, -1),
  ])
    expect(telegramLinkReceipt({ id: uuid, url: candidate })).toBeNull();
});
it('normalizes Persian and Arabic digits without stripping invalid characters', () => {
  expect(telegramCode(' ۱۲٣۴۵٦ ')).toBe('123456');
  expect(telegramCode('۱۲x۴۵۶')).toBe('12x456');
});
