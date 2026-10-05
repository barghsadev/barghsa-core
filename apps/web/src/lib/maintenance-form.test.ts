import { expect, it } from 'vitest';
import {
  maintenanceDraft,
  maintenanceErrors,
  maintenancePayload,
  isMaintenanceList,
  matchesMaintenanceReceipt,
  type MaintenanceSetting,
} from './maintenance-form.js';

const setting: MaintenanceSetting = {
  capability: 'electricity_checkout',
  active: true,
  reason: { fa: 'در حال بررسی', en: 'Being checked' },
  owner: 'Operations',
  estimatedUntil: '2099-01-01T00:00:32.000Z',
  version: 3,
  updatedAt: '2026-10-05T00:00:00Z',
};
const zone = 'Asia/Tehran';
it('preserves the exact saved instant while editing unrelated raw text', () => {
  const draft = maintenanceDraft(setting, zone);
  expect(draft.deadline.time).toBe('03:30');
  draft.owner = '  Operations  ';
  draft.reasonEn = '  Being checked  ';
  expect(maintenanceErrors(draft, zone)).toEqual([]);
  expect(maintenancePayload(draft, zone, 3)).toMatchObject({
    owner: 'Operations',
    reason: { en: 'Being checked' },
    estimatedUntil: setting.estimatedUntil,
    expectedVersion: 3,
  });
  expect(draft.owner).toBe('  Operations  ');
});
it('validates all active fields and accepts deactivation without a deadline', () => {
  const draft = maintenanceDraft(null, zone);
  draft.active = true;
  draft.reasonFa = ' ';
  draft.reasonEn = 'x'.repeat(501);
  draft.owner = 'x'.repeat(101);
  expect(maintenanceErrors(draft, zone)).toEqual(['reasonFa', 'reasonEn', 'owner', 'deadline']);
  draft.active = false;
  expect(maintenanceErrors(draft, zone)).toEqual([]);
  expect(maintenancePayload(draft, zone, 2)).toEqual({
    active: false,
    reason: null,
    owner: null,
    estimatedUntil: null,
    expectedVersion: 2,
  });
});
it('converts edited clock time using the account zone and rejects past times and DST gaps', () => {
  const draft = maintenanceDraft(setting, zone);
  draft.deadline = { ...draft.deadline, time: '04:15', changed: true };
  expect(maintenancePayload(draft, zone, 3).estimatedUntil).toBe('2099-01-01T00:45:00.000Z');
  expect(maintenanceErrors(draft, zone, Date.parse('2099-01-01T00:45:00Z'))).toEqual(['deadline']);
  const gap = maintenanceDraft(
    { ...setting, estimatedUntil: '2026-03-08T07:30:00Z' },
    'America/New_York'
  );
  gap.deadline = { ...gap.deadline, time: '02:30', changed: true };
  expect(maintenanceErrors(gap, 'America/New_York', Date.parse('2026-01-01T00:00:00Z'))).toEqual([
    'deadline',
  ]);
});
it('accepts only matching saved capability, contents and next version receipts', () => {
  const body = maintenancePayload(maintenanceDraft(setting, zone), zone, 3);
  const saved = { ...setting, estimatedUntil: '2099-01-01T03:30:32+03:30', version: 4 };
  expect(matchesMaintenanceReceipt(saved, setting.capability, body)).toBe(true);
  for (const change of [
    { version: 3 },
    { version: 5 },
    { active: false },
    { capability: 'ai_chat' },
    { owner: 'Other' },
    { reason: { fa: 'در حال بررسی', en: 'Other' } },
    { updatedAt: null },
    { estimatedUntil: '2099-01-01T00:00:00Z' },
  ])
    expect(matchesMaintenanceReceipt({ ...saved, ...change }, setting.capability, body)).toBe(
      false
    );
  const inactive = maintenancePayload(
    { ...maintenanceDraft(setting, zone), active: false },
    zone,
    3
  );
  expect(
    matchesMaintenanceReceipt({ ...setting, ...inactive, version: 4 }, setting.capability, inactive)
  ).toBe(true);
});
it('rejects missing, duplicate or malformed saved-status rows', () => {
  const rows = [
    'electricity_checkout',
    'saving_orders',
    'solar_requests',
    'wallet_topup',
    'ai_chat',
  ].map((capability) => ({ ...setting, capability }));
  expect(isMaintenanceList(rows)).toBe(true);
  for (const value of [
    null,
    [],
    rows.slice(1),
    [...rows.slice(1), rows[1]],
    [...rows.slice(1), { ...setting, reason: null }],
  ])
    expect(isMaintenanceList(value)).toBe(false);
});
